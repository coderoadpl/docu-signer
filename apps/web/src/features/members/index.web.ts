import { actions } from '../../api.js';

import { createMembersCore } from './core/index.js';

export type { MembersEvent } from './core/index.js';

/**
 * Web composition of the members island core — the ONE binding site. The bound
 * server-read descriptor (`actions.members`) and the ensure mutation are injected
 * HERE, so the core stays api-free and DOM-free. The view imports the seam from
 * THIS module, never from core/ or api.ts directly. Direction stays lawful: a
 * feature may import api.ts, but api.ts must not import a feature.
 */
const core = createMembersCore({ descriptors: { list: actions.members } });

export const send = core.send;
export const membersSelectors = core.membersSelectors;
export const ensureMember = actions.ensureMember;
export const ensureMemberInvalidates = actions.ensureMemberInvalidates;
