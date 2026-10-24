---
title: How Multi-Version Concurrency Control (MVCC) Works in Databases
date: 2026-10-24
summary: A deep dive into MVCC, covering snapshots, version visibility rules, isolation levels, garbage collection, and how PostgreSQL, MySQL InnoDB, and Oracle implement it.
tag: Database
draft: false
related: wal-databases,database-internals
---

Multi-Version Concurrency Control (MVCC) is the technique most modern databases use to let many transactions read and write the same data at the same time without tripping over each other. Instead of overwriting a row in place and forcing everyone else to wait, the database keeps multiple versions of that row. Each transaction sees a consistent snapshot of the data as it existed at a particular point in time, so readers never block writers and writers never block readers.

PostgreSQL, MySQL (InnoDB), Oracle, SQL Server (with snapshot isolation), CockroachDB, and many others are built around some form of MVCC. Understanding it explains a lot of database behaviour that otherwise feels mysterious: why `VACUUM` exists, why long-running transactions cause table bloat, why you sometimes get serialization errors, and why a `SELECT` doesn't wait for an `UPDATE` to finish.

## The Problem MVCC Solves

Databases promise isolation, the "I" in ACID. Each transaction should behave as though it is running alone, even when hundreds are running concurrently. The classic way to provide isolation is locking:

- A reader takes a **shared lock** on the rows it reads.
- A writer takes an **exclusive lock** on the rows it modifies.
- Shared and exclusive locks conflict, so readers wait for writers and writers wait for readers.

This approach, known as Two-Phase Locking (2PL), is correct but expensive. A long reporting query that scans a large table can hold shared locks that stall every update to that table. Likewise, a single slow update can freeze every dashboard reading the same rows. In read-heavy workloads, most of that waiting is unnecessary, because the reader would have been perfectly happy seeing the data as it was a moment ago.

MVCC takes exactly that insight and builds on it. If a writer creates a new version of a row instead of overwriting the old one, readers can keep using the old version until they are done. The only conflicts left to manage are between writers modifying the same row.

## The Core Idea: Versions and Snapshots

MVCC rests on two concepts.

**Row versions.** Every logical row can have several physical versions. When a transaction updates a row, the database creates a new version tagged with information about which transaction created it. The old version is not destroyed immediately; it is marked as superseded.

**Snapshots.** When a transaction (or, depending on the isolation level, a statement) starts, it takes a snapshot. A snapshot is a compact description of which transactions had committed at that moment. Using it, the transaction can decide for any row version whether that version is visible to it.

Put together, reading a row becomes a question of "which version of this row existed in my snapshot?" rather than "is anyone currently changing this row?"

Here is a simple timeline to make it concrete:

```
Time  Transaction A (reader)          Transaction B (writer)
----  ------------------------------  ------------------------------
t1    BEGIN; takes snapshot
t2                                    BEGIN
t3                                    UPDATE accounts SET balance = 500
                                      WHERE id = 1;   -- was 1000
t4    SELECT balance FROM accounts
      WHERE id = 1;  --> 1000
t5                                    COMMIT
t6    SELECT balance FROM accounts
      WHERE id = 1;  --> 1000 (Repeatable Read)
                     --> 500  (Read Committed)
t7    COMMIT
```

At `t4`, transaction A does not wait for B's lock and does not see B's uncommitted value. It simply reads the version of row 1 that was valid in its snapshot. What A sees at `t6` depends on the isolation level, which we will come back to.

## Transaction IDs and Version Metadata

To make visibility decisions, every row version carries some metadata. The exact fields differ between databases, but the common pattern is:

- **Creator ID**: the ID of the transaction that created this version (often called `xmin` or a creation timestamp).
- **Deleter ID**: the ID of the transaction that deleted or superseded this version (often called `xmax` or an end timestamp). It is empty while the version is current.
- **Pointer to another version**: a link to either the newer or the older version of the same row, forming a version chain.

Transaction IDs are handed out from a monotonically increasing counter. A higher ID means the transaction started later. Some systems use commit timestamps from a logical or hybrid clock instead, but the reasoning is the same.

Imagine row `id = 1` goes through two updates:

```
Version  balance  created_by  deleted_by
-------  -------  ----------  ----------
v1       1000     tx 100      tx 205
v2        500     tx 205      tx 310
v3        750     tx 310      (none)
```

Three physical versions exist for one logical row. Which one a transaction sees depends entirely on its snapshot.

## Visibility Rules

The heart of MVCC is the visibility check. A snapshot typically records:

- `xmin`: the lowest transaction ID that was still active when the snapshot was taken. Everything below it is finished (committed or aborted).
- `xmax`: the next transaction ID that had not yet been assigned. Everything at or above it started after the snapshot and is invisible.
- `active_list`: the IDs between `xmin` and `xmax` that were still in progress when the snapshot was taken.

A row version is visible to a snapshot when both of these hold:

1. **Its creator is visible.** The creating transaction committed before the snapshot was taken. That means its ID is below the snapshot's `xmax`, it is not in the active list, and it did not abort. A transaction always sees its own changes, so the creator being the current transaction also counts.
2. **Its deleter is not visible.** Either no transaction has deleted the version, or the deleting transaction had not committed as of the snapshot (it was still active, started later, or aborted).

In pseudocode:

```python
def is_visible(version, snapshot, my_txid):
    def committed_in_snapshot(txid):
        if txid == my_txid:
            return True
        if txid >= snapshot.xmax:
            return False          # started after the snapshot
        if txid in snapshot.active_list:
            return False          # was still running
        return commit_log.is_committed(txid)

    if not committed_in_snapshot(version.created_by):
        return False
    if version.deleted_by is None:
        return True
    return not committed_in_snapshot(version.deleted_by)
```

Applying this to the version table above, a transaction whose snapshot was taken after tx 205 committed but before tx 310 committed sees `v2` (balance 500). `v1` is hidden because its deleter (205) is visible, and `v3` is hidden because its creator (310) is not.

Because the check is purely a comparison of numbers against the snapshot, reads need no locks at all. The only shared lookup is the commit status of a transaction, which databases keep in a compact structure such as PostgreSQL's commit log (`pg_xact`) and cache aggressively.

## How Writes Work

Reads are lock-free, but writes still have to coordinate with other writes. Two transactions must not both believe they successfully updated the same row from the same starting point, or one update would silently vanish (the "lost update" problem).

### Inserts

An insert is the simplest case. The database writes a new version with `created_by` set to the current transaction and no deleter. Until that transaction commits, the version is invisible to everyone else.

### Deletes

A delete does not physically remove anything. It stamps the current version's `deleted_by` with the deleting transaction's ID. Other transactions continue to see the row until the delete commits and they take a newer snapshot.

### Updates

An update is effectively a delete plus an insert. The current version is marked as deleted by the updating transaction, and a new version with the new values is created and linked to the old one.

### Write-Write Conflicts

When a transaction tries to update a row whose latest version is already being modified by another in-progress transaction, it cannot proceed blindly. Most MVCC databases take a row-level lock for writes, so the second writer waits for the first to finish. What happens next depends on the isolation level:

- Under **Read Committed**, once the first writer commits, the second writer re-reads the newest committed version, re-checks its `WHERE` condition, and applies its update on top. PostgreSQL calls this re-evaluation step "EvalPlanQual".
- Under **Repeatable Read** or **Serializable**, the second writer cannot re-base its change on a version its snapshot never saw. Instead it fails with a serialization error, such as PostgreSQL's `could not serialize access due to concurrent update`, and the application is expected to retry.

This rule is often called **first-committer-wins** (or first-updater-wins): whoever commits a change to a row first keeps it, and conflicting transactions that started from an older snapshot are aborted.

## MVCC and Isolation Levels

The SQL standard defines isolation levels in terms of anomalies they prevent. MVCC implements them mostly by changing when the snapshot is taken and how conflicts are handled.

| Isolation level | When the snapshot is taken | What it prevents | Typical MVCC behaviour |
| --- | --- | --- | --- |
| Read Uncommitted | Rarely implemented as such | Nothing | PostgreSQL treats it as Read Committed |
| Read Committed | At the start of every statement | Dirty reads | Each query sees data committed before it began |
| Repeatable Read / Snapshot Isolation | At the start of the transaction | Dirty reads, non-repeatable reads, most phantoms | The whole transaction sees one frozen snapshot |
| Serializable | At the start of the transaction, plus conflict tracking | All anomalies, including write skew | Snapshot isolation plus detection of dangerous dependencies |

### Read Committed

Each statement gets a fresh snapshot. Two identical `SELECT`s in the same transaction can return different results if another transaction committed in between. This is the default in PostgreSQL, Oracle, and SQL Server, and it is cheap because snapshots are short-lived.

### Snapshot Isolation (Repeatable Read)

The transaction takes one snapshot at its first statement and uses it until it ends. It sees a perfectly consistent view of the database, no matter how much other transactions change. PostgreSQL's Repeatable Read is snapshot isolation. MySQL InnoDB's default Repeatable Read is also snapshot-based for plain reads, although locking reads (`SELECT ... FOR UPDATE`) and updates always act on the latest committed version.

### The Write Skew Anomaly

Snapshot isolation is strong, but it is not fully serializable. The classic counterexample is **write skew**. Suppose a hospital requires at least one doctor to be on call:

```sql
-- Both Alice and Bob are currently on call.

-- Transaction 1 (Alice)                 -- Transaction 2 (Bob)
SELECT count(*) FROM doctors             SELECT count(*) FROM doctors
WHERE on_call = true;   -- 2             WHERE on_call = true;   -- 2

UPDATE doctors SET on_call = false       UPDATE doctors SET on_call = false
WHERE name = 'Alice';                    WHERE name = 'Bob';

COMMIT;                                  COMMIT;
```

Each transaction checked the invariant against its snapshot, saw two doctors on call, and took itself off. They updated different rows, so there was no write-write conflict and both committed. Now nobody is on call. No serial order of these two transactions could produce that result.

### Serializable Snapshot Isolation

To close this gap without falling back to heavy locking, PostgreSQL (since 9.1) implements **Serializable Snapshot Isolation (SSI)**. Transactions still read from snapshots, but the database also tracks read-write dependencies between concurrent transactions using lightweight "SIRead" markers. When it detects a pattern of dependencies that could only arise from a non-serializable schedule (two consecutive read-write "rw-antidependencies" forming a dangerous structure), it aborts one of the transactions with a serialization failure. In the doctors example, one of the two commits would fail and the application would retry it, now seeing only one doctor on call.

SSI keeps the main benefit of MVCC, non-blocking reads, while guaranteeing true serializability at the cost of occasional retries.

## Where the Old Versions Live

All MVCC databases need somewhere to keep old versions. There are two broad designs, and the choice has big operational consequences.

### Append-Only Storage in the Main Table (PostgreSQL)

PostgreSQL stores every version of a row directly in the table's heap. Each tuple has a header containing `xmin`, `xmax`, and a `ctid` pointer to the next newer version. An update writes a complete new tuple, ideally on the same page.

```
Heap page
+--------------------------------------------------------------+
| Tuple 1: xmin=100 xmax=205 ctid->(0,2)  balance=1000          |
| Tuple 2: xmin=205 xmax=310 ctid->(0,3)  balance=500           |
| Tuple 3: xmin=310 xmax=0   ctid->(0,3)  balance=750           |
+--------------------------------------------------------------+
```

Advantages:

- Rollback is trivial. An aborted transaction's tuples simply never become visible; nothing needs to be undone.
- Readers looking for an old version find it right in the table.

Disadvantages:

- Tables and indexes accumulate dead tuples ("bloat") until they are cleaned up.
- Every update traditionally required new index entries pointing to the new tuple, even for unchanged indexed columns. PostgreSQL mitigates this with **HOT (Heap-Only Tuple)** updates: when no indexed column changes and the new version fits on the same page, the index keeps pointing at the old tuple and the chain is followed within the page.

### Undo Logs / Rollback Segments (MySQL InnoDB, Oracle)

InnoDB and Oracle update rows in place in the main table and copy the previous values into a separate **undo log** (InnoDB) or **undo tablespace** (Oracle). Each row in InnoDB has hidden columns:

- `DB_TRX_ID`: the ID of the last transaction that modified the row.
- `DB_ROLL_PTR`: a pointer into the undo log where the previous version can be reconstructed.

When a transaction reads a row whose latest version is too new for its **read view** (InnoDB's name for a snapshot), it follows `DB_ROLL_PTR` back through the undo records, applying them until it reconstructs a version it is allowed to see.

```
Clustered index (latest)        Undo log
+-------------------------+     +----------------------------+
| id=1 balance=750        |     | tx 310 changed 500 -> 750  |
| DB_TRX_ID=310           |---->| roll_ptr ---------------+  |
| DB_ROLL_PTR=*           |     +-------------------------|--+
+-------------------------+     | tx 205 changed 1000->500 |  |
                                | roll_ptr -> (none)    <--+  |
                                +----------------------------+
```

Advantages:

- The main table stays compact, containing only the latest version of each row.
- Readers who want the current data (the common case) find it immediately.

Disadvantages:

- Reading an old snapshot can be slow, because the database has to walk and apply a long undo chain.
- Rolling back a large transaction is expensive, because every change must be reverted using the undo log.
- If undo space runs out or old undo is overwritten before a long query finishes, the query fails. Oracle's famous `ORA-01555: snapshot too old` is exactly this.

### Version Storage Order

A related design choice is the direction of the version chain:

- **Oldest-to-newest** chains (classic PostgreSQL heap chains) make it cheap to append new versions but mean a reader may need to walk past old versions to reach the current one.
- **Newest-to-oldest** chains (InnoDB, Oracle, and many in-memory systems) put the latest version first, which suits the common case of reading current data.

Systems such as SQL Server's snapshot isolation use a third option, a separate **version store** in `tempdb`, with each row carrying a pointer to its older versions there.

## Garbage Collection: Cleaning Up Old Versions

Old versions cannot be kept forever. A version can be safely removed once no current or future snapshot could possibly need it, which is when it has been superseded by a committed change and every active transaction started after that change committed. The oldest active snapshot in the system defines the **horizon**: anything that became dead before the horizon is garbage.

### PostgreSQL VACUUM

PostgreSQL cleans up through `VACUUM`, usually run automatically by the **autovacuum** daemon. It:

1. Scans tables for tuples whose deleting transaction committed before the oldest active snapshot.
2. Removes index entries that point to those tuples.
3. Marks the space in heap pages as reusable.
4. Updates the **visibility map**, which records pages where every tuple is visible to everyone. Index-only scans use this map to skip heap lookups.
5. **Freezes** very old tuples so their transaction IDs no longer matter.

Freezing exists because PostgreSQL transaction IDs are 32-bit and wrap around after about four billion transactions. If old tuples were not frozen, a wraparound would suddenly make ancient rows appear to be "in the future" and therefore invisible. PostgreSQL forces aggressive vacuums, and eventually refuses new writes, to prevent this.

Plain `VACUUM` makes space reusable but rarely shrinks files. `VACUUM FULL` (or tools such as `pg_repack`) rewrites the table to return space to the operating system, at the cost of heavier locking.

### InnoDB Purge

InnoDB runs background **purge threads**. Once no read view needs an undo record, purge removes it and also physically removes rows that were delete-marked. The amount of undo waiting to be purged is reported as the **history list length** in `SHOW ENGINE INNODB STATUS`. A steadily growing history list is a sign that something is holding back purge.

### The Long-Running Transaction Problem

In every design, the garbage collector cannot reclaim anything newer than the oldest active snapshot. A single transaction left open for hours, such as an idle session that ran `BEGIN` and never committed, a giant analytics query, or a stuck replication slot, pins the horizon. As a result:

- PostgreSQL tables and indexes bloat, queries slow down, and autovacuum spins without making progress.
- InnoDB's history list grows, and old snapshots become increasingly expensive to reconstruct.
- Oracle risks `ORA-01555` for queries and undo tablespace exhaustion.

This is why monitoring transaction age (for example, `pg_stat_activity.xact_start` in PostgreSQL, or `information_schema.innodb_trx` in MySQL) and setting `idle_in_transaction_session_timeout` are standard practices for production databases.

## MVCC and Indexes

Indexes complicate MVCC because an index entry usually does not carry visibility information.

- In **PostgreSQL**, an index entry points to a heap tuple, and the database must visit the heap to check `xmin` and `xmax` before returning a row. The visibility map lets index-only scans skip that visit for pages known to be all-visible. Index entries for dead tuples linger until `VACUUM` removes them, although PostgreSQL also prunes entries it discovers to be dead during normal scans.
- In **InnoDB**, the clustered (primary key) index holds the row data, including `DB_TRX_ID`, so visibility can be checked directly. Secondary indexes do not carry versions; when InnoDB is not sure whether a secondary index entry is visible, it looks up the clustered index record and, if needed, the undo chain.

In both systems, updating an indexed column means old and new index entries coexist for a while, which is part of why update-heavy workloads on heavily indexed tables are expensive.

## MVCC in Distributed Databases

Distributed databases such as Google Spanner, CockroachDB, YugabyteDB, and TiDB also rely on MVCC, but they cannot use a single local counter for transaction IDs. Instead they use timestamps:

- **Spanner** uses TrueTime, a globally synchronised clock with bounded uncertainty, and waits out that uncertainty before committing so timestamps reflect real-time order.
- **CockroachDB** uses Hybrid Logical Clocks (HLC), which combine physical time with a logical counter, and handles clock uncertainty by restarting reads that encounter values in their uncertainty window.
- **TiDB** uses a central Timestamp Oracle (TSO) that hands out monotonically increasing timestamps.

Each key is stored with its versions keyed by timestamp, typically in an LSM-tree storage engine such as RocksDB or Pebble. A read at timestamp `T` simply returns the newest version with a timestamp at or below `T`. Old versions are removed during compaction once they fall outside a configured garbage-collection window. That same window enables features such as `AS OF SYSTEM TIME` queries, which read historical data on purpose.

## Advantages and Trade-offs

**Why MVCC is so widely used:**

- Readers never block writers, and writers never block readers.
- Long analytical queries get a consistent snapshot without stalling transactional traffic.
- Consistent backups can be taken from a snapshot without locking the database (for example, `pg_dump` or `mysqldump --single-transaction`).
- It naturally supports time-travel and historical queries in systems that retain versions.

**What it costs:**

- Extra storage for old versions, plus the background work to clean them up.
- Operational sensitivity to long-running transactions.
- Snapshot isolation alone allows write skew, so applications that need strict correctness must use Serializable or explicit locking (`SELECT ... FOR UPDATE`).
- Serializable and Repeatable Read can abort transactions, so applications must be written to retry on serialization failures.
- Write-heavy workloads can suffer from write amplification, especially with many indexes.

## Practical Tips for Working with MVCC Databases

- **Keep transactions short.** Open them as late as possible and commit as early as possible. Never leave a session idle inside a transaction.
- **Retry on serialization failures.** Under Repeatable Read or Serializable, treat SQLSTATE `40001` as a normal, retryable outcome rather than a bug.
- **Use locking reads when you read-then-write.** If you read a value and then update based on it under Read Committed, use `SELECT ... FOR UPDATE` or an atomic `UPDATE ... SET x = x + 1` to avoid lost updates.
- **Watch bloat and purge lag.** In PostgreSQL, monitor dead tuples (`pg_stat_user_tables.n_dead_tup`) and tune autovacuum for hot tables. In MySQL, watch the history list length.
- **Be careful with update-heavy, heavily indexed tables.** Every non-HOT update in PostgreSQL touches every index. Leaving some free space in pages with a lower `fillfactor` can increase the share of HOT updates.
- **Mind replication slots and replicas.** In PostgreSQL, inactive replication slots and replicas with `hot_standby_feedback` enabled can hold back the cleanup horizon just like a long transaction.

## Conclusion

MVCC replaces "wait until it's safe to read" with "read the version that was valid for you". By keeping several versions of each row and giving every transaction a snapshot, databases let readers and writers work side by side, while row-level locking and first-committer-wins rules keep concurrent writers from corrupting each other's work.

The price is paid in storage and housekeeping: old versions have to live somewhere, and something has to clean them up. Whether that is PostgreSQL's in-heap versions and `VACUUM`, InnoDB's undo logs and purge threads, or a distributed store's timestamped keys and compaction, the same rules apply. Keep transactions short, pick the isolation level that matches your correctness needs, and handle retries gracefully, and MVCC will quietly do the heavy lifting of concurrency for you.
