import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBetterAuthClientAdapter, createCliAuthAdapter, followMagicLink, probeSignInCookies } from './client-adapter.js';

interface CapturedCall {
  url: string;
  method: string | undefined;
  origin: string | null;
}

const mockFetch = (response: {
  ok: boolean;
  status: number;
  text?: string;
  setCookie?: string[];
}): (() => CapturedCall | null) => {
  let captured: CapturedCall | null = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      captured = {
        url: String(url),
        method: init?.method,
        origin: new Headers(init?.headers).get('origin'),
      };
      return Promise.resolve({
        ok: response.ok,
        status: response.status,
        text: async () => Promise.resolve(response.text ?? ''),
        headers: { getSetCookie: () => response.setCookie ?? [] },
      });
    }),
  );
  return () => captured;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('probeSignInCookies', () => {
  it('POSTs to the sign-in route with an Origin header and returns the raw Set-Cookie', async () => {
    const setCookie = ['better-auth.session_token=abc; Path=/; HttpOnly; SameSite=Lax'];
    const call = mockFetch({ ok: true, status: 200, setCookie });

    const probe = await probeSignInCookies('http://localhost:47100', {
      email: 'demo@agentproofarch.dev',
      password: 'demo1234',
    });

    expect(probe).toEqual({ ok: true, status: 200, body: '', setCookie });
    expect(call()).toEqual({
      url: 'http://localhost:47100/api/auth/sign-in/email',
      method: 'POST',
      origin: 'http://localhost:47100',
    });
  });

  it('surfaces the response body on a failed sign-in', async () => {
    mockFetch({ ok: false, status: 401, text: 'Invalid credentials', setCookie: [] });

    const probe = await probeSignInCookies('http://localhost:47100', {
      email: 'demo@agentproofarch.dev',
      password: 'wrong',
    });

    expect(probe).toEqual({ ok: false, status: 401, body: 'Invalid credentials', setCookie: [] });
  });
});

interface JsonCall {
  url: string;
  method: string | undefined;
  origin: string | null;
  authorization: string | null;
  body: unknown;
}

const mockJsonFetch = (
  responder: (call: JsonCall) => { ok: boolean; status: number; json?: unknown; headers?: Record<string, string> },
): (() => JsonCall | null) => {
  let captured: JsonCall | null = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      captured = {
        url: String(url),
        method: init?.method,
        origin: headers.get('origin'),
        authorization: headers.get('authorization'),
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      };
      const res = responder(captured);
      return Promise.resolve({
        ok: res.ok,
        status: res.status,
        json: async () => Promise.resolve(res.json ?? {}),
        text: async () => Promise.resolve(''),
        headers: new Headers(res.headers ?? {}),
      });
    }),
  );
  return () => captured;
};

describe('createCliAuthAdapter.requestMagicLink', () => {
  it('POSTs the email to the magic-link route with the CSRF Origin header', async () => {
    const call = mockJsonFetch(() => ({ ok: true, status: 200, json: {} }));
    const adapter = createCliAuthAdapter('http://localhost:47100', () => {});

    const result = await adapter.requestMagicLink({ email: 'mag@example.com', callbackURL: 'http://localhost:47100' });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(call()).toMatchObject({
      url: 'http://localhost:47100/api/auth/sign-in/magic-link',
      method: 'POST',
      origin: 'http://localhost:47100',
      body: { email: 'mag@example.com', callbackURL: 'http://localhost:47100' },
    });
  });

  it('maps a provider error status to the taxonomy code', async () => {
    mockJsonFetch(() => ({ ok: false, status: 401, json: { message: 'nope' } }));
    const adapter = createCliAuthAdapter('http://localhost:47100', () => {});
    const result = await adapter.requestMagicLink({ email: 'mag@example.com' });
    expect(result).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
  });
});

describe('createCliAuthAdapter social + 2FA', () => {
  it('signInSocial returns the provider authorization URL', async () => {
    const call = mockJsonFetch(() => ({ ok: true, status: 200, json: { url: 'https://accounts.google/auth', redirect: true } }));
    const adapter = createCliAuthAdapter('http://localhost:47100', () => {});
    const result = await adapter.signInSocial({ provider: 'google', callbackURL: 'http://localhost:47100/app' });
    expect(result).toEqual({ ok: true, value: { url: 'https://accounts.google/auth' } });
    expect(call()).toMatchObject({ url: 'http://localhost:47100/api/auth/sign-in/social', body: { provider: 'google', callbackURL: 'http://localhost:47100/app' } });
  });

  it('signInSocial surfaces a provider-not-found error', async () => {
    mockJsonFetch(() => ({ ok: false, status: 400, json: { code: 'PROVIDER_NOT_FOUND' } }));
    const adapter = createCliAuthAdapter('http://localhost:47100', () => {});
    const result = await adapter.signInSocial({ provider: 'google' });
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('enableTwoFactor parses the enrolment URI + backup codes and sends the bearer token', async () => {
    const call = mockJsonFetch(() => ({ ok: true, status: 200, json: { totpURI: 'otpauth://totp/x', backupCodes: ['a', 'b'] } }));
    const adapter = createCliAuthAdapter('http://localhost:47100', () => {}, () => 'tok-1');
    const result = await adapter.enableTwoFactor({ password: 'pw' });
    expect(result).toEqual({ ok: true, value: { totpURI: 'otpauth://totp/x', backupCodes: ['a', 'b'] } });
    expect(call()?.authorization).toBe('Bearer tok-1');
  });

  it('enableTwoFactor rejects an unexpected response shape', async () => {
    mockJsonFetch(() => ({ ok: true, status: 200, json: { nope: true } }));
    const adapter = createCliAuthAdapter('http://localhost:47100', () => {}, () => 'tok-1');
    const result = await adapter.enableTwoFactor({ password: 'pw' });
    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  it('verifyTotp and disableTwoFactor return ok on success', async () => {
    mockJsonFetch(() => ({ ok: true, status: 200, json: {} }));
    const adapter = createCliAuthAdapter('http://localhost:47100', () => {}, () => 'tok-1');
    expect(await adapter.verifyTotp({ code: '123456' })).toEqual({ ok: true, value: undefined });
    expect(await adapter.disableTwoFactor({ password: 'pw' })).toEqual({ ok: true, value: undefined });
  });
});

const stubJsonResponse = (payload: unknown, status = 200): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }),
      ),
    ),
  );
};

describe('createBetterAuthClientAdapter (web)', () => {
  it('signInSocial yields the provider authorization URL on success', async () => {
    stubJsonResponse({ url: 'https://accounts.google/auth', redirect: true });
    const adapter = createBetterAuthClientAdapter('http://localhost:47100');
    const result = await adapter.signInSocial({ provider: 'google', callbackURL: 'http://localhost:47100/app' });
    expect(result).toEqual({ ok: true, value: { url: 'https://accounts.google/auth' } });
  });

  it('signInSocial maps a provider error to a failed Result', async () => {
    stubJsonResponse({ message: 'Provider not found', code: 'PROVIDER_NOT_FOUND' }, 400);
    const adapter = createBetterAuthClientAdapter('http://localhost:47100');
    const result = await adapter.signInSocial({ provider: 'google' });
    expect(result.ok).toBe(false);
  });

  it('requestMagicLink resolves ok when the provider accepts the request', async () => {
    stubJsonResponse({ status: true });
    const adapter = createBetterAuthClientAdapter('http://localhost:47100');
    expect((await adapter.requestMagicLink({ email: 'mag@example.com' })).ok).toBe(true);
  });

  it('enableTwoFactor parses the enrolment payload', async () => {
    stubJsonResponse({ totpURI: 'otpauth://totp/x', backupCodes: ['a'] });
    const adapter = createBetterAuthClientAdapter('http://localhost:47100');
    const result = await adapter.enableTwoFactor({ password: 'pw' });
    expect(result).toMatchObject({ ok: true, value: { totpURI: 'otpauth://totp/x' } });
  });

  it('verifyTotp and disableTwoFactor resolve ok on success', async () => {
    stubJsonResponse({ status: true });
    const adapter = createBetterAuthClientAdapter('http://localhost:47100');
    expect((await adapter.verifyTotp({ code: '123456' })).ok).toBe(true);
    expect((await adapter.disableTwoFactor({ password: 'pw' })).ok).toBe(true);
  });
});

describe('followMagicLink', () => {
  it('returns the bearer token the verify route emits', async () => {
    mockJsonFetch(() => ({ ok: true, status: 302, headers: { 'set-auth-token': 'tok-123' } }));
    const result = await followMagicLink('http://localhost:47100/api/auth/magic-link/verify?token=x');
    expect(result).toEqual({ ok: true, value: { token: 'tok-123' } });
  });

  it('surfaces an expired/invalid link as an error', async () => {
    mockJsonFetch(() => ({ ok: false, status: 400, json: { message: 'expired' } }));
    const result = await followMagicLink('http://localhost:47100/api/auth/magic-link/verify?token=stale');
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});
