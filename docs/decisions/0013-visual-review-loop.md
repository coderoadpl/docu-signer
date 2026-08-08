# ADR-0013: GitHub-native visual review loop

Date: 2026-07-27 · Status: accepted (owner-approved) · Extends
[ADR-0008](0008-visual-regression.md).

## Context

The visual suite already captures deterministic Linux screenshots and compares
them byte-for-byte, but a reviewer must download artifacts to understand a red
run and manually copy approved PNGs back into the branch. The evidence and the
approval should live in the pull request, while git remains the only baseline
store.

This fork has no branch rulesets. `visual` is non-required and there is no
required-check arming plan; approval authorization and protected-ref safety must
therefore be explicit in the workflows.

## Decision

The read-only `visual` job uploads Playwright’s expected, actual and diff images
plus its HTML report. A separate `visual-report` job publishes one sticky
gallery comment.

The publisher is the only visual-loop job with `contents: write` and
`pull-requests: write`. It checks out `github.event.pull_request.base.sha`,
never the pull-request head. A pull request can control PNG bytes and artifact
names but cannot control executed publisher code. Artifact collection accepts
only flattened names matching
`^[A-Za-z0-9._-]+-(expected|actual|diff)\.png$`; duplicate flattened names fail.

Published images live on the bounded `visual-reports` utility branch under
`pr-<number>/run-<id>/`. Each publication force-rewrites one orphan commit
containing open pull requests only. The run ID prevents stale raw-image caches,
and one non-cancelling concurrency group serializes publishers.

The gallery renames Playwright’s reader-facing `expected` column to `baseline`,
shows the exact zero-threshold pixel count, and links to the HTML report.
Clean runs update an existing sticky comment but do not create a new one.

An advisory AI read may add one Polish line per screenshot. It reuses
`CLAUDE_CODE_OAUTH_TOKEN_1` only when present. Input preparation, model
execution, parsing and missing-script handling are all fail-open:

- token detection emits presence only;
- preparation and model steps use `continue-on-error`;
- the model has a ten-minute bound and read-only tools;
- malformed or absent structured output becomes “verdict unavailable”;
- the gallery publisher runs independently of the verdict outcome.

The AI read is not a status gate and cannot make the visual job red.

## Approval and commit path

`approve-visuals.yml` listens only to newly created issue comments. Its
default-branch copy checks that the comment belongs to a pull request and that
the author is the repository owner or is explicitly named in the
admin-controlled `VISUAL_APPROVERS` JSON array. `COLLABORATOR`, `MEMBER` and
`CONTRIBUTOR` associations are not implicitly accepted. The read-only guard
then compares the trimmed body with the exact `/approve-visuals` command; the
comment body is never interpolated into a shell.

The write-capable job resolves the pull request through GitHub’s API and refuses
a fork head. For a same-repository branch it dispatches
`visual-baselines.yml` with `update: true`, `commit: true` and the exact head
SHA observed during approval.

The baseline workflow:

1. rejects commit mode unless update mode is running on a non-`main` branch;
2. checks out the approved exact SHA without persisting the write-capable
   credential;
3. re-renders and performs the second comparison that already guards artifact
   publication while the selected code remains tokenless;
4. stages only `visual/__screenshots__`;
5. exposes `GITHUB_TOKEN` only to the guarded commit step and pushes to the
   dispatched branch name.

If the branch tip moved after approval, the exact-SHA push is non-fast-forward
and fails. The explicit `main` rejection substitutes for the upstream ruleset
wall that this fork deliberately does not have.

The final decision artifact is the committed PNG diff in the pull request’s
Files tab. `/approve-visuals` requests a render; it does not make an unseen image
correct.

## Consequences

- Reviewers see the visual evidence and approval trail in the pull request.
- Baselines stay in git; no vendor account, external baseline store or new
  long-lived secret is introduced.
- Same-repository pull requests get the automated loop. Fork pull requests keep
  the read-only visual artifacts and require a maintainer’s manual branch path.
- A commit made with `GITHUB_TOKEN` does not recursively trigger CI. Because
  this fork does not arm `visual` as required, the stale status after a baseline
  commit is informational.
- `visual-reports` is intentionally force-written and holds only review images;
  its history is disposable.
