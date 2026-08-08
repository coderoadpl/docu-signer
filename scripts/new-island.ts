import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveNames, renderTemplateFile, ResourceNameError } from './new-resource.js';
import type { GeneratedFile, ResourceNames } from './new-resource.js';

/**
 * Island scaffolder — the client-state sibling of new-resource. It generates a
 * feature (island) core: the events-in / selectors-out seam a view talks to,
 * plus the view, its route and a colocated core test. It reuses new-resource's
 * name derivation, render + token machinery, dry-run and collision refusal.
 *
 * The `--machine` flag picks the rung (the owner's post-spike decision):
 *   none        RUNG 1 — a thin re-export of server-state descriptors with a
 *               typed, stubbed `send`; no client machine.
 *   store       RUNG 2 — additionally an @xstate/store island store (core/store.ts;
 *               the owner's first choice, its event map IS the seam), wired into
 *               the seam's send/selectors, with a store test.
 *   statechart  RUNG 3 — additionally the transition-table-as-data, the DERIVED
 *               XState oracle (core/machine.ts, hand-writing forbidden), and a
 *               drift property test (core/rules.drift.test.ts). The oracle is
 *               consulted by a UI machine in a guard (see core/index.ts).
 *
 * For `--machine=statechart`, `--rules` picks WHERE the transition table lives
 * (D2 — the owner's post-audit decision, default domain):
 *   domain  (default)  the table is a core/domain module (<name>-rules.ts), so
 *                      core/server can import it — the server enforces the SAME
 *                      table as the client. The machine imports it from core/domain.
 *   local              the table stays inside the island (core/rules.ts). It is
 *                      CLIENT-ONLY — a feature cannot be imported by core/server —
 *                      so it carries no (misleading) server-shares-the-table claim.
 *
 * Every mode carries marked `<<EXTENSION POINT>>`s where the seam grows. Like
 * new-resource, it does NOT edit shared files: the generated code imports symbols
 * that do not exist yet (a bound descriptor, a gateway), so `pnpm run check` stays
 * RED through the type-forced steps. The web-route registration in main.tsx is
 * NOT type-forced — it typechecks while unwired — so the printed checklist, not
 * the compiler, is what guarantees the route is registered.
 */

/** The client-state machine each mode wires behind the island seam. */
export type MachineMode = 'none' | 'store' | 'statechart';

const MACHINE_MODES: readonly MachineMode[] = ['none', 'store', 'statechart'];

const isMachineMode = (value: string): value is MachineMode =>
  MACHINE_MODES.some((mode) => mode === value);

/** Where a rung-3 transition table lives: shared core/domain, or island-local. */
export type RulesMode = 'domain' | 'local';

const RULES_MODES: readonly RulesMode[] = ['domain', 'local'];

const isRulesMode = (value: string): value is RulesMode =>
  RULES_MODES.some((mode) => mode === value);

/**
 * Prose that differs between rules modes. In domain mode the table is server-
 * importable, so the server-shares-the-table claim is TRUE; in local mode it is a
 * client-only table and the claim would be misleading, so it is replaced by an
 * honest "regenerate with --rules=domain" note.
 */
const rulesTokens = (names: ResourceNames, rules: RulesMode): Record<string, string> => {
  const domainPath = `core/domain/${names.singularKebab}-rules.ts`;
  return rules === 'domain'
    ? {
        __RULES_MODULE__: `#core/domain/${names.singularKebab}-rules.js`,
        __RULES_PATH__: domainPath,
        __RULES_SERVER_NOTE__: `This table lives in core/domain, so core/server imports the SAME table — the \`canApply${names.singularPascal}Move\` walk below is that shared reference; client and server can never diverge.`,
        __RULES_SERVER_REF__: `The server check, DERIVED FROM THE SAME TABLE: a direct walk with no XState. It is the reference core/rules.drift.test.ts holds the derived machine to, and — because the table is in core/domain — a core/server use-case runs this exact walk, so client and server enforce one table.`,
        __RULES_INDEX_SERVER_NOTE__: `The server derives its check from the SAME table (${domainPath}), and`,
      }
    : {
        __RULES_MODULE__: './rules.js',
        __RULES_PATH__: 'core/rules.ts',
        __RULES_SERVER_NOTE__: `This table is CLIENT-ONLY: it lives inside the island and core/server cannot import a feature, so it feeds NO server check. Regenerate with \`--rules=domain\` to lift it into core/domain when the server must enforce the same moves.`,
        __RULES_SERVER_REF__: `A direct table walk with no XState: the reference core/rules.drift.test.ts holds the derived machine to. It runs CLIENT-SIDE ONLY — a feature-local table cannot feed core/server. Regenerate with \`--rules=domain\` when a server check must share this table.`,
        __RULES_INDEX_SERVER_NOTE__: `This oracle is CLIENT-ONLY (core/rules.ts is island-local, unreachable from core/server); regenerate with \`--rules=domain\` for a server-shared table, and`,
      };
};

const applyRulesTokens = (contents: string, tokens: Record<string, string>): string =>
  Object.entries(tokens).reduce(
    (acc, [token, value]) => acc.replaceAll(token, value),
    contents,
  );

/** Existing feature folders an island name must not clobber. */
const RESERVED_ISLANDS = new Set(['todos', 'auth']);

const eventsTemplate = (machine: MachineMode): string =>
  machine === 'store' ? 'island-events.store.ts.tpl' : 'island-events.ts.tpl';

const indexTemplate = (machine: MachineMode): string => {
  if (machine === 'store') return 'island-index.store.ts.tpl';
  if (machine === 'statechart') return 'island-index.statechart.ts.tpl';
  return 'island-index.ts.tpl';
};

/**
 * The web composition (index.web.ts) — the ONE site that binds the portable core
 * to its real gateway + bound descriptors. One per rung, mirroring the index
 * shapes: rung 2 also injects a gateway + id source; rung 3 re-exports the oracle.
 */
const webIndexTemplate = (machine: MachineMode): string => {
  if (machine === 'store') return 'island-index.web.store.ts.tpl';
  if (machine === 'statechart') return 'island-index.web.statechart.ts.tpl';
  return 'island-index.web.ts.tpl';
};

const coreTestTemplate = (machine: MachineMode): string =>
  machine === 'store' ? 'island-core.store.test.ts.tpl' : 'island-core.test.ts.tpl';

const planIslandFiles = (
  names: ResourceNames,
  machine: MachineMode,
  rules: RulesMode,
): GeneratedFile[] => {
  const feature = `apps/web/src/features/${names.singularKebab}`;
  const file = (templateFile: string, path: string): GeneratedFile => ({
    path,
    contents: renderTemplateFile(templateFile, names),
  });
  // Statechart files carry the extra rules-mode tokens (import specifier, path,
  // server-shares-the-table prose) on top of the name tokens.
  const tokens = rulesTokens(names, rules);
  const statechartFile = (templateFile: string, path: string): GeneratedFile => ({
    path,
    contents: applyRulesTokens(renderTemplateFile(templateFile, names), tokens),
  });
  // Domain rules are a shared core/domain module; local rules stay island-local.
  const rulesPath =
    rules === 'domain'
      ? `core/domain/${names.singularKebab}-rules.ts`
      : `${feature}/core/rules.ts`;

  const files: GeneratedFile[] = [
    file(eventsTemplate(machine), `${feature}/core/events.ts`),
    file('island-selectors.ts.tpl', `${feature}/core/selectors.ts`),
  ];

  if (machine === 'store') {
    files.push(file('island-store.ts.tpl', `${feature}/core/store.ts`));
  }
  if (machine === 'statechart') {
    files.push(statechartFile('island-rules.ts.tpl', rulesPath));
    files.push(statechartFile('island-machine.ts.tpl', `${feature}/core/machine.ts`));
  }

  const indexFile =
    machine === 'statechart'
      ? statechartFile(indexTemplate(machine), `${feature}/core/index.ts`)
      : file(indexTemplate(machine), `${feature}/core/index.ts`);
  files.push(indexFile);
  files.push(file(coreTestTemplate(machine), `${feature}/core/${names.singularKebab}.test.ts`));

  if (machine === 'statechart') {
    files.push(statechartFile('island-rules.drift.test.ts.tpl', `${feature}/core/rules.drift.test.ts`));
  }

  // The web composition binds the portable core to api.ts (gateway + descriptors);
  // it lives at the feature root, OUTSIDE core/, so the core stays api-free.
  files.push(file(webIndexTemplate(machine), `${feature}/index.web.ts`));
  files.push(file('island-page.tsx.tpl', `${feature}/${names.singularPascal}Page.tsx`));
  files.push(file('island-route.tsx.tpl', `apps/web/src/routes/${names.singularKebab}.tsx`));

  return files;
};

export interface GenerateIslandOptions {
  name: string;
  /** Base directory the generated files are written into. */
  outDir: string;
  /** Directory checked for collisions with an existing island of this name. */
  repoRoot: string;
  /** Client-state machine to scaffold behind the seam. Defaults to 'none' (rung 1). */
  machine?: MachineMode;
  /**
   * Where a rung-3 transition table lives (statechart only). Defaults to 'domain'
   * (a server-importable core/domain module); 'local' keeps it island-local.
   */
  rules?: RulesMode;
  /** When true, plan and return files without writing them. */
  dryRun?: boolean;
}

export interface GenerateIslandResult {
  names: ResourceNames;
  files: GeneratedFile[];
  checklist: string;
}

export const generateIsland = (options: GenerateIslandOptions): GenerateIslandResult => {
  const names = deriveNames(options.name);
  const machine = options.machine ?? 'none';
  const rules = options.rules ?? 'domain';

  if (RESERVED_ISLANDS.has(names.singularKebab)) {
    throw new ResourceNameError(`Island "${names.singularKebab}" is reserved or already exists.`);
  }

  const files = planIslandFiles(names, machine, rules);

  for (const file of files) {
    if (existsSync(join(options.repoRoot, file.path))) {
      throw new ResourceNameError(
        `Refusing to overwrite existing file: ${file.path}. Pick a different name.`,
      );
    }
  }

  if (!options.dryRun) {
    for (const file of files) {
      const target = join(options.outDir, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.contents);
    }
  }

  return { names, files, checklist: buildChecklist(names, files, machine, rules) };
};

const buildChecklist = (
  names: ResourceNames,
  files: GeneratedFile[],
  machine: MachineMode,
  rules: RulesMode,
): string => {
  if (machine !== 'none') return buildMachineChecklist(names, files, machine, rules);
  const n = names;
  const generated = files.map((file) => `  + ${file.path}`).join('\n');
  return `
Scaffolded island "${n.singularKebab}" (feature = island). Generated files (owned
by this island):
${generated}

These GENERATED files import a bound descriptor that does not exist yet, so
\`pnpm run check\` will stay RED through the type-forced steps below. The web-route
registration (step 2) is NOT type-forced — it typechecks while unwired — so the
checklist, not the compiler, guarantees it. The island core is RUNG 1: server-state
descriptors behind the seam and a stubbed \`send\`; the client machine is
deliberately absent (see the machine note at the end). Work top to bottom:

1. READ DESCRIPTOR — bind the island's server-state read.
   The view reads through \`${n.singularCamel}Selectors.list\`. The core is
   PORTABLE — it imports no api.ts — so the descriptor is INJECTED by the generated
   web composition (features/${n.singularKebab}/index.web.ts), which passes
   \`actions.${n.singularCamel}\` into \`create${n.singularPascal}Core\`. Either reuse
   an EXISTING resource query (edit index.web.ts to \`list: actions.todos\`), or
   scaffold a new resource (\`pnpm run new:resource -- <name>\`), wire its checklist,
   and bind it here:
   apps/web/src/api.ts
     1a. anchor:  todosQuery,        (the '#core/client/index.js' import)
         add:     ${n.singularCamel}Query,
     1b. anchor:  todos: todosQuery(apiClient),   (the actions object)
         add:     ${n.singularCamel}: ${n.singularCamel}Query(apiClient),
   Then reconcile the injected key in features/${n.singularKebab}/index.web.ts
   (the WEB COMPOSITION — the one site that binds the core to api.ts) if you
   aliased a different action.

2. WEB ROUTE — apps/web/src/main.tsx
   (The route component — apps/web/src/routes/${n.singularKebab}.tsx — is already
    generated.)
   2a. anchor:  import { TodosRoute } from './routes/todos.js';
       add:     import { ${n.singularPascal}Route } from './routes/${n.singularKebab}.js';
   2b. anchor:  const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, loginRoute]) });
       add a route above it and register it:
         const ${n.singularCamel}Route = createRoute({
           getParentRoute: () => rootRoute,
           path: '/${n.singularKebab}',
           component: ${n.singularPascal}Route,
         });
       then extend addChildren([indexRoute, loginRoute, ${n.singularCamel}Route]).

3. CORE TEST — apps/web/src/features/${n.singularKebab}/core/${n.singularKebab}.test.ts
   is generated with a passing rung-1 assertion and TODO homes for the machine's
   unit tests. Write the core's tests before growing the view.

MACHINE (rung 2 / rung 3) — RESOLVED (ADR-0005): graduate via --machine.
   This island ships at RUNG 1 (no client store) — the honest default until a
   graduation trigger fires. When one does, scaffold the machine instead of
   hand-rolling it: rung 2 = island store (@xstate/store; zustand is NOT a demo
   dependency) via \`pnpm run new:island -- <name> --machine=store\`; rung 3 =
   statechart (an XState oracle DERIVED from a core/domain transition table) via
   \`--machine=statechart\` — or grow this island at the marked
   <<EXTENSION POINT>>s in core/index.ts and core/selectors.ts following those
   scaffolds' shapes. The view keeps talking to the same send/selectors seam
   either way. See docs/architecture.md §Client application state (ADR-0005).

Verify (write core tests before wiring the UI):
  pnpm run check && pnpm run smoke
`;
};

/** Shared shared-file wiring steps (identical for store and statechart). */
const sharedWiringSteps = (n: ResourceNames): string => `
1. READ DESCRIPTOR — bind the island's server-state read.
   The view reads through \`${n.singularCamel}Selectors.list\`. The core is
   PORTABLE — it imports no api.ts — so the descriptor is INJECTED by the generated
   web composition (features/${n.singularKebab}/index.web.ts), which passes
   \`actions.${n.singularCamel}\` into \`create${n.singularPascal}Core\`. Reuse an
   EXISTING resource query (edit index.web.ts to \`list: actions.todos\`), or
   scaffold a new resource (\`pnpm run new:resource -- <name>\`), wire its checklist,
   and bind it:
   apps/web/src/api.ts
     1a. anchor:  todosQuery,        (the '#core/client/index.js' import)
         add:     ${n.singularCamel}Query,
     1b. anchor:  todos: todosQuery(apiClient),   (the actions object)
         add:     ${n.singularCamel}: ${n.singularCamel}Query(apiClient),

2. WEB ROUTE — apps/web/src/main.tsx
   (The route component — apps/web/src/routes/${n.singularKebab}.tsx — is already
    generated.)
   2a. anchor:  import { TodosRoute } from './routes/todos.js';
       add:     import { ${n.singularPascal}Route } from './routes/${n.singularKebab}.js';
   2b. anchor:  const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, loginRoute]) });
       add a route above it and register it:
         const ${n.singularCamel}Route = createRoute({
           getParentRoute: () => rootRoute,
           path: '/${n.singularKebab}',
           component: ${n.singularPascal}Route,
         });
       then extend addChildren([indexRoute, loginRoute, ${n.singularCamel}Route]).`;

const buildMachineChecklist = (
  names: ResourceNames,
  files: GeneratedFile[],
  machine: 'store' | 'statechart',
  rules: RulesMode,
): string => {
  const n = names;
  const generated = files.map((file) => `  + ${file.path}`).join('\n');
  const rung = machine === 'store' ? '2 (island store)' : '3 (statechart)';

  const storeSection = `
3. GATEWAY — apps/web/src/api.ts
   The store (core/store.ts) is OPTIMISTIC: it applies each edit locally, then
   persists it through an injected gateway (${n.singularPascal}Gateway). The web
   composition (features/${n.singularKebab}/index.web.ts) imports
   \`${n.singularCamel}Gateway\` from apps/web/src/api.ts and injects it into the core
   — it does not exist yet, so \`pnpm run check\` stays RED until you bind one.
   anchor:  todos: todosQuery(apiClient),   (near the actions object)
   add a gateway that maps each method to a core/client mutation:
     export const ${n.singularCamel}Gateway: ${n.singularPascal}Gateway = {
       addItem: (input) => apiClient.add${n.singularPascal}Item(input).then(toResult),
       moveItem: (input) => apiClient.move${n.singularPascal}Item(input).then(toResult),
       removeItem: (input) => apiClient.remove${n.singularPascal}Item(input).then(toResult),
     };
   (Import ${n.singularPascal}Gateway from the island core; scaffold the mutations
    via \`pnpm run new:resource\` and wire them through core/client.)

4. STORE TEST — apps/web/src/features/${n.singularKebab}/core/${n.singularKebab}.test.ts
   is generated with the rung-2 store tests (optimistic apply + undo, driven by a
   fake gateway) and an <<EXTENSION POINT>> for the rollback test. The store block
   is green immediately; the seam assertions go green once steps 1 and 3 are wired.

RUNG 2 — @xstate/store (the owner's first choice; its event map IS the seam).
   core/store.ts is the machine behind the seam; core/index.ts forwards \`send\`
   to it and exposes its client selectors alongside the server read. The view's
   calls never change. See docs/architecture.md §Client application state (ADR-0005).`;

  const domainRulesStep = `
3. RULES EXPORT — core/domain/index.ts (\`--rules=domain\`, the default)
   The transition table is a SHARED core/domain module — core/domain/${n.singularKebab}-rules.ts
   — so core/server can enforce the SAME table as the client. Export it from the
   barrel so both sides import it:
   anchor:  export * from './todo.js';   (the core/domain/index.ts re-exports)
   add:     export * from './${n.singularKebab}-rules.js';
   Then feed the table to a core/server use-case (the \`canApply${n.singularPascal}Move\`
   walk) so client and server can never diverge.`;
  const localRulesStep = `
3. RULES (island-local, \`--rules=local\`)
   The transition table lives in core/rules.ts, INSIDE this island. It is
   CLIENT-ONLY — core/server cannot import a feature — so nothing to export. When
   the server must enforce these same moves, regenerate with \`--rules=domain\` to
   lift the table into core/domain.`;
  const rulesStep = rules === 'domain' ? domainRulesStep : localRulesStep;
  const rulesPath = rules === 'domain' ? `core/domain/${n.singularKebab}-rules.ts` : 'core/rules.ts';
  const serverLine =
    rules === 'domain'
      ? 'The server derives its check from the SAME table (it is in core/domain).'
      : 'This table is client-only (island-local); use --rules=domain for a server-shared table.';

  const statechartSection = `${rulesStep}

4. CORE TEST — apps/web/src/features/${n.singularKebab}/core/${n.singularKebab}.test.ts
   holds the rung-1 seam assertions; grow them into your UI-machine tests. The
   domain oracle is proven separately by the drift test (core/rules.drift.test.ts).

RUNG 3 — transition-table-as-data + a DERIVED oracle.
   ${rulesPath} is the SINGLE SOURCE OF TRUTH (exhaustive Records; adding a phase
   or rule is a compile error until every site is covered). core/machine.ts DERIVES
   the XState oracle from that table programmatically — hand-writing the machine is
   forbidden. core/rules.drift.test.ts is a property test over every (state, event)
   pair (incl. the WIP=1 edge) and runs in CI: it fails the moment the derived
   machine and the table disagree.
   COMPOSE, don't embed: this island's own hand-written UI machine CONSULTS the
   oracle (\`evaluate${n.singularPascal}Move\`) in a guard — see the oracle-guard note
   in core/index.ts. UI states never enter the domain machine. ${serverLine}
   See docs/architecture.md §Client application state (ADR-0005).`;

  return `
Scaffolded island "${n.singularKebab}" (feature = island, RUNG ${rung}). Generated
files (owned by this island):
${generated}

These GENERATED files import symbols that do not exist yet — a bound descriptor${
    machine === 'store' ? ' and a gateway' : ''
  } — so \`pnpm run check\` will stay RED through the type-forced steps below. The
web-route registration (step 2) is NOT type-forced — it typechecks while unwired
— so the checklist, not the compiler, guarantees it. Work top to bottom:
${sharedWiringSteps(n)}
${machine === 'store' ? storeSection : statechartSection}

Verify (write core tests before wiring the UI):
  pnpm run check && pnpm run smoke
`;
};

const parseMachine = (args: readonly string[]): MachineMode => {
  const flag = args.find((arg) => arg.startsWith('--machine='));
  if (flag === undefined) return 'none';
  const value = flag.slice('--machine='.length);
  if (!isMachineMode(value)) {
    throw new ResourceNameError(
      `Invalid --machine=${value}: expected one of ${MACHINE_MODES.join(', ')}.`,
    );
  }
  return value;
};

const parseRules = (args: readonly string[], machine: MachineMode): RulesMode => {
  const flag = args.find((arg) => arg.startsWith('--rules='));
  if (flag === undefined) return 'domain';
  const value = flag.slice('--rules='.length);
  if (!isRulesMode(value)) {
    throw new ResourceNameError(
      `Invalid --rules=${value}: expected one of ${RULES_MODES.join(', ')}.`,
    );
  }
  if (machine !== 'statechart') {
    throw new ResourceNameError('--rules only applies to --machine=statechart.');
  }
  return value;
};

const runCli = (): void => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const name = args.find((arg) => !arg.startsWith('--'));
  if (name === undefined) {
    process.stderr.write(
      'Usage: pnpm run new:island -- <name> [--machine=store|statechart] [--rules=domain|local] [--dry-run]\n',
    );
    process.exit(1);
  }
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const machine = parseMachine(args);
    const rules = parseRules(args, machine);
    const result = generateIsland({ name, outDir: repoRoot, repoRoot, machine, rules, dryRun });
    process.stdout.write(result.checklist);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`new:island failed: ${message}\n`);
    process.exit(1);
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli();
}
