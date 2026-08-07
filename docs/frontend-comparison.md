# Frontend architecture — comparison and conclusions

Compares the agentproofarch frontend (as decided in the PRD, `architecture.md`
and the founding design session) against three references, to close the gap the
foundation left open: the *inside* of `apps/web` is neither described nor
machine-enforced.

Sources analyzed (July 2026):

1. **t3code** (`pingdotgg/t3code`) — Theo's agent-manager monorepo; web +
   desktop + mobile clients over an Effect-based server, with a custom oxlint
   plugin and heavy agent tooling.
2. **react-archive** — synthesis of a well-known pre-AI frontend course
   (React, React+TS, TanStack Query, React Router) plus its 2026 modernization
   audit.
3. **ai-handbook** + **eslint-hardening-guide** — a year of collected practice
   for agent-driven development, and the warn→fix→error hardening method.

## 1. What t3code actually is (and is not)

t3code converges with agentproofarch on the load-bearing idea: **a zero-dependency
contracts package is the only bridge between server and clients**
(`packages/contracts` ≈ `core/contract`), and clients share one runtime layer
(`packages/client-runtime` ≈ `core/client`). Typed pushes/queries derived from
contracts are the UI's only view of the server. This is independent confirmation
that the contract-sink design is the right spine for agent-driven codebases.

The surprise is *where* each repo puts its machine enforcement:

| | t3code | agentproofarch |
|---|---|---|
| Layer boundaries | **Convention** (package.json deps only; no boundary linter) | **Lint-enforced** (eslint-plugin-boundaries + dependency-cruiser) |
| Micro-idioms (imports, runtime style, schema hygiene) | **Lint/typecheck-enforced** (custom oxlint plugin + @effect/language-service diagnostics at error) | Mostly unenforced |
| React hooks correctness | `react-hooks/exhaustive-deps` **disabled** | react-hooks plugin **absent** |
| Type-aware linting | Disabled (`typeAware: false`); pushed into typecheck via language-service plugin | Enabled via typescript-eslint strict |
| Non-lintable conventions | **AI reviewer as CI gate** (`.macroscope`, opus-4.8, `conclusion: failure`) | Human review |

So t3code is *not* uniformly state of the art: its inter-package layering relies
on discipline, and it turns off the single most important React safety rule
(their Effect-atom style fights `exhaustive-deps`). agentproofarch is already
ahead on boundaries. What t3code does better, and what we adopt:

- **A custom lint plugin as the house-rules carrier** (`oxlint-plugin-t3code`):
  four small AST rules encode conventions no preset covers (canonical node
  imports, platform access behind an injected port, no manual Effect runtimes in
  tests, hoisted schema compilation). Conventions that matter get a rule, not a
  doc sentence.
- **The legacy-baseline ratchet**: one rule ships with a frozen map of existing
  violation counts per file — existing debt tolerated, any *new* occurrence
  fails. This makes strict rules adoptable at any time, which is exactly the
  warn→fix→error method from the eslint-hardening-guide, mechanized.
- **`*.logic.ts` co-location**: pure, framework-free logic extracted next to the
  component that uses it, unit-tested without rendering. Containers compose
  hooks; logic files compute. Ideal for agents: behavior changes without JSX
  churn, and tests that don't need a DOM.
- **A layered error surface**: root route error view → normalized query result
  shape (`data/error/isPending/refresh`) → inline dismissible banners → toasts
  with expandable details → slow-request visibility. Errors are a designed
  subsystem, not per-page improvisation.
- **No-barrel discipline enforced twice**: package `exports` expose only
  explicit subpaths *and* `no-restricted-imports` bans the package root.
- **Docs that link to source**: `docs/architecture/overview.md` cross-links the
  real files, giving agents a navigable map; `CLAUDE.md` is a symlink to
  `AGENTS.md` (one instruction file for every agent).
- **A third enforcement tier**: deterministic lint → type system → **AI reviewer
  with `conclusion: failure`** for conventions that are real but not
  AST-expressible (service shape, naming). Worth adopting later for our
  query/mutation conventions.

What we deliberately do **not** adopt: Effect on the frontend (agentproofarch
chose TanStack Query + plain React deliberately — simpler for agents),
disabling `exhaustive-deps`, formatter-only pre-commit, and convention-only
layering.

## 2. What the course archive contributes

The 2026 audit's verdict: the mental models hold, the surface APIs moved. The
durable, *enforceable* core for our stack:

- **Render is pure; effects synchronize with external systems only; never lie
  to the dependency array.** Gate: `react-hooks` rules + React Compiler ESLint
  plugin (which also obsoletes hand-written `memo`/`useMemo`/`useCallback` in
  new code).
- **Server state and client state are different species.** Server state lives in
  TanStack Query exclusively (never fetch-in-`useEffect`); client state stays
  local until proven shared.
- **The query key is the resource identity**: hierarchical keys, everything
  `queryFn` reads is in the key, prefer invalidation over manual cache writes
  for collections. Gate: `@tanstack/eslint-plugin-query` (`exhaustive-deps`,
  `no-rest-destructuring`).
- **`fetch` doesn't throw on 4xx/5xx — the client layer must** (our
  `unwrap()`/`ApiError` already does this; the rule is that components never
  see a raw response).
- **URL is state in three non-conflated classes**: path params = resource
  identity, search params = shareable filters, router `state` = transient only.
- **React 19 surface**: `ref` as a prop (no `forwardRef`), `<Context>` not
  `<Context.Provider>`, no `React.FC`, no `defaultProps`; type vocabulary from
  React itself (`ComponentPropsWithoutRef`, `ReactNode`,
  `Dispatch<SetStateAction<T>>`).
- **Test behavior, not hooks**: real component + real provider + MSW; mocking
  `useQuery` is banned.

## 3. What the handbook and hardening guide contribute

The handbook's relevant thesis: *conventions guide, but only CI/lint/type gates
enforce* — an agent must physically fail the build when it violates
architecture. Frontend-specific consequences it demands and we encode:

- Import boundaries **inside** the app, not just between layers (UI primitives
  must not reach into data fetching; state code must not call transport).
- A **suppression policy**: line-level, rule-named, categorized reason
  (`typescript-limitation | generated-code | third-party-api |
  architectural-exception | defensive-runtime-check`), unused-disable reporting
  on, "make lint pass" is never a valid instruction on its own.
- The **warn→fix→error ratchet** as the adoption method for every new rule.
- Review-beyond-diff, bundle/perf budgets, a11y as a gate, no hook mocks —
  encoded where lintable, listed as review rules where not.

## 4. Gap analysis of the current frontend

From the founding-session transcript and the demo audit:

**Decided and enforced** (keep): SPA no SSR; thin client over `core/client`;
TanStack Router + Query; direct server imports banned; `core/client` framework
free; no `any`/`as`; strict tsconfig.

**Decided but not enforced**: "no direct `fetch` in apps/web" (PRD FR-level
statement, no lint rule exists); "query descriptors only in
`core/client/queries.ts`" (followed, unlinted); MUI-stock-plus-`sx`-layout-only
styling with all visual language in `theme.ts` (followed, unlinted).

**Undecided / never discussed** (now decided in `architecture.md` §Frontend):
client-state policy, invalidation conventions, folder structure inside
`apps/web`, error boundaries, forms, a11y, component testing strategy, bundle
budgets.

**Concrete defects found in the demo gate**:

- No `eslint-plugin-react-hooks`, no `eslint-plugin-react`, no `jsx-a11y` — the
  single biggest missing safety net given hand-maintained dependency arrays.
- Vitest `include` matches `*.test.ts` only — a `.tsx` component test would be
  silently ignored; no jsdom/RTL environment configured; zero frontend tests
  exist (including for `core/client/http.ts`, the most logic-dense client code).
- No root error boundary; a render-time throw is uncaught.
- `scripts/**` and `**/*.mjs` (the visual-diff tooling) are outside both ESLint
  and dependency-cruiser scope.

## 5. Conclusions

1. **The architecture's spine needs no change.** Both t3code and the course
   independently validate contract-sink + framework-free client core + typed
   descriptors. The gap is one level down: inside `apps/web`.
2. **Enforce the inner frontend architecture the same way as the layers** —
   with boundaries and lint, not convention. New normative section:
   `architecture.md` §Frontend. New enforcement plan:
   [frontend-lint-plan.md](frontend-lint-plan.md).
3. **Adopt t3code's carrier patterns, not its stack**: custom rules for house
   conventions, baseline ratchet for adoption, `*.logic.ts` extraction, layered
   error surface, docs-link-to-source.
4. **Close the demo defects first** (react-hooks/a11y/query plugins, vitest
   `.tsx` + jsdom, root error boundary) — they are cheap and highest-leverage.
5. **Later, optional third tier**: an AI-reviewer CI gate (macroscope-style)
   for the conventions the lint spec marks as review-only.
