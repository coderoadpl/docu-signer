# Webhooks and background jobs on free hosted infrastructure

Research supporting `architecture.md` §Background jobs and webhooks.
Deep-research run 2026-07-11: 5 search angles, ~15 primary sources, every
claim adversarially verified (3 independent refutation votes; all findings
below survived 3-0 unless noted). Findings are mid-2026 snapshots — free
tiers move; re-verify before relying on a number.

## Stripe webhook delivery (primary docs, all 3-0)

- **Retries are the reliability backbone**: failed deliveries retry with
  exponential backoff for up to **3 days in live mode** (test mode: 3 retries
  over a few hours). Caveats: an endpoint failing continuously for ~3 days can
  be disabled; returning 2xx before doing the work forfeits the retry; manual
  redelivery extends recovery to 15 days (Dashboard) / 30 days (CLI).
- **Webhook-driven fulfillment is mandated**: "You can't rely on triggering
  fulfillment only from your Checkout landing page" — customers may never
  reach it. Handle `checkout.session.completed` (+
  `checkout.session.async_payment_succeeded`) server-side.
- **Duplicates and concurrency are contractual**: the same event can arrive
  more than once; the fulfillment handler may run multiple times concurrently
  for one Checkout Session. Stripe's own guidance: log processed event IDs.
  Caveat: two distinct Event objects can describe the same change — dedupe on
  `data.object` id + event type as well, not event id alone. (This is an
  inbox/processed-events table, not a true outbox.)
- **Ordering is not guaranteed**: never assume related subscription/invoice
  events arrived first; fetch missing objects via the API.
- **Return 2xx fast**: slow handlers count as timeouts. Stripe recommends an
  async queue for delivery spikes (e.g. month-start renewal storms) — the
  documented reason to eventually add one, relevant only at real subscription
  volume. Serverless middle ground: unique-constrained insert first, process,
  non-2xx on failure so the retry backstops processing errors.

## Hosted queue/scheduler free tiers (mid-2026)

| Option | Free tier | Notes |
|---|---|---|
| **Upstash QStash** | 1,000 msgs/day, 1 MB msg, 7-day max delay, 3-day DLQ | HTTP **push** → Vercel Functions are consumers with no resident worker; most Vercel-native. Retries bill as messages; PAYG $1/100k. |
| **Cloudflare Queues** | on Workers Free since 2026-02: 10k ops/day ≈ ~3.3k msgs (3 ops/msg) | **24 h retention** on free (a >1-day consumer outage loses messages); consumption is Workers-based, not arbitrary HTTP. |
| **Vercel Queues** | none — metered paid (per API op, 4 KiB chunks, regional pricing), access-gated | Weak default for zero-fixed-cost; retention 60 s–7 d. |
| **Neon pg_cron** | — | **Cannot** drive a poller under free-tier scale-to-zero: jobs run only while compute is active; Neon recommends 24/7 compute for pg_cron. |
| **pgmq (SQL queue)** | pure SQL, no worker, at-least-once | Works from serverless, but needs an external trigger to drain — pairs with QStash schedule. |
| **Supabase Cron** | 1 s – 1 yr schedules, SQL or HTTP via pg_net | ~8 concurrent jobs, ≤10 min runtime, skipped runs not retried, free projects pause after ~7 days idle; cross-provider complexity for little gain over QStash when the DB is Neon. |

## Synthesis (confidence: medium — architecture derived from verified facts)

1. **At A/B-test scale, no queue at all**: synchronous processing inside the
   webhook function + processed-events table on Neon + Stripe's 3-day retry
   as redelivery backstop.
2. **A/B attribution**: assignment cookie → variant/assignment id in Checkout
   `metadata` + `client_reference_id` at session creation → webhook records
   the conversion idempotently → aggregation as a read query. (The Checkout
   metadata leg and exact cost-crossover to Railway were not independently
   verified — no surviving adversarial claims either way.)
3. **When deferred jobs become real** (email sequences): outbox table on the
   existing Postgres + `JobsPort`; Vercel executor = drain endpoint woken by a
   QStash schedule; self-host executor = pg-boss resident worker (second
   compose service from the same image).
4. **What breaks first at scale**: QStash 1k msgs/day ceiling and function
   duration limits on drain batches; at sustained volume a Railway/self-host
   worker is simpler and cheaper than stacking serverless workarounds.
