---
title: Covariant Arrays in Java
date: 2026-10-02
summary: What they are & the pitfalls of relying on them
tag: Linux
draft: false
related: why-one-should-use-varargs-judiciously-in-java
---

Covariant arrays mean that if `S` is a subtype of `T`, then `S[]` is a subtype of `T[]`. You can assign an array of a more specific type to a variable of a more general array type.

```java
String[] strings = new String[2];
Object[] objects = strings;   // legal: String[] is a subtype of Object[]
```

That assignment is allowed at compile time because arrays in Java are covariant.

## Why it exists

Arrays have been covariant since Java 1.0, before generics. The goal was to let methods written against a general array type also accept more specific arrays:

```java
void printAll(Object[] items) {
    for (Object item : items) {
        System.out.println(item);
    }
}

printAll(new String[] { "a", "b" });  // works because of covariance
```

## The catch: runtime store checks

The array object still remembers its real component type. A store through the supertype reference is checked at runtime, and a bad store throws `ArrayStoreException`:

```java
String[] strings = new String[2];
Object[] objects = strings;

objects[0] = "ok";          // fine
objects[1] = Integer.valueOf(1);  // compiles, fails at runtime
// java.lang.ArrayStoreException: java.lang.Integer
```

Reads are safe (you only get what was stored). Writes are not, because the static type of the reference (`Object[]`) is wider than the actual array (`String[]`).

## Contrast with generics

Generic types are invariant. `List<String>` is not a subtype of `List<Object>`, so this does not compile:

```java
List<String> strings = new ArrayList<>();
List<Object> objects = strings;  // compile error
```

That rule exists specifically to avoid the array problem. With generics, an unsafe store is rejected at compile time instead of failing later with `ArrayStoreException`. Covariance for generics is opt-in and read-oriented, via wildcards:

```java
List<? extends Object> objects = strings;  // legal
// objects.add("x");  // not allowed — compiler does not know the real element type
```

Arrays cannot use that approach because they are reified: the component type is stored in the array at runtime and checked on every store. Generic type arguments are erased, so the JVM cannot do an equivalent check.

## Practical takeaway

- Covariance is convenient for reading from arrays of a subtype.
- It is unsafe for writing, which is why mixed use of a subtype array through a supertype reference can throw `ArrayStoreException`.
- Prefer `List` (or another generic collection) when you need a type-safe, resizable sequence. Use arrays when you need reified component types, primitive storage, or a fixed-size buffer, and keep the reference type aligned with the real array type if you will write into it.
