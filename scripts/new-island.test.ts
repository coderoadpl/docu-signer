import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import * as ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generateIsland } from './new-island.js';
import { ResourceNameError } from './new-resource.js';

const demoRoot = join(import.meta.dirname, '..');

let sandbox: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'new-island-'));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const parses = (fileName: string, contents: string): readonly ts.Diagnostic[] => {
  const result = ts.transpileModule(contents, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
      ...(fileName.endsWith('.tsx') ? { jsx: ts.JsxEmit.Preserve } : {}),
    },
  });
  return result.diagnostics ?? [];
};

const contentsOf = (files: readonly { path: string; contents: string }[], suffix: string): string =>
  files.find((file) => file.path.endsWith(suffix))?.contents ?? '';

describe('generateIsland', () => {
  it('renders every island file with valid, fully-substituted TypeScript', () => {
    const result = generateIsland({ name: 'personal-board', outDir: sandbox, repoRoot: sandbox });

    expect(result.files.map((file) => file.path)).toEqual([
      'apps/web/src/features/personal-board/core/events.ts',
      'apps/web/src/features/personal-board/core/selectors.ts',
      'apps/web/src/features/personal-board/core/index.ts',
      'apps/web/src/features/personal-board/core/personal-board.test.ts',
      'apps/web/src/features/personal-board/index.web.ts',
      'apps/web/src/features/personal-board/PersonalBoardPage.tsx',
      'apps/web/src/routes/personal-board.tsx',
    ]);

    for (const file of result.files) {
      const written = readFileSync(join(sandbox, file.path), 'utf8');
      expect(written).toBe(file.contents);
      expect(written).not.toMatch(/__[A-Z_]+__/);
      const diagnostics = parses(file.path, written).filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      );
      expect(diagnostics, `${file.path} should parse without syntax errors`).toEqual([]);
    }
  });

  it('generates the events-in / selectors-out seam a view talks to', () => {
    const { files } = generateIsland({
      name: 'team-board',
      outDir: sandbox,
      repoRoot: sandbox,
      dryRun: true,
    });

    expect(contentsOf(files, 'core/events.ts')).toContain('export type TeamBoardEvent');
    expect(contentsOf(files, 'core/events.ts')).toContain("type: 'refreshRequested'");
    // The core is a portable FACTORY — no api.ts — and selectors.ts is a pure
    // descriptor builder injected by the web composition.
    expect(contentsOf(files, 'core/selectors.ts')).toContain('export const teamBoardSelectorsOf');
    expect(contentsOf(files, 'core/selectors.ts')).not.toContain('api.js');
    expect(contentsOf(files, 'core/index.ts')).toContain('export const createTeamBoardCore');
    expect(contentsOf(files, 'core/index.ts')).toContain('teamBoardSelectors');
    expect(contentsOf(files, 'core/index.ts')).not.toContain('api.js');
    // The web composition (index.web.ts) is the ONE site that binds the core to
    // api.ts; it exposes the send/selectors seam the view consumes.
    const webBinding = contentsOf(files, 'index.web.ts');
    expect(webBinding).toContain("from '../../api.js'");
    expect(webBinding).toContain('createTeamBoardCore');
    expect(webBinding).toContain('export const send');
    expect(webBinding).toContain('actions.teamBoard');
    // The view talks only to the island seam (index.web.ts), never api.ts directly.
    const page = contentsOf(files, 'TeamBoardPage.tsx');
    expect(page).toContain("from './index.web.js'");
    expect(page).toContain("send({ type: 'refreshRequested' })");
    expect(page).not.toContain('api.js');
  });

  it('emits a checklist that wires shared files, stays RED, and routes graduation through --machine', () => {
    const { checklist } = generateIsland({
      name: 'gadget-board',
      outDir: sandbox,
      repoRoot: sandbox,
      dryRun: true,
    });
    expect(checklist).toContain('pnpm run check` will stay RED');
    expect(checklist).toContain('apps/web/src/api.ts');
    expect(checklist).toContain('apps/web/src/main.tsx');
    // The generated web composition is named as the one binding site.
    expect(checklist).toContain('index.web.ts');
    expect(checklist).toContain('WEB COMPOSITION');
    expect(checklist).toContain('rung 2 = island store');
    expect(checklist).toContain('RESOLVED (ADR-0005)');
    expect(checklist).toContain('--machine=store');
    expect(checklist).not.toContain('DECISION-PENDING');
    expect(checklist).toContain('pnpm run check && pnpm run smoke');
  });

  it('scaffolds a rung-2 store island and every file parses', () => {
    const result = generateIsland({
      name: 'kanban-board',
      outDir: sandbox,
      repoRoot: sandbox,
      machine: 'store',
    });

    expect(result.files.map((file) => file.path)).toEqual([
      'apps/web/src/features/kanban-board/core/events.ts',
      'apps/web/src/features/kanban-board/core/selectors.ts',
      'apps/web/src/features/kanban-board/core/store.ts',
      'apps/web/src/features/kanban-board/core/index.ts',
      'apps/web/src/features/kanban-board/core/kanban-board.test.ts',
      'apps/web/src/features/kanban-board/index.web.ts',
      'apps/web/src/features/kanban-board/KanbanBoardPage.tsx',
      'apps/web/src/routes/kanban-board.tsx',
    ]);

    for (const file of result.files) {
      const written = readFileSync(join(sandbox, file.path), 'utf8');
      expect(written).not.toMatch(/__[A-Z_]+__/);
      const diagnostics = parses(file.path, written).filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      );
      expect(diagnostics, `${file.path} should parse without syntax errors`).toEqual([]);
    }

    const store = contentsOf(result.files, 'core/store.ts');
    // The @xstate/store `on` map IS the seam: a handler per domain event.
    expect(store).toContain("import { createStore } from '@xstate/store'");
    expect(store).toContain('export const createKanbanBoardStore');
    expect(store).toContain('itemAddRequested:');
    expect(store).toContain('export interface KanbanBoardGateway');
    // OVERLAY / intent-only (ADR-0005, mirrors the living board): the store holds
    // pending ops + a single undo + a committed-revision counter, never a copy of
    // the item list. The merge selector lays the overlay over the cache truth.
    expect(store).toContain('readonly pending: readonly PendingOp[]');
    expect(store).toContain('readonly committedRev: number');
    expect(store).toContain('export const kanbanBoardItemsOf');
    expect(store).toContain('getState(): KanbanBoardOverlayState');
    // No server-items copy: the store context never carries an items array.
    expect(store).not.toContain('items: readonly');
    // The toIndex-clamp finding: one shared clamp, and the SAME clamped value
    // feeds both the overlay op and the gateway (no raw payload on the wire).
    expect(store).toContain('const clamp');
    expect(store).toContain('Math.max(min, Math.min(value, max))');
    expect(store).toContain('.moveItem({ itemId: event.itemId, toIndex })');
    expect(store).not.toContain('toIndex: event.toIndex');
    // Events mirror the store handlers; the move carries what an overlay needs.
    expect(contentsOf(result.files, 'core/events.ts')).toContain("type: 'itemAddRequested'");
    expect(contentsOf(result.files, 'core/events.ts')).toContain('listSize: number');
    // The core factory forwards send to the store and merges its selectors over
    // the cache; it imports NO api.ts (portable).
    const index = contentsOf(result.files, 'core/index.ts');
    expect(index).toContain('createKanbanBoardStore');
    expect(index).toContain('store.send(event)');
    expect(index).toContain('kanbanBoardItemsOf');
    expect(index).toContain('export const createKanbanBoardCore');
    expect(index).not.toContain('api.js');
    // The web composition injects gateway + descriptor + id source and exposes the
    // subscribe seam the view feeds to useSyncExternalStore.
    const webBinding = contentsOf(result.files, 'index.web.ts');
    expect(webBinding).toContain('createKanbanBoardCore');
    expect(webBinding).toContain('kanbanBoardGateway');
    expect(webBinding).toContain('export const subscribe');
    expect(webBinding).toContain('crypto.randomUUID()');
    // The store test drives BOTH the public factory and the store with a fake
    // gateway and merges the overlay.
    expect(contentsOf(result.files, 'core/kanban-board.test.ts')).toContain(
      'createKanbanBoardCore',
    );
    expect(contentsOf(result.files, 'core/kanban-board.test.ts')).toContain(
      'createKanbanBoardStore',
    );
    expect(contentsOf(result.files, 'core/kanban-board.test.ts')).toContain('kanbanBoardItemsOf');

    expect(result.checklist).toContain('RUNG 2');
    expect(result.checklist).toContain('@xstate/store');
    expect(result.checklist).toContain('GATEWAY');
  });

  it('scaffolds a rung-3 statechart island (default --rules=domain) and every file parses', () => {
    const result = generateIsland({
      name: 'release-flow',
      outDir: sandbox,
      repoRoot: sandbox,
      machine: 'statechart',
    });

    // DEFAULT rules=domain: the table lives in the SHARED core/domain, not the island.
    expect(result.files.map((file) => file.path)).toEqual([
      'apps/web/src/features/release-flow/core/events.ts',
      'apps/web/src/features/release-flow/core/selectors.ts',
      'core/domain/release-flow-rules.ts',
      'apps/web/src/features/release-flow/core/machine.ts',
      'apps/web/src/features/release-flow/core/index.ts',
      'apps/web/src/features/release-flow/core/release-flow.test.ts',
      'apps/web/src/features/release-flow/core/rules.drift.test.ts',
      'apps/web/src/features/release-flow/index.web.ts',
      'apps/web/src/features/release-flow/ReleaseFlowPage.tsx',
      'apps/web/src/routes/release-flow.tsx',
    ]);

    for (const file of result.files) {
      const written = readFileSync(join(sandbox, file.path), 'utf8');
      expect(written).not.toMatch(/__[A-Z_]+__/);
      const diagnostics = parses(file.path, written).filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      );
      expect(diagnostics, `${file.path} should parse without syntax errors`).toEqual([]);
    }

    // rules = transition-table-as-data with exhaustive Records, in core/domain.
    const rules = contentsOf(result.files, 'core/domain/release-flow-rules.ts');
    expect(rules).toContain('export const guards: Readonly<Record<GuardId, GuardPredicate>>');
    expect(rules).toContain('export const transitionTable: Readonly<Record<Phase, readonly GuardId[]>>');
    expect(rules).toContain('export const canApplyReleaseFlowMove');
    // Domain mode: the server-shares-the-table claim is TRUE and stated.
    expect(rules).toContain('core/domain');
    expect(rules).toContain('core/server');
    // machine.ts = the derivation generator; imports the SHARED core/domain table.
    const machineFile = contentsOf(result.files, 'core/machine.ts');
    expect(machineFile).toContain("from '#core/domain/release-flow-rules.js'");
    expect(machineFile).toContain('const eventCarrier: MachineEvent = moveEventByPhase.draft');
    expect(machineFile).toContain('export const evaluateReleaseFlowMove');
    expect(machineFile).toContain('throw new Error(`machine produced no verdict');
    // drift test = property test incl. the WIP=1 edge, over the shared table.
    const drift = contentsOf(result.files, 'core/rules.drift.test.ts');
    expect(drift).toContain("from '#core/domain/release-flow-rules.js'");
    expect(drift).toContain('evaluateReleaseFlowMove');
    expect(drift).toContain('canApplyReleaseFlowMove');
    expect(drift).toContain('WIP=1');
    // The drift-proof ships an EXECUTABLE planted mutant (not a comment): a
    // hand-written machine that drops a guard, asserted to be caught by `disagree`.
    expect(drift).toContain('driftedMachine');
    expect(drift).toContain('planted');
    expect(drift).not.toContain('EXTENSION POINT');
    // index.ts carries the oracle-guard usage comment and re-exports the oracle.
    const index = contentsOf(result.files, 'core/index.ts');
    expect(index).toContain('ORACLE-GUARD USAGE');
    expect(index).toContain('evaluateReleaseFlowMove');

    expect(result.checklist).toContain('RUNG 3');
    expect(result.checklist).toContain('drift');
    // Domain checklist routes the shared-table export through core/domain/index.ts.
    expect(result.checklist).toContain('RULES EXPORT');
    expect(result.checklist).toContain('core/domain/index.ts');
    expect(result.checklist).toContain("export * from './release-flow-rules.js';");
  });

  it('scaffolds a rung-3 statechart island with --rules=local (island-local table, no server claim)', () => {
    const result = generateIsland({
      name: 'draft-flow',
      outDir: sandbox,
      repoRoot: sandbox,
      machine: 'statechart',
      rules: 'local',
    });

    // LOCAL rules: the table stays inside the island (core/rules.ts), not core/domain.
    expect(result.files.map((file) => file.path)).toEqual([
      'apps/web/src/features/draft-flow/core/events.ts',
      'apps/web/src/features/draft-flow/core/selectors.ts',
      'apps/web/src/features/draft-flow/core/rules.ts',
      'apps/web/src/features/draft-flow/core/machine.ts',
      'apps/web/src/features/draft-flow/core/index.ts',
      'apps/web/src/features/draft-flow/core/draft-flow.test.ts',
      'apps/web/src/features/draft-flow/core/rules.drift.test.ts',
      'apps/web/src/features/draft-flow/index.web.ts',
      'apps/web/src/features/draft-flow/DraftFlowPage.tsx',
      'apps/web/src/routes/draft-flow.tsx',
    ]);

    for (const file of result.files) {
      const written = readFileSync(join(sandbox, file.path), 'utf8');
      expect(written).not.toMatch(/__[A-Z_]+__/);
      const diagnostics = parses(file.path, written).filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      );
      expect(diagnostics, `${file.path} should parse without syntax errors`).toEqual([]);
    }

    // The machine imports the island-local table, not core/domain.
    const machineFile = contentsOf(result.files, 'core/machine.ts');
    expect(machineFile).toContain("from './rules.js'");
    expect(machineFile).not.toContain('#core/domain/');
    // The misleading server-check comment is GONE: local rules never feed the server.
    const rules = contentsOf(result.files, 'core/rules.ts');
    expect(rules).toContain('CLIENT-ONLY');
    expect(rules).not.toContain('core/server use-case');
    // The checklist is honest about the client-only scope and offers the upgrade.
    expect(result.checklist).toContain('CLIENT-ONLY');
    expect(result.checklist).toContain('--rules=domain');
    expect(result.checklist).not.toContain('core/domain/index.ts');
  });

  it('defaults to rung 1 (no machine) when --machine is omitted', () => {
    const withoutFlag = generateIsland({
      name: 'plain-board',
      outDir: sandbox,
      repoRoot: sandbox,
      dryRun: true,
    });
    const explicitNone = generateIsland({
      name: 'plain-board',
      outDir: sandbox,
      repoRoot: sandbox,
      machine: 'none',
      dryRun: true,
    });
    const paths = withoutFlag.files.map((file) => file.path);
    expect(paths).toEqual(explicitNone.files.map((file) => file.path));
    expect(paths).not.toContain('apps/web/src/features/plain-board/core/store.ts');
    expect(paths).not.toContain('apps/web/src/features/plain-board/core/rules.ts');
    expect(withoutFlag.checklist).toContain('RESOLVED (ADR-0005)');
  });

  it('does not write files in dry-run mode', () => {
    generateIsland({ name: 'sprocket-board', outDir: sandbox, repoRoot: sandbox, dryRun: true });
    expect(() =>
      readFileSync(join(sandbox, 'apps/web/src/features/sprocket-board/core/index.ts'), 'utf8'),
    ).toThrow();
  });

  it('rejects non-kebab and empty names', () => {
    for (const bad of ['PersonalBoard', 'personal_board', '', '-board', 'board-']) {
      expect(() =>
        generateIsland({ name: bad, outDir: sandbox, repoRoot: sandbox, dryRun: true }),
      ).toThrow(ResourceNameError);
    }
  });

  it('refuses reserved island names that collide with existing features', () => {
    expect(() => generateIsland({ name: 'todos', outDir: sandbox, repoRoot: demoRoot })).toThrow(
      ResourceNameError,
    );
  });

  it('refuses to overwrite an existing file', () => {
    const collidingRoot = mkdtempSync(join(tmpdir(), 'new-island-collide-'));
    try {
      const indexFile = join(collidingRoot, 'apps/web/src/features/widget-board/core/index.ts');
      mkdirSync(dirname(indexFile), { recursive: true });
      writeFileSync(indexFile, 'export const send = () => {};\n');
      expect(() =>
        generateIsland({ name: 'widget-board', outDir: collidingRoot, repoRoot: collidingRoot }),
      ).toThrow(ResourceNameError);
    } finally {
      rmSync(collidingRoot, { recursive: true, force: true });
    }
  });
});
