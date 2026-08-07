import { describe, expect, it } from 'vitest';

import { newTodoSchema, todoSchema } from './todo.js';

describe('todoSchema', () => {
  const valid = {
    id: 't1',
    tenantId: 'acme',
    title: 'Buy milk',
    createdBy: 'u1',
    createdAt: '2026-07-03T00:00:00.000Z',
  };

  it('parses a valid todo', () => {
    expect(todoSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an empty title', () => {
    expect(todoSchema.safeParse({ ...valid, title: '' }).success).toBe(false);
  });

  it('rejects a title over 500 chars', () => {
    expect(todoSchema.safeParse({ ...valid, title: 'x'.repeat(501) }).success).toBe(false);
  });

  it('rejects a non-datetime createdAt', () => {
    expect(todoSchema.safeParse({ ...valid, createdAt: 'yesterday' }).success).toBe(false);
  });

  it('rejects a missing field', () => {
    expect(todoSchema.safeParse({ ...valid, id: undefined }).success).toBe(false);
  });
});

describe('newTodoSchema', () => {
  it('trims and accepts a valid title', () => {
    expect(newTodoSchema.parse({ title: '  hello  ' })).toEqual({ title: 'hello' });
  });

  it('rejects a whitespace-only title', () => {
    const result = newTodoSchema.safeParse({ title: '   ' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Title must not be empty');
    }
  });

  it('rejects a title over 500 chars', () => {
    const result = newTodoSchema.safeParse({ title: 'x'.repeat(501) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Title too long');
    }
  });
});
