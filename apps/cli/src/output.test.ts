import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EXIT_CODE_BY_ERROR_CODE } from '#core/contract/index.js';
import { ERROR_CODES, appError, err, ok } from '#core/domain/index.js';

import { emit } from './output.js';

describe('emit', () => {
  beforeEach(() => {
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  describe('--json mode', () => {
    it('prints exactly one JSON envelope wrapping the value on success', () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      emit(ok({ status: 'ok', database: 'up' }), true, () => 'human ignored');

      expect(log).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
      const [line] = log.mock.calls[0] ?? [];
      expect(JSON.parse(String(line))).toEqual({
        ok: true,
        data: { status: 'ok', database: 'up' },
      });
    });

    it('prints exactly one JSON envelope wrapping the error on failure', () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      emit(err(appError('not_found', 'nope')), true, () => 'human ignored');

      expect(log).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
      const [line] = log.mock.calls[0] ?? [];
      expect(JSON.parse(String(line))).toEqual({
        ok: false,
        error: { code: 'not_found', message: 'nope' },
      });
    });

    it('does not call the human formatter in JSON mode', () => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const human = vi.fn(() => 'human');

      emit(ok({ status: 'ok' }), true, human);

      expect(human).not.toHaveBeenCalled();
    });
  });

  describe('human mode', () => {
    it('writes the formatted line to stdout on success', () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      emit(ok({ name: 'Acme' }), false, (value) => `tenant: ${value.name}`);

      expect(log).toHaveBeenCalledExactlyOnceWith('tenant: Acme');
      expect(error).not.toHaveBeenCalled();
    });

    it('writes the error to stderr, never stdout, on failure', () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      emit(err(appError('unauthorized', 'Login required')), false, () => 'unused');

      expect(log).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledExactlyOnceWith('error(unauthorized): Login required');
    });
  });

  describe('exit-code mapping', () => {
    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('leaves the exit code untouched (success = 0) for an ok result', () => {
      emit(ok({}), true, () => '');
      expect(process.exitCode).toBe(0);
    });

    it('maps unauthorized to exit code 3', () => {
      emit(err(appError('unauthorized', 'x')), true, () => '');
      expect(process.exitCode).toBe(3);
    });

    it('maps not_found to exit code 5', () => {
      emit(err(appError('not_found', 'x')), true, () => '');
      expect(process.exitCode).toBe(5);
    });

    it('maps validation to exit code 2', () => {
      emit(err(appError('validation', 'x')), false, () => '');
      expect(process.exitCode).toBe(2);
    });

    it('respects EXIT_CODE_BY_ERROR_CODE for every taxonomy code', () => {
      for (const code of ERROR_CODES) {
        process.exitCode = 0;
        emit(err(appError(code, 'boom')), true, () => '');
        expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE[code]);
      }
    });
  });
});
