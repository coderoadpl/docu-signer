# adapters/ — rules for agents

The full doctrine lives in [`../CLAUDE.md`](../CLAUDE.md) and
[`../docs/architecture.md`](../docs/architecture.md#layers) (§Layers is
normative). This file is the one-screen distillation for anyone editing
`adapters/`.

## What this layer is

Concrete implementations of `core/server` ports: the database repositories
(`db/`), auth provider (`auth/`), email transport (`email/`), document storage
(`storage/`), PDF sealing (`pdf-seal/`) and warning logging (`logging/`). This
is the only place framework and vendor SDKs live.

## What it may import

- `core/domain`, `core/server` ports, `core/contract` — the interfaces it
  implements.
- Infrastructure libraries: `drizzle`, `pg`, `better-auth`, `@vercel/*`,
  `@neondatabase/*` (these vendors are permitted **only** here and in the
  platform entry `api/index.ts`).
- Never `apps/**`. Never `core/client`.
- Repositories must not use `db.transaction` — production runs the
  `neon-http` driver, which has no transaction support (a transactional
  repository 500s only in production; incident 2026-08-07, pad sessions).
  Enforce multi-statement invariants with constraints/unique indexes.

## What may import it

- `apps/server/src/composition.ts` — the only place a *server* adapter is
  instantiated. Two sanctioned exceptions: the auth *client* adapter is
  constructed in `apps/web/src/api.ts` and the CLI's `cliCtx`; the CLI's
  read-only `document verify-seal` command constructs the PDF verification
  adapter; and
  `adapters/db/migrate.ts`, `adapters/db/seed.ts`,
  `adapters/db/seed-deploy.ts`, and `scripts/backup.ts` are sanctioned
  standalone composition points outside the server root. Backup runs in CI cron
  without the server. Seed needs the real auth and database adapters to hash
  credentials and persist bootstrap data, just as migrate needs the real database
  adapter.
- `apps/web` and `apps/cli` never import server adapters or `adapters/db`; the
  CLI may import only the read-only PDF verification surface from
  `adapters/pdf-seal`.

## Hard rules

- Implement a port; don't invent new domain behaviour here (that belongs in
  `core/server`). No `any`. No `as` (except `as const`).
- Parse external input with zod at the boundary before returning it to core.
- New tables: `timestamptz` + `uuid` primary keys; add cursor pagination when a
  list can grow (see [architecture §Data conventions](../docs/architecture.md#data-conventions)).
- A thrown port promise is normalized once at the composition edge
  (`app.onError`), not caught inside the adapter.

## Verify you didn't break this layer

```bash
pnpm run depcruise
```
