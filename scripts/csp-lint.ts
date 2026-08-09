import ts from 'typescript';

export type CspPolicy = ReadonlyMap<string, ReadonlySet<string>>;

const propertyName = (name: ts.PropertyName): string | undefined => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
};

const directiveName = (name: string): string =>
  name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const policyFromEntries = (
  entries: ReadonlyArray<readonly [string, readonly string[]]>,
  label: string,
): CspPolicy => {
  const policy = new Map<string, ReadonlySet<string>>();
  for (const [directive, sources] of entries) {
    const normalizedDirective = directive.toLowerCase();
    if (policy.has(normalizedDirective)) {
      throw new Error(`${label} declares "${normalizedDirective}" more than once`);
    }
    policy.set(normalizedDirective, new Set(sources));
  }
  return policy;
};

export const parseCspHeader = (header: string, label: string): CspPolicy => {
  const entries: Array<readonly [string, readonly string[]]> = [];
  for (const segment of header.split(';')) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    const directive = tokens.shift();
    if (directive !== undefined) entries.push([directive, tokens]);
  }
  return policyFromEntries(entries, label);
};

export const parseHonoCsp = (source: string, label: string): CspPolicy => {
  const sourceFile = ts.createSourceFile(label, source, ts.ScriptTarget.Latest, true);
  const candidates: ts.ObjectLiteralExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      propertyName(node.name) === 'contentSecurityPolicy' &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      candidates.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (candidates.length !== 1) {
    throw new Error(`${label} must declare exactly one literal contentSecurityPolicy object`);
  }

  const entries: Array<readonly [string, readonly string[]]> = [];
  for (const property of candidates[0]?.properties ?? []) {
    if (!ts.isPropertyAssignment(property)) {
      throw new Error(`${label} CSP contains a non-property entry`);
    }
    const name = propertyName(property.name);
    if (name === undefined || !ts.isArrayLiteralExpression(property.initializer)) {
      throw new Error(`${label} CSP directives must be named literal arrays`);
    }
    const sources: string[] = [];
    for (const element of property.initializer.elements) {
      if (!ts.isStringLiteral(element)) {
        throw new Error(`${label} directive "${name}" contains a non-literal source`);
      }
      sources.push(element.text);
    }
    entries.push([directiveName(name), sources]);
  }
  return policyFromEntries(entries, label);
};

export const parseVercelCsp = (source: string, label: string): CspPolicy => {
  const parsed: unknown = JSON.parse(source);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('headers' in parsed) ||
    !Array.isArray(parsed.headers)
  ) {
    throw new Error(`${label} has no headers array`);
  }

  const values: string[] = [];
  for (const group of parsed.headers) {
    if (
      typeof group !== 'object' ||
      group === null ||
      !('headers' in group) ||
      !Array.isArray(group.headers)
    ) {
      continue;
    }
    for (const header of group.headers) {
      if (
        typeof header === 'object' &&
        header !== null &&
        'key' in header &&
        'value' in header &&
        typeof header.key === 'string' &&
        header.key.toLowerCase() === 'content-security-policy' &&
        typeof header.value === 'string'
      ) {
        values.push(header.value);
      }
    }
  }
  if (values.length !== 1) {
    throw new Error(`${label} must declare exactly one Content-Security-Policy header`);
  }
  return parseCspHeader(values[0] ?? '', label);
};

const sorted = (values: Iterable<string>): string[] => [...values].sort();

const sourceList = (sources: ReadonlySet<string>): string => sorted(sources).join(' ');

export const compareCspPolicies = (
  left: CspPolicy,
  right: CspPolicy,
  leftLabel: string,
  rightLabel: string,
): string[] => {
  const problems: string[] = [];
  const directives = sorted(new Set([...left.keys(), ...right.keys()]));
  for (const directive of directives) {
    const leftSources = left.get(directive);
    const rightSources = right.get(directive);
    if (leftSources === undefined && rightSources !== undefined) {
      problems.push(
        `[csp] directive "${directive}" is missing from ${leftLabel}; ${rightLabel} has: ${sourceList(rightSources)}.`,
      );
      continue;
    }
    if (leftSources !== undefined && rightSources === undefined) {
      problems.push(
        `[csp] directive "${directive}" is missing from ${rightLabel}; ${leftLabel} has: ${sourceList(leftSources)}.`,
      );
      continue;
    }
    if (leftSources === undefined || rightSources === undefined) continue;
    const leftOnly = sorted([...leftSources].filter((source) => !rightSources.has(source)));
    const rightOnly = sorted([...rightSources].filter((source) => !leftSources.has(source)));
    if (leftOnly.length > 0 || rightOnly.length > 0) {
      problems.push(
        `[csp] directive "${directive}" differs — ${leftLabel} only: ${leftOnly.join(' ') || '(none)'}; ` +
          `${rightLabel} only: ${rightOnly.join(' ') || '(none)'}.`,
      );
    }
  }
  return problems;
};
