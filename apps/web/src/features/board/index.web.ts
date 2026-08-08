import { actions, boardGateway } from '../../api.js';

import { createBoardCore } from './core/index.js';

export type { BoardEvent, BoardCard, BoardColumns, BoardGateway, GatewayResult } from './core/index.js';

/**
 * Web composition of the board island core — the ONE binding site. The real
 * gateway (api.ts's structural `boardGateway`), the bound server-read descriptors
 * (`actions.board`, `cardsInvalidates`) and the browser id source are injected
 * here, once; the core itself stays api-free and DOM-free (typecheck:islands).
 * Views import the seam from THIS module, never from core/ directly, and never
 * see a client, a port or an adapter.
 *
 * Direction stays lawful: a feature may import web-api (api.ts), but web-api must
 * not import a feature — the structural `boardGateway` in api.ts exists precisely
 * so the transport is bound without api.ts reaching into the island.
 */
const core = createBoardCore({
  gateway: boardGateway,
  descriptors: { list: actions.board, invalidates: actions.boardInvalidates },
  generateId: () => crypto.randomUUID(),
});

export const send = core.send;
export const subscribe = core.subscribe;
export const boardSelectors = core.boardSelectors;
