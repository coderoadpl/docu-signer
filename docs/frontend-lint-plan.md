# Frontend lint plan

Enforcement spec for `architecture.md` §Frontend. Method: **warn → fix →
error** — a rule lands at `warn`, violations are fixed in the same or next
session, then it is promoted; a rule only counts once it fails `pnpm run check`.
Rules below are grouped into phases in promotion order. Rationale and sources:
[frontend-comparison.md](frontend-comparison.md).

## Phase 1 — React correctness (highest leverage, do first)

New devDependencies: `eslint-plugin-react-hooks`, `eslint-plugin-react`,
`eslint-plugin-jsx-a11y`, `@tanstack/eslint-plugin-query`,
`eslint-plugin-react-compiler`.

Scope `apps/web/**/*.{ts,tsx}`:

| Rule | Level | Enforces |
|---|---|---|
| `react-hooks/rules-of-hooks` | error | hooks called unconditionally, top-level only |
| `react-hooks/exhaustive-deps` | error | complete dependency arrays; never disabled — fix with functional updater/reducer/`useEffectEvent` |
| `react-compiler/react-compiler` | error | Rules-of-React violations that block auto-memoization |
| `react/no-unstable-nested-components` | error | no component definitions inside render |
| `jsx-a11y` recommended preset | error | labels, roles, keyboard interaction |
| `@tanstack/query/exhaustive-deps` | error | query key contains everything `queryFn` reads |
| `@tanstack/query/no-rest-destructuring` | error | tracked-properties optimization preserved |
| `@tanstack/query/stable-query-client` | error | one QueryClient, stable identity |

Test infrastructure fixes (same phase, they gate everything after):

- `vitest.config.ts` `include` gains `**/*.test.tsx`; add jsdom environment +
  Testing Library for `apps/web`; MSW for query tests. Mocking `useQuery` or
  `core/client` internals is banned (review rule; revisit as lint if violated).
- Unit tests for `core/client/http.ts` via the injectable `fetchImpl`.
- Root error boundary in `apps/web/src/main.tsx` (render-time throws must not
  white-screen); its absence is caught by a smoke test, not lint.

## Phase 2 — inner boundaries (extend the existing boundaries setup)

Extend `boundaries/elements` with intra-web elements:

```
web-main      apps/web/src/main.tsx        composition root
web-api       apps/web/src/api.ts          bound actions wiring
web-routes    apps/web/src/routes/**       thin route components
web-features  apps/web/src/features/**     feature folders
web-ui        apps/web/src/components/ui/** design-system primitives
web-lib       apps/web/src/lib/**          pure TS utilities
web-theme     apps/web/src/theme*          visual language
```

`boundaries/element-types` additions (default `disallow` stays):

- `web-routes` → `web-features`, `web-ui`, `web-lib` (routes stay thin)
- `web-features` → `web-api`, `web-ui`, `web-lib`, `web-theme`,
  `core-client` (vocabulary only: `ApiError`, `skipToken`, types — creating
  clients is banned separately), `core-contract`, `core-domain` — **not**
  `adapter-auth`, **not** a broad `app-web` grant: features consume bound
  actions from `web-api` and never construct or hold `ApiClient`, ports or
  adapters (`createApiClient`/adapter factories importable only in `web-api`,
  `no-restricted-imports`)
- **Features are islands**: a feature may import only itself — capture the
  feature folder name (`boundaries/elements` capture group on
  `features/(<name>)/**`) and allow `web-features` → `web-features` solely
  when the captured names match; mirror in depcruise. Cross-feature needs go
  through server state (invalidation), the URL, or a route-level parent;
  shared code extracts downward (`components/ui`, `lib`, `core/client`),
  never sideways.
- `web-api` → `core-client`, `core-contract`, `core-domain`, `adapter-auth`
  (the only element besides `web-main` that may touch adapters)
- `web-ui` → `web-lib`, `web-theme` only — **never** `core-*`, features,
  routes, TanStack Query/Router (presentational purity)
- `web-lib` → nothing app-internal; **no `react` import**
  (`boundaries/external` ban, mirrors the `core/client` framework ban)
- `web-main` → everything web-side (composition-root exception, scoped to the
  one file)

Mirror the same rules in `.dependency-cruiser.cjs` (two independent enforcers,
as with the layer rules). Add `scripts/**` and `**/*.mjs` to depcruise scope so
tooling stops being a blind spot.

## Phase 3 — house rules (restricted syntax/imports; no plugin needed yet)

Scope `apps/web` unless noted:

| Convention | Mechanism | Level |
|---|---|---|
| No direct HTTP: `fetch`, `XMLHttpRequest`, `EventSource`, `WebSocket`, `axios` | `no-restricted-globals` + `no-restricted-imports` | error |
| No global state libraries: `redux`, `zustand`, `jotai`, `mobx`, `valtio`, `recoil` | `no-restricted-imports` | error |
| No inline query definitions: object literal with `queryKey` outside `core/client` | `no-restricted-syntax` selector on `Property[key.name="queryKey"]`, scoped to `apps/web` | error |
| No `React.FC`, no `forwardRef`, no `defaultProps`, no `<Context.Provider>` in new code | `no-restricted-syntax` | error |
| No raw color values outside `theme.ts`: hex/`rgb(`/`hsl(` string literals in `.tsx` | `no-restricted-syntax` regex on Literal value | **NOT WIRED** (planned) |
| No `localStorage`/`sessionStorage` outside designated persistence helpers | `no-restricted-globals` + override for the helper file | error |
| No `console` in `apps/web` (route errors through the error surface) | `no-console` (allow `warn`/`error` initially) | warn → error |
| Type-only imports explicit | `@typescript-eslint/consistent-type-imports` (all TS scopes) | error |
| Async safety: `no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check` | typescript-eslint type-aware (all TS scopes) | error |

Composition-root and adapter files get scoped overrides, never global
weakening (per the hardening guide: exceptions are path-scoped).

Server-state rules (from [server-state.md](server-state.md); same phase):

| Convention | Mechanism | Level |
|---|---|---|
| `new QueryClient(` only in `apps/web/src/query-client.ts` and test helpers | `no-restricted-syntax` + override | error |
| No importing the QueryClient singleton outside the composition root — use `useQueryClient()` | `no-restricted-imports` | error |
| No destructuring of `useQueryClient()` result / `QueryClient` methods (`this` binding) | `no-restricted-syntax` on VariableDeclarator with ObjectPattern init `useQueryClient()` | error |
| No explicit type arguments on `useQuery`/`useQueries`/`useMutation` (types flow from descriptors) | `no-restricted-syntax` on TSTypeParameterInstantiation | error |
| No `defaultOptions.queries.queryFn` (global queryFn bypasses the typed client) | `no-restricted-syntax` | error |
| No non-null assertion on query results/params; `skipToken` for optional-param gating | `@typescript-eslint/no-non-null-assertion` | error |
| `refetchType: 'all'`, blanket `refetchOnWindowFocus: false`/`retry: false` (outside test helpers), `staleTime: Infinity` | flagged for justification | **NOT WIRED** (planned) |
| No `jest.mock`/`vi.mock` of `@tanstack/react-query` or `core/client` | `no-restricted-syntax` in test scope | error |
| `@tanstack/react-query-devtools` importable only in `main.tsx` (and must be wired there, dev-only) | `no-restricted-imports` + override | error |
| No hand-rolled pending/error `useState` around a port/action call — server side effects use `useMutation` with an action descriptor | review (lint heuristic infeasible) | review |

## Phase 4 — custom plugin (`eslint-plugin-agentproofarch`)

Only for conventions the generic mechanisms above cannot express (t3code
pattern: house rules as a tiny local plugin).

Implemented: `event-suffix-taxonomy` — in an island's event module
(`features/<name>/core/events.ts`), every member of the exported event union
must end with an approved intent suffix
(`Requested|Confirmed|Cancelled|Changed|Selected|Opened|Closed|Added|Moved|Removed|Failed|Succeeded`),
so the view↔core seam carries intents (what happened) not commands (what to do)
— `deleteCard` cannot pass. It is machine-agnostic: it constrains event *names*,
never the store library behind the seam.

Also implemented:

- `query-descriptors-only` — `useQuery`/`useQueries`/`useMutation` arguments
  must originate from a **canonical** descriptor module: `#core/client`, the web
  `api.ts` binding site (bound `actions`), or an island core's `core/index.ts`
  seam (call expression or spread of an imported descriptor), never an object
  literal and never a look-alike descriptor from an arbitrary local/re-export
  module (allow-list, RuleTester-proven with local-module and re-export evasion
  fixtures). Complements — does not replace — the Phase-3 `queryKey` syntax
  selector: the selector additionally catches stray inline keys outside hook
  arguments (e.g. `invalidateQueries`), proven by probe.
- `sx-layout-only` — `sx` props may use spacing/layout/flex/grid keys; color,
  typography, background and border-styling keys are reserved for `theme.ts`.
  The rule opens an sx scope on both a literal `sx` prop **and** a nested `sx:`
  object property, so the MUI `slotProps={{ primary: { sx: … } }}` path is not a
  bypass (RuleTester fixture from `TodosPage`). A frozen baseline may only
  shrink; the demo keeps it at zero.

Resolved (no lint rule needed):

- `cqrs-partition` — **resolved at the type level, shipped in `core/client`**
  (`core/client/queries.ts`). `defineQuery` accepts only a read-tagged (GET)
  contract route and `defineMutation` only a write-tagged one: contract routes
  carry their HTTP method, `ApiClient` method types carry a read/write brand,
  and the define helpers accept only the matching brand — a violation is a
  compile error. The type-level mechanism was preferred over an AST rule, so
  this never became a custom lint rule.

Candidates, in order of value:

1. `tenant-scoped-ctx` — (server-side, listed for completeness) every use-case
   under `core/server` takes `ctx: { identity }` first; currently a PRD "lint
   or review" item with no rule.

Each custom rule ships with a **frozen legacy baseline** (t3code ratchet):
existing violation counts per file are tolerated, any new occurrence fails.
Baseline shrinks monotonically; CI fails if the baseline file is edited upward.
The ratchet is an adoption mechanism for real codebases taking these rules on —
**the demo itself keeps every baseline at zero**: it is the exemplar, it
carries no tolerated debt.

## Phase 5 — island-core rules (ADR-0005)

Enforcement for the island-core model
([architecture.md](architecture.md) §Client application state,
[ADR-0005](decisions/0005-client-application-state.md)). Every rule ships
with a config-regression probe, like every boundary rule before it. Five of
the six are wired — bus confinement is the only one still pending. Real island
cores now exist (the two `board`/`team-board` features), but the probes
(`config-regression/island-core.test.ts`) still synthesize violating fixtures
under a throwaway `features/<name>/core/` path and assert each rule fires, so
enforcement is proven on the exact shape a core takes, independent of the
committed cores. The Status column records what is wired versus still pending,
and why.

| Rule | Mechanism | Status |
|---|---|---|
| Event suffix taxonomy: island event-union members end in an approved intent suffix (the 12-suffix list under Phase 4; imperative names unwritable) | `agentproofarch/event-suffix-taxonomy` (custom plugin rule, RuleTester-tested); semantic half stays review + AI tier | **wired** — probe asserts `deleteCard` fails in a future `core/events.ts` |
| Core purity: no `react`, no `react-dom`, no `@tanstack/react-query` (nor the store React bindings `@xstate/store/react`/`@xstate/react`) in `features/*/core/**` (`@tanstack/query-core` and the vanilla `@xstate/store`/`xstate` stay allowed) | `no-restricted-imports` in the island-core override, mirroring the `core/**` framework ban, **plus** a depcruise mirror (`island-core-is-framework-agnostic`) now that real cores exist | **wired** — ESLint probes per banned import (incl. the `@xstate/store/react` binding); depcruise mirror probed in `gates.test.ts` |
| Persistence bans in islands: no store persist middleware, no `localStorage`/`sessionStorage` (mechanical proxy of "local state dies on reload") | `no-restricted-imports` (persist entrypoint) + the Phase-3 storage rule with **no** helper override on island paths | **wired** — probes for persist and `localStorage` |
| `queryClient.setQueryData` only inside the island's `optimistic.ts` | `no-restricted-syntax` + path-scoped override | **wired** — probes both ways (fires outside, silent inside `optimistic.ts`) |
| Store-library confinement: `@xstate/store` and `xstate` importable only in `features/*/core/**` — rescopes the Phase-3 blanket ban on state libraries (which stays for all other paths; `zustand`, a spike candidate only, returns to the blanket ban) | `no-restricted-imports` with path-scoped override | **wired** — the machine spike resolved (ADR-0005): `@xstate/store` is the rung-2 store, rung 3 is an XState machine derived from the `core/domain` transition table. The vanilla store/machine is importable in a core; their React bindings are banned everywhere (incl. cores). Probes assert `@xstate/store`/`xstate` fire outside a core and pass inside |
| Bus confinement: the typed-signal-bus module importable only from `features/*/core/**` (views never see the bus) | `no-restricted-imports` / boundaries element | planned — lands with the first bus event |

## Suppression policy (from the hardening guide, verbatim intent)

- `eslint-disable-next-line` only — file-level disables reserved for generated
  code.
- The exact rule must be named, plus a category and reason:
  `-- architectural-exception: composition root wires adapters`.
  Categories: `typescript-limitation | generated-code | third-party-api |
  architectural-exception | defensive-runtime-check`.
- Unused `eslint-disable` directives are themselves errors: the ESLint config
  sets `linterOptions.reportUnusedDisableDirectives: 'error'` (wired), so a
  disable that no longer suppresses anything fails `pnpm run check`. A
  `scripts/lint-suppressions.mjs` counter that gates the *total* suppression
  count (fails on any increase) is **planned, not yet built**.
- "Make lint pass" is never a standalone instruction to an agent; every new
  suppression must be explained in the PR.

## Review-only rules (not mechanically expressible — CLAUDE.md material)

- State placement: local until ≥2 consumers, then lift; reducer only when
  transitions matter more than values.
- Invalidation over manual cache writes for collections; `setQueryData`/
  optimistic-with-rollback for single resources only.
- `staleTime` chosen per resource, not globally disabled.
- URL state classes not conflated (path = identity, search = shareable filters,
  router state = transient).
- No reflexive `useMemo`/`useCallback`/`memo` — the compiler memoizes; hand
  memoization needs a justification.
- Behavior extracted to `*.logic.ts` when a component exceeds trivial logic;
  tests target the logic file.

These are candidates for a macroscope-style AI-review CI gate later (third
tier: lint → types → AI reviewer), once the deterministic tiers are green.

## Why ESLint, not oxlint

Oxlint's speed is real but irrelevant at this repo size, and it cannot carry
the enforcement spine: no type-aware rules (`no-floating-promises`,
`switch-exhaustiveness-check`, `no-unsafe-*` — t3code compensates with
Effect's language-service diagnostics, a luxury specific to their stack) and
no `eslint-plugin-boundaries`/`@tanstack/query`/`react-compiler` ecosystem
(t3code's unenforced package boundaries are partly this gap's cost). Revisit
when: type-aware oxlint matures, a boundaries equivalent exists, or lint time
exceeds ~30s. A dual-linter pre-pass is possible then; two configs to keep
honest is not worth it now.

## Order of work

1. Phase 1 plugins + vitest/jsdom fix + error boundary (one session).
2. Phase 2 inner boundaries + depcruise mirror + proof test (a temporary
   violating file must fail `pnpm run check`, then is removed — same as the
   original layer-boundary proof).
3. Phase 3 restricted rules, promoted per the ratchet.
4. Phase 4 plugin only after Phases 1–3 are at `error` and stable.
5. Phase 5 island-core rules: suffix taxonomy, core purity (ESLint + depcruise
   mirror, React store bindings included), persistence bans, `setQueryData`
   confinement and store-library confinement (`@xstate/store` + `xstate` only
   in island cores) are all wired (probes exercise the core path); only bus
   confinement stays pending, landing with the first bus event.
