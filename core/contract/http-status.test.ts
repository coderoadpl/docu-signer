import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '#core/domain/index.js';

import { EXIT_CODE_BY_ERROR_CODE, HTTP_STATUS_BY_ERROR_CODE } from './http-status.js';

describe('HTTP_STATUS_BY_ERROR_CODE', () => {
  it('maps every error code to a valid HTTP status (fails when a code is added without a mapping)', () => {
    for (const code of ERROR_CODES) {
      const status = HTTP_STATUS_BY_ERROR_CODE[code];
      expect(status, `missing HTTP status for ${code}`).toBeTypeOf('number');
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it('has no mappings for codes outside ERROR_CODES', () => {
    expect(Object.keys(HTTP_STATUS_BY_ERROR_CODE).sort()).toEqual([...ERROR_CODES].sort());
  });
});

describe('EXIT_CODE_BY_ERROR_CODE', () => {
  it('maps every error code to a nonzero exit code (fails when a code is added without a mapping)', () => {
    for (const code of ERROR_CODES) {
      const exit = EXIT_CODE_BY_ERROR_CODE[code];
      expect(exit, `missing exit code for ${code}`).toBeTypeOf('number');
      expect(exit).toBeGreaterThan(0);
    }
  });

  it('has no mappings for codes outside ERROR_CODES', () => {
    expect(Object.keys(EXIT_CODE_BY_ERROR_CODE).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('assigns a distinct exit code per error code', () => {
    const exits = ERROR_CODES.map((code) => EXIT_CODE_BY_ERROR_CODE[code]);
    expect(new Set(exits).size).toBe(exits.length);
  });
});
