import { describe, expect, it } from 'vitest';

import type { Result } from './result.js';
import { err, isErr, isOk, map, ok, unwrapOr } from './result.js';

describe('result helpers', () => {
  it('ok wraps a value', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('err wraps an error', () => {
    expect(err('boom')).toEqual({ ok: false, error: 'boom' });
  });

  it('isOk narrows a successful result', () => {
    const result: Result<number, string> = ok(1);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
  });

  it('isErr narrows a failed result', () => {
    const result: Result<number, string> = err('nope');
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
  });

  it('unwrapOr returns the value on ok', () => {
    expect(unwrapOr(ok(7), 0)).toBe(7);
  });

  it('unwrapOr returns the fallback on err', () => {
    expect(unwrapOr(err<string>('x'), 99)).toBe(99);
  });

  it('map transforms an ok value', () => {
    expect(map(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
  });

  it('map passes an err through untouched', () => {
    const result: Result<number, string> = err('fail');
    expect(map(result, (n: number) => n * 3)).toEqual({ ok: false, error: 'fail' });
  });
});
