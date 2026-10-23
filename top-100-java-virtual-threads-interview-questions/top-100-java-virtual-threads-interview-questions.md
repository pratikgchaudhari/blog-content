---
title: Top 100 Java Virtual Threads Interview Questions
date: 2026-10-23
summary: A concise collection of the top 100 Java Virtual Threads interview questions with short, crisp answers for quick preparation.
tag: java, virtual-threads, project-loom, concurrency, interview-questions
draft: false
---

1. **What are Virtual Threads in Java?**
   Lightweight threads managed by the JVM (not the OS), introduced as a final feature in Java 21 (JEP 444) via Project Loom. They enable high concurrency with minimal resource overhead.

2. **What problem do Virtual Threads solve?**
   They solve the scalability issues of platform threads for I/O-bound workloads, allowing millions of concurrent tasks without the memory and scheduling costs of OS threads.

3. **How do Virtual Threads differ from Platform Threads?**
   Platform threads map 1:1 to OS threads (expensive, ~1MB stack). Virtual threads are JVM-scheduled, multiplexed onto fewer carrier threads, and unmount during blocking I/O.

4. **What is a Carrier Thread?**
   A platform (OS) thread onto which the JVM mounts a virtual thread for execution. Virtual threads can be mounted/unmounted from different carriers over their lifetime.

5. **What is Project Loom?**
   The OpenJDK project that introduced virtual threads, structured concurrency, and scoped values to improve Java's concurrency model.

6. **In which Java version were Virtual Threads finalized?**
   Java 21 (JEP 444). They were previewed in Java 19 and 20.

7. **Are Virtual Threads faster than Platform Threads?**
   No. They do not speed up CPU-bound work. Their benefit is in scalability for blocking I/O tasks through efficient unmounting.

8. **What is the typical memory footprint of a Virtual Thread?**
   Starts small (a few hundred bytes to a few KB) and grows on demand, compared to ~1MB fixed for platform threads.

9. **How many Virtual Threads can you create?**
   Millions, limited mainly by available heap memory rather than OS thread limits.

10. **How do you create a Virtual Thread?**
    `Thread.startVirtualThread(() -> { ... });` or `Thread.ofVirtual().start(...);` or via `Executors.newVirtualThreadPerTaskExecutor()`.

11. **What is `Executors.newVirtualThreadPerTaskExecutor()`?**
    An executor that creates a new virtual thread for each submitted task. Prefer this over pooling virtual threads.

12. **Should you pool Virtual Threads?**
    No. They are cheap to create. Pooling defeats their purpose. Use one per task and limit concurrency via semaphores or admission control if needed.

13. **What happens when a Virtual Thread blocks on I/O?**
    It is unmounted from its carrier thread. The carrier is free to run another virtual thread. The original is remounted when I/O completes.

14. **What is pinning in the context of Virtual Threads?**
    When a virtual thread cannot be unmounted from its carrier during a blocking operation, holding the carrier hostage and reducing scalability.

15. **What causes pinning in Java 21?**
    Blocking inside a `synchronized` block/method, or while executing native methods/foreign functions (JNI/FFM).

16. **Was the synchronized pinning issue fixed?**
    Yes, in JDK 24 (JEP 491). On Java 25+, blocking inside synchronized no longer pins the carrier. Native calls still pin.

17. **How do you detect pinning?**
    Use JFR events (`jdk.VirtualThreadPinned`), or (on older JDKs) the system property `-Djdk.tracePinnedThreads=full` (removed in later versions).

18. **How do you avoid pinning (pre-JDK 24)?**
    Prefer `ReentrantLock` over `synchronized` for critical sections that may block. Avoid long-running native calls.

19. **Do Virtual Threads help with CPU-bound tasks?**
    No. They share a limited set of carrier threads (typically one per core). CPU-bound work holds the carrier and does not benefit from unmounting.

20. **When should you use Virtual Threads?**
    For high-concurrency, I/O-bound workloads (HTTP servers, database calls, RPC) where the thread-per-request model is natural.

21. **When should you NOT use Virtual Threads?**
    For CPU-bound tasks, low-concurrency applications, or code with heavy pinning/native calls. Also avoid if you need strict thread affinity.

22. **Are Virtual Threads daemon threads?**
    Yes, always. The JVM can exit even if virtual threads are still running (unless non-daemon platform threads exist).

23. **Do Virtual Threads have a name?**
    Yes. By default, they get names like `VirtualThread-<id>`. You can set a custom name via `Thread.Builder`.

24. **How do you check if a thread is virtual?**
    `Thread.currentThread().isVirtual()`.

25. **What is the scheduler for Virtual Threads?**
    An internal `ForkJoinPool` (work-stealing, FIFO for virtual threads) distinct from the common pool used by parallel streams.

26. **How many carrier threads are there by default?**
    Typically equal to the number of available processors (`Runtime.getRuntime().availableProcessors()`).

27. **How can you configure the number of carrier threads?**
    Via system properties: `jdk.virtualThreadScheduler.parallelism` and `jdk.virtualThreadScheduler.maxPoolSize`.

28. **What is a Continuation in the context of Virtual Threads?**
    The underlying mechanism (from Project Loom) that allows a virtual thread's execution state to be saved and restored when unmounted/mounted.

29. **Do Virtual Threads support `ThreadLocal`?**
    Yes, but use carefully. With millions of threads, large ThreadLocals can consume significant memory. Prefer Scoped Values where possible.

30. **What are Scoped Values?**
    A safer, more efficient alternative to ThreadLocals for immutable context (e.g., request-scoped data), finalized in Java 25. They work well with virtual threads.

31. **What is Structured Concurrency?**
    An approach (via `StructuredTaskScope`) that treats a group of concurrent tasks as a single unit of work with clear lifecycle, cancellation, and error propagation. Preview in recent JDKs.

32. **How does Structured Concurrency relate to Virtual Threads?**
    Subtasks in `StructuredTaskScope` typically run on virtual threads. It provides structure on top of the lightweight concurrency virtual threads enable.

33. **Can Virtual Threads replace reactive programming?**
    For many I/O-bound use cases, yes. They allow simple blocking code with high scalability, reducing the need for reactive stacks (though reactive still has niches).

34. **Do you still need connection pools with Virtual Threads?**
    Yes. Virtual threads do not remove resource limits (DB connections, external rate limits). Use pools or semaphores to protect scarce resources.

35. **How can Virtual Threads overload a database?**
    By allowing far more concurrent requests than the DB can handle. Admission control (semaphores, rate limiters) is still required.

36. **What is the recommended way to limit concurrency with Virtual Threads?**
    Use a `Semaphore` or similar around the critical resource, or a bounded queue/admission controller, rather than a fixed thread pool.

37. **Are there any issues with `synchronized` and Virtual Threads on Java 21-23?**
    Yes. Blocking while holding a monitor pins the carrier. Prefer short critical sections or `ReentrantLock`.

38. **How does the JVM handle synchronous file I/O with Virtual Threads?**
    In some cases, it may temporarily increase the number of carrier threads (up to maxPoolSize) because file I/O may not unmount cleanly.

39. **Can Virtual Threads be interrupted?**
    Yes, the same way as platform threads (`interrupt()`, `isInterrupted()`).

40. **Do Virtual Threads support `Thread.sleep()`?**
    Yes. Sleeping unmounts the virtual thread from its carrier.

41. **What is the difference between mounting and unmounting?**
    Mounting attaches a virtual thread to a carrier for execution. Unmounting detaches it (saving state) when it blocks, freeing the carrier.

42. **Is there affinity between a Virtual Thread and a Carrier?**
    No. A virtual thread can be remounted on any available carrier after unmounting.

43. **How does debugging work with Virtual Threads?**
    Standard tools (debuggers, thread dumps, JFR) support them. Thread dumps show both virtual and carrier threads.

44. **What does a thread dump look like with Virtual Threads?**
    It lists virtual threads separately and shows which carrier they are mounted on (if any).

45. **Can you use Virtual Threads with `CompletableFuture`?**
    Yes. You can submit work that runs on virtual threads. They complement rather than replace futures for some composition needs.

46. **Does Spring Boot support Virtual Threads?**
    Yes. Spring Boot 3.2+ supports them. Enable via `spring.threads.virtual.enabled=true`.

47. **How does enabling Virtual Threads affect a Spring MVC application?**
    Each request can be handled by a virtual thread, restoring the simple thread-per-request model at high scale.

48. **Are there migration steps from platform thread pools to Virtual Threads?**
    Replace fixed pools with `newVirtualThreadPerTaskExecutor()`, audit for pinning (especially pre-JDK 24), review ThreadLocal usage, and add resource limits.

49. **What is the impact of deep call stacks on Virtual Threads?**
    Memory usage grows with stack depth (like platform threads). Very deep stacks reduce the "lightweight" advantage.

50. **Can Virtual Threads deadlock?**
    Yes, the same as platform threads if locks are acquired in inconsistent orders. Pinning can also create effective deadlocks under load.

51. **How do you create a Virtual Thread with a custom name?**
    `Thread.ofVirtual().name("my-vt").start(() -> { ... });`

52. **What is `Thread.ofVirtual()`?**
    A factory method returning a `Thread.Builder` for configuring and creating virtual threads.

53. **Are Virtual Threads always daemon?**
    Yes. There is no way to create a non-daemon virtual thread.

54. **What happens if only Virtual Threads are running when the main thread ends?**
    The JVM exits (since they are daemons), unless other non-daemon threads exist.

55. **How do locks from `java.util.concurrent` behave with Virtual Threads?**
    `ReentrantLock`, `Semaphore`, etc., correctly unmount virtual threads when they block (unlike synchronized in Java 21-23).

56. **Is there a performance overhead to mounting/unmounting?**
    Yes, a small one. For pure CPU work it can make virtual threads slightly slower than platform threads.

57. **What is the role of the ForkJoinPool in Virtual Thread scheduling?**
    It manages the carrier threads and uses work-stealing to distribute runnable virtual threads efficiently.

58. **Can you set a custom scheduler for Virtual Threads?**
    Not easily in standard usage. The scheduler is internal; custom schedulers were explored but not part of the final API for most users.

59. **How does `Object.wait()` interact with Virtual Threads?**
    In Java 21 it could cause pinning or special handling; behavior improved in later releases.

60. **What JFR events are useful for Virtual Threads?**
    `jdk.VirtualThreadStart`, `jdk.VirtualThreadEnd`, `jdk.VirtualThreadPinned`, `jdk.VirtualThreadSubmitFailed`, etc.

61. **Does using Virtual Threads change the need for asynchronous programming?**
    For many cases, no. Blocking code becomes scalable, so complex async/reactive styles can be simplified.

62. **What is the main advantage of the Virtual Thread programming model?**
    Write simple, sequential, blocking-looking code while achieving high concurrency.

63. **Can Virtual Threads be used in GUI applications?**
    Possible, but the primary value is in server-side, high-concurrency I/O scenarios. GUI event threads have different constraints.

64. **How do you submit many tasks with Virtual Threads?**
    Prefer `ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();` then `executor.submit(...)`.

65. **What is the difference between `startVirtualThread` and the executor approach?**
    `startVirtualThread` is for fire-and-forget single threads. The executor is better for managing many tasks and shutdown.

66. **Do Virtual Threads support priority?**
    Virtual threads do not use the traditional priority mechanism in the same way; scheduling is handled by the JVM scheduler.

67. **Can a Virtual Thread call native code?**
    Yes, but native frames pin the virtual thread to its carrier for the duration of the call.

68. **What is the Foreign Function & Memory API's relation to pinning?**
    Calls into native code via FFM also pin the virtual thread.

69. **How does garbage collection interact with Virtual Threads?**
    Virtual threads and their stacks are ordinary Java objects on the heap. GC treats them normally; large numbers increase GC pressure if long-lived.

70. **Are Virtual Threads suitable for batch processing?**
    For I/O-heavy batch jobs with high parallelism, yes. For pure compute, a fixed platform thread pool sized to cores is better.

71. **What happens to a pinned Virtual Thread under high load?**
    It holds a carrier, reducing available carriers. If many are pinned, throughput collapses (carrier starvation).

72. **How do you mitigate carrier starvation?**
    Eliminate pinning (upgrade to JDK 24+ or refactor synchronized), limit concurrent tasks, and monitor with JFR.

73. **Can you use `parallel()` streams with Virtual Threads?**
    Parallel streams still use the common ForkJoinPool of platform threads. Virtual threads are separate; mixing requires care.

74. **What is the recommended executor for Virtual Threads in production?**
    `Executors.newVirtualThreadPerTaskExecutor()`.

75. **Does enabling Virtual Threads require code changes?**
    Often minimal for pure I/O servers. Code with synchronized + blocking, heavy ThreadLocals, or fixed pools needs review.

76. **How does timeout/cancellation work with Virtual Threads?**
    Standard interruption and `Future.cancel()`. Structured concurrency provides better cancellation propagation.

77. **What is `StructuredTaskScope`?**
    A preview API for structured concurrency that forks subtasks (typically on virtual threads) and joins them with failure policies.

78. **What are the two main policies in StructuredTaskScope?**
    `ShutdownOnFailure` (cancel others on first failure) and `ShutdownOnSuccess` (cancel others on first success).

79. **Why is Structured Concurrency important with Virtual Threads?**
    Virtual threads make it easy to create many tasks; structured concurrency ensures they have a clear lifetime and proper cleanup.

80. **Can Virtual Threads be used with reactive libraries?**
    Yes, but you lose some benefits. The ideal is to use blocking code on virtual threads instead of reactive for simplicity.

81. **What is the memory overhead of a parked Virtual Thread?**
    Very low — mainly the continuation state and any local variables on its stack.

82. **How does the JVM decide to unmount a Virtual Thread?**
    When it detects a blocking operation that has been adapted (most java.util.concurrent locks, I/O, sleep, etc.).

83. **Are all blocking operations unmount-aware?**
    Most JDK blocking operations are. Third-party native or poorly adapted libraries may not unmount cleanly.

84. **What is the impact of using Virtual Threads on latency?**
    Throughput improves under high concurrency; single-request latency is similar or slightly higher due to scheduling overhead.

85. **Should you replace every thread pool with Virtual Threads?**
    No. Keep platform thread pools for CPU-bound work. Use virtual threads for I/O-bound task-per-thread scenarios.

86. **How do you name the carrier threads for debugging?**
    They appear as `ForkJoinPool-1-worker-N` or similar. You can influence via system properties in some cases.

87. **What is the default behavior of virtual thread names?**
    Automatically generated, sequential, e.g., `VirtualThread-42`.

88. **Can you observe Virtual Threads in VisualVM or similar tools?**
    Yes, modern profilers and tools support virtual threads.

89. **What is the relationship between Virtual Threads and green threads?**
    Virtual threads are a modern, efficient implementation of the green-thread idea, with proper unmounting (unlike early Java green threads).

90. **Do Virtual Threads change the Java Memory Model?**
    No. The JMM remains the same. Synchronization and happens-before rules apply equally.

91. **How do you handle context propagation with Virtual Threads?**
    Prefer Scoped Values. ThreadLocals work but scale poorly in memory with huge numbers of threads.

92. **What is a common anti-pattern with Virtual Threads?**
    Creating a fixed-size pool of virtual threads, or using synchronized around blocking I/O on Java 21-23.

93. **Can Virtual Threads be used in microservices?**
    Excellent fit for I/O-bound microservices. Improves scalability of the classic request-handling model.

94. **What monitoring is recommended when adopting Virtual Threads?**
    Watch carrier thread utilization, pinning events (JFR), heap usage, and downstream resource saturation (DB, HTTP clients).

95. **Is there a limit to how deep a Virtual Thread's stack can grow?**
    Limited by available heap. Extremely deep recursion or call stacks can still OOM.

96. **How does `Thread.currentThread()` behave inside a Virtual Thread?**
    Returns the virtual thread itself, not the carrier.

97. **Can you get the carrier thread from a Virtual Thread?**
    Not directly via public API in normal use. Internals exist but should not be relied upon.

98. **What is the main takeaway for interview candidates about Virtual Threads?**
    They restore simple blocking code for high-scale I/O concurrency, but require awareness of pinning (especially on older JDKs), resource limits, and not using them for CPU work.

99. **How has the pinning story evolved since Java 21?**
    Synchronized pinning was removed in JDK 24. On modern JDKs the main remaining pinning risk is native code.

100. **What should you say if asked “Are Virtual Threads a silver bullet?”**
    No. They are a powerful tool for I/O-bound high concurrency that simplifies code, but you still need proper resource management, monitoring, and awareness of remaining limitations.
