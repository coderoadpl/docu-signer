# ADR-0012: Per-origin CLI profiles

Date: 2026-07-27 · Status: accepted (owner-approved)

## Context

The CLI previously stored one machine-global `{ apiUrl, token, tenant }` record
in `~/.config/agentproofarch/config.json`. A login against any deployment
overwrote the only session and made later commands silently target that
deployment, even from a local checkout. That is a correctness problem for an
agent-first client: a valid response from the wrong instance is not visibly
wrong, and a write can land in the wrong database.

The fork routinely targets localhost and Production. Its smoke drivers already
isolate CLI state with throwaway home directories, but interactive use needs the
same origin isolation that browser cookies provide.

## Decision

The config file keeps its existing location and becomes a versioned map keyed by
canonical WHATWG origins:

```json
{
  "version": 3,
  "currentOrigin": "http://default.localhost:47100",
  "profiles": {
    "http://default.localhost:47100": { "token": "…" },
    "https://docu-signer-nine.vercel.app": { "token": "…" }
  }
}
```

Each origin owns its token. `origin list` reports configured origins, the active
marker and token presence without exposing token values.
`origin use <url>` selects an origin without a network call.

The selection order is:

```text
--api-url > APP_CLI_API_URL > podpisy-repository default > currentOrigin
```

The token always comes from the selected profile. There is deliberately no
`APP_CLI_TOKEN`: login writes tokens, logout revokes and clears them, and an
environment token would be neither safely persisted nor revocable.

The repository default is `http://default.localhost:47100`, the host bound to
the seeded tenant. Detection walks upward from `process.cwd()`, parses
`package.json`, and recognizes the fork by
`name: "podpisy"`. It does not depend on the checkout directory or `.git`, so
renamed clones, worktrees and copied trees behave identically. The default port
lives in `core/contract/defaults.ts`; both the CLI and
`core/server/config.ts` consume it. This is the deliberate reason
`core/server` may depend on `core/contract`.

`currentOrigin` moves only on an explicit flag/env-backed state write or
`origin use`. Repository detection does not persist its localhost choice, and
read-only commands do not write config.

Legacy files migrate automatically. Their API URL is canonicalized to the
profile origin and the token is preserved; the removed tenant selector is
dropped. An absent or invalid
legacy URL migrates under the development origin. The rewrite creates a sibling
temporary file with mode `0600` and atomically renames it over `config.json`.
Write or rename failure removes the temporary file and preserves the original
token-bearing file.

Malformed JSON and corrupted current or legacy shapes fail loudly with the
`internal` CLI taxonomy (exit 10) and never rewrite the file. Future-version
shapes are treated as empty and left byte-for-byte untouched. Migration emits
one stderr notice so `--json` still emits exactly one envelope on stdout.

## Consequences

- Switching origins never clobbers another origin’s session.
- Commands inside this fork default safely to the local server; targeting
  Production from the checkout must be explicit.
- `APP_CLI_API_URL` is a client-only input, so it does not belong to the server
  environment schema or `.env.example`.
- `PODPISY_CLI_CONFIG_DIR` overrides the profile directory for isolated agent
  and test runs; interactive use keeps `~/.config/agentproofarch`.
- The existing config path is retained so the fork can migrate profiles written
  before this decision.
- Concurrent writers remain last-writer-wins. The plaintext `0600` token store
  and lack of OS-keychain integration are unchanged.
