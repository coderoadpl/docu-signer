# apps/ — rules for agents

The full doctrine lives in [`../CLAUDE.md`](../CLAUDE.md) and
[`../../docs/architecture.md`](../../docs/architecture.md#layers) (§Layers and
§Frontend are normative). This file is the one-screen distillation for anyone
editing `apps/`.

## What this layer is

The deliverable edges: `server/` (Hono composition + routes), `web/` (the SPA),
`cli/` (the command-line client). Composition and delivery only — no domain
logic lives here.

## What it may import

- `apps/server` → `core/server` use-cases, `core/contract`, and `adapters/**`;
  it is the composition root that wires them together.
- `apps/web` and `apps/cli` → `core/client` + `core/contract` only, plus the
  auth *client* adapter (constructed in `apps/web/src/api.ts` / the CLI
  `cliCtx`). **Never** `core/server`, **never** `adapters/db`.
- `@vercel/*` / `@neondatabase/*` only via `adapters/` and `api/index.ts`.

## What may import it

- Nothing. `apps/` is the top of the graph; `adapters/` and `core/` never
  import it (`adapters-never-import-apps`).

## Hard rules

- Routes are thin: parse the request against the contract, call one use-case,
  map the `Result` to a response. No business rules in a route or a component.
- Web features are islands — a feature's `core/` is pure TS (events in,
  selectors out); UI is presentational; the client is constructed only in
  `web/src/api.ts` (see [architecture §Frontend](../../docs/architecture.md#frontend-appsweb)).
- Adding a resource walks the 12-step chain; start with
  `pnpm run new:resource -- <singular-name>` and finish every checklist item
  (missing CLI command / web route / server route still typecheck — the
  checklist, not the compiler, guarantees they are wired).
- Verify features through the CLI first (`pnpm --silent run cli --json …`).

## Verify you didn't break this layer

```bash
pnpm run depcruise
```
