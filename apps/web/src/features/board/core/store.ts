import { createStore } from '@xstate/store';

import { type BoardEvent } from './events.js';

/**
 * Store — the RUNG 2 machine behind the board island seam (@xstate/store; the
 * owner's first choice, its event map IS the seam). Views never import this file;
 * they talk to ./index.ts (`send` in, selectors out).
 *
 * TWO-MACHINES CONTRACT (ADR-0005): this store holds ONLY in-flight optimistic
 * ops and one undo step — never a copy of the card list. The card-list truth
 * lives in the TanStack cache; core/selectors.ts merges the cache with this
 * overlay to render the board. On reload this state dies; the server list does
 * not. The gateway is INJECTED, so the core is pure and unit-testable with a fake.
 */

export type GatewayResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

export interface BoardGateway {
  addCard(input: { readonly title: string; readonly column: string }): Promise<GatewayResult>;
  moveCard(input: {
    readonly cardId: string;
    readonly toColumn: string;
    readonly toIndex: number;
  }): Promise<GatewayResult>;
}

export interface BoardDeps {
  readonly gateway: BoardGateway;
  readonly generateId: () => string;
}

/** A card the user just typed — client-originated, not a server record copy. */
export interface OverlayCard {
  readonly id: string;
  readonly title: string;
  readonly column: string;
}

/** The single reversible move: where the card sat before its last committed move. */
export interface UndoMove {
  readonly cardId: string;
  readonly toColumn: string;
  readonly toIndex: number;
}

export type PendingOp =
  | { readonly opId: string; readonly kind: 'add'; readonly card: OverlayCard }
  | {
      readonly opId: string;
      readonly kind: 'move';
      readonly cardId: string;
      readonly toColumn: string;
      readonly toIndex: number;
    };

export interface BoardOverlayState {
  readonly pending: readonly PendingOp[];
  readonly undo: UndoMove | null;
  /** Bumps on every committed persist so the view can invalidate the cache once. */
  readonly committedRev: number;
}

export interface BoardStore {
  send(event: BoardEvent): void;
  subscribe(listener: () => void): () => void;
  getState(): BoardOverlayState;
}

// Settlement events travel from the async gateway effect back into the store to
// commit (drop the op, bump the revision, record undo) or roll back (drop the op).
// They are NOT part of BoardEvent — the public `send` accepts only BoardEvent.
type SettleEvent =
  | { readonly type: '_committed'; readonly opId: string; readonly undo: UndoMove | null }
  | { readonly type: '_rolledBack'; readonly opId: string };

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

const withoutOp = (
  pending: readonly PendingOp[],
  opId: string,
): readonly PendingOp[] => pending.filter((op) => op.opId !== opId);

export const createBoardStore = (deps: BoardDeps): BoardStore => {
  const { gateway, generateId } = deps;

  const settle =
    (opId: string, commitUndo: UndoMove | null) =>
    (result: GatewayResult): SettleEvent =>
      result.ok
        ? { type: '_committed', opId, undo: commitUndo }
        : { type: '_rolledBack', opId };

  const initial: BoardOverlayState = { pending: [], undo: null, committedRev: 0 };

  const store = createStore({
    context: initial,
    on: {
      cardAdded: (ctx, event: { title: string; column: string }, enq) => {
        const opId = generateId();
        const card: OverlayCard = { id: generateId(), title: event.title, column: event.column };
        const keepUndo = ctx.undo;
        enq.effect(({ send }) => {
          void gateway
            .addCard({ title: event.title, column: event.column })
            .then((result) => send(settle(opId, keepUndo)(result)));
        });
        return { ...ctx, pending: [...ctx.pending, { opId, kind: 'add', card }] };
      },

      cardMoved: (
        ctx,
        event: {
          cardId: string;
          fromColumn: string;
          fromIndex: number;
          toColumn: string;
          toIndex: number;
          toColumnSize: number;
        },
        enq,
      ) => {
        // Clamp the raw payload index BEFORE the gateway: a view can send any
        // toIndex, so pin it into [0, destination size] here (ADR-0005). One clamp.
        const toIndex = clamp(event.toIndex, 0, event.toColumnSize);
        const opId = generateId();
        const commitUndo: UndoMove = {
          cardId: event.cardId,
          toColumn: event.fromColumn,
          toIndex: event.fromIndex,
        };
        enq.effect(({ send }) => {
          void gateway
            .moveCard({ cardId: event.cardId, toColumn: event.toColumn, toIndex })
            .then((result) => send(settle(opId, commitUndo)(result)));
        });
        return {
          ...ctx,
          pending: [
            ...ctx.pending,
            { opId, kind: 'move', cardId: event.cardId, toColumn: event.toColumn, toIndex },
          ],
        };
      },

      undoRequested: (ctx, _event: { type: 'undoRequested' }, enq) => {
        const op = ctx.undo;
        if (op === null) return;
        const opId = generateId();
        const toIndex = Math.max(0, op.toIndex);
        enq.effect(({ send }) => {
          void gateway
            .moveCard({ cardId: op.cardId, toColumn: op.toColumn, toIndex })
            .then((result) => send(settle(opId, null)(result)));
        });
        return {
          ...ctx,
          pending: [
            ...ctx.pending,
            { opId, kind: 'move', cardId: op.cardId, toColumn: op.toColumn, toIndex },
          ],
        };
      },

      _committed: (ctx, event: { opId: string; undo: UndoMove | null }) => ({
        pending: withoutOp(ctx.pending, event.opId),
        undo: event.undo,
        committedRev: ctx.committedRev + 1,
      }),

      _rolledBack: (ctx, event: { opId: string }) => ({
        ...ctx,
        pending: withoutOp(ctx.pending, event.opId),
      }),
    },
  });

  return {
    send: (event: BoardEvent): void => {
      switch (event.type) {
        case 'refreshRequested':
          return;
        case 'cardAdded':
        case 'cardMoved':
        case 'undoRequested':
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
    getState: (): BoardOverlayState => store.getSnapshot().context,
  };
};
