import type { EmailPort } from '#core/server/index.js';

export const createNoopEmailPort = (): EmailPort => ({
  sendMail: async () => {},
});
