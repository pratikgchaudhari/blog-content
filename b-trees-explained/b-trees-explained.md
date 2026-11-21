---
title: B-Trees Explained - Splits, Merges, B+ Trees and How Database Indexes Work
date: 2026-11-14
summary: A detailed guide to B-trees and B+ trees covering pages, search, splits, borrowing and merging, database storage layouts, tree height, LSM trade-offs, and a Java implementation.
tag: b-tree, b-plus-tree, data-structures, databases, indexing, mysql, postgresql, storage-engines, java
draft: false
related: how-database-indexes-work,database-internals,lsm-trees-explained,how-inverted-indexes-work,virtual-memory-explained
---
A **B-tree** is a balanced search tree designed to store many sorted keys in each node. Each internal node directs a search towards one of several children, and all leaves remain at the same depth. When nodes correspond to storage pages, this wide, shallow structure reduces the number of page accesses needed to find a key.

Rudolf Bayer and Edward McCreight introduced B-trees in 1970 while working at Boeing Research Laboratories. The structure became a foundation for database indexes and file-system metadata because it supports efficient lookups, ordered traversal, and incremental updates without letting the tree become unbalanced. Database engines commonly use **B+ tree** variants, with records or record references in linked leaves and routing keys in internal nodes.

MySQL's InnoDB, PostgreSQL, SQLite, Oracle, and SQL Server all use members of this family. Their implementations differ in page layouts, concurrency control, deletion policies, and where rows are stored, but the central design remains the same: place enough information in each page to eliminate most of the remaining search space.

This article covers that design, from the rules governing individual nodes to step-by-step insertion and deletion examples, database-specific layouts, and a small Java implementation. It complements a general overview of index types by focusing on how the tree itself grows, shrinks, and supports queries.

## Why Binary Search Trees Fail on Disk

A **binary search tree** stores one key per node and has at most two children. Smaller keys go left, larger keys go right. A search follows a path from the root, comparing the target with one node at each level.

A balanced binary tree with a billion keys is about 30 levels deep, since 2 to the power 30 is roughly a billion. In memory, that is a modest number of comparisons. On disk, the number of separate page accesses becomes more significant.

Each node lives somewhere in a file. Following a pointer to the next node means reading another location on disk. Thirty levels means up to thirty separate reads, and they're random reads, jumping all over the file.

Storage transfers data in blocks rather than individual key-sized fragments. A random storage access is much more expensive than a memory access. A pointer-based binary tree can therefore require a 4 KB or 8 KB read to obtain only a few dozen useful bytes, such as one key and two pointers. The rest of that transfer may contribute nothing to the current search.

B-trees address this mismatch by packing many keys into each node. A single page access can examine hundreds of separators and select a much smaller portion of the remaining key space.

## Pages and Blocks

Databases organize their main storage structures into fixed-size **pages**, the units they read, write, and cache. Database pages and virtual-memory pages serve related purposes, but need not have the same size.

Default page sizes differ by engine:

| Engine | Default Page Size | Configuration Scope |
|---|---|---|
| InnoDB | 16 KB | Set when initializing the instance |
| PostgreSQL | 8 KB | Selected at build time |
| SQLite | 4 KB | Database-level page-size setting |

These defaults are common, but page size is an engine-specific storage choice rather than a property of B-trees.

Recently used pages remain in memory, in InnoDB's **buffer pool** or PostgreSQL's **shared buffers**. A cached page needs no storage read; an uncached page must be loaded. The number of pages visited is therefore a useful cost model, while the number of cache misses determines actual storage traffic.

A disk-oriented search tree aims to visit as few pages as possible.

## What a B-Tree Looks Like

A B-tree node holds multiple keys in sorted order. An **internal node** has one more child than it has keys; a **leaf** has no children.

An internal node with three keys has four children:

```text
         [ 20 | 40 | 60 ]
        /     |    |     \
   < 20   20..40 40..60   > 60
```

The keys act as signposts. Everything in the first child is smaller than 20. Everything in the second child is between 20 and 40. And so on. A node with k keys has k + 1 children.

Three invariants define the structure:

- **Sorted keys**: each node's keys and child ranges respect the search order.
- **Equal leaf depth**: every root-to-leaf path has the same length.
- **Minimum occupancy**: non-root nodes stay at least approximately half full under the textbook rules, preventing excessive sparsity.

### Order and Minimum Degree

Terminology varies between textbooks: **order** can refer to different capacity limits. This article uses the **minimum degree**, written `t`, with the following rules:

```text
every node except the root has at least  t - 1  keys
every node has at most                   2t - 1  keys
an internal node with k keys has         k + 1  children
```

With `t = 2`, non-root nodes hold between 1 and 3 keys, and internal nodes have between 2 and 4 children. The root may be an empty leaf. This small degree keeps the diagrams readable; production pages hold many more keys.

In a database, capacity depends on page size, key size, record overhead, and any compression. Variable-length keys make a fixed key-count limit less useful: fullness is a byte-space constraint.

## Searching

**Search** generalizes the binary search tree traversal to multiple separators per node.

Starting at the root, locate either the target key or the gap containing its possible position. Sorted keys allow binary search within a node. If the key is absent from an internal node, follow the child pointer for that gap. Continue until the key is found or a leaf establishes that it is absent.

Consider a search for 35 in this tree:

```text
                [40]
              /      \
          [20]        [60]
         /    \      /    \
     [10]  [25 30 35] [50]  [70 80 90]
```

At the root, 35 is less than 40, so the search follows the left child. At [20], it follows the right child. The leaf [25 30 35] contains the key: three nodes are visited.

For 45, the path goes right from [40], then left from [60], reaching [50]. Since that leaf lacks 45, the search returns absence after three visits.

A classic B-tree search visits one node per traversed level and can finish early at an internal key. A leaf lookup visits the full height. Page visits do not necessarily imply physical reads, because upper levels are often cached.

## Insertion and Splitting

**Insertion** follows the search path to the leaf where a key belongs and inserts it in sorted order. A full node requires a **split** so that the capacity invariant is preserved.

Splitting a full node means taking its middle key, pushing it up into the parent, and dividing the rest into two half-full nodes. The parent gains one key and one child. If the parent was also full, it splits too, and the split can travel all the way up. If the root splits, a new root is created above it, and the tree gets one level taller.

A root split adds a level above the existing tree. All leaves move down together, preserving equal depth.

Two insertion styles are common. The top-down approach in *Introduction to Algorithms* (CLRS), used here, splits full nodes before descending into them. The parent then has room for a promoted separator, and insertion needs no return traversal. A bottom-up approach inserts first and propagates splits upwards on overflow. Both preserve the tree's invariants.

### Building a B-Tree Step by Step

For `t = 2`, each node holds at most three keys. Insert the following sequence:

```text
10, 20, 30, 40, 50, 60, 70, 80, 90, 25, 35
```

Insert 10, 20 and 30. The root is a leaf, and there's room for all three:

```text
[10 20 30]
```

Insert 40. Split the full root before descending. Its middle key, 20, becomes a new root, with 10 on the left and 30 on the right:

```text
      [20]
     /    \
  [10]    [30]
```

Since 40 exceeds 20, insert it into the right leaf:

```text
      [20]
     /    \
  [10]    [30 40]
```

The root split increases the tree's height by one level.

Insert 50. Root [20] has room, the right leaf [30 40] has room:

```text
      [20]
     /    \
  [10]    [30 40 50]
```

Insert 60. Split the full child [30 40 50], promoting its middle key 40 into the root:

```text
       [20 40]
      /   |   \
  [10]  [30]  [50]
```

60 is bigger than 40, so it lands in [50]:

```text
       [20 40]
      /   |   \
  [10]  [30]  [50 60]
```

Insert 70. It goes straight into the last leaf:

```text
       [20 40]
      /   |   \
  [10]  [30]  [50 60 70]
```

Insert 80. The last leaf is full, so split it. 60 goes up:

```text
        [20 40 60]
      /   |    |   \
  [10]  [30]  [50]  [70 80]
```

The root is now full, but it remains valid. The next insertion will split it before descending.

Insert 90. The root is full, so it splits first. Its middle key 40 becomes the new root. [20] and [60] become its children, each taking their share of the grandchildren:

```text
                [40]
              /      \
          [20]        [60]
         /    \      /    \
     [10]    [30]  [50]    [70 80]
```

Insert 90 by descending past 40 and 60 into [70 80]:

```text
                [40]
              /      \
          [20]        [60]
         /    \      /    \
     [10]    [30]  [50]    [70 80 90]
```

The tree now has three levels, with the additional level created at the root.

Insert 25. Down left (25 < 40), then right (25 > 20), into [30]:

```text
                [40]
              /      \
          [20]        [60]
         /    \      /    \
     [10]  [25 30]  [50]   [70 80 90]
```

Insert 35. Same path, into [25 30]:

```text
                [40]
              /      \
          [20]        [60]
         /    \      /    \
     [10]  [25 30 35] [50]  [70 80 90]
```

The result is the tree used in the search example: eleven keys, three levels, and equal leaf depth.

The ascending part of the sequence always targets the rightmost leaf. Under the textbook split policy, each split leaves a minimally occupied node behind on the left. Database engines can recognize ordered inserts and use different split policies to improve page utilization.

## Deletion: Borrowing and Merging

**Deletion** must preserve both key order and minimum occupancy. Removing a key can require redistribution or consolidation even when no new data is added.

A leaf key can be removed directly if at least `t - 1` keys remain afterwards: one key for the example's degree.

A node below minimum occupancy has an **underflow**. Two operations repair it:

- **Borrow from a sibling**: if a neighbour has a spare key, rotate one through the parent. The parent separator moves into the underflowing node, and the sibling's nearest key replaces it. Internal-node redistribution also transfers the corresponding child pointer.

- **Merge with a sibling**: if no sibling can lend a key, combine the underflowing node, a parent separator, and its sibling. The parent loses one key and one child. An underflow can then propagate upwards.

(Deleting a key from an internal node is handled by swapping it with its predecessor or successor from a leaf, which turns it into a leaf deletion. Same idea as in a binary search tree.)

Begin with the same tree:

```text
                [40]
              /      \
          [20]        [60]
         /    \      /    \
     [10]  [25 30 35] [50]  [70 80 90]
```

### Borrowing

Delete 50. The leaf [50] would become empty, which is below the minimum. Its right sibling [70 80 90] has keys to spare. So the separator 60 comes down into the empty leaf, and 70 moves up to become the new separator:

```text
                [40]
              /      \
          [20]        [70]
         /    \      /    \
     [10]  [25 30 35] [60]  [80 90]
```

The redistribution preserves sorted order and equal leaf depth.

### Merging

Now delete 80. [80 90] becomes [90], which is fine, it's still at the minimum:

```text
                [40]
              /      \
          [20]        [70]
         /    \      /    \
     [10]  [25 30 35] [60]  [90]
```

Delete 60. Its leaf becomes empty, and sibling [90] cannot lend a key. Merge the empty leaf, separator 70, and [90] into [70 90]. The parent loses its only key:

```text
                [40]
              /      \
          [20]        [ ]
         /    \        |
     [10]  [25 30 35] [70 90]
```

Now the internal node is the one underflowing. Its sibling [20] has only one key, nothing to spare. Merge again: [20], separator 40 from the root, and the empty node become [20 40]. The root loses its only key, so it disappears, and [20 40] becomes the new root:

```text
         [20 40]
        /   |    \
    [10] [25 30 35] [70 90]
```

Removing the empty root reduces the height by one. As with growth, the height changes at the top and all leaves remain at equal depth.

### What Database Engines Do

Database implementations often defer consolidation. Merging moves data, needs synchronization, and generates writes; future inserts may instead reuse the space.

PostgreSQL's B-tree does not merge partially empty pages; deletion of eligible empty pages is handled through index maintenance such as vacuum. InnoDB can attempt a merge when page fullness falls below `MERGE_THRESHOLD`, whose default is 50%. Consequently, large deletions can leave substantial reusable space inside a PostgreSQL index without shrinking its file. `REINDEX` can rebuild it more compactly.

## B+ Trees in Database Engines

The classic B-tree permits keys and associated values in both internal nodes and leaves. Database indexes commonly use a **B+ tree** variant, which separates routing from record storage.

In a B+ tree, records or record references live in the leaves. Internal nodes hold **separator keys** used for routing. These often copy leaf keys, although implementations may truncate separators when a shorter distinguishing prefix suffices.

And the leaves are linked together, each pointing to the next (and often the previous) leaf, in key order.

```text
                   [30 | 60]
                 /     |     \
   [10 20] <-> [30 40 50] <-> [60 70 80]
```

The layout provides three benefits:

- **Higher fanout**: smaller internal entries allow more children per page and reduce height.
- **Uniform lookup paths**: ordinary record lookups end at a leaf, visiting the tree's full height.
- **Efficient range scans**: linked leaves allow ordered traversal without restarting from the root.

## Range Scans

Consider a range query:

```sql
SELECT * FROM orders WHERE id BETWEEN 1000 AND 5000;
```

The database seeks to the leaf containing the first key at least 1000, then follows the leaf chain until passing 5000. The scan does not restart from the root for each record.

An index matching the required ordering can avoid a separate `ORDER BY` sort. It also supports predicates such as `WHERE created_at > ?` and keyset pagination with `WHERE id > ? ORDER BY id LIMIT 50`. Deep `OFFSET` pagination still walks past skipped entries; keyset pagination can seek directly to the continuation point. Selectivity and row-fetch costs still influence the optimizer's choice.

## How Databases Use B-Trees

### InnoDB: The Clustered Index

In InnoDB, the table is the B+ tree. The primary key index is a clustered index: its leaves contain the full rows, stored in primary key order. There's no separate "heap" of rows somewhere else.

Secondary indexes are separate B+ trees whose leaves hold the indexed columns plus the primary key value. So a lookup through a secondary index is two tree walks: find the primary key in the secondary index, then look up the row in the clustered index. (Unless the secondary index has every column the query needs, a covering index, in which case the second walk is skipped.)

Two consequences follow: the primary key determines logical row order within the clustered leaves, and a wide primary key enlarges every secondary index. Logical key order does not imply that every neighbouring page occupies adjacent physical disk space.

### PostgreSQL: Heap Plus B-Tree

Postgres does it differently. Rows live in a heap, a set of pages with no particular order. Every index, including the primary key, is a separate B-tree whose leaves point at row locations in the heap (a tuple ID: page number plus slot).

Postgres's B-tree is based on the Lehman and Yao design, which adds a link from each node to its right sibling at every level, not just the leaves. That lets readers keep going safely if a page splits under them, which helps with concurrency. Since version 13, it can also deduplicate repeated keys within a leaf, which shrinks indexes on columns with many duplicate values.

### The Mathematics of Height

An illustrative capacity model shows why high fanout produces shallow trees. The following figures are assumptions for arithmetic, not measurements of a particular engine.

Consider a 16 KB InnoDB page with an 8-byte `BIGINT` key. An internal entry includes the separator, child page number, and record overhead. Assuming roughly 15 to 20 bytes allows several hundred to around a thousand entries per page. Use an optimistic rounded fanout of 1,000 for the capacity model.

```text
level 1 (root):           1 page
level 2:              1,000 pages
level 3:          1,000,000 pages   (leaves)
```

If each leaf holds rows of about 100 bytes, a 16 KB page fits roughly 150 of them, allowing for page overhead and some free space. A million leaves times 150 rows is about 150 million rows.

Under these assumptions, three levels provide capacity for about 150 million rows. A fourth level increases the modeled capacity into the hundreds of billions. Actual height depends on occupancy, row width, separator size, and page overhead.

A binary tree with roughly 150 million keys needs around 28 levels. The model therefore contrasts about three page visits with roughly 28, before accounting for caching.

The root and second level occupy about 1,000 pages, or roughly 16 MB at this page size. If those pages remain cached, a primary-key lookup may require only the leaf to be read from storage. A cached leaf removes that read too.

Height grows logarithmically with the row count, using a large branching factor. This is the central benefit of **fanout**.

## B-Trees vs LSM Trees

The **log-structured merge tree**, or **LSM tree**, is another major storage design, used by RocksDB, LevelDB, Cassandra, and ScyllaDB. Its write path makes different trade-offs from an in-place B-tree.

An in-place B-tree updates the relevant cached leaf page. Its eventual persistence can require a full-page write even for a small change, although caching and write coalescing affect the actual I/O pattern. For engines using a write-ahead log, the relevant log records must become durable before the modified page is persisted.

An LSM tree never updates in place. New writes go into an in-memory sorted structure (the memtable) plus a log. When the memtable fills up, it's flushed to disk as an immutable sorted file (an SSTable). In the background, compaction merges these files together, throwing away overwritten and deleted values.

The main differences can be summarized as follows:

| Concern | B-tree | LSM Tree |
|---|---|---|
| Foreground update | Modify a cached leaf page | Add to a memtable and log |
| Persistent layout | Mutable pages | Immutable sorted runs |
| Maintenance | Splits and page reclamation | Flushes and compaction |
| Point lookup | Traverse one index path | May consult multiple runs |
| Write amplification | Page and log writes | Log, flush, and compaction writes |

LSM designs group data into large sequential flushes and compaction writes. A point lookup may consult a memtable and several files; **Bloom filters** exclude files that cannot contain the key. A B-tree provides a direct search path, although MVCC versions and separate row fetches add work in real engines.

B-trees have predictable read latency. LSM trees can have spikes when compaction competes for disk.

Both have write amplification: the B-tree rewrites whole pages for small changes, the LSM tree rewrites data repeatedly during compaction. Which is worse depends heavily on the workload and configuration.

B-trees are common for mixed or read-heavy OLTP with ordered access. LSM designs are attractive for sustained write-heavy workloads such as logs and metrics. Cache size, compaction policy, key distribution, and durability settings can outweigh this broad distinction.

## Practical Index Design

The layout explains several practical index-design decisions.

### Composite Indexes and the Leftmost Prefix

A composite index on `(last_name, first_name)` is a single B+ tree sorted by last name first, and then by first name within the same last name. Like a phone book.

```sql
CREATE INDEX idx_name ON users (last_name, first_name);
```

This helps `WHERE last_name = 'Shah'` and `WHERE last_name = 'Shah' AND first_name = 'Riya'`. Both can follow the sort order.

A predicate on `first_name = 'Riya'` alone cannot identify one contiguous key range: matching entries are scattered across last names. This is the **leftmost prefix** rule. Some engines support skip scans that exploit a small number of distinct leading values, but that is a conditional optimization rather than equivalent access to a leading-column lookup.

The same goes for ranges. With `WHERE last_name > 'S' AND first_name = 'Riya'`, the index can use the range on `last_name`, but within that range the first names aren't in one sorted run, so the second column helps less. Equality columns first, range column last.

### Random UUID Keys

The ascending inserts in the step-by-step example targeted the rightmost leaf. Database engines can optimize for this pattern. When InnoDB sees inserts arriving in order at the right edge, it splits the page so the old page stays full rather than half full. Postgres has a similar fast path for rightmost inserts. Sequential keys generally improve page density and concentrate writes on a small hot set of pages.

Random UUID version 4 keys distribute inserts across the leaf population. Splits occur throughout the tree, occupancy can fall, and the write working set expands. When it exceeds available cache, locating and updating target leaves causes additional storage reads. In InnoDB, the clustered leaves contain the rows themselves, and each secondary index also carries the primary key. A UUID stored as 16 binary bytes therefore enlarges those entries compared with a narrower integer key.

Time-ordered identifiers such as **UUID version 7**, standardized in RFC 9562, improve locality by sorting roughly by creation time when represented appropriately. Another option is an auto-increment internal key with a separate externally visible UUID. Ordering improves locality, although it does not reduce the identifier's width.

### Other Considerations

- **Account for maintenance**: each additional B-tree consumes storage and cache space and must reflect relevant inserts, updates, and deletes. Index columns for demonstrated access paths.

- **Allow room for growth**: PostgreSQL B-tree `fillfactor`, 90% by default, reserves space in leaf pages during index construction, reducing immediate split pressure from later inserts.

- **Consider selectivity**: a Boolean column matching half the rows often favors a table scan. Skewed distributions, covering queries, and partial indexes can change that assessment.

## A Small Java Implementation

The following Java implementation supports search and insertion with the top-down split policy and `t = 2`, matching the step-by-step example. Nodes are in-memory objects rather than pages. It demonstrates structural operations, not a database engine's storage, recovery, or concurrency machinery.
```java
import java.util.ArrayList;
import java.util.List;

public class BTree {

    // Minimum degree. Every node except the root holds between
    // T - 1 and 2T - 1 keys. T = 2 means 1 to 3 keys per node.
    private static final int T = 2;
    private static final int MAX_KEYS = 2 * T - 1;

    static class Node {
        List<Integer> keys = new ArrayList<>();
        List<Node> children = new ArrayList<>();

        boolean isLeaf() {
            return children.isEmpty();
        }
    }

    private Node root = new Node();

    public boolean contains(int key) {
        Node node = root;
        while (true) {
            int i = 0;
            while (i < node.keys.size() && key > node.keys.get(i)) {
                i++;
            }
            if (i < node.keys.size() && key == node.keys.get(i)) {
                return true;
            }
            if (node.isLeaf()) {
                return false;
            }
            node = node.children.get(i);
        }
    }

    public void insert(int key) {
        if (root.keys.size() == MAX_KEYS) {
            Node newRoot = new Node();
            newRoot.children.add(root);
            splitChild(newRoot, 0);
            root = newRoot; // the only way the tree gets taller
        }
        insertNonFull(root, key);
    }

    private void insertNonFull(Node node, int key) {
        int i = 0;
        while (i < node.keys.size() && key > node.keys.get(i)) {
            i++;
        }
        if (node.isLeaf()) {
            node.keys.add(i, key);
            return;
        }
        if (node.children.get(i).keys.size() == MAX_KEYS) {
            splitChild(node, i);
            if (key > node.keys.get(i)) {
                i++;
            }
        }
        insertNonFull(node.children.get(i), key);
    }

    // Split the full child at index i of parent into two nodes,
    // moving the child's middle key up into the parent.
    private void splitChild(Node parent, int i) {
        Node full = parent.children.get(i);
        Node right = new Node();
        int mid = T - 1;

        right.keys.addAll(full.keys.subList(mid + 1, full.keys.size()));
        if (!full.isLeaf()) {
            right.children.addAll(full.children.subList(mid + 1, full.children.size()));
            full.children.subList(mid + 1, full.children.size()).clear();
        }
        int middleKey = full.keys.get(mid);
        full.keys.subList(mid, full.keys.size()).clear();

        parent.keys.add(i, middleKey);
        parent.children.add(i + 1, right);
    }

    public void print() {
        print(root, 0);
    }

    private void print(Node node, int depth) {
        System.out.println("  ".repeat(depth) + node.keys);
        for (Node child : node.children) {
            print(child, depth + 1);
        }
    }

    public static void main(String[] args) {
        BTree tree = new BTree();
        int[] keys = {10, 20, 30, 40, 50, 60, 70, 80, 90, 25, 35};
        for (int k : keys) {
            tree.insert(k);
        }
        tree.print();
        System.out.println(tree.contains(35) + " " + tree.contains(45));
    }
}
```

The example's tree shape and lookup results are:

```text
[40]
  [20]
    [10]
    [25, 30, 35]
  [60]
    [50]
    [70, 80, 90]
true false
```

Three methods define the insertion path:

- **`insert`** increases the height only when it splits a full root and installs a new root above it.

- **`splitChild`** promotes the full child's middle key and moves the upper keys, and any corresponding children, into a new right-hand node.

- **`insertNonFull`** splits a full child before descending. The destination leaf therefore has room without requiring an upward traversal.

A production B+ tree would use fixed-size pages loaded through a buffer pool, linked leaf records, concurrency control, and recovery machinery such as a write-ahead log. This example omits deletion and duplicate-key policy. Its input sequence contains distinct keys; applications needing uniqueness must enforce that policy explicitly.

## Common Mistakes

- **Treating it as a binary tree**: high fanout is deliberate. Many keys per page reduce the number of page visits.
- **Confusing B-trees with B+ trees**: database implementations commonly keep records in linked leaves, rather than in every level.
- **Ignoring the leftmost prefix**: an index on `(a, b)` does not generally provide the same lookup path as an index beginning with `b`.
- **Choosing random clustered keys without considering locality**: random UUIDs distribute writes across leaf pages and enlarge secondary entries when the primary key is wide.
- **Expecting deletion to shrink the file immediately**: freed space often stays available for reuse inside the index, especially in PostgreSQL.
- **Over-indexing**: each additional index consumes cache space and adds write maintenance.
- **Assuming slow lookup means a deep tree**: large indexes can remain shallow. Query plans, cache misses, heap fetches, and selectivity often explain the cost instead.

## Cheat Sheet

| Term | Plain meaning | Why it matters |
|---|---|---|
| Page | Fixed-size block the database reads and writes | Cost is counted in pages touched |
| Node | One page of the tree | Holds many sorted keys |
| Fanout | Children per internal node | High fanout means a short tree |
| Minimum degree t | Nodes hold t - 1 to 2t - 1 keys | Keeps nodes at least half full |
| Search | One node per traversed level | Leaf lookup visits the full height |
| Split | Full node divides, middle key moves up | Tree grows at the root |
| Borrow | Take a key from a sibling via the parent | Fixes underflow cheaply |
| Merge | Combine node, separator and sibling | Tree shrinks at the root |
| B+ tree | Data only in leaves, leaves linked | Cheap range scans |
| Clustered index | Leaves hold the full rows (InnoDB) | Primary key decides row order |
| Heap + index | Rows separate, index points to them (Postgres) | Primary-key index is separate from rows |
| LSM tree | Memtable plus immutable sorted files | Faster writes, more work on reads |
| Leftmost prefix | Composite index sorts left to right | Leading columns usually define the seek range |
| Random UUID keys | Inserts land everywhere | Splits, bloat, poor caching |
| Fillfactor | Free space left in pages | Fewer splits on later inserts |

## Conclusion

A B-tree organizes many sorted keys into each node and keeps all leaves at equal depth. Splits preserve capacity during insertion; borrowing and merging restore occupancy during deletion. Changes in height happen at the root, so the structure remains balanced as the data grows or shrinks.

B+ trees adapt this design to database storage by separating internal routing from leaf records and linking leaves for ordered scans. High fanout keeps the tree shallow, while caching often removes storage reads for its upper levels. The same layout explains composite-index ordering, clustered-key trade-offs, and why page utilization matters.

Real engines modify the textbook rules to accommodate variable-length records, concurrent readers, recovery, and workload-specific split or deletion policies. Understanding the underlying tree provides a basis for reasoning about those choices and the indexes built on them.
