import { describe, expect, it } from 'vitest';

import {
  buildSignersBox,
  formatSignersBoxDate,
  priorSignersBoxEntries,
  signersBoxBounds,
} from './signers-box.js';

const wallClock = new Date(2026, 7, 15, 19, 7, 59);

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

  it('composes chronological prior entries before the current session', () => {
    const priorSigners = priorSignersBoxEntries(
      [
        {
          fileId: 'signed-second',
          signerBoxEntries: [
            {
              accountId: 'weronika',
              name: 'Weronika Choma',
              declaredAt: new Date(2026, 6, 11, 8, 5).toISOString(),
            },
          ],
        },
        {
          fileId: 'signed-first',
          signerBoxEntries: [
            {
              accountId: 'mateusz',
              name: 'Mateusz Choma',
              declaredAt: new Date(2026, 6, 10, 19, 7).toISOString(),
            },
          ],
        },
      ],
      'signed-second',
    );
    const model = buildSignersBox({
      documentDate: '2026-07-12',
      wallClock: new Date(2026, 6, 12, 9, 30),
      priorSigners: priorSigners ?? [],
      signers: [{ accountId: 'anna', name: 'Anna Nowak' }],
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
        signedAt: '11.07.2026 08:05',
      },
      {
        accountId: 'anna',
        name: 'Anna Nowak',
        signedAt: '12.07.2026 09:30',
      },
    ]);
  });

  it('keeps the top-right geometry fixed while every added row grows downward', () => {
    const oneEntry = buildSignersBox({
      documentDate: '2026-07-10',
      wallClock,
      signers: [{ accountId: 'mateusz', name: 'Mateusz Choma' }],
    });
    const twoEntries = buildSignersBox({
      documentDate: '2026-07-10',
      wallClock,
      signers: [
        { accountId: 'mateusz', name: 'Mateusz Choma' },
        { accountId: 'weronika', name: 'Weronika Choma' },
      ],
    });
    if (!oneEntry || !twoEntries) throw new Error('Expected signers boxes');
    const previous = signersBoxBounds(595, 842, oneEntry);
    const cumulative = signersBoxBounds(595, 842, twoEntries);

    expect(twoEntries).toMatchObject({
      width: oneEntry.width,
      margin: oneEntry.margin,
      paddingX: oneEntry.paddingX,
      paddingTop: oneEntry.paddingTop,
      paddingBottom: oneEntry.paddingBottom,
      subjectHeight: oneEntry.subjectHeight,
      headerHeight: oneEntry.headerHeight,
      rowHeight: oneEntry.rowHeight,
    });
    expect(cumulative.x).toBe(previous.x);
    expect(cumulative.width).toBe(previous.width);
    expect(cumulative.y).toBeLessThan(previous.y);
    expect(cumulative.y + cumulative.height).toBe(
      previous.y + previous.height,
    );
    expect(cumulative.y).toBeLessThanOrEqual(previous.y);
    expect(cumulative.x + cumulative.width).toBeGreaterThanOrEqual(
      previous.x + previous.width,
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
