export const ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'validation',
  'conflict',
  'tenant_not_found',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface AppError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export const appError = (code: ErrorCode, message: string, details?: unknown): AppError =>
  details === undefined ? { code, message } : { code, message, details };

export const unauthorized = (message = 'Authentication required'): AppError =>
  appError('unauthorized', message);

export const forbidden = (message = 'Not allowed'): AppError => appError('forbidden', message);

export const notFound = (message = 'Not found'): AppError => appError('not_found', message);

export const validation = (message: string, details?: unknown): AppError =>
  appError('validation', message, details);

export const tenantNotFound = (message = 'Unknown tenant'): AppError =>
  appError('tenant_not_found', message);

export const internal = (message = 'Internal error'): AppError => appError('internal', message);
