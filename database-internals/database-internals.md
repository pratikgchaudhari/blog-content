---
title: Essential Database Internals Every Engineer Should Know
date: 2026-10-23
summary: A crisp reference of core database internals topics that every software engineer should understand.
tag: database, internals, systems, sql, engineering
draft: false
related: wal-databases
---

- **Storage Engines**: The component that manages how data is physically stored and retrieved. Row-oriented engines (e.g., InnoDB) optimize for transactional workloads; column-oriented engines (e.g., ClickHouse) optimize for analytical queries.

- **Page and Block Layout**: Data is stored in fixed-size pages (typically 8KB–16KB). Understanding page structure, free space management, and row formats is key to predicting I/O behavior and fragmentation.

- **Buffer Pool / Cache Management**: The in-memory cache of disk pages. Algorithms like LRU, clock, or 2Q decide which pages stay resident. A well-tuned buffer pool is often the biggest performance lever.

- **Indexes**: Data structures that accelerate lookups. B-trees are the default for range queries; hash indexes suit equality lookups; inverted indexes power full-text search; and bitmap indexes excel for low-cardinality analytical filters.

- **B-Tree vs LSM-Tree**: B-trees give consistent read/write latency and are common in OLTP systems. LSM-trees (Log-Structured Merge-trees) batch writes for high write throughput and are used by RocksDB, Cassandra, and many modern storage engines.

- **Query Optimizer**: The component that chooses an execution plan. It relies on statistics, cost models, and heuristics. Understanding selectivity, join order, and index selection helps diagnose slow queries.

- **Statistics and Histograms**: Metadata about data distribution (cardinality, nulls, histograms). Stale statistics are a leading cause of poor query plans.

- **Join Algorithms**: Nested-loop joins (good with indexes), hash joins (excellent for large equi-joins when memory allows), and sort-merge joins (useful when inputs are already ordered).

- **Execution Models**: Volcano/iterator model processes one row at a time; vectorized (batch) execution processes many rows together for better CPU efficiency; compiled execution generates specialized code.

- **Transactions and ACID**: Atomicity, Consistency, Isolation, Durability. These guarantees are enforced through logging, locking or multi-version concurrency control, and recovery mechanisms.

- **Concurrency Control**: Mechanisms that allow multiple transactions to run safely. Common approaches are two-phase locking (2PL) and multi-version concurrency control (MVCC).

- **Isolation Levels**: Read Uncommitted, Read Committed, Repeatable Read, and Serializable. Each makes different trade-offs between consistency and concurrency; anomalies such as dirty reads, non-repeatable reads, and phantoms appear at lower levels.

- **Write-Ahead Logging (WAL)**: Changes are written to a sequential log before being applied to data pages. This enables crash recovery and is fundamental to durability.

- **Checkpointing and Recovery**: Periodic snapshots of dirty pages that reduce recovery time. On restart, the database replays the WAL from the last checkpoint (ARIES-style recovery is the classic algorithm).

- **Vacuuming / Garbage Collection**: In MVCC systems, old row versions must be cleaned up. Autovacuum (PostgreSQL) or equivalent processes reclaim space and prevent bloat.

- **Deadlock Detection**: The system must detect cycles in the wait-for graph and abort one transaction. Engineers should also design applications to avoid long-held locks.

- **Replication**: Copying data to other nodes for high availability or read scaling. Synchronous replication prioritizes consistency; asynchronous prioritizes latency. Logical vs physical replication differs in what is shipped.

- **Consensus Algorithms**: Protocols such as Raft or Paxos that keep replicated state machines in agreement. Used by distributed databases, etcd, Consul, and many coordination services.

- **Sharding and Partitioning**: Horizontal splitting of data across nodes or tables. Key design choices include the shard key, rebalancing strategy, and how cross-shard queries or transactions are handled.

- **Distributed Transactions**: Two-phase commit (2PC) or more modern approaches (e.g., Percolator, Calvin, or Saga patterns) that provide atomicity across multiple nodes or services.

- **Query Caching and Prepared Statements**: Reusing execution plans or result sets. Plan caching can dramatically reduce CPU, but stale plans or parameter sniffing can also cause regressions.

- **Compression**: Techniques (dictionary, run-length, delta, LZ4, Zstd) that reduce storage and I/O. Column stores especially benefit from compression.

- **Full-Text Search Internals**: Inverted indexes, posting lists, and ranking algorithms (BM25, TF-IDF). Understanding these helps when integrating search with relational data.

- **Materialized Views and Incremental Maintenance**: Precomputed query results that must be kept consistent with base tables, either eagerly or lazily.

- **Connection Management and Pooling**: Databases have limited connection capacity. Connection pools (and the distinction between sessions and connections) are essential for application performance and stability.
