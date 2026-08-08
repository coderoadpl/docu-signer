import { z } from 'zod';

/**
 * Mailpit HTTP-API client for the runtime gates (DECIDE: Mailpit replaces the dev
 * email transport). Dev/e2e/CI boot the REAL smtp adapter pointed at a local
 * Mailpit that captures every send; the magic-link smoke/e2e phases read the
 * message back over Mailpit's HTTP API to recover the link, then follow it — the
 * same round-trip a human makes in the Mailpit inbox, with no in-app dev route.
 */

const messageListSchema = z.object({
  messages: z
    .object({
      ID: z.string(),
      To: z.array(z.object({ Address: z.string() })).default([]),
    })
    .array()
    .default([]),
});

const messageBodySchema = z.object({ Text: z.string().default(''), HTML: z.string().default('') });

const MAGIC_LINK = /https?:\/\/[^\s"'<>]*magic-link\/verify[^\s"'<>]*/;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves once Mailpit's API answers, or throws after `timeoutMs`. */
export const waitForMailpit = async (baseUrl: string, timeoutMs = 20000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/messages?limit=1`);
      if (res.ok) return;
    } catch {
      // not accepting connections yet
    }
    await sleep(300);
  }
  throw new Error(`Mailpit did not become ready within ${timeoutMs / 1000}s at ${baseUrl}`);
};

/** Empties the Mailpit inbox so a run never picks up a stale, DB-invalid link. */
export const clearMailpit = async (baseUrl: string): Promise<void> => {
  await fetch(`${baseUrl}/api/v1/messages`, { method: 'DELETE' });
};

/**
 * Polls Mailpit for the newest captured message addressed to `email` and returns
 * the magic-link verify URL embedded in its body. Throws if none arrives within
 * `timeoutMs`.
 */
export const fetchMagicLink = async (
  baseUrl: string,
  email: string,
  timeoutMs = 15000,
): Promise<string> => {
  const target = email.toLowerCase();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listRes = await fetch(`${baseUrl}/api/v1/messages?limit=200`);
    if (listRes.ok) {
      const { messages } = messageListSchema.parse(await listRes.json());
      const match = messages.find((message) =>
        message.To.some((recipient) => recipient.Address.toLowerCase() === target),
      );
      if (match) {
        const bodyRes = await fetch(`${baseUrl}/api/v1/message/${match.ID}`);
        if (bodyRes.ok) {
          const body = messageBodySchema.parse(await bodyRes.json());
          const link = MAGIC_LINK.exec(body.Text) ?? MAGIC_LINK.exec(body.HTML);
          if (link) return link[0];
        }
      }
    }
    await sleep(300);
  }
  throw new Error(`No magic link captured for ${email} in Mailpit within ${timeoutMs / 1000}s`);
};
