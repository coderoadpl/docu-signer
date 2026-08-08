import { createTransport } from 'nodemailer';

import type { EmailPort } from '#core/server/index.js';

export interface SmtpSettings {
  host: string;
  port: number;
  /** STARTTLS/implicit TLS: true for port 465, false for 587/25 with STARTTLS. */
  secure: boolean;
  /** Optional: an open local relay (dev/CI Mailpit) authenticates no one. */
  user?: string;
  pass?: string;
  /** The envelope + header From, e.g. "Agentproofarch <no-reply@example.com>". */
  from: string;
}

/**
 * The universal default transport: any RFC-compliant SMTP relay, Amazon SES
 * SMTP credentials included (host `email-smtp.<region>.amazonaws.com`, the SES
 * SMTP user/pass, port 587), and the dev/CI Mailpit that captures real sends
 * instead of delivering. Swappable behind `EmailPort` for any other relay.
 */
export const createSmtpEmailPort = (settings: SmtpSettings): EmailPort => {
  const transport = createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    ...(settings.user === undefined
      ? {}
      : { auth: { user: settings.user, pass: settings.pass } }),
  });
  return {
    sendMail: async (message) => {
      await transport.sendMail({
        from: settings.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html === undefined ? {} : { html: message.html }),
      });
    },
  };
};
