---
title: Atomic Classes in Java Explained - CAS, Memory Semantics, VarHandle and Adders
date: 2026-11-15
summary: A practical guide to java.util.concurrent.atomic covering CAS, memory semantics, VarHandle, ABA, field updaters, LongAdder, and when locks or volatile are a better fit.
tag: java, concurrency, atomic, cas, varhandle, longadder, multithreading, juc
draft: false
related: how-does-the-volatile-keyword-in-java-work,reentrant-lock-in-java-explained,concurrent-vs-synchronized-collections-in-java,concurrent-collections-in-java,java-virtual-threads-internals,unsafe-class-in-java
---

The **atomic classes** in `java.util.concurrent.atomic` give you lock-free, thread-safe updates to a single variable. An `AtomicInteger` can increment a counter, an `AtomicReference` can swing a pointer, and a `LongAdder` can absorb high-contention sums, without a `synchronized` block or a `ReentrantLock` around that one value. The package is not a drop-in replacement for `Integer` or `Long`. The official documentation is explicit: these types do not define useful `equals`, `hashCode`, or `compareTo` methods, and they are poor hash table keys because they are meant to be mutated.

The classes arrived with **JSR 166**, the concurrency utilities led by **Doug Lea**, and shipped in **Java 5**. Java 8 added the striped adders and accumulators, plus functional update methods such as `getAndUpdate`. **Java 9** introduced **`VarHandle`**, now the documented foundation for these memory effects and the preferred way to apply the same operations to ordinary fields. The descriptions below follow the JDK 25 LTS documentation; later JDK API pages still list these methods.

This article explains why atomics exist, how compare-and-swap works, how the core APIs and memory modes behave, and where people go wrong.

## Why Atomics Exist

A race condition appears when two threads read and write shared state and the result depends on the interleaving. The usual Java example is a plain `int` counter:

```
Thread A                  Thread B
read count  -> 0
                          read count  -> 0
add 1       -> 1
                          add 1       -> 1
write count <- 1
                          write count <- 1
```

Both threads intended to increment. The final value is `1`. The expression `count++` looks like one step, but it is a **read, add, and write**. Those three actions are not atomic on a plain field.

Declaring the field `volatile` does not fix this. **`volatile` gives visibility and ordering**: a write to a volatile variable *happens-before* later reads of that same variable by other threads, in the Java Memory Model sense. It does not make a compound update atomic. Two threads can still both read `0` and both write `1`.

A lock does fix the increment, because the whole read-modify-write runs inside a critical section:

```java
private int count;
private final Object lock = new Object();

public void increment() {
    synchronized (lock) {
        count++;
    }
}
```

`synchronized` and `ReentrantLock` are the right tools when you must protect several fields, wait on a condition, or enforce a multi-step invariant. They are heavier than a single-variable atomic update: under contention a thread may park, and you pay for mutual exclusion even when all you needed was "add one to this counter." Atomics exist for the narrower case. They update one value with a hardware-level atomic operation, usually without blocking.

```
Need visibility only?          -> volatile field
Need an atomic single update?  -> atomic class or VarHandle
Need a multi-step invariant?   -> synchronized or ReentrantLock
Need a high-contention sum?    -> LongAdder or LongAccumulator
```

## A Short History

JSR 166 was finalized in 2004 and landed in Java 5 as `java.util.concurrent`. The expert group, led by Doug Lea, standardized locks, executors, concurrent collections, and **atomic variables**. Before that, developers either used `synchronized` or reached for unsupported low-level hooks.

**Java 8**, through work described in JEP 155, added `LongAdder`, `DoubleAdder`, `LongAccumulator`, and `DoubleAccumulator`. These classes relax the idea of a single always-exact variable so that heavily contended sums can scale better. The same release added `getAndUpdate`, `updateAndGet`, `getAndAccumulate`, and `accumulateAndGet`.

**Java 9**, through JEP 193, added `java.lang.invoke.VarHandle`: a typed reference to a field, array element, or similar variable, with access modes for plain, opaque, acquire, release, and volatile reads and writes, plus compare-and-set and related updates. It gave the platform a supported replacement for many `sun.misc.Unsafe` operations and a single specification for the memory effects the atomic classes already provided. Since Java 9, `AtomicInteger.get()` is specified in terms of `VarHandle.getVolatile`, `set` in terms of `setVolatile`, and `lazySet` in terms of `setRelease`. Field updaters predate VarHandle. Current documentation still includes them, describes them as more limited, and points new code at VarHandle instead.

## Compare-And-Swap

**Compare-and-swap (CAS)** is the primitive behind almost every atomic update: if the variable still holds the value you last saw, replace it with the new value; otherwise the attempt fails.

```java
AtomicInteger count = new AtomicInteger(0);

boolean ok = count.compareAndSet(0, 1); // true if the value was 0
int previous = count.get();             // 1 when the CAS succeeded
```

`compareAndSet` returns `true` only when the current value was equal to the expected value and the swap happened. A `false` result means some other thread changed the variable first, or, for a weak variant, that the attempt failed even if the value still matched.

Java 9 added `compareAndExchange`, which returns the **witness value**: the value actually seen in the variable. On success it equals the expected value. On failure it is the current value, which you can use on the next attempt without a separate `get`.

```java
int witnessed = count.compareAndExchange(1, 2);
if (witnessed == 1) {
    // the swap to 2 succeeded
} else {
    // witnessed is the live value; try again with that
}
```

`compareAndExchangeAcquire` and `compareAndExchangeRelease` offer the same exchange with weaker ordering than full volatile effects.

### How CAS Maps to the CPU

On typical JVMs, these methods are **intrinsics**. The JIT emits a single atomic instruction, or a short sequence the hardware treats as atomic, rather than an ordinary method call.

On x86, the usual instruction is **`LOCK CMPXCHG`** (and its wider forms). The `LOCK` prefix makes the update atomic with respect to other processors. Other instruction sets use different primitives, such as load-linked and store-conditional pairs, or their own compare-exchange instructions. You call `compareAndSet` or a VarHandle access mode, and the runtime maps that call onto what the CPU provides.

Atomic increments such as `getAndAdd` are also intrinsics. On platforms that have an atomic add, the JVM can use it directly. Otherwise the implementation falls back to a CAS loop.

### Retry Loops

A failed CAS is normal under contention. The usual pattern is to read, compute a new value, and retry until the swap succeeds:

```java
public static void addPositive(AtomicInteger value, int delta) {
    int current;
    int next;
    do {
        current = value.get();
        next = current + delta;
        if (next < current) {
            throw new ArithmeticException("overflow");
        }
    } while (!value.compareAndSet(current, next));
}
```

`getAndUpdate` and `updateAndGet` are this loop, packaged:

```java
value.updateAndGet(current -> current + delta);
```

The function you pass **must be side-effect-free**. The documentation states that it may be re-applied when updates fail because of contention. Logging or updating other state from inside that function can run more than once.

**Weak** CAS methods (`weakCompareAndSetPlain`, `weakCompareAndSetVolatile`, `weakCompareAndSetAcquire`, `weakCompareAndSetRelease`) may fail spuriously even when the expected value still matches. Some hardware CAS sequences can fail without a conflicting store, and a retry loop can tolerate that. For application code, `compareAndSet` is the usual choice. The older `weakCompareAndSet` method, without a suffix, has been **deprecated since Java 9**. It has plain memory effects, but the name suggested volatile effects. Use `weakCompareAndSetPlain` if you want those same plain semantics.

## The Core Atomic Classes

`AtomicBoolean`, `AtomicInteger`, `AtomicLong`, and `AtomicReference` each wrap one variable of the corresponding type. `AtomicInteger` and `AtomicLong` extend `Number` so utilities can treat them as numeric values, but they are not interchangeable with `Integer` or `Long`.

### AtomicInteger and AtomicLong

These two share the same shape. `AtomicLong` uses `long` arguments and results:

```java
AtomicInteger n = new AtomicInteger(10);

int seen = n.get();            // volatile read, 10
n.set(20);                     // volatile write
n.lazySet(30);                 // release write; see memory semantics below

int before = n.getAndSet(40);  // returns 30, value is now 40

int old = n.getAndIncrement(); // returns 40, value is now 41
int now = n.incrementAndGet(); // value becomes 42, returns 42
n.getAndAdd(8);                // returns 42, value is now 50
n.addAndGet(-5);               // value becomes 45, returns 45

n.compareAndSet(45, 100);
n.updateAndGet(v -> Math.max(v, 50));
n.accumulateAndGet(3, Integer::sum);
```

`getAndIncrement` returns the value **before** the increment. `incrementAndGet` returns the value **after**. The same prefix and suffix pattern applies to decrement and add. Mixing them up is a common source of off-by-one bugs in sequence numbers. `getAndUpdate` returns the previous value; `updateAndGet` returns the new one. `getAndAccumulate` and `accumulateAndGet` take a value and a binary operator: the current value is the first argument, the supplied value is the second.

### AtomicBoolean

`AtomicBoolean` is the flag type. It has `get`, `set`, `lazySet`, `getAndSet`, `compareAndSet`, the Java 9 memory-mode methods, and the weak CAS variants, but no increment methods. A typical use is a one-time start or shutdown latch:

```java
private final AtomicBoolean started = new AtomicBoolean(false);

public void start() {
    if (started.compareAndSet(false, true)) {
        // this thread won the right to start the service
    }
}
```

### AtomicReference

`AtomicReference<V>` holds an object reference and compares it with `==`, not `equals`. That matters if you store value objects and expect two equal instances to CAS as if they were the same.

```java
AtomicReference<Config> config = new AtomicReference<>(Config.defaults());

config.updateAndGet(current -> current.withTimeout(Duration.ofSeconds(5)));
```

Build a new immutable value from the one you just read. If you mutate the object already stored in the reference, other threads may see a half-applied change, and a later CAS may succeed or fail for the wrong reason because the reference identity never changed.

### Reading the Method Names

- **`get` / `set`**: volatile read and volatile write.
- **`lazySet`**: release write (documented as `VarHandle.setRelease`).
- **`getAndX`**: return the old value, then apply X.
- **`xAndGet`**: apply X, then return the new value.
- **`compareAndSet`**: boolean CAS with volatile effects.
- **`compareAndExchange`**: CAS that returns the witness value (Java 9).
- **`weakCompareAndSet*`**: may fail spuriously; the suffix is the memory mode.

## Memory Semantics

Atomics are not only about making one write atomic. They also define how that write relates to other memory accesses in the Java Memory Model.

### Volatile Semantics and Happens-Before

`get()` and `set()` on the atomic classes have the same memory effects as a volatile read and a volatile write of the wrapped variable. A successful `compareAndSet`, and the `getAnd*` / `*AndGet` updates, are specified in terms of the corresponding VarHandle operations, which also use volatile-strength effects unless the method name says otherwise.

A volatile write *happens-before* a later volatile read of the same variable that sees that write. Ordinary writes that happened before the volatile write in the writing thread become visible to ordinary reads after that volatile read in the reading thread. This is why an atomic flag can publish a payload prepared before the flag is set:

```java
class ReadyHolder {
    private String payload; // written only by the publisher, before set
    private final AtomicBoolean ready = new AtomicBoolean(false);

    public void publish(String value) {
        payload = value;
        ready.set(true);
    }

    public String takeIfReady() {
        if (!ready.get()) {
            return null;
        }
        return payload;
    }
}
```

If `takeIfReady` sees `ready` as `true`, it is allowed to see the `payload` write that happened before that `set`. This is the same publication pattern as a volatile boolean. It is not enough if more than one thread writes `payload`, or if the publisher keeps mutating it after the flag is set.

### Plain, Opaque, Acquire, and Release (Java 9)

Since Java 9, the atomic classes expose the VarHandle access modes directly:

| Method | Documented effect |
| --- | --- |
| `getPlain` / `setPlain` | As if the variable were a non-volatile (and, for the write, non-final) field |
| `getOpaque` / `setOpaque` | Bitwise atomic and coherently ordered with other accesses to the same variable, without the stronger cross-variable ordering of acquire, release, or volatile |
| `getAcquire` | Acquire read: later accesses in this thread are not reordered before it |
| `setRelease` | Release write: earlier accesses in this thread are not reordered after it |
| `get` / `set` | Volatile read and write, totally ordered with respect to other volatile operations |

`setRelease` and a later `getAcquire` on the same variable form the lighter publication pair. Volatile is stronger: volatile operations are totally ordered with respect to each other. Plain accesses do not give you those cross-thread ordering guarantees. Most application code should stay on `get`, `set`, and `compareAndSet`. The weaker modes exist for reviewed concurrent data structures. Using `setPlain` for a flag that also publishes other fields is a visibility bug.

### `lazySet`

`lazySet` has been on the atomic classes since Java 6. Today it is specified as a `VarHandle.setRelease` write: a release store, not a volatile store, and not a write that may show up at an arbitrary later time. Use it when you want to publish a value without the stronger total order of `set`. If you are unsure, `set` is the conservative choice.

## The ABA Problem

CAS asks only whether the value equals the expected value. It does not ask whether the variable went through other values in between. That gap is the **ABA problem**.

```
Time    Variable    What happened
1       A           Thread 1 reads A and is then delayed
2       B           Thread 2 changes A to B
3       A           Thread 2 changes B back to A
4       A           Thread 1 CAS from A to C, and it succeeds
```

Thread 1 believes nothing changed. Something did: the value returned to `A` after other work. If `A` is a pointer into a linked structure, the node may now have a different `next` pointer, or it may have been reused. The CAS still succeeds because the reference bits match. This shows up most often in lock-free lists, stacks, and queues that recycle nodes. A simple incrementing `AtomicInteger` is much less exposed, because an increment is not usually a structural change that returns to a prior pointer.

### AtomicStampedReference

`AtomicStampedReference<V>` stores a reference and an `int` stamp together, and updates them atomically. The stamp is typically a version number:

```java
AtomicStampedReference<Node> ref =
        new AtomicStampedReference<>(head, 0);

int[] stampHolder = new int[1];
Node current = ref.get(stampHolder);
int stamp = stampHolder[0];
Node next = current.next;

boolean ok = ref.compareAndSet(current, next, stamp, stamp + 1);
```

A thread that saw version `7` cannot CAS successfully against a reference that was changed and then restored at version `9`, even if the reference bits look the same. The stamp is an `int`, so it can wrap. That is usually far enough for practical versioning, but it is still a finite counter, not a proof against every ABA case.

### AtomicMarkableReference

`AtomicMarkableReference<V>` stores a reference and a single boolean mark, updated atomically. A common use, mentioned in the package documentation, is to mark a referenced object as logically deleted:

```java
AtomicMarkableReference<Node> ref =
        new AtomicMarkableReference<>(node, false);

boolean[] mark = new boolean[1];
Node current = ref.get(mark);
if (mark[0]) {
    // already marked deleted
} else {
    ref.compareAndSet(current, current, false, true);
}
```

The mark is a bit you can flip with the reference, not a version number. Use a stamped reference when you need a counter, and a markable reference when you need one extra flag.

## Atomic Arrays

`AtomicIntegerArray`, `AtomicLongArray`, and `AtomicReferenceArray` give atomic, **volatile-element** access to each slot. A plain `int[]` does not. Declaring the array reference `volatile` only makes the reference itself volatile. Element reads and writes remain ordinary array accesses.

```java
AtomicIntegerArray counts = new AtomicIntegerArray(16);

counts.set(3, 10);
int previous = counts.getAndIncrement(3);
boolean swapped = counts.compareAndSet(3, 11, 20);
```

Indexes are bounds-checked like a normal array. These classes are useful for striped counters and histograms where each slot is updated independently. If every thread updates the same index, you still have one contended variable, just stored inside an array object.

## Field Updaters

`AtomicIntegerFieldUpdater`, `AtomicLongFieldUpdater`, and `AtomicReferenceFieldUpdater` are reflection-based tools that apply atomic updates to a named field of a class. They exist so a data structure can keep several independently updated fields in one node, without wrapping each field in its own atomic object.

The field must be a **non-static `volatile`** field of the matching type (`int`, `long`, or a reference type). `newUpdater` checks the type and volatility, and it applies ordinary Java access control: the caller must be allowed to access the field. A static field is not accepted. The updater is usually a `static final` field created next to the class that owns the volatile field.

```java
public final class HitCounter {
    private volatile int hits;

    private static final AtomicIntegerFieldUpdater<HitCounter> HITS =
            AtomicIntegerFieldUpdater.newUpdater(HitCounter.class, "hits");

    public int hit() {
        return HITS.incrementAndGet(this);
    }
}
```

The guarantees are weaker than those of `AtomicInteger`. The documentation states that `compareAndSet` is atomic with respect to other calls to `compareAndSet` and `set` on the **same updater**, but not necessarily with respect to other writes to the field. A direct assignment to `hits` can break those assumptions. These classes predate VarHandle and are awkward to set up. New code should prefer a VarHandle:

```java
public final class HitCounter {
    private volatile int hits;

    private static final VarHandle HITS;

    static {
        try {
            HITS = MethodHandles.lookup()
                    .findVarHandle(HitCounter.class, "hits", int.class);
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    public int hit() {
        return (int) HITS.getAndAdd(this, 1);
    }
}
```

VarHandle supports the same family of access modes, including acquire and release, and it is the API the atomic classes are specified against.

## LongAdder, LongAccumulator, and DoubleAdder

Under heavy contention, many threads CAS on the same `AtomicLong`. Most of them fail, retry, and fight over one cache line. JEP 155 added a different design for sums and accumulated values that are used as statistics, not as a single synchronization point.

`LongAdder` maintains an initially zero `long` sum across **one or more variables**. When updates are contended, the set of variables can grow so that threads spread their adds out. `sum()` (and `longValue()`) adds those variables together.

```java
LongAdder requests = new LongAdder();

requests.increment();
requests.add(10);
long total = requests.sum();
```

The official documentation says this class is usually preferable to `AtomicLong` when many threads update a common sum for statistics, not for fine-grained synchronization control. Under low contention the two classes behave similarly. Under high contention, expected throughput is significantly higher, at the cost of more space.

`sum()` is **not an atomic snapshot**. If updates happen while the sum is being computed, some of them might not be included. `reset()` is only effective when there are no concurrent updates; the documentation calls it intrinsically racy. `sumThenReset()` is meant for quiet points between phases, and concurrent updates can mean the returned value is not the last value before the reset.

A common pairing is a frequency map:

```java
ConcurrentHashMap<String, LongAdder> freqs = new ConcurrentHashMap<>();

freqs.computeIfAbsent(key, k -> new LongAdder()).increment();
```

`DoubleAdder` is the same idea for `double` sums. `LongAccumulator` and `DoubleAccumulator` take a side-effect-free binary function and an identity, and apply that function across striped variables. You would use an accumulator for a running maximum, for example, rather than a plain sum.

Do not use an adder as a sequence number, a version stamp, or a condition that other threads wait for. Those uses need a single, exactly readable value, which is what `AtomicLong` provides.

## From Unsafe to VarHandle

For years, concurrent libraries implemented CAS on fields with `sun.misc.Unsafe` (and later `jdk.internal.misc.Unsafe`): `compareAndSwapInt`, `getAndAddLong`, raw field offsets, and so on. That API is unsupported for application code, tied to JVM internals, and easy to use unsafely.

JEP 193 introduced VarHandle as the standard way to request those operations on fields and array elements, with explicit memory-ordering modes and fence operations. The atomic classes are now specified in terms of those modes. Inside the JDK, implementations use VarHandle, and in hot methods the JIT still emits the same kinds of instructions that Unsafe once produced.

For a new lock-free structure, use the atomic classes for standalone values and VarHandle for fields inside your own nodes. Field updaters remain for older code. Unsafe should not be the default.

## False Sharing and @Contended

**False sharing** happens when two logically independent variables sit on the same CPU cache line. A write to one invalidates the line for every core that is using the other, so two threads contend even though they never touch the same field.

```
One cache line (typical size is 64 bytes, sometimes more):

|  AtomicLong A  |  AtomicLong B  |  ... padding or other fields ... |
       ^                  ^
   Thread 1 writes    Thread 2 writes
   both pay for the same line bouncing between cores
```

This is one reason a heavily used `AtomicLong` can slow down more than the CAS loop alone would suggest, and one reason `LongAdder` helps: updates spread across separately allocated cells rather than one packed field.

JEP 142 defined a way to tell the VM that a field or object is likely to be contended, so the layout can isolate it with padding. In current JDKs that hint is the **`@Contended`** annotation in the internal package `jdk.internal.vm.annotation`. The JDK uses it in its own concurrent machinery. For application classes, HotSpot ignores the annotation unless you opt in with JVM flags (historically `-XX:-RestrictContended`), and compiling against it requires exporting that internal package. Padding also increases object size.

For most application counters, do not pack many hot atomics into one small object if different threads write them, prefer `LongAdder` for contended sums, and treat `@Contended` as a specialized JDK-internal tool rather than a regular API.

## Performance Under Contention

Uncontended atomic operations are cheap: one atomic instruction, no park, no queue. Once many threads CAS on the same variable, the cost shifts to retries and cache-line movement. Throughput can fall even though no thread is blocked in the usual lock sense.

A few practical rules follow from the APIs:

- If the value is a statistic and approximate reads are acceptable, prefer `LongAdder` or `LongAccumulator` once you have real contention on an `AtomicLong`.
- If the value is a sequence, a size used for control flow, or a published reference, stay with the single-variable atomic classes so every reader sees one exact location.
- Retry loops should do as little as possible between `get` and `compareAndSet`. Expensive work in that window increases failed retries.
- Update functions passed to `getAndUpdate` and friends must be cheap as well as side-effect-free, because they may run more than once.
- Independently updated values belong in several variables, an atomic array, or VarHandle-backed fields, not in one `AtomicReference` to a mutable bundle unless you truly need a single atomic snapshot.

Measure with a realistic thread count and a profiler. A quiet counter and a hot histogram do not need the same tool.

## Atomics and Virtual Threads

Virtual threads, stable since JDK 21, are scheduled onto a smaller pool of carrier platform threads. A virtual thread **pins** its carrier when the runtime cannot unmount it, which historically happened when it blocked inside a `synchronized` monitor. JEP 491 later removed that pinning for `synchronized` in current JDK lines. The distinction is still useful here: **atomic operations do not pin**.

A CAS, `getAndIncrement`, or VarHandle update is CPU work. It does not wait on a monitor and does not park for I/O. Many virtual threads can increment an `AtomicInteger` or `LongAdder` without the pinning that blocking lock acquisition used to introduce. They can still contend on the same variable. That contention is about cache lines and retries, not pinning.

If you need to wait until a condition becomes true, an atomic variable alone does not give you a wait queue. Busy-spinning wastes CPU. A lock and a `Condition`, a `CountDownLatch`, a `Semaphore`, or another synchronizer can park the thread. Atomics and locks solve different parts of that design.

## A Lock-Free Structure: The Treiber Stack

A **Treiber stack** is the standard small example of a lock-free structure built on CAS. The stack is a linked list. `push` and `pop` swing the head reference only when it has not changed since it was read.

```java
public final class TreiberStack<E> {
    private final AtomicReference<Node<E>> head = new AtomicReference<>();

    private static final class Node<E> {
        final E value;
        Node<E> next;

        Node(E value) {
            this.value = value;
        }
    }

    public void push(E value) {
        Node<E> node = new Node<>(value);
        Node<E> current;
        do {
            current = head.get();
            node.next = current;
        } while (!head.compareAndSet(current, node));
    }

    public E pop() {
        Node<E> current;
        Node<E> next;
        do {
            current = head.get();
            if (current == null) {
                return null;
            }
            next = current.next;
        } while (!head.compareAndSet(current, next));
        return current.value;
    }
}
```

Each successful CAS publishes a new head. A failed CAS means another thread pushed or popped first, so the loop rereads and tries again. There is no lock to forget to release, and no monitor for a virtual thread to pin on. The design is still subject to ABA if nodes are recycled and a popped node is pushed again with a stale `next`. Fresh allocations, as in the example above, avoid that reuse path. A structure that pools nodes would typically add a stamp, or otherwise account for ABA.

A Treiber stack is a useful primitive, not a general replacement for `ConcurrentLinkedDeque` or a blocking queue.

## Choosing Among synchronized, ReentrantLock, volatile, and Atomics

These tools overlap, but they are not interchangeable:

| Tool | What it gives you | What it does not |
| --- | --- | --- |
| `volatile` field | Visibility and ordering for a single variable | Atomic compound updates such as `++` |
| `AtomicInteger` and siblings | Atomic updates and volatile-strength reads and writes on one value | Multi-field invariants, waiting, exclusion of a code block |
| `LongAdder` / accumulators | Scalable updates to a sum or accumulated value | An exact snapshot under concurrent updates, or a single sequenced value |
| `synchronized` | Exclusion, implicit memory barriers, `wait` / `notify` | Fine-grained control of interruptible or timed entry |
| `ReentrantLock` | The same exclusion model with interruptible and timed locking, optional fairness, and multiple conditions | A cheaper path than an atomic when all you need is one increment |

Use `volatile` when every write already publishes a complete value and no thread needs a read-modify-write. Use an atomic class when the new value depends on the old one, or when you need CAS. Use a lock when several pieces of state must change together, or when a thread must wait. Use an adder when many threads update a statistic and readers can tolerate `sum()`'s documented softness.

## Common Mistakes

- **Treating `count++` on a volatile field as atomic.** Volatility is not atomicity. Use `incrementAndGet` or a lock.
- **Check-then-act across two atomics.** Reading `a.get()` and `b.get()` and then updating one of them is not one atomic decision. If the two values must stay together, store one immutable holder in an `AtomicReference`, or use a lock.
- **Compound logic spread across several CAS calls.** Each CAS is atomic. The sequence is not, unless you design a larger protocol.
- **Side effects inside `getAndUpdate`, `updateAndGet`, or accumulator functions.** The function may run repeatedly. Keep it pure.
- **Using `LongAdder` where you need an exact, single value.** Sequence numbers, sizes used to decide a branch, and stamps belong on `AtomicLong`.
- **Calling `reset()` or `sumThenReset()` on a live adder.** Those methods are racy unless updates have stopped.
- **Mutating the object stored in an `AtomicReference`.** CAS watches the reference, not the object's fields. Publish a new immutable value.
- **Assuming CAS uses `equals`.** It uses `==`. Two equal but distinct objects do not match as the expected value.
- **Using deprecated `weakCompareAndSet`.** Prefer `compareAndSet`, or `weakCompareAndSetPlain` if you truly want plain weak CAS.
- **Using a field updater on a non-volatile or static field, or writing the field directly.** The updater rejects the wrong kind of field at creation, and direct writes bypass its weaker guarantees.
- **Ignoring ABA in a structure that recycles nodes.** Stamps or designs that do not reuse nodes are the usual remedies.
- **Packing unrelated hot counters in one object.** False sharing is a layout issue, not a bug in CAS itself.
- **Using atomics as hash map keys.** They are mutable and do not define value equality.

## Quick Reference

| Need | Start with |
| --- | --- |
| Atomic increment or add | `AtomicInteger` / `AtomicLong` |
| High-contention statistic | `LongAdder` / `DoubleAdder` / accumulators |
| Atomic flag | `AtomicBoolean` |
| Atomic pointer or immutable snapshot | `AtomicReference` |
| Versioned reference | `AtomicStampedReference` |
| Reference plus deleted bit | `AtomicMarkableReference` |
| Atomic slots in an array | `AtomicIntegerArray` and siblings |
| Atomic field inside a node | `VarHandle` (field updaters only for older code) |
| Visibility without a compound update | `volatile` |
| Multi-field invariant or waiting | `synchronized` or `ReentrantLock` |

Core methods: `get` and `set` are volatile; `lazySet` is a release write; `compareAndSet` returns a boolean; `compareAndExchange` returns the witness value; `getAndIncrement` returns the old value; `incrementAndGet` returns the new one; update functions must be side-effect-free. `weakCompareAndSet` has been deprecated since Java 9.

## Conclusion

The atomic classes are a small toolkit for a precise job: update one variable safely, with well-defined memory effects, without taking a lock. They exist because `count++` is not atomic, because `volatile` does not make it atomic, and because a lock is the wrong default for a single counter or a single pointer swing.

CAS is the mechanism, usually a single CPU instruction such as `LOCK CMPXCHG` on x86, wrapped in a retry loop when the value has moved. The Java 5 types cover the common cases. Java 8 added scalable adders and functional updates. Java 9 made `VarHandle` the supported foundation for those effects, including plain, opaque, acquire, and release modes, and a safer replacement for Unsafe atomics.

Choose the tool that matches the invariant. An `AtomicLong` is the exact location you need for a sequence. A `LongAdder` is the right shape for a busy total that is only summed for statistics. A lock is still what you want when several fields must change together. Read the memory semantics, keep update functions pure, watch for ABA when you recycle nodes, and treat contention as a design signal, not a reason to invent a more clever CAS loop.
