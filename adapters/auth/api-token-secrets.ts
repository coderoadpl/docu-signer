import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { ApiTokenSecretPort, PadSessionSecretPort } from '#core/server/index.js';

export const createApiTokenSecrets = (): ApiTokenSecretPort => ({
  generate: () => `pat_${randomBytes(32).toString('base64url')}`,
  hash: (value) => createHash('sha256').update(value).digest('hex'),
  matchesHash: (value, tokenHash) => {
    const left = Buffer.from(createHash('sha256').update(value).digest('hex'), 'utf8');
    const right = Buffer.from(tokenHash, 'utf8');
    // WHY: token hashes are secrets-adjacent, so equality must not leak matching prefix length.
    return left.length === right.length && timingSafeEqual(left, right);
  },
});

export const createPadSessionSecrets = (): PadSessionSecretPort => ({
  generate: () => randomBytes(32).toString('base64url'),
  hash: (value) => createHash('sha256').update(value).digest('hex'),
  matchesHash: (value, tokenHash) => {
    const left = Buffer.from(createHash('sha256').update(value).digest('hex'), 'utf8');
    const right = Buffer.from(tokenHash, 'utf8');
    return left.length === right.length && timingSafeEqual(left, right);
  },
});
