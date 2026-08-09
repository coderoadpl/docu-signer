import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import {
  deploySeedEnvSchema,
  backupEnvSchema,
  observabilityEnvSchema,
  seedEnvSchema,
  serverEnvSchema,
} from '#core/server/config.js';

import { lintMigrations } from './migration-lint.js';

/**
 * Doc-lint: keeps docs and enforcer configuration honest in both directions
 * (ADR-0004 §Decision 4). It is deliberately a plain script, not a framework.
 *
 *   docs -> config: every enforcer the docs promise must still exist in
 *     eslint.config.js / .dependency-cruiser.cjs.
 *   config -> docs: every custom rule in eslint-plugin-agentproofarch/rules
 *     must be documented by name.
 *   counts:         numeric claims use invisible tokens verified against source;
 *     a required-token manifest prevents deleting the verification wrapper.
 *   env schema:     config keys and `.env.example` keys match in both
 *     directions.
 *   links:          every relative link in a tracked `.md` resolves to a file.
 *   delimiters:     no tool/XML delimiter leaks into committed prose.
 */

const repoRoot = join(import.meta.dirname, '..');
const docsRoot = join(repoRoot, 'docs');
const require = createRequire(import.meta.url);

/**
 * Tool/XML delimiters that must never survive into committed prose (round-1
 * audit C1: `</content>`/`</invoke>` leaked into the tails of several READMEs).
 */
const LEAKED_DELIMITERS = ['</content>', '</invoke>'];

const eslintConfigPath = join(repoRoot, 'eslint.config.js');
const depcruiseConfigPath = join(repoRoot, '.dependency-cruiser.cjs');
const rulesDir = join(repoRoot, 'eslint-plugin-agentproofarch', 'rules');

type ConfigTarget = 'eslint' | 'depcruise';

interface Enforcer {
  readonly id: string;
  readonly config: ConfigTarget;
  readonly doc: string;
}

/**
 * Enforcers the prose promises but does not spell as a literal rule id. Extend
 * this when the docs make a new enforcement promise; remove an entry only when
 * the docs stop promising it.
 */
const DOC_PROMISED_ENFORCERS: readonly Enforcer[] = [
  { id: 'boundaries/element-types', config: 'eslint', doc: 'architecture.md §Principles' },
  { id: '@typescript-eslint/no-explicit-any', config: 'eslint', doc: 'architecture.md §Layers' },
  { id: 'no-restricted-syntax', config: 'eslint', doc: 'architecture.md §Layers' },
  { id: 'boundaries/external', config: 'eslint', doc: 'frontend-lint-plan.md §Phase 2' },
  { id: 'vercel-and-neon-only-in-adapters', config: 'depcruise', doc: 'architecture.md §Layers' },
  { id: 'no-frameworks-in-core', config: 'depcruise', doc: 'architecture.md §Layers' },
  { id: 'core-domain-depends-on-nothing', config: 'depcruise', doc: 'architecture.md §Layers' },
  { id: 'web-features-are-islands', config: 'depcruise', doc: 'architecture.md §Frontend' },
  {
    id: 'web-layouts-are-structure-only',
    config: 'depcruise',
    doc: 'architecture.md §Frontend',
  },
];

interface DocFile {
  readonly rel: string;
  readonly text: string;
}

const collectDocs = (dir: string): DocFile[] => {
  const docs: DocFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      docs.push(...collectDocs(full));
    } else if (entry.name.endsWith('.md')) {
      docs.push({ rel: relative(repoRoot, full), text: readFileSync(full, 'utf8') });
    }
  }
  return docs;
};

const backtickTokens = (text: string): string[] => {
  const tokens: string[] = [];
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    const token = match[1];
    if (token !== undefined) tokens.push(token);
  }
  return tokens;
};

/** Root/demo READMEs and CLAUDE files count as documentation surfaces too (F6). */
const extraSurfaceRels = ['README.md', 'CLAUDE.md'];
const extraSurfaces: DocFile[] = extraSurfaceRels
  .filter((rel) => existsSync(join(repoRoot, rel)))
  .map((rel) => ({ rel, text: readFileSync(join(repoRoot, rel), 'utf8') }));

const proseSurfaces = [...collectDocs(docsRoot), ...extraSurfaces];
const proseCombined = proseSurfaces.map((doc) => doc.text).join('\n');

const eslintSource = readFileSync(eslintConfigPath, 'utf8');
const depcruiseModule: { forbidden: ReadonlyArray<{ name: string }> } = require(depcruiseConfigPath);
const depcruiseRuleNames = new Set(depcruiseModule.forbidden.map((rule) => rule.name));

const configHasId = (id: string, target: ConfigTarget): boolean =>
  target === 'eslint' ? eslintSource.includes(id) : depcruiseRuleNames.has(id);

const configFileFor = (target: ConfigTarget): string =>
  target === 'eslint' ? 'eslint.config.js' : '.dependency-cruiser.cjs';

const problems: string[] = [];

const trackedMarkdown = execFileSync('git', ['ls-files', '-z', '*.md'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\0')
  .filter((entry) => entry.length > 0);

// ── Leaked-delimiter check: every git-tracked `.md`. ────────────────────────
for (const rel of trackedMarkdown) {
  const text = readFileSync(join(repoRoot, rel), 'utf8');
  for (const delimiter of LEAKED_DELIMITERS) {
    if (text.includes(delimiter)) {
      problems.push(`[delimiter] "${delimiter}" leaked into ${rel} — delete the stray tool/XML tag.`);
    }
  }
}

// ── docs -> config: backticked custom-plugin rule ids spelt literally. ──────
const CUSTOM_RULE_ID = /^agentproofarch\/[a-z][a-z0-9-]*$/;
for (const doc of proseSurfaces) {
  for (const token of backtickTokens(doc.text)) {
    if (!CUSTOM_RULE_ID.test(token)) continue;
    if (!eslintSource.includes(token)) {
      problems.push(
        `[docs->config] "${token}" (${doc.rel}) is promised but absent from eslint.config.js — ` +
          `restore the rule or stop naming it.`,
      );
    }
  }
}

// ── docs -> config: the explicit manifest of prose-promised enforcers. ──────
for (const enforcer of DOC_PROMISED_ENFORCERS) {
  if (!configHasId(enforcer.id, enforcer.config)) {
    problems.push(
      `[docs->config] "${enforcer.id}" (${enforcer.doc}) is absent from ` +
        `${configFileFor(enforcer.config)} — restore it or stop promising it.`,
    );
  }
}

// ── config -> docs: every custom rule file documented by name somewhere. ────
const ruleFiles = readdirSync(rulesDir).filter(
  (name) => name.endsWith('.js') && !name.endsWith('.test.js'),
);
for (const file of ruleFiles) {
  const ruleName = basename(file, '.js');
  if (!proseCombined.includes(ruleName)) {
    problems.push(
      `[config->docs] rule "${ruleName}" (eslint-plugin-agentproofarch/rules/${file}) is ` +
        `undocumented — name it in the docs or the READMEs, or remove the rule.`,
    );
  }
}

// ── Injected counts: verify `<!--count:NAME-->N<!--/count-->` against source. ─
// Files, not individual it()/test() calls, are the stable unit for the total
// (scaffolder tests embed literal `it(` inside template strings, so a call-level
// count would over-report); the small, dynamic-free suites (e2e/integration/
// config-regression) are counted by declaration because their dirs hold no
// generated tests. Counting reads the working tree — exactly what vitest runs.
const TEST_DECL = /^[ \t]*(it|test)(\.(skip|only|todo|fails|fixme|concurrent|each))?\(/gm;

const walkTestFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walkTestFiles(full));
    } else if (/\.test\.(ts|tsx|js)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
};

const filesIn = (rel: string, suffix: string): string[] => {
  const dir = join(repoRoot, rel);
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith(suffix))
        .map((name) => join(dir, name))
    : [];
};

const countDecls = (files: readonly string[]): number =>
  files.reduce((total, file) => total + (readFileSync(file, 'utf8').match(TEST_DECL)?.length ?? 0), 0);

const defaultRunTestFiles = (): string[] =>
  ['core', 'adapters', 'apps', 'scripts', 'config-regression', 'eslint-plugin-agentproofarch']
    .flatMap((root) => (existsSync(join(repoRoot, root)) ? walkTestFiles(join(repoRoot, root)) : []))
    .filter((file) => !file.endsWith('.integration.test.ts'));

const e2eSpecFiles = (): string[] => filesIn('e2e', '.spec.ts');
const integrationFiles = (): string[] =>
  ['adapters', 'apps']
    .flatMap((root) => (existsSync(join(repoRoot, root)) ? walkTestFiles(join(repoRoot, root)) : []))
    .filter((file) => file.endsWith('.integration.test.ts'));
const configRegressionFiles = (): string[] => filesIn('config-regression', '.test.ts');
const cliCommandGroups = (): number => {
  const source = readFileSync(join(repoRoot, 'apps/cli/src/main.ts'), 'utf8');
  const names = [...source.matchAll(/\bprogram\s*\.\s*command\(\s*'([^' <]+)/g)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
  return new Set(names).size;
};

const COUNTERS: Record<string, () => number> = {
  'test-files': () => defaultRunTestFiles().length,
  'e2e-specs': () => e2eSpecFiles().length,
  'e2e-tests': () => countDecls(e2eSpecFiles()),
  'integration-tests': () => countDecls(integrationFiles()),
  'config-regression': () => countDecls(configRegressionFiles()),
  'cli-command-groups': cliCommandGroups,
};

const COUNT_TOKEN_SYNTAXES: readonly RegExp[] = [
  /<!--count:([a-z0-9-]+)-->(\d+)<!--\/count-->/g,
  /\{\/\*count:([a-z0-9-]+)\*\/\}(\d+)\{\/\*\/count\*\/\}/g,
];

const ALL_COUNTERS = [
  'test-files',
  'integration-tests',
  'e2e-tests',
  'e2e-specs',
  'config-regression',
  'cli-command-groups',
] as const;
const REQUIRED_COUNT_TOKENS: Readonly<Record<string, readonly string[]>> = {
  'README.md': ALL_COUNTERS,
};

let countTokensSeen = 0;
const countersByFile = new Map<string, Set<string>>();
for (const rel of trackedMarkdown) {
  const text = readFileSync(join(repoRoot, rel), 'utf8');
  const seenHere = new Set<string>();
  countersByFile.set(rel, seenHere);
  for (const syntax of COUNT_TOKEN_SYNTAXES) {
    for (const match of text.matchAll(syntax)) {
      countTokensSeen += 1;
      const name = match[1] ?? '';
      const claimed = Number(match[2]);
      const counter = COUNTERS[name];
      if (!counter) {
        problems.push(`[count] unknown counter "${name}" in ${rel} — valid: ${Object.keys(COUNTERS).join(', ')}.`);
        continue;
      }
      seenHere.add(name);
      const actual = counter();
      if (actual !== claimed) {
        problems.push(
          `[count] ${rel}: count:${name} claims ${claimed} but the source has ${actual} — ` +
            `update the token to ${actual}.`,
        );
      }
    }
  }
}

for (const [rel, required] of Object.entries(REQUIRED_COUNT_TOKENS)) {
  const seenHere = countersByFile.get(rel);
  if (!seenHere) {
    problems.push(
      `[count] ${rel} is listed in REQUIRED_COUNT_TOKENS but is not a tracked .md file.`,
    );
    continue;
  }
  for (const name of required) {
    if (!seenHere.has(name)) {
      problems.push(
        `[count] ${rel} must state count:${name} as a verified token but does not.`,
      );
    }
  }
}

// ── env schema ⊆ .env.example: every key the config schema reads is documented. ─
const envExample = readFileSync(join(repoRoot, '.env.example'), 'utf8');
const declaredEnvKeys = new Set([
  ...Object.keys(serverEnvSchema.shape),
  ...Object.keys(observabilityEnvSchema.shape),
  ...Object.keys(deploySeedEnvSchema.shape),
  ...Object.keys(backupEnvSchema.shape),
  ...Object.keys(seedEnvSchema.shape),
  'VITE_SENTRY_DSN',
]);
for (const key of declaredEnvKeys) {
  if (!new RegExp(`^#?\\s*${key}=`, 'm').test(envExample)) {
    problems.push(
      `[env] "${key}" is read by the config schema but not documented in .env.example — ` +
        `add it (commented if platform-injected).`,
    );
  }
}
const documentedEnvKeys = new Set(
  [...envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  ),
);
for (const key of documentedEnvKeys) {
  if (!declaredEnvKeys.has(key)) {
    problems.push(
      `[env] "${key}" is documented in .env.example but no config surface reads it — ` +
        `remove the stale example or restore the config key.`,
    );
  }
}

// ── Dead relative-link check: every tracked `.md`. ──────────────────────────
const LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
for (const rel of trackedMarkdown) {
  const raw = readFileSync(join(repoRoot, rel), 'utf8');
  const prose = raw.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  for (const match of prose.matchAll(LINK)) {
    const target = match[1] ?? '';
    if (/^(https?:|mailto:|tel:|\/\/|#)/.test(target)) continue;
    const path = target.split('#')[0];
    if (!path) continue;
    const resolved = resolve(dirname(join(repoRoot, rel)), path);
    if (!existsSync(resolved)) {
      problems.push(`[link] ${rel}: relative link "${target}" points at a missing file.`);
    }
  }
}

// ── Migration sequence: gapless, duplicate-free prefixes matching the journal. ─
const migrationProblems = lintMigrations(join(repoRoot, 'drizzle'));
problems.push(...migrationProblems);

if (problems.length > 0) {
  process.stderr.write(`doc-lint: ${problems.length} issue(s)\n\n`);
  for (const problem of problems) process.stderr.write(`  ${problem}\n`);
  process.exit(1);
}

const summary =
  `doc-lint: OK — ${DOC_PROMISED_ENFORCERS.length} promised enforcer(s) present, ` +
  `${ruleFiles.length} custom rule(s) documented, ${countTokensSeen} count token(s) verified, ` +
  `${declaredEnvKeys.size} config env key(s) matched bidirectionally, ` +
  `${trackedMarkdown.length} tracked .md file(s) clean of dead links and leaked delimiters, ` +
  `migration sequence + journal consistent.`;
process.stdout.write(`${summary}\n`);
