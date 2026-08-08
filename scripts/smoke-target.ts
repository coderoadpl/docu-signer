export class SmokeFailure extends Error {}

export function assertSmoke(condition: boolean, message: string): asserts condition {
  if (!condition) throw new SmokeFailure(message);
}

export interface AttestedSmokeTarget {
  baseUrl: string;
  email: string;
  password: string;
  tenant: string;
  expectedSha?: string;
  anonymousOnly?: boolean;
}

export const assertHealthAttestation = (
  healthSha: string,
  target: Pick<AttestedSmokeTarget, 'expectedSha' | 'anonymousOnly'>,
): 'continue' | 'anonymous-only' => {
  if (target.expectedSha !== undefined) {
    assertSmoke(
      healthSha === target.expectedSha,
      `health SHA mismatch: expected ${target.expectedSha}, deployment reports ${healthSha}`,
    );
  }
  return target.anonymousOnly === true ? 'anonymous-only' : 'continue';
};

export const remoteSmokeTargetFromEnv = (
  baseUrl: string,
  env: NodeJS.ProcessEnv,
): AttestedSmokeTarget => {
  const smokeEmail = env['SMOKE_EMAIL'];
  const anonymousOnly = smokeEmail === undefined || smokeEmail === '';
  const expectedSha = env['EXPECTED_SHA'] || undefined;
  return {
    baseUrl,
    email: anonymousOnly ? 'demo@agentproofarch.dev' : smokeEmail,
    password: env['SMOKE_PASSWORD'] || 'demo1234',
    tenant: env['SMOKE_TENANT'] || 'default',
    anonymousOnly,
    ...(expectedSha ? { expectedSha } : {}),
  };
};
