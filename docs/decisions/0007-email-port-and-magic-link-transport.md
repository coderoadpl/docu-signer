# ADR-0007: EmailPort shape and the magic-link transport

Date: 2026-07-21 · Status: accepted (owner-approved)

## Context

US-026 (passwordless member provisioning + magic-link sign-in) is the first
feature that must send mail, so it is the trigger that turns the roadmap's
deferred `EmailPort` (architecture §Storage and email ports) into a built port.
The roadmap had sketched `send({ to, subject, html, text })` with a Resend
adapter on both targets and a `console` dev adapter.

Two forces reshaped that sketch:

1. **Owner delivery decision.** The universal default transport is **SMTP**, not
   Resend — it must work with Amazon SES SMTP credentials out of the box, and be
   trivially swappable behind the port ("niech sobie ktoś to podmieni"). Real SES
   creds arrive later via env; dev/CI must do **no** real delivery.
2. **Dev must surface the link.** US-026's acceptance criterion is explicit: in
   dev the magic-link URL is returned/logged, no email sent. A test/CLI/e2e run
   needs to retrieve that specific link deterministically.

## Decision

1. **Port shape: `sendMail({ to, subject, text, html?, link? })`.** Kept minimal
   and generic. The magic link is ONE consumer of `sendMail`, not the port's
   shape — the magic-link email is composed in `create-auth.ts` and passes the
   raw URL as the optional `link` field. `link` is a general transactional-mail
   concept (a primary call-to-action URL), not a dev hack: a transport embeds it
   in the body and otherwise ignores the field. No `tenantId` — one verified
   sender domain (`EMAIL_FROM`).

2. **Two adapters in `adapters/email/`, selected by `EMAIL_TRANSPORT`** in the
   composition root, exactly like `DOMAIN_PROVISIONER`:
   - `smtp` (default) — nodemailer over any RFC SMTP relay. Amazon SES SMTP creds
     work unchanged (`SMTP_HOST=email-smtp.<region>.amazonaws.com`, the SES SMTP
     user/pass, port 587, STARTTLS). Swap the relay behind the port for any other
     provider; the app never learns which. SMTP auth is optional, so an open local
     relay needs no user/pass.
   - `ses` — Amazon SES **direct** over the SESv2 HTTP API
     (`@aws-sdk/client-sesv2`, `SendEmail`), selected with the standard AWS
     credential env names (`AWS_REGION`, `AWS_ACCESS_KEY_ID`,
     `AWS_SECRET_ACCESS_KEY`). The owner's ruling: SMTP is the one default, but
     SES should also be reachable directly by key ("SMTP to jeden ale od razu
     powinniśmy umożliwiać też SES bezpośrednio przez klucz") — for teams that
     cannot or will not open an outbound SMTP port. Same `EmailPort` shape; the
     `link` already lives in `text`, so the SES `Simple` body carries it unchanged.
   nodemailer was chosen over a hand-rolled SMTP client: it is well-maintained,
   handles STARTTLS/auth/encoding, and SES-SMTP compatibility is a first-class
   use case. Every email-vendor SDK (nodemailer and `@aws-sdk/*`) is contained to
   `adapters/email` by the one depcruise rule. Selecting `ses` without its
   credential block is a composition error (fail fast, not silent no-delivery).

3. **No dev transport — a real send to a local Mailpit (owner ruling).** "Nie chcę
   trzeciego osobnego na dev — lokalny SMTP który przechwytuje naprawdę wysłane
   maile jak SaaSowy MailTrap; MailPit jest rewelacyjnym rozwiązaniem." Dev, e2e
   and CI run the **real** `smtp` adapter pointed at a local **Mailpit**
   (docker-compose.dev.yml; the smoke/e2e CI jobs add it as a service). Mailpit
   captures every send instead of delivering and exposes an HTTP API on
   `:47980`. The magic-link smoke/e2e phases request a link, read the captured
   message back over that API (`/api/v1/messages`, `/api/v1/message/{id}`), extract
   the verify URL and follow it — the same round-trip a human makes from the
   Mailpit inbox. The CLI `login-link` requests a link and, given `--link <url>`
   (copied from Mailpit/an inbox), follows it. There is **no `/api/dev/magic-link`
   route and no `DevMailbox`**: nothing dev-only ships in the app, so nothing has
   to be kept off production.

4. **Member↔user binding on first sign-in (US-026).** A member provisioned by
   `ensureMember` has a null `userId` until they first authenticate. Binding
   happens in `resolveIdentity`: when no member is yet bound to the account, the
   (tenant, email) member row is claimed (`bindMemberOnSignIn`). It is tenant-
   aware (resolution knows the tenant), idempotent (a bound account short-circuits
   before the bind read), and safe (a member already bound to a different account
   is never re-bound or granted). It carries no capability — a system step gated
   by an established session, like tenant resolution itself.

## Consequences

- Better Auth's magic-link plugin's `sendMagicLink` callback delegates to
  `EmailPort.sendMail` — one transport, one from-address policy, as the roadmap
  called for. Social (Google) and TOTP 2FA plugins ride the same auth adapter.
- Passkeys (`@better-auth/passkey`) are **built** (US-028a): the package pinned a
  `better-call` whose optional `zod@^4` peer conflicted with this tree's former
  `zod@^3`, so the migration to `zod@^4` was the named unblock — landed first with
  all gates green, then the plugin was wired. The server plugin adds a `passkey`
  table (migration `0008_passkey`) scoped by `rpID = APP_BASE_DOMAIN` (one
  credential spans every tenant subdomain); the register/list/remove/sign-in
  surface is exposed only through `AuthClientPort` (settings PasskeySection + a
  login sign-in-with-passkey button), never a provider route in a client.
- The originally-sketched Resend/`console` split is superseded. Future non-auth
  transactional mail (order receipt, export-ready notice) reuses `sendMail` from
  a use-case; per-tenant branded senders remain a when-triggered extension.
