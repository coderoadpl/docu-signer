# apps/ — rules for agents

The full doctrine lives in [`../CLAUDE.md`](../CLAUDE.md) and
[`../docs/architecture.md`](../docs/architecture.md#layers) (§Layers and
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
  `cliCtx`). The CLI may also import the read-only PDF seal verification
  adapter for `document verify-seal`. **Never** `core/server`, **never**
  `adapters/db`.
- `@vercel/*` / `@neondatabase/*` only via `adapters/` and `api/index.ts`.

## What may import it

- Nothing. `apps/` is the top of the graph; `adapters/` and `core/` never
  import it (`adapters-never-import-apps`).

## Hard rules

- Routes are thin: parse the request against the contract, call one use-case,
  map the `Result` to a response. No business rules in a route or a component.
- Web features remain isolated by the feature-boundary lint rules; this fork
  currently ships no island cores. The client is constructed only in
  `web/src/api.ts` (see [architecture §Frontend](../docs/architecture.md#frontend-appsweb)).
- Adding a resource is manual and walks the 12-step chain: domain → contract
  → port → use-case index → adapter schema → composition → server routes →
  client → client queries → CLI → web binding → web route, in that order.
  Finish every step: a missing CLI command, web route, or server route can still
  typecheck.
- Verify features through the CLI first (`pnpm --silent run cli --json …`).

## Verify you didn't break this layer

```bash
pnpm run depcruise
```
