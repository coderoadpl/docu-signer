import type { ErrorCode } from '#core/domain/index.js';

export const HTTP_STATUS_BY_ERROR_CODE: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation: 400,
  conflict: 409,
  tenant_not_found: 404,
  internal: 500,
};

export const EXIT_CODE_BY_ERROR_CODE: Record<ErrorCode, number> = {
  validation: 2,
  unauthorized: 3,
  forbidden: 4,
  not_found: 5,
  conflict: 6,
  tenant_not_found: 7,
  internal: 10,
};
