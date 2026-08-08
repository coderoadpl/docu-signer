# Observability

Normative policy. Sources: gap analysis in
[frontend-comparison.md](frontend-comparison.md); the wide-events model from
"Your logs are lying to you" (Boris/Cloudflare via Theo's review, transcribed
2026-07-12 — T3 Chat runs this in production on OTel + Axiom).

## The standard and the style

- **Instrumentation standard: OpenTelemetry.** `@opentelemetry/api` is a
  dependency-free facade that no-ops until an SDK is registered in the
  composition root — which makes it *vocabulary* under our dependency policy:
  core may annotate through it, adapters/exporters are wired at the edges,
  and the vendor is a config choice, never a code change. No `ObservabilityPort`
  — the facade is the industry's port already (wrapping it would be port
  theater).
- **Practice: wide events (canonical log lines), not step logging.** Do not
  log what the code is doing; build ONE context-rich event per request per
  service hop. As the request progresses, *annotate the active span* (user id,
  tenant id, subscription tier, business ids, feature flags, error context,
  perf counters) and emit once at the end. OTel without this discipline is
  "bad telemetry in standardized formats".
- **High cardinality is the point.** user/tenant/session/trace ids and
  business ids are the most valuable fields; never strip them to save
  volume — control cost with tail sampling instead: always keep errors, slow
  requests (>p99) and flagged accounts; sample the happy path (1–5%).

## Wiring (three chokepoints, zero feature changes)

Errors and traces already flow through single points; instrumentation attaches
there, never inside features or use-cases:

| Point | What it does |
|---|---|
| `apps/server` Hono middleware + `app.onError` | the middleware opens the request span, reads `traceparent`, annotates infra context and emits the wide event in `finally`; the single `app.onError` seam normalizes a throw to `internal`, records it on the active span (`recordException`) **and** captures it to the Sentry Node sink (`captureServerException`) — one error path, one `captureException`, tagged with the taxonomy code + trace id + tenant |
| `apps/web` root error boundary + `QueryCache.onError` | reports to Sentry with the active trace id; the error fallback **shows the trace id** so a user can paste it into a support message |
| `core/client` `request()` | injects W3C `traceparent` into every HTTP call — FE→BE trace unification is a one-place change |

Core use-cases may add business annotations via the `@opentelemetry/api`
facade (allowlisted vocabulary); they never import an SDK, exporter or vendor
package.

**What is wired today.**

- **Server error sink — WIRED.** `apps/server/src/observability.ts` installs the
  **Sentry Node SDK**, env-gated on `SENTRY_DSN`: absent = a clean no-op (no
  client, no network — dev and CI are untouched). It runs as a **pure sink** —
  `skipOpenTelemetrySetup` (tracing stays OTel's, no double provider) and no
  default integrations (no global `uncaughtException`/`unhandledRejection`
  hooks, no auto-instrumentation) — so an error reaches Sentry through **exactly
  one seam**, `captureServerException` at `app.onError`, never a scattered
  `Sentry.captureException`. Returned domain `AppError`s (validation, not-found,
  unauthorized) are expected outcomes and are **not** captured; only the
  unhandled/`internal` path is. The event is tagged with the trace id read off
  the active OTel span, so a Sentry error joins the wide event on the same trace.
- **Server tracing (OTLP) — OPTIONAL, env-gated.** The same module registers a
  Node tracer provider + OTLP exporter **only** when an OTLP endpoint is set;
  without it `@opentelemetry/api` stays a no-op facade. The vendor behind OTLP
  (Sentry's OTLP ingest, Axiom, ClickHouse) is exporter config, never a code
  change. Sentry and OTLP are independent: either, both or neither may be on.
- **Browser — Sentry SDK only.** `apps/web` installs the Sentry browser SDK but
  **no OTel browser provider**, so `core/client`'s `traceparent` injection reads
  the no-op facade and emits nothing — the SPA does not yet originate a trace id,
  and the error-fallback trace id appears only once a browser provider is
  registered.
- **Not wired.** There is **no DB-hop instrumentation**, and the
  **tail-sampling policy is documented intent, not implemented code**. Hono only
  *continues* an incoming `traceparent`. Which browser/sampler providers to
  register (and the web `tracesSampleRate` vs the happy-path tail-sampling
  policy above) remains the open wiring decision — DECIDE, not shipped.

## Sinks

- **Default: Sentry.** Server-side, the **Sentry Node SDK** is wired directly at
  the `app.onError` seam for **error capture** (not via Sentry's OTel
  integration — tracing stays on OTel/OTLP); the SPA runs the **Sentry browser
  SDK** (errors + browser tracing + web vitals). Enough for launch on both
  targets.
- **Distributed traces / analytics-grade wide events**: exported over OTLP to
  Sentry's trace ingest or, when log-analytics needs outgrow Sentry (querying
  events like a database), a columnar store — Axiom (free tier: 500 GB/mo
  ingest, 30-day retention, mid-2026) or self-hosted ClickHouse on the Docker
  target. Because span instrumentation is OTel, adding/switching a trace sink is
  exporter config in the composition root.
- **Metrics and dashboards are views over wide events** — no separate metrics
  system until a proven need; the logs-vs-metrics split is artificial when
  events carry full context.

## Enforcement

- **Vendor containment.** `@sentry/node` may appear **only** in
  `apps/server/src/observability.ts` — the composition-root sink module, the
  server mirror of `@sentry/react` in `apps/web/src/observability.ts`. It is not
  wrapped in a port (an error sink is config, not a replaceable domain
  dependency — port theater); features, use-cases and `core/**` never import it.

  | | Enforcement |
  |---|---|
  | **TYPE** | `captureServerException` is the only exported capture; its `AppError` + `Identity` params flow from `core/domain`, so a caller cannot invent an untyped capture |
  | **LINT** | `boundaries` keeps `core/**` and clients off `apps/server`; `no-console` in `apps/server` (scoped-off only for `entry.*.ts`/`env.ts`) forbids step-logging around the seam |
  | **TEST** | `apps/server/src/observability.test.ts`: a fake DSN + injected sink yields **exactly one** capture with the app-error/trace/tenant tags through `app.onError`; absent a client everything no-ops |
  | **REVIEW+AI** | a second `Sentry.captureException` anywhere but the seam, or a `@sentry/node` import outside the sink module, is rejected |

- `no-console` errors in `apps/web` **and** `apps/server` — the wide event is
  the log (scoped exception wired for the composition root's startup/fatal
  path: `apps/server/src/entry.*.ts` and `env.ts`).
- Review rule (Phase 4 candidate once patterns settle): request handlers and
  use-cases annotate spans, they do not emit events — emission belongs to the
  middleware, exactly once.
- Platform note: on Vercel both pipelines must flush before the invocation
  freezes — `startServerObservability` returns one force-flush hook draining the
  OTel batch **and** `Sentry.flush()`, called in the `api/index.ts` finally
  block; on Docker the long-lived process flushes normally. Same seam everywhere.
