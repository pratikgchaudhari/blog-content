---
title: Virtual Memory Explained - Pages, Page Tables, TLBs, Page Faults and What It Means for Java
date: 2026-11-07
summary: A detailed guide to virtual memory covering address spaces, pages and page tables, the MMU and TLB, page faults, swapping, copy-on-write, mmap, overcommit and the OOM killer, huge pages, and what it all means for Java applications.
tag: virtual-memory, operating-systems, linux, memory-management, performance, jvm, java, systems-programming
draft: false
related: types-of-garbage-collectors-in-java,database-internals,latency-percentiles-explained
---

Virtual memory is a memory management technique in which every process gets its own private, contiguous range of addresses, and the operating system and the CPU together translate those addresses into locations in physical RAM. Programs never deal with physical memory directly. They work with virtual addresses, and the hardware maps them to real memory behind the scenes, one page at a time.

The idea dates back to the Atlas computer at the University of Manchester in the early 1960s, which moved pages between core memory and a magnetic drum. Paging reached mainstream PCs with the Intel 80386 in 1985, and today every general-purpose operating system is built on it.

Virtual memory explains why a Java process can show a virtual size larger than the machine's RAM, why a container gets OOM-killed while the heap looks fine, and why `fork` is fast. This article covers how it works and what it means for Java applications.

## Why Virtual Memory Exists

Imagine a computer without virtual memory, where every program uses physical addresses directly. Address 1000 means byte 1000 of the RAM chips. That design has three serious problems:

- **Conflicts**: two programs written to use address 1000 cannot both run at the same time without being relocated.
- **No protection**: nothing stops a buggy program from overwriting another program's memory, or the kernel's. One bad pointer can bring down the whole machine. Early personal computers worked roughly like this.
- **Limited capacity**: if all programs together need more memory than is installed, there is no way to run them.

Virtual memory solves all three by giving every process its own address space and translating each address on every access. "1000" means something different in each process, a process can only reach memory mapped into its own space, and because mappings can point to data on disk, the system can promise more memory than it has.

Think of apartment numbers: many buildings have a flat 101, and "101" only has meaning within a building.

## Address Spaces

Every process has its own **virtual address space**. From the process's point of view, it owns a huge, private, continuous range of memory.

On a typical 64-bit Linux system on x86-64, a process can address 128 TiB of user space. No machine has that much RAM for a single process, and none needs to. Most of the address space is empty and unmapped. Only the regions the process actually uses are mapped, and only the parts it touches consume physical memory.

You can inspect a process's address space through `/proc/<pid>/maps`:

```bash
cat /proc/self/maps
```

The output looks like this (trimmed):

```text
55d0c6a00000-55d0c6a02000 r--p 00000000 08:01 1835   /usr/bin/cat
55d0c6a02000-55d0c6a07000 r-xp 00002000 08:01 1835   /usr/bin/cat
55d0c8c41000-55d0c8c62000 rw-p 00000000 00:00 0      [heap]
7f2b1a400000-7f2b1a428000 r--p 00000000 08:01 2042   /usr/lib/x86_64-linux-gnu/libc.so.6
7ffd4a1e3000-7ffd4a204000 rw-p 00000000 00:00 0      [stack]
```

Each line is a region, which the kernel calls a **VMA** (virtual memory area), showing its address range, its permissions (read, write, execute, private or shared), and the backing file or a label such as `[heap]`. The permissions matter. Code is mapped `r-x`: readable and executable, but not writable. Any attempt to write to it is stopped by the CPU, which is virtual memory doing security work.

## Pages and Frames

Translating every byte address individually would be far too expensive, so memory is managed in fixed-size blocks:

- A **page** is a block of virtual memory.
- A **frame** (or page frame) is a block of physical memory of the same size.

On most systems both are 4 KiB (4,096 bytes). You can check the page size with:

```bash
getconf PAGESIZE
```

This usually prints `4096`. Apple Silicon Macs use 16 KiB pages, and some ARM Linux systems use 16 KiB or 64 KiB, so code should never hardcode 4096.

The operating system maintains a mapping from each process's virtual pages to physical frames. Any page can be placed in any frame, so pages that are adjacent in a program's address space can be scattered across physical RAM without the program knowing.

With 4 KiB pages, an address splits into two parts. Since 4,096 is 2 to the power 12, the lowest 12 bits are the **offset** within the page, and the remaining bits are the **page number**. In hexadecimal, 12 bits is exactly three digits:

```text
virtual address:  0x12345678
page number:      0x12345      (everything except the last 3 hex digits)
offset in page:   0x678        (the last 3 hex digits)
```

If the operating system has placed virtual page `0x12345` in physical frame `0x00abc`, translation replaces the page number with the frame number and keeps the offset:

```text
physical address: 0x00abc678
```

The offset never changes. Only the page number is translated.

## Page Tables

The mapping from pages to frames is stored in a data structure called a **page table**. Each process has its own.

### Why a Flat Table Doesn't Work

The simplest design is one big array indexed by page number. On x86-64, virtual addresses use 48 bits. With 12 bits of offset, that leaves 36 bits of page number, or 2 to the power 36 possible pages: about 68.7 billion entries. At 8 bytes per entry, a flat table would need 512 GiB per process, almost all of it empty. That is clearly not practical.

### Multi-Level Page Tables

Instead, page tables are organised as a **tree**, and only the branches that are actually used are allocated. On x86-64 with 4 KiB pages, the 36-bit page number is split into four 9-bit indexes, one per level:

```text
| 9 bits  | 9 bits  | 9 bits  | 9 bits  | 12 bits |
| level 4 | level 3 | level 2 | level 1 | offset  |
```

Nine bits gives 512 entries per table, and 512 entries of 8 bytes each is exactly 4,096 bytes, so every table fits in one page.

Translation works like this:

1. The CPU finds the top-level table using a register (CR3 on x86) that the kernel sets for the current process.
2. The first 9 bits select an entry, which points to a second-level table.
3. The next 9 bits select an entry in that table, and so on through all four levels.
4. The last level gives the physical frame. Adding the 12-bit offset gives the physical address.

```text
CR3 --> [Level 4 table] --> [Level 3 table] --> [Level 2 table] --> [Level 1 table] --> frame + offset
          index bits          index bits          index bits          index bits
          47..39              38..30              29..21              20..12
```

The benefit is that unused regions cost nothing. If an entire 512 GiB region of the address space is unused, its top-level entry is empty and none of the tables below it exist. A small process may need only a handful of page-table pages.

Newer x86 processors support five levels (57-bit addresses), and ARM64 uses a similar multi-level scheme.

### Page Table Entries

Each **page table entry (PTE)** holds the frame number plus several flag bits. The most important are:

- **Present**: whether the page is currently in physical memory.
- **Writable**: whether writes are allowed.
- **User**: whether user-mode code may access the page, or only the kernel.
- **Accessed**: set by the CPU when the page is read or written.
- **Dirty**: set by the CPU when the page is written.

These few bits are the foundation for almost everything else in this article: demand paging, swapping, copy-on-write, and memory protection.

## The MMU and the TLB

Walking four levels of tables on every memory access would mean four extra memory reads for each real one. Two hardware components make translation fast.

### The Memory Management Unit

The **MMU** (memory management unit) is the part of the CPU that performs address translation. Programs never see physical addresses. Every load and store passes through the MMU, which translates it on the fly. The operating system builds and maintains the page tables, and the MMU reads them.

### The Translation Lookaside Buffer

The **TLB** (translation lookaside buffer) is a small cache inside the CPU that stores recent translations. If a page was translated recently, the MMU finds the answer in the TLB almost instantly, without walking the page tables.

```text
virtual address
      |
      v
  +-------+   hit    +----------------------+
  |  TLB  | -------> | physical address     |
  +-------+          +----------------------+
      | miss                   ^
      v                        |
  page table walk  ------------+
  (then cache the result in the TLB)
```

TLBs are small, from dozens to a couple of thousand entries. Random access over lots of memory misses often, and each miss costs a page table walk. This is one reason random access over a large dataset can be much slower than sequential access, even when all the data is already in RAM.

### Context Switches

Cached translations for one process are useless to another. Older CPUs flushed the TLB on every process switch; modern ones tag entries with an address-space identifier (PCID on x86). Switching threads within a process is cheaper, since they share an address space.

## Page Faults

When the MMU looks up a page whose entry is not present, or the access violates the page's permissions, the CPU raises a **page fault**. Despite the name, a page fault is usually a normal event, not an error. The CPU pauses the thread and transfers control to the kernel, which decides what to do.

There are three broad outcomes:

| Type | What happened | Typical cost |
|---|---|---|
| **Minor (soft) fault** | The data is already in RAM; the kernel only needs to set up the mapping (for example, a fresh zeroed page or a shared library page already loaded by another process) | Microseconds or less |
| **Major (hard) fault** | The data must be read from disk, from a file or from swap | Much higher; the thread waits for I/O |
| **Invalid access** | The address is not mapped, or the access is not permitted (such as writing to a read-only page) | The process receives SIGSEGV |

The last case is the familiar "segmentation fault". Java programs rarely see it, because the JVM checks memory accesses itself, but when the JVM crashes with SIGSEGV in native code, this is what happened.

GNU `time` (the standalone binary, not the shell built-in) reports page fault counts for a command:

```bash
/usr/bin/time -v java -version 2>&1 | grep -i "page faults"
```

It prints one line for major faults and one for minor faults. Expect many minor faults and, when the files involved are already cached, few or no major ones.

## Demand Paging

When a program requests memory, for example through `malloc` or `mmap`, the kernel usually just records that the address range is now valid. It does not allocate physical frames yet, and the page table entries stay empty.

Only when the program first touches a page does a page fault occur, and only then does the kernel find a frame for it. This is **demand paging**: memory is allocated lazily, page by page, as it is used. It is similar to booking a table for 20 at a restaurant. The booking is recorded, but nothing is cooked until people actually order.

Executables load the same way: the kernel maps the binary, and code pages load as they're executed.

### Virtual Size vs Resident Set Size

Demand paging means every process has two very different memory numbers:

- **Virtual size** (VIRT in `top`, `VmSize` in `/proc/<pid>/status`) is the total size of all mapped address ranges, including memory that has been reserved but never touched.
- **Resident set size** (RES or RSS in `top`, `VmRSS` in `/proc/<pid>/status`) is the part that is actually in physical RAM right now.

```bash
grep -E 'VmSize|VmRSS' /proc/<pid>/status
```

RSS is usually the number that matters. A JVM reserves address space up front for the heap, code cache, metaspace and thread stacks, so its VIRT can exceed RAM harmlessly.

RSS has a caveat of its own: it counts shared pages, such as libc, in full for every process that uses them, so adding up RSS across processes overcounts. `/proc/<pid>/smaps_rollup` reports **PSS** (proportional set size), which divides each shared page among the processes sharing it and gives a fairer total.

## Swapping

When physical memory runs low, the kernel has to free frames. How it does so depends on what the page contains:

- **File-backed pages** that haven't been modified, such as program code and cached file data, can simply be dropped. If they are needed again, they are read back from the file.
- **Anonymous pages**, such as the heap and stack, have no file behind them. If swap space is configured, the kernel writes them to swap, marks their page table entries as not present, and reuses the frames. A later access triggers a major fault that reads the page back in.

Swapping works well for idle memory, but badly when a program's **working set** (the memory it actively uses) doesn't fit in RAM. Pages are evicted and needed again immediately, over and over. This is **thrashing**, and the system feels frozen while processes wait on the disk.

`vmstat` shows swap activity:

```bash
vmstat 1
```

The `si` and `so` columns show pages swapped in and out per second. Occasional small values are normal. Sustained non-zero values, especially in both columns at once, mean the system is short of memory.

For latency-sensitive services, swap is a trade-off: Java's GC walks the heap and pulls swapped pages back in, so many teams run servers with little or no swap, or lower `vm.swappiness`.

## Copy-on-Write and fork

On Unix systems, new processes are created with `fork`, which creates a copy of the calling process. Copying the full memory of a 10 GB process would be very slow, so the kernel uses **copy-on-write (COW)** instead:

1. The kernel copies the parent's page tables, not its memory. Both processes now point to the same physical frames.
2. Every shared page is marked read-only in both processes.
3. As long as both processes only read, they keep sharing the same frames.
4. When either process writes to a shared page, the CPU raises a page fault for the write to a read-only page.
5. The kernel recognises a copy-on-write page, copies just that page for the writing process, marks the copy writable, and resumes the write.

```text
After fork:                         After the child writes to page B:

Parent  --> [A] [B] [C]             Parent  --> [A] [B] [C]
              ^   ^   ^                           ^       ^
Child   ------+---+---+             Child   ------+  [B'] +
  (all pages shared, read-only)       (B' is the child's private copy)
```

The cost of `fork` is therefore proportional to how much memory is modified afterwards, not to the size of the process. Most forks are followed immediately by `exec`, which replaces the process with a new program, so very little is ever copied.

Redis relies on this for snapshots: it forks, and the child writes memory exactly as it was at the fork while the parent keeps serving requests. Every page the parent modifies meanwhile is copied, so a busy instance can need noticeably more memory while saving. This is also why the Redis documentation recommends setting `vm.overcommit_memory = 1`, covered below.

## mmap and Memory-Mapped Files

`mmap` is the system call that creates mappings in a process's address space. It is used in two quite different ways:

- **Anonymous mappings** provide plain memory. This is how `malloc` obtains large allocations, and how the JVM reserves its heap.
- **File mappings** make a file's contents appear directly in memory. Reading from the mapped address reads the file. Writing to it (in a shared mapping) writes the file, without any `read` or `write` calls.

### How File Mappings Work

File mappings are built on demand paging. When a process touches a page of a mapped file, a page fault occurs and the kernel fills the page from the **page cache**, the kernel's in-memory cache of file data. If the data is already cached, it is a minor fault, and the process's page table simply points at the page cache's frame with no copying. When the process writes, the page is marked dirty and the kernel writes it back to the file later.

That's the main advantage: `read` copies data from the page cache into a buffer, while `mmap` uses the page cache directly. Processes mapping the same file share physical pages, which is how one copy of libc serves hundreds of processes.

### Databases and mmap

Databases are divided on `mmap`. Some map their data files and let the operating system cache them. Others manage their own **buffer pool** to control which pages stay in memory, when dirty pages are flushed (important for write-ahead logging and crash safety), and how I/O errors are handled, since with `mmap` a disk read hides inside a page fault.

### Memory-Mapped Files in Java

Java exposes memory-mapped files through `FileChannel.map`:

```java
import java.io.IOException;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public class MapFile {
    public static void main(String[] args) throws IOException {
        Path path = Path.of("data.bin");
        long size = 64L * 1024 * 1024; // 64 MiB

        try (FileChannel ch = FileChannel.open(path,
                StandardOpenOption.CREATE,
                StandardOpenOption.READ,
                StandardOpenOption.WRITE)) {

            MappedByteBuffer buf = ch.map(FileChannel.MapMode.READ_WRITE, 0, size);

            // Write one byte into every 4 KiB page.
            // Each first touch is a page fault that brings the page in.
            for (int pos = 0; pos < size; pos += 4096) {
                buf.put(pos, (byte) 1);
            }

            buf.force(); // ask the OS to flush dirty pages to the file
        }
    }
}
```

Mapping a file in `READ_WRITE` mode beyond its current end grows it to the requested size. There are no `write` calls, yet the file ends up containing data. The loop touches one byte per page, and each first touch is what causes the kernel to provide that page.

There are a few Java-specific limitations to be aware of:

- A `MappedByteBuffer` is indexed by `int`, so a single mapping is limited to about 2 GB. Large files are usually mapped in chunks.
- A mapping stays in place until the buffer is garbage collected, and there is no supported way to unmap it earlier.
- The **Foreign Function and Memory API** (final since Java 22) addresses both: `FileChannel.map` can return a `MemorySegment` tied to an `Arena`, which can be much larger and is unmapped when the arena is closed.

## Overcommit and the OOM Killer

Because memory is allocated lazily, the kernel can promise more memory than it actually has. This is called **overcommit**. By default, Linux lets processes allocate more memory in total than RAM plus swap, on the assumption that much of it will never be touched. Usually that assumption holds, because programs tend to reserve far more than they use.

### Overcommit Policies

The policy is controlled by `/proc/sys/vm/overcommit_memory`:

```bash
cat /proc/sys/vm/overcommit_memory
```

| Value | Policy | Behaviour |
|---|---|---|
| `0` | Heuristic (default) | Refuses obviously excessive allocations, allows most others |
| `1` | Always overcommit | Never refuses an allocation |
| `2` | Strict accounting | Refuses allocations beyond a limit based on swap plus a percentage of RAM (`overcommit_ratio`), so `malloc` can fail |

This is where the Redis recommendation comes from. After a fork, the child could in theory modify every page, so a cautious policy might refuse the fork even though only a fraction of pages is ever copied in practice. Setting the value to `1` avoids that.

### The OOM Killer

If processes actually touch more memory than the system has, the kernel cannot take back memory it already promised, and it cannot make a page fault fail gracefully. Instead, it selects a process and kills it. This is the **OOM killer** (out-of-memory killer).

The choice is based on a score, driven mainly by how much memory each process uses, and adjustable per process through `/proc/<pid>/oom_score_adj`, from -1000 (never kill) to 1000 (kill first). Evidence appears in the kernel log:

```bash
dmesg -T | grep -i -E "killed process|out of memory"
```

### Containers and cgroups

Containers add another layer. A container's memory limit is enforced by **cgroups**, and when a container exceeds its limit, the OOM killer runs within that cgroup, even if the host has plenty of free memory. In Kubernetes this appears as the `OOMKilled` status with exit code 137 (128 plus signal 9, SIGKILL). The limit counts RSS and, depending on the setup, page cache as well, which is why it matters so much for Java applications.

## Huge Pages

With 4 KiB pages, a TLB of, say, 64 entries covers only 256 KiB, so a JVM with a 32 GB heap misses constantly.

**Huge pages** address this. x86-64 supports 2 MiB and 1 GiB pages. With 2 MiB pages, the same 64 entries cover 128 MiB. The page table walk is also one level shorter, because the offset now takes 21 bits. For memory-intensive workloads, this can be a significant improvement.

Linux offers two ways to use them:

- **Explicit huge pages** (hugetlbfs) are reserved in advance by an administrator and requested explicitly by applications. They are predictable, but more work to configure, and the reserved memory cannot be used for anything else.
- **Transparent huge pages (THP)** let the kernel use 2 MiB pages automatically where possible, and split them back into normal pages when needed.

The current THP mode can be checked with:

```bash
cat /sys/kernel/mm/transparent_hugepage/enabled
```

It prints something like `always [madvise] never`, with the active mode in brackets. In `madvise` mode, only memory regions that request huge pages through the `madvise` system call get them.

THP has a mixed reputation. Building a 2 MiB page requires 2 MiB of contiguous physical memory, and on a fragmented system the kernel may stall to compact memory, which appears as unpredictable latency spikes. Some databases, including Redis, have historically recommended disabling THP or using `madvise` mode.

The JVM supports both approaches:

- `-XX:+UseTransparentHugePages` requests THP for the heap through `madvise`.
- `-XX:+UseLargePages` uses explicit huge pages.

The best choice depends on the workload, so it should be measured before and after.

## What This Means for Java

### The Heap Is Reserved First, Used Later

When the JVM starts, it reserves virtual address space for the maximum heap (`-Xmx`). It then commits memory as needed, and pages only become resident when they are touched. Shortly after startup, a JVM running with `-Xmx8g` can show a VIRT above 8 GB and an RSS of a few hundred MB.

As the application runs, the garbage collector cycles through more of the heap and RSS grows. Many collectors are slow to return memory to the operating system. Some, including G1 and Shenandoah, can uncommit unused heap over time, but RSS often stays close to its high-water mark. This is normal behaviour, not a leak.

`-XX:+AlwaysPreTouch` touches every heap page at startup. Startup is slower, but early requests skip the page faults and a memory shortage shows up immediately.

### RSS Is More Than the Heap

A common surprise in containers: with `-Xmx` set to 4 GB and a container limit of 4 GB, the container is OOM-killed. The reason is that the heap is only one part of the JVM's memory. The process also uses:

- **Metaspace**, for class metadata.
- The **code cache**, for machine code produced by the JIT.
- **Thread stacks**. Each thread reserves a stack, about 1 MiB by default on 64-bit Linux, although only touched pages become resident.
- **GC data structures**.
- **Direct buffers** and **memory-mapped files**.
- **Native memory** used by libraries.

The JVM reports most of this through **Native Memory Tracking**:

```bash
java -XX:NativeMemoryTracking=summary -jar app.jar
jcmd <pid> VM.native_memory summary
```

The output breaks memory down by category, each with **reserved** and **committed** values. It's the same distinction seen throughout this article: reserved is virtual address space, and committed is memory the JVM has asked the operating system to back.

In containers, leave headroom. Many teams use `-XX:MaxRAMPercentage` (default 25% of the detected limit) instead of a fixed `-Xmx`.

### Off-Heap Memory and Direct Buffers

`ByteBuffer.allocateDirect` allocates memory outside the Java heap. It is useful for I/O, because the operating system can read into it without an extra copy, which is why frameworks such as Netty use it heavily.

```java
ByteBuffer direct = ByteBuffer.allocateDirect(256 * 1024 * 1024); // 256 MiB off-heap
```

Direct memory doesn't show up in heap graphs, which can look stable while RSS rises. Direct buffers are limited by `-XX:MaxDirectMemorySize` (which by default follows the maximum heap size) and are freed when the buffer object is garbage collected. If the heap is quiet and collections are rare, that can take a long time.

Memory-mapped files are another form of off-heap memory. Their pages count towards RSS, but clean ones can be dropped under pressure and reread, so large mappings can make RSS look alarming even when much of it is reclaimable.

### Observing Memory from Java

The following Linux-only program reads its own virtual size and RSS from `/proc/self/status` and shows demand paging in action with a direct buffer and some heap arrays:

```java
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;

public class MemPeek {

    static void print(String label) throws IOException {
        String vm = Files.readAllLines(Path.of("/proc/self/status")).stream()
                .filter(l -> l.startsWith("VmSize") || l.startsWith("VmRSS"))
                .map(l -> l.replaceAll("\\s+", " "))
                .reduce((a, b) -> a + " | " + b)
                .orElse("n/a");
        System.out.println(label + ": " + vm);
    }

    public static void main(String[] args) throws IOException {
        print("start");

        // Java zeroes direct buffers on allocation, so these pages get touched.
        ByteBuffer buf = ByteBuffer.allocateDirect(512 * 1024 * 1024);
        print("after 512 MiB direct buffer");

        // Touch a few big arrays on the heap to grow RSS there too.
        byte[][] chunks = new byte[8][];
        for (int i = 0; i < chunks.length; i++) {
            chunks[i] = new byte[32 * 1024 * 1024];
            for (int j = 0; j < chunks[i].length; j += 4096) {
                chunks[i][j] = 1;
            }
        }
        print("after touching 256 MiB of heap arrays");
    }
}
```

When run with `java -Xmx2g MemPeek` on Linux, `VmSize` starts large (the reserved heap and other reservations) while `VmRSS` is modest. Allocating the direct buffer should raise RSS by roughly 512 MiB, because zeroing it touches every page, and touching the heap arrays raises it again. The exact numbers depend on the JVM version and flags.

## Common Mistakes

- **Worrying about VIRT**: a large virtual size is normal, especially for the JVM. Look at RSS instead.
- **Assuming the heap is the whole process**: container limits apply to everything, including metaspace, thread stacks, direct buffers, and mapped files. Leave headroom above `-Xmx`, or use `MaxRAMPercentage`.
- **Adding up RSS across processes**: shared pages are counted repeatedly. Use PSS for an accurate total.
- **Treating free memory as the goal**: Linux uses otherwise idle RAM for the page cache, so `free` often shows little free memory on a healthy system. The **available** column is the meaningful one.
- **Letting a Java service swap**: the garbage collector pulls swapped pages back in, and the resulting page faults show up directly in tail latency.
- **Changing huge page settings without measuring** the specific workload.
- **Ignoring first-touch costs**: benchmarks without a warm-up phase measure page faults along with everything else.
- **Not knowing the overcommit policy**: with `overcommit_memory` set to 2, allocations can fail outright; with 0 or 1, they succeed and the OOM killer may step in later. Either is fine, as long as the behaviour is expected.

## Cheat Sheet

| Term | What it is | Where to look |
|---|---|---|
| Virtual address | The address a program uses | `/proc/<pid>/maps` |
| Page / frame | Fixed-size block of virtual / physical memory | `getconf PAGESIZE` |
| Page table | Per-process mapping of pages to frames | Managed by the kernel |
| MMU | CPU unit that translates addresses | Hardware |
| TLB | Cache of recent translations | `perf stat` TLB events |
| Minor fault | Page is in RAM and only needs mapping | `/usr/bin/time -v` |
| Major fault | Page must be read from disk | `/usr/bin/time -v`, `vmstat` |
| VIRT / VmSize | Total mapped address space | `top`, `/proc/<pid>/status` |
| RSS / VmRSS | Memory actually resident in RAM | `top`, `/proc/<pid>/status` |
| PSS | RSS with shared pages divided fairly | `/proc/<pid>/smaps_rollup` |
| Swap activity | Pages moving to and from disk | `vmstat 1` (`si`, `so`) |
| Overcommit | Promising more memory than exists | `/proc/sys/vm/overcommit_memory` |
| OOM killer | Kernel kills a process to free memory | `dmesg -T` |
| THP | Automatic 2 MiB pages | `/sys/kernel/mm/transparent_hugepage/enabled` |
| JVM native memory | Heap plus all other JVM memory | `jcmd <pid> VM.native_memory summary` |
| Per-mapping detail | Memory per region of a process | `pmap -x <pid>` |

## Conclusion

Virtual memory gives every process its own private address space and translates it to physical memory one page at a time. Multi-level page tables keep that mapping compact, the MMU performs the translation on every access, and the TLB makes it fast. A handful of bits in each page table entry make the rest possible: demand paging allocates memory only when it's touched, swapping moves idle pages to disk, copy-on-write makes `fork` cheap, and `mmap` turns files into memory backed by the page cache.

The same mechanisms explain what Java developers see in production: a virtual size made mostly of reservations, an RSS far bigger than the heap, OOM kills inside containers, and page faults showing up as latency.
