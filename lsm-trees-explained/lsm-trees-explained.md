---
title: LSM Trees Explained - Memtables, SSTables, Bloom Filters, Compaction and Storage Trade-Offs
date: 2026-11-08
summary: A detailed guide to LSM trees covering write-ahead logging, memtables, SSTables, reads, Bloom filters, compaction, tombstones, snapshots, amplification, real systems, and a Java implementation.
tag: lsm-tree, storage-engines, databases, rocksdb, cassandra, sstable, compaction, data-structures, java
draft: false
related: b-trees-explained,wal-databases,how-inverted-indexes-work,database-internals
---

A **log-structured merge tree**, or **LSM tree**, is a storage structure that accumulates writes in memory and periodically merges them into sorted files. Instead of repeatedly modifying individual disk pages, it turns many small updates into larger sequential transfers. Reads reconstruct the latest visible value from the memory structures and files that may contain it.

Patrick O'Neil, Edward Cheng, Dieter Gawlick, and Elizabeth O'Neil described the LSM tree in a 1996 paper. The design addressed the cost of maintaining indexes under heavy insertion workloads. Google's Bigtable paper in 2006 described a distributed storage system using memory buffers and immutable SSTables. LevelDB later packaged a related storage design into an embedded library, and RocksDB extended that lineage for demanding storage workloads. Cassandra also adopted a log-structured storage approach, with its own data model, reconciliation rules, and compaction strategies.

These systems share a pattern rather than one identical algorithm. This article explains that pattern, how its components fit together, and what it costs. The focus is the storage engine itself, complementing the mechanics of B-trees, the recovery role of write-ahead logs, and the term-to-document mapping of inverted indexes.

## Why Random Writes Hurt

An in-place B-tree update locates a leaf page, changes its cached contents, and eventually writes the dirty page back. If updates are spread across a large key space, many different pages become dirty. Once the working set exceeds memory, updates can require reading pages before changing them.

On a hard disk, random access incurs mechanical positioning. SSDs remove that mechanical cost, but small scattered writes still interact with page and erase-block granularity, device garbage collection, and filesystem overhead. A small logical update can cause substantially more physical work than its payload size suggests.

An LSM engine changes the write organization:

```
In-place tree:  update -> locate page -> modify -> persist dirty page

LSM engine:    update -> append log + update RAM
                                  |
                                  v
                         sorted sequential flush
                                  |
                                  v
                           background merges
```

The work is deferred and grouped, not eliminated. Compaction may rewrite the same data repeatedly. An LSM engine is sustainable only when its background work can keep up with incoming writes over time.

## The Main Components

| Component | Purpose |
|---|---|
| **Write-ahead log (WAL)** | Recover acknowledged updates not yet safely represented in tables |
| **Active memtable** | Mutable ordered collection receiving new writes |
| **Immutable memtable** | Frozen buffer awaiting or undergoing a flush |
| **SSTable** | Immutable file of sorted key-value entries |
| **Manifest or version metadata** | Records which table files belong to the current database view |
| **Bloom filter** | Rejects files that definitely lack a lookup key |
| **Block cache** | Retains frequently accessed table blocks in memory |
| **Compaction** | Merges sorted runs and discards versions no longer needed |

A **sorted run** is a key-ordered sequence. It can be one file or several range-partitioned files. Distinguishing runs from files matters: ten files forming one non-overlapping run need different read logic from ten overlapping runs.

## The Write Path

### WAL and Memtable

A write normally becomes a log record and an update to the active memtable. Engines assign ordering metadata, such as a **sequence number**, so a newer value can be distinguished from older copies of the same key.

The log is appended sequentially. Its durability policy determines when a write can be acknowledged: synchronous modes wait for the required persistence operation, while asynchronous modes can acknowledge before the latest log bytes are durable. Grouping several writes can amortize synchronization costs.

The memtable maintains key order. A **skip list** is a common implementation because it supports ordered insertion, lookup, and traversal with expected logarithmic search cost. Different engines also offer other structures. The name LSM tree does not require every in-memory component to be a literal tree.

A logical deletion inserts a deletion marker instead of immediately erasing every older copy. An overwrite similarly adds a newer version; files already on disk remain unchanged.

### Freezing and Flushing

When the active memtable reaches a threshold, it becomes immutable and a new active memtable accepts writes. A background worker writes the frozen contents into an SSTable:

```
Writes -> Active memtable
               |
          reaches threshold
               v
        Immutable memtable -----> SSTable in L0
               |
        New active memtable receives later writes
```

The immutable memtable remains readable until its replacement is safely published. Merely creating a file is insufficient: readers need a consistent view of the file set, and recovery needs durable metadata identifying valid output.

Once flushed data and its metadata meet the engine's recovery requirements, the corresponding WAL data can be retired. If flush workers fall behind, immutable buffers accumulate. A bounded engine eventually slows or stops foreground writes rather than consuming unlimited memory.

### Recovery and File Publication

A crash can occur while an output table is only partially written. Recovery must distinguish a complete, published table from an abandoned temporary file. A common design writes the output, makes the necessary file contents durable, and then records a version edit identifying the new live file set. Directory and metadata persistence requirements depend on the filesystem and implementation.

The manifest is not simply a list of every file in the directory. It identifies a consistent database version. Files absent from that version can be obsolete inputs or incomplete outputs, and should not automatically become searchable after restart.

Recovery opens the valid table set and replays eligible WAL records to reconstruct unflushed state. WAL records need framing and integrity checks so a torn tail is not interpreted as a complete update. Batch boundaries also matter: an atomic write batch must not become half visible during recovery.

This separates three events that applications sometimes conflate: an update being accepted into memory, its log becoming durable, and its table file replacing the need for that log. Each has a different role in the storage lifecycle.

## Inside an SSTable

An **SSTable**, short for sorted string table, stores entries in key order. A simplified block-based layout is:

```
+--------------------------+
| Data block: keys a..f     |
| Data block: keys g..m     |
| Data block: keys n..z     |
+--------------------------+
| Filter / other metadata  |
| Index block              |
| Footer                   |
+--------------------------+
```

- **Data blocks** contain sorted entries, often with prefix compression and optional block compression.
- An **index block** maps separators or boundary keys to data-block locations.
- **Metadata** can describe filters, properties, compression, or other format-specific structures.
- A fixed-location **footer** identifies how to locate the relevant indexes and format metadata.

The exact layout is codec-specific. Multi-level indexes and partitioned filters help when a single index or filter would become too large. Checksums detect damaged blocks; they do not replace replication or a recovery plan.

A lookup need not scan the table. It uses file key bounds, a filter, and the block index to identify a small region. Sorted order also supports seeking to a key and then reading forward for a range scan.

## The Read Path

A point lookup asks which visible version of a key is newest. In a LevelDB-style engine, it typically checks:

1. The active memtable.
2. Immutable memtables, from newer to older.
3. Relevant overlapping files in **level zero**, often newest first.
4. Candidate files in lower levels.

With leveled compaction, files within a nonzero level have non-overlapping key ranges, so at most one file in that level can contain a given user key under the usual layout. Level zero is different: separately flushed files may overlap arbitrarily.

```
get("pear")
   |
   +-> active RAM             absent
   +-> immutable RAM          absent
   +-> L0 newest file         filter says no
   +-> L0 older file          filter says maybe -> inspect
   +-> lower levels           continue if needed
```

A tombstone found at the newest relevant version means absent, not permission to return an older value. Snapshot reads also apply a visibility boundary and may need an older version instead of the latest one.

The newest-first rule describes simple sequence-ordered engines. Cassandra reconciles cells using timestamps and additional data-model rules, so its reads cannot be reduced to taking the first file hit. The shared principle is to combine all information required by the engine's visibility semantics.

## Bloom Filters

### Definitely Absent, Possibly Present

A **Bloom filter** is a compact probabilistic membership structure. It stores a bit array and derives several bit positions from each key. Inserting a key sets those bits; querying checks the same positions.

- If any required bit is zero, the key is definitely absent.
- If every required bit is one, the key might be present.

Other keys can set the same bits, producing a **false positive**. A correctly constructed filter has no false negatives for the keys it contains. The engine must use the same key representation and hashing on insertion and lookup.

A positive answer never substitutes for reading the actual record. A negative answer can avoid an expensive block read. Filters are particularly useful for absent-key queries and keys appearing in only a small fraction of the candidate runs.

### Simple False-Positive Math

Let `m` be the number of bits, `n` the number of inserted keys, and `k` the number of hash probes. Under standard independent, uniform hashing assumptions:

```
Probability a bit remains zero ≈ exp(-k * n / m)
False-positive probability     ≈ (1 - exp(-k * n / m)) ^ k
Good probe count               ≈ (m / n) * ln(2)
```

With ten bits per key and seven probes, the estimated false-positive probability is about `0.0082`, or `0.82%`. These are mathematical estimates for that configuration, not observed performance figures. Doubling the number of stored keys without increasing the bit array makes the filter less selective.

If a missing key faces ten candidate files, each with a 1% false-positive rate, the expected number of unnecessary positive filter answers is `10 * 0.01 = 0.1`. That expectation does not mean every query performs a tenth of a read: individual queries may perform none or several.

Filter memory competes with the block cache and indexes. More filter bits can reduce I/O while increasing memory consumption. Allocating the same number of bits per key to every run is simple, but not always the best use of a fixed memory budget.

## Compaction Strategies

### A Worked Merge

Consider three runs, with the most recent on the left. `DEL` denotes a tombstone:

```
R3 (new): [a=7, c=DEL, e=5]
R2:       [a=4, b=2,   d=8]
R1 (old): [a=1, c=3,   f=6]
```

A sorted merge groups entries by key and retains the newest eligible version:

```
[a=7, b=2, c=DEL, d=8, e=5, f=6]
```

If this merge covers every older occurrence and no snapshot or other retention rule needs the old versions, `c=DEL` can also disappear. If an excluded older run could still contain `c=3`, the tombstone must remain or the deleted value could return.

The same key-resolution logic applies whether the policy chooses three similarly sized runs or a range of files across adjacent levels. Policy decides which runs merge; reconciliation decides what survives.

### Size-Tiered and Tiered Compaction

**Size-tiered compaction** groups similarly sized runs and merges a group when enough accumulate. New flushes form small runs; repeated merges produce larger ones. Several overlapping runs can remain searchable at once.

Broader **tiered** policies allow multiple runs at a size scale and delay consolidation. RocksDB calls its tiered-style policy **universal compaction**. Names and exact selection rules differ by product; Cassandra's size-tiered strategy and RocksDB's universal strategy are not identical implementations.

Tiering often reduces repeated rewriting into an already large destination run. Its costs include more runs to inspect, more duplicate data retained between merges, and potentially large temporary space requirements during a major merge.

### Leveled Compaction

**Leveled compaction** organizes storage into successively larger levels. Apart from level zero, each level represents a non-overlapping sorted run partitioned into files. A compaction merges selected files with overlapping ranges in the next level.

```
L0: [a..m] [f..z] [b..r]          overlapping flushes
L1: [a..f] [g..n] [o..z]          non-overlapping within level
L2: [a..c] [d..g] [h..k] ...      larger total capacity
```

A size ratio controls the relative capacities of levels. Moving data down can rewrite values already present in the destination range, increasing write amplification. In exchange, a lookup has fewer overlapping runs to consider and obsolete copies can be reclaimed more steadily.

For example, an L0 file covering `h..p` overlaps two L1 files covering `g..n` and `o..z`. A range-based leveled compaction can merge those three inputs while leaving an L1 file covering `a..f` untouched. New output files split the merged key range into manageable pieces. This limits rewriting compared with rebuilding the entire level, although overlapping destination data still contributes to amplification.

Modern engines add optimizations such as moving a non-overlapping file without rewriting its contents. Policy comparisons therefore describe tendencies, not a guaranteed winner for every workload.

## Tombstones, Snapshots, and Space Reclamation

A **tombstone** is a durable statement that an older value must no longer be returned. It must survive until removing it cannot expose an older value. Physical disk space is not necessarily reclaimed when a delete is acknowledged.

In a sequence-based engine, a snapshot captures a read sequence number. Internal entries can be ordered by user key and descending sequence number. A reader chooses the newest version at or below its snapshot boundary.

For example, a snapshot at sequence 12 must still see `x=old@10` even after `x=new@15` arrives. Compaction cannot discard the old version while that snapshot needs it. Long-lived snapshots can therefore retain history and increase space use.

Distributed engines add another constraint. Cassandra tombstones can be needed to stop an unavailable replica from later reintroducing deleted data. Safe reclamation depends on retention, repair, replication behavior, and the chosen compaction strategy. A local merge alone cannot establish every distributed safety condition.

## Write, Read, and Space Amplification

| Measure | Meaning | Typical Sources |
|---|---|---|
| **Write amplification** | Physical bytes written relative to logical input bytes | WAL, flushes, compaction, device-level rewriting |
| **Read amplification** | Extra probes or bytes required to satisfy a logical read | Multiple runs, false positives, version checks |
| **Space amplification** | Physical storage relative to retained logical data | Old versions, tombstones, spare capacity, merge outputs |

Always specify the boundary of measurement. Engine-reported write amplification may exclude the WAL or the SSD's internal work. A ratio without that definition can make two systems look comparable when they are measuring different things.

Tiered policies often favor write cost at the expense of reads and retained space. Leveled policies often favor point reads and steadier space reclamation while rewriting more data. Both need spare space because new merge output can coexist with its input files until publication and reader cleanup finish.

## Range Scans and the Block Cache

A range scan seeks into relevant memory structures and table runs, then merges their iterators. A **min-heap** can track the smallest current key from each iterator. For each key, the engine resolves versions, applies tombstones, emits the visible result, and advances the contributing iterators.

With `r` active iterators, selecting the next candidate using a heap costs O(log r), in addition to block I/O and version processing. Overlapping runs and deleted versions can make the engine read many more entries than it returns.

The **block cache** stores decoded or uncompressed table blocks, depending on the engine. Index and filter blocks may share that budget or use separate caching arrangements. The operating system can also cache file bytes, creating another memory layer.

Large scans can evict blocks useful to point lookups. Engines often offer scan-specific cache options, prefetching, and readahead. More memory is not automatically more useful if it is split poorly between memtables, filters, indexes, caches, and application data.

## A Small Java LSM Implementation

The example below uses a `TreeMap` memtable, immutable sorted files, per-file Bloom filters, newest-first lookup, tombstones, and a full compaction. Files form overlapping generations rather than a production leveled layout. The list `tables` is ordered from oldest to newest.

```java
import java.io.*;
import java.nio.file.*;
import java.util.*;

public class MiniLsm {
    record Entry(boolean deleted, String value) {}
    record Table(Path path, Bloom bloom) {}

    static class Bloom {
        private final BitSet bits = new BitSet(8192);
        private int slot(String key, int seed) {
            int h = seed;
            for (int i = 0; i < key.length(); i++) {
                h = 31 * h + key.charAt(i);
            }
            h ^= h >>> 16;
            return Math.floorMod(h, 8192);
        }
        void add(String key) {
            for (int seed : new int[]{17, 101, 1009}) bits.set(slot(key, seed));
        }
        boolean mightContain(String key) {
            for (int seed : new int[]{17, 101, 1009}) {
                if (!bits.get(slot(key, seed))) return false;
            }
            return true;
        }
    }

    private final Path directory;
    private final TreeMap<String, Entry> memtable = new TreeMap<>();
    private final List<Table> tables = new ArrayList<>();

    public MiniLsm(Path directory) throws IOException {
        this.directory = directory;
        Files.createDirectories(directory);
    }

    public void put(String key, String value) {
        memtable.put(Objects.requireNonNull(key),
                     new Entry(false, Objects.requireNonNull(value)));
    }

    public void delete(String key) {
        memtable.put(Objects.requireNonNull(key), new Entry(true, ""));
    }

    private TreeMap<String, Entry> read(Table table) throws IOException {
        TreeMap<String, Entry> entries = new TreeMap<>();
        try (DataInputStream in = new DataInputStream(
                new BufferedInputStream(Files.newInputStream(table.path())))) {
            int count = in.readInt();
            for (int i = 0; i < count; i++) {
                String key = in.readUTF();
                boolean deleted = in.readBoolean();
                entries.put(key, new Entry(deleted, in.readUTF()));
            }
        }
        return entries;
    }

    private Table write(SortedMap<String, Entry> entries) throws IOException {
        Path path = Files.createTempFile(directory, "table-", ".sst");
        Bloom bloom = new Bloom();
        try (DataOutputStream out = new DataOutputStream(
                new BufferedOutputStream(Files.newOutputStream(path)))) {
            out.writeInt(entries.size());
            for (var item : entries.entrySet()) {
                out.writeUTF(item.getKey());
                out.writeBoolean(item.getValue().deleted());
                out.writeUTF(item.getValue().value());
                bloom.add(item.getKey());
            }
        }
        return new Table(path, bloom);
    }

    public void flush() throws IOException {
        if (memtable.isEmpty()) return;
        Table table = write(memtable);
        tables.add(table);
        memtable.clear();
    }

    public Optional<String> get(String key) throws IOException {
        Entry entry = memtable.get(key);
        if (entry != null) return visible(entry);
        for (int i = tables.size() - 1; i >= 0; i--) {
            Table table = tables.get(i);
            if (!table.bloom().mightContain(key)) continue;
            entry = read(table).get(key);
            if (entry != null) return visible(entry);
        }
        return Optional.empty();
    }

    private Optional<String> visible(Entry entry) {
        return entry.deleted() ? Optional.empty() : Optional.of(entry.value());
    }

    public void compact() throws IOException {
        flush();
        if (tables.isEmpty()) return;
        TreeMap<String, Entry> merged = new TreeMap<>();
        for (Table table : tables) merged.putAll(read(table));
        merged.entrySet().removeIf(item -> item.getValue().deleted());
        Table replacement = write(merged);
        List<Table> obsolete = new ArrayList<>(tables);
        tables.clear();
        tables.add(replacement);
        for (Table table : obsolete) Files.deleteIfExists(table.path());
    }

    public static void main(String[] args) throws IOException {
        MiniLsm db = new MiniLsm(Files.createTempDirectory("mini-lsm-"));
        db.put("a", "old");
        db.put("b", "keep");
        db.flush();
        db.put("a", "new");
        db.delete("b");
        db.flush();
        db.compact();
        System.out.println(db.get("a")); // Optional[new]
        System.out.println(db.get("b")); // Optional.empty
    }
}
```

`get` checks memory before files and stops at the first entry, including a tombstone. Compaction applies tables from oldest to newest, so later values overwrite earlier ones. Because it includes every table and there are no snapshots, it can remove tombstones safely within this model.

This implementation deliberately omits a WAL, manifest, reopening, synchronization, checksums, indexed blocks, and crash-safe publication. Its files preserve data bytes, but the in-memory catalog is lost when the object is discarded. It is therefore not a recoverable database. A file lookup loads the whole file; a real SSTable uses an index to seek to a block. `writeUTF` also limits each encoded string to 65,535 bytes in Java's modified UTF-8 format.

The Bloom filter uses a fixed bit budget and simple correlated hashes. It demonstrates the rejection rule, not the quality assumed by the earlier probability model. A production implementation needs better hashing, sizing, persisted filters, and corruption handling. `ConcurrentSkipListMap` could replace the ordered map, but that alone would not make flush publication or compaction thread-safe.

## Key-Value Separation and WiscKey

Compaction becomes expensive when large values move every time their keys move. **WiscKey**, presented in 2016, separates keys from values: the LSM structure stores keys and references, while a separate value log stores the payloads.

Merging then rewrites mostly keys and references, reducing the movement of large values. The trade-off is another lookup to fetch a value, less sequential value access during range scans, and garbage collection for obsolete value-log records. Recovering consistent relationships between index references and value storage also requires careful ordering.

RocksDB's integrated **BlobDB** uses related key-value separation ideas. Separation is most attractive when values are large enough that avoiding repeated compaction outweighs the extra indirection and garbage-collection work.

## LSM Trees and B-Trees

| Concern | In-Place B-Tree | LSM Design |
|---|---|---|
| Foreground write | Modify relevant cached pages | Append log and update memory |
| Persistent organization | Mutable pages in a search tree | Immutable sorted runs |
| Point lookup | Follow an index path | Resolve candidates across memory and runs |
| Range scan | Traverse ordered leaves | Merge ordered iterators |
| Background work | Page flushing, splits, reclamation | Flushes and compaction |
| Space reclamation | Engine-specific page maintenance | Version removal during compaction |
| Main tuning tension | Cache, occupancy, update locality | Compaction capacity and amplification |

Both designs can support transactions, snapshots, compression, and ordered access. Neither architecture alone guarantees better latency or durability. Compare a complete workload, including sustained ingestion, reads during maintenance, storage headroom, and recovery behavior.

## Where LSM Engines Are Used

- **RocksDB** is an embedded key-value engine with configurable compaction and table formats.
- **Cassandra** uses commit logs, memtables, SSTables, and compaction within a distributed wide-column database.
- **ScyllaDB** uses related storage concepts with a different execution architecture and implementation.
- **HBase**, influenced by Bigtable, combines a WAL, MemStores, and HFiles in its distributed storage model.
- **MyRocks** integrates RocksDB as a MySQL storage engine; it is not the same storage path as InnoDB.
- **Kafka Streams** commonly uses RocksDB for persistent local state stores. Recovery also involves changelog topics or other configured restoration mechanisms; local files alone do not explain the full recovery model.

## Tuning Knobs and Common Mistakes

Start with measured workload characteristics: key and value sizes, overwrite rate, range-scan frequency, absent-key lookups, and required durability. Then consider:

- **Memtable budgets**: larger buffers can reduce tiny flushes, but consume memory and increase recovery work when more unflushed updates remain in the WAL.
- **Compaction concurrency and throughput**: enough background capacity is needed to prevent growing debt, but excessive workers compete with foreground reads.
- **Level sizes and file sizes**: these affect overlap, compaction granularity, and metadata overhead.
- **Filters and cache budgets**: allocate memory where it avoids the most expensive work, rather than maximizing one structure in isolation.
- **Compression**: reducing bytes can save storage bandwidth while consuming CPU. Different levels may justify different settings.
- **Write-stall thresholds**: stalls are backpressure protecting a bounded engine, not necessarily evidence of a broken write API.

Common mistakes include reporting short burst ingestion as sustainable throughput, disabling synchronous logging without accepting the durability change, filling the disk so merges cannot create output, and keeping snapshots indefinitely. Other failures come from dropping tombstones before they are safe or assuming a successful delete immediately reclaims physical storage.

## Cheat Sheet

| Term | Meaning |
|---|---|
| Memtable | Ordered mutable write buffer |
| Immutable memtable | Frozen buffer waiting for flush completion |
| SSTable | Immutable sorted table file |
| Level zero | Initial runs, often with overlapping ranges |
| Bloom filter | Definite absence or possible presence |
| Compaction | Merge runs and reconcile retained versions |
| Leveled | Non-overlapping runs within nonzero levels |
| Tiered | Multiple runs retained at a size scale |
| Tombstone | Marker suppressing older values |
| Snapshot | Stable visibility boundary |
| Write amplification | Extra physical writing per logical update |
| Read amplification | Extra work to resolve a logical read |
| Space amplification | Storage beyond retained logical data |
| Key-value separation | Keep values outside the compacted key structure |

## Conclusion

An LSM tree organizes writes around ordered memory buffers and immutable sorted runs. The WAL protects updates before their table representation is safely published. Reads combine the relevant versions, while filters, indexes, and caches reduce unnecessary access.

Compaction is the mechanism that keeps this deferred work manageable. Its policy determines how much data is rewritten, how many runs reads inspect, and how much obsolete state remains on disk. Tombstones, snapshots, and distributed repair impose limits on what can be discarded.

Understanding those trade-offs explains both the write efficiency and the operational demands of LSM engines. The useful question is whether the full storage lifecycle, including background merges and recovery, fits the application's workload and resource budget.
