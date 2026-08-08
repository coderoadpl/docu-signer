import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import * as ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generateResource } from '../scripts/new-resource.js';

/**
 * Compile-gate for the new:resource templates. `new-resource.test.ts` renders
 * every file and asserts each PARSES in isolation (ts.transpileModule) — that
 * catches syntax errors and unsubstituted tokens but never a type error, because
 * transpile-per-file does no checking. This probe closes that gap: it renders a
 * resource, drops it into the real tree so relative and `#core/*` imports resolve
 * against the actual modules, and runs a real `tsc` program over the output.
 *
 * The rendered output is deliberately RED — the scaffolder does NOT wire the
 * shared files (domain union, ports, contract, adapter schema, web api.ts, the
 * Capability union), so tsc reports a cascade of missing-symbol diagnostics. That
 * cascade is the checklist's declared, type-forced RED, and every diagnostic in
 * it carries a code in `UNWIRED_CODES`. A template that fails tsc for any OTHER
 * reason — e.g. the noUncheckedIndexedAccess RED the D1 store-template rework hit,
 * an unconditional strict-flag error the checklist never declared — surfaces a
 * code OUTSIDE that set, which this probe fails on.
 */

const demoRoot = join(import.meta.dirname, '..');

const PROBE_PREFIX = 'zzprobe';
const resourceName = `${PROBE_PREFIX}${process.pid}x${Date.now()}`;

const UNWIRED_CODES = new Set([
  2304, // cannot find name
  2305, // module has no exported member (the unwired domain/port/contract symbols)
  2307, // cannot find module
  2339, // property does not exist (the unwired web api.ts actions / adapter columns)
  2345, // argument not assignable (capability absent from the union; unwired mutation → void)
  2724, // no exported member named X
  7006, // parameter implicitly has an 'any' type (cascade from an unresolved import type)
]);

const sweepDirs = [
  join('core', 'domain'),
  join('core', 'server', 'usecases'),
  join('adapters', 'db'),
  join('apps', 'web', 'src', 'routes'),
];
const featuresDir = join('apps', 'web', 'src', 'features');

const sweep = () => {
  for (const rel of sweepDirs) {
    const abs = join(demoRoot, rel);
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.name.startsWith(PROBE_PREFIX)) {
        rmSync(join(abs, entry.name), { recursive: true, force: true });
      }
    }
  }
  const featuresAbs = join(demoRoot, featuresDir);
  for (const entry of readdirSync(featuresAbs, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(PROBE_PREFIX)) {
      rmSync(join(featuresAbs, entry.name), { recursive: true, force: true });
    }
  }
};

const diagnosticsOfGenerated: ts.Diagnostic[] = [];
let checkedFileCount = 0;

const format = (diagnostic: ts.Diagnostic): string => {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
  const where = diagnostic.file
    ? `${join('.', diagnostic.file.fileName.slice(demoRoot.length + 1))}`
    : '(no file)';
  return `TS${diagnostic.code} ${where}: ${message}`;
};

beforeAll(() => {
  sweep();

  // The generated *.test.ts is written under a non-test suffix so the running
  // vitest never discovers it as a live test file; tsc checks it all the same.
  const { files } = generateResource({
    name: resourceName,
    outDir: demoRoot,
    repoRoot: demoRoot,
    dryRun: true,
  });

  const written: string[] = [];
  for (const file of files) {
    const rel = file.path.endsWith('.test.ts')
      ? `${file.path.slice(0, -'.test.ts'.length)}.probecheck.ts`
      : file.path;
    const abs = join(demoRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.contents, 'utf8');
    written.push(abs);
  }

  const configFile = ts.readConfigFile(join(demoRoot, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, demoRoot);
  const program = ts.createProgram({
    rootNames: written,
    options: { ...parsed.options, noEmit: true },
  });

  for (const abs of written) {
    const sourceFile = program.getSourceFile(abs);
    if (!sourceFile) continue;
    checkedFileCount += 1;
    diagnosticsOfGenerated.push(
      ...program.getSyntacticDiagnostics(sourceFile),
      ...program.getSemanticDiagnostics(sourceFile),
    );
  }
}, 120_000);

afterAll(() => {
  sweep();
});

describe('new:resource template compile-gate', () => {
  it('type-checks every rendered file against the real tree', () => {
    expect(checkedFileCount).toBeGreaterThanOrEqual(6);
  });

  it('renders output whose only tsc errors are the checklist-declared unwired cascade', () => {
    const offenders = diagnosticsOfGenerated
      .filter((diagnostic) => !UNWIRED_CODES.has(diagnostic.code))
      .map(format);
    expect(offenders).toEqual([]);
  });

  it('actually exercises the unwired RED (the probe is not vacuously green)', () => {
    expect(diagnosticsOfGenerated.length).toBeGreaterThan(0);
    const noExportedMember = diagnosticsOfGenerated.some((diagnostic) => diagnostic.code === 2305);
    expect(noExportedMember).toBe(true);
  });

  it('type-forces the authorize-first capability: the named capability is not yet in the union', () => {
    const capabilityRejected = diagnosticsOfGenerated.some(
      (diagnostic) =>
        diagnostic.code === 2345 &&
        ts
          .flattenDiagnosticMessageText(diagnostic.messageText, ' ')
          .includes(`${resourceName}:read`),
    );
    expect(capabilityRejected).toBe(true);
  });
});
