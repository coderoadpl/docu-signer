import { createStore } from '@xstate/store';

import { TEAM_WIP_LIMITS, type Card, type RuleId, type TeamColumn } from '#core/domain/index.js';

import { type TeamBoardEvent } from './events.js';
import { evaluateTeamMove } from './machine.js';

/**
 * Store — the team island's UI layer (@xstate/store, the sibling personal board's
 * choice; its event map IS the seam). It holds ONLY in-flight optimistic ops and
 * the last rejection — never a copy of the card list (two-machines contract): the
 * card truth lives in the TanStack cache and core/selectors.ts merges the cache
 * with this overlay. On reload this state dies; the server list does not.
 *
 * RUNG 3 composition: on `cardMoveRequested` the store CONSULTS the table-derived
 * oracle (`evaluateTeamMove`) before touching the gateway — the oracle-guard shape
 * from ADR-0005. A blocked move never becomes a pending op and never reaches the
 * server; instead its rejecting rule id is recorded as `lastRejection` so the UI
 * can name the reason. The gateway is INJECTED, so the core is pure and testable.
 */

export type GatewayResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

export interface TeamBoardGateway {
  addCard(input: { readonly title: string; readonly column: string }): Promise<GatewayResult>;
  moveCard(input: {
    readonly cardId: string;
    readonly toColumn: string;
    readonly toIndex: number;
  }): Promise<GatewayResult>;
}

export interface TeamBoardDeps {
  readonly gateway: TeamBoardGateway;
  readonly generateId: () => string;
}

/** A card the user just typed — client-originated, not a server record copy. */
export interface OverlayCard {
  readonly id: string;
  readonly title: string;
  readonly column: TeamColumn;
}

/** Why the last requested move was refused — the oracle's verdict, surfaced to the UI. */
export interface Rejection {
  readonly cardId: string;
  readonly toColumn: TeamColumn;
  readonly rule: RuleId;
}

export type PendingOp =
  | { readonly opId: string; readonly kind: 'add'; readonly card: OverlayCard }
  | {
      readonly opId: string;
      readonly kind: 'move';
      readonly cardId: string;
      readonly toColumn: TeamColumn;
    };

export interface TeamOverlayState {
  readonly pending: readonly PendingOp[];
  readonly lastRejection: Rejection | null;
  /** Bumps on every committed persist so the view can invalidate the cache once. */
  readonly committedRev: number;
}

export interface TeamBoardStore {
  send(event: TeamBoardEvent): void;
  subscribe(listener: () => void): () => void;
  getState(): TeamOverlayState;
}

// Settlement events travel from the async gateway effect back into the store to
// commit (drop the op, bump the revision) or roll back (drop the op). They are
// NOT part of TeamBoardEvent — the public `send` accepts only TeamBoardEvent.
type SettleEvent =
  | { readonly type: '_committed'; readonly opId: string }
  | { readonly type: '_rolledBack'; readonly opId: string };

const withoutOp = (pending: readonly PendingOp[], opId: string): readonly PendingOp[] =>
  pending.filter((op) => op.opId !== opId);

export const createTeamBoardStore = (deps: TeamBoardDeps): TeamBoardStore => {
  const { gateway, generateId } = deps;

  const settle =
    (opId: string) =>
    (result: GatewayResult): SettleEvent =>
      result.ok ? { type: '_committed', opId } : { type: '_rolledBack', opId };

  const initial: TeamOverlayState = { pending: [], lastRejection: null, committedRev: 0 };

  const store = createStore({
    context: initial,
    on: {
      cardAdded: (ctx, event: { title: string; column: TeamColumn }, enq) => {
        const opId = generateId();
        const card: OverlayCard = { id: generateId(), title: event.title, column: event.column };
        enq.effect(({ send }) => {
          void gateway
            .addCard({ title: event.title, column: event.column })
            .then((result) => send(settle(opId)(result)));
        });
        return { ...ctx, pending: [...ctx.pending, { opId, kind: 'add', card }] };
      },

      cardMoveRequested: (
        ctx,
        event: {
          cardId: string;
          fromColumn: TeamColumn;
          toColumn: TeamColumn;
          board: readonly Card[];
        },
        enq,
      ) => {
        // Oracle-guard: ask the DERIVED domain machine whether this move is legal
        // BEFORE any optimistic apply or gateway call. A blocked move stops here —
        // it never becomes a pending op and never reaches the server.
        const verdict = evaluateTeamMove(
          event.board,
          { cardId: event.cardId, toColumn: event.toColumn },
          TEAM_WIP_LIMITS,
        );
        if (!verdict.allowed) {
          return {
            ...ctx,
            lastRejection: { cardId: event.cardId, toColumn: event.toColumn, rule: verdict.rule },
          };
        }
        const opId = generateId();
        // The moved card lands at the end of its destination column; the server
        // re-clamps regardless (ADR-0005: clamp raw payload indices at the gateway).
        const toIndex = event.board.filter(
          (card) => card.column === event.toColumn && card.id !== event.cardId,
        ).length;
        enq.effect(({ send }) => {
          void gateway
            .moveCard({ cardId: event.cardId, toColumn: event.toColumn, toIndex })
            .then((result) => send(settle(opId)(result)));
        });
        return {
          ...ctx,
          lastRejection: null,
          pending: [
            ...ctx.pending,
            { opId, kind: 'move', cardId: event.cardId, toColumn: event.toColumn },
          ],
        };
      },

      _committed: (ctx, event: { opId: string }) => ({
        ...ctx,
        pending: withoutOp(ctx.pending, event.opId),
        committedRev: ctx.committedRev + 1,
      }),

      _rolledBack: (ctx, event: { opId: string }) => ({
        ...ctx,
        pending: withoutOp(ctx.pending, event.opId),
      }),
    },
  });

  return {
    send: (event: TeamBoardEvent): void => {
      switch (event.type) {
        case 'refreshRequested':
          return;
        case 'cardAdded':
        case 'cardMoveRequested':
          store.send(event);
          return;
      }
    },
    subscribe: (listener: () => void): (() => void) => {
      const subscription = store.subscribe(() => {
        listener();
      });
      return () => {
        subscription.unsubscribe();
      };
    },
    getState: (): TeamOverlayState => store.getSnapshot().context,
  };
};
