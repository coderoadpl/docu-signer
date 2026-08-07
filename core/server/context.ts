import type { Identity } from '#core/domain/index.js';

/** Every tenant-scoped use-case takes this as its first argument. */
export interface Ctx {
  identity: Identity;
}
