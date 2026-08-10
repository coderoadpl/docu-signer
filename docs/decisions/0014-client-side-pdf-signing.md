# ADR-0014: Client-side PDF signing

Date: 2026-08-01 · Status: accepted (owner-approved), superseded in part 2026-08-09

## Context

The archive must add a hand-drawn signature to an existing source PDF without
turning signature ink into reusable server data. The placement transform must
also remain faithful for rotated pages and high-DPI canvases.

## Decision

The signing route lazily loads PDF.js and its same-origin bundled worker to
render one page at a time. Pointer Events capture pressure-aware strokes.
Before saving, the browser inverts the PDF.js viewport matrix after accounting
for CSS sizing and device pixel ratio, converts smoothed strokes to PDF vector
paths, and writes them with pdf-lib using `updateMetadata: false`.

The result goes through the existing file upload request/direct-or-server/
finalize pipeline as a new `signed-digital` PDF. The source is immutable. Under
the original decision, ink existed only in component memory and in the saved
PDF; it was not stored as a stamp, draft, database record or browser-storage
value.

## Consequences

- Under the original decision, raw signature data never crossed the API or
  survived a reload.
- PDF.js, its worker and pdf-lib stay outside the main bundle and load only on
  the signing route.
- Under the original decision, the output was a visual signature only: no
  certificate signature, signing time, audit trail or new PDF metadata was
  created.

## Status update (2026-08-09)

This ADR remains authoritative for browser-side rendering, placement and ink
flattening, but is superseded in part by the owner's
[2026-08-09 ruling recorded on PR #73](https://github.com/chomamateusz/docu-signer/pull/73#issuecomment-5233452249).
Signature-ink storage had already been reversed by the 2026-08-07 owner ruling
recorded in the PR #65 comment referenced by `FOUNDATION.md`.

When the tenant PAdES seal flag is on (it defaults off), the server replaces the
just-uploaded `signed-digital` blob at the same storage key with a PDF carrying
an embedded organization certificate signature. Source-replay promotion uses
the same post-upload overwrite. The CMS signing time is either the signer-
claimed document date plus the sealing wall-clock time (`declared`, the default)
or the true sealing wall clock (`actual`); the true application time is retained
as seal evidence in both modes. This is an organization seal and SES evidence
layer, not a qualified signature or a trusted TSA timestamp.

The seal evidence uses the existing per-file write-once signature record. A
seal may create that row first with a null stamp payload; the later client write
may fill the payload once, while any already non-null stamp payload remains
immutable. This is the feature's deliberate adjustment to the earlier
write-once flow, alongside the in-place blob replacement above.
