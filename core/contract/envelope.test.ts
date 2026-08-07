import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { err, ok, type AppError } from '#core/domain/index.js';

import {
  apiErrorSchema,
  envelopeSchema,
  looseEnvelopeSchema,
  toEnvelope,
} from './envelope.js';

const payloadSchema = z.object({ value: z.number() });

describe('apiErrorSchema', () => {
  it('parses a valid error', () => {
    expect(apiErrorSchema.parse({ code: 'not_found', message: 'gone' })).toEqual({
      code: 'not_found',
      message: 'gone',
    });
  });

  it('rejects an unknown code', () => {
    expect(apiErrorSchema.safeParse({ code: 'teapot', message: 'x' }).success).toBe(false);
  });
});

describe('toEnvelope', () => {
  it('wraps an ok result and round-trips through the schema', () => {
    const envelope = toEnvelope(ok({ value: 1 }));
    expect(envelope).toEqual({ ok: true, data: { value: 1 } });
    expect(envelopeSchema(payloadSchema).parse(envelope)).toEqual(envelope);
  });

  it('wraps an err result and round-trips through the schema', () => {
    const error: AppError = { code: 'validation', message: 'bad', details: ['x'] };
    const envelope = toEnvelope(err(error));
    expect(envelope).toEqual({ ok: false, error });
    expect(envelopeSchema(payloadSchema).parse(envelope)).toEqual(envelope);
  });
});

describe('envelopeSchema', () => {
  it('rejects an ok envelope whose data fails the inner schema', () => {
    expect(
      envelopeSchema(payloadSchema).safeParse({ ok: true, data: { value: 'no' } }).success,
    ).toBe(false);
  });

  it('rejects an envelope missing the discriminant', () => {
    expect(envelopeSchema(payloadSchema).safeParse({ data: { value: 1 } }).success).toBe(false);
  });
});

describe('looseEnvelopeSchema', () => {
  it('accepts arbitrary data on the ok branch', () => {
    expect(looseEnvelopeSchema.parse({ ok: true, data: { anything: [1, 2] } })).toEqual({
      ok: true,
      data: { anything: [1, 2] },
    });
  });

  it('validates the error on the err branch', () => {
    const envelope = { ok: false, error: { code: 'internal', message: 'boom' } };
    expect(looseEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it('rejects an err branch with an invalid code', () => {
    expect(
      looseEnvelopeSchema.safeParse({ ok: false, error: { code: 'nope', message: 'x' } }).success,
    ).toBe(false);
  });
});
