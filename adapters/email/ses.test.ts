import { describe, expect, it, vi } from 'vitest';

const send = vi.fn(async () => ({ MessageId: 'ses-x' }));
const SESv2Client = vi.fn(() => ({ send }));

class SendEmailCommand {
  constructor(public readonly input: unknown) {}
}

vi.mock('@aws-sdk/client-sesv2', () => ({ SESv2Client, SendEmailCommand }));

const { createSesEmailPort } = await import('./ses.js');

const settings = {
  region: 'eu-central-1',
  accessKeyId: 'AKIA-test',
  secretAccessKey: 'secret-test',
  from: 'Agentproofarch <no-reply@example.com>',
};

describe('createSesEmailPort', () => {
  it('constructs the SESv2 client from the region and explicit credentials', () => {
    createSesEmailPort(settings);
    expect(SESv2Client).toHaveBeenCalledWith({
      region: 'eu-central-1',
      credentials: { accessKeyId: 'AKIA-test', secretAccessKey: 'secret-test' },
    });
  });

  it('sends a SendEmail command carrying to, subject, text and the embedded link', async () => {
    send.mockClear();
    const port = createSesEmailPort(settings);
    const link = 'https://app.example.com/verify?token=abc';
    await port.sendMail({
      to: 'member@example.com',
      subject: 'Your sign-in link',
      text: `Sign in:\n\n${link}\n`,
      link,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      new SendEmailCommand({
        FromEmailAddress: settings.from,
        Destination: { ToAddresses: ['member@example.com'] },
        Content: {
          Simple: {
            Subject: { Data: 'Your sign-in link' },
            Body: { Text: { Data: `Sign in:\n\n${link}\n` } },
          },
        },
      }),
    );
  });

  it('includes the html part when provided', async () => {
    send.mockClear();
    const port = createSesEmailPort(settings);
    await port.sendMail({ to: 'x@example.com', subject: 'Hi', text: 'body', html: '<b>body</b>' });
    expect(send).toHaveBeenCalledWith(
      new SendEmailCommand({
        FromEmailAddress: settings.from,
        Destination: { ToAddresses: ['x@example.com'] },
        Content: {
          Simple: {
            Subject: { Data: 'Hi' },
            Body: { Text: { Data: 'body' }, Html: { Data: '<b>body</b>' } },
          },
        },
      }),
    );
  });
});
