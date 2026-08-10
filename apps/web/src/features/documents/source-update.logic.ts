import type { SourceUpdateMode, SourceUpdateRequest } from '#core/domain/index.js';

export const sourceUpdateCanSubmit = (
  file: Pick<File, 'type'> | undefined,
  mode: SourceUpdateMode | undefined,
): boolean =>
  Boolean(
    file &&
      mode &&
      (mode !== 'transfer' || file.type === 'application/pdf'),
  );

export const sourceUpdateNeedsReplay = (
  request: SourceUpdateRequest,
  signatureRecordCount: number,
): boolean =>
  request.mode === 'transfer' &&
  signatureRecordCount > 0 &&
  request.approvals.every((approval) => approval.decision === 'accepted');

export const sourceUpdateReadyToComplete = (
  request: SourceUpdateRequest,
): boolean =>
  request.status === 'pending' &&
  request.approvals.every((approval) => approval.decision === 'accepted');
