import { DEFAULT_DOCUMENT_TYPES } from '#core/domain/index.js';

import type { Db } from './client.js';
import { documentTypes } from './schema.js';

export const seedDefaultDocumentTypes = async (db: Db, tenantId: string): Promise<void> => {
  await db
    .insert(documentTypes)
    .values(DEFAULT_DOCUMENT_TYPES.map((item) => ({ tenantId, ...item })))
    .onConflictDoNothing();
};
