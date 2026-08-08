import { actions } from '../../api.js';

import { create__SINGULAR_PASCAL__Core } from './core/index.js';

export type { __SINGULAR_PASCAL__Event } from './core/index.js';
export { evaluate__SINGULAR_PASCAL__Move } from './core/index.js';

/**
 * Web composition of the __SINGULAR_KEBAB__ island core — the ONE binding site.
 * The bound server-read descriptor (api.ts's `actions.__SINGULAR_CAMEL__`) is
 * injected HERE, so the core itself stays api-free and DOM-free (it typechecks
 * under tsconfig.islands.json). Views import the seam from THIS module, never from
 * core/ directly. The table-derived oracle is re-exported for the view's
 * disable-illegal-moves reads.
 */
const core = create__SINGULAR_PASCAL__Core({
  descriptors: { list: actions.__SINGULAR_CAMEL__ },
});

export const send = core.send;
export const __SINGULAR_CAMEL__Selectors = core.__SINGULAR_CAMEL__Selectors;
