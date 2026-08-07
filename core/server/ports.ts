import type {
  AppError,
  Document,
  DocumentFile,
  DocumentListFilter,
  Member,
  Membership,
  Result,
  StaffRole,
  Tenant,
  TenantDomain,
  Todo,
} from '#core/domain/index.js';

/**
 * Ports: interfaces the core depends on, implemented in `adapters/`.
 * The core never knows which database, auth provider or platform sits behind them.
 */

export interface TodoRepository {
  listByTenant(tenantId: string): Promise<Todo[]>;
  create(todo: Todo): Promise<void>;
}

export interface DocumentRepository {
  listByTenant(
    tenantId: string,
    filter: DocumentListFilter,
  ): Promise<Result<Document[], AppError>>;
  findById(tenantId: string, documentId: string): Promise<Result<Document | null, AppError>>;
  listFiles(tenantId: string, documentId: string): Promise<Result<DocumentFile[], AppError>>;
  create(
    input: Omit<Document, 'createdAt' | 'updatedAt'>,
  ): Promise<Result<Document, AppError>>;
  update(
    tenantId: string,
    documentId: string,
    input: Pick<Document, 'title' | 'docType' | 'documentDate' | 'person' | 'tags'>,
  ): Promise<Result<Document | null, AppError>>;
  delete(tenantId: string, documentId: string): Promise<Result<boolean, AppError>>;
  createFile(
    tenantId: string,
    input: Omit<DocumentFile, 'createdAt'>,
  ): Promise<Result<DocumentFile | null, AppError>>;
  findFile(
    tenantId: string,
    documentId: string,
    fileId: string,
  ): Promise<Result<DocumentFile | null, AppError>>;
  deleteFile(tenantId: string, documentId: string, fileId: string): Promise<Result<boolean, AppError>>;
}

export interface UploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export interface StoragePort {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<Result<void, AppError>>;
  get(key: string): Promise<Result<Uint8Array | null, AppError>>;
  exists(key: string): Promise<Result<boolean, AppError>>;
  delete(key: string): Promise<Result<void, AppError>>;
  createUploadUrl(key: string, contentType: string): Promise<Result<UploadTarget | null, AppError>>;
}

export interface TenantDomainRepository {
  findByDomain(domain: string): Promise<TenantDomain | null>;
  listVerifiedDomains(): Promise<TenantDomain[]>;
}

export type TenantLookup = { tenantId: string } | { tenantSlug: string };

export interface TenantRepository {
  findById(tenantId: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
  createTenant(input: { id: string; slug: string; name: string; createdAt: string }): Promise<Tenant>;
  createOwnerGrant(input: {
    id: string;
    tenantId: string;
    userId: string;
    staffRole: Extract<StaffRole, 'owner'>;
  }): Promise<void>;
}

export interface TenantAccessReader {
  listTenantsForStaff(userId: string): Promise<Membership[]>;
  findStaffGrant(userId: string, lookup: TenantLookup): Promise<Membership | null>;
  findMember(userId: string, tenantId: string): Promise<Member | null>;
}

/** Established authenticated session, before tenant resolution. */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  name: string;
}

export interface AuthPort {
  /** Returns the authenticated user for a request, or null when anonymous. */
  getAuthenticatedUser(requestHeaders: Headers): Promise<AuthenticatedUser | null>;
}

export interface HealthPort {
  pingDatabase(): Promise<boolean>;
}

export interface IdGenerator {
  nextId(): string;
}

export interface Clock {
  nowIso(): string;
}
