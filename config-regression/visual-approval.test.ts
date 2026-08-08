import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = join(import.meta.dirname, '..', '.github', 'workflows');
const approveVisuals = readFileSync(join(workflowsDir, 'approve-visuals.yml'), 'utf8');
const visualBaselines = readFileSync(join(workflowsDir, 'visual-baselines.yml'), 'utf8');
const ci = readFileSync(join(workflowsDir, 'ci.yml'), 'utf8');

const squashed = approveVisuals.replace(/\s+/g, ' ');

const jobBlock = (workflow: string, job: string): string => {
  const start = workflow.indexOf(`\n  ${job}:\n`);
  if (start < 0) throw new Error(`job ${job} not found`);
  const rest = workflow.slice(start + 1);
  const next = /\n {2}[a-z][a-z0-9-]*:\n/.exec(rest.slice(1));
  return next ? rest.slice(0, next.index + 1) : rest;
};

describe('approve-visuals guard chain', () => {
  it('triggers only on a created comment on a pull request', () => {
    expect(squashed).toContain('issue_comment: types: [created]');
    expect(squashed).toContain('github.event.issue.pull_request != null');
  });

  it('accepts the owner or an explicitly listed approver, and nobody else', () => {
    expect(squashed).toContain("github.event.comment.author_association == 'OWNER'");
    expect(squashed).toContain("fromJSON(vars.VISUAL_APPROVERS || '[]')");
    for (const association of ['COLLABORATOR', 'MEMBER', 'CONTRIBUTOR']) {
      expect(squashed).not.toContain(`author_association == '${association}'`);
    }
  });

  it('creates the write-capable job only after an exact command match', () => {
    expect(squashed).toContain("context.payload.comment.body.trim() === '/approve-visuals'");
    expect(jobBlock(approveVisuals, 'approve-visuals')).toContain('needs: guard');
  });

  it('never interpolates the comment body into a step', () => {
    expect(approveVisuals).not.toMatch(/\$\{\{[^}]*github\.event\.comment\.body/);
  });

  it('refuses a fork head and dispatches the exact-SHA gated baseline run', () => {
    expect(squashed).toContain('steps.pull.outputs.head_repo != github.repository');
    expect(squashed).toContain('visual-baselines.yml/dispatches');
    expect(squashed).toContain('inputs[update]=true');
    expect(squashed).toContain('inputs[commit]=true');
    expect(squashed).toContain('inputs[sha]=${HEAD_SHA}');
  });
});

describe('visual baseline publisher', () => {
  it('rejects commit mode on main and requires update mode on a branch', () => {
    const compact = visualBaselines.replace(/\s+/g, ' ');
    expect(compact).toContain("inputs.commit && (!inputs.update || github.ref_type != 'branch' || github.ref_name == 'main')");
    expect(compact).toContain('git push origin "HEAD:refs/heads/${TARGET_REF}"');
  });
});

describe('visual-report publisher', () => {
  it('holds write scopes and checks out only the trusted base commit', () => {
    const publisher = jobBlock(ci, 'visual-report');
    expect(publisher).toContain('contents: write');
    expect(publisher).toContain('pull-requests: write');
    expect(publisher).toContain('ref: ${{ github.event.pull_request.base.sha }}');
    expect(publisher).not.toMatch(/ref:.*pull_request\.head/);
    expect(publisher).not.toContain('github.event.pull_request.head.sha');
  });

  it('leaves the job that runs pull-request code without elevated permissions', () => {
    expect(jobBlock(ci, 'visual')).not.toContain('permissions:');
  });
});
