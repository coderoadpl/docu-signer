# Server state (TanStack Query policy)

Normative usage rules for the server-state layer: `core/client` descriptors
consumed by `apps/web` through TanStack Query. Extends `architecture.md`
§Frontend; distilled from a full pass over the query.gg course synthesis
(react-archive) against this architecture. Enforcement mechanisms live in
[frontend-lint-plan.md](frontend-lint-plan.md).

## The seam (deliberate non-decision)

TanStack Query is **not** wrapped in a port. The descriptor shape — a plain
`{ queryKey, queryFn, ... }` object produced by `core/client` factories — *is*
the seam: it carries resource identity plus fetch logic and nothing
React- or library-specific. `@tanstack/query-core` itself is the
framework-agnostic engine (cache, retry, dedup, observers); if the UI framework
ever changes, the replacement is a thin observer adapter over query-core, not a
rewrite of `core/client`. Wrapping `useQuery` behind a house interface would
re-type a large API surface, defeat `@tanstack/eslint-plugin-query`, and hide a
library every model knows behind an abstraction none does. Never do it.

`queryOptions()`/`infiniteQueryOptions()` live in `@tanstack/react-query` and
are therefore banned from `core/client`; descriptors are typed by a local
`defineQuery`/`defineInfiniteQuery` identity helper (typed against
`@tanstack/query-core` option types, binding the `queryFn` result type to the
key). `skipToken` imports from `@tanstack/query-core` and is allowed in core.

## Descriptors

- **Actions, not clients.** `core/client` exposes factories that take their
  dependencies (`ApiClient`, `AuthClientPort`); the app's `api.ts` binds them
  once into a ready action set. Feature code imports bound actions and never
  references `ApiClient`, a port or an adapter (lint) — whether HTTP happens
  underneath is not a feature's concern.
- **CQRS partition.** Every action is either a **query** (safe read — wraps a
  GET contract route, cacheable, no side effects) or a **command** (unsafe
  write — mutation descriptor, triggers scope invalidation). No hybrids.
  Commands are not a data source for rendering: after a command the UI reads
  through queries (invalidation → refetch); a command's return value feeds
  `setQueryData` only in the complete-single-resource case. Naming: queries
  are nouns (`todos.list(params)`), commands are imperative verbs
  (`todos.add`, `auth.signIn`). Every client interface consumes the same
  partition — the CLI maps commands to verbs and queries to reads.
  Enforcement is type-level: contract routes carry their HTTP method, client
  method types carry a read/write tag, and `defineQuery`/`defineMutation`
  accept only matching tags (Phase 4 in the lint plan).
- Auth side effects (`signIn`/`signOut`/`signUp`) are mutation descriptors
  over `AuthClientPort` like any other action — never hand-rolled
  pending/error `useState` around a port call.
- Query keys are the **public API of a feature** and exist only in
  `core/client/queries.ts` factories (lint). Never hand-copy a key.
- Hierarchy is general → specific with a scope helper per resource:
  `todos.all()` → `todos.lists()` → `todos.list(params)` → `todos.detail(id)`.
  Invalidation and per-prefix defaults work by prefix matching; sloppy
  hierarchy degenerates into ad-hoc predicates.
- **Everything `queryFn` reads is in the key — by construction**: factories
  take params as arguments and interpolate them into both key and `queryFn`,
  so omission is impossible. `@tanstack/eslint-plugin-query` `exhaustive-deps`
  backs this up.
- Keys hold only serializable values (`as const` tuples; no functions, no
  class instances).
- `queryFn` delegates to the typed client, which zod-parses the envelope and
  returns `Result<T, AppError>`; the descriptor unwraps and **throws
  `ApiError`**. No `try/catch` that swallows; a zod failure is a query error
  like any other. Types flow client → descriptor → hook; never pass explicit
  generics to `useQuery`/`useQueries` at call sites.
- Optional-param gating uses `skipToken`, not `enabled` + non-null assertion —
  `enabled` controls execution, it does not narrow types.
- One descriptor per domain entity. Combining requests in one `queryFn`
  (`Promise.all`) is allowed only when the parts are domain-wise a single
  resource that must load, error and refetch together; otherwise split and let
  the dependent query gate on the upstream result.

## QueryClient policy

- Exactly one `QueryClient`, created at module scope in
  `apps/web/src/query-client.ts` — never inside a component (a render-scoped
  client resets the cache). Application code reaches it via `useQueryClient()`,
  never by importing the singleton.
- `defaultOptions` are explicit, never implicit: repo-wide `staleTime`
  (30s baseline), `gcTime`, and a retry predicate derived from the error
  taxonomy — retry `internal` and network failures, never `validation`,
  `unauthorized`, `forbidden`, `not_found`, `conflict`.
- No global default `queryFn` — deriving URLs from keys would bypass the typed
  client and its zod parse.
- The global error surface is `QueryCache.onError` (one toast per failing
  query, not per observer): stale data on screen → keep it and toast the
  refresh failure; no data → the error renders locally or escalates to the
  root error boundary via a `throwOnError` predicate.
- Query Devtools ship in dev builds; `@tanstack/react-query-devtools` is
  importable only in the composition root (lint), like every other TanStack
  package placement rule.

## Reading query state

- `status === 'success'` is the only proof `data` exists. Never guard with
  `!isLoading`/`!isError` (a disabled or paused query is `pending` + `idle`
  with `isLoading === false`), never `data!`.
- `status` (cache: pending/success/error) and `fetchStatus` (activity:
  fetching/idle/paused) are orthogonal; background refresh indicators come
  from `fetchStatus`, availability from `status`.
- Never rest-destructure a query result (kills tracked-property render
  optimization); read the fields you use. `select` for subscribing to a
  subset — keep it referentially stable.

## Mutations

- Server side effects are mutations, never queries. Mutation descriptors (with
  `mutationKey`) live next to query descriptors in `core/client`.
- After success, **invalidate the owning hierarchical scope** (in `onSettled`)
  — the server owns sort/filter/projection rules. `setQueryData` is allowed
  only when the mutation returns the complete resource, and only immutably.
- `invalidateQueries` takes a filter object (`{ queryKey: todos.lists() }`),
  never a bare array. Invalidation refetches active queries and marks the rest
  stale; `refetchType: 'all'` needs justification.
- Optimistic updates are reserved for instant-feedback interactions (toggles,
  reactions) and always follow the full protocol via a shared helper:
  `cancelQueries` → snapshot (`getQueryData`) → immutable write → rollback
  context consumed in `onError` → invalidate in `onSettled`. Simpler cases use
  the v5 UI variant (`variables` + `isPending`) instead of cache writes.

## Freshness and polling

- Tune `staleTime` per resource; never blanket-disable
  `refetchOnWindowFocus`/`refetchOnReconnect`/`retry` — the aggressive
  defaults are the resilience model. `staleTime: Infinity` requires a
  justification (practically immutable data only).
- Polling (`refetchInterval`) is the sanctioned realtime mechanism (no
  websockets). Job/status polling uses the function form and returns `false`
  to stop; a shared poll-until-predicate helper prevents hand-rolling.

## Pagination and infinite lists

- Pagination is a plain query with `page`/`sort` in the key;
  `placeholderData: (prev) => prev` keeps the old page during transitions and
  `isPlaceholderData` disables the controls so users cannot act on
  transitional data. `PAGE_SIZE` is a named constant.
- Infinite scroll uses the infinite descriptor (`initialPageParam`,
  `getNextPageParam` returning `undefined` at the end, `maxPages` for
  unbounded lists); cursors must be part of the response schema. Flattening
  (`pages.flat()`) happens in the descriptor-backed hook, not in components.
- `initialData` only for complete, schema-valid data (it is real cache and can
  suppress the fetch); `placeholderData` for partial previews.

## Prefetching and cancellation

- Prefetch (`queryClient.prefetchQuery`) always reuses the descriptor — never a
  hand-copied key — and hover-triggered prefetch requires a non-zero
  `staleTime` (default `0` would refetch on every hover).
- Never destructure methods off a `QueryClient` (class `this` binding).
- The typed client accepts an `AbortSignal`; descriptors forward
  `context.signal`. Mandatory for search/typeahead resources.

## Testing

- Component + real `QueryClientProvider` + MSW. Mocking `useQuery` or
  `core/client` internals is banned; seed cache through descriptor keys when
  needed.
- Test harness: fresh `QueryClient` per test with `retry: false`, `gcTime: 0`.
- Required assertions per resource family: non-2xx → `status: 'error'`;
  invalidation-after-mutation refetches (override MSW handlers per test);
  poll-until stops on its predicate; `getNextPageParam` returns `undefined` at
  the end.

## Not in this architecture

| Topic | Status |
|---|---|
| SSR / streaming SSR hydration | N/A (SPA only). If ever added: per-request `QueryClient`, `dehydrate`/`HydrationBoundary`, never a cross-request singleton. |
| Websockets | N/A (polling only). If ever added: events invalidate descriptor scopes; full cache writes only for complete, zod-parsed payloads. |
| Suspense queries | Not used; classic `useQuery` is the house style. Revisit deliberately (no `enabled`, no `placeholderData`, waterfall rules). |
| Cache persistence (`localStorage`/IndexedDB) | A product feature, not a free optimization. If ever added: opt-in via `meta.persist`, never sensitive data, `gcTime` ≥ persister `maxAge`. |
