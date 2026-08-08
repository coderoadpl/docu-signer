# ADR-0011: The layout layer — page skeletons as a named, enforced structural element

Date: 2026-07-27 · Status: accepted (owner-approved) · Builds on
[ADR-0005](0005-client-application-state.md) (features are islands; the view↔core
seam), [ADR-0004](0004-no-exceptions-enforcement.md) (a promise in prose maps to
an enforcer) and [ADR-0008](0008-visual-regression.md) (the Playwright visual
harness this decision reuses rather than duplicates).

## Context

**A stateful page shell has no legal home in this architecture today.** The
frontend structure diagram in
[architecture.md §Frontend](../architecture.md#frontend-appsweb) names
`main.tsx`, `api.ts`, `routes/`, `features/<name>/`, `components/ui/`, `lib/` and
`theme.ts` — there is no category for "the skeleton of a page". The one place the
word *layout* appears normatively is the route-tree paragraph, which describes
the shell as "`AppLayout`, a feature under `features/settings/`" — the document
does not merely tolerate the current placement, it **sanctions** it.

The placement is wrong in three ways, and only one of them is aesthetic:

1. **It is not a settings concern.** `apps/web/src/features/settings/AppLayout.tsx`
   is the chrome of the *whole* authenticated app — the auth guard, the tenant
   switcher, logout, the primary navigation to ledger/board/team-board/members/
   settings, and the `Outlet`. It lives in a domain slice because there was
   nowhere else to put it.
2. **Nothing else may legally import it, and it has no legal neighbours.**
   Features are islands (`web-features-are-islands`), so no other feature can
   consume the shell; it survives the gate only because its single importer is
   `main.tsx`, which is not a feature. The obvious alternative home is closed
   too: `web-ui-is-presentational` bans TanStack from `components/ui/`, and the
   shell runs `useQuery`/`useMutation` for its guard and its switcher. **A
   stateful page skeleton is unrepresentable in the current structure** — not
   discouraged, unrepresentable.
3. **The symptom is already in the code.** The shell hand-repeats
   `<Container sx={{ maxWidth: '44rem' }}>` on two of its non-happy branches, and
   `Onboarding` hand-rolls a centred-card skeleton — a `Box` with
   `display: grid; placeItems: center` wrapping a `Paper` pinned to `26rem`. Two
   page skeletons written inline, in one file, because the architecture offers no
   place to name them once.

**The evidence that the fix generalises comes from a second app on this
architecture.** That app completed a full layout migration and runs it under
enforcement, not convention: a `components/layout/` directory of page skeletons;
a dependency-cruiser rule keeping that directory free of feature data, api and
i18n ("theme atoms in, feature data out"); the visual-key `sx` rule with a
per-file, shrink-only baseline; and committed visual baselines per skeleton and
per state. The load-bearing result is that its layout survived **seven themes**
unchanged — because the skeletons hold structure only (grid, flex, widths,
spacing) and take every colour, font and border from styled atoms exported by
`theme.ts`. That is the property worth graduating, and the mechanism that
produces it is a *category plus rules*, not a component library.

Half of that mechanism is already here. `agentproofarch/sx-layout-only` was
graduated earlier — it reserves colour, typography, background and
border-styling keys for `theme.ts`, with a per-file baseline that may only shrink
and a stale-baseline error so it cannot rot; it is named in
[architecture.md §Foundation evolution](../architecture.md#foundation-evolution-consuming-the-foundation)
as part of the portable artifact. What is missing is the **layer the rule was
written to protect**.

**Honest note about the source of the evidence.** That app's own task document
claims a "structural tier" and a `no-restricted-imports` ban on skeleton MUI
components (`Container`/`AppBar`/`Drawer`/`Toolbar`) scoped to its layout
directory. Neither exists in its configuration — its `sx` rule classifies visual
keys only, and no such import ban is wired. Three of the four mechanisms shipped
(the visual `sx` tier, the dependency rule, the screenshot harness); the
structural tier is a design, not code, and has never run against a real codebase
anywhere. That fact is the reason for the split status in Decision 6 below.

## Decision

1. **`components/layout/` becomes a named structural element of `apps/web`**, on
   the same footing as `components/ui/` and `lib/`: *page skeletons — structure
   only*. It is the one legal home for a component that owns a page's shape: the
   grid, the widths, the sticky rails, the header/content/footer regions, the
   `Outlet` slot. Three properties define it, and they travel together:
   - **Structure only.** Grid, flex, spacing, sizing and position live here; every
     colour, font, background and border comes from `theme.ts` atoms. This is what
     makes a skeleton theme-proof.
   - **Content arrives through slots.** Callers pass `ReactNode` (`header`,
     `action`, `rail`, `children`); a skeleton never fetches, never knows a
     domain type, never reads a route param.
   - **Non-happy branches render *inside* the skeleton.** Loading, error, empty
     and not-found are states of the page, not replacements for it, so the layout
     never jumps width between a pending render and a loaded one — precisely the
     defect visible in today's shell.

2. **Rule (a) — layouts are structure only (import direction).** `components/layout/**`
   may import `theme.ts`, `components/ui/` and `lib/` and nothing else inside the
   app: no `core/**`, no `adapters/**`, no `features/**`, no `routes/**`, no
   `api.ts`, and no TanStack. The enforcer is a new dependency-cruiser rule,
   `web-layouts-are-structure-only`, modelled on the existing
   `web-ui-is-presentational` edge and on the equivalent rule proven in the app
   above. It lands with the enforcer phase of this change (rule + boundaries
   entry + a `config-regression/` probe that a violating fixture turns `check`
   red), per the repo convention that every rule is itself enforced.

3. **Rule (b) — features consume layouts, they do not define them.** A page
   skeleton — a component that owns a `Container`/max-width/page grid — may be
   defined only under `components/layout/`. **This half is honestly weaker than
   rule (a) and is documented as such**: it is a claim about the *content* of a
   file, not about an edge in the dependency graph, so dependency-cruiser cannot
   close it. Until the structural tier of Decision 6 triggers, its mechanical tier
   is `n/a` and it is enforced at REVIEW+AI. Naming that gap is the point; a
   matrix that claimed LINT here would be false.

4. **The shell is split, not relabelled.** The chrome skeleton — app bar, nav
   slots, width tokens, `Outlet` slot — moves to `components/layout/AppShell.tsx`
   and holds no server state, so it passes rule (a) by construction. The data
   half — the `actions.me` guard, the tenant switcher, the no-tenant onboarding
   branch — stays a thin composition component beside `main.tsx` (or a feature)
   that *renders* `AppShell`. This mirrors the split proven upstream, where the
   stateful panel layout stayed a feature and the panel skeleton became a
   primitive. **Rejected alternative:** declaring the shell a sanctioned
   composition exception, in the style of `api.ts`. It is cheaper today and
   freezes the actual defect — the *next* page skeleton would still have nowhere
   to go, and the architecture would keep answering "put it in a feature".

5. **Every layout skeleton carries a visual spec on the ADR-0008 harness.** The
   practice that graduates is "each skeleton has screenshots of its states" —
   realised as specs in the existing `demo/visual/` suite, on the existing
   Playwright harness with CI-rendered, platform-scoped baselines. No second
   screenshot engine and no second baseline store: lint catches scattered `sx`,
   pixels catch rendered drift, and one gate owns the pixels. The visual check
   remains non-required until the owner arms it, exactly as ADR-0008 left it.

6. **The structural `sx` tier is NORMATIVE WHEN TRIGGERED.** The second half of
   the `sx` classifier — reserving *structural* keys (`display`, `grid*`, `flex*`
   on containers, `position: sticky|fixed`, `width`/`maxWidth`) for
   `components/layout/**` and `theme.ts`, as a second option on the existing
   `agentproofarch/sx-layout-only` rule with its own per-file, shrink-only,
   stale-erroring baseline — is designed but deliberately not switched on.
   **Trigger: the first case of a duplicated page skeleton outside
   `components/layout/` in an app on the foundation.** It is WHEN TRIGGERED and
   not NOW for the reason recorded in the Context: the structural tier is
   paper-only even in the app that designed it, so it has no field validation
   anywhere. Turning it on here would mean shipping an unproven mechanism as a
   mandatory gate; the first app to hit the trigger is also the first honest test
   of it. Decision 3's mechanical half closes at that moment, and not before.

7. **Explicitly rejected, with reasons.**

   | Rejected | Why |
   |---|---|
   | The upstream **seven-primitive catalog** (`FocusCard`, `MemberPage`, `PanelPage`, `ListSection`, `SectionCard`, `StatusView`, `ConfirmDialog`) and its width-token set | It is the codified result of a 44-screen inventory of *one product* and six product decisions (bottom tab bar, list-first, ledger widths). The foundation graduates the **category and the rules**; the catalog is an app's own output. `demo/` stays exemplary — "a change that would not generalise to every app on the foundation does not belong in it" — so it gets `AppShell` plus one status skeleton, not seven primitives. |
   | The **Storybook + Lost Pixel** stack | ADR-0008 already decided this repo's visual mechanism deliberately: Playwright against the real stack, deterministic, baselines rendered in CI. A second screenshot engine would duplicate it and break the single-source-of-baselines rule. |
   | The **second golden-image harness** (pixelmatch goldens + a diff script) | Same reason: ADR-0008 covers it. |
   | **MUI skeleton-import bans** (`no-restricted-imports` on `Container`/`AppBar`/`Drawer`/`Toolbar` scoped to the layout directory) **as a mandatory rule** | It is MUI-specific, and — as recorded above — it exists only on paper even upstream. It is noted in architecture.md as an **optional** closing technique for apps that render on MUI, never as part of the portable artifact. |
   | The **seven-theme showcase** | The number and identity of themes is product. What graduates is the principle it demonstrated: a skeleton that consumes theme atoms survives any theme. |

## Consequences

- **The frontend structure diagram gains a row**, and the route-tree paragraph
  stops describing the shell as a feature under `features/settings/`. Both rules
  ship with the mandatory TYPE/LINT/TEST/REVIEW+AI matrix; rule (b)'s matrix
  records REVIEW+AI as its only mechanical answer until the Decision 6 trigger
  fires.
- **`web-layouts-are-structure-only` joins the portable-artifact list** in
  §Foundation evolution alongside `web-features-are-islands`. The rule itself,
  its boundaries entry and its config-regression probe land in the enforcer phase
  of this change; doc-lint's promised-enforcer manifest gains the entry in that
  same phase, so the docs and the configuration cross the finish line together.
- **One non-trivial code move**: splitting `AppLayout` into `AppShell` plus a thin
  stateful composition. Every other consequence is documentation or a new file.
- **The two hand-rolled skeletons become one named one each.** The repeated
  `maxWidth: '44rem'` branches collapse into the shell's own state rendering, and
  the onboarding centred card becomes a layout skeleton rather than an inline
  `Box`/`Paper` pair.
- **A residual stays open and named**: nothing mechanical stops a feature from
  growing a page skeleton in place until the structural tier triggers. That is a
  REVIEW+AI-tier rule, documented as such rather than presented as guaranteed —
  the same honesty the enforcement-tier table demands everywhere else.
