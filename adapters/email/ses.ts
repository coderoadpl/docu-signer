import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';

import type { EmailPort } from '#core/server/index.js';

export interface SesSettings {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** The verified From identity, e.g. "Agentproofarch <no-reply@example.com>". */
  from: string;
}

/**
 * Amazon SES over the SESv2 HTTP API (a signed AWS request), the alternative to
 * the SMTP relay for teams that would rather hand SES an access key than open
 * port 587. Selected by `EMAIL_TRANSPORT=ses`. `link` is already embedded in
 * `text` by the caller, so the SES `Simple` body carries it unchanged.
 */
export const createSesEmailPort = (settings: SesSettings): EmailPort => {
  const client = new SESv2Client({
    region: settings.region,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
  });
  return {
    sendMail: async (message) => {
      await client.send(
        new SendEmailCommand({
          FromEmailAddress: settings.from,
          Destination: { ToAddresses: [message.to] },
          Content: {
            Simple: {
              Subject: { Data: message.subject },
              Body: {
                Text: { Data: message.text },
                ...(message.html === undefined ? {} : { Html: { Data: message.html } }),
              },
            },
          },
        }),
      );
    },
  };
};
