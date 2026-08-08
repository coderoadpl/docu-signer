import type { MembersEvent } from './events.js';
import { membersSelectorsOf, type MembersDescriptors } from './selectors.js';

export type { MembersEvent } from './events.js';
export type { MembersDescriptors } from './selectors.js';

/**
 * Public seam of the members island core: `send` in, selectors out. A view
 * imports ONLY the composed seam (features/members/index.web.ts) — never a
 * store, a descriptor or api.ts — so the machine behind the seam stays
 * invisible and swappable (ADR-0005). PORTABLE BY CONSTRUCTION: this module
 * imports no api.ts and no DOM; it is a FACTORY the web composition injects the
 * bound descriptor into once.
 *
 * RUNG 1 has no client machine, so `send` is a typed, exhaustive stub. The
 * trigger to graduate: an intent that needs state which outlives a render or
 * coordinates several views. Staff writes (ensure) go through the mutation
 * descriptor in the view (invalidation → refetch), not through `send`.
 */
export interface MembersCoreDeps<TList> {
  readonly descriptors: MembersDescriptors<TList>;
}

export interface MembersCore<TList> {
  send(event: MembersEvent): void;
  readonly membersSelectors: { readonly list: TList };
}

export const createMembersCore = <TList>(
  deps: MembersCoreDeps<TList>,
): MembersCore<TList> => ({
  send: (event) => {
    switch (event.type) {
      case 'refreshRequested':
        // Rung 1: no client state to change yet — graduate to a store when an
        // intent must outlive a render or coordinate multiple views.
        break;
    }
  },
  membersSelectors: membersSelectorsOf(deps.descriptors),
});
