---
title: Shenandoah GC - The Quiet Revolution in Low-Latency Java
date: 2026-10-24
summary: A deep dive into how Shenandoah achieves near-constant low pause times through concurrent marking, evacuation, and reference updating.
tag: Java
draft: false
related: types-of-garbage-collectors-in-java,want-a-faster-java-program-meet-epsilon-gc-and-its-dangerous-tradeoffs
---

Imagine a city that never stops moving. Cars flow, people walk, deliveries arrive, and yet the streets are regularly swept clean of debris without ever freezing traffic. That is the ambition behind Shenandoah, the low-pause garbage collector developed for OpenJDK. Instead of pausing the entire application while it reclaims unused memory, Shenandoah performs the bulk of its work alongside the running program. The result is pause times that remain small and largely independent of how large the heap has grown—whether two gigabytes or two hundred.

The collector was originally developed at Red Hat and contributed to OpenJDK, becoming a production option starting with JDK 12. Its design goal was deliberately ambitious: pause times under ten milliseconds even on heaps larger than 100 GB, with the longer-term hope of approaching pause-less collection. In practice it routinely delivers pauses in the low single-digit milliseconds, often sub-millisecond when the root set is modest. The root set is simply the collection of starting points from which the program can reach live objects—local variables on thread stacks, static fields, JNI handles, and references embedded in compiled code. The key insight is that the expensive operations—finding live objects, moving them, and repairing the pointers that refer to them—can be performed concurrently if the collector maintains a carefully controlled set of invariants through barriers and metadata. Barriers are small pieces of code the JVM inserts around reads and writes so that the collector can intercept those operations and keep its view of the heap consistent while the application continues to run.

### How the Heap Is Organized

Shenandoah divides the heap into fixed-size regions, similar in spirit to G1. The classic non-generational mode treats every region equally; there is no permanent young-generation versus old-generation split (a generational collector separates short-lived objects from long-lived ones so that the short-lived ones can be reclaimed more cheaply). A global connection matrix records which regions contain references to which other regions. Think of it as a simple two-dimensional table: if any object in region N points to an object in region M, the cell at row N, column M is marked. This structure is lighter than G1’s remembered sets (dense data structures that track every cross-region pointer) and avoids some of the false-sharing and maintenance costs associated with card tables (arrays of cards that record which regions of memory have been written to). When the collector decides to reclaim a region, it can consult the matrix to know which other regions must be examined for outgoing references, without needing dense per-region metadata for every possible cross-region pointer.

A small illustration of regions and the connection matrix:

```
Heap Regions                  Connection Matrix
+-----+-----+-----+           From\to  R0  R1  R2
| R0  | R1  | R2  |           R0        .   X   .
|     |     |     |           R1        .   .   X
+-----+-----+-----+           R2        .   .   .
| R3  | R4  | R5  |
|     |     |     |           X = at least one reference
+-----+-----+-----+               from row region to column region
```

More recent OpenJDK releases (notably from JDK 25 onward) introduced a production-ready generational mode. In this mode the heap is partitioned into young and old generations. Most short-lived objects are reclaimed in frequent, inexpensive young-generation cycles, while the old generation is collected in concurrent increments. The generational approach reduces both the amount of live data that must be traced on every cycle and the CPU cost of concurrent work, bringing Shenandoah closer to G1 in throughput while retaining its low-pause character. The foundational concurrent techniques remain the same.

### The Collection Cycle

A typical cycle consists of a small number of short stop-the-world pauses interleaved with longer concurrent phases. A stop-the-world pause is a brief moment when all application threads are halted so the collector can perform a coordinated action safely. The pauses exist mainly to establish a consistent view of the root set and to coordinate the transition between phases; their duration is dominated by the size of the root set rather than by the size of the heap.

High-level flow of a cycle:

```
[Init Mark STW] → Concurrent Mark → [Final Mark STW]
       ↓
 Concurrent Cleanup (empty regions)
       ↓
 Concurrent Evacuation (copy live objects)
       ↓
[Init Update Refs STW] → Concurrent Update References
       ↓
[Final Update Refs STW] → Concurrent Cleanup (reclaim)
```

The cycle begins with **Init Mark**, a brief pause that prepares the heap and application threads for concurrent marking and scans the root set. Once the roots are known, **concurrent marking** walks the object graph while the program continues to allocate and mutate objects. Shenandoah uses Snapshot-At-The-Beginning (SATB) marking, the same approach employed by G1 and the earlier Concurrent Mark Sweep collector. SATB means the collector marks objects based on the state of the object graph at the moment the cycle began. Write barriers intercept stores and ensure that any object that was reachable at the start of the cycle remains reachable for marking purposes, even if the application later overwrites the reference that pointed to it. Heap occupancy can rise during this phase because allocation continues.

When marking finishes, **Final Mark** is another short pause. It drains any remaining marking queues, re-scans the roots, selects the collection set (the regions that contain the most garbage and will therefore be evacuated), and may pre-evacuate some roots. Evacuation simply means copying the live objects out of a region so that the region can later be reclaimed entirely. Empty regions discovered after marking can already be reclaimed in a concurrent cleanup step. The selection of the collection set follows a “garbage-first” heuristic: regions with the highest proportion of garbage are preferred because they yield the most free space for the least copying work. A heuristic, in this context, is simply the set of rules the collector uses to decide when and what to collect.

The distinctive phase is **concurrent evacuation**. Live objects in the collection set are copied to new regions while application threads keep running. To make this safe, every object carries a forwarding pointer (also called a Brooks pointer)—an extra word of metadata, typically placed in the object header. When an object is relocated, the original location is overwritten with a pointer to the new copy. Any thread that still holds a reference to the old address simply follows the forwarding pointer and finds the current object. Read barriers ensure that loads always see the most recent copy; write and compare-and-swap barriers maintain consistency when the application mutates an object that may be in the process of being moved. The extra word and the barrier checks are the price paid for the ability to evacuate concurrently. Because the original object location now holds only the forwarding pointer, the collector can later treat the evacuated region as empty once all references have been updated.

Forwarding pointer in action:

```
Before move:                  After move:
+----------------+            +----------------+
| Object A       |            | Forwarding ptr |----→ +----------------+
| data ...       |            | (points to new)|     | Object A'      |
+----------------+            +----------------+     | data ...       |
                                                     +----------------+
Any old reference follows the pointer to reach A'
```

### Visualizing Read and Write Barriers

Barriers are the mechanism that lets the application and the collector share the heap safely. They are not full stops; they are tiny checks inserted by the compiler around ordinary loads and stores.

**Read barrier.**  
Whenever the application loads a reference (for example, reading a field that points to another object), the barrier first checks whether the object at that address has already been moved. If a forwarding pointer is present, the barrier follows it and returns the new address instead. From the application’s point of view the load simply succeeds; the extra step is invisible.

```
Application code:  obj = field;          // ordinary load

What the barrier does:
1. Load the raw address stored in 'field'
2. If that address holds a forwarding pointer:
      follow it to the real object
3. Return the (possibly updated) address to the application

Visual:
field holds 0x1000  →  [at 0x1000: forwarding ptr → 0x2000]
barrier returns 0x2000 so the application sees the current copy
```

**Write barrier.**  
A write barrier intercepts stores. Its job depends on the phase. During concurrent marking (SATB) it records the old value of a reference so the collector does not lose track of an object that was live at the start of the cycle. During concurrent evacuation it ensures that a store to an object that is being moved is applied to the correct (new) copy, and that the forwarding pointer remains consistent.

```
Application code:  field = newObj;       // ordinary store

During concurrent marking (SATB):
1. Read the old value of 'field'
2. If the old value is not yet marked, enqueue it for marking
3. Perform the store

During concurrent evacuation:
1. Resolve both the target object and the new value through any forwarding pointers
2. Perform the store on the current (real) copy
3. Keep the forwarding pointer intact so other threads still find the object

Visual (evacuation case):
Thread wants to write into Object A
Object A has already been copied to A'
Barrier:  write is directed to A'  (not the old location)
          old location still holds the forwarding pointer
```

Together these barriers maintain the illusion that objects never move from the application’s perspective, even while the collector is actively relocating them.

After evacuation completes, a very short **Init Update Refs** pause ensures the copy phase has finished and prepares the heap for reference updating. **Concurrent update references** then scans the heap linearly and rewrites every pointer that still points at a moved object so that it points directly at the new location. This phase’s cost depends on the number of objects in the heap rather than on the shape of the object graph. A final short pause, **Final Update Refs**, re-updates the root set itself and marks the evacuated regions as free of live references. A last concurrent cleanup reclaims those regions, and the cycle ends.

Throughout the cycle the only times the application is fully stopped are the four coordination points that scan or update roots. Everything else—marking, copying, and pointer repair—happens in parallel with the program.

### Barriers, Overhead, and Failure Modes

The barriers that make concurrent evacuation possible are not free. Every reference load and store may incur a small check, and the forwarding pointer increases the size of every object, which can raise allocation rates and cache pressure. In well-tuned deployments the throughput loss relative to G1 is often in the 5–15 % range; the exact cost depends on the allocation rate, the mutation rate, and how much idle CPU is available for concurrent GC threads. On machines with spare cores the concurrent work can sometimes be almost “free” from the application’s perspective.

If the application allocates faster than the collector can reclaim space, free regions are exhausted and an allocation failure occurs. Shenandoah’s first response is a **degenerated GC**: it finishes the current cycle in stop-the-world mode instead of continuing concurrently. Degenerated pauses are typically still short (tens of milliseconds). Only if that is insufficient does the collector fall back to a full stop-the-world collection. Both outcomes are visible in GC logs and are usually signs that the heap needs more headroom, the allocation rate needs to be reduced, or the heuristics need adjustment.

### Enabling and Tuning

Shenandoah is enabled with the single flag `-XX:+UseShenandoahGC`. Several practical settings improve stability:

- Set `-Xms` equal to `-Xmx` so the heap does not resize at runtime, and combine this with `-XX:+AlwaysPreTouch` to commit and touch all pages at startup. This eliminates latency spikes caused by page faults or OS memory management.
- Control cycle initiation with `-XX:ShenandoahGCHeuristics`. The default `adaptive` heuristic observes past cycles and tries to finish before free space is exhausted. `static` triggers at a fixed occupancy threshold. `compact` runs cycles back-to-back when rapid reclamation matters more than CPU cost. `aggressive` (diagnostic) evacuates essentially everything.
- Adjust `-XX:ConcGCThreads` to balance concurrent GC progress against application throughput.
- For generational mode (where available), additional flags control the young-generation size and the interleaving of young and old work.

Logging with `-Xlog:gc*` (or more specific tags such as `gc+ergo` and `gc+stats`) shows the familiar phase timings and makes it easy to see whether concurrent phases are keeping up with allocation. On large heaps, transparent huge pages or explicit large pages can further reduce pressure on the TLB (the Translation Lookaside Buffer, a small hardware cache that stores recent virtual-to-physical address translations).

### Comparisons and When to Choose It

Compared with G1, Shenandoah removes the evacuation pause that still appears in G1’s mixed collections; the only pauses that remain are the root-set operations. Compared with ZGC, Shenandoah supports compressed ordinary object pointers (compressed oops)—a technique that stores object references in 32 bits instead of 64 bits on heaps up to roughly 32 GB, saving memory and improving cache behavior. This can make Shenandoah more memory-efficient on heaps that fit within the compressed-oops range. ZGC often delivers still lower pauses on multi-terabyte heaps but historically required more memory overhead and, until generational mode became standard, scanned more of the heap on every cycle. Generational modes in both collectors have narrowed the historical gaps in throughput and heap overhead.

Shenandoah tends to be a strong fit for latency-sensitive services running on medium-to-large heaps (roughly 8–64 GB) where consistent response times matter more than absolute peak throughput, and where an OpenJDK build is already in use. It is less ideal for pure throughput-oriented batch workloads or for extremely memory-constrained environments that cannot afford the extra object header word and barrier overhead. As with any concurrent collector, success depends on giving it enough heap headroom to absorb allocations while the concurrent phases run.

In short, Shenandoah treats garbage collection as a continuous background process rather than a periodic interruption. By moving objects while the program runs and repairing references afterward, it keeps the city moving. For services that measure success in consistent response times rather than peak throughput, that quiet, concurrent style of reclamation is often exactly what is required.
