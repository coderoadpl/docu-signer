import { actions, __SINGULAR_CAMEL__Gateway } from '../../api.js';

import { create__SINGULAR_PASCAL__Core } from './core/index.js';

export type { __SINGULAR_PASCAL__Event, MergedItem, ServerItem } from './core/index.js';

/**
 * Web composition of the __SINGULAR_KEBAB__ island core — the ONE binding site.
 * The real gateway, the bound server-read descriptor and the browser id source
 * are injected HERE, so the core itself stays api-free and DOM-free (it typechecks
 * under tsconfig.islands.json). Views import the seam from THIS module, never from
 * core/ directly.
 *
 * <<EXTENSION POINT — gateway>>
 * The store is optimistic: it needs a gateway that persists each edit (see
 * __SINGULAR_PASCAL__Gateway in core/store.ts). Bind a real one in api.ts (a
 * core/client mutation adapter) and import it here — until `__SINGULAR_CAMEL__Gateway`
 * exists, `pnpm run check` stays RED. See docs/architecture.md §Client application
 * state (ADR-0005).
 */
const core = create__SINGULAR_PASCAL__Core({
  gateway: __SINGULAR_CAMEL__Gateway,
  descriptors: { list: actions.__SINGULAR_CAMEL__ },
  generateId: () => crypto.randomUUID(),
});

export const send = core.send;
export const subscribe = core.subscribe;
export const __SINGULAR_CAMEL__Selectors = core.__SINGULAR_CAMEL__Selectors;
