import type {
  Document,
  PdfSealMetadata,
  TenantDateMode,
} from '#core/domain/index.js';

import type {
  IdGenerator,
  PdfSealPort,
  SignatureRecordRepository,
  TenantSettingsRepository,
  WarningLoggerPort,
} from '../ports.js';

export interface PdfSealingDeps {
  ids: IdGenerator;
  pdfSeal: PdfSealPort;
  signatureRecords: SignatureRecordRepository;
  tenantSettings: TenantSettingsRepository;
  warnings: WarningLoggerPort;
}

export const sealSigningTime = (
  dateMode: TenantDateMode,
  documentDate: string,
  appliedAt: Date,
): Date =>
  dateMode === 'actual'
    ? appliedAt
    : new Date(`${documentDate}T${appliedAt.toISOString().slice(11, 19)}.000Z`);

export const attemptPdfSeal = async (
  input: { tenantId: string; document: Document; bytes: Uint8Array },
  deps: PdfSealingDeps,
): Promise<{ bytes: Uint8Array; metadata: PdfSealMetadata } | null> => {
  try {
    const settings = await deps.tenantSettings.get(input.tenantId);
    if (!settings?.pdfSealEnabled) return null;
    if (!deps.pdfSeal.configured) {
      deps.warnings.warn('PDF seal skipped because certificate environment variables are absent', {
        tenantId: input.tenantId,
        documentId: input.document.id,
      });
      return null;
    }
    const appliedAt = new Date();
    const signingTime = sealSigningTime(
      settings.dateMode,
      input.document.documentDate,
      appliedAt,
    );
    const sealed = await deps.pdfSeal.seal({
      bytes: input.bytes,
      signingTime,
    });
    return {
      bytes: sealed.bytes,
      metadata: {
        subject: sealed.subject,
        declaredAt: signingTime.toISOString(),
        appliedAt: appliedAt.toISOString(),
      },
    };
  } catch (cause) {
    // WHY: an organization seal is an evidence layer and must never discard a completed handwritten signing.
    deps.warnings.warn('PDF seal failed; preserving the uploaded PDF without a seal', {
      tenantId: input.tenantId,
      documentId: input.document.id,
      cause: String(cause),
    });
    return null;
  }
};

export const recordPdfSeal = async (
  input: {
    tenantId: string;
    documentId: string;
    fileId: string;
    signedBy: string;
    metadata: PdfSealMetadata;
  },
  deps: Pick<PdfSealingDeps, 'ids' | 'signatureRecords' | 'warnings'>,
): Promise<void> => {
  if (!deps.signatureRecords.recordSeal) return;
  try {
    await deps.signatureRecords.recordSeal({
      id: deps.ids.nextId(),
      tenantId: input.tenantId,
      documentId: input.documentId,
      fileId: input.fileId,
      signedBy: input.signedBy,
      seal: input.metadata,
    });
  } catch (cause) {
    // WHY: metadata persistence cannot make an already stored and sealed signing appear to have failed.
    deps.warnings.warn('PDF seal metadata could not be stored', {
      tenantId: input.tenantId,
      documentId: input.documentId,
      fileId: input.fileId,
      cause: String(cause),
    });
  }
};
