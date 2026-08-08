import { describe, expect, it } from 'vitest';

import {
  assertHealthAttestation,
  remoteSmokeTargetFromEnv,
  SmokeFailure,
} from './smoke-target.js';

describe('health deploy attestation', () => {
  it('continues when the expected and deployed SHAs match', () => {
    expect(
      assertHealthAttestation('deployed-sha', { expectedSha: 'deployed-sha' }),
    ).toBe('continue');
  });

  it('fails when the deployed SHA differs', () => {
    expect(() =>
      assertHealthAttestation('wrong-sha', { expectedSha: 'expected-sha' }),
    ).toThrow(
      new SmokeFailure(
        'health SHA mismatch: expected expected-sha, deployment reports wrong-sha',
      ),
    );
  });

  it('does not require attestation when expectedSha is missing', () => {
    expect(assertHealthAttestation('any-sha', {})).toBe('continue');
  });

  it('signals the anonymous-only early return after attestation passes', () => {
    expect(
      assertHealthAttestation('deployed-sha', {
        expectedSha: 'deployed-sha',
        anonymousOnly: true,
      }),
    ).toBe('anonymous-only');
  });
});

describe('remote smoke environment wiring', () => {
  it('wires canary credentials, tenant, and expected SHA', () => {
    expect(
      remoteSmokeTargetFromEnv('https://app.example.test', {
        SMOKE_EMAIL: 'canary@example.test',
        SMOKE_PASSWORD: 'secret',
        SMOKE_TENANT: 'archive',
        EXPECTED_SHA: 'deployed-sha',
      }),
    ).toEqual({
      baseUrl: 'https://app.example.test',
      email: 'canary@example.test',
      password: 'secret',
      tenant: 'archive',
      anonymousOnly: false,
      expectedSha: 'deployed-sha',
    });
  });

  it('uses anonymous-only defaults when canary credentials are absent', () => {
    expect(remoteSmokeTargetFromEnv('https://app.example.test', {})).toEqual({
      baseUrl: 'https://app.example.test',
      email: 'demo@agentproofarch.dev',
      password: 'demo1234',
      tenant: 'default',
      anonymousOnly: true,
    });
  });
});
