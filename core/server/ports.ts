import type {
  AppError,
  ApiToken,
  Document,
  DocumentFile,
  DocumentListFilter,
  PadSession,
  PadSignatureRequest,
  PadSubmittedStrokes,
  SavedSearch,
  Result,
  StaffRole,
  Tenant,
  TenantDomain,
  UserPreference,
  UserPreferenceValue,
} from '#core/domain/index.js';

export interface DocumentRepository {
  listByTenant(tenantId: string, filter: DocumentListFilter): Promise<Document[]>;
  listDeletedByTenant(tenantId: string): Promise<Document[]>;
  findById(tenantId: string, documentId: string): Promise<Document | null>;
  findDeletedById(tenantId: string, documentId: string): Promise<Document | null>;
  findAnyById(tenantId: string, documentId: string): Promise<Document | null>;
  listFiles(tenantId: string, documentId: string): Promise<DocumentFile[]>;
  listFilesIncludingDeleted(tenantId: string, documentId: string): Promise<DocumentFile[]>;
  listFilesForDocuments(
    tenantId: string,
    documentIds: string[],
  ): Promise<DocumentFile[]>;
  create(
    input: Omit<Document, 'createdAt' | 'updatedAt' | 'deletedAt' | 'draft'> & { draft?: boolean },
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
  delete(tenantId: string, documentId: string): Promise<boolean>;
  restore(tenantId: string, documentId: string): Promise<Document | null>;
  purge(tenantId: string, documentId: string): Promise<boolean>;
  createFile(
    tenantId: string,
    input: Omit<DocumentFile, 'createdAt'>,
  ): Promise<DocumentFile | null>;
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

export interface SavedSearchRepository {
  listByTenant(tenantId: string): Promise<SavedSearch[]>;
  create(input: Omit<SavedSearch, 'createdAt'>): Promise<SavedSearch>;
  delete(tenantId: string, savedSearchId: string): Promise<boolean>;
}

export interface UserPreferenceRepository {
  get(userId: string, key: string): Promise<UserPreference | null>;
  set(userId: string, key: string, value: UserPreferenceValue): Promise<UserPreference>;
}

export interface PadSessionRepository {
  create(
    input: Omit<PadSession, 'createdAt' | 'currentRequest' | 'submittedStrokes' | 'status'>,
  ): Promise<PadSession>;
  findById(tenantId: string, sessionId: string): Promise<PadSession | null>;
  requestSignature(
    tenantId: string,
    sessionId: string,
    request: PadSignatureRequest,
  ): Promise<PadSession | null>;
  submitStrokes(
    tenantId: string,
    sessionId: string,
    strokes: PadSubmittedStrokes,
  ): Promise<PadSession | null>;
  consumeStrokes(tenantId: string, sessionId: string): Promise<PadSubmittedStrokes | null>;
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
