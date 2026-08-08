# Your first feature in 30 minutes

A concrete walkthrough of adding a real resource to the foundation. We'll add a
`note` — a tenant-scoped list of titled notes, exactly parallel to the demo's
`todo` — and take it from an empty folder to `check` + `smoke` green and a PR.
The point isn't the notes; it's the *loop*: the scaffolder plants generated
files, the type checker turns red, and every red error is the next wiring step.

Run everything from `demo/`. If you haven't yet: `pnpm install --frozen-lockfile && pnpm run db:up &&
pnpm run db:migrate && pnpm run db:seed` (and read [demo/CLAUDE.md](../demo/CLAUDE.md)
for the layer rules — they're enforced, but knowing them makes this faster).

## 1. Scaffold

```bash
pnpm run new:resource -- note
```

The scaffolder writes only the files a resource **owns outright** — never the
shared files, because generated edits to shared files rot. It writes:

```
+ core/domain/note.ts                          the entity + zod schemas
+ core/server/usecases/notes.ts                listNotes / addNote use-cases
+ core/server/usecases/notes.test.ts           their test skeleton (TODOs)
+ adapters/db/notes-repository.ts              the Drizzle repository
+ apps/web/src/features/notes/NotesPage.tsx    the page component
+ apps/web/src/routes/notes.tsx                the route module
```

Then it prints an ordered checklist for the shared files you wire by hand. It
deliberately does **not** touch them: the generated code imports symbols that
don't exist yet, so `pnpm run check` stays RED through the type-forced steps
(domain, contract, port/use-case, client wiring). Three steps are **not**
type-forced — a missing CLI command, an unregistered web route, and a
hand-registered server route (routes are wired by hand against `API_PATHS`, with
no parity check) all typecheck fine — so for those the checklist, not the
compiler, is what tells you you're done.

**Why a ~400-line script and not Plop** (or any generator framework): a
framework would add a dependency and its own template syntax for something
`demo/scripts/new-resource.ts` does under full repo control with zero new
dependencies — templates are plain text files (`scripts/templates/*.tpl`)
read at runtime, and the scaffolder's self-test renders every template and
parses each output with the TypeScript compiler, so template rot is a failing
test rather than a runtime surprise. It is also repo-rule-aware in a way no
generic generator is: it *knows* `check` must stay red through the type-forced
steps of the checklist, and its name validation rejects collisions and reserved
names.

**Separability is an explicit boundary**: the *scaffolders*
(`new-resource.ts`, `new-island.ts`) import nothing from `core/` or `apps/` —
node builtins and their own templates only; the coupling to the repo is
conventions (paths, anchors), not code. (Not every file under `scripts/` is
core-free — the smoke harness `smoke-cli.ts` imports the `EXIT_CODE_BY_ERROR_CODE`
table from `#core/contract`, deliberately, so it asserts the *same* exit-code
mapping the CLI ships; that is a test reusing the contract, not the scaffolder
coupling to it.) Extracting a scaffolder into a versioned package later — the
same trigger as the enforcement configs (a real second app, see
architecture.md §Foundation evolution) — is therefore mechanical.

(The scaffolder has a client-state sibling, `pnpm run new:island -- <name>`,
which plants a feature's island core — the events-in / selectors-out seam of
[ADR-0005](decisions/0005-client-application-state.md). Notes are pure server
state, so this walkthrough never needs it.)

## 2. Read the checklist (excerpt)

The full checklist walks the 12-step chain — domain → contract → port →
use-case index → adapter schema → composition → server routes → client →
client queries → CLI → web binding → web route. Each step gives you the file,
the **anchor line** to find, and a paste-ready snippet. A representative slice:

```
1. DOMAIN — core/domain/index.ts
   anchor:  export * from './todo.js';
   add:     export * from './note.js';

2. CONTRACT — core/contract/routes.ts
   2c. anchor:  todosCreate: { method: 'POST', path: '/api/todos' },
       add:     notes:       { method: 'GET',  path: '/api/notes' },
                notesCreate: { method: 'POST', path: '/api/notes' },
   ...

5. ADAPTER SCHEMA — adapters/db/app-schema.ts
   anchor:  export const todos = pgTable(
   add a sibling table:
     export const notes = pgTable('notes', { ... });
   Then generate + apply the migration:
     pnpm run db:generate && pnpm run db:migrate
```

Work top to bottom. You don't have to memorize the chain — the checklist and
the failing typecheck lead you through it.

## 3. Let the red check drive you

This is the core rhythm. After scaffolding, run the gate and read the first
error:

```bash
pnpm run check
```

It fails — the generated `core/domain/note.ts` is exported from nowhere, so
`core/contract` can't find `noteSchema`. Do checklist step 1 (add the
`export * from './note.js'` line), run `check` again, read the *next* error.
Each error is a signpost: a missing schema export points at the contract step,
an unknown `NoteRepository` type points at the port step, an unresolved
`api.listNotes` points at the client step. You're never guessing what's left —
the compiler is holding the checklist for you.

Two steps genuinely need thought, not just pasting:

- **Schema design (step 5).** The template gives you a `title`-only table that
  mirrors `todos`. A real note probably wants a `body`, maybe a `pinned` flag.
  Edit `core/domain/note.ts` (the zod schema is the source of truth), the
  contract schemas, and the `pgTable` columns to match — keep the three in
  sync, because the boundary between them is parsed with zod at runtime.
- **Migration (step 5, second half).** After you've settled the columns:

  ```bash
  pnpm run db:generate     # drizzle-kit diffs the schema → a new SQL migration
  pnpm run db:migrate      # applies it to your dev database
  ```

  `db:generate` writes a migration file from the schema diff; commit it. Never
  hand-edit an applied migration — add a new one (staging/prod migrations are
  forward-only, expand → contract).

## 4. Tests at the core, first

Before you wire the UI, fill in the generated `notes.test.ts`. The use-case
layer is where behavior lives — tenant scoping, validation, the `Result<T,
AppError>` returns — and it's pure, so tests are fast and need no server or
database. Replace the `TODO` cases with the real ones:

```bash
pnpm exec vitest run core/server/usecases/notes.test.ts
```

Cover the happy path (`addNote` returns `ok`, `listNotes` returns only the
active tenant's rows) and at least one failure (empty title → `validation`).
Getting these green before the UI means the hard part — the domain logic — is
verified independently of React and Hono.

## 5. Verify through the CLI

Once the chain compiles (`pnpm run check` green), the CLI is the fastest way to
see the feature actually work end-to-end. Boot the server and drive it:

```bash
pnpm run dev:server &
pnpm --silent run cli login --email demo@agentproofarch.dev --password demo1234
pnpm --silent run cli --tenant acme note add Buy milk
pnpm --silent run cli --tenant acme note list --json
```

`--json` prints one envelope; the exit code comes from the error taxonomy. This
is the same loop `smoke` automates and the same loop an agent uses — if the CLI
round-trips your note, every layer from contract to repository is wired
correctly.

## 6. The web page

The scaffolder already generated `NotesPage.tsx` and its route; steps 11–12
bind them to the query client and register the route. Then:

```bash
pnpm run dev:web              # Vite + hot reload on 47180
```

Open the app, sign in, navigate to `/notes`, and add one through the UI. For
frontend work always use `dev:web` — `dev:server` serves a gitignored built
bundle that goes stale after a contract change.

## 7. Green, then a PR

Both gates, plus the browser gate since you touched `apps/web`:

```bash
pnpm run check                # static: typecheck + lint + lock-lint + depcruise + doc-lint + coverage
pnpm run smoke                # runtime: real server + CLI flow, ~5s
pnpm run e2e                  # browser: Playwright over the real stack
```

When all three are green, open a PR. The
[template](../.github/pull_request_template.md) is the same checklist made
explicit — `check` green, `smoke` green, `e2e` green for a web change,
architecture docs updated first if you changed a boundary, new deps via
`pnpm add`, work done in a worktree. CI re-runs `check`, `smoke`
and `e2e` on a clean checkout, and `post-deploy-smoke` verifies the deployed
result against real production. Static-green is not done — but now you've proven
it runs.

## Where to go next

- [demo/README.md](../demo/README.md) — the full skeleton tour and CLI reference.
- [demo/CLAUDE.md](../demo/CLAUDE.md) — the enforced layer rules, in full.
- [docs/architecture.md](architecture.md) — why the seams are where they are.
- [ADR-0004](decisions/0004-no-exceptions-enforcement.md) — how the gates can't
  be bypassed.
