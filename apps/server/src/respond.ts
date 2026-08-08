import { HTTP_STATUS_BY_ERROR_CODE, toEnvelope } from '#core/contract/index.js';
import type { AppError, Result } from '#core/domain/index.js';

import { recordAppError } from './telemetry.js';

/**
 * The one seam every envelope passes through (the authenticated app and the
 * public group both build responses here). `cacheControl` defaults to `no-store`
 * — tenant-scoped JSON must never be stored by any cache (architecture §HTTP
 * caching); a public 2xx opts into a cacheable value via `publicCacheControl`.
 * Errors are pinned to `no-store` REGARDLESS of the argument, so a transient
 * failure on a public route can never be cached at the edge.
 */
export const respond = <T>(result: Result<T, AppError>, cacheControl = 'no-store'): Response => {
  const envelope = toEnvelope(result);
  if (!envelope.ok) recordAppError(envelope.error);
  const status = envelope.ok ? 200 : HTTP_STATUS_BY_ERROR_CODE[envelope.error.code];
  return new Response(JSON.stringify(envelope), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': envelope.ok ? cacheControl : 'no-store',
    },
  });
};
