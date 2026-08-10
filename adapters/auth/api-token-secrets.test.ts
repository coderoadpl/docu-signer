import { describe, expect, it } from 'vitest';

import { createApiTokenSecrets, createInvitationSecrets } from './api-token-secrets.js';

describe('api token secrets', () => {
  it('generates prefixed random token values and hashes them with sha256', () => {
    const secrets = createApiTokenSecrets();
    const left = secrets.generate();
    const right = secrets.generate();
    expect(left).toMatch(/^pat_[A-Za-z0-9_-]+$/);
    expect(right).toMatch(/^pat_[A-Za-z0-9_-]+$/);
    expect(left).not.toBe(right);
    expect(secrets.hash('pat_known')).toBe(
      'ce709c5bc1d723cf2677398ff496ba5077a05fe5aafce374f50a3b8563f25141',
    );
  });

  it('matches only the expected token hash', () => {
    const secrets = createApiTokenSecrets();
    const hash = secrets.hash('pat_known');
    expect(secrets.matchesHash('pat_known', hash)).toBe(true);
    expect(secrets.matchesHash('pat_wrong', hash)).toBe(false);
    expect(secrets.matchesHash('pat_known', 'short')).toBe(false);
  });
});

describe('invitation secrets', () => {
  it('uses 32 random bytes, sha256 at rest, and constant-time matching', () => {
    const secrets = createInvitationSecrets();
    const token = secrets.generate();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(secrets.hash(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(secrets.matchesHash(token, secrets.hash(token))).toBe(true);
    expect(secrets.matchesHash(`${token}x`, secrets.hash(token))).toBe(false);
  });
});
