# core/ — rules for agents

The full doctrine lives in [`../CLAUDE.md`](../CLAUDE.md) and
[`../../docs/architecture.md`](../../docs/architecture.md#layers) (§Layers is
normative). This file is the one-screen distillation for anyone editing `core/`.

## What this layer is

Pure TypeScript: the domain model, use-cases, the wire contract, and the HTTP
client. No infrastructure, no framework, no I/O. It is the stable centre every
adapter and app is written against.

## What it may import

- `core/domain` → **zod only** (nothing else, not even other core layers).
- `core/server` → `core/domain` + `core/contract` + its own ports. Use-cases +
  port interfaces.
- `core/contract` → `core/domain` only. The single bridge between server and
  clients.
- `core/client` → `core/contract` only. The only place any client talks HTTP.
- Never `hono`, `react`, `drizzle`, `better-auth`, `pg`, `commander`,
  `@vercel/*`, `@neondatabase/*`. Never anything from `adapters/` or `apps/`.

## What may import it

- `adapters/**` implement `core/server` ports.
- `apps/web` and `apps/cli` import `core/client` + `core/contract` only.
- `apps/server` composition wires use-cases to adapters.

## Hard rules

- No `any`. No `as` (except `as const`). Parse with zod at every boundary.
- Use-cases return `Result<T, AppError>`; they never catch infra rejections.
  New error kinds → `ERROR_CODES` in `core/domain/errors.ts` **and** an HTTP
  status + exit code in `core/contract/http-status.ts` (exhaustive).
- Every tenant-scoped use-case authorizes FIRST — its opening statement is the
  capability predicate (`authorize`/`authorizeTenant`, default-deny; see
  [architecture §Authorization](../../docs/architecture.md#authorization)) —
  before any repository access. A self-scoped read carrying no capability
  (e.g. `listMyTenants`) is the only allowlisted exception.
- Every tenant-scoped use-case takes `ctx: { identity }` first.

## Verify you didn't break this layer

```bash
pnpm run depcruise
```
