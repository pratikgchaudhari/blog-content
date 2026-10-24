---
title: How Write-Ahead Logging Ensures Database Durability and Crash Recovery
date: 2026-10-24
summary: A detailed explanation of Write-Ahead Logging (WAL), covering its principles, recovery mechanisms, ARIES algorithm, and real-world implementations in modern databases.
tag: databases, WAL, crash-recovery, ACID, ARIES, PostgreSQL, durability
draft: false
---

Write-Ahead Logging (WAL) is a fundamental technique used by virtually every modern relational and many non-relational database systems to guarantee durability and atomicity while enabling efficient crash recovery. The core idea is simple yet powerful: before any change is applied to the actual data pages on disk, a record describing that change must first be written to a durable sequential log. If the system crashes at any point, the log contains enough information to reconstruct a consistent database state.

## Why Databases Need WAL

Databases must satisfy the ACID properties, particularly Atomicity (a transaction either fully completes or has no effect) and Durability (once a transaction commits, its changes survive crashes and power failures). Without WAL, two problematic scenarios arise:

- If changes are applied directly to data pages and the system crashes midway through a multi-page update, the database is left in a partially updated, inconsistent state.
- If the system waits until all data pages are safely flushed to disk before acknowledging a commit, latency becomes unacceptable because random I/O to data files is far slower than sequential writes.

WAL solves both problems by separating the description of changes (the log) from the application of those changes (the data pages). The log is written sequentially and can be forced to stable storage with relatively low latency. Data pages can then be updated asynchronously, often in batches, improving overall throughput.

## Core Principles of WAL

The fundamental rule of WAL is:

> No change is made to a data page on disk until the corresponding log record has been written to stable storage.

This rule has several important consequences:

1. **Log records precede data changes** — The log acts as the authoritative source of truth for recovery.
2. **Commits require log force** — A transaction is considered durable only after its commit log record (and all preceding records) has been flushed to the log.
3. **Data pages may be dirty in memory** — Modified pages can remain in the buffer pool for some time, improving cache hit rates and reducing random I/O.
4. **Recovery is possible from the log alone** — After a crash, the system can replay the log to restore consistency without needing the previous state of every page.

## Structure of the Log

A WAL log consists of a sequence of log records. Each record typically contains:

- A unique **Log Sequence Number (LSN)** that identifies the record’s position in the log.
- The transaction identifier.
- The type of operation (insert, update, delete, commit, abort, etc.).
- The page identifier and offset affected.
- Enough information to redo (and sometimes undo) the operation. This may be a before-image, an after-image, or a logical description of the change.

There are two common styles of logging:

- **Physical logging** records the exact byte-level changes to pages. It is simple and fast to apply during recovery but can generate large log volumes.
- **Logical (or physiological) logging** records higher-level operations. It produces smaller logs and is more flexible but requires more complex recovery logic.

Most production systems use a hybrid approach often called *physiological logging*: the log records which page and which logical operation occurred, plus enough physical information to re-apply the change.

## Checkpointing

Because the log can grow indefinitely, databases periodically create **checkpoints**. A checkpoint is a special log record (or set of records) that captures a consistent snapshot of the system’s state at a particular moment. It typically includes:

- The LSN of the checkpoint.
- A list of active (in-progress) transactions.
- The dirty page table (pages that have been modified in memory but not yet written to disk).
- The oldest LSN that recovery must start from (the restart LSN).

Checkpointing allows recovery to begin from a recent point in the log rather than from the beginning of time. Modern systems often use *fuzzy checkpoints* that do not require stopping all activity; they simply record the current state and continue.

## Crash Recovery Process

After a crash, the recovery procedure generally consists of three phases:

1. **Analysis phase** — Scan the log from the most recent checkpoint forward to determine which transactions were active at the time of the crash and which pages might be dirty.
2. **Redo phase** — Replay log records forward, re-applying changes to bring data pages to the state they would have been in at the moment of the crash. This ensures durability of committed transactions.
3. **Undo phase** — Roll back the effects of transactions that were still active (not committed) at the time of the crash. This restores atomicity.

The exact order and details vary by algorithm, but the principle remains the same: redo committed work, undo uncommitted work.

## The ARIES Recovery Algorithm

ARIES (Algorithm for Recovery and Isolation Exploiting Semantics), developed at IBM in the early 1990s, is the most influential and widely adopted recovery algorithm based on WAL. It is used, in various forms, by DB2, PostgreSQL, Microsoft SQL Server, and many other systems.

ARIES introduces several key ideas:

- **Repeating history** — During the redo phase, ARIES re-applies *all* logged actions (both committed and uncommitted) to recreate the exact state at the time of the crash. This simplifies the algorithm and handles the case where a page was written to disk after some of its changes were logged but before the crash.
- **Compensation Log Records (CLRs)** — When undoing a change, ARIES writes a special log record that describes the undo action. CLRs are themselves redo-only, which makes recovery idempotent and allows the system to handle crashes that occur during recovery.
- **Page LSN** — Each data page stores the LSN of the most recent log record that modified it. During recovery, a page is updated only if the log record’s LSN is greater than the page’s current LSN, preventing unnecessary work and ensuring correctness.
- **Fuzzy checkpointing and dirty page tables** — ARIES can recover efficiently even when checkpoints are taken while the system is running.

The combination of these techniques makes ARIES robust, efficient, and able to support fine-grained locking and high concurrency.

## WAL in Practice

### PostgreSQL

PostgreSQL uses a classic WAL implementation. All changes are first written to WAL segments (typically 16 MB files). The `wal_level` setting controls how much information is logged. Checkpoints are performed periodically or when a certain amount of WAL has been generated. After a crash, PostgreSQL performs automatic recovery by replaying WAL from the last checkpoint. PostgreSQL also supports WAL archiving and streaming replication, which ship WAL records to standby servers for high availability.

### MySQL (InnoDB)

InnoDB maintains a redo log (the WAL) and an undo log. The redo log ensures durability of committed transactions, while the undo log supports rollback and multi-version concurrency control (MVCC). InnoDB’s recovery follows ARIES principles closely. The `innodb_flush_log_at_trx_commit` parameter controls the trade-off between durability and performance (values of 0, 1, or 2).

### Other Systems

SQLite, SQL Server, Oracle, and most cloud-native databases (including those based on the Raft consensus protocol for replication) all rely on some form of write-ahead logging. In distributed systems, WAL is often combined with consensus protocols so that log records are replicated to a quorum before a transaction is acknowledged.

## Benefits and Trade-offs

**Benefits:**
- Strong durability and atomicity guarantees.
- Efficient crash recovery that does not require a full database scan.
- Better performance through sequential log I/O and delayed data page writes.
- Foundation for replication, point-in-time recovery, and incremental backups.

**Trade-offs and challenges:**
- Log volume can become large under high write workloads, requiring careful management of log retention and archiving.
- Recovery time is proportional to the amount of WAL generated since the last checkpoint.
- Implementing correct WAL and recovery is complex; subtle bugs can lead to data corruption.
- Synchronous log flushes can become a latency bottleneck, which is why many systems offer tunable durability settings.

## Conclusion

Write-Ahead Logging is one of the most important ideas in database systems engineering. By ensuring that a durable description of every change exists before the change itself is applied to data pages, WAL provides a clean, efficient mechanism for crash recovery while simultaneously enabling high performance and strong consistency guarantees. From the foundational ARIES algorithm to the implementations found in PostgreSQL, InnoDB, and modern distributed databases, WAL remains central to how databases deliver the reliability that applications and users depend on.
