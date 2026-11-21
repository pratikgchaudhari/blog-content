---
title: Concurrent vs Synchronized Collections in Java Explained - Wrappers, ConcurrentHashMap and Queues
date: 2026-11-15
summary: A practical comparison of synchronized wrappers, legacy Vector and Hashtable, and java.util.concurrent collections, covering internals, iteration, and how to choose.
tag: java, concurrency, concurrenthashmap, collections, blockingqueue, jsr-166, multithreading, juc
draft: false
related: concurrent-collections-in-java,atomic-classes-in-java,reentrant-lock-in-java-explained,reentrant-lock-in-java,hashtable-vs-hashmap-in-java,how-does-the-volatile-keyword-in-java-work
---

A **thread-safe collection** is one that several threads can use without corrupting its structure or losing updates. Java offers two main families for that job. **Synchronized collections** (`Collections.synchronizedMap`, `Vector`, `Hashtable`) protect every call with a single mutex. **Concurrent collections** (`ConcurrentHashMap`, `CopyOnWriteArrayList`, `BlockingQueue`, and the rest of `java.util.concurrent`) are also thread-safe, but they are not governed by one exclusive lock, so many threads can often make progress at the same time.

That distinction comes from the official `java.util.concurrent` package documentation, and it is the reason a synchronized `HashMap` and a `ConcurrentHashMap` are not interchangeable. The synchronized wrapper is useful when you truly need to lock the entire collection. The concurrent types are the usual choice when many threads share a map, set, or queue.

This article explains why those types exist, how the synchronized wrappers and the main concurrent implementations work, how their iterators differ, and how to choose among them. The APIs below are described as documented for JDK 25 LTS.

## Why Thread-Safe Collections Are Needed

`HashMap` and `ArrayList` are not thread-safe. Two threads that insert, resize, or iterate at the same time can lose updates, observe a broken internal structure, or throw **`ConcurrentModificationException`**.

A lost update is easy to picture on a map used as a counter:

```
Thread A                         Thread B
Integer n = map.get(key);        // 1
                                 Integer n = map.get(key); // 1
map.put(key, n + 1);             // 2
                                 map.put(key, n + 1);      // 2
```

Both threads intended to increment. The map ends at `2`. The same pattern appears as `list.add` races that drop an element, or as a resize in one thread while another is mid-put.

**Fail-fast iterators** on `HashMap`, `ArrayList`, and `HashSet` detect a structural change made after the iterator was created (by this thread or another) and throw `ConcurrentModificationException`. That check is a best-effort warning, not a lock. Wrapping those calls in hope is not enough: `if (!map.containsKey(k)) map.put(k, v)` is two operations, and another thread can run between them even if each call looks safe.

You need a collection (or an external lock around an ordinary one) whenever more than one thread mutates a shared structure, or when one thread mutates while another iterates.

## A Short History

**JDK 1.0** shipped **`Vector`** and **`Hashtable`**. Both synchronize on the collection itself for almost every method. They predate the Collections Framework, and they are still in the JDK, but they are legacy APIs.

**Java 1.2** introduced the Collections Framework and **`Collections.synchronizedXxx`** wrappers: `synchronizedList`, `synchronizedMap`, `synchronizedSet`, and later sorted and navigable variants. You could take a `HashMap` or `ArrayList` and get a thread-safe view that used one mutex, without switching to `Hashtable` or `Vector`.

**Java 5** brought **JSR 166**, led by **Doug Lea**, as `java.util.concurrent`. The package added **`ConcurrentHashMap`**, **`CopyOnWriteArrayList`**, **`CopyOnWriteArraySet`**, **`ConcurrentLinkedQueue`**, and the **`BlockingQueue`** implementations, among other utilities. The design goal was thread safety without a single exclusive lock around the whole structure.

Later releases filled in the set:

- **Java 6** added **`ConcurrentSkipListMap`** and **`ConcurrentSkipListSet`**, concurrent navigable maps and sets built on skip lists, and **`LinkedBlockingDeque`**.
- **Java 7** added **`LinkedTransferQueue`** and **`ConcurrentLinkedDeque`**.
- **Java 8** rewrote **`ConcurrentHashMap`**, added atomic `compute`, `merge`, and `putIfAbsent` style methods as first-class map operations, and added bulk `forEach`, `search`, and `reduce` methods. Bins can treeify under heavy collision, the same idea JEP 180 applied to `HashMap`.
- **Java 9** added convenience factories such as **`List.of`**, **`Set.of`**, and **`Map.of`** for compact immutable collections.

## Synchronized Wrappers

```java
Map<String, Integer> scores =
        Collections.synchronizedMap(new HashMap<>());

scores.put("ada", 1);          // synchronized on the wrapper
int n = scores.get("ada");     // also synchronized on the wrapper
```

The wrapper is a view. Each method acquires a **single mutex** (the wrapper itself, in the usual implementation) and then delegates to the backing collection. All access to the backing collection must go through that view. If you keep a reference to the raw `HashMap` and mutate it directly, you have bypassed the lock.

Individual calls are atomic with respect to that mutex. **Compound actions are not.** This is still racy:

```java
if (!scores.containsKey("ada")) {
    scores.put("ada", 0);
}
```

Another thread can insert `"ada"` between `containsKey` and `put`. To make a compound action atomic, you lock the same mutex the wrapper uses, which is the wrapper itself:

```java
synchronized (scores) {
    if (!scores.containsKey("ada")) {
        scores.put("ada", 0);
    }
}
```

Iteration has a similar rule, and it is stated in the Javadoc. You must **manually synchronize on the returned collection** (for a map, on the map, not on its `keySet`) when traversing it with an `Iterator`, `Spliterator`, or `Stream`. Creating the iterator, and every call to `next`, must happen under that lock:

```java
Set<String> keys = scores.keySet(); // need not be inside the lock

synchronized (scores) {             // lock the map, not keys
    Iterator<String> it = keys.iterator();
    while (it.hasNext()) {
        String key = it.next();
        // use key
    }
}
```

If you skip the lock, you can get `ConcurrentModificationException` or other non-deterministic behavior, because the iterator of a synchronized `HashMap` is still a fail-fast `HashMap` iterator. The wrapper does not change that.

The same mutex also means **all access is serialized**. A `get` on one key waits if another thread is in the middle of a `put` on a different key. That is the trade-off: simple exclusion, poorer scalability when many threads share the collection.

## Legacy Vector and Hashtable

`Vector` and `Hashtable` are synchronized collections in the older style. Almost every public method is a `synchronized` method on the instance, so they have the same single-mutex shape as the wrappers.

`Hashtable` does not allow `null` keys or values, which is the same policy `ConcurrentHashMap` later adopted. `HashMap` allows one `null` key and null values. `Vector` allows `null` elements.

There is little reason to start a new design on these types. A synchronized wrapper around `ArrayList` or `HashMap` is the 1.2-era equivalent, and a concurrent collection is usually a better default today. You still meet `Vector` and `Hashtable` in older APIs, and you should treat their method-level synchronization the same way you treat a wrapper: compound actions and iteration still need an explicit lock on the collection.

## What "Concurrent" Means

The package documentation draws a sharp line. A **synchronized** collection is thread-safe and governed by a single exclusion lock. A **concurrent** collection is thread-safe but not governed by that one lock. In the case of `ConcurrentHashMap`, any number of threads may read, and a large number may write, without locking the entire table.

Most concurrent collections also use **weakly consistent** iterators rather than fail-fast ones. Those iterators may run alongside updates, never throw `ConcurrentModificationException`, traverse the elements that existed at construction exactly once, and may or may not show later changes.

There is no method that locks a `ConcurrentHashMap` as a whole in the way `synchronized (map)` locks a wrapper. If you need a consistent snapshot of every entry, you copy under your own protocol, or you use a type whose iterator already snapshots, such as `CopyOnWriteArrayList`.

## ConcurrentHashMap

`ConcurrentHashMap` is a hash table with **full concurrency of retrievals** and high expected concurrency for updates. Retrievals do not lock. There is no supported way to lock the entire table to freeze all access. A write for a given key *happens-before* a later non-null read of that key that sees the new value.

### Java 7 Segments and the Java 8 Rewrite

Through Java 7, the usual implementation divided the table into **segments**, each a small independently locked hash table. The constructor's `concurrencyLevel` hinted at how many segments to create. Threads writing to different segments could proceed together; a write still locked a whole segment.

**Java 8** replaced that design. The table is an array of bins. An empty bin can be published with **CAS**. A collision chain is updated under a **bin-level `synchronized`** on the first node of that bin, not on a segment and not on the entire map. Retrievals still do not lock. The `concurrencyLevel` constructor argument remains for compatibility, but it is only a sizing hint.

That change is why a Java 8+ `ConcurrentHashMap` behaves more like a modern `HashMap` (including treeified bins) while still allowing concurrent writers on different bins.

### Treeification

When too many keys land in one bin, a long linked list would make lookups slow. In the OpenJDK implementation, a bin can be converted to a balanced tree once it holds enough nodes and the table is large enough (the implementation thresholds are 8 nodes and a table capacity of 64; a smaller table resizes instead). Comparable keys can be ordered in the tree. This is the same collision-handling idea JEP 180 documented for `HashMap` and `LinkedHashMap`, and the concurrent map already used it in the Java 8 rewrite.

Treeification is an implementation detail, not something you call. You still write `put` and `get`. What you should remember is that many keys with the same `hashCode` are still expensive, even in a concurrent map.

### Size and `mappingCount`

`size()` returns an `int`. If the map has more than `Integer.MAX_VALUE` mappings, it returns `Integer.MAX_VALUE`. **`mappingCount()`**, added in Java 8, returns a `long` and is the preferred count when the map might be very large. The documentation states that the value is an **estimate**: concurrent insertions or removals may mean the actual count differs.

Do not use `size() == 0` as a reliable decision in a live map. Between the read and the next operation, the size can change. `isEmpty()` has the same kind of racy reading problem if you use it to decide a later update. For a "do this only once" action, use `putIfAbsent` or `compute` instead of checking the size first.

### Iterators and Nulls

Iterators, spliterators, and enumerations are **weakly consistent**. They do not throw `ConcurrentModificationException`. They are safe to use without an external lock. They may miss or include updates that happen during the traversal.

Like `Hashtable` and unlike `HashMap`, **`ConcurrentHashMap` does not allow null keys or values**. A `get` that returns `null` means the key is absent, not that someone stored null. That rule is also why some of the atomic compute methods can treat null as "not present."

### Atomic `compute`, `merge`, and `putIfAbsent`

These methods give you the compound actions that synchronized maps force you to lock by hand:

```java
ConcurrentHashMap<String, Integer> scores = new ConcurrentHashMap<>();

scores.putIfAbsent("ada", 0);
scores.compute("ada", (key, value) -> value == null ? 1 : value + 1);
scores.merge("grace", 1, Integer::sum);

Integer current = scores.computeIfAbsent("linus", key -> loadInitial(key));
```

`putIfAbsent` inserts only if the key is missing. `compute`, `computeIfPresent`, `computeIfAbsent`, and `merge` apply a function atomically with respect to that key. For `computeIfAbsent`, the JDK 25 documentation states that the entire invocation is performed atomically, the function runs at most once if the key is absent, **some other updates may be blocked while the function runs**, and the function **must not modify the map**. A detectable recursive update throws `IllegalStateException`.

Keep those functions short. Loading a file, calling a remote service, or computing another key inside `computeIfAbsent` holds up other writers that need the same bin, and can deadlock or throw if the function re-enters the map.

A supported pattern for a frequency map is to store a `LongAdder` and increment it outside the compute:

```java
ConcurrentHashMap<String, LongAdder> freqs = new ConcurrentHashMap<>();
freqs.computeIfAbsent(key, k -> new LongAdder()).increment();
```

The compute only installs the adder. The increment does not need to re-enter the map.

### Bulk Operations

Java 8 added `forEach`, `search`, and `reduce` (and keyed and valued variants), including forms that can run with a parallelism threshold. The documentation is clear that a bulk result reflects per-element happens-before relations, but is **not necessarily atomic with respect to the map as a whole** unless the map is known to be quiet. You may see a mix of old and new entries. That is consistent with weakly consistent iteration, not a snapshot of the entire table.

## CopyOnWriteArrayList and CopyOnWriteArraySet

`CopyOnWriteArrayList` is a thread-safe `List` whose mutative operations (`add`, `set`, `remove`, and so on) **copy the underlying array** and install the new array. `CopyOnWriteArraySet` is a set backed by a `CopyOnWriteArrayList`.

Iterators use a **snapshot** of the array at the moment the iterator was created. They never throw `ConcurrentModificationException`, they do not reflect later writes, and they do not support `remove`. Traversal needs no external lock.

The write cost is the reason this type is specialized. Every mutation allocates and copies the current array. The official package documentation says a `CopyOnWriteArrayList` is preferable to a synchronized `ArrayList` when reads and traversals greatly outnumber updates. Listener lists and other mostly-read, rarely-written structures are the usual fit. A hot list that you append to on every request is not.

```java
CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();

listeners.add(listener);          // copies the array

for (Listener listener : listeners) { // snapshot, no lock
    listener.onEvent(event);
}
```

## ConcurrentSkipListMap and ConcurrentSkipListSet

`ConcurrentSkipListMap` is a concurrent **`NavigableMap`**. `ConcurrentSkipListSet` is the set view of that idea, backed by a skip list map. Both keep keys in sorted order and allow concurrent reads and writes.

A skip list is a layered linked structure: lower levels hold all keys, higher levels hold shortcuts, so lookups, inserts, and deletes are expected logarithmic time, in the same complexity class as a balanced tree. The concurrent versions avoid a single tree lock.

Like `ConcurrentHashMap`, they do not allow null keys (and the map does not allow null values). Iterators are weakly consistent. Use this pair when you need a concurrent *sorted* map or set: range views, `ceilingKey`, first and last entries, or a concurrent alternative to a synchronized `TreeMap`. The package documentation says a `ConcurrentSkipListMap` is normally preferable to a synchronized `TreeMap` when many threads access the map.

## ConcurrentLinkedQueue and ConcurrentLinkedDeque

`ConcurrentLinkedQueue` is an unbounded, thread-safe FIFO queue built from linked nodes. `ConcurrentLinkedDeque` is the double-ended version: you can add and remove at both ends. Both are non-blocking in the sense that they use CAS on node links rather than locking the structure, and neither is a `BlockingQueue`. A `poll` on an empty queue returns `null` instead of waiting.

Null elements are not allowed. Iterators are weakly consistent. These types fit work queues and pipelines where producers and consumers already have their own waiting strategy, or where an empty queue is a normal "try again later" case. If a consumer must wait until an element appears, use a `BlockingQueue`.

## The BlockingQueue Family

A **`BlockingQueue`** adds waiting to the queue contract:

- **`put`** waits if the queue is full; **`take`** waits if it is empty.
- **`offer`** and **`poll`** have timed variants that wait up to a timeout.
- The ordinary `add` and `remove` forms throw if they cannot complete immediately.

All of the standard implementations reject null elements. They are the usual way to hand work from producer threads to consumer threads, including thread pools.

| Type | Capacity | Ordering and notes |
| --- | --- | --- |
| `ArrayBlockingQueue` | Bounded, fixed array | FIFO. A full `put` waits for space. |
| `LinkedBlockingQueue` | Optionally bounded (default is a very large limit) | FIFO, linked nodes. In the OpenJDK implementation, put and take use separate locks, so a producer and a consumer can often proceed together. |
| `PriorityBlockingQueue` | Unbounded | Ordered by priority, not insertion. `put` does not wait for space; `take` waits when empty. |
| `DelayQueue` | Unbounded | Elements implement `Delayed` and become available only after their delay. |
| `SynchronousQueue` | No internal capacity | Each `put` waits for a `take`, and each `take` waits for a `put`. A direct handoff, not a buffer. |
| `LinkedTransferQueue` | Unbounded | A `TransferQueue` (Java 7). `transfer` waits until a consumer receives the element; `tryTransfer` can hand off immediately if a consumer is already waiting. |
| `LinkedBlockingDeque` | Optionally bounded | Blocking operations at both ends. |

Executor services often use these queues internally: a fixed pool might sit on an `ArrayBlockingQueue` or a `LinkedBlockingQueue`; a `SynchronousQueue` appears in some cached-pool designs where a task should be handed to a waiting thread rather than buffered. The right queue depends on whether you want a bound (backpressure), a priority order, or a direct handoff.

```java
BlockingQueue<Task> work = new LinkedBlockingQueue<>(1024);

// producer
work.put(task);           // waits if 1024 tasks are already queued

// consumer
Task next = work.take();  // waits if the queue is empty
```

## Immutable Collections

Thread safety sometimes means "no thread writes." **`List.of`**, **`Set.of`**, and **`Map.of`** (Java 9) create compact, structurally unmodifiable collections. Adding, removing, or replacing an element throws `UnsupportedOperationException`. They reject `null` elements (and `Set.of` / `Map.of` reject duplicate keys). They are not views of a later-mutated list.

**`Collections.unmodifiableList`** (and the map and set variants) is different. It is an **unmodifiable view** of a backing collection. Mutations through the view throw, but if another reference still mutates the backing list, those changes show through the view. An unmodifiable wrapper around a live `ArrayList` is not a frozen snapshot.

```java
List<String> live = new ArrayList<>();
live.add("a");
List<String> view = Collections.unmodifiableList(live);
live.add("b");                 // view now also contains "b"

List<String> frozen = List.of("a", "b");
// frozen.add("c") would throw
```

If several threads only read a collection, an immutable copy (`List.of` or `List.copyOf`) or a truly unshared collection is enough. You do not need a concurrent map for a constant lookup table that is built once and never replaced.

`List.copyOf` and `Set.copyOf` (Java 10) make an unmodifiable copy; if the argument is already an unmodifiable list of the right kind, the implementation may reuse it. If the argument is a mutable list, you get a separate frozen copy.

## Fail-Fast, Weakly Consistent, and Snapshot Iteration

| Style | Typical types | ConcurrentModificationException | Sees later updates | External lock needed to iterate |
| --- | --- | --- | --- | --- |
| Fail-fast | `ArrayList`, `HashMap`, synchronized wrappers over those, `Vector.iterator()` | May throw if the structure changes | Not a consistent snapshot | Yes, for shared use (lock the wrapper or collection) |
| Weakly consistent | `ConcurrentHashMap`, concurrent skip lists, `ConcurrentLinkedQueue` | Never | May or may not | No |
| Snapshot | `CopyOnWriteArrayList`, `CopyOnWriteArraySet` | Never | No; frozen at iterator creation | No |

Weakly consistent does not mean "wrong." It means the iterator has a defined, limited promise: each element that existed at construction is visited once, and later updates are optional. If you need a stable picture of a list for the whole traversal, use a snapshot type or copy the contents first.

## Performance and Contention

No single number describes these types, because the cost depends on how many threads write, whether they touch the same keys, and whether iteration is on the hot path. The design differences still give a reliable qualitative picture.

A synchronized wrapper, `Vector`, or `Hashtable` **serializes all access** on one monitor. Under contention, threads queue even for `get` calls on unrelated keys. That is simple and sometimes enough when traffic is low or when you already need the whole-collection lock for a compound action.

`ConcurrentHashMap` spreads writers across bins and leaves readers uncontended by a lock. Contention appears when many threads update the same key, or when a long `compute` function blocks other updates that need that bin. `mappingCount` and bulk operations stay estimates under concurrent mutation.

`CopyOnWriteArrayList` makes reads and iteration cheap and consistent, and makes every write pay for a full array copy. That cost grows with the size of the list.

Skip lists stay logarithmic and concurrent, but a sorted structure has more pointer work than a hash table. If you do not need order, `ConcurrentHashMap` is the usual map.

Bounded blocking queues add waiting, which is often a feature (backpressure) rather than a defect. An unbounded queue can grow until memory is the limit. Choose the bound on purpose.

Measure with a realistic mix of operations. The official guidance is already directional: prefer `ConcurrentHashMap` over a synchronized `HashMap`, `ConcurrentSkipListMap` over a synchronized `TreeMap`, and `CopyOnWriteArrayList` over a synchronized `ArrayList` when reads dominate writes.

## Virtual Threads

Virtual threads, stable since JDK 21, unmount from their carrier when they block on most Java synchronization and I/O. **`BlockingQueue.put` and `take` are a natural fit**: a virtual thread that waits for work parks and releases its carrier, which is the behavior you want in a large number of producers or consumers.

Synchronized wrappers and legacy `Vector` / `Hashtable` use intrinsic monitors. Before **JDK 24**, a virtual thread that blocked inside `synchronized` was **pinned** to its carrier. **JEP 491**, delivered in JDK 24, changed the monitor implementation so that virtual threads can acquire, hold, wait, and release monitors without pinning in nearly all cases. On current JDK 25 LTS, a virtual thread blocked on a synchronized wrapper should not pin for that reason alone.

Pinning is not the only issue. A single mutex still serializes progress even when it no longer pins. Concurrent collections remain the better default when many virtual threads share a map or list. Blocking queues remain the better default when those threads need to wait for elements. Native methods and some other cases can still pin, which is independent of the collection you choose.

## Choosing the Right Collection

```
Need a shared map, no sorted order?
    Many threads, per-key updates     -> ConcurrentHashMap
    Rare sharing, or must lock all    -> Collections.synchronizedMap
    Constant after init               -> Map.of / Map.copyOf

Need a shared sorted map or set?
    ConcurrentSkipListMap / Set

Need a shared list?
    Mostly reads, few writes          -> CopyOnWriteArrayList
    Many writes, index access         -> consider a queue or a map,
                                        or a synchronized List if
                                        you accept a single lock

Need handoff between threads?
    Wait when empty or full           -> BlockingQueue (choose a bound)
    No waiting, CAS queue             -> ConcurrentLinkedQueue / Deque
    Direct handoff, no buffer         -> SynchronousQueue
    Priority or delay                 -> PriorityBlockingQueue / DelayQueue
```

If the collection is confined to one thread, use `ArrayList` or `HashMap`. Thread safety has a cost, and you should not pay it for a local variable.

## Common Mistakes

- **Check-then-act on a synchronized map.** `containsKey` followed by `put` is not atomic. Lock the wrapper, or use `putIfAbsent` / `compute` on a concurrent map.
- **Iterating a synchronized collection without locking it.** The Javadoc requires a `synchronized` block on the returned collection (the map, not its key set). A for-each loop without that lock is incorrect.
- **Keeping a reference to the backing collection** of a synchronized wrapper and mutating it directly, which bypasses the mutex.
- **Long or recursive work in `computeIfAbsent` or `compute`.** The function must stay short, must not modify the map, and can throw `IllegalStateException` on a detectable recursive update. Other writers may be blocked while it runs.
- **Using `size()` or `isEmpty()` for control flow** on a live concurrent collection. The number is an estimate and can change before the next call. Prefer `putIfAbsent`, `compute`, or `take` / `poll`.
- **Storing null in a `ConcurrentHashMap`.** Null keys and values throw `NullPointerException`. Do not port `HashMap` code that uses null as a sentinel without changing the design.
- **Expecting a weakly consistent iterator to be a snapshot.** It will not throw, but it may also not show a write that happens during the loop.
- **Using `CopyOnWriteArrayList` as a general-purpose list.** Frequent writes copy the whole array every time.
- **Choosing an unbounded queue and assuming memory will be fine.** If producers outpace consumers, a `LinkedBlockingQueue` without a bound (or with its default huge bound) can grow without a natural backpressure point.
- **Reaching for `Vector` or `Hashtable` in new code** when a concurrent collection or a clear unmodifiable copy would do.
- **Treating `Collections.unmodifiableList` as a frozen copy** while the backing list is still mutated.

## Quick Reference

| Need | Type |
| --- | --- |
| Concurrent hash map | `ConcurrentHashMap` |
| Concurrent sorted map or set | `ConcurrentSkipListMap`, `ConcurrentSkipListSet` |
| Mostly-read list or set | `CopyOnWriteArrayList`, `CopyOnWriteArraySet` |
| Non-blocking linked queue | `ConcurrentLinkedQueue`, `ConcurrentLinkedDeque` |
| Producer-consumer with waiting | `BlockingQueue` implementations |
| Single-lock thread-safe view | `Collections.synchronizedXxx` |
| Legacy synchronized map or list | `Hashtable`, `Vector` (avoid in new code) |
| Truly unmodifiable data | `List.of`, `Set.of`, `Map.of`, `copyOf` |
| Unmodifiable view of a live collection | `Collections.unmodifiableXxx` |

Iteration: lock the synchronized wrapper; do not lock for weakly consistent or snapshot iterators. Compound updates: lock the wrapper, or use `putIfAbsent` / `compute` / `merge`. `ConcurrentHashMap.size()` can be stale and is capped at `Integer.MAX_VALUE`; prefer `mappingCount()` when you only need an estimate. On JDK 24+, synchronized pinning of virtual threads is largely gone (JEP 491), but a single mutex still serializes access.

## Conclusion

Synchronized collections and concurrent collections both make a structure safe to share, but they do it differently. A wrapper, a `Vector`, or a `Hashtable` uses one mutex. That makes compound actions straightforward if you lock the same object, and it makes iteration correct only when you follow the Javadoc and lock around the iterator. It also means every `get` and `put` competes for that one monitor.

The `java.util.concurrent` types, starting with JSR 166 in Java 5 and refined through Java 8's `ConcurrentHashMap` rewrite and later queues, keep thread safety without that single lock. Readers proceed freely on a `ConcurrentHashMap`. Writers contend at a bin, not across the whole table. Copy-on-write lists snapshot for iterators. Blocking queues park threads until they can proceed, which works well with virtual threads.

Choose the tool that matches the access pattern: a concurrent map for shared key-value state, a skip list when you need order, a copy-on-write list when writes are rare, a blocking queue when threads must wait, a synchronized wrapper only when you truly need to lock the entire collection, and an immutable copy when nothing should change at all. The mistakes to avoid are almost always the same: a check-then-act race, an unlocked iteration of a synchronized view, a long function inside `computeIfAbsent`, and a `size()` check used as if it were a lock.
