import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { ESLint, type Linter } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Behavioral config-regression probes: they prove the lint/depcruise gates still
 * REJECT violations, so a silently-weakened config fails CI rather than passing.
 * Each probe writes a deliberately-illegal fixture into the real tree at a path
 * where the rule applies, runs the real linter, and asserts the specific ruleId
 * fires. All fixtures live under a per-run token dir and are always removed.
 */

const demoRoot = join(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

const token = `__aparch_probe_${process.pid}_${Date.now()}__`;
const coreDir = join('core', 'domain', token);
const featureDir = join('apps', 'web', 'src', 'features', token);
const webDir = join('apps', 'web', 'src', token);
const dcDir = join('core', 'domain', `${token}_dc`);
const featureCoreDir = join('apps', 'web', 'src', 'features', `${token}_core`, 'core');

const SWEEP_BASES = [
  join(demoRoot, 'core', 'domain'),
  join(demoRoot, 'apps', 'web', 'src'),
  join(demoRoot, 'apps', 'web', 'src', 'features'),
];

const sweep = () => {
  for (const base of SWEEP_BASES) {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('__aparch_probe_')) {
        rmSync(join(base, entry.name), { recursive: true, force: true });
      }
    }
  }
};

const fixtures = {
  as: {
    rel: join(coreDir, 'as-probe.ts'),
    content: 'export const forbidden = 1 as number;\n',
  },
  coreImportsAdapters: {
    rel: join(coreDir, 'adapters-probe.ts'),
    content: "import '../../../adapters/db/client.js';\n",
  },
  restrictedImport: {
    rel: join(featureDir, 'axios-probe.ts'),
    content: "import 'axios';\n",
  },
  crossFeature: {
    rel: join(featureDir, 'cross-probe.ts'),
    content: "import '../todos/TodosPage.js';\n",
  },
  queryHook: {
    rel: join(featureDir, 'query-probe.tsx'),
    content:
      "import { useQuery } from '@tanstack/react-query';\n" +
      "import { actions } from '../../api.js';\n" +
      'export const probe = () => useQuery<number>(actions.me);\n',
  },
  sxLayout: {
    rel: join(featureDir, 'sx-probe.tsx'),
    content:
      "import { Box } from '@mui/material';\n" +
      "export const probe = () => <Box sx={{ color: 'red' }} />;\n",
  },
  // setQueryData is banned app-wide (not only in features/): a probe OUTSIDE
  // features/ proves the ban is not scoped to the feature tree.
  setQueryDataOutsideFeatures: {
    rel: join(webDir, 'set-query-data-probe.ts'),
    content:
      'export const write = (qc: { setQueryData: (k: unknown, v: unknown) => void }) =>\n' +
      "  qc.setQueryData(['probe'], 1);\n",
  },
} satisfies Record<string, { rel: string; content: string }>;

const dcFixtures = [
  // react in core/domain fires the framework ban.
  { rel: join(dcDir, 'react-probe.ts'), content: "import 'react';\n" },
  // A non-zod external in core/domain fires the allow-list rule (and NOT the
  // framework deny-list, which does not list @tanstack/query-core).
  { rel: join(dcDir, 'query-core-probe.ts'), content: "import '@tanstack/query-core';\n" },
  // react inside an island core fires the depcruise purity mirror.
  { rel: join(featureCoreDir, 'react-probe.ts'), content: "import 'react';\n" },
] satisfies Array<{ rel: string; content: string }>;

interface EslintMessage {
  ruleId: string | null;
  message: string;
}
interface EslintResult {
  filePath: string;
  messages: EslintMessage[];
}

const messagesByFixture = new Map<string, EslintMessage[]>();
const depcruiseRules = new Set<string>();

const write = (rel: string, content: string) => {
  const abs = join(demoRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  return abs;
};

const findMessage = (fixtureKey: keyof typeof fixtures, ruleId: string): EslintMessage | undefined =>
  (messagesByFixture.get(fixtures[fixtureKey].rel) ?? []).find((m) => m.ruleId === ruleId);

beforeAll(() => {
  sweep();

  const allFixtures = Object.values(fixtures);
  const eslintTargets = allFixtures.map((fixture) => write(fixture.rel, fixture.content));
  for (const fixture of dcFixtures) write(fixture.rel, fixture.content);

  const eslintBin = join(demoRoot, 'node_modules', '.bin', 'eslint');
  const eslintRun = spawnSync(eslintBin, ['--format', 'json', ...eslintTargets], {
    cwd: demoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const eslintResults: EslintResult[] = JSON.parse(eslintRun.stdout);
  for (const result of eslintResults) {
    for (const fixture of allFixtures) {
      if (result.filePath === join(demoRoot, fixture.rel)) {
        messagesByFixture.set(fixture.rel, result.messages);
      }
    }
  }

  const depBin = join(demoRoot, 'node_modules', '.bin', 'depcruise');
  const depRun = spawnSync(depBin, ['--output-type', 'json', dcDir, featureCoreDir], {
    cwd: demoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const depReport: { summary: { violations: Array<{ rule: { name: string } }> } } = JSON.parse(
    depRun.stdout,
  );
  for (const violation of depReport.summary.violations) depcruiseRules.add(violation.rule.name);
}, 60_000);

afterAll(() => {
  rmSync(join(demoRoot, coreDir), { recursive: true, force: true });
  rmSync(join(demoRoot, featureDir), { recursive: true, force: true });
  rmSync(join(demoRoot, webDir), { recursive: true, force: true });
  rmSync(join(demoRoot, dcDir), { recursive: true, force: true });
  rmSync(join(demoRoot, 'apps', 'web', 'src', 'features', `${token}_core`), {
    recursive: true,
    force: true,
  });
  sweep();
});

describe('ESLint gate still rejects violations', () => {
  it('bans `as` type assertions in core (AS_BAN via no-restricted-syntax)', () => {
    const message = findMessage('as', 'no-restricted-syntax');
    expect(message).toBeDefined();
    expect(message?.message).toContain('Type assertions');
  });

  it('bans restricted HTTP imports (axios) in apps/web/src/features', () => {
    expect(findMessage('restrictedImport', 'no-restricted-imports')).toBeDefined();
  });

  it('bans cross-feature imports (boundaries/element-types, features are islands)', () => {
    const message = findMessage('crossFeature', 'boundaries/element-types');
    expect(message).toBeDefined();
    expect(message?.message).toContain('web-features');
  });

  it('bans explicit type arguments on useQuery in a feature (query-hook ban)', () => {
    const message = findMessage('queryHook', 'no-restricted-syntax');
    expect(message).toBeDefined();
    expect(message?.message).toContain('No explicit type arguments');
  });

  it('bans reserved sx keys in a web component (agentproofarch/sx-layout-only)', () => {
    const message = findMessage('sxLayout', 'agentproofarch/sx-layout-only');
    expect(message).toBeDefined();
    expect(message?.message).toContain('color');
  });

  it('bans core importing adapters (boundaries/element-types)', () => {
    const message = findMessage('coreImportsAdapters', 'boundaries/element-types');
    expect(message).toBeDefined();
    expect(message?.message).toContain('core-domain');
  });

  it('bans queryClient.setQueryData OUTSIDE features/ (app-wide, not feature-scoped)', () => {
    const message = findMessage('setQueryDataOutsideFeatures', 'no-restricted-syntax');
    expect(message).toBeDefined();
    expect(message?.message).toContain('optimistic.ts');
  });
});

describe('dependency-cruiser gate still rejects violations', () => {
  it('behavioral: react imported into core fires no-frameworks-in-core', () => {
    expect(depcruiseRules.has('no-frameworks-in-core')).toBe(true);
  });

  it('behavioral: a non-zod external in core/domain fires core-domain-only-zod (allow-list)', () => {
    expect(depcruiseRules.has('core-domain-only-zod')).toBe(true);
  });

  it('behavioral: react in an island core fires island-core-is-framework-agnostic (depcruise mirror)', () => {
    expect(depcruiseRules.has('island-core-is-framework-agnostic')).toBe(true);
  });

  it('structural: every guarded rule is present with severity error', () => {
    const depConfig: { forbidden: Array<{ name: string; severity: string }> } = require(
      join(demoRoot, '.dependency-cruiser.cjs'),
    );
    const byName = new Map(depConfig.forbidden.map((rule) => [rule.name, rule.severity]));
    for (const name of [
      'no-circular',
      'no-frameworks-in-core',
      'core-domain-depends-on-nothing',
      'core-domain-only-zod',
      'core-server-pure',
      'adapters-never-import-apps',
      'web-never-server-side',
      'web-features-are-islands',
      'island-core-is-framework-agnostic',
      'vercel-and-neon-only-in-adapters',
    ]) {
      expect(byName.get(name)).toBe('error');
    }
  });
});

describe('custom plugin rules stay registered as errors', () => {
  const severityOf = (entry: Linter.RuleEntry | undefined): Linter.RuleSeverity | undefined => {
    if (entry === undefined) return undefined;
    if (Array.isArray(entry)) return entry[0];
    return entry;
  };

  it('query-descriptors-only and sx-layout-only are errors on feature files', async () => {
    const eslint = new ESLint({ cwd: demoRoot });
    const config: Linter.Config = await eslint.calculateConfigForFile(
      join('apps', 'web', 'src', 'features', 'todos', 'TodosPage.tsx'),
    );
    const rules = config.rules ?? {};
    expect(severityOf(rules['agentproofarch/query-descriptors-only'])).toBe(2);
    expect(severityOf(rules['agentproofarch/sx-layout-only'])).toBe(2);
  });

  it('sx-layout-baseline.json is empty (no tolerated debt to weaken behind)', () => {
    const baseline: unknown = JSON.parse(
      readFileSync(join(demoRoot, 'eslint-plugin-agentproofarch', 'sx-layout-baseline.json'), 'utf8'),
    );
    expect(baseline).toEqual({});
  });
});
