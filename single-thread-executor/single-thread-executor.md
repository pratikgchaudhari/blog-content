---
title: How the Single Thread Executor Works in Java
date: 2026-10-19
summary: How Executors.newSingleThreadExecutor guarantees sequential, ordered execution on exactly one thread.
tag: Java
draft: false
related: executor-service-types-in-java
---

A single-thread executor is created with `Executors.newSingleThreadExecutor()`. It guarantees that tasks run one after another on exactly one thread, with strict ordering and no concurrent execution.

- It is built as a `ThreadPoolExecutor` with core size 1, max size 1, keep-alive 0, and an unbounded `LinkedBlockingQueue`, then wrapped in a `FinalizableDelegatedExecutorService` so callers cannot reconfigure the pool.
- Exactly one worker thread is used. The pool never grows beyond one thread and never shrinks below one while it is active.
- On `execute` / `submit`:
  - If the single thread is idle, the task is handed to it immediately.
  - If the thread is busy, the task is placed on the unbounded queue and waits its turn.
- Tasks run sequentially in submission order. Later tasks cannot start until earlier ones finish, so there is a happens-before guarantee between consecutive tasks.
- If the worker thread dies because of an uncaught exception, the executor creates a new replacement thread so the pool continues to have exactly one thread.
- Idle threads are not terminated (keep-alive is 0 and core size is 1), so the single thread stays alive until the executor is shut down.
- Shutdown behavior:
  - `shutdown()` lets the current task finish and drains the queue in order, then stops.
  - `shutdownNow()` interrupts the running task and returns the tasks that were still queued.
- It is the right choice when you need sequential processing, ordering guarantees, or to avoid concurrency issues (for example, a single consumer that updates shared state without locks).
- It is a poor fit for CPU-bound or high-throughput work, because only one task can run at a time and the unbounded queue can grow without limit under load.
