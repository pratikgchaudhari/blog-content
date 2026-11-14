---
title: How Java Virtual Threads Work - Continuations, Carrier Threads, Mounting, Pinning and Scheduling
date: 2026-11-14
summary: A detailed look at Java virtual thread internals covering continuations, stack chunks, carriers, the ForkJoinPool scheduler, pinning after JEP 491, and when not to use them.
tag: java, virtual-threads, project-loom, concurrency, jvm, jdk, threads, performance
draft: false
related: virtual-threads-in-java,top-100-java-virtual-threads-interview-questions,thread-per-task-executor,executor-service-types-in-java,completable-future-in-java,virtual-memory-explained,types-of-garbage-collectors-in-java
---

A **virtual thread** is a lightweight `java.lang.Thread` implemented by the JDK rather than by the operating system. It lets you keep the familiar **thread-per-request** style while scaling to huge numbers of concurrent blocking tasks. Under the hood, the JVM mounts many virtual threads onto a smaller set of **platform threads** (OS threads), parks them when they block, and resumes them later.

As of November 2026, the latest GA release is **JDK 27**, and the current LTS is **JDK 25**. Virtual threads themselves have been a final feature since **JDK 21** (JEP 444). JDK 24's **JEP 491** removed the common case of pinning inside `synchronized`. This article explains how that machinery works, what still pins, and how to use the feature without inventing new concurrency problems. The focus is internals and operational guidance, not microbenchmark theater or invented speedup claims either.

## A Short History

Early Java (1.1) offered **green threads**: user-mode threads scheduled by the runtime, often many onto one OS thread. When OS threads matured, the JDK moved to a 1:1 mapping: each Java thread wrapped one OS thread. That model is simple and interoperates well with native code, but OS threads are expensive. Green threads lost because a single OS thread bottlenecked all Java work and because native integration favored real OS threads.

**Project Loom** brought user-mode threads back with M:N scheduling: many virtual threads share fewer OS carriers, while still presenting the familiar `java.lang.Thread` API. The difference from 1990s green threads is the integration with modern blocking JDK APIs, NIO pollers, and a scheduler that can run carriers across all cores.

| Milestone | What Landed |
|---|---|
| JEP 425 (JDK 19) | Virtual threads preview |
| JEP 436 (JDK 20) | Second preview |
| JEP 444 (JDK 21) | Final feature |
| JEP 491 (JDK 24) | `synchronized` / `Object.wait` no longer pin |
| JDK 25 LTS / JDK 27 GA | Current baseline for this article |

Socket and datagram rewrites (JEP 353, JEP 373) prepared the networking stack so blocking calls could unmount virtual threads cleanly. Without those library changes, user-mode threads would still trip over legacy blocking native code in everyday networking.

## Platform Threads and Why They Are Expensive

A **platform thread** is a `Thread` backed by an OS thread for its whole lifetime. Costs add up:

- Each OS thread needs a substantial native stack (often on the order of megabytes reserved, even if not all committed).
- Creating and tearing down OS threads is slow relative to allocating a small Java object.
- Context switches between OS threads involve the kernel scheduler.
- The practical number of concurrent OS threads is limited long before CPU or network capacity is exhausted.

Little's Law makes the problem concrete: for a fixed average latency, higher throughput needs higher concurrency. If each concurrent request occupies one OS thread, the OS thread limit becomes your throughput limit even when CPUs are mostly idle waiting on sockets or databases.

Server apps often pool platform threads to amortize creation cost. Pooling helps startup cost, but it does not raise the ceiling on concurrent blocking work. If each request holds a pooled thread while waiting on I/O, throughput still tracks the pool size. A pool of 200 threads can serve at most 200 blocking requests at once, no matter how large the machine is.

## Thread-Per-Request vs Async

**Thread-per-request** assigns one thread to a request from start to finish. The code stays sequential: loops, try/catch, and stack traces all make sense. Debuggers step through one request on one thread. Profilers attribute time to that request's call stack. The problem is that a blocking read holds an OS thread for the whole wait.

**Async / reactive** styles share a small pool of threads by returning the thread while waiting. Callbacks, `CompletableFuture` pipelines, or reactive streams keep hardware busy, but they split request logic across stages, hide stack context, and fight the platform's natural unit of concurrency: the thread. Tools see threads that interleave many requests, not one clear request story.

Virtual threads keep thread-per-request code and move the sharing into the runtime:

```
Many virtual threads (M)
        |
        v
JDK scheduler mounts / unmounts
        |
        v
Few carrier platform threads (N)
        |
        v
OS schedules those N threads on CPU cores
```

## What a Virtual Thread Is

A virtual thread is still an instance of `java.lang.Thread`. That choice matters: libraries that call `Thread.currentThread()`, use locks keyed by thread identity, or read thread locals keep working. Loom did not introduce a second public "fiber" type that would split the ecosystem.

Application code mostly uses the same APIs:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    IntStream.range(0, 10_000).forEach(i ->
            executor.submit(() -> {
                Thread.sleep(Duration.ofSeconds(1));
                return i;
            }));
}
```

Or:

```java
Thread.startVirtualThread(() -> handle(request));
Thread vt = Thread.ofVirtual().name("worker-" + id).start(task);
```

Key properties (JEP 444):

- Always daemon threads; priority is fixed at `NORM_PRIORITY`.
- Not active members of ordinary thread groups.
- Support thread locals (required for library compatibility).
- `Thread.currentThread()` returns the virtual thread, not its carrier.

Virtual threads are plentiful and cheap to create. **Do not pool them.** Create one per task. Use semaphores or other limiters when you need to bound access to a scarce resource.

They are not "faster threads." A virtual thread running CPU work is scheduled onto a carrier and then onto a CPU core like any other Java thread. The win is scale: many more concurrent waiters than you could afford with OS threads, which raises throughput when latency is dominated by blocking.

## Continuations: The Core Abstraction

Internally, each virtual thread is built around a **continuation**: a one-shot delimited continuation in `jdk.internal.vm.Continuation`. A continuation can:

1. **Run** mounted on a carrier until it yields or finishes.
2. **Yield** (park), copying enough stack state to the heap so the carrier can do other work.
3. **Run** again later, restoring that state onto a carrier (possibly a different one).

```
Continuation.run()
    mount on carrier
    execute Java frames
        |
        +--> blocking JDK call --> Continuation.yield / park
        |         copy frames to heap stack chunks
        |         unmount
        |         carrier free for other virtual threads
        |
        +--> later: ready event --> scheduler submits virtual thread
                  mount again --> thaw frames --> resume
```

`java.lang.VirtualThread` coordinates that lifecycle with parking, timing, and the scheduler. Application code never touches `Continuation` directly; it is an internal building block.

Think of a continuation as a pause button for a call stack. Ordinary platform threads cannot give the OS thread back without finishing or blocking in the kernel. A continuation can freeze mid-method, store enough state to resume later, and free the carrier. That is what makes M:N scheduling practical inside the JVM.

## Stack Chunks and Lazy Copying

Platform thread stacks live in native memory. Virtual thread stacks live in the **Java heap** as **stack chunk** objects. When a virtual thread yields:

- Active frames are **frozen** from the carrier's stack into one or more heap chunks.
- Chunks can grow and shrink as the call stack deepens or unwinds.
- On resume, frames are **thawed** back onto a carrier stack.

The freeze/thaw paths are optimized. Compiled frames often take a fast copy path that copies memory in bulk. Interpreted frames need more bookkeeping because local variable maps and pointers must stay consistent after the chunk moves in the heap. Implementations also use **lazy copying** and related tricks so not every frame is fully rewritten on every yield. The engineering goal is simple: millions of shallow stacks must stay affordable.

A continuation may hold a chain of chunks as the stack grows. When methods return, unused space can shrink again. That elasticity is a major difference from a fixed native stack reservation per platform thread.

Because stacks are ordinary heap objects (linked chunks), they participate in garbage collection like other objects. Unlike platform stacks, virtual thread stacks are not GC roots in the same native sense. Concurrent collectors such as G1 scan them as part of the heap. Very deep stacks can still hit limits related to chunk size and GC region sizing; JEP 444 notes that if a stack grows toward half a G1 region, you can see failures on some configurations. Extremely deep recursion remains a bad idea whether threads are virtual or not.

## Mounting and Unmounting on Carriers

The **carrier** is the platform thread currently executing a virtual thread.

- **Mount**: scheduler assigns the virtual thread to a carrier; the continuation runs.
- **Unmount**: the virtual thread parks; the carrier returns to the scheduler pool.

From Java code, the virtual thread and carrier are separate identities:

- `Thread.currentThread()` is the virtual thread.
- Stack traces for exceptions and dumps do not mix carrier frames into the virtual thread's logical stack.
- Thread locals do not leak between carrier and virtual thread.

From native code's point of view, both run on the same OS thread while mounted. JNI or foreign calls may therefore observe changing OS thread ids across mounts if the scheduler migrates the virtual thread between carriers. Native libraries that cache OS thread identity in a static map can be surprised; that is one reason native frames pin.

Mount and unmount are frequent on a busy server. A single request that performs several JDBC calls and HTTP client calls may park and resume many times. The application code still looks like straight-line blocking Java.

## The Scheduler

The JDK schedules virtual threads with a dedicated work-stealing **`ForkJoinPool` in FIFO mode**. It is separate from the common pool used by parallel streams (LIFO).

Defaults and knobs:

| Property | Role |
|---|---|
| `jdk.virtualThreadScheduler.parallelism` | Target number of carriers; default = available processors |
| `jdk.virtualThreadScheduler.maxPoolSize` | Cap when the pool temporarily expands |

The scheduler does not currently time-slice running virtual threads the way an OS might preempt a long CPU hog among millions of peers. If a virtual thread runs a tight CPU loop, it keeps its carrier until it blocks or finishes. CPU-bound work still belongs on a sized platform-thread pool or the common ForkJoin pool used by parallel streams.

```
Virtual threads ready to run
        |
        v
FIFO ForkJoinPool (parallelism ~= cores)
        |
        v
Carrier platform threads
        |
        v
OS CPU scheduler
```

Tuning tip: raise parallelism only when you have evidence carriers are saturated while CPUs are free for more runnable virtual threads. Raising `maxPoolSize` helps compensation under capture; it is not a substitute for fixing hot pinning or runaway blocking inside native code.

## How Blocking Becomes Cheap

When code on a virtual thread hits a blocking JDK operation that cooperates with Loom, the runtime parks the virtual thread instead of blocking the OS thread for the whole wait.

Examples:

- Network I/O on modern `java.net` / NIO channel implementations
- `LockSupport.park` / unpark (so locks, semaphores, and blocking queues park cleanly)
- `Thread.sleep` and many timed waits

For sockets, readiness is driven by non-blocking OS facilities (for example **epoll** on Linux or **kqueue** on macOS) and **poller** threads in the JDK. When data arrives, the parked virtual thread is submitted back to the scheduler.

JEP 353 and JEP 373 replaced legacy socket implementations so these paths could integrate with virtual threads. Older native socket stacks pinned or blocked carriers in ways that defeated Loom's goals. The rewritten implementations cooperate with parking.

Parking is the common primitive. Higher-level APIs such as locks, blocking queues, and semaphores build on `LockSupport`. When you park a virtual thread, the carrier can mount someone else. When you unpark it, the scheduler queues it for another mount.

```java
// LockSupport parks a virtual thread without holding a carrier for the wait
LockSupport.parkNanos(Duration.ofMillis(50).toNanos());
```

Sleep and many timed waits follow the same idea: release the carrier, resume later on a timer or readiness event.

## Capture and Compensation

Some operations still capture a carrier for a while: notably certain **file I/O** paths and, historically, **`Object.wait`**. When the implementation cannot unmount, the scheduler may **compensate** by temporarily adding carriers so other virtual threads can still run. That is why the carrier count can exceed `parallelism` up to `maxPoolSize`.

Compensation helps availability. It is not a license to pin or capture carriers in a hot path. Prefer APIs that park cleanly for request-volume work.

A mental picture:

```
Park path (good):
  virtual thread blocks on socket
  --> unmount --> carrier free --> other work

Capture path (costly but compensated):
  virtual thread blocks in some file/OS call
  --> carrier stays busy
  --> scheduler may start an extra carrier
```

Compensation has a ceiling (`maxPoolSize`). If too many virtual threads capture carriers at once, you can still stall. Design hot paths to park.

## Pinning: Before and After JEP 491

**Pinning** means a virtual thread cannot unmount while blocked, so its carrier stays occupied.

### JDK 21 Through 23

JEP 444 listed two main pinning cases:

1. Inside a `synchronized` method or block (and related monitor waits)
2. Inside a **native** method or foreign function frame

Why did `synchronized` pin? The HotSpot monitor implementation historically recorded the **carrier platform thread** as the owner. If a virtual thread unmounted inside a monitor, another virtual thread could mount on that carrier and appear to own the same monitor. Mutual exclusion would break. So the JVM refused to unmount while a monitor was held by that implementation strategy.

Pinning did not make programs incorrect, but frequent long pins starved carriers. In the worst case every carrier was pinned in a blocking `synchronized` section and no other virtual thread could run.

### JDK 24 and Later (Including 25 LTS and 27)

**JEP 491** changed monitor ownership tracking so virtual threads hold monitors independently of their carriers. As a result:

- Blocking inside `synchronized` can unmount
- `Object.wait` can unmount and later remount (possibly on another carrier)

Remaining pinning is narrower:

- Native / JNI / Foreign Function & Memory frames on the stack
- Some class-loading and class-initializer waits that involve VM/native frames
- Some local file I/O paths that still capture carriers

| Situation | JDK 21 | JDK 24+ |
|---|---|---|
| Blocking I/O in `synchronized` | Pins | Does not pin (JEP 491) |
| `Object.wait` | Pins | Does not pin (JEP 491) |
| Native / FFM frame | Pins | Still pins |
| Class loading / initializer edge cases | Problematic | Still can pin / capture |
| Linux local file I/O | Often captures | Still often captures |

You no longer need to rewrite every `synchronized` block to `ReentrantLock` just for virtual threads. JEP 491 even says migration away from `synchronized` is no longer required for pinning reasons. Use `ReentrantLock` when you want its extra features (interruptible acquire, fairness, multiple conditions), not only to avoid pinning. Keep critical sections short either way, and avoid holding locks across remote I/O when you can.

The JVM still emits **`jdk.VirtualThreadPinned`** for remaining pin cases, with richer reasons after JEP 491 (for example native frames or class-init waits). That event is the primary production signal now that `jdk.tracePinnedThreads` is gone.

## Thread Locals and Scoped Values

Virtual threads support **`ThreadLocal`** and **`InheritableThreadLocal`**. That keeps libraries working, but millions of virtual threads make "cache an expensive object in a thread local" a bad habit. Prefer shared pools for connections and similar resources, bounded by semaphores or dedicated pools of the scarce resource itself.

**Scoped values** (finalized in **JDK 25**, JEP 506) share immutable context for a bounded dynamic scope and inherit into structured child tasks without copying a full thread-local map. They are usually a better fit for request context than inheritable thread locals when you adopt structured concurrency.

```java
private static final ScopedValue<String> REQUEST_ID = ScopedValue.newInstance();

void handle(Request req) {
    ScopedValue.where(REQUEST_ID, req.id()).run(() -> {
        // callees and structured children can read REQUEST_ID
        process(req);
    });
}
```

Prefer immutable payloads in scoped values. The API is designed for sharing, not for mutable bags updated from many threads.

## Structured Concurrency Status

**Structured concurrency** groups related tasks as one unit of work: fork children, join, cancel together, and keep lifetimes nested.

As of JDK 27 it remains a **preview** API (JEP 533 is the seventh preview in 27). **JEP 543** targets finalization in **JDK 28** without further planned API change. Expect source churn if you track every preview across 25, 26, and 27; factory methods such as `StructuredTaskScope.open()` replaced earlier constructor-based styles in the JDK 25-era previews. Keep experimental code behind preview flags until your production JDK finalizes it.

Virtual threads do not require structured concurrency, but the two features reinforce each other for fan-out work inside a request: one parent scope, many child virtual threads, one join point, coherent cancellation.

## GC Interaction

Virtual thread stacks as heap chunks mean:

- Deep or numerous stacks increase heap usage and GC traffic.
- Stack chunks are collected like other objects when threads finish.
- G1 and other collectors must handle chunk objects efficiently; historically, extremely large chunks interacted poorly with humongous-object thresholds.

Compared with async pipelines, the tradeoff is subtle. Async code allocates stage objects and captured state on the heap; virtual threads keep state in stack locals that live in chunks. JEP 444 argues the overall allocation pressure should be in the same ballpark, with room for the representation to get more compact over time.

In practice, prefer many shallow task stacks over a few enormous ones. That matches how request handlers usually look once frameworks start a virtual thread per request.

## Debugging and Observability

Useful tools:

- `jcmd <pid> Thread.dump_to_file [-format=json] <file>` for the new-style dump that can include huge numbers of virtual threads without the old flat `jstack` shape
- JFR event **`jdk.VirtualThreadPinned`** (enabled by default with a threshold; enhanced after JEP 491 for remaining pin reasons)
- JFR start/end events for virtual threads (optional)
- Debuggers via JVM TI / JDWP / JDI updates that understand virtual threads

The new dump groups threads in a way that scales beyond hundreds of platform threads. Traditional `jstack`-style dumps stay focused on platform threads and are a poor fit for millions of virtual threads. JSON output helps external visualizers.

`-Djdk.tracePinnedThreads` was removed with JEP 491. Setting it on JDK 24+ has no effect. Rely on JFR for pinning diagnostics. The old property printed stacks from sensitive paths and was awkward in production; JFR is the supported replacement.

OS monitors will show fewer OS threads than virtual threads. That is expected: the OS only sees carriers. If your dashboards alert on "thread count," redefine the metric for Loom deployments or you will misread a healthy process as under-threaded.

## When Not to Use Virtual Threads

Virtual threads shine for high-concurrency **blocking I/O**. They are the wrong default when:

- Work is **CPU-bound**. Extra threads past core count do not help; use sized platform pools or parallel streams.
- You **pool virtual threads**. That fights the design. Use `newVirtualThreadPerTaskExecutor` or start one thread per task.
- You need a concurrency limit for a scarce resource. Use a **`Semaphore`** (or similar), not a fixed virtual-thread pool.
- Hot paths still pin on native code or capture carriers on heavy file I/O. Measure with JFR before blaming the scheduler.
- You cache expensive state in thread locals under a one-thread-per-task model.

Also reconsider if your service is already a well-tuned reactive pipeline with real backpressure requirements. Virtual threads simplify blocking code; they do not automatically implement flow control for streaming protocols. Pick the tool that matches the problem shape.

A useful rule from JEP 444: virtual threads help when concurrency is high and tasks spend much of their time waiting. If those conditions are false, stick with ordinary platform threads and ordinary pools.

```java
// Bound calls to a scarce service without pooling virtual threads
Semaphore limit = new Semaphore(20);

void callDownstream() throws InterruptedException {
    limit.acquire();
    try {
        client.invoke();
    } finally {
        limit.release();
    }
}
```

## Spring Boot

Spring Boot can run servlet requests on virtual threads:

```properties
spring.threads.virtual.enabled=true
```

That switches the web server's request threads to virtual threads so existing blocking controllers scale more like Loom's thread-per-request story. Existing Spring MVC controller code that blocks on JDBC or `RestClient` can benefit without a reactive rewrite.

You still need correct connection pool sizes, timeouts, and downstream limits. Virtual threads remove the servlet-thread ceiling; they do not create infinite database capacity. If 50,000 virtual threads each grab a JDBC connection, the pool and the database become the bottleneck, and failures show up as pool waits rather than "out of Tomcat threads."

Reactive stacks such as WebFlux remain useful for streaming, SSE, WebSockets, and backpressure-sensitive flows. Virtual threads are not a mandate to abandon those tools where they fit.

## Common Mistakes

These mistakes show up often when teams treat virtual threads as a drop-in thread pool upgrade instead of a different resource model:

- Creating a fixed pool of virtual threads "for safety."
- Using thread locals as a request-scoped cache copied from platform-thread pool designs.
- Assuming CPU-heavy tasks get faster on virtual threads.
- Ignoring remaining native pinning while chasing micro-optimizations elsewhere.
- Leaving `-Djdk.tracePinnedThreads` in JDK 24+ scripts and thinking it still works.
- Oversizing JDBC pools to "match" unlimited virtual threads.
- Mixing preview structured concurrency APIs across JDK versions without reading the JEP deltas.

## Step by Step Mental Model

1. Request arrives; framework starts a virtual thread.
2. Scheduler mounts it on a carrier and runs your code.
3. Code hits blocking I/O; runtime parks the continuation to heap chunks.
4. Carrier runs another virtual thread.
5. I/O completes; poller or unpark submits the virtual thread again.
6. Scheduler mounts it (maybe on a different carrier) and resumes.

If step 3 cannot unmount because of a native frame, the carrier stays busy until the block ends. That is pinning.

Same story for locks after JEP 491: waiting for a monitor parks and unmounts; when the monitor is free, the virtual thread is submitted again and remounts to retry acquisition. The code still looks like ordinary `synchronized` Java.

```
create virtual thread
   -> mount
   -> run until block
   -> park + unmount (unless pinned)
   -> ... carrier reused ...
   -> ready
   -> mount
   -> run until next block or end
```

## Quick Reference

| Topic | Fact |
|---|---|
| Final feature | JEP 444 in JDK 21 |
| Current LTS / latest GA (Nov 2026) | JDK 25 LTS, JDK 27 GA |
| Scheduler | Dedicated FIFO `ForkJoinPool` |
| Default parallelism | Available processors |
| Stack storage | Heap stack chunks via continuations |
| `synchronized` pinning | Removed in JDK 24 (JEP 491) |
| Remaining pins | Native/FFM, some class-init / file I/O cases |
| `jdk.tracePinnedThreads` | Removed; use JFR `jdk.VirtualThreadPinned` |
| Scoped values | Final in JDK 25 |
| Structured concurrency | Still preview in JDK 27; finalize aimed at 28 |
| Pool virtual threads? | No |
| Limit scarce resources | Semaphores / dedicated resource pools |
| Spring Boot flag | `spring.threads.virtual.enabled` |

## Conclusion

Virtual threads restore scalable thread-per-request programming by implementing `Thread` with continuations, heap-carried stacks, and an M:N carrier scheduler. Blocking JDK calls park and unmount; carriers stay busy with other work. JEP 491 removed the everyday `synchronized` pinning trap, so most business code can adopt virtual threads on JDK 24+ without a lock-API rewrite. Native frames and some file and class-loading paths remain the sharp edges.

On today's JDKs, the practical checklist is short: run JDK 25 LTS or newer when you can, enable virtual threads where requests block on I/O, size connection pools for the database rather than for thread scarcity, watch `jdk.VirtualThreadPinned` if you call native code, and leave structured concurrency behind a preview flag until it finalizes.

Use virtual threads for concurrent blocking work, keep one thread per task, bound scarce resources explicitly, prefer scoped values for shared request context, and verify residual pinning with JFR. The feature is not a faster CPU. It is a cheaper way to wait.
