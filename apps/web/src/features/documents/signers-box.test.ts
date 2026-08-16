import { describe, expect, it } from 'vitest';

import { buildSignersBox, formatSignersBoxDate } from './signers-box.js';

const wallClock = new Date('2026-08-15T19:07:59.000Z');

describe('signers box model', () => {
  it('preserves first-signature order and emits one row per account', () => {
    const model = buildSignersBox({
      documentDate: '2026-07-10',
      wallClock,
      signers: [
        { accountId: 'mateusz', name: 'Mateusz Choma' },
        { accountId: 'weronika', name: 'Weronika Choma' },
        { accountId: 'mateusz', name: 'Mateusz Choma' },
      ],
    });

    expect(model?.entries).toEqual([
      {
        accountId: 'mateusz',
        name: 'Mateusz Choma',
        signedAt: '10.07.2026 19:07',
      },
      {
        accountId: 'weronika',
        name: 'Weronika Choma',
        signedAt: '10.07.2026 19:07',
      },
    ]);
  });

  it('formats the entered date with the current wall-clock hour and minute', () => {
    expect(formatSignersBoxDate('2026-06-26', wallClock)).toBe(
      '26.06.2026 19:07',
    );
  });

  it('includes an uppercase seal subject only when supplied', () => {
    expect(
      buildSignersBox({
        documentDate: '2026-07-10',
        wallClock,
        signers: [{ accountId: 'mateusz', name: 'Mateusz Choma' }],
        sealCertificateSubject: 'Amazing Company Sp. z o.o.',
      }),
    ).toMatchObject({
      sealCertificateSubject: 'AMAZING COMPANY SP. Z O.O.',
      subjectHeight: 10,
    });
    expect(
      buildSignersBox({
        documentDate: '2026-07-10',
        wallClock,
        signers: [{ accountId: 'mateusz', name: 'Mateusz Choma' }],
      }),
    ).not.toHaveProperty('sealCertificateSubject');
  });

  it('guards against an empty signing session', () => {
    expect(
      buildSignersBox({
        documentDate: '2026-07-10',
        wallClock,
        signers: [],
      }),
    ).toBeNull();
  });
});
