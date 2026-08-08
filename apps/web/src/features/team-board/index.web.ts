import { actions, teamBoardGateway } from '../../api.js';

import { createTeamBoardCore } from './core/index.js';

export type { TeamBoardEvent, TeamCard, TeamColumns, TeamBoardGateway, GatewayResult, Rejection } from './core/index.js';
export { evaluateTeamMove } from './core/index.js';

/**
 * Web composition of the team-board island core — the ONE binding site. The real
 * gateway (api.ts's structural `teamBoardGateway`, scoped to `board: 'team'`), the
 * bound server-read descriptors (`actions.teamBoard`, `cardsInvalidates`) and the
 * browser id source are injected here, once; the core itself stays api-free and
 * DOM-free (typecheck:islands). Views import the seam from THIS module, never from
 * core/ directly.
 *
 * Direction stays lawful: a feature may import web-api (api.ts), but web-api must
 * not import a feature — the structural `teamBoardGateway` in api.ts exists so the
 * transport is bound without api.ts reaching into the island.
 */
const core = createTeamBoardCore({
  gateway: teamBoardGateway,
  descriptors: { list: actions.teamBoard, invalidates: actions.boardInvalidates },
  generateId: () => crypto.randomUUID(),
});

export const send = core.send;
export const subscribe = core.subscribe;
export const teamBoardSelectors = core.teamBoardSelectors;
