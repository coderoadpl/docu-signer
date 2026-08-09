# ADR-0014: Client-side PDF signing

Date: 2026-08-01 · Status: accepted (owner-approved)

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
finalize pipeline as a new `signed-digital` PDF. The source is immutable. Ink
exists only in component memory and in the saved PDF; it is never stored as a
stamp, draft, database record or browser-storage value.

## Consequences

- Raw signature data never crosses the API or survives a reload.
- PDF.js, its worker and pdf-lib stay outside the main bundle and load only on
  the signing route.
- The output is a visual signature only: no certificate, timestamp, audit
  trail or new PDF metadata is created.
