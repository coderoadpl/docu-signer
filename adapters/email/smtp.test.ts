import { describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn(async () => ({ messageId: 'x' }));
const createTransport = vi.fn(() => ({ sendMail }));

vi.mock('nodemailer', () => ({ createTransport }));

const { createSmtpEmailPort } = await import('./smtp.js');

const settings = {
  host: 'email-smtp.eu-central-1.amazonaws.com',
  port: 587,
  secure: false,
  user: 'AKIA-ses-user',
  pass: 'ses-pass',
  from: 'Agentproofarch <no-reply@example.com>',
};

describe('createSmtpEmailPort', () => {
  it('builds the transport from host/port/secure/auth (SES-compatible)', () => {
    createSmtpEmailPort(settings);
    expect(createTransport).toHaveBeenCalledWith({
      host: settings.host,
      port: 587,
      secure: false,
      auth: { user: settings.user, pass: settings.pass },
    });
  });

  it('sends a text-only message with the configured From', async () => {
    sendMail.mockClear();
    const port = createSmtpEmailPort(settings);
    await port.sendMail({ to: 'x@example.com', subject: 'Hi', text: 'body' });
    expect(sendMail).toHaveBeenCalledWith({
      from: settings.from,
      to: 'x@example.com',
      subject: 'Hi',
      text: 'body',
    });
  });

  it('includes the html part when provided', async () => {
    sendMail.mockClear();
    const port = createSmtpEmailPort(settings);
    await port.sendMail({ to: 'x@example.com', subject: 'Hi', text: 'body', html: '<b>body</b>' });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ html: '<b>body</b>' }));
  });
});
