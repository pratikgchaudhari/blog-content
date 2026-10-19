---
title: useState vs useRef in React
date: 2026-10-19
summary: A concise comparison of the useState and useRef hooks in React.js, highlighting key differences in re-rendering, mutability, and common use cases.
tag: React, hooks, useState, useRef
draft: false
---

- **Purpose**
  - `useState`: Manages component state that should trigger a re-render when updated.
  - `useRef`: Holds a mutable value that persists across renders without triggering a re-render.

- **Return Value**
  - `useState`: Returns an array `[state, setState]`.
  - `useRef`: Returns a mutable object `{ current: initialValue }`.

- **Re-rendering**
  - `useState`: Calling the setter causes the component to re-render.
  - `useRef`: Updating `.current` does **not** cause a re-render.

- **Mutability**
  - `useState`: State is immutable; you must use the setter to update it.
  - `useRef`: The `.current` property is fully mutable and can be updated directly.

- **Update Timing**
  - `useState`: Updates are asynchronous and batched.
  - `useRef`: Updates to `.current` are synchronous and immediate.

- **Persistence Across Renders**
  - `useState`: Value is preserved between renders (as state).
  - `useRef`: Value is preserved between renders (via the same ref object).

- **Common Use Cases**
  - `useState`: UI-related data (form inputs, toggles, counters, lists, etc.).
  - `useRef`: DOM element references, storing previous values, timers/intervals, mutable values that shouldn’t trigger renders.

- **Accessing the Value**
  - `useState`: Read the state variable directly.
  - `useRef`: Read/write via `ref.current`.

- **Initial Value**
  - `useState`: Can be a value or a lazy initializer function.
  - `useRef`: Accepts an initial value for `.current` (lazy initialization is not built-in the same way).

- **Typical Pattern**
  - `useState`:
    ```jsx
    const [count, setCount] = useState(0);
    setCount(count + 1); // triggers re-render
    ```
  - `useRef`:
    ```jsx
    const countRef = useRef(0);
    countRef.current += 1; // no re-render
    ```
