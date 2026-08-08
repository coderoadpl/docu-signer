/**
 * Events — the write seam of the board island (events-in). A view never mutates
 * state or calls the store directly: it describes WHAT THE USER DID as a closed
 * union of intent events and hands them to `send` (./index.ts). The core decides
 * what to do with them.
 *
 * RUNG 2 (island store): every DOMAIN member below has a matching handler in the
 * store's `on` map (core/store.ts), so the compiler ties the two together — the
 * event map IS the seam. `refreshRequested` is the server-read seam: the store
 * deliberately no-ops (in-flight ops reconcile through their own settlement) and
 * the view refetches the cache, so the server list becomes the truth.
 *
 * NAMING TAXONOMY (lint-enforced on this union: agentproofarch/event-suffix-taxonomy):
 * every member names a user INTENT, never a decision the core should own. Allowed
 * suffixes: …Requested | …Confirmed | …Cancelled | …Changed | …Selected | …Opened
 * | …Closed | …Added | …Moved | …Removed | …Failed | …Succeeded.
 */
export type BoardEvent =
  | { type: 'refreshRequested' }
  | { type: 'cardAdded'; title: string; column: string }
  | {
      type: 'cardMoved';
      cardId: string;
      fromColumn: string;
      fromIndex: number;
      toColumn: string;
      toIndex: number;
      toColumnSize: number;
    }
  | { type: 'undoRequested' };
