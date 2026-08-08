import { describe, expect, it } from 'vitest';

import { createMembersCore } from './index.js';

/**
 * Core seam test — exercises the members island core WITHOUT rendering (no
 * React, plain node), so TUI portability is proven on every `check`. The core is
 * a FACTORY over its deps: this test injects a FAKE server-read descriptor.
 */
const fakeDescriptors = { list: { queryKey: ['members'] } };

describe('members island core', () => {
  it('exposes its read seam as selectors (the injected descriptor threads through)', () => {
    const core = createMembersCore({ descriptors: fakeDescriptors });
    expect(core.membersSelectors.list).toBe(fakeDescriptors.list);
  });

  it('accepts the example intent (rung 1: send is a typed stub)', () => {
    const core = createMembersCore({ descriptors: fakeDescriptors });
    expect(() => core.send({ type: 'refreshRequested' })).not.toThrow();
  });
});
