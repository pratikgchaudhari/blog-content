---
title: ReentrantLock in Java Explained - Fairness, Conditions, tryLock, AQS Internals and Alternatives
date: 2026-11-15
summary: A practical guide to ReentrantLock covering reentrancy, fairness, Condition objects, AQS internals, virtual threads, and when to choose synchronized, read-write locks, StampedLock, or other tools instead.
tag: java, concurrency, reentrantlock, locks, aqs, multithreading, juc, synchronized
draft: false
related: reentrant-lock-in-java,java-virtual-threads-internals,virtual-threads-in-java,how-does-the-volatile-keyword-in-java-work,concurrent-collections-in-java,executor-service-types-in-java,completable-future-in-java,thread-per-task-executor
---

**Mutual exclusion** keeps concurrent threads from stepping on shared mutable state at the same time. In Java, the classic tool is the intrinsic monitor behind `synchronized`. Since Java 5, `java.util.concurrent.locks.ReentrantLock` has offered the same basic exclusion model with more control: interruptible and timed acquisition, optional fairness, multiple condition queues, and richer monitoring.

`ReentrantLock` arrived with **JSR 166**, the concurrency utilities led by **Doug Lea**, shipped in Java 5 as `java.util.concurrent`. The package gave the platform locks, atomics, executors, concurrent collections, and the **`AbstractQueuedSynchronizer` (AQS)** framework that still powers many of those tools. Before JSR 166, developers either used `synchronized` or built home-grown synchronizers that were easy to get subtly wrong. The `Lock` API made advanced patterns reusable and testable.

Today the class remains a daily tool in JDK 21+ and current LTS lines, including JDK 25 LTS. Virtual threads changed some pinning trade-offs around `synchronized`, but they did not retire `ReentrantLock`. The API still earns its place whenever you need explicit acquisition policies, timed entry, fairness controls, or multiple condition queues on one lock.

This article explains how `ReentrantLock` works, how to use it safely, how it sits on AQS, how it interacts with virtual threads, and which alternatives fit which problems. The goal is a working mental model you can use while reading library code and reviewing concurrent changes, without turning every class into a custom synchronizer or a premature optimization project.

## The Problem Locks Solve

Without exclusion, two threads can interleave reads and writes of the same fields and produce torn updates, lost increments, or invariants that never hold in any single-threaded run.

```
Thread A: read balance=100
Thread B: read balance=100
Thread A: write balance=100-30
Thread B: write balance=100+50
Result: 150 instead of 120
```

A lock serializes the critical section so one thread finishes its read-modify-write before another enters. Locks do not remove the need for clear ownership of state. They only buy a critical section when shared mutation is unavoidable.

Locks also do not compose automatically. Two locks acquired in opposite orders can deadlock. Timeouts, consistent global ordering, or try-lock with backoff are the usual defenses when multiple locks are required.

## Baseline: `synchronized` and Intrinsic Monitors

Every Java object has an intrinsic monitor. `synchronized` acquires that monitor, runs a block or method, then releases it. Waiting and notification use `Object.wait`, `notify`, and `notifyAll` on the same monitor.

Strengths:

- Simple syntax; the compiler inserts unlock on all exit paths
- Well understood happens-before rules
- Fine for many short critical sections
- No extra object allocation for a separate lock if you synchronize on `this` or a private final Object

Limits:

- Acquisition is not interruptible or timed in the `Lock` sense
- Only one wait-set per object monitor
- No try-lock that returns immediately with a boolean in the `Lock` API style
- Harder to structure non-block-scoped locking (and you usually should not want that)
- Nested synchronized blocks on different objects still risk lock-order deadlocks

A private final lock object is still a good idiom with intrinsic locking when you do not want callers to synchronize on your instance accidentally:

```java
private final Object monitor = new Object();

public void update() {
    synchronized (monitor) {
        // mutate state
    }
}
```

`ReentrantLock` matches the mutual-exclusion story of `synchronized` while addressing those limits. For many codebases the first question is not "which is faster?" but "do I need the extra `Lock` methods?" If the answer is no, intrinsic locking remains a solid default.

## What Reentrancy Means

A lock is **reentrant** if the owning thread can acquire it again without deadlocking itself. Nested calls that need the same lock are common:

```java
private final ReentrantLock lock = new ReentrantLock();

public void transfer(Account to, Money amount) {
    lock.lock();
    try {
        withdraw(amount);
        to.deposit(amount);
    } finally {
        lock.unlock();
    }
}

private void withdraw(Money amount) {
    lock.lock(); // same thread, hold count becomes 2
    try {
        balance = balance.minus(amount);
    } finally {
        lock.unlock(); // hold count back to 1
    }
}
```

`getHoldCount()` returns how many unmatched `lock` calls the current thread has made. Unlocking decrements that count; the lock is released only when the count reaches zero. The maximum recursive hold count is `Integer.MAX_VALUE`; exceeding it fails with `Error`.

Non-reentrant locks exist (custom AQS mutexes, for example). They are useful when you want to forbid nested acquisition. `ReentrantLock` deliberately allows it.

Reentrancy is counted per lock instance, not globally. Holding `lockA` does not let you enter `lockB` without acquiring `lockB`. Nested monitors of different objects still need care with acquisition order.

## The `Lock` Interface

`ReentrantLock` implements `java.util.concurrent.locks.Lock`:

| Method | Role |
|---|---|
| `lock()` | Acquire, waiting if needed (non-interruptible wait) |
| `lockInterruptibly()` | Acquire, aborting on interrupt |
| `tryLock()` | Acquire only if free right now |
| `tryLock(time, unit)` | Timed, interruptible attempt |
| `unlock()` | Release one hold |
| `newCondition()` | Create a condition queue bound to this lock |

Other `Lock` implementations exist (`ReentrantReadWriteLock.WriteLock`, wrappers around `StampedLock`, and so on). Coding to the interface helps when a component only needs mutual exclusion and may swap implementations in tests. In application code, declaring the field as `ReentrantLock` is common when you need fairness checks or hold-count monitoring.

Successful `lock` / `unlock` pairs have the same memory synchronization effects as intrinsic monitor lock / unlock actions (JLS Chapter 17 / `Lock` javadoc): writes before an unlock happen-before reads after a later successful lock on the same lock.

That visibility guarantee is why a correctly locked counter does not also need every field marked `volatile`. The lock already creates the happens-before edge between the previous critical section and the next one.

## `lock` / `unlock` in try/finally

Recommended shape from the javadoc:

```java
lock.lock(); // last statement before try
try {
    // critical section
} finally {
    lock.unlock(); // first statement in finally
}
```

Put `lock()` outside the `try` so a failed acquire does not unlock a lock you never held. Put `unlock()` first in `finally` so release always runs.

Calling `unlock()` when the current thread does not own the lock throws **`IllegalMonitorStateException`**. That is stricter than forgetting who notified whom on an object monitor; ownership is checked on every unlock.

Do not hand a locked `ReentrantLock` to another thread to unlock. Ownership is thread-based. Hand-off designs need a different protocol.

Serialization restores an unlocked lock regardless of the state at serialization time, matching the intrinsic-lock story where monitors are not meaningful across process boundaries in that serialized form either.

## `tryLock` and Timed Acquisition

Untimed `tryLock()` returns immediately:

```java
if (lock.tryLock()) {
    try {
        work();
    } finally {
        lock.unlock();
    }
} else {
    // do something else, or back off
}
```

Timed acquisition waits up to a limit and is interruptible:

```java
if (lock.tryLock(100, TimeUnit.MILLISECONDS)) {
    try {
        work();
    } finally {
        lock.unlock();
    }
}
```

These methods help avoid deadlock when multiple locks must be acquired. Try one lock, and if the second fails, release the first and retry in a defined order or with backoff.

```java
boolean lockedFirst = false;
boolean lockedSecond = false;
try {
    lockedFirst = first.tryLock(50, TimeUnit.MILLISECONDS);
    if (!lockedFirst) {
        return false;
    }
    lockedSecond = second.tryLock(50, TimeUnit.MILLISECONDS);
    if (!lockedSecond) {
        return false;
    }
    transfer();
    return true;
} finally {
    if (lockedSecond) {
        second.unlock();
    }
    if (lockedFirst) {
        first.unlock();
    }
}
```

Consistent ordering (`first` then `second` everywhere) is still the primary deadlock prevention strategy. Timed try-lock is a safety net and a way to fail fast instead of hanging.

Important fairness detail: untimed `tryLock()` **barges**. Even on a fair `ReentrantLock`, it succeeds if the lock is free, ignoring waiting threads. To honor fairness, use `tryLock(0, TimeUnit.SECONDS)` (also interruptible) or rely on `lock()` / timed fair acquisition.

Timed `tryLock` on a fair lock does honor the queue: if others are waiting, an available lock is not stolen out of turn the way untimed `tryLock()` can. The javadoc even shows how to combine untimed and timed forms when you want barging plus a timeout.

## `lockInterruptibly`

```java
lock.lockInterruptibly();
try {
    work();
} finally {
    lock.unlock();
}
```

If the thread is interrupted while waiting, acquisition throws `InterruptedException` and clears the interrupt status. Prefer this when cancellation should stop waiting for a lock. Plain `lock()` ignores interrupts while blocked in the acquire path (the interrupt status remains set for later detection).

Cancellation-friendly services often standardize on `lockInterruptibly` or timed `tryLock` so a shutting-down thread does not sit forever in an uninterruptible acquire.

## Fairness

```java
ReentrantLock unfair = new ReentrantLock();      // default
ReentrantLock fair = new ReentrantLock(true);
```

Under contention, a **fair** lock prefers the longest-waiting thread. An **unfair** (default) lock allows barging: a arriving thread may grab the lock if it is free, even if others wait. The javadoc notes that fair locks often have lower throughput under heavy contention, but smaller variance and no lock-queue starvation of the AQS kind.

Fairness of the lock is not fairness of the CPU scheduler. A thread can still reacquire a fair lock repeatedly if it unlocks and locks again while others are not yet runnable.

Default to unfair unless you have a measured starvation or latency-variance reason for fair mode.

Fair mode is sometimes chosen for latency-sensitive clients that must not wait behind barging newcomers forever. Measure before switching globally. Fairness has a real throughput cost under contention, as the javadoc warns, and it will not fix inverted lock ordering by itself.

## Condition Objects

A **`Condition`** replaces `Object.wait` / `notify` for a given `Lock`. One lock can have several conditions, each with its own wait queue.

```java
lock.lock();
try {
    while (!ready) {
        readyCondition.await(); // releases lock, waits, reacquires before return
    }
    use();
} finally {
    lock.unlock();
}
```

Signalling:

```java
lock.lock();
try {
    ready = true;
    readyCondition.signal(); // or signalAll()
} finally {
    lock.unlock();
}
```

Rules that match intrinsic monitors:

- You must hold the lock to await or signal (otherwise `IllegalMonitorStateException` with `ReentrantLock`'s conditions)
- `await` releases the lock atomically, then reacquires it before returning
- Always wait in a **loop**; spurious wakeups are allowed
- Prefer `signal()` when exactly one waiter can make progress; use `signalAll()` when many may need to recheck

Condition waiters are signalled in FIFO order for `ReentrantLock`. Lock reacquisition after await follows the lock's fairness policy.

Multiple conditions shine when different groups of threads wait for different predicates on the same state: producers wait for space, consumers wait for data, maintainers wait for quiescence, and so on. Encoding all of those waits on one intrinsic monitor usually forces broad `notifyAll` calls and extra wakeups.

### Bounded Buffer Example

```java
final class BoundedBuffer<E> {
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition notFull = lock.newCondition();
    private final Condition notEmpty = lock.newCondition();
    private final Object[] items;
    private int putIndex, takeIndex, count;

    BoundedBuffer(int capacity) {
        items = new Object[capacity];
    }

    public void put(E value) throws InterruptedException {
        lock.lock();
        try {
            while (count == items.length) {
                notFull.await();
            }
            items[putIndex] = value;
            putIndex = (putIndex + 1) % items.length;
            count++;
            notEmpty.signal();
        } finally {
            lock.unlock();
        }
    }

    @SuppressWarnings("unchecked")
    public E take() throws InterruptedException {
        lock.lock();
        try {
            while (count == 0) {
                notEmpty.await();
            }
            E value = (E) items[takeIndex];
            items[takeIndex] = null;
            takeIndex = (takeIndex + 1) % items.length;
            count--;
            notFull.signal();
            return value;
        } finally {
            lock.unlock();
        }
    }
}
```

Two conditions avoid waking producers when only consumers should run, and the reverse. With a single intrinsic wait-set you often need `notifyAll` and more wasted wakeups.

`await` variants also support timed waits and interruption. As with `Object.wait`, a signal is a hint that the predicate might be true. The waiting thread must recheck the predicate after reacquiring the lock.

## Internals: AQS

`ReentrantLock` is built on **`AbstractQueuedSynchronizer`**. AQS stores synchronization status in an atomic `int` **state** and parks contending threads in a FIFO wait queue. Subclasses define what the state means and how `tryAcquire` / `tryRelease` interpret it. AQS then handles enqueueing, parking, cancellation, and signalling.

For `ReentrantLock`:

- state `0` means unlocked
- a positive state is the hold count for the exclusive owner
- the exclusive owner thread is tracked for monitoring and reentrancy checks

Acquire roughly follows:

```
while (!tryAcquire(arg)) {
    enqueue if needed;
    park with LockSupport;
}
```

Release:

```
if (tryRelease(arg)) {
    unpark successor;
}
```

The wait queue is documented as a **variant of a CLH queue** (Craig, Landin, and Hagersten): linked nodes, predecessor/successor relationships, and status bits used with `LockSupport.park` / `unpark`. Nonfair mode may barge before enqueueing. Fair mode's `tryAcquire` refuses acquisition when `hasQueuedPredecessors()` is true (except for reentrant acquires by the owner).

State updates use CAS (`compareAndSetState`) with volatile read/write memory effects. That is how exclusion and visibility meet.

JDK 14 included a substantial AQS implementation refresh (node types and condition waiting mechanics were reworked while keeping the same public framework and CLH-style FIFO model). Application code should depend on the documented `Lock` / AQS contracts, not on private field layouts.

Parking uses **`LockSupport.park`**, which integrates with virtual threads by allowing unmount when the implementation parks a virtual thread. That is one reason explicit `j.u.c` locks historically behaved better than pinned `synchronized` waits on early Loom JDKs.

```
Thread tries lock
    |
    +--> CAS state 0 -> 1  --> owns lock
    |
    +--> fail --> enqueue node --> park
                      ^
                      |
            unlock --> tryRelease --> unpark head's successor
```

`ReentrantLock` uses exclusive AQS mode. Shared mode in the same framework powers tools such as `Semaphore` and the read side of read-write locks. The queue can hold threads waiting for either mode depending on the synchronizer.

## Memory Visibility

A successful unlock happens-before a successful later lock on the same `ReentrantLock`. Writes in the critical section become visible to the next owner without declaring every field `volatile`. Unsuccessful try-locks and purely reentrant lock/unlock pairs do not add extra synchronization effects beyond what the `Lock` specification requires.

Visibility is not a substitute for atomicity of compound actions. Seeing the latest fields after lock acquisition does not make check-then-act safe unless the whole compound action runs while the lock is held. Likewise, publishing an object under a lock does not make that object's internal races disappear if other threads touch it later without the same exclusion or another safe publication path.

## Monitoring Methods

Useful for tests and diagnostics (not for control flow in hot paths):

| Method | Meaning |
|---|---|
| `isLocked()` | Any thread holds the lock |
| `isHeldByCurrentThread()` | Current thread is owner |
| `getHoldCount()` | Reentrancy depth for current thread |
| `isFair()` | Fairness flag |
| `hasQueuedThreads()` / `getQueueLength()` | Contended acquire queue |
| `hasWaiters(condition)` / `getWaitQueueLength(condition)` | Condition waiters |

`getOwner()` and queued-thread collections are protected hooks mainly for subclasses and tooling.

Assertions in development builds can catch protocol bugs early:

```java
public void mustBeLocked() {
    assert lock.isHeldByCurrentThread();
    // mutate
}

public void mustNotAlreadyHold() {
    assert !lock.isHeldByCurrentThread();
    lock.lock();
    try {
        // ...
    } finally {
        lock.unlock();
    }
}
```

Queue-length methods return estimates. Threads may cancel between the snapshot and your decision. Do not use them to implement synchronization logic.

## Virtual Threads

`ReentrantLock` parks through `LockSupport`, so a virtual thread waiting for the lock can unmount from its carrier and let another virtual thread run.

Before **JEP 491** (JDK 24), blocking inside `synchronized` pinned carriers. That was a common reason to prefer `ReentrantLock` for long or blocking critical sections on virtual threads. After JEP 491, `synchronized` no longer pins for monitor wait and blocking inside synchronized regions. Choosing `ReentrantLock` vs `synchronized` is again mostly about API needs (try/lock interruptibly, multiple conditions, fairness), not about virtual-thread pinning.

Native frames can still pin. Holding any lock across blocking native calls remains a scalability hazard. The same advice applies to both lock styles: keep critical sections short, and do not perform remote I/O while holding exclusion unless the design truly requires it.

## Alternatives and Trade-offs

### `synchronized`

Prefer when critical sections are short, you do not need try/timed/interruptible acquire, and one wait-set is enough. Less boilerplate; harder to misuse unlock. Modern HotSpot has spent decades optimizing intrinsic locking for uncontended and lightly contended cases, so "always replace with `ReentrantLock` for speed" is not a sound rule.

### `ReentrantReadWriteLock`

Many concurrent readers, few writers. Readers share; writers are exclusive. Reentrancy allows a writer to also take the read lock (**downgrade**: acquire read while holding write, then release write). **Upgrade** from read to write is not supported and can deadlock if attempted naively. The javadoc is explicit: a reader that tries to acquire the write lock will not succeed in that upgrade path.

Read-write locks help when the protected data is large enough or hot enough that concurrent readers matter. For tiny critical sections, a plain exclusive lock may be simpler and competitive.

```java
ReentrantReadWriteLock rwl = new ReentrantReadWriteLock();
rwl.writeLock().lock();
try {
    update();
    rwl.readLock().lock(); // downgrade pattern begins
} finally {
    rwl.writeLock().unlock();
}
try {
    readUnderReadLock();
} finally {
    rwl.readLock().unlock();
}
```

### `StampedLock`

Optimistic reads with `tryOptimisticRead` / `validate`, plus read and write locks identified by stamps. **Not reentrant.** No `Condition` support. Powerful for read-heavy structures when you control the code inside the lock and can tolerate optimistic retry. Easy to misuse if you call unknown code while holding a stamp.

Optimistic mode returns a stamp only if the lock is not write-locked. After reading into locals, call `validate(stamp)`. If validation fails, a writer intervened; retry with a real read lock or another optimistic attempt. Fields observed between optimistic read and validate may be inconsistent, so this mode is for experts who know the data representation.

### `Semaphore`

Permits for bounding concurrency (connection caps, rate limits). Not a mutual-exclusion teacher for complex invariants, though a binary semaphore can mimic a non-reentrant lock. Often the right tool when the problem is "at most N," not "protect these fields."

With virtual threads especially, a semaphore is the usual replacement for "fixed size thread pool as a rate limiter." Create many virtual threads if you want, but admit only N into the scarce section.

### Atomics and `LongAdder`

For single variables or simple counters, `AtomicInteger`, `AtomicReference`, and adders avoid lock objects entirely. Prefer them when the critical section is one CAS-friendly update. `LongAdder` shines under high update contention for statistics. When updates touch several related fields that must stay consistent together, a lock or an atomic aggregate object is usually clearer than a web of separate atomics.

### Concurrent Collections

`ConcurrentHashMap`, concurrent queues, and copy-on-write lists embed their own synchronization. Prefer them over locking a plain `HashMap` when the collection is the shared structure. Compound actions still need care: check-then-act across multiple keys may require an external `ReentrantLock` or a redesign around atomic map methods (`compute`, `merge`, and friends).

### Immutability and Confinement

The best lock is no shared mutable state: immutable values, thread confinement, message passing, or ownership transfer. Locks are for the cases that remain. Many designs shrink the locked region until only a small mutable hub remains, then protect that hub with one clear lock or with a concurrent collection.

### Distributed Locks

A JVM lock ends at the process boundary. Multi-node mutual exclusion needs a different design (database leases, consensus systems, or specialized lock services), with different failure modes. Do not stretch `ReentrantLock` across machines.

Distributed locking is its own topic: lock expiry, fencing tokens, and split-brain behavior dominate. If you only need single-process exclusion, keep the problem inside the JVM and use the tools in this article.

## Comparison Table

| Tool | Reentrant | Try / Timed / Interruptible | Multiple conditions | Best fit |
|---|---|---|---|---|
| `synchronized` | Yes | No (intrinsic) | One wait-set per object | Simple short sections |
| `ReentrantLock` | Yes | Yes | Yes | Flexible exclusion |
| `ReentrantReadWriteLock` | Yes | Yes (per side) | Yes (via sync) | Read-heavy shared data |
| `StampedLock` | No | Yes (stamp APIs) | No | Optimistic read-heavy code |
| `Semaphore` | N/A | Yes | N/A | Concurrency limits |
| Atomics | N/A | CAS loops | N/A | Single-variable updates |

## Step by Step Decision Guide

1. Can the state be immutable or confined to one thread? Prefer that.
2. Is the shared piece a concurrent collection or a single atomic? Prefer those.
3. Do you only need short exclusive sections with no try/timed API? Use `synchronized`.
4. Do you need try/lock interruptibly, fairness, or multiple conditions? Use `ReentrantLock`.
5. Is the workload many reads and few writes with clear read/write sections? Consider `ReentrantReadWriteLock` or carefully used `StampedLock`.
6. Is the problem "limit N concurrent callers"? Use a `Semaphore`.
7. Do you span multiple processes? Design a distributed protocol; do not use a local lock.

A second pass after the choice matters as much as the choice itself:

- Document lock ordering if more than one lock exists.
- Keep critical sections free of network and blocking disk calls when possible.
- Add tests for interruptible paths and for condition predicates.
- Review whether reentrancy is required or is hiding a design smell (unexpected recursion under the same lock).

## Common Mistakes

- Forgetting `unlock` on an exceptional path (always use `finally`)
- Calling `unlock` from a thread that does not own the lock (`IllegalMonitorStateException`)
- Putting `lock()` inside `try` so a failed acquire still runs `unlock`
- Calling alien/unknown code while holding a lock (deadlock and latency risk)
- Using untimed `tryLock()` and assuming it respects fairness
- Waiting on a `Condition` without a loop
- Using `signal` when multiple waiters may each need to proceed (`signalAll`)
- Treating fair locks as a cure for poor lock ordering
- Holding locks across remote I/O or native calls on virtual threads without measuring pinning/capture
- Synchronizing on a public API object that callers might also lock
- Mixing `synchronized (lock)` on a `ReentrantLock` instance with `lock.lock()` (different mechanisms; do not confuse the lock object with its monitor)

The alien-method rule deserves emphasis. If your locked code calls into plugins, listeners, or subclass methods you do not control, those callees may try to acquire other locks or the same lock in another order. Keep locked regions boring: mutate fields, update local structures, signal conditions, then unlock before calling the outside world. That habit prevents a large class of production deadlocks.

## Quick Reference

| Topic | Fact |
|---|---|
| Package since | Java 5 / JSR 166 |
| Default mode | Unfair |
| Hold tracking | `getHoldCount()` |
| Fair barge hole | Untimed `tryLock()` ignores fairness |
| Conditions | `newCondition()`, await loop, signal/signalAll |
| Engine | AQS + `LockSupport` |
| Max recursion | `Integer.MAX_VALUE` holds |
| Wrong unlock | `IllegalMonitorStateException` |
| Visibility | Unlock happens-before later lock |
| VT note | Parks via LockSupport; `synchronized` pinning fixed in JDK 24 |
| Idiom | `lock()` before `try`; `unlock()` first in `finally` |
| Prefer instead when | Atomics / concurrent collections / no shared mutation fit |

## Conclusion

`ReentrantLock` is the explicit, feature-rich mutual exclusion tool in `java.util.concurrent` for most everyday single-process critical sections in application code. It matches `synchronized` on reentrancy and visibility, then adds timed and interruptible entry, optional fairness, multiple condition queues, and monitoring hooks. Under the hood, AQS CAS-updates a hold count and parks waiters in a CLH-style FIFO queue.

Reach for `synchronized` when simplicity wins. Reach for `ReentrantLock` when the `Lock` API earns its keep. Reach past both when atomics, concurrent collections, read-write or optimistic schemes, semaphores, or a no-shared-mutation design fit the problem better. The lock is a tool for critical sections, not a substitute for clear ownership of state.

If you remember one usage pattern, remember lock outside `try`, unlock first in `finally`, wait on conditions in a loop, and keep alien code out of critical sections. Everything else in this article supports that discipline. Start simple, add `ReentrantLock` features only when a concrete requirement appears, and keep looking for designs that need fewer locks rather than fancier ones.
