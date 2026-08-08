/**
 * Events — the write seam of the members island (events-in). A view describes
 * WHAT THE STAFF USER DID as a closed union of intent events and hands them to
 * `send` (./index.ts); it never mutates state directly.
 *
 * NAMING TAXONOMY (lint-enforced: agentproofarch/event-suffix-taxonomy) — every
 * member names a user INTENT, not a decision the core owns.
 */
export type MembersEvent =
  // Rung 1 seam placeholder handled as a no-op in ./index.ts; the ensure/refresh
  // writes ride mutation descriptors in the view until the island graduates.
  | { type: 'refreshRequested' };
