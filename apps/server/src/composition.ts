import { randomUUID } from 'node:crypto';

import { createDb } from '#adapters/db/client.js';
import { createDocumentRepository } from '#adapters/db/documents-repository.js';
import {
  createHealthPort,
  createTenantAccessReader,
  createTenantDomainRepository,
  createTenantRepository,
  createTodoRepository,
} from '#adapters/db/repositories.js';
import { createLocalFsStorage } from '#adapters/storage/local-fs.js';
import { createVercelBlobStorage } from '#adapters/storage/vercel-blob.js';
import { createAuth, createAuthPort, type Auth } from '#adapters/auth/create-auth.js';
import type {
  AuthPort,
  Clock,
  DocumentRepository,
  HealthPort,
  IdGenerator,
  StoragePort,
  TenantAccessReader,
  TenantDomainRepository,
  TenantRepository,
  TodoRepository,
} from '#core/server/index.js';

import type { Env } from './env.js';

export interface AppDeps {
  auth: Auth;
  authPort: AuthPort;
  todos: TodoRepository;
  documents: DocumentRepository;
  storage: StoragePort;
  tenantDomains: TenantDomainRepository;
  tenants: TenantRepository;
  tenantAccess: TenantAccessReader;
  health: HealthPort;
  ids: IdGenerator;
  clock: Clock;
  baseDomain: string;
}

/**
 * Composition root — the ONLY place where env decides which adapters run.
 * Platform names (vercel, neon) may appear here and in adapters, never in core.
 */
export const createDeps = (env: Env): AppDeps => {
  const db = createDb(env.DB_DRIVER, env.DATABASE_URL);
  const tenantDomains = createTenantDomainRepository(db);
  const storage = createStorage(env);

  const baseTrustedOrigins = [
    env.APP_BASE_URL,
    // Vite dev server serves the SPA from its own port, so local auth POSTs
    // carry this Origin; Vercel deployments never do (SPA shares the API origin).
    ...(env.VERCEL_URL ? [] : [`http://${env.APP_BASE_DOMAIN}:47180`]),
    // The deployment's own origin: previews and staging serve the SPA from
    // their generated Vercel URL, so auth POSTs arrive with that Origin.
    ...(env.VERCEL_URL ? [`https://${env.VERCEL_URL}`] : []),
    ...(env.VERCEL_BRANCH_URL ? [`https://${env.VERCEL_BRANCH_URL}`] : []),
    `http://*.${env.APP_BASE_DOMAIN}`,
    `https://*.${env.APP_BASE_DOMAIN}`,
    // Wildcard entries above don't match origins carrying an explicit port.
    `http://*.${env.APP_BASE_DOMAIN}:${env.PORT}`,
    `https://*.${env.APP_BASE_DOMAIN}:${env.PORT}`,
  ];

  const auth = createAuth(db, {
    secret: env.BETTER_AUTH_SECRET,
    baseUrl: env.APP_BASE_URL,
    baseDomain: env.APP_BASE_DOMAIN,
    secureCookies: env.SECURE_COOKIES,
    trustedOrigins: async () => {
      const domains = await tenantDomains.listVerifiedDomains();
      return [
        ...baseTrustedOrigins,
        ...domains.map((domain) => `https://${domain.domain}`),
        ...domains.map((domain) => `http://${domain.domain}`),
      ];
    },
  });

  return {
    auth,
    authPort: createAuthPort(auth),
    todos: createTodoRepository(db),
    documents: createDocumentRepository(db),
    storage,
    tenantDomains,
    tenants: createTenantRepository(db),
    tenantAccess: createTenantAccessReader(db),
    health: createHealthPort(db),
    ids: { nextId: () => randomUUID() },
    clock: { nowIso: () => new Date().toISOString() },
    baseDomain: env.APP_BASE_DOMAIN,
  };
};

const createStorage = (env: Env): StoragePort => {
  switch (env.STORAGE_DRIVER) {
    case 'local-fs':
      return createLocalFsStorage(env.STORAGE_LOCAL_PATH);
    case 'vercel-blob':
      return createVercelBlobStorage(env.BLOB_READ_WRITE_TOKEN ?? '');
  }
};
