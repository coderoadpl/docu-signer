import { describe, expect, it } from 'vitest';

import {
  compareCspPolicies,
  parseCspHeader,
  parseHonoCsp,
  parseVercelCsp,
} from './csp-lint.js';

const compare = (left: string, right: string): string[] =>
  compareCspPolicies(
    parseCspHeader(left, 'server'),
    parseCspHeader(right, 'vercel'),
    'server',
    'vercel',
  );

describe('CSP comparison', () => {
  it('accepts identical policies', () => {
    expect(compare("script-src 'self'; object-src 'none'", "script-src 'self'; object-src 'none'"))
      .toEqual([]);
  });

  it('reports a directive missing on one side', () => {
    expect(compare("script-src 'self'; object-src 'none'", "script-src 'self'")).toEqual([
      `[csp] directive "object-src" is missing from vercel; server has: 'none'.`,
    ]);
    expect(compare("script-src 'self'", "script-src 'self'; object-src 'none'")).toEqual([
      `[csp] directive "object-src" is missing from server; vercel has: 'none'.`,
    ]);
  });

  it('reports differing source lists precisely', () => {
    expect(compare("img-src 'self' data:", "img-src 'self' blob:")).toEqual([
      '[csp] directive "img-src" differs — server only: data:; vercel only: blob:.',
    ]);
  });

  it('ignores directive and source ordering', () => {
    expect(
      compare(
        "script-src https://cdn.example 'self'; img-src data: 'self'",
        "img-src 'self' data:; script-src 'self' https://cdn.example",
      ),
    ).toEqual([]);
  });

  it('parses equivalent Hono and Vercel policy sources', () => {
    const server = parseHonoCsp(
      `secureHeaders({ contentSecurityPolicy: { imgSrc: ["'self'", 'data:'], objectSrc: ["'none'"] } })`,
      'server',
    );
    const vercel = parseVercelCsp(
      JSON.stringify({
        headers: [
          { headers: [{ key: 'X-Test', value: 'value' }] },
          {
            headers: [
              {
                key: 'Content-Security-Policy',
                value: "object-src 'none'; img-src data: 'self'",
              },
            ],
          },
        ],
      }),
      'vercel',
    );

    expect(compareCspPolicies(server, vercel, 'server', 'vercel')).toEqual([]);
  });

  it('reports when only the right policy adds a source', () => {
    expect(compare("img-src 'self'", "img-src 'self' data:")).toEqual([
      '[csp] directive "img-src" differs — server only: (none); vercel only: data:.',
    ]);
  });

  it('rejects duplicate directives', () => {
    expect(() => parseCspHeader("img-src 'self'; IMG-SRC data:", 'policy')).toThrow(
      'policy declares "img-src" more than once',
    );
  });

  it('rejects an absent or structurally ambiguous Hono policy', () => {
    expect(() => parseHonoCsp('secureHeaders({})', 'server')).toThrow(
      'server must declare exactly one literal contentSecurityPolicy object',
    );
    expect(() =>
      parseHonoCsp(
        'secureHeaders({ contentSecurityPolicy: { ...sharedPolicy } })',
        'server',
      ),
    ).toThrow('server CSP contains a non-property entry');
    expect(() =>
      parseHonoCsp('secureHeaders({ contentSecurityPolicy: { imgSrc: sources } })', 'server'),
    ).toThrow('server CSP directives must be named literal arrays');
    expect(() =>
      parseHonoCsp(
        `secureHeaders({ contentSecurityPolicy: { imgSrc: ["'self'", source] } })`,
        'server',
      ),
    ).toThrow('server directive "imgSrc" contains a non-literal source');
  });

  it('rejects absent or duplicate Vercel CSP headers', () => {
    expect(() => parseVercelCsp('{}', 'vercel')).toThrow('vercel has no headers array');
    expect(() =>
      parseVercelCsp(
        JSON.stringify({
          headers: [
            {},
            {
              headers: [
                null,
                { key: 'Content-Security-Policy', value: "script-src 'self'" },
                { key: 'content-security-policy', value: "object-src 'none'" },
              ],
            },
          ],
        }),
        'vercel',
      ),
    ).toThrow('vercel must declare exactly one Content-Security-Policy header');
  });
});
