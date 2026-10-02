---
title: CompletableFuture in Java
date: 2026-10-02
summary: Common questions regarding CompletableFuture in Java
tag: Java
draft: false
---

CompletableFuture is Java’s non-blocking Future that can be completed explicitly and chained with callbacks, transformations, and combinations.

**Q: What is CompletableFuture?**  
A: A `java.util.concurrent.CompletableFuture` that implements `Future` and `CompletionStage` and supports async pipelines without blocking.

**Q: Which package is it in?**  
A: `java.util.concurrent`, added in Java 8.

**Q: How does it differ from Future?**  
A: `Future` only supports blocking `get()`; `CompletableFuture` adds completion, callbacks, chaining, and combining.

**Q: How do you create an already completed one?**  
A: `CompletableFuture.completedFuture(value)` or `CompletableFuture.failedFuture(ex)` (Java 9+).

**Q: How do you run a task asynchronously?**  
A: `CompletableFuture.supplyAsync(supplier)` for a result, or `runAsync(runnable)` for no result.

**Q: Which thread pool does supplyAsync use by default?**  
A: The common `ForkJoinPool`, unless you pass an `Executor`.

**Q: How do you transform a result?**  
A: `thenApply` for sync mapping, `thenApplyAsync` to run the mapping on another thread.

**Q: How do you consume a result without returning a value?**  
A: `thenAccept` or `thenAcceptAsync`.

**Q: How do you run something after completion regardless of the result?**  
A: `thenRun` or `thenRunAsync`.

**Q: How do you handle exceptions?**  
A: `exceptionally` to recover, `handle` to see both result and exception, or `whenComplete` for a side effect.

**Q: How do you chain dependent async calls?**  
A: `thenCompose` (flatMap-style), not `thenApply`, when the next step itself returns a `CompletableFuture`.

**Q: How do you combine two independent futures?**  
A: `thenCombine` for both results, `thenAcceptBoth` to consume both, or `runAfterBoth` when both finish.

**Q: How do you take the first completed of two?**  
A: `applyToEither`, `acceptEither`, or `runAfterEither`.

**Q: How do you wait for many futures?**  
A: `CompletableFuture.allOf(...)` for all, or `anyOf(...)` for the first.

**Q: How do you complete it manually?**  
A: `complete(value)`, `completeExceptionally(ex)`, or `obtrudeValue` / `obtrudeException` to force overwrite.

**Q: Is get() still blocking?**  
A: Yes. Prefer callbacks or `join()` only when you intentionally want to block; `join()` throws unchecked exceptions.

**Q: Can it be cancelled?**  
A: Yes. `cancel(mayInterruptIfRunning)` completes it exceptionally with `CancellationException` if not already done.

**Q: Why did Spring move from ListenableFuture to it?**  
A: `CompletableFuture` is the JDK standard and already covers callbacks, chaining, and error handling that `ListenableFuture` added.
