import { MAX_DOCUMENT_FILE_BYTES } from '#core/domain/index.js';
import type {
  Document,
  PdfSealMetadata,
  TenantDateMode,
} from '#core/domain/index.js';

import type {
  IdGenerator,
  PdfSealPort,
  SignatureRecordRepository,
  TenantAccountRepository,
  TenantSettingsRepository,
  WarningLoggerPort,
} from '../ports.js';

export interface PdfSealingDeps {
  ids: IdGenerator;
  pdfSeal: PdfSealPort;
  signatureRecords: SignatureRecordRepository;
  tenantAccounts: TenantAccountRepository;
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

export const preparePdfSeal = async (
  input: { tenantId: string; documentId: string },
  deps: PdfSealingDeps,
): Promise<TenantDateMode | null> => {
  const settings = await deps.tenantSettings.get(input.tenantId);
  if (!settings?.pdfSealEnabled) return null;
  if (!deps.pdfSeal.configured) {
    deps.warnings.warn('PDF seal skipped because certificate environment variables are absent', {
      tenantId: input.tenantId,
      documentId: input.documentId,
    });
    return null;
  }
  return settings.dateMode;
};

export const attemptPdfSeal = async (
  input: {
    tenantId: string;
    document: Document;
    bytes: Uint8Array;
    dateMode: TenantDateMode;
    contributorAccountIds: string[];
  },
  deps: PdfSealingDeps,
): Promise<{ bytes: Uint8Array; metadata: PdfSealMetadata } | null> => {
  if (!deps.pdfSeal.configured) return null;
  const appliedAt = new Date();
  const signingTime = sealSigningTime(
    input.dateMode,
    input.document.documentDate,
    appliedAt,
  );
  const accounts = await deps.tenantAccounts.listByTenant(input.tenantId);
  const nameByAccountId = new Map(
    accounts.map((account) => [account.accountId, account.name]),
  );
  const contributorAccountIds = [...new Set(input.contributorAccountIds)];
  const contributorNames = contributorAccountIds.flatMap((accountId) => {
    const name = nameByAccountId.get(accountId);
    return name ? [name] : [];
  });
  if (contributorNames.length !== contributorAccountIds.length) {
    deps.warnings.warn('PDF seal skipped because a contributor account could not be resolved', {
      tenantId: input.tenantId,
      documentId: input.document.id,
    });
    return null;
  }
  const sealed = await deps.pdfSeal.seal({
    bytes: input.bytes,
    signingTime,
    contributorNames,
  });
  const outcome = sealed.kind === 'sealed' && sealed.bytes.byteLength > MAX_DOCUMENT_FILE_BYTES
    ? { kind: 'failed', reason: 'size-limit' } as const
    : sealed;
  if (outcome.kind === 'failed') {
    deps.warnings.warn('PDF seal failed; preserving the uploaded PDF without a seal', {
      tenantId: input.tenantId,
      documentId: input.document.id,
      reason: outcome.reason,
    });
    return null;
  }
  return {
    bytes: outcome.bytes,
    metadata: {
      subject: outcome.subject,
      declaredAt: signingTime.toISOString(),
      appliedAt: appliedAt.toISOString(),
    },
  };
};

export const recordPdfSeal = async (
  input: {
    tenantId: string;
    documentId: string;
    fileId: string;
    signedBy: string;
    metadata: PdfSealMetadata;
  },
  deps: Pick<PdfSealingDeps, 'ids' | 'signatureRecords'>,
): Promise<void> => {
  await deps.signatureRecords.recordSeal({
    id: deps.ids.nextId(),
    tenantId: input.tenantId,
    documentId: input.documentId,
    fileId: input.fileId,
    signedBy: input.signedBy,
    seal: input.metadata,
  });
};
