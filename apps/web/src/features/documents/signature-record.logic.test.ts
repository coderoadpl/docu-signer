import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SIGNING_INK_SIZE,
  DEFAULT_SIGNING_INK_COLOR,
  createSigningStamp,
} from './signing.js';
import {
  signatureRecordPayload,
  storeSignatureRecordAfterUpload,
} from './signature-record.logic.js';

const documentId = '11111111-1111-4111-8111-111111111111';
const fileId = '22222222-2222-4222-8222-222222222222';
const stamps = [
  createSigningStamp({
    pageIndex: 1,
    strokes: [
      {
        points: [{ x: 0.2, y: 0.3, pressure: 0.8 }],
        simulatePressure: false,
      },
    ],
    placement: { offsetX: 0.1, offsetY: -0.2, scale: 1.25 },
    inkColor: DEFAULT_SIGNING_INK_COLOR,
    inkSize: 3,
    contributedBy: { accountId: 'user-owner', label: 'Owner' },
  }),
];

describe('signature record signing hook', () => {
  it('normalizes an omitted stamp ink size in a new contributor-aware payload', () => {
    const stamp = stamps[0];
    if (!stamp) throw new Error('Expected a stamp fixture');
    const { inkSize, ...stampWithoutInkSize } = stamp;
    expect(inkSize).toBe(3);
    expect(
      signatureRecordPayload([stampWithoutInkSize])[0]?.inkSize,
    ).toBe(DEFAULT_SIGNING_INK_SIZE);
  });

  it('posts the exact stamp payload when the tenant setting is on', async () => {
    const create = vi.fn(async () => undefined);

    await expect(
      storeSignatureRecordAfterUpload({
        create,
        documentId,
        fileId,
        stamps,
        storeSignatureRecords: true,
      }),
    ).resolves.toBeNull();
    expect(create).toHaveBeenCalledWith({
      documentId,
      input: {
        fileId,
        payload: [
          {
            strokes: [
              {
                points: [{ x: 0.2, y: 0.3, pressure: 0.8 }],
                simulatePressure: false,
              },
            ],
            pageIndex: 1,
            placement: { offsetX: 0.1, offsetY: -0.2, scale: 1.25 },
            inkColor: 'black',
            inkSize: 3,
            contributedBy: 'user-owner',
          },
        ],
      },
    });
  });

  it('does nothing when the tenant setting is off', async () => {
    const create = vi.fn(async () => undefined);

    await expect(
      storeSignatureRecordAfterUpload({
        create,
        documentId,
        fileId,
        stamps,
        storeSignatureRecords: false,
      }),
    ).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('returns a non-blocking warning when record storage fails', async () => {
    const create = vi.fn(async () => Promise.reject(new Error('offline')));

    await expect(
      storeSignatureRecordAfterUpload({
        create,
        documentId,
        fileId,
        stamps,
        storeSignatureRecords: true,
      }),
    ).resolves.toMatch(/PDF zapisano/i);
  });
});
