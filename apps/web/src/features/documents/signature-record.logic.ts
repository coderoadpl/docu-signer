import type { CreateSignatureRecord } from '#core/domain/index.js';

import {
  DEFAULT_SIGNING_INK_SIZE,
  type SigningStamp,
} from './signing.js';

export const signatureRecordPayload = (
  stamps: readonly SigningStamp[],
): CreateSignatureRecord['payload'] =>
  stamps.map((stamp) => ({
    strokes: stamp.strokes.map((stroke) => ({
      ...(stroke.simulatePressure === undefined
        ? {}
        : { simulatePressure: stroke.simulatePressure }),
      points: stroke.points.map((point) => ({ ...point })),
    })),
    pageIndex: stamp.pageIndex,
    placement: { ...stamp.placement },
    inkColor: stamp.inkColor.id,
    inkSize: stamp.inkSize ?? DEFAULT_SIGNING_INK_SIZE,
  }));

export const storeSignatureRecordAfterUpload = async ({
  create,
  documentId,
  fileId,
  stamps,
  storeSignatureRecords,
}: {
  create: (input: {
    documentId: string;
    input: CreateSignatureRecord;
  }) => Promise<unknown>;
  documentId: string;
  fileId: string;
  stamps: readonly SigningStamp[];
  storeSignatureRecords: boolean;
}): Promise<string | null> => {
  if (!storeSignatureRecords) return null;
  try {
    await create({
      documentId,
      input: { fileId, payload: signatureRecordPayload(stamps) },
    });
    return null;
  } catch {
    return 'Podpisany PDF zapisano, ale nie udało się zachować zapisu podpisu.';
  }
};
