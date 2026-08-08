import { createStore } from '@xstate/store';

import { type __SINGULAR_PASCAL__Event } from './events.js';

/**
 * Store — the RUNG 2 machine behind the __SINGULAR_KEBAB__ island seam
 * (@xstate/store; the OWNER'S first choice — its event map IS the seam). Every
 * DOMAIN member of `__SINGULAR_PASCAL__Event` has a matching handler in the `on`
 * map below, so the compiler ties the event contract to the store. Views never
 * import this file — they talk to ./index.ts (`send` in, selectors out); the
 * machine stays swappable behind that boundary.
 *
 * TWO-MACHINES CONTRACT (ADR-0005): this store holds ONLY in-flight optimistic
 * ops, one undo step and a committed-revision counter — NEVER a copy of the item
 * list. The list truth lives in the TanStack cache; `__SINGULAR_CAMEL__ItemsOf`
 * (the merge selector below) lays this overlay on top to render. On reload this
 * state dies; the server list does not. The gateway is INJECTED (this is a factory
 * over its deps) so the core is pure and unit-testable with a fake gateway — no
 * network in a test. This mirrors the living personal board core.
 */

export type GatewayResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

/**
 * The persistence seam for optimistic flows. The store records an intent op in
 * its overlay FIRST (optimistic), then calls the gateway; on failure it drops the
 * op (the merge selector reverts to the server list). Inject a real implementation
 * in ./index.ts (a core/client mutation adapter); inject a fake in tests.
 */
export interface __SINGULAR_PASCAL__Gateway {
  addItem(input: { readonly title: string }): Promise<GatewayResult>;
  moveItem(input: { readonly itemId: string; readonly toIndex: number }): Promise<GatewayResult>;
  removeItem(input: { readonly itemId: string }): Promise<GatewayResult>;
}

export interface __SINGULAR_PASCAL__Deps {
  readonly gateway: __SINGULAR_PASCAL__Gateway;
  readonly generateId: () => string;
}

/** The minimal server-record shape the overlay merges against (from the cache). */
export interface ServerItem {
  readonly id: string;
  readonly title: string;
}

/** A row after merging the server list with the overlay — what the view renders. */
export interface MergedItem {
  readonly id: string;
  readonly title: string;
  /** In-flight optimistic row (added or moved, not yet reconciled with the server). */
  readonly pending: boolean;
}

/** An item the user just typed — client-originated, not a server record copy. */
export interface OverlayItem {
  readonly id: string;
  readonly title: string;
}

/** The single reversible op: how to replay the inverse of the last committed move. */
export interface UndoMove {
  readonly itemId: string;
  readonly toIndex: number;
}

export type PendingOp =
  | { readonly opId: string; readonly kind: 'add'; readonly item: OverlayItem }
  | { readonly opId: string; readonly kind: 'move'; readonly itemId: string; readonly toIndex: number }
  | { readonly opId: string; readonly kind: 'remove'; readonly itemId: string };

export interface __SINGULAR_PASCAL__OverlayState {
  readonly pending: readonly PendingOp[];
  readonly undo: UndoMove | null;
  /** Bumps on every committed persist so the view can invalidate the cache once. */
  readonly committedRev: number;
}

export interface __SINGULAR_PASCAL__Store {
  send(event: __SINGULAR_PASCAL__Event): void;
  subscribe(listener: () => void): () => void;
  getState(): __SINGULAR_PASCAL__OverlayState;
}

// Settlement events travel from the async gateway effect back into the store to
// commit (drop the op, bump the revision, record undo) or roll back (drop the op).
// They are NOT part of __SINGULAR_PASCAL__Event — the public `send` accepts only
// __SINGULAR_PASCAL__Event.
type SettleEvent =
  | { readonly type: '_committed'; readonly opId: string; readonly undo: UndoMove | null }
  | { readonly type: '_rolledBack'; readonly opId: string };

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

const withoutOp = (pending: readonly PendingOp[], opId: string): readonly PendingOp[] =>
  pending.filter((op) => op.opId !== opId);

/**
 * The merge point — the read side of the two-machines contract. Takes the list
 * truth (the cache) and lays the overlay's optimistic ops on top; the store keeps
 * no item copy, the cache keeps no interaction state. Exposed through the seam's
 * selectors in ./index.ts.
 */
export const __SINGULAR_CAMEL__ItemsOf = (
  state: __SINGULAR_PASCAL__OverlayState,
  serverItems: readonly ServerItem[],
): readonly MergedItem[] => {
  let items: MergedItem[] = serverItems.map((item) => ({
    id: item.id,
    title: item.title,
    pending: false,
  }));
  for (const op of state.pending) {
    if (op.kind === 'add') {
      items.push({ id: op.item.id, title: op.item.title, pending: true });
      continue;
    }
    if (op.kind === 'remove') {
      items = items.filter((item) => item.id !== op.itemId);
      continue;
    }
    const from = items.findIndex((item) => item.id === op.itemId);
    if (from === -1) continue;
    const [moved] = items.splice(from, 1);
    if (!moved) continue;
    items.splice(clamp(op.toIndex, 0, items.length), 0, { ...moved, pending: true });
  }
  return items;
};

export const canUndoOf = (state: __SINGULAR_PASCAL__OverlayState): boolean => state.undo !== null;

export const create__SINGULAR_PASCAL__Store = (
  deps: __SINGULAR_PASCAL__Deps,
): __SINGULAR_PASCAL__Store => {
  const { gateway, generateId } = deps;

  const settle =
    (opId: string, commitUndo: UndoMove | null) =>
    (result: GatewayResult): SettleEvent =>
      result.ok
        ? { type: '_committed', opId, undo: commitUndo }
        : { type: '_rolledBack', opId };

  const initial: __SINGULAR_PASCAL__OverlayState = { pending: [], undo: null, committedRev: 0 };

  const store = createStore({
    context: initial,
    on: {
      itemAddRequested: (ctx, event: { title: string }, enq) => {
        const opId = generateId();
        const item: OverlayItem = { id: generateId(), title: event.title };
        // Add is not reversible in this overlay — preserve any existing undo step.
        const keepUndo = ctx.undo;
        enq.effect(({ send }) => {
          void gateway
            .addItem({ title: event.title })
            .then((result) => send(settle(opId, keepUndo)(result)));
        });
        return { ...ctx, pending: [...ctx.pending, { opId, kind: 'add', item }] };
      },

      itemMoveRequested: (
        ctx,
        event: { itemId: string; fromIndex: number; toIndex: number; listSize: number },
        enq,
      ) => {
        // Clamp the raw payload index BEFORE the gateway: a view can send any
        // toIndex, so pin it into [0, list size] HERE and feed the SAME value to
        // both the overlay op and the wire (ADR-0005). One clamp, one place.
        const toIndex = clamp(event.toIndex, 0, event.listSize);
        const opId = generateId();
        const commitUndo: UndoMove = { itemId: event.itemId, toIndex: event.fromIndex };
        enq.effect(({ send }) => {
          void gateway
            .moveItem({ itemId: event.itemId, toIndex })
            .then((result) => send(settle(opId, commitUndo)(result)));
        });
        return {
          ...ctx,
          pending: [...ctx.pending, { opId, kind: 'move', itemId: event.itemId, toIndex }],
        };
      },

      itemRemoveRequested: (ctx, event: { itemId: string }, enq) => {
        const opId = generateId();
        // Remove is not reversible in this overlay — preserve any existing undo.
        const keepUndo = ctx.undo;
        enq.effect(({ send }) => {
          void gateway
            .removeItem({ itemId: event.itemId })
            .then((result) => send(settle(opId, keepUndo)(result)));
        });
        return {
          ...ctx,
          pending: [...ctx.pending, { opId, kind: 'remove', itemId: event.itemId }],
        };
      },

      undoRequested: (ctx, _event: { type: 'undoRequested' }, enq) => {
        const op = ctx.undo;
        if (op === null) return;
        const opId = generateId();
        const toIndex = Math.max(0, op.toIndex);
        enq.effect(({ send }) => {
          void gateway
            .moveItem({ itemId: op.itemId, toIndex })
            .then((result) => send(settle(opId, null)(result)));
        });
        return {
          ...ctx,
          pending: [...ctx.pending, { opId, kind: 'move', itemId: op.itemId, toIndex }],
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
    send: (event: __SINGULAR_PASCAL__Event): void => {
      switch (event.type) {
        case 'refreshRequested':
          // The server-read seam: no client state to mutate (the fresh list comes
          // from core/selectors.ts via TanStack Query; in-flight ops reconcile
          // through their own settlement). Kept as a no-op so the view's `send`
          // call is uniform across rungs.
          return;
        case 'itemAddRequested':
        case 'itemMoveRequested':
        case 'itemRemoveRequested':
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
    getState: (): __SINGULAR_PASCAL__OverlayState => store.getSnapshot().context,
  };
};
