---
title: Java Stream API Methods
date: 2026-10-03
summary: One-line reference for every method on java.util.stream.Stream, including BaseStream and Java 24 gather.
tag: java, streams, api, reference
draft: false
---


## Intermediate operations

- `filter(Predicate)` — keeps elements that match the predicate.
- `map(Function)` — transforms each element into another object.
- `mapToInt(ToIntFunction)` — maps each element to an `int` (`IntStream`).
- `mapToLong(ToLongFunction)` — maps each element to a `long` (`LongStream`).
- `mapToDouble(ToDoubleFunction)` — maps each element to a `double` (`DoubleStream`).
- `flatMap(Function)` — maps each element to a stream and flattens the results into one stream.
- `flatMapToInt(Function)` — flat-maps to an `IntStream`.
- `flatMapToLong(Function)` — flat-maps to a `LongStream`.
- `flatMapToDouble(Function)` — flat-maps to a `DoubleStream`.
- `mapMulti(BiConsumer)` — lets the mapper push zero or more results per element (Java 16; often cheaper than `flatMap`).
- `mapMultiToInt(BiConsumer)` — `mapMulti` that emits `int`s.
- `mapMultiToLong(BiConsumer)` — `mapMulti` that emits `long`s.
- `mapMultiToDouble(BiConsumer)` — `mapMulti` that emits `double`s.
- `distinct()` — drops duplicates using `equals`.
- `sorted()` — sorts in natural order.
- `sorted(Comparator)` — sorts with the given comparator.
- `peek(Consumer)` — runs an action on each element as it flows through (for debugging; do not rely on it for side effects).
- `limit(long)` — keeps at most the first n elements.
- `skip(long)` — discards the first n elements.
- `takeWhile(Predicate)` — keeps the prefix while the predicate holds (Java 9).
- `dropWhile(Predicate)` — drops the prefix while the predicate holds, then keeps the rest (Java 9).
- `gather(Gatherer)` — applies a custom intermediate operation (Java 24); built-ins live on `Gatherers` (`windowFixed`, `windowSliding`, `fold`, `scan`, `mapConcurrent`).

## Terminal operations

- `forEach(Consumer)` — runs an action on each element; order is not guaranteed in parallel.
- `forEachOrdered(Consumer)` — same, but respects encounter order.
- `toArray()` — collects elements into an `Object[]`.
- `toArray(IntFunction)` — collects into a typed array, e.g. `String[]::new`.
- `reduce(BinaryOperator)` — folds elements into an `Optional` with no identity.
- `reduce(identity, BinaryOperator)` — folds elements starting from an identity value.
- `reduce(identity, BiFunction, BinaryOperator)` — maps and folds in one reduction (useful in parallel).
- `collect(Collector)` — mutable reduction via a collector (`toList`, `groupingBy`, `joining`, …).
- `collect(Supplier, BiConsumer, BiConsumer)` — mutable reduction with an explicit supplier, accumulator, and combiner.
- `toList()` — collects into an unmodifiable `List` (Java 16).
- `min(Comparator)` — returns the smallest element as an `Optional`.
- `max(Comparator)` — returns the largest element as an `Optional`.
- `count()` — returns the number of elements.
- `anyMatch(Predicate)` — true if any element matches; may short-circuit.
- `allMatch(Predicate)` — true if every element matches (vacuously true if empty).
- `noneMatch(Predicate)` — true if no element matches.
- `findFirst()` — first element in encounter order, as an `Optional`.
- `findAny()` — any element, as an `Optional` (cheaper in parallel).

## Static factories

- `empty()` — an empty sequential stream.
- `of(T)` — a stream of one element.
- `of(T...)` — a stream of the given elements.
- `ofNullable(T)` — a stream of the value, or empty if it is null (Java 9).
- `iterate(seed, UnaryOperator)` — infinite sequence: seed, f(seed), f(f(seed)), …
- `iterate(seed, Predicate, UnaryOperator)` — same, but stops when the predicate fails (Java 9).
- `generate(Supplier)` — infinite stream from a supplier.
- `concat(Stream, Stream)` — lazy concatenation of two streams.
- `builder()` — a mutable `Stream.Builder` for assembling a stream.

## From `BaseStream` (also on `Stream`)

- `iterator()` — an `Iterator` over the remaining elements.
- `spliterator()` — a `Spliterator` over the remaining elements.
- `isParallel()` — whether the pipeline will run in parallel.
- `sequential()` — switches the pipeline to sequential.
- `parallel()` — switches the pipeline to parallel.
- `unordered()` — drops the encounter-order constraint so ops can be faster.
- `onClose(Runnable)` — registers a handler to run when the stream is closed.
- `close()` — closes the stream and runs close handlers (`AutoCloseable`; needed mainly for I/O-backed streams such as `Files.lines`).
