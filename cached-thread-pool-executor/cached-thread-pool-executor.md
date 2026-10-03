---
title: How the Cached Thread Pool Executor Works in Java
date: 2026-10-03
summary: How Executors.newCachedThreadPool creates, reuses, and retires threads for short-lived tasks.
tag: java, concurrency, executors, thread-pool
draft: false
---

A cached thread pool is created with `Executors.newCachedThreadPool()`. Under the hood it is a `ThreadPoolExecutor` configured for short, bursty tasks that should reuse threads when possible and discard them when idle.

- It is built as `new ThreadPoolExecutor(0, Integer.MAX_VALUE, 60L, TimeUnit.SECONDS, new SynchronousQueue<>())`.
- Core pool size is 0, so no threads are kept permanently just because the pool exists.
- Maximum pool size is `Integer.MAX_VALUE`, so the pool can create a new thread for every concurrent task if none are free.
- The work queue is a `SynchronousQueue`: it does not buffer tasks. A submit only succeeds if a worker is already waiting to take the task, or a new worker is created to take it immediately.
- On `execute` / `submit`:
  - If an idle worker is waiting on the queue, the task is handed off to that worker and reused.
  - If no idle worker is available, a new thread is created (because the queue cannot hold the task and the max size is effectively unbounded), and that thread runs the task.
- After a worker finishes a task it tries to take another from the `SynchronousQueue`. If none arrives within the 60-second keep-alive time, the thread exits and is removed from the pool.
- Threads are created with the default non-daemon factory (`Executors.defaultThreadFactory()`), named like `pool-N-thread-M`, unless you pass a custom `ThreadFactory`.
- Rejected tasks are rare with the default setup, because the pool grows instead of queuing. Rejection happens mainly if the pool has been shut down, or if you replace the handler / hit resource limits in the OS.
- Shutdown behavior matches other executors: `shutdown()` finishes queued and running work and then stops; `shutdownNow()` interrupts workers and returns tasks that were not started. With a `SynchronousQueue`, there is normally nothing sitting in a queue to drain.
- It fits many short-lived async tasks with uneven load. It is a poor fit for long-running or unbounded workloads, because a traffic spike can create a very large number of threads and exhaust memory or native thread limits.
