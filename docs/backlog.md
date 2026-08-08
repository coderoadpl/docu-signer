# Deferred-work register

The audit's DEFER lists (round-1 and round-2 consensus, 2026-07-20) and residuals
from later package verifications, persisted so nothing lives only in session
notes. Entries here are **accepted as real but deliberately not built**; each has
a named trigger where the audit assigned one. When a trigger fires, the entry
graduates into an ADR or an implementation slice — it never gets built silently.

This register is descriptive, not normative: nothing in it weakens
[architecture.md](architecture.md). If an entry contradicts the architecture,
the architecture wins until the entry is adjudicated.

## Day-2 operations (trigger: first real production incident, or the first
paying tenant — whichever comes first)

- Rollback doctrine and migrate-vs-deploy ordering.
- Alerting, uptime targets, SLOs; runbooks and incident severity ladder.
- Self-host operations: backup cadence, upgrade contract, Vercel/Docker parity
  matrix.
- DB performance doctrine: indexing rules, slow-query surfacing.
- Failure-mode matrix per external dependency; overload/backpressure stance.
- Process lifecycle: SIGTERM drain; pg pool configuration — including
  `pool.on('error')` (an idle-client error currently crashes the Node process)
  and the boot-with-dead-DB posture (E2 verification residuals, 2026-07-19).

## Security & compliance (trigger: first external security review, or first
enterprise customer questionnaire)

- Threat model; supply chain (SBOM, dependency scanning).
- Secrets and crypto handling cross-target (Vercel env vs compose env).
- Session policy numbers (lifetimes, rotation); password policy and
  account-enumeration posture (R2-31 — registration/login currently reveal
  account existence through better-auth defaults).
- Support access / break-glass procedure; abuse quotas (tenant-creation
  velocity); vulnerability management.
- Data governance matrix: classification, DSAR flow beyond member export,
  legal holds.

## Product platform (trigger: named per entry)

- Feature flags / kill switches — trigger: first dark launch.
- Forms doctrine (§Frontend promises one; none exists) — trigger: first
  multi-step or dynamic form.
- A11y: WCAG target + axe pass in e2e — trigger: first public-facing product UI.
- i18n insurance rules — trigger: first non-English tenant requirement.
- Product analytics + consent — trigger: first growth instrumentation ask.
- Visual-regression tooling — **none today** (decision recorded, not built). The
  recommended path is Playwright `toHaveScreenshot()` reusing the existing e2e
  Chromium harness, with **baselines generated in CI, never on a dev Mac** (the
  flake doctrine — a Mac-rendered baseline drifts against the Linux CI runner).
  Storybook + Lost Pixel is the component-isolation alternative when the need is
  per-component rather than per-page. Chromatic is excluded (paid). Trigger: the
  first UI-heavy consumer of the foundation.
- ~~US-020 Vercel domain-provisioning adapter (`DomainPort`)~~ — **BUILT** (the
  trigger fired: tenant subdomains bridged through company DNS with one plain
  wildcard CNAME `*.agentproofarch.coderoad.pl → cname.vercel-dns.com`, and a
  records-only zone can carry no DNS-01 wildcard cert, so every per-tenant host
  needs its own HTTP-01 cert and therefore its own programmatic attach).
  `adapters/domain-provisioning/vercel.ts` + `DOMAIN_PROVISIONER=vercel` ship with
  `VERCEL_TOKEN`/`VERCEL_PROJECT_ID`(+`VERCEL_TEAM_ID`) and a boot refusal when
  the block is incomplete (see
  [architecture.md](architecture.md#ports-complete-list)). Hobby
  caps at 50 custom domains per project. **Residual, still open: the adapter has
  never run against the live Domains API** — its behaviour is proven only against
  a stubbed `fetch`, because CI and the build machine have no token. The owner
  supplying `VERCEL_TOKEN` in the Vercel env (A1-S5) is what closes that gap; the
  first live add/check/remove against a real project is the acceptance run.
- Cost guards and attribution — trigger: first surprising vendor bill.
- CLI distribution + version handshake — trigger: first external CLI consumer.
- Per-tenant IdP / enterprise SSO (tenant-configured SAML/OIDC federation) — trigger: first enterprise customer ask.
- Billing/entitlements; search; load testing; IaC — trigger: the respective
  product need.
- Foundation upgrade contract (R2-29): release manifest, tagged revisions,
  change classes, security-advisory channel, conformance command — trigger:
  the second app consuming this foundation.
- Sentry CSP trigger guard (R2-30): enabling `VITE_SENTRY_DSN` requires adding
  the ingest host to `connect-src` for that environment (documented manual
  step); when the trigger first fires, also add a deployed probe so the pairing
  cannot be fumbled.

## Vendor-fact refresh (trigger: quarterly, or before relying on the fact)

- Re-verify Vercel Queues availability and Neon restore windows against primary
  sources; add "as of" dates beside every vendor limit cited in
  jobs-research.md and architecture.md §backups.

## Unlegislated demo decisions (trigger: the next edit touching each)

- `maxDuration: 30` as the de-facto latency budget.
- Theme-mode / tenant-accent theming seam. (Visual-regression tooling role is
  now recorded under §Product platform.)
- dist-freshness cross-reference; coverage-ratchet ownership.
- Client retry/GC numbers; CLI config precedence; SPA fallback semantics.

## Verification residuals (accepted, report-only)

- Slug VO drops diacritic letters instead of transliterating: a fully
  diacritic Polish tenant name yields a near-empty slug (S6 verification,
  2026-07-21). Trigger: first real Polish-named tenant complaint, or the next
  edit to `core/domain/slug.ts`.
- `domainNameSchema` accepts raw IPv4 (`192.168.1.1`) as a custom domain
  (S6 verification). Trigger: next edit to the domain chain.
- Revoked-staff denial is `tenant_not_found`, byte-identical to a stranger's —
  deliberate existence-hiding, recorded so nobody "fixes" it to `forbidden`
  (S2 verification).
- Cross-subdomain session on a real base domain (switcher keeps the session in
  prod) is documented but not locally testable (S6). Trigger: first custom
  base-domain deployment — verify live, then delete this row.
- Post-deploy production smoke trigger — **resolved by the topology.** Production
  is now released by merging an owner-approved PR to the `production` branch, and
  a branch merge is an ordinary push that emits `deployment_status` for the
  `Production` environment, so `post-deploy-smoke.yml` fires as-is. The old
  concern (a dashboard "Promote to Production" possibly emitting a different or no
  `deployment_status`) does not apply to the PR-merge model
  ([deploy-promotion.md](deploy-promotion.md) §b step 6).

## Optional second reviewer (shipped 2026-07-26)

- **CodeRabbit runs as the optional second reviewer.** The owner installed the
  GitHub App and `.coderabbit.yaml` configures it: chill profile, no
  request-changes, doctrine-pointing path instructions, noise exclusions. It is
  **advisory only** — it comments and posts a non-required `CodeRabbit` status;
  the fail-closed `ai-review` gate remains the sole enforcement tier, so
  CodeRabbit can never turn a real `FAIL` green nor block a merge itself.

## Open owner decisions (not deferred — awaiting answers)

Tracked in the DECIDE queue: B5 (agent operating envelope), C1 (transactions
doctrine on neon-http), C3 (invariant placement), C4 (backfill executor),
F2 (concurrent-change protocol); plus the provider/secret choices blocking
A1-S4 (magic-link email provider, social OAuth credentials) and A1-S5
(`VERCEL_TOKEN` for US-020 — the adapter is built and offline-tested; the token
is what remains, and only the live verification depends on it).
**F1 (AI-reviewer gate) is decided and built** — the
fail-closed `ai-review` workflow ships with `CLAUDE_CODE_OAUTH_TOKEN_1`; see
[../demo/README.md](../demo/README.md) §Operating hygiene for agent-driven repos.
