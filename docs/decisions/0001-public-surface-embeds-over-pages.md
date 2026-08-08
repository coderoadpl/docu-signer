# ADR-0001: Public surface — headless API and embeds instead of hosted pages

Date: 2026-07-11 · Status: accepted (owner-approved)
Supersedes: the earlier in-discussion proposal of SSR'd public pages in Hono.

## Context

Products on this foundation (first: Together) need creators to sell through
public, SEO-relevant pages. The original question was how to render such
pages given the foundation's "static SPA, no SSR, no Next.js" rule. During
review the product owner redefined the problem: creators should build their
own sites with the excellent existing tools (Astro, Next, Webflow, plain
HTML); a platform-hosted page/template system would only compete with those
tools and lock creators into our blanks. What the platform must own is the
commerce layer: prices, promotions, A/B variants, buy flows — configured in
the admin panel and consumable from any external site.

## Decision

1. **No public marketing/landing pages** in products on this foundation.
   SEO is the creator's site's job. A simple hosted-pages/template system is
   at most a distant nice-to-have.
2. **Public read-only contract routes** (headless JSON API): unauthenticated
   GET, open CORS, cacheable with tenant-content versioning. This is the base
   layer every other consumer builds on. In PoC/MVP this is the only consumer
   interface.
3. **Shareable flow URLs**: complete flows (checkout-style) served on the
   tenant's domain, linkable from anywhere, so a creator with zero
   infrastructure can still sell (Stripe Payment Links model).
4. **Iframe embed widgets — post-MVP**: `<script>` loader + iframe on
   `/embed/*`, rendered by Hono via `hono/jsx` (typed templates producing
   plain HTML, no client runtime), postMessage auto-resize, per-widget theme
   options. Iframe isolation protects both sides (CSS/JS) and keeps
   versioning on the platform.
5. **Headless React SDK — recommended, pending owner confirmation**: a thin
   npm package (unstyled hooks/components, types reused from `core/contract`).
   Stripe precedent: their React components wrap the transport; ours would
   wrap the public JSON API. Publishing amends the no-package-publishing
   non-goal — deliberately.
6. **Next.js remains rejected**: it buys page-rendering features for a
   product that no longer renders pages; the cost (second framework,
   platform idioms, heavier self-host, blurred boundaries) buys nothing here.

## Consequences

- The earlier SSR-pages design shrinks to the `/embed/*` widget endpoints;
  no SEO/meta machinery, no page cache strategy.
- A/B assignment happens server-side per widget impression; conversion
  attribution flows through checkout metadata (variant id) back via the
  payment webhook.
- Public routes form a new contract group with their own rules (no identity,
  open CORS, cache headers) — enforced like every other boundary.
- The downstream **Together** product's own PRD (maintained in the Together
  product repo, not this foundation repo — there is no `tasks/` directory here,
  see the PRD §0 Errata) must rewrite FR-35 and US-030: public product pages →
  embeds + headless API + shareable checkout links.
