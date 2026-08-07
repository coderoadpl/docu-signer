import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

/**
 * Doc-lint: keeps docs and enforcer configuration honest in both directions
 * (ADR-0004 §Decision 4). It is deliberately a plain script, not a framework.
 *
 *   docs -> config: every enforcer the docs promise must still exist in
 *     eslint.config.js / .dependency-cruiser.cjs, so the documentation cannot
 *     describe a guarantee the config no longer provides.
 *   config -> docs: every custom rule in eslint-plugin-agentproofarch/rules
 *     must be documented by name, so no enforcer is added in silence.
 */

const demoRoot = join(import.meta.dirname, '..');
const docsRoot = join(demoRoot, 'docs');
const require = createRequire(import.meta.url);

const eslintConfigPath = join(demoRoot, 'eslint.config.js');
const depcruiseConfigPath = join(demoRoot, '.dependency-cruiser.cjs');
const rulesDir = join(demoRoot, 'eslint-plugin-agentproofarch', 'rules');

type ConfigTarget = 'eslint' | 'depcruise';

interface Enforcer {
  readonly id: string;
  readonly config: ConfigTarget;
  readonly doc: string;
}

/**
 * Enforcers the prose promises but does not spell as a literal rule id. Each
 * entry maps a documented guarantee to the concrete config rule that backs it,
 * with the doc section it is promised in. Extend this when the docs make a new
 * enforcement promise; remove an entry only when the docs stop promising it.
 */
const DOC_PROMISED_ENFORCERS: readonly Enforcer[] = [
  // architecture.md §Principles: "layer rules are lint rules (eslint-plugin-boundaries + dependency-cruiser)".
  { id: 'boundaries/element-types', config: 'eslint', doc: 'architecture.md §Principles' },
  // architecture.md §Layers: "No any".
  { id: '@typescript-eslint/no-explicit-any', config: 'eslint', doc: 'architecture.md §Layers' },
  // architecture.md §Layers + demo/CLAUDE.md: "no as (except as const)" — enforced via a no-restricted-syntax selector.
  { id: 'no-restricted-syntax', config: 'eslint', doc: 'architecture.md §Layers' },
  // architecture.md §Frontend / frontend-lint-plan.md §Phase 2: boundaries/external framework bans.
  { id: 'boundaries/external', config: 'eslint', doc: 'frontend-lint-plan.md §Phase 2' },
  // architecture.md §Layers: "@vercel/* and @neondatabase/* are importable only inside adapters".
  { id: 'vercel-and-neon-only-in-adapters', config: 'depcruise', doc: 'architecture.md §Layers' },
  // architecture.md §Layers: "core/** never imports frameworks, servers or drivers".
  { id: 'no-frameworks-in-core', config: 'depcruise', doc: 'architecture.md §Layers' },
  // architecture.md §Layers: core/domain depends on nothing app-internal.
  { id: 'core-domain-depends-on-nothing', config: 'depcruise', doc: 'architecture.md §Layers' },
  // architecture.md §Frontend: "Features are islands".
  { id: 'web-features-are-islands', config: 'depcruise', doc: 'architecture.md §Frontend' },
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
      docs.push({ rel: relative(docsRoot, full), text: readFileSync(full, 'utf8') });
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

const docs = collectDocs(docsRoot);
const docsCombined = docs.map((doc) => doc.text).join('\n');

const eslintSource = readFileSync(eslintConfigPath, 'utf8');
const depcruiseModule: { forbidden: ReadonlyArray<{ name: string }> } = require(depcruiseConfigPath);
const depcruiseRuleNames = new Set(depcruiseModule.forbidden.map((rule) => rule.name));

const configHasId = (id: string, target: ConfigTarget): boolean =>
  target === 'eslint' ? eslintSource.includes(id) : depcruiseRuleNames.has(id);

const configFileFor = (target: ConfigTarget): string =>
  target === 'eslint' ? 'eslint.config.js' : '.dependency-cruiser.cjs';

interface Failure {
  readonly direction: 'docs->config' | 'config->docs';
  readonly identifier: string;
  readonly missingFrom: string;
  readonly promisedBy: string;
}

const failures: Failure[] = [];

// docs -> config (a): backticked custom-plugin rule ids the docs spell literally.
const CUSTOM_RULE_ID = /^agentproofarch\/[a-z][a-z0-9-]*$/;
for (const doc of docs) {
  for (const token of backtickTokens(doc.text)) {
    if (!CUSTOM_RULE_ID.test(token)) continue;
    if (!eslintSource.includes(token)) {
      failures.push({
        direction: 'docs->config',
        identifier: token,
        missingFrom: 'eslint.config.js',
        promisedBy: doc.rel,
      });
    }
  }
}

// docs -> config (b): the explicit manifest of prose-promised enforcers.
for (const enforcer of DOC_PROMISED_ENFORCERS) {
  if (!configHasId(enforcer.id, enforcer.config)) {
    failures.push({
      direction: 'docs->config',
      identifier: enforcer.id,
      missingFrom: configFileFor(enforcer.config),
      promisedBy: enforcer.doc,
    });
  }
}

// config -> docs: every custom rule file must be documented by name.
const ruleFiles = readdirSync(rulesDir).filter(
  (name) => name.endsWith('.js') && !name.endsWith('.test.js'),
);
for (const file of ruleFiles) {
  const ruleName = basename(file, '.js');
  if (!docsCombined.includes(ruleName)) {
    failures.push({
      direction: 'config->docs',
      identifier: ruleName,
      missingFrom: 'docs/',
      promisedBy: `eslint-plugin-agentproofarch/rules/${file}`,
    });
  }
}

if (failures.length > 0) {
  process.stderr.write(`doc-lint: ${failures.length} enforcer(s) out of sync between docs and config\n\n`);
  for (const failure of failures) {
    if (failure.direction === 'docs->config') {
      process.stderr.write(
        `  [docs->config] "${failure.identifier}" is promised by ${failure.promisedBy} ` +
          `but no longer exists in ${failure.missingFrom}.\n` +
          `                Restore the enforcer, or stop promising it in the docs.\n`,
      );
    } else {
      process.stderr.write(
        `  [config->docs] enforcer "${failure.identifier}" (${failure.promisedBy}) ` +
          `is not documented anywhere under docs/.\n` +
          `                Document it by name, or remove the rule.\n`,
      );
    }
  }
  process.exit(1);
}

const summary =
  `doc-lint: OK — ${DOC_PROMISED_ENFORCERS.length} promised enforcer(s) present in config, ` +
  `${ruleFiles.length} custom rule(s) documented.`;
process.stdout.write(`${summary}\n`);
