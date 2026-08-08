import { type Card, type TeamColumn } from '#core/domain/index.js';

/**
 * Events — the write seam of the team-board island (events-in). A view never
 * mutates state or calls a machine directly: it describes WHAT THE USER DID as a
 * closed union of intent events and hands them to `send` (./index.ts). The core
 * decides what to do with them — including asking the domain oracle whether a
 * requested move is even legal.
 *
 * RUNG 3 (statechart). `cardMoveRequested` is a REQUEST, not a command: the core
 * consults the table-derived oracle (core/machine.ts) and only an allowed move
 * reaches the gateway (a blocked one records its rejecting rule instead). The
 * event carries the current merged `board` as the context the oracle adjudicates
 * against — transiently; the store never keeps a copy of it (two-machines
 * contract). `refreshRequested` is the server-read seam: the store no-ops and the
 * view refetches the cache so the server list becomes the truth.
 *
 * NAMING TAXONOMY (lint-enforced on this union: agentproofarch/event-suffix-taxonomy):
 * every member names a user INTENT, never a decision the core should own. Allowed
 * suffixes: …Requested | …Confirmed | …Cancelled | …Changed | …Selected | …Opened
 * | …Closed | …Added | …Moved | …Removed | …Failed | …Succeeded.
 */
export type TeamBoardEvent =
  | { type: 'refreshRequested' }
  | { type: 'cardAdded'; title: string; column: TeamColumn }
  | {
      type: 'cardMoveRequested';
      cardId: string;
      fromColumn: TeamColumn;
      toColumn: TeamColumn;
      board: readonly Card[];
    };
