import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import * as ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ResourceNameError,
  deriveNames,
  generateResource,
  validateResourceName,
} from './new-resource.js';

const demoRoot = join(import.meta.dirname, '..');

let sandbox: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'new-resource-'));
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

describe('deriveNames', () => {
  it('derives every case form of a single-word name', () => {
    expect(deriveNames('note')).toEqual({
      singularKebab: 'note',
      pluralKebab: 'notes',
      singularPascal: 'Note',
      pluralPascal: 'Notes',
      singularCamel: 'note',
      pluralCamel: 'notes',
      singularSnake: 'note',
      pluralSnake: 'notes',
    });
  });

  it('pluralizes the last word and casing of a multi-word name', () => {
    expect(deriveNames('blog-post')).toEqual({
      singularKebab: 'blog-post',
      pluralKebab: 'blog-posts',
      singularPascal: 'BlogPost',
      pluralPascal: 'BlogPosts',
      singularCamel: 'blogPost',
      pluralCamel: 'blogPosts',
      singularSnake: 'blog_post',
      pluralSnake: 'blog_posts',
    });
  });

  it('applies English pluralization rules', () => {
    expect(deriveNames('category').pluralKebab).toBe('categories');
    expect(deriveNames('box').pluralKebab).toBe('boxes');
    expect(deriveNames('dish').pluralKebab).toBe('dishes');
    expect(deriveNames('gizmo').pluralKebab).toBe('gizmos');
  });
});

describe('validateResourceName', () => {
  it('rejects non-kebab, empty and boundary-dashed names', () => {
    for (const bad of ['Note', 'blog_post', 'blog post', '', '-note', 'note-', '1note', 'note--x']) {
      expect(() => validateResourceName(bad)).toThrow(ResourceNameError);
    }
  });

  it('accepts singular kebab-case names', () => {
    expect(() => validateResourceName('note')).not.toThrow();
    expect(() => validateResourceName('blog-post')).not.toThrow();
  });
});

describe('generateResource', () => {
  it('renders every generated file with valid, fully-substituted TypeScript', () => {
    const result = generateResource({ name: 'blog-post', outDir: sandbox, repoRoot: sandbox });

    expect(result.files.map((file) => file.path)).toEqual([
      'core/domain/blog-post.ts',
      'core/server/usecases/blog-posts.ts',
      'core/server/usecases/blog-posts.test.ts',
      'adapters/db/blog-posts-repository.ts',
      'apps/web/src/features/blog-posts/BlogPostsPage.tsx',
      'apps/web/src/routes/blog-posts.tsx',
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

    expect(result.files[0]?.contents).toContain('export const blogPostSchema');
    expect(result.files[1]?.contents).toContain('export const listBlogPosts');
    expect(result.files[3]?.contents).toContain('createBlogPostRepository');
  });

  it('emits a checklist that ends with the verification ritual and stays RED', () => {
    const { checklist } = generateResource({
      name: 'gadget',
      outDir: sandbox,
      repoRoot: sandbox,
      dryRun: true,
    });
    expect(checklist).toContain('npm run check` will stay RED');
    expect(checklist).toContain('write core tests before wiring the UI');
    expect(checklist).toContain('npm run check && npm run smoke');
    expect(checklist).toContain("path: '/api/gadgets'");
  });

  it('does not write files in dry-run mode', () => {
    generateResource({ name: 'sprocket', outDir: sandbox, repoRoot: sandbox, dryRun: true });
    expect(() => readFileSync(join(sandbox, 'core/domain/sprocket.ts'), 'utf8')).toThrow();
  });

  it('refuses reserved names that collide with existing resources', () => {
    expect(() => generateResource({ name: 'todo', outDir: sandbox, repoRoot: demoRoot })).toThrow(
      ResourceNameError,
    );
  });

  it('refuses to overwrite an existing file', () => {
    const collidingRoot = mkdtempSync(join(tmpdir(), 'new-resource-collide-'));
    try {
      const domainFile = join(collidingRoot, 'core/domain/widget.ts');
      mkdirSync(dirname(domainFile), { recursive: true });
      writeFileSync(domainFile, 'export const widgetSchema = 1;\n');
      expect(() =>
        generateResource({ name: 'widget', outDir: collidingRoot, repoRoot: collidingRoot }),
      ).toThrow(ResourceNameError);
    } finally {
      rmSync(collidingRoot, { recursive: true, force: true });
    }
  });
});
