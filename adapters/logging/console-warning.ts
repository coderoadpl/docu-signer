import type { WarningLoggerPort } from '#core/server/index.js';

export const createConsoleWarningLogger = (): WarningLoggerPort => ({
  warn: (message, details) => console.warn(message, details ?? {}),
});
