import { createAuthClient } from 'better-auth/client';
import { magicLinkClient, twoFactorClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';
import { z } from 'zod';

import type { AuthClientPort, AuthSessionResult, PasskeyInfo } from '#core/client/index.js';
import { appError, err, ok, type AppError, type Result } from '#core/domain/index.js';

type SignInInput = Parameters<AuthClientPort['signIn']>[0];

const authErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
});

const toResult = <T>(value: T, error: { message?: string | undefined; status: number } | null): Result<T, AppError> => {
  if (!error) return ok(value);
  const code =
    error.status === 401
      ? 'unauthorized'
      : error.status === 403
        ? 'forbidden'
        : error.status === 400 || error.status === 422
          ? 'validation'
          : 'internal';
  return err(appError(code, error.message ?? 'Authentication failed'));
};

const readAuthError = async (response: Response): Promise<{ message?: string | undefined; status: number }> => {
  try {
    const payload: unknown = await response.json();
    const parsed = authErrorSchema.safeParse(payload);
    return {
      status: response.status,
      message: parsed.success ? (parsed.data.message ?? parsed.data.code) : response.statusText,
    };
  } catch {
    return { status: response.status, message: response.statusText };
  }
};

/**
 * One raw POST to a Better Auth route (CLI transport). Spelling a Better Auth
 * HTTP path is only sanctioned inside `adapters/auth`; the CLI has no browser
 * client, so it talks to the routes directly with the CSRF `Origin` header and
 * an optional bearer token for the authenticated (2FA) endpoints.
 */
const postCliAuth = async (
  baseUrl: string,
  path: string,
  body: unknown,
  bearer: string | null,
): Promise<Result<unknown, AppError>> => {
  let response: Response;
  try {
    response = await fetch(new URL(path, baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseUrl,
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
      credentials: 'include',
    });
  } catch (cause) {
    return err(appError('internal', `Network error calling ${path}: ${String(cause)}`));
  }
  if (!response.ok) return toResult(null, await readAuthError(response));
  try {
    return ok(await response.json());
  } catch {
    return ok(null);
  }
};

export interface SignInCookieProbe {
  ok: boolean;
  status: number;
  body: string;
  /** The raw `Set-Cookie` header values Better Auth emitted on the sign-in. */
  setCookie: string[];
}

/**
 * A raw sign-in used only by the smoke gate to assert the session cookie's
 * hardening (HttpOnly + SameSite=Lax + Secure-on-https). It lives here because
 * spelling a Better Auth HTTP route is only sanctioned inside `adapters/auth`;
 * the port deliberately hides cookies, so this returns the raw `Set-Cookie`
 * strings the assertion parses (see architecture §Security baseline).
 */
export const probeSignInCookies = async (
  baseUrl: string,
  input: SignInInput,
): Promise<SignInCookieProbe> => {
  const response = await fetch(new URL('/api/auth/sign-in/email', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify(input),
  });
  return {
    ok: response.ok,
    status: response.status,
    body: response.ok ? '' : await response.text(),
    setCookie: response.headers.getSetCookie(),
  };
};

/**
 * Follow a magic-link verification URL and return the session bearer token
 * (US-026, CLI/smoke path). A non-browser client has no cookie jar, so it reads
 * the `set-auth-token` the bearer plugin emits on the sign-in the verify route
 * performs. `redirect: 'manual'` keeps the 302→callbackURL from being chased so
 * the token header on the verify response itself is read. Spelling the verify
 * route is sanctioned here inside `adapters/auth`.
 */
export const followMagicLink = async (url: string): Promise<Result<{ token: string | null }, AppError>> => {
  let response: Response;
  try {
    response = await fetch(url, { method: 'GET', redirect: 'manual' });
  } catch (cause) {
    return err(appError('internal', `Network error following the magic link: ${String(cause)}`));
  }
  // A 4xx (expired/invalid token) is the only failure; a 2xx or 302 both mean
  // the session was minted.
  if (response.status >= 400) return toResult({ token: null }, await readAuthError(response));
  return ok({ token: response.headers.get('set-auth-token') });
};

const socialUrlSchema = z.object({ url: z.string().optional(), redirect: z.boolean().optional() });
const totpEnableSchema = z.object({ totpURI: z.string(), backupCodes: z.array(z.string()) });
const authSessionSchema = z.object({
  token: z.string().nullable().optional(),
  twoFactorRedirect: z.boolean().optional(),
});

const authSessionResult = (payload: unknown, token: string | null): AuthSessionResult => {
  const parsed = authSessionSchema.safeParse(payload);
  return {
    token: token ?? (parsed.success ? (parsed.data.token ?? null) : null),
    ...(parsed.success && parsed.data.twoFactorRedirect === true ? { twoFactorRequired: true } : {}),
  };
};

/** Better Auth implementation of the client-side auth port. */
export const createBetterAuthClientAdapter = (baseUrl: string): AuthClientPort => {
  const client = createAuthClient({
    baseURL: baseUrl === '' ? undefined : baseUrl,
    plugins: [magicLinkClient(), twoFactorClient(), passkeyClient()],
  });

  return {
    signUp: async ({ name, email, password }) => {
      const token = null;
      const response = await client.signUp.email({ name, email, password });
      return toResult({ token }, response.error);
    },
    signIn: async ({ email, password }) => {
      const token = null;
      const response = await client.signIn.email({ email, password });
      if (response.error) return toResult({ token }, response.error);
      return ok(authSessionResult(response.data, token));
    },
    signOut: async () => toResult(undefined, (await client.signOut()).error),
    changePassword: async ({ currentPassword, newPassword, revokeOtherSessions }) =>
      toResult(
        undefined,
        (await client.changePassword({ currentPassword, newPassword, revokeOtherSessions })).error,
      ),
    requestMagicLink: async ({ email, callbackURL }) => {
      const response = await client.signIn.magicLink({ email, ...(callbackURL ? { callbackURL } : {}) });
      return toResult(undefined, response.error);
    },
    requestPasswordReset: async ({ email, redirectTo }) => {
      const response = await client.requestPasswordReset({ email, redirectTo });
      return toResult(undefined, response.error);
    },
    resetPassword: async ({ token, newPassword }) => {
      const response = await client.resetPassword({ token, newPassword });
      return toResult(undefined, response.error);
    },
    signInSocial: async ({ provider, callbackURL }) => {
      const response = await client.signIn.social({ provider, ...(callbackURL ? { callbackURL } : {}) });
      if (response.error) return toResult({ url: null }, response.error);
      const parsed = socialUrlSchema.safeParse(response.data);
      return ok({ url: parsed.success ? (parsed.data.url ?? null) : null });
    },
    enableTwoFactor: async ({ password }) => {
      const response = await client.twoFactor.enable({ password });
      if (response.error) return toResult({ totpURI: '', backupCodes: [] }, response.error);
      const parsed = totpEnableSchema.safeParse(response.data);
      if (!parsed.success) return err(appError('internal', 'Two-factor enable returned an unexpected shape'));
      return ok(parsed.data);
    },
    verifyTotp: async ({ code }) => {
      const response = await client.twoFactor.verifyTotp({ code });
      if (response.error) return toResult({ token: null }, response.error);
      return ok(authSessionResult(response.data, null));
    },
    disableTwoFactor: async ({ password }) => toResult(undefined, (await client.twoFactor.disable({ password })).error),
    registerPasskey: async ({ name }) => toResult(undefined, (await client.passkey.addPasskey({ name })).error),
    listPasskeys: async () => {
      const response = await client.passkey.listUserPasskeys();
      if (response.error) return toResult<PasskeyInfo[]>([], response.error);
      const list = (response.data ?? []).map((row) => ({
        id: row.id,
        name: row.name ?? '',
        createdAt: new Date(row.createdAt).toISOString(),
      }));
      return ok(list);
    },
    removePasskey: async ({ id }) => toResult(undefined, (await client.passkey.deletePasskey({ id })).error),
    signInPasskey: async () => toResult({ token: null }, (await client.signIn.passkey()).error),
  };
};

export const createCliAuthAdapter = (
  baseUrl: string,
  onToken: (token: string) => void,
  token: () => string | null = () => null,
): AuthClientPort => {
  let twoFactorCookie: string | null = null;

  const cookieHeader = (setCookie: string[]): string | null => {
    const cookies = setCookie
      .map((cookie) => {
        const [nameValue = ''] = cookie.split(';');
        return nameValue;
      })
      .filter((cookie) => cookie.length > 0);
    return cookies.length === 0 ? null : cookies.join('; ');
  };

  const postWithSession = async (
    path: string,
    body: unknown,
    cookie: string | null = null,
    includeBearer = false,
  ): Promise<Result<{ payload: unknown; token: string | null; cookie: string | null }, AppError>> => {
    let response: Response;
    try {
      response = await fetch(new URL(path, baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: baseUrl,
          ...(includeBearer && token() ? { authorization: `Bearer ${token()}` } : {}),
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
        credentials: 'include',
      });
    } catch (cause) {
      return err(appError('internal', `Network error calling ${path}: ${String(cause)}`));
    }
    if (!response.ok) return toResult({ payload: null, token: null, cookie: null }, await readAuthError(response));
    const emitted = response.headers.get('set-auth-token');
    if (emitted) onToken(emitted);
    const nextCookie = cookieHeader(response.headers.getSetCookie());
    try {
      return ok({ payload: await response.json(), token: emitted, cookie: nextCookie });
    } catch {
      return ok({ payload: null, token: emitted, cookie: nextCookie });
    }
  };

  return {
    signUp: async (input) => {
      const result = await postWithSession('/api/auth/sign-up/email', input);
      if (!result.ok) return result;
      return ok(authSessionResult(result.value.payload, result.value.token));
    },
    signIn: async (input) => {
      const result = await postWithSession('/api/auth/sign-in/email', input);
      if (!result.ok) return result;
      const session = authSessionResult(result.value.payload, result.value.token);
      twoFactorCookie = session.twoFactorRequired === true ? result.value.cookie : null;
      return ok(session);
    },
    // Revoke the session server-side (bearer token), not just locally: the CLI
    // authenticates by token, so sign-out must reach Better Auth or the session
    // survives every logout. A no-token logout is a local-only no-op.
    signOut: async () => {
      const current = token();
      if (current === null) return ok(undefined);
      const result = await postCliAuth(baseUrl, '/api/auth/sign-out', {}, current);
      return result.ok ? ok(undefined) : result;
    },
    changePassword: async (input) => {
      const result = await postWithSession('/api/auth/change-password', input, null, true);
      return result.ok ? ok(undefined) : result;
    },
    requestMagicLink: async ({ email, callbackURL }) => {
      const result = await postCliAuth(baseUrl, '/api/auth/sign-in/magic-link', { email, ...(callbackURL ? { callbackURL } : {}) }, null);
      return result.ok ? ok(undefined) : result;
    },
    requestPasswordReset: async ({ email, redirectTo }) => {
      const result = await postCliAuth(baseUrl, '/api/auth/request-password-reset', { email, redirectTo }, null);
      return result.ok ? ok(undefined) : result;
    },
    resetPassword: async () =>
      err(appError('validation', 'Finish the reset from the emailed link; it opens the web app.')),
    signInSocial: async ({ provider, callbackURL }) => {
      const result = await postCliAuth(baseUrl, '/api/auth/sign-in/social', { provider, ...(callbackURL ? { callbackURL } : {}) }, null);
      if (!result.ok) return result;
      const parsed = socialUrlSchema.safeParse(result.value);
      return ok({ url: parsed.success ? (parsed.data.url ?? null) : null });
    },
    enableTwoFactor: async ({ password }) => {
      const result = await postCliAuth(baseUrl, '/api/auth/two-factor/enable', { password }, token());
      if (!result.ok) return result;
      const parsed = totpEnableSchema.safeParse(result.value);
      if (!parsed.success) return err(appError('internal', 'Two-factor enable returned an unexpected shape'));
      return ok(parsed.data);
    },
    verifyTotp: async ({ code }) => {
      const result = await postWithSession('/api/auth/two-factor/verify-totp', { code }, twoFactorCookie);
      if (!result.ok) return result;
      twoFactorCookie = null;
      return ok(authSessionResult(result.value.payload, result.value.token));
    },
    disableTwoFactor: async ({ password }) => {
      const result = await postCliAuth(baseUrl, '/api/auth/two-factor/disable', { password }, token());
      return result.ok ? ok(undefined) : result;
    },
    // Passkeys drive a WebAuthn ceremony that only a browser can perform; the CLI
    // has no authenticator, so the passkey surface is unreachable here by design.
    registerPasskey: async () => err(appError('validation', 'Passkeys require a browser; manage them from the web app.')),
    listPasskeys: async () => err(appError('validation', 'Passkeys require a browser; manage them from the web app.')),
    removePasskey: async () => err(appError('validation', 'Passkeys require a browser; manage them from the web app.')),
    signInPasskey: async () => err(appError('validation', 'Passkeys require a browser; manage them from the web app.')),
  };
};
