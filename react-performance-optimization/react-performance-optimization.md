---
title: React Performance Optimization Explained - Rendering, Memoization, Bundles and Core Web Vitals
date: 2026-11-15
summary: A practical guide to making React apps faster covering render and commit, measuring tools, memoization and the React Compiler, code splitting, data fetching, and server rendering.
tag: react, performance, javascript, frontend, react-compiler
draft: false
related: react-compiler,rules-of-react,javascript-bundlers,create-root-vs-hydrate-root,how-redux-works,caching-types-and-techniques
---

A React app feels slow when the main thread spends too long rendering, when the network delivers too much JavaScript, or when the browser paints late and responds late to input. **Optimization** here means shrinking that work: fewer unnecessary renders, cheaper updates, smaller bundles, and better loading sequences.

React has always asked you to describe UI as a function of state. Early versions reconciled trees synchronously. React 16 introduced **Fiber**, a unit of work that can be paused and resumed. React 18 made **concurrent rendering** official with transitions and deferred values. React 19, whose latest line as of late 2026 is the 19.3 release family, continues that model and is the natural target for new apps. **React Compiler** reached a stable 1.0 release in October 2025 and can automatically memoize components and hooks at build time.

This article starts with how rendering works, then how to measure, then the techniques that usually matter, in an order you can apply without guessing. Official docs still say React is often fast enough without extra memoization; optimization earns its keep when measurement shows a real cost, on a production build, for the interaction or load path users actually hit.

## How React Renders

Official docs describe three steps: **trigger**, **render**, and **commit**.

```
State / props / hook change
        |
        v
Trigger a render
        |
        v
Render: React calls your components (pure calculation)
        |
        v
Reconciliation: compare the new tree with the previous one
        |
        v
Commit: apply the minimal DOM updates
        |
        v
Effects run after paint (in the commit/effect phase)
```

**Rendering** is React calling your function components to compute the next UI. It must be a pure calculation: same inputs, same JSX, and no surprises for other objects. **Commit** is when `react-dom` (or another renderer) writes to the DOM. A component can re-render often and still change nothing on screen if the output matches the previous tree. The cost you feel is usually the JavaScript work of rendering, not the DOM write.

**Reconciliation** is the comparison that decides what to insert, update, or remove. React matches children by position and by **key**. A stable, unique key among siblings lets React reuse instances; an index key or a changing key forces more work and can reset state.

**Fiber** is the internal data structure behind this process since React 16. Each component instance has a fiber. Concurrent features use that structure so React can interrupt a render, handle a more urgent update (such as typing), and continue or restart the interrupted work. Commit stays synchronous: once React starts writing to the DOM, it finishes that commit.

You rarely manipulate fibers directly. What you need to remember is that render work can be interrupted, while DOM updates in a commit cannot. That is why marking a heavy update as a transition can keep a text input responsive.

## Why Components Re-render

A component re-renders when:

- Its own state changes
- Its parent re-renders and passes it new (or newly created) props
- A context value it subscribes to changes
- A store hook it uses notifies it of a change
- In some cases, a hook such as a reducer or an external store snapshot changes

Parent re-renders cascade by default. If `Page` sets state, `Page` renders, then its children render, then their children, unless something stops the cascade (`React.memo`, a compiler-inserted cache, or moving the frequently changing state lower in the tree).

New object or function props (`style={{}}`, `onClick={() => ...}`) are new identities on every parent render. That does not by itself make a child "wrong," but it defeats memoization that compares props with `Object.is`.

Class components also re-render when they receive new props or state, with `shouldComponentUpdate` or `PureComponent` as the older escape hatches. Modern apps lean on function components and the hooks and compiler tools below.

## Measure First

Do not sprinkle `memo` everywhere because a page "feels heavy." Measure, then change the slow path.

### React DevTools Profiler

The Profiler records which components rendered, why they rendered (when that information is available), and how long they took in a session. Use it while you perform the slow interaction: typing in a search box, opening a row, switching tabs. Look for wide subtrees that render when their props did not meaningfully change, and for a few components that dominate the duration.

### Chrome Performance Panel

The Performance panel shows main-thread tasks, scripting, rendering, and painting. Long tasks that block input show up here. Pair this with React's profiler so you can tell "React work" from "layout/paint" or third-party scripts.

### Lighthouse and Core Web Vitals

**Lighthouse** (in Chrome or CI) scores loading and some interaction characteristics. **Core Web Vitals** are the field-oriented metrics that matter for real users:

| Metric | What It Captures |
|---|---|
| **LCP** (Largest Contentful Paint) | When the main content appears |
| **INP** (Interaction to Next Paint) | How quickly the page responds to interactions |
| **CLS** (Cumulative Layout Shift) | Unexpected movement of visible content |

These are about the whole page, not only React. A huge client bundle, a late hero image, or a layout shift from a font or ad will hurt them even if your components are well memoized.

INP replaced the older FID metric as the interaction vital. Optimizing INP often means shortening event-handler work and the render that follows a click or keystroke, not only shrinking the initial bundle.

### The `web-vitals` Library

Google's `web-vitals` library reports LCP, INP, and CLS (and related metrics) from production. Lab scores are useful; field data shows what users on slow devices actually experience.

### `why-did-you-render`

Libraries such as `why-did-you-render` log components that re-rendered with the same effective props. Use them in development only. They are a complement to the Profiler, not a replacement for production metrics.

If a profile shows most time in a third-party widget or in CSS layout, React memoization will not help. Fix or isolate that work first.

## Avoiding Unnecessary Re-renders

### State Colocation

Put state next to the components that need it. If only a tooltip needs `open`, keep that state in the tooltip, not in a page-level store that re-renders a dashboard.

```jsx
function Page() {
  return (
    <>
      <Dashboard />
      <HelpTip />
    </>
  );
}

function HelpTip() {
  const [open, setOpen] = useState(false);
  return (
    <button onClick={() => setOpen((v) => !v)}>
      {open ? "Hide help" : "Show help"}
    </button>
  );
}
```

### Lifting Content Up and Children as Props

A parent that holds fast-changing state will re-render its entire JSX tree. You can pass already-rendered `children` so a static subtree is created above the stateful parent and does not recreate as that parent's body.

```jsx
function UpdatingWidth({ children }) {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return (
    <div>
      <p>Width: {width}</p>
      {children}
    </div>
  );
}

// ExpensiveTree is created by the caller and passed as children
<UpdatingWidth>
  <ExpensiveTree />
</UpdatingWidth>
```

The same idea appears as "lifting content up": keep the expensive tree in a parent that does not own the high-frequency state.

### Splitting Context

A context value is a single identity. Any change notifies every consumer. Split contexts that change at different rates (theme vs. the current user's rapidly updating cursor), or put the changing piece in a context whose consumers are few and small.

```jsx
const ThemeContext = createContext(null);
const AuthContext = createContext(null);
```

A selector-style subscription (in your own hook or a library) can also reduce how much of a value a consumer depends on, but only if the subscription hook actually skips renders when the selected slice is unchanged.

### `React.memo`, `useMemo`, and `useCallback`

`React.memo` wraps a component and skips a re-render when props are shallowly equal. `useMemo` caches an expensive calculation. `useCallback` caches a function identity so memoized children or effect dependencies stay stable.

```jsx
const Row = memo(function Row({ item, onSelect }) {
  return <button onClick={() => onSelect(item.id)}>{item.name}</button>;
});

function List({ items }) {
  const [selected, setSelected] = useState(null);
  const onSelect = useCallback((id) => setSelected(id), []);
  const total = useMemo(() => items.reduce((sum, item) => sum + item.price, 0), [items]);
  return (
    <>
      <p>Total {total}</p>
      {items.map((item) => (
        <Row key={item.id} item={item} onSelect={onSelect} />
      ))}
    </>
  );
}
```

These tools help when you have measured a real cascade or a heavy calculation. They add noise and can go stale if dependency arrays are wrong. Prefer them as targeted fixes, especially if the compiler already covers the obvious cases.

### Stable Keys

Use a stable id from your data as `key`. Do not use the array index for lists that can insert, delete, or reorder; React will reuse the wrong child and you may also reset local state. Do not generate a new random key on each render.

### React Compiler and Auto-Memoization

**React Compiler** is a build-time optimizer. The React team announced Compiler 1.0 as stable in October 2025. It analyzes components and hooks, respects the Rules of React, and inserts memoization automatically. It works with React 19 directly, and can target React 17 or 18 with a `target` setting and the `react-compiler-runtime` package. Expo, Vite, and Next.js documentation now cover enabling it in new apps.

Official guidance as of the 1.0 announcement:

- For **new code**, rely on the compiler for memoization and use `useMemo` / `useCallback` when you need precise control (for example, an effect dependency that must stay referentially stable).
- For **existing code**, leave current memoization in place, or remove it only after careful testing, because deletion can change compiler output.
- The compiler can memoize in places manual hooks cannot, such as after an early return.
- It is not a license to break purity rules. If your app depended on "this function is a new identity every render" for correctness, the compiler can surprise you. Follow the Rules of React and the compiler's debugging docs.

Install and configure the compiler through the official installation guide for your bundler. Confirm in development that compiled components behave as you expect before you treat it as a complete replacement for profiling.

The compiler does not shrink your JavaScript download by itself, and it does not virtualize lists or compress images. It is a tool for update performance and for skipping wasted calculations inside components that already follow the rules.

## Expensive Computations

If a render does heavy work (large filters, expensive formatting, derived data from big arrays), move that work behind `useMemo` or let the compiler cache it, or move it out of render entirely:

- Precompute on the server or in a data layer
- Recompute in a worker (see below)
- Store derived data next to the source in your query cache

```jsx
const visible = useMemo(
  () => rows.filter((row) => row.name.includes(query)),
  [rows, query]
);
```

If the list is huge, memoizing the filter is not enough; virtualize the DOM as well.

## List Virtualization

Rendering thousands of DOM nodes is expensive even when each row is light. **Windowing** (virtualization) renders only the visible slice, plus a small overscan.

Libraries commonly used for this include **react-window** and **TanStack Virtual**. The idea is the same: a scroll container, an estimated row height, and a renderer for the visible range.

Virtualization helps scroll performance and memory. It complicates things that need the full document: find-in-page, measuring total height, and focus management. Use it when a list is long enough that the Profiler or Performance panel shows layout or render cost dominated by the list.

If row heights vary, use a virtualizer that supports dynamic measurement, or you will see gaps and jumps as rows mount. Keep row components cheap: no heavy work in each visible cell on every scroll tick.

## Code Splitting

**Code splitting** keeps initial JavaScript small by loading parts of the app on demand.

```jsx
import { lazy, Suspense } from "react";

const SettingsPage = lazy(() => import("./SettingsPage"));

function App() {
  return (
    <Suspense fallback={<p>Loading settings</p>}>
      <SettingsPage />
    </Suspense>
  );
}
```

`React.lazy` plus `import()` creates a separate chunk. **Suspense** shows a fallback while that chunk (or a data boundary) is pending. **Route-based splitting** is the usual first cut: each route becomes its own chunk so users do not download the admin panel to view a public page. Split heavy editors, charts, and markdown previews the same way.

Avoid a waterfall of tiny lazy components that appear only after the first chunk runs; prefetch likely routes on hover or during idle time when you know the next navigation.

Error boundaries around lazy routes give you a place to recover when a chunk fails to load (stale cache after a deploy is a common case). Pair splitting with cache-busted filenames in production so clients request the new chunk after a release.

## Bundle Size

A smaller bundle improves parse and compile time on the main thread, which helps LCP and INP.

Practical steps:

- Analyze the bundle (your bundler's analyzer, source-map explorer, or similar) and look at the largest modules
- Prefer **tree-shakable** libraries and import only the functions you need
- Replace heavy dependencies with smaller ones when the feature set allows
- Watch date, icon, and locale libraries; they grow quietly
- Use a modern bundler (Vite, webpack, or your framework's default) with production minification

Dead code elimination only works if imports are static and side-effect free. Dynamic access such as `lodash[method]` can pull more than you intended.

Duplicate copies of React in a bundle (two versions, or a package bundling its own copy) waste bytes and can break hooks. Check the analyzer for more than one `react` module.

## Concurrent Features

**`useTransition`** marks a state update as non-urgent. React keeps the current UI responsive and prepares the next view in the background. **`useDeferredValue`** lags a value so an urgent render (the keystroke) can commit first, then a deferred render catches up. Unlike a fixed debounce timer, React attempts the deferred work as soon as it can.

```jsx
function Search({ items }) {
  const [text, setText] = useState("");
  const deferredText = useDeferredValue(text);
  const results = useMemo(
    () => items.filter((item) => item.name.includes(deferredText)),
    [items, deferredText]
  );

  return (
    <>
      <input value={text} onChange={(e) => setText(e.target.value)} />
      <List items={results} />
    </>
  );
}

function Tabs() {
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState("overview");

  function select(next) {
    startTransition(() => setTab(next));
  }

  return (
    <>
      <button onClick={() => select("overview")}>Overview</button>
      <button onClick={() => select("charts")}>Charts {isPending && "..."}</button>
      {tab === "charts" ? <HeavyChart /> : <Overview />}
    </>
  );
}
```

Use a transition when you own the `setState` call. Use `useDeferredValue` when the value arrives from props or a parent and you cannot wrap the setter. Do not use either as a substitute for fixing an accidentally O(n^2) render.

## Data Fetching

Waterfalls happen when component A fetches, then B starts only after A renders, then C after B. They stretch LCP and make navigations feel hollow.

Better patterns:

- Fetch as early as you know the parameters (route loaders, server components, or a parent that starts all needed queries)
- **Cache** responses with a library such as **TanStack Query** or **SWR** so revisiting a screen does not refetch blindly
- **Prefetch** the next page's data on hover or when a query is likely
- Deduplicate identical in-flight requests
- Avoid refetch-on-every-focus unless the data is truly volatile

```jsx
// Start both queries together instead of nesting them in sequence
const user = useQuery({ queryKey: ["user", id], queryFn: () => fetchUser(id) });
const orgs = useQuery({
  queryKey: ["orgs", id],
  queryFn: () => fetchOrgs(id),
  enabled: Boolean(id),
});
```

Client caches are not a substitute for permission-aware server APIs. They do reduce repeat network work, which often dominates after the first render is cheap.

Stale-while-revalidate styles (common in SWR and TanStack Query) let a screen paint cached data instantly, then refresh. That improves perceived speed, but you still need a loading and error policy for the first visit and for failed refreshes.

## Server Rendering

**SSR** renders HTML on the server so the browser can paint before all client JavaScript runs. **Streaming** (for example `renderToPipeableStream`) sends HTML in chunks so a shell can appear while slower parts continue. **React Server Components (RSC)** let a framework render components on the server without shipping their code to the client as part of the interactive bundle. They are a framework feature in the React 19 era (Next.js and others), not something you usually turn on with a single hook in a pure SPA.

**Hydration** attaches event handlers and component state to existing server HTML. Hydration cost scales with the size of the interactive tree. Shipping a huge client component tree just to hydrate a mostly static page wastes the SSR win. Patterns that help:

- Keep client islands small
- Stream and Suspense so the shell is usable early
- Avoid mismatches that force the client to throw away server HTML
- Use `hydrateRoot` (not a fresh client-only `createRoot`) when you intend to hydrate

SSR helps LCP when the bottleneck is waiting for JS to render the first view. It does not automatically fix slow interactions after hydration.

Framework conventions differ, but the performance idea is stable: send useful HTML early, ship less client JS for static parts, and hydrate only what must be interactive.

## Images and Assets

LCP is often an image. Set explicit width and height (or aspect-ratio) to limit **CLS**. Use modern formats, `srcset`, and lazy loading for below-the-fold images; do not lazy-load the LCP image. Compress and cache static assets. Fonts can shift layout; load them in a way that avoids late swaps, or reserve space.

Code-split CSS the same way you split JS when a route owns a large style sheet. Inline a tiny critical shell only when you have measured a benefit.

Prefer CSS that does not force layout on every frame. Animating `top`/`left` or reading layout in scroll handlers can show up as poor INP even when React itself is idle.

## State Management Choices

A global store that notifies every subscriber on any change will re-render large trees. **Redux** with `useSelector` (or equivalent) should select a narrow slice and rely on equality checks. **Zustand** and similar libraries offer selector hooks for the same reason. The earlier Redux article on this site goes into store structure; the performance rule is simple: subscribe to what you need, not to the whole state object.

```jsx
// Narrow selector
const name = useSelector((state) => state.user.name);
const score = useStore((state) => state.score);
```

Context is a store with a single value. If many unrelated fields share one context, splitting or selecting is the fix, not a faster CPU.

## Debouncing and Throttling

Debounce search input before you hit the network. Throttle scroll and resize handlers. These are older tools and still valid for events outside React's render cycle. For rendering a heavy list as the user types, prefer `useDeferredValue` or a transition when you want React to keep the input snappy without a hardcoded delay.

```jsx
useEffect(() => {
  const id = setTimeout(() => setDebouncedQuery(query), 200);
  return () => clearTimeout(id);
}, [query]);
```

Always clear the timer in the effect cleanup.

Leading-edge vs trailing-edge choices matter: a search box often waits until typing pauses (debounce), while a scroll handler may want updates at a regular interval (throttle). Pick the one that matches the event.

## Web Workers

Workers run CPU-heavy work off the main thread: parsing large JSON, expensive transforms, some canvas or crypto tasks. They do not speed up React's own render, and they add serialization cost at the boundary. Use them when the Performance panel shows long scripting tasks that are not React commits and can be isolated.

## Memory Leaks and Effect Cleanup

Effects that subscribe to something must unsubscribe. Leaks show up as growing memory, duplicate listeners, and setState on unmounted components (in older patterns).

```jsx
useEffect(() => {
  const controller = new AbortController();
  fetch(url, { signal: controller.signal }).then(/* ... */);

  const connection = openSocket(url);
  connection.on("message", handler);

  return () => {
    controller.abort();
    connection.close();
  };
}, [url]);
```

Clean up timers, observers, subscriptions, and imperative widgets. In development, Strict Mode runs setup/cleanup twice to help you find missing cleanup. That is expected, not a production double-fetch bug by itself.

Detached DOM nodes held by closures in long-lived listeners are a classic leak in SPAs that never fully reload. When a route unmounts, everything it subscribed to should go with it.

## Production Builds

Development builds of React include extra warnings and are slower. Always measure production builds (`npm run build` or your framework's production mode) before you declare a performance win. Minify, enable compression on the server, send long-cache hashed assets, and disable development-only tools such as `why-did-you-render`. Source maps should not be required on the client for ordinary users.

Feature flags and dead-code elimination belong in the production bundler config so unused admin tools do not ship to every visitor.

Compare your local production build against what is actually served: compression, HTTP caching, and CDN configuration can matter as much as the JavaScript you emit. A well-minified bundle still feels slow if every navigation re-downloads it as `no-cache`.

## Step by Step Order of Work

1. Record LCP, INP, and CLS in the lab and, if you can, in the field with `web-vitals`.
2. Profile the slow interaction in React DevTools and the Performance panel.
3. Fix loading problems first if LCP is poor: bundle size, code splitting, images, SSR/streaming.
4. Fix interaction problems next: state colocation, list virtualization, transitions, expensive calculations.
5. Enable React Compiler on a branch and compare profiles; keep or add manual memoization only where it still earns its keep.
6. Re-measure a production build after each change.

## Common Mistakes

- Memoizing everything before measuring
- Using array indexes as keys in dynamic lists
- Putting high-frequency state at the top of a large tree
- One fat context or store subscription for unrelated fields
- Lazy-loading the LCP image
- Measuring a development build and calling it done
- Creating new objects in render and then wondering why `memo` never hits
- Fetching in a chain of child effects instead of starting work earlier
- Leaving event listeners and sockets open
- Treating the compiler as a reason to ignore the Rules of React

## Quick Reference

| Problem | First Place to Look |
|---|---|
| Slow typing or clicks | Profiler, INP, transitions, colocation, lists |
| Slow first paint | Bundle, code splitting, images, SSR/streaming |
| Layout jumps | Image and font sizes, reserved space, CLS |
| Huge lists | Virtualization |
| Cascading renders | State location, context split, memo/compiler |
| Repeat network work | Query cache, prefetch, avoid waterfalls |
| Jank from CPU work | `useMemo`, workers, do less in render |
| Memory growth | Effect cleanup, detached listeners |

## Conclusion

React performance work is ordinary engineering: understand render versus commit, measure the slow path, and apply the smallest change that removes real cost. Fiber and concurrent features give you tools to keep input snappy while heavy UI catches up. The compiler, now a stable build-time memoizer, can take over much of the manual `memo` work if your code follows the rules. Loading performance still depends on bundles, images, and how much JavaScript you hydrate.

Start with Core Web Vitals and a profiler session, fix the dominant issue, and only then reach for more specialized tools such as workers or aggressive memoization. The apps that stay fast are the ones that keep measuring after each change, including in production builds and in the field. React gives you a clear render model and, with the compiler and concurrent features, less manual bookkeeping than a few years ago. The work that remains is choosing what to load, what to render, and when to do the expensive parts, then checking that the change still holds for the devices and networks in your field data, not only on a fast developer laptop on a quiet office network.
