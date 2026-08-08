import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = join(import.meta.dirname, '..', '.github', 'workflows');
const readWorkflow = (name: string): string => readFileSync(join(workflowsDir, name), 'utf8');

describe('workflow code and credential trust boundaries', () => {
  it('keeps the visual render tokenless and authenticates only the guarded push', () => {
    const workflow = readWorkflow('visual-baselines.yml');
    const renderCheckout = workflow.indexOf('ref: ${{ inputs.sha || github.ref }}');
    const tokenlessCheckout = workflow.indexOf('persist-credentials: false', renderCheckout);
    const install = workflow.indexOf('pnpm install --frozen-lockfile');
    const guardedPush = workflow.indexOf('- if: inputs.update && inputs.commit');
    const token = workflow.indexOf('GITHUB_TOKEN: ${{ github.token }}', guardedPush);
    const pushAuth = workflow.indexOf('http.https://github.com/.extraheader=', guardedPush);

    expect(renderCheckout).toBeGreaterThan(-1);
    expect(tokenlessCheckout).toBeGreaterThan(renderCheckout);
    expect(tokenlessCheckout).toBeLessThan(install);
    expect(token).toBeGreaterThan(guardedPush);
    expect(pushAuth).toBeGreaterThan(token);
  });

  it('runs every AI review control script from the trusted base checkout', () => {
    const workflow = readWorkflow('ai-review.yml');

    expect(workflow).toContain('ref: ${{ github.event.pull_request.base.sha }}');
    expect(workflow).toContain('path: .trusted-review');
    expect(workflow).toContain('sparse-checkout: .github/scripts');
    expect(workflow).not.toContain('bash "$GITHUB_WORKSPACE/.github/scripts/');

    for (const script of [
      'classify-review.sh',
      'failure-reason.sh',
      'detect-coldstart.sh',
      'post-review.sh',
      'gate-review.sh',
    ]) {
      expect(workflow).toContain(`bash "$GITHUB_WORKSPACE/.trusted-review/.github/scripts/${script}"`);
    }
  });

  it('proves the production deployment is on main before exposing smoke secrets', () => {
    const workflow = readWorkflow('post-deploy-smoke.yml');
    const mainCheckout = workflow.indexOf('ref: main');
    const ancestry = workflow.indexOf('git merge-base --is-ancestor "$DEPLOY_SHA" origin/main');
    const smoke = workflow.indexOf('pnpm run smoke:remote');
    const firstSecret = workflow.indexOf('SMOKE_EMAIL: ${{ secrets.SMOKE_EMAIL }}');

    expect(mainCheckout).toBeGreaterThan(-1);
    expect(workflow).not.toContain('ref: ${{ github.event.deployment.sha }}');
    expect(ancestry).toBeGreaterThan(mainCheckout);
    expect(smoke).toBeGreaterThan(ancestry);
    expect(firstSecret).toBeGreaterThan(smoke);
  });
});
