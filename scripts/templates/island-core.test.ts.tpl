import { describe, expect, it } from 'vitest';

import { create__SINGULAR_PASCAL__Core } from './index.js';

/**
 * Core seam test — exercises the __SINGULAR_KEBAB__ island core WITHOUT rendering
 * (no React, plain node), so TUI portability is proven on every `check`. The core
 * is a FACTORY over its deps: this test injects a FAKE server-read descriptor — no
 * api.ts, no network, no DOM. At RUNG 1 `send` is a typed stub, so there is little
 * behavior to assert; this file is the HOME for the machine's unit tests once the
 * island graduates.
 */
const fakeDescriptors = { list: { queryKey: ['__SINGULAR_KEBAB__'] } };

describe('__SINGULAR_KEBAB__ island core', () => {
  it('exposes its read seam as selectors (the injected descriptor threads through)', () => {
    const core = create__SINGULAR_PASCAL__Core({ descriptors: fakeDescriptors });
    expect(core.__SINGULAR_CAMEL__Selectors.list).toBe(fakeDescriptors.list);
  });

  it('accepts the example intent (rung 1: send is a typed stub)', () => {
    const core = create__SINGULAR_PASCAL__Core({ descriptors: fakeDescriptors });
    expect(() => core.send({ type: 'refreshRequested' })).not.toThrow();
  });

  // <<EXTENSION POINT — machine tests>>
  // Rung 2 (island store): assert an intent transitions state and that selectors
  //   read it back — e.g. send(cardMoveRequested) reorders the column.
  // Rung 3 (statechart): assert guards make illegal transitions impossible —
  //   e.g. a move violating a domain rule is rejected and state is unchanged.
  // Build the core with a fake gateway/descriptor and drive it directly here;
  // never render to test the core.
});
