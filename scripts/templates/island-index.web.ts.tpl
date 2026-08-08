import { actions } from '../../api.js';

import { create__SINGULAR_PASCAL__Core } from './core/index.js';

export type { __SINGULAR_PASCAL__Event } from './core/index.js';

/**
 * Web composition of the __SINGULAR_KEBAB__ island core — the ONE binding site.
 * The bound server-read descriptor (api.ts's `actions.__SINGULAR_CAMEL__`) is
 * injected HERE, so the core itself stays api-free and DOM-free (it typechecks
 * under tsconfig.islands.json). Views import the seam from THIS module, never
 * from core/ directly, and never see a client, a port or an adapter.
 *
 * Direction stays lawful: a feature may import web-api (api.ts), but web-api must
 * not import a feature — bound descriptors flow one way, into the island.
 */
const core = create__SINGULAR_PASCAL__Core({
  descriptors: { list: actions.__SINGULAR_CAMEL__ },
});

export const send = core.send;
export const __SINGULAR_CAMEL__Selectors = core.__SINGULAR_CAMEL__Selectors;
