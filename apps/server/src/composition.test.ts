import { describe, expect, it } from 'vitest';

import { serverEnvSchema } from '#core/server/config.js';

import {
  selectEmailPort,
  selectEmailConfigured,
  selectGoogleSettings,
  selectPasswordResetEnabled,
  selectPdfSealCredentials,
  selectStoragePort,
} from './composition.js';
import type { Env } from './env.js';

// selectDomainPort only — never createDeps here: the full graph constructs a
// real Better Auth instance whose init eagerly queries tenant_domains, and the
// check runner has no database (CI-only unhandled rejection, 2026-07-21).
const env = (over: Partial<Env>): Env => ({
  ...serverEnvSchema.parse({}),
  APP_BASE_URL: 'http://localhost:47100',
  ...over,
});

describe('selectEmailPort', () => {
  it('wires a no-op transport when email is not configured', () => {
    const port = selectEmailPort(env({}));
    expect(typeof port.sendMail).toBe('function');
  });

  it('wires the smtp transport against an authenticated relay when creds are set', () => {
    const port = selectEmailPort(
      env({ EMAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.example.com', SMTP_PORT: 587, SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'Podpisy <no-reply@example.com>' }),
    );
    expect(typeof port.sendMail).toBe('function');
  });

  it('wires the ses transport when the AWS block is set', () => {
    const port = selectEmailPort(
      env({
        EMAIL_TRANSPORT: 'ses',
        AWS_REGION: 'eu-central-1',
        AWS_ACCESS_KEY_ID: 'AKIA-test',
        AWS_SECRET_ACCESS_KEY: 'secret',
        MAIL_FROM: 'Podpisy <no-reply@example.com>',
      }),
    );
    expect(typeof port.sendMail).toBe('function');
  });

  it('fails fast when EMAIL_TRANSPORT=ses is missing its AWS credentials', () => {
    expect(() => selectEmailPort(env({ EMAIL_TRANSPORT: 'ses' }))).toThrow(/AWS_REGION/);
  });

  it('reports delivery configured only for complete SMTP or SES settings', () => {
    expect(selectEmailConfigured(env({}))).toBe(false);
    expect(selectEmailConfigured(env({ SMTP_HOST: 'smtp.example.com' }))).toBe(false);
    expect(selectEmailConfigured(env({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
      MAIL_FROM: 'Podpisy <no-reply@example.com>',
    }))).toBe(true);
    expect(selectEmailConfigured(env({
      EMAIL_TRANSPORT: 'ses',
      AWS_REGION: 'eu-central-1',
      AWS_ACCESS_KEY_ID: 'key',
      AWS_SECRET_ACCESS_KEY: 'secret',
      MAIL_FROM: 'Podpisy <no-reply@example.com>',
    }))).toBe(true);
  });
});

describe('selectGoogleSettings', () => {
  it('is undefined unless BOTH id and secret are present', () => {
    expect(selectGoogleSettings(env({}))).toBeUndefined();
    expect(selectGoogleSettings(env({ GOOGLE_CLIENT_ID: 'id' }))).toBeUndefined();
    expect(selectGoogleSettings(env({ GOOGLE_CLIENT_SECRET: 'secret' }))).toBeUndefined();
  });

  it('wires Google when both keys are present', () => {
    const google = selectGoogleSettings(env({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }));
    expect(google).toEqual({ clientId: 'id', clientSecret: 'secret' });
  });
});

describe('selectPasswordResetEnabled', () => {
  it('is hidden when email is not configured', () => {
    expect(selectPasswordResetEnabled(env({}))).toBe(false);
  });

  it('is hidden on deploys that still point at the local Mailpit defaults', () => {
    expect(selectPasswordResetEnabled(env({ VERCEL: '1', SECURE_COOKIES: true }))).toBe(false);
  });

  it('is enabled on deploys with an explicit SMTP sender', () => {
    expect(selectPasswordResetEnabled(env({
      VERCEL: '1',
      SECURE_COOKIES: true,
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
      MAIL_FROM: 'Podpisy <no-reply@example.com>',
    }))).toBe(true);
  });

  it('is enabled on deploys with a complete SES block', () => {
    expect(selectPasswordResetEnabled(env({
      VERCEL: '1',
      SECURE_COOKIES: true,
      EMAIL_TRANSPORT: 'ses',
      AWS_REGION: 'eu-central-1',
      AWS_ACCESS_KEY_ID: 'AKIA-test',
      AWS_SECRET_ACCESS_KEY: 'secret',
      MAIL_FROM: 'Podpisy <no-reply@example.com>',
    }))).toBe(true);
  });
});

describe('selectStoragePort', () => {
  it('wires local filesystem storage by default', async () => {
    const storage = selectStoragePort(env({ STORAGE_LOCAL_PATH: '/tmp/podpisy-test-storage' }));
    expect(await storage.createUploadUrl('key', 'application/pdf')).toEqual({
      ok: true,
      value: null,
    });
  });

  it('wires Vercel Blob storage when selected', async () => {
    const storage = selectStoragePort(
      env({
        STORAGE_DRIVER: 'vercel-blob',
        BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_store_secret',
      }),
    );
    expect(typeof storage.createUploadUrl).toBe('function');
  });

  it('fails fast when Vercel Blob storage has no token', () => {
    expect(() => selectStoragePort(env({ STORAGE_DRIVER: 'vercel-blob' }))).toThrow(
      /BLOB_READ_WRITE_TOKEN/,
    );
  });
});

describe('selectPdfSealCredentials', () => {
  it('leaves sealing unconfigured when no credential block is present', () => {
    expect(selectPdfSealCredentials(env({}))).toBeNull();
  });

  it('selects a complete PEM pair', () => {
    expect(selectPdfSealCredentials(env({
      SEAL_CERT_PEM: 'certificate',
      SEAL_KEY_PEM: 'private-key',
    }))).toEqual({
      kind: 'pem',
      certificate: 'certificate',
      privateKey: 'private-key',
    });
  });

  it('prefers a PKCS#12 bundle with its passphrase', () => {
    expect(selectPdfSealCredentials(env({
      SEAL_P12_BASE64: 'bundle',
      SEAL_P12_PASSPHRASE: 'passphrase',
    }))).toEqual({
      kind: 'p12',
      base64: 'bundle',
      passphrase: 'passphrase',
    });
  });
});
