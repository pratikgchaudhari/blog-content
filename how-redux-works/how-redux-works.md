---
title: How Redux Works - Store, Actions, Reducers, Middleware, React-Redux and Redux Toolkit
date: 2026-11-09
summary: A detailed guide to Redux covering its Flux origins, the three principles, a from-scratch store, combineReducers, middleware internals, thunks, react-redux subscriptions and selectors, Redux Toolkit, RTK Query, and when not to use Redux.
tag: redux, react, react-redux, redux-toolkit, state-management, javascript, typescript, frontend
draft: false
related: top-10-use-external-store-react-hook-interview-questions,top-10-react-use-context-interview-questions,software-design-patterns-real-world-examples,how-apache-kafka-works
---

**Redux** is a small JavaScript library for managing application state. It keeps the whole state of an application in a single object called the **store**, allows that state to change only through plain objects called **actions**, and computes every new state with pure functions called **reducers**. Because every change flows through one place in one format, the state of the application at any moment can be explained by the list of actions that produced it.

Redux was created by Dan Abramov and Andrew Clark and released in 2015. It grew out of **Flux**, an application architecture Facebook described in 2014, and borrowed ideas from the **Elm** language, where an application is a function from messages to new models. Abramov demonstrated Redux at React Europe 2015 with hot reloading and "time travel" debugging, and it quickly became the most widely used state library in the React world. In 2019 the team released **Redux Toolkit** (RTK), which is now the official and recommended way to write Redux code.

Redux is not tied to React. The core library has no dependency on any UI framework, and the bindings for React live in a separate package, **react-redux**. This article covers how Redux works from the inside: the core ideas, a from-scratch store implementation, middleware, the React bindings, Redux Toolkit, and when Redux is the wrong tool.

## The Problem Redux Solves

In a small React application, state lives in components and flows down as props. This works until several distant parts of the UI need the same data. Typical symptoms are:

- **Prop drilling**: a value is passed through many components that do not use it, only so a deeply nested child can read it.
- **Scattered updates**: the same piece of data is changed from several places, and it is hard to tell which code changed it and why.
- **Inconsistent copies**: two components keep their own copies of the same data, and the copies drift apart.
- **Hard-to-reproduce bugs**: a bug depends on a particular sequence of user actions, and there is no record of that sequence.

Redux moves shared state into a single store and makes every change explicit: a component dispatches an action describing what happened, and reducers decide how the state changes.

The trade-off is indirection: an action, a reducer and a subscription where `useState` needed one line.

## From Flux to Redux

### The Flux Architecture

Facebook introduced Flux to deal with hard-to-follow cascading updates in applications built on two-way data binding. It enforced a **unidirectional data flow**:

```
+--------+     +------------+     +--------+     +------+
| Action | --> | Dispatcher | --> | Stores | --> | View |
+--------+     +------------+     +--------+     +------+
    ^                                               |
    |_______________________________________________|
                  user interaction
```

- **Actions** described events.
- A single **dispatcher** sent every action to every store.
- **Stores** held state and logic, and updated themselves in response to actions.
- **Views** re-rendered when stores emitted change events.

### What Redux Changed

Redux kept the unidirectional flow but simplified it:

| Flux | Redux |
|---|---|
| Many stores | A single store |
| A separate dispatcher | `dispatch` is a method on the store |
| Stores mutate their own state | Reducers return new state objects |
| Store logic lives in classes with callbacks | Logic lives in pure functions |
| Stores can depend on each other via `waitFor` | Reducers are composed into one root reducer |

Replacing mutable stores with pure reducers is the key change. Because old states are never modified, they can be kept, compared and replayed, which makes time-travel debugging possible.

## The Three Principles

The Redux documentation describes the library with three principles.

1. **Single source of truth**: the global state of the application is stored in one object tree inside a single store. This makes it easy to inspect, serialize, persist, and hydrate from the server.
2. **State is read-only**: the only way to change the state is to dispatch an action, a plain object describing what happened. Views and network callbacks never write to the state directly.
3. **Changes are made with pure functions**: reducers take the previous state and an action and return the next state. They do not mutate their arguments, perform side effects, or call non-deterministic functions such as `Math.random()` or `Date.now()`.

Together these principles produce the core Redux loop:

```
           dispatch(action)
 UI  ---------------------------->  Store
  ^                                   |
  |                                   | nextState = reducer(state, action)
  |      notify subscribers           v
  +-------------------------------  State
```

## Core Concepts

### Actions

An **action** is a plain JavaScript object with a `type` field. By convention, the type is a string in the form `"domain/eventName"`, and any extra data goes in a field called `payload`:

```js
const action = {
  type: 'todos/todoAdded',
  payload: { id: 1, text: 'Learn Redux', completed: false },
};
```

Actions describe events that have happened, not commands. `todos/todoAdded` reads better than `todos/addTodo` because several reducers may respond to the same event in different ways.

An **action creator** is a function that builds an action, which avoids repeating object literals across the codebase:

```js
const todoAdded = (todo) => ({ type: 'todos/todoAdded', payload: todo });
```

### Reducers

A **reducer** is a function `(state, action) => newState`. It receives the current state and an action, and returns the next state. If the action is not relevant, it returns the existing state unchanged:

```js
const initialState = { items: [], filter: 'all' };

function todosReducer(state = initialState, action) {
  switch (action.type) {
    case 'todos/todoAdded':
      return { ...state, items: [...state.items, action.payload] };
    case 'todos/todoToggled':
      return {
        ...state,
        items: state.items.map((todo) =>
          todo.id === action.payload ? { ...todo, completed: !todo.completed } : todo
        ),
      };
    case 'todos/filterChanged':
      return { ...state, filter: action.payload };
    default:
      return state;
  }
}
```

The default parameter `state = initialState` matters. When the store is created, Redux dispatches an internal initialization action with a random type, so every reducer receives `undefined` and returns its initial state.

The rules for reducers are strict:

- Compute the new state only from `state` and `action`.
- Never mutate `state`. Copy it and change the copy.
- No side effects: no API calls, timers, logging to a server, or random values.

### The Store

The **store** is the object that holds the current state and connects everything together. It exposes three main methods:

- **`getState()`** returns the current state.
- **`dispatch(action)`** runs the reducer with the current state and the action, saves the result, and notifies subscribers.
- **`subscribe(listener)`** registers a callback that runs after every dispatch, and returns a function to unsubscribe.

### Dispatch

**Dispatching** is the only way to trigger a state change:

```
dispatch({ type: 'todos/todoAdded', payload })
        |
        v
nextState = rootReducer(currentState, action)
        |
        v
currentState = nextState
        |
        v
listeners.forEach(listener => listener())
        |
        v
UI reads getState() and re-renders what changed
```

Dispatch is **synchronous**. When `dispatch` returns, the reducer has already run and every subscriber has been notified.

## Immutability

Redux depends on **immutable updates**. A reducer must return a new object when anything changes, and the same object when nothing changes. The reason is performance: to find out whether something changed, Redux and react-redux compare references with `===` instead of comparing contents deeply. That comparison only works if every change produces a new reference.

```js
// Wrong: mutates the existing state, the reference stays the same
state.items.push(newTodo);
return state;

// Right: creates new objects along the path that changed
return { ...state, items: [...state.items, newTodo] };
```

An immutable update copies only objects on the path to the change and shares the rest, called **structural sharing**:

```
old state                     new state
{ user, todos }               { user, todos' }
    |      |                       |      |
   user  todos [a, b]            user   todos' [a, b, c]
    ^      |    ^  ^              ^             ^  ^
    |      |____|__|______________|_____________|__|
    |___________________________|
         shared references (not copied)
```

Here `user`, `a` and `b` are the same objects in both states. Only the root object and the `todos` array are new. Nested updates become verbose with spread syntax, which is one of the main problems Redux Toolkit solves with Immer.

## Building createStore from Scratch

The Redux core is small enough to rebuild in a few dozen lines. The following implementation captures how the real `createStore` behaves, minus some error checks:

```js
function createStore(reducer, preloadedState, enhancer) {
  if (typeof enhancer === 'function') {
    return enhancer(createStore)(reducer, preloadedState);
  }

  let currentState = preloadedState;
  let listeners = [];
  let isDispatching = false;

  function getState() {
    if (isDispatching) {
      throw new Error('Cannot call getState while the reducer is executing.');
    }
    return currentState;
  }

  function subscribe(listener) {
    listeners = [...listeners, listener];
    let subscribed = true;

    return function unsubscribe() {
      if (!subscribed) return;
      subscribed = false;
      listeners = listeners.filter((l) => l !== listener);
    };
  }

  function dispatch(action) {
    if (typeof action !== 'object' || action === null || typeof action.type === 'undefined') {
      throw new Error('Actions must be plain objects with a type field.');
    }
    if (isDispatching) {
      throw new Error('Reducers may not dispatch actions.');
    }

    try {
      isDispatching = true;
      currentState = reducer(currentState, action);
    } finally {
      isDispatching = false;
    }

    const snapshot = listeners;
    snapshot.forEach((listener) => listener());
    return action;
  }

  dispatch({ type: '@@redux/INIT' + Math.random().toString(36).slice(2) });

  return { getState, dispatch, subscribe };
}
```

A few details are worth pointing out:

- **Initialization**: the store dispatches an action with a random type. No reducer matches it, so each reducer returns its default state, and the initial state tree is built.
- **Reentrancy guard**: `isDispatching` prevents a reducer from calling `dispatch` or `getState`, which would break the guarantee that reducers are pure.
- **Listener snapshot**: `subscribe` and `unsubscribe` replace the `listeners` array instead of mutating it. A listener that subscribes or unsubscribes during a notification does not affect the current loop.
- **Listeners get no arguments**: subscribers are only told that something may have changed. They call `getState()` and decide for themselves.
- **Enhancers**: if a third argument is passed, `createStore` hands itself to the enhancer, which returns a modified store creator. `applyMiddleware` is an enhancer.

In Redux 5, the original `createStore` is marked as deprecated in favour of Redux Toolkit's `configureStore`. It still works, and `legacy_createStore` is exported for code that wants to avoid the deprecation notice.

## combineReducers

A real application has many slices of state, such as todos, user and settings. Writing all of them in one reducer would be unmanageable. **`combineReducers`** builds a root reducer from an object of slice reducers, where each slice reducer manages one key of the state:

```js
const rootReducer = combineReducers({
  todos: todosReducer,
  user: userReducer,
  settings: settingsReducer,
});
// state shape: { todos: ..., user: ..., settings: ... }
```

A simplified implementation shows how it works:

```js
function combineReducers(reducers) {
  const keys = Object.keys(reducers);

  return function combination(state = {}, action) {
    let hasChanged = false;
    const nextState = {};

    for (const key of keys) {
      const previousSlice = state[key];
      const nextSlice = reducers[key](previousSlice, action);
      nextState[key] = nextSlice;
      hasChanged = hasChanged || nextSlice !== previousSlice;
    }

    hasChanged = hasChanged || keys.length !== Object.keys(state).length;
    return hasChanged ? nextState : state;
  };
}
```

Two properties follow:

- **Every reducer sees every action.** Each slice reducer decides for itself whether to respond, which is how one action can update several slices.
- **Unchanged state keeps its reference.** If no slice changed, the original root object is returned, so subscribers comparing references see no change.

## Middleware

### What Middleware Does

Reducers must be pure, but real applications need side effects: API calls, logging, analytics, and routing. **Middleware** is the extension point for this. It sits between `dispatch` and the reducer, and each middleware can inspect, change, delay, or block an action, or dispatch new ones:

```
dispatch(action)
     |
     v
+-----------+    +-----------+    +-----------+    +---------+
|  logger   | -> |   thunk   | -> | analytics | -> | reducer |
+-----------+    +-----------+    +-----------+    +---------+
```

### The Middleware Signature

A middleware is a curried function with three levels:

```js
const logger = (storeAPI) => (next) => (action) => {
  console.log('dispatching', action);
  const result = next(action);
  console.log('next state', storeAPI.getState());
  return result;
};
```

Each level has a purpose:

| Level | Receives | Called |
|---|---|---|
| `storeAPI => ...` | `{ getState, dispatch }` | Once, when the store is created |
| `next => ...` | The next dispatch function in the chain | Once, when the chain is built |
| `action => ...` | The action being dispatched | On every dispatch |

**Currying** lets each layer be configured at a different time. The store reference is bound first, then the chain is wired, and only the innermost function runs per action. Calling `next(action)` passes the action along; calling `storeAPI.dispatch(action)` restarts it from the top of the chain.

### compose

Middleware chains are built with **`compose`**, a utility from functional programming that combines functions from right to left:

```js
function compose(...funcs) {
  if (funcs.length === 0) return (arg) => arg;
  if (funcs.length === 1) return funcs[0];
  return funcs.reduce((a, b) => (...args) => a(b(...args)));
}

// compose(f, g, h)(x) is the same as f(g(h(x)))
```

### applyMiddleware

**`applyMiddleware`** is a store enhancer. It creates the store normally, then replaces `dispatch` with the composed middleware chain:

```js
function applyMiddleware(...middlewares) {
  return (createStore) => (reducer, preloadedState) => {
    const store = createStore(reducer, preloadedState);

    let dispatch = () => {
      throw new Error('Dispatching while constructing middleware is not allowed.');
    };

    const storeAPI = {
      getState: store.getState,
      dispatch: (action, ...args) => dispatch(action, ...args),
    };

    const chain = middlewares.map((middleware) => middleware(storeAPI));
    dispatch = compose(...chain)(store.dispatch);

    return { ...store, dispatch };
  };
}
```

The order of operations explains the behaviour:

1. Each middleware is called with `storeAPI`, producing a function of `next`.
2. `compose` wires them so the first middleware's `next` is the second middleware's action handler, and the last middleware's `next` is the store's original `dispatch`.
3. The resulting function replaces `dispatch` on the returned store.

`storeAPI.dispatch` is a wrapper around the variable `dispatch`, not a direct reference. By the time any action is dispatched, the variable points at the full chain, so a middleware that dispatches a new action sends it through every middleware again.

## Thunks and Async Logic

### Redux Thunk

Reducers cannot fetch data, so async work happens in middleware. The most common choice is **redux-thunk**, which is included by default in Redux Toolkit. A **thunk** is a function that delays work. With the thunk middleware, a function can be dispatched instead of an action:

```js
const thunk = (storeAPI) => (next) => (action) => {
  if (typeof action === 'function') {
    return action(storeAPI.dispatch, storeAPI.getState);
  }
  return next(action);
};
```

That is essentially the entire middleware. If the dispatched value is a function, it is called with `dispatch` and `getState`. Otherwise the action continues down the chain.

A typical async thunk dispatches actions to describe each stage of a request:

```js
const fetchTodos = () => async (dispatch, getState) => {
  dispatch({ type: 'todos/fetchStarted' });
  try {
    const response = await fetch('/api/todos');
    const todos = await response.json();
    dispatch({ type: 'todos/fetchSucceeded', payload: todos });
  } catch (error) {
    dispatch({ type: 'todos/fetchFailed', error: error.message });
  }
};

store.dispatch(fetchTodos());
```

### Other Async Approaches

Thunks are the default. **redux-saga** (generators), **redux-observable** (RxJS streams) and Redux Toolkit's built-in **listener middleware** handle more complex flows such as cancellation and long-running workflows.

## React-Redux

### Provider

**react-redux** connects a Redux store to React components. The store is made available to the tree through **`Provider`**, which puts it in React context:

```jsx
import { Provider } from 'react-redux';
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')).render(
  <Provider store={store}>
    <App />
  </Provider>
);
```

Context carries only the store object, which never changes, so a dispatch does not re-render every context consumer. Components subscribe to the store directly.

### useSelector and useDispatch

Components read state with **`useSelector`** and send actions with **`useDispatch`**:

```jsx
import { useSelector, useDispatch } from 'react-redux';

function TodoList() {
  const todos = useSelector((state) => state.todos.items);
  const dispatch = useDispatch();

  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo.id} onClick={() => dispatch({ type: 'todos/todoToggled', payload: todo.id })}>
          {todo.completed ? <s>{todo.text}</s> : todo.text}
        </li>
      ))}
    </ul>
  );
}
```

Before hooks were added in react-redux 7.1, the same job was done with the **`connect`** higher-order component and its `mapStateToProps` and `mapDispatchToProps` functions. `connect` still works, but hooks are the recommended API.

### How Subscriptions Work

Each `useSelector` call subscribes to the store. Since react-redux 8, this is built on React's **`useSyncExternalStore`** hook, which was designed for reading from external stores safely during concurrent rendering. On every dispatch:

1. The store notifies its subscribers.
2. Each `useSelector` runs its selector against the new state.
3. It compares the new result with the previous one using **strict reference equality** (`===`) by default.
4. If the result is different, the component re-renders. If it is the same, nothing happens.

```
dispatch(action)
     |
     v
store notifies subscribers
     |
     +--> TodoList:   selector(state) === previous ?  no  -> re-render
     +--> Header:     selector(state) === previous ?  yes -> skip
     +--> Settings:   selector(state) === previous ?  yes -> skip
```

This makes reference equality central to performance. Every selector runs on every dispatch, so selectors should be cheap, and a selector that returns a new object or array every time causes a re-render on every dispatch, even when nothing relevant changed:

```js
// Re-renders after every dispatch: filter() always returns a new array
const done = useSelector((state) => state.todos.items.filter((t) => t.completed));

// Returns a primitive: re-renders only when the count changes
const doneCount = useSelector(
  (state) => state.todos.items.filter((t) => t.completed).length
);
```

For selectors that return a small object of existing values, `useSelector` accepts an equality function as its second argument, such as `shallowEqual` from react-redux.

### Selector Memoization with Reselect

The cleaner fix for derived data is a **memoized selector**. **Reselect**, whose `createSelector` is re-exported by Redux Toolkit, builds selectors that recompute only when their inputs change:

```js
import { createSelector } from '@reduxjs/toolkit';

const selectTodos = (state) => state.todos.items;
const selectFilter = (state) => state.todos.filter;

const selectVisibleTodos = createSelector(
  [selectTodos, selectFilter],
  (todos, filter) => {
    if (filter === 'done') return todos.filter((t) => t.completed);
    if (filter === 'open') return todos.filter((t) => !t.completed);
    return todos;
  }
);

// In a component
const visibleTodos = useSelector(selectVisibleTodos);
```

The **input selectors** run on every call. If their results are the same references as last time, `createSelector` returns the cached output without running the **result function**. Because the cached array is the same reference, `useSelector` sees no change and the component does not re-render. This is where immutability pays off again: unchanged inputs keep their references, so the check is cheap.

By default, a `createSelector` instance caches the latest set of inputs. Selectors that take arguments, such as a todo ID, may need one selector instance per component, or a larger cache, to stay effective.

## Redux Toolkit

### Why Redux Toolkit Exists

Hand-written Redux was criticised for boilerplate, verbose immutable updates and too many packages to configure. **Redux Toolkit** (RTK) packages the recommended patterns into a few APIs and is recommended for all new Redux code.

### configureStore

**`configureStore`** wraps `createStore` with good defaults:

```ts
import { configureStore } from '@reduxjs/toolkit';
import todosReducer from './todosSlice';
import userReducer from './userSlice';

export const store = configureStore({
  reducer: {
    todos: todosReducer,
    user: userReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
```

It does several things automatically:

- Calls `combineReducers` when given an object of reducers.
- Adds the thunk middleware.
- In development, adds checks that throw on state mutations and warn about non-serializable values in state or actions.
- Connects to the Redux DevTools browser extension.

### createSlice

**`createSlice`** generates action creators and action types from reducer functions, removing the need to write them by hand:

```ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

interface TodosState {
  items: Todo[];
  filter: 'all' | 'open' | 'done';
}

const initialState: TodosState = { items: [], filter: 'all' };

const todosSlice = createSlice({
  name: 'todos',
  initialState,
  reducers: {
    todoAdded(state, action: PayloadAction<Todo>) {
      state.items.push(action.payload);
    },
    todoToggled(state, action: PayloadAction<number>) {
      const todo = state.items.find((t) => t.id === action.payload);
      if (todo) todo.completed = !todo.completed;
    },
    filterChanged(state, action: PayloadAction<TodosState['filter']>) {
      state.filter = action.payload;
    },
  },
});

export const { todoAdded, todoToggled, filterChanged } = todosSlice.actions;
export default todosSlice.reducer;
```

The `name` becomes the prefix of each action type, so `todoAdded` produces actions with the type `"todos/todoAdded"`.

### Immer

The reducers above appear to mutate state with `push` and direct assignment. They do not. `createSlice` runs each case reducer through **Immer**, which passes in a **draft**: a proxy that records every change. When the reducer finishes, Immer builds a new immutable state from the recorded changes, copying only the objects that were modified and sharing the rest.

```
original state --> draft (Proxy) --> reducer "mutates" draft
                                          |
                                          v
                       Immer produces a new state with
                       structural sharing; original untouched
```

Two rules apply with Immer:

- Either mutate the draft or return a new value, not both.
- The mutating style only works inside `createSlice`, `createReducer` or Immer's `produce`.

### createAsyncThunk

**`createAsyncThunk`** standardizes the pending, success and failure pattern for async requests. It generates a thunk and three action types:

```ts
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

export const fetchTodos = createAsyncThunk('todos/fetchTodos', async () => {
  const response = await fetch('/api/todos');
  return (await response.json()) as Todo[];
});

const todosRequestSlice = createSlice({
  name: 'todosRequest',
  initialState: { items: [] as Todo[], status: 'idle', error: null as string | null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchTodos.pending, (state) => {
        state.status = 'loading';
      })
      .addCase(fetchTodos.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.items = action.payload;
      })
      .addCase(fetchTodos.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.error.message ?? 'Unknown error';
      });
  },
});
```

| Generated action type | Dispatched when |
|---|---|
| `todos/fetchTodos/pending` | The thunk starts |
| `todos/fetchTodos/fulfilled` | The promise resolves; `payload` is the return value |
| `todos/fetchTodos/rejected` | The promise rejects; `error` holds the serialized error |

**`extraReducers`** lets a slice respond to actions defined elsewhere, such as the actions generated by a thunk or another slice.

### RTK Query

Much Redux state is a cache of server data, and writing thunks and reducers per endpoint is repetitive. **RTK Query**, included in Redux Toolkit since version 1.6, is a data fetching and caching layer built on Redux:

```ts
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export const todosApi = createApi({
  reducerPath: 'todosApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  tagTypes: ['Todo'],
  endpoints: (builder) => ({
    getTodos: builder.query<Todo[], void>({
      query: () => 'todos',
      providesTags: ['Todo'],
    }),
    addTodo: builder.mutation<Todo, Partial<Todo>>({
      query: (body) => ({ url: 'todos', method: 'POST', body }),
      invalidatesTags: ['Todo'],
    }),
  }),
});

export const { useGetTodosQuery, useAddTodoMutation } = todosApi;
```

The API's reducer and middleware are added to the store, and components use the generated hooks:

```tsx
function Todos() {
  const { data, isLoading, error } = useGetTodosQuery();
  const [addTodo] = useAddTodoMutation();

  if (isLoading) return <p>Loading...</p>;
  if (error) return <p>Failed to load</p>;

  return (
    <>
      <button onClick={() => addTodo({ text: 'New', completed: false })}>Add</button>
      <ul>{data?.map((t) => <li key={t.id}>{t.text}</li>)}</ul>
    </>
  );
}
```

RTK Query deduplicates requests, shares cache entries between components, removes data some time after the last subscriber unmounts, and refetches queries whose tags a mutation invalidates.

## Redux DevTools and Time Travel

The **Redux DevTools** browser extension shows every dispatched action, the state after each one, and a diff of what changed. It works because Redux keeps the conditions that make history meaningful:

- Every change is an action, so the action list is a complete log of what happened.
- Reducers are pure, so replaying the same actions from the same initial state always produces the same states.
- States are immutable, so earlier states can be kept without copying them defensively.

**Time-travel debugging** builds on this. The DevTools can jump back to any earlier action, skip an action and recompute the states that follow, or export the action log and import it elsewhere to reproduce a bug.

The model resembles an event log, the same idea behind event sourcing and systems such as Kafka: the current state is a fold over the sequence of events.

```
initialState --A1--> S1 --A2--> S2 --A3--> S3   (current)
                      ^
                      jump here: DevTools restores S1 and the UI re-renders
```

Time travel depends on the rules being followed. A reducer that calls `Date.now()` or mutates state, or a non-serializable value in the state, breaks replay and makes the DevTools output unreliable.

## Normalized State

Data from APIs is often nested. Storing it as-is leads to duplication: the same user can appear inside many posts and comments, and updating that user means finding every copy. The recommended approach is **normalized state**, which works like tables in a relational database:

- Each type of entity gets its own collection.
- Entities are stored in an object keyed by ID, with a separate array of IDs for ordering.
- Entities refer to each other by ID instead of nesting.

```js
// Nested
{
  posts: [
    { id: 'p1', author: { id: 'u1', name: 'Asha' }, comments: [ /* ... */ ] },
  ],
}

// Normalized
{
  users: { ids: ['u1'], entities: { u1: { id: 'u1', name: 'Asha' } } },
  posts: { ids: ['p1'], entities: { p1: { id: 'p1', authorId: 'u1', commentIds: ['c1'] } } },
  comments: { ids: ['c1'], entities: { c1: { id: 'c1', postId: 'p1', text: 'Nice' } } },
}
```

Redux Toolkit provides **`createEntityAdapter`** to manage this shape. It supplies reducers such as `addOne`, `upsertMany` and `removeOne`, and memoized selectors such as `selectAll` and `selectById`.

## When Not to Use Redux

Redux is one option among several, and many applications do not need it. The main alternatives are:

| Option | Best suited for | Trade-offs |
|---|---|---|
| **Component state** (`useState`, `useReducer`) | State used by one component or a small subtree | No global access or devtools history |
| **React Context** | Values that change rarely: theme, locale, current user | Every consumer re-renders when the value changes; no built-in selectors |
| **Zustand** | Shared client state with minimal setup | Fewer conventions; less structure for large teams |
| **Server-state libraries** (TanStack Query, SWR, RTK Query) | Data fetched from APIs | Not meant for purely local UI state |
| **Redux Toolkit** | Large shared client state, many contributors, complex update logic, debugging needs | More concepts and indirection |

Context with `useReducer` can replace simple Redux usage, but a frequently changing context value re-renders every consumer. And much "global state" is really a cache of server data, which a server-state library handles with far less code.

## Common Mistakes

- **Mutating state in plain reducers**: `push`, `splice` or property assignment outside Immer keeps the old reference, so subscribers miss the change.
- **Side effects in reducers**: API calls, random IDs, or timestamps inside reducers break purity and replay. Generate these in action creators or thunks, or use the `prepare` callback in `createSlice`.
- **Selectors that return new references**: `map`, `filter` or object literals inside `useSelector` cause re-renders on every dispatch. Use `createSelector` or return primitives.
- **Selecting too much**: `useSelector((state) => state)` re-renders the component on every state change. Select only what the component needs.
- **Putting everything in Redux**: form inputs, hover states and open/closed toggles usually belong in component state.
- **Storing non-serializable values**: promises, class instances, functions and DOM nodes in state break DevTools and persistence.
- **Duplicating server data**: copying API responses into several slices instead of normalizing them, or instead of using RTK Query.
- **Writing hand-rolled Redux in new code**: switch statements, action type constants and manual store setup are the legacy style. Redux Toolkit is the recommended approach.

## Cheat Sheet

| Concept | Summary |
|---|---|
| Store | Holds the state; exposes `getState`, `dispatch`, `subscribe` |
| Action | Plain object with a `type`, usually a `payload` |
| Reducer | Pure `(state, action) => newState`; no mutation or side effects |
| Dispatch | Synchronous; runs the reducer, then notifies subscribers |
| `combineReducers` | Builds a root reducer; every slice reducer sees every action |
| Middleware | `storeAPI => next => action`; sits between dispatch and reducer |
| `compose` | `compose(f, g)(x)` equals `f(g(x))` |
| `applyMiddleware` | Store enhancer that replaces `dispatch` with the chain |
| Thunk | Dispatch a function; receives `dispatch` and `getState` |
| `Provider` | Puts the store (not the state) in React context |
| `useSelector` | Subscribes; re-renders when the result changes by `===` |
| `createSelector` | Memoizes derived data by input references |
| `configureStore` | Store with thunk, dev checks, DevTools |
| `createSlice` | Generates actions and reducer; uses Immer |
| `createAsyncThunk` | Pending, fulfilled and rejected actions for async work |
| RTK Query | Server-state fetching, caching and invalidation |
| `createEntityAdapter` | Normalized `ids` and `entities` with CRUD reducers |

## Conclusion

Redux is a small idea with large consequences. Keeping state in a single store, changing it only through actions, and computing every new state with pure reducers makes an application's behaviour traceable. The same rules enable reference-equality checks for fast updates, a middleware pipeline for side effects, memoized selectors for derived data, and time-travel debugging.

Redux Toolkit keeps these foundations and removes most of the boilerplate with `configureStore`, `createSlice`, Immer and RTK Query. Whether to use Redux at all is a separate question: component state, Context, lighter stores and server-state libraries cover many applications well. Where a large application needs shared, predictable and debuggable client state, Redux and Redux Toolkit remain a solid choice.
