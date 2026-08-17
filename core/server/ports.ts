import type {
  AppError,
  ApiToken,
  Document,
  DocumentComment,
  DocumentCommentCursor,
  DocumentCommentListItem,
  DocumentMetadataChanges,
  DocumentMetadataProposal,
  DocumentMetadataProposalCursor,
  DocumentMetadataProposalListItem,
  DocumentFile,
  DocumentLink,
  DocumentListFilter,
  DocumentType,
  DocumentWithSigners,
  Invitation,
  LinkedDocument,
  PadSession,
  PadCurrentDocument,
  PadParticipant,
  PadQueuedSubmission,
  PadSessionMode,
  PadSignatureRequest,
  PadSubmittedStrokes,
  PendingDraftCounts,
  PdfSealVerification,
  PdfSealMetadata,
  PublicInvitation,
  SavedSearch,
  SignatureRecord,
  SignatureRecordCursor,
  SignatureRecordPayload,
  SourceUpdateApprovalDecision,
  SourceUpdateMode,
  SourceUpdateRequest,
  Result,
  StaffRole,
  Tenant,
  TenantDomain,
  TenantSettings,
  TenantAccount,
  UserPreference,
  UserPreferenceValue,
} from '#core/domain/index.js';

export interface DocumentRepository {
  listByTenant(tenantId: string, filter: DocumentListFilter): Promise<DocumentWithSigners[]>;
  listDeletedByTenant(tenantId: string): Promise<Document[]>;
  findById(tenantId: string, documentId: string): Promise<Document | null>;
  findDeletedById(tenantId: string, documentId: string): Promise<Document | null>;
  findAnyById(tenantId: string, documentId: string): Promise<Document | null>;
  getPendingDraftCounts(tenantId: string, documentId: string): Promise<PendingDraftCounts>;
  listFiles(tenantId: string, documentId: string): Promise<DocumentFile[]>;
  listFilesIncludingDeleted(tenantId: string, documentId: string): Promise<DocumentFile[]>;
  listAllFilesIncludingDeleted(tenantId: string, documentId: string): Promise<DocumentFile[]>;
  listFilesForDocuments(
    tenantId: string,
    documentIds: string[],
  ): Promise<DocumentFile[]>;
  create(
    input: Omit<
      Document,
      'createdAt' | 'updatedAt' | 'deletedAt' | 'draft' | 'signatureNotRequired'
    > & { draft?: boolean; signatureNotRequired?: boolean },
  ): Promise<Document>;
  update(
    tenantId: string,
    documentId: string,
    input: Pick<
      Document,
      'title' | 'docType' | 'documentDate' | 'periodStart' | 'periodEnd' | 'person' | 'tags'
    >,
  ): Promise<Document | null>;
  approve(tenantId: string, documentId: string): Promise<Document | null>;
  unapprove(tenantId: string, documentId: string): Promise<Document | null>;
  waiveSignature(tenantId: string, documentId: string): Promise<Document | null>;
  requireSignature(tenantId: string, documentId: string): Promise<Document | null>;
  delete(tenantId: string, documentId: string): Promise<boolean>;
  restore(tenantId: string, documentId: string): Promise<Document | null>;
  purge(tenantId: string, documentId: string): Promise<boolean>;
  createFile(
    tenantId: string,
    input: Omit<DocumentFile, 'createdAt'>,
  ): Promise<DocumentFile | null>;
  updateFileSize(
    tenantId: string,
    documentId: string,
    fileId: string,
    sizeBytes: number,
  ): Promise<boolean>;
  findFile(
    tenantId: string,
    documentId: string,
    fileId: string,
  ): Promise<DocumentFile | null>;
  moveFileToDocument(
    tenantId: string,
    sourceDocumentId: string,
    fileId: string,
    targetDocumentId: string,
  ): Promise<DocumentFile | null>;
  deleteFile(tenantId: string, documentId: string, fileId: string): Promise<boolean>;
}

export interface DocumentMetadataProposalRepository {
  listPendingByDocuments(
    tenantId: string,
    documentIds: string[],
  ): Promise<DocumentMetadataProposal[]>;
  listByDocument(
    tenantId: string,
    documentId: string,
    cursor: DocumentMetadataProposalCursor | null,
    limit: number,
  ): Promise<DocumentMetadataProposalListItem[]>;
  create(
    input: Omit<DocumentMetadataProposal, 'createdAt'>,
  ): Promise<DocumentMetadataProposalListItem>;
  findById(
    tenantId: string,
    proposalId: string,
  ): Promise<DocumentMetadataProposal | null>;
  apply(
    tenantId: string,
    proposalId: string,
    changes: DocumentMetadataChanges,
  ): Promise<Document | null>;
  reject(tenantId: string, proposalId: string): Promise<boolean>;
}

export interface DocumentTypeRepository {
  listByTenant(tenantId: string): Promise<DocumentType[]>;
  findBySlug(tenantId: string, slug: string): Promise<DocumentType | null>;
  create(input: DocumentType & { tenantId: string }): Promise<DocumentType | null>;
  rename(tenantId: string, slug: string, label: string): Promise<DocumentType | null>;
  delete(tenantId: string, slug: string): Promise<boolean>;
  isUsedByAnyDocument(tenantId: string, slug: string): Promise<boolean>;
}

export interface DocumentCommentRepository {
  listByDocument(
    tenantId: string,
    documentId: string,
    cursor: DocumentCommentCursor | null,
    limit: number,
  ): Promise<DocumentCommentListItem[]>;
  create(input: Omit<DocumentComment, 'createdAt'>): Promise<DocumentCommentListItem>;
  approve(tenantId: string, commentId: string): Promise<DocumentCommentListItem | null>;
  findById(
    tenantId: string,
    documentId: string,
    commentId: string,
  ): Promise<DocumentComment | null>;
  delete(tenantId: string, documentId: string, commentId: string): Promise<boolean>;
}

export interface DocumentLinkRepository {
  create(
    tenantId: string,
    input: Omit<DocumentLink, 'tenantId'>,
  ): Promise<DocumentLink | null>;
  findBetween(
    tenantId: string,
    firstDocumentId: string,
    secondDocumentId: string,
  ): Promise<DocumentLink | null>;
  listForDocument(tenantId: string, documentId: string): Promise<LinkedDocument[]>;
  approve(tenantId: string, linkId: string): Promise<DocumentLink | null>;
  deleteBetween(
    tenantId: string,
    firstDocumentId: string,
    secondDocumentId: string,
  ): Promise<boolean>;
}

export interface TenantAccountRepository {
  listByTenant(tenantId: string): Promise<TenantAccount[]>;
}

export interface ApiTokenWithHash extends ApiToken {
  tokenHash: string;
}

export interface ApiTokenIdentity {
  token: ApiTokenWithHash;
  user: AuthenticatedUser;
}

export interface ApiTokenRepository {
  create(input: Omit<ApiTokenWithHash, 'createdAt' | 'lastUsedAt' | 'revokedAt'>): Promise<ApiToken>;
  listByUser(userId: string): Promise<ApiToken[]>;
  findActiveByHash(tokenHash: string): Promise<ApiTokenIdentity | null>;
  markUsed(apiTokenId: string): Promise<void>;
  revoke(userId: string, apiTokenId: string): Promise<boolean>;
}

export interface ApiTokenSecretPort {
  generate(): string;
  hash(value: string): string;
  matchesHash(value: string, tokenHash: string): boolean;
}

export interface InvitationWithHash extends Invitation {
  tokenHash: string;
}

export interface InvitationRepository {
  createOrReplace(input: Omit<InvitationWithHash, 'status'>): Promise<Invitation>;
  listByTenant(tenantId: string): Promise<Invitation[]>;
  findByTokenHash(tokenHash: string): Promise<(InvitationWithHash & PublicInvitation) | null>;
  hasAccount(email: string): Promise<boolean>;
  accept(invitationId: string, userId: string): Promise<boolean>;
  revoke(tenantId: string, invitationId: string): Promise<boolean>;
  expire(invitationId: string): Promise<void>;
  expirePastDue(tenantId: string, now: string): Promise<void>;
}

export interface InvitationSecretPort {
  generate(): string;
  hash(value: string): string;
  matchesHash(value: string, tokenHash: string): boolean;
}

export interface InvitationAuthPort {
  createAccount(input: { email: string; password: string; name: string }): Promise<{ userId: string }>;
}

export interface RateLimitPort {
  consume(key: string, max: number, windowSeconds: number): Promise<boolean>;
}

export interface SavedSearchRepository {
  listByTenant(tenantId: string): Promise<SavedSearch[]>;
  create(input: Omit<SavedSearch, 'createdAt'>): Promise<SavedSearch>;
  delete(tenantId: string, savedSearchId: string): Promise<boolean>;
}

export interface UserPreferenceRepository {
  get(userId: string, key: string): Promise<UserPreference | null>;
  set(userId: string, key: string, value: UserPreferenceValue): Promise<UserPreference>;
}

export interface TenantSettingsRepository {
  get(tenantId: string): Promise<TenantSettings | null>;
  set(
    tenantId: string,
    settings: Omit<TenantSettings, 'tenantId' | 'sealCertificateSubject'>,
  ): Promise<TenantSettings>;
}

export interface SignatureRecordRepository {
  listByDocument(
    tenantId: string,
    documentId: string,
    cursor: SignatureRecordCursor | null,
    limit: number,
  ): Promise<SignatureRecord[]>;
  create(input: {
    id: string;
    tenantId: string;
    documentId: string;
    fileId: string;
    signedBy: string;
    payload: SignatureRecordPayload;
  }): Promise<SignatureRecord | null>;
  recordSeal(input: {
    id: string;
    tenantId: string;
    documentId: string;
    fileId: string;
    signedBy: string;
    seal: PdfSealMetadata;
  }): Promise<void>;
}

export type PdfSealPort =
  | { configured: false }
  | {
      configured: true;
      seal(input: {
        bytes: Uint8Array;
        signingTime: Date;
        contributorNames: string[];
      }): Promise<
        | { kind: 'sealed'; bytes: Uint8Array; subject: string }
        | { kind: 'failed'; reason: string }
      >;
    };

export interface PdfSealVerificationPort {
  verify(bytes: Uint8Array): PdfSealVerification;
}

export interface WarningLoggerPort {
  warn(message: string, details?: Record<string, unknown>): void;
}

export interface SourceUpdateRequestRepository {
  create(input: {
    id: string;
    tenantId: string;
    documentId: string;
    requestedBy: string;
    newSourceFileId: string;
    mode: SourceUpdateMode;
    approvalIds: Array<{ id: string; approverId: string }>;
  }): Promise<SourceUpdateRequest | null>;
  findById(tenantId: string, requestId: string): Promise<SourceUpdateRequest | null>;
  findActiveByDocument(
    tenantId: string,
    documentId: string,
  ): Promise<SourceUpdateRequest | null>;
  listPendingByApprover(
    tenantId: string,
    approverId: string,
  ): Promise<SourceUpdateRequest[]>;
  decide(
    tenantId: string,
    requestId: string,
    approverId: string,
    decision: Exclude<SourceUpdateApprovalDecision, 'pending'>,
  ): Promise<SourceUpdateRequest | null>;
  cancel(
    tenantId: string,
    requestId: string,
    requestedBy: string,
  ): Promise<SourceUpdateRequest | null>;
  complete(input: {
    tenantId: string;
    requestId: string;
    completedBy: string;
    signedFileId: string | null;
  }): Promise<SourceUpdateRequest | null>;
}

export interface PadSessionRepository {
  create(
    input: Omit<
      PadSession,
      'createdAt' | 'currentDocument' | 'currentRequest' | 'lastPolledAt' | 'submittedStrokes' | 'status'
    >,
  ): Promise<PadSession>;
  findById(tenantId: string, sessionId: string): Promise<PadSession | null>;
  findActiveByUser(tenantId: string, userId: string): Promise<PadSession | null>;
  findActiveShared(tenantId: string, excludeUserId: string): Promise<PadSession | null>;
  setMode(
    tenantId: string,
    sessionId: string,
    mode: PadSessionMode,
  ): Promise<PadSession | null>;
  renew(
    tenantId: string,
    sessionId: string,
    expiresAt: string,
    lastPolledAt: string,
  ): Promise<PadSession | null>;
  requestSignature(
    tenantId: string,
    sessionId: string,
    request: PadSignatureRequest,
  ): Promise<PadSession | null>;
  setCurrentDocument(
    tenantId: string,
    sessionId: string,
    document: PadCurrentDocument,
  ): Promise<PadSession | null>;
  submitStrokes(
    tenantId: string,
    sessionId: string,
    strokes: PadSubmittedStrokes,
  ): Promise<PadSession | null>;
  consumeStrokes(tenantId: string, sessionId: string): Promise<PadSubmittedStrokes | null>;
  touchParticipant(
    tenantId: string,
    sessionId: string,
    participant: PadParticipant & { id: string },
  ): Promise<void>;
  listParticipants(tenantId: string, sessionId: string): Promise<PadParticipant[]>;
  removeParticipant(tenantId: string, sessionId: string, accountId: string): Promise<boolean>;
  enqueueSubmission(
    tenantId: string,
    sessionId: string,
    submission: PadQueuedSubmission,
  ): Promise<void>;
  listSubmissions(tenantId: string, sessionId: string): Promise<PadQueuedSubmission[]>;
  consumeSubmission(
    tenantId: string,
    sessionId: string,
    submissionId: string,
  ): Promise<PadQueuedSubmission | null>;
  close(tenantId: string, sessionId: string): Promise<boolean>;
}

export interface PadSessionSecretPort {
  generate(): string;
  hash(value: string): string;
  matchesHash(value: string, tokenHash: string): boolean;
}

export interface UploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export interface StorageMetadata {
  contentType: string;
  sizeBytes: number;
}

export interface StoragePort {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<Result<void, AppError>>;
  get(key: string): Promise<Result<Uint8Array | null, AppError>>;
  head(key: string): Promise<Result<StorageMetadata | null, AppError>>;
  delete(key: string): Promise<Result<void, AppError>>;
  createUploadUrl(key: string, contentType: string): Promise<Result<UploadTarget | null, AppError>>;
}

export interface BackupBlobInventoryItem {
  pathname: string;
  etag: string;
  sizeBytes: number;
}

export interface BackupBlobPage {
  items: readonly BackupBlobInventoryItem[];
  nextCursor: string | null;
}

export interface BackupBlobContent extends BackupBlobInventoryItem {
  contentType: string;
  stream: ReadableStream<Uint8Array>;
}

export interface BackupStoragePort {
  listPage(cursor: string | null): Promise<Result<BackupBlobPage, AppError>>;
  getStream(key: string): Promise<Result<BackupBlobContent | null, AppError>>;
}

export interface TenantDomainRepository {
  findByDomain(domain: string): Promise<TenantDomain | null>;
  listVerifiedDomains(): Promise<TenantDomain[]>;
}

export interface TenantRepository {
  findById(tenantId: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
}

export interface TenantAccessReader {
  findStaffGrant(
    userId: string,
    tenantId: string,
  ): Promise<{ staffRole: StaffRole } | null>;
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
  name: string;
}

export interface AuthPort {
  getAuthenticatedUser(requestHeaders: Headers): Promise<AuthenticatedUser | null>;
}

export interface HealthPort {
  pingDatabase(): Promise<boolean>;
}

interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  link?: string;
}

export interface EmailPort {
  sendMail(message: EmailMessage): Promise<void>;
}

export interface IdGenerator {
  nextId(): string;
}
