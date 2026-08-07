import { createAuthClient } from 'better-auth/client';
import { z } from 'zod';

import type { AuthClientPort } from '#core/client/index.js';
import { appError, err, ok, type AppError, type Result } from '#core/domain/index.js';

type SignUpInput = Parameters<AuthClientPort['signUp']>[0];
type SignInInput = Parameters<AuthClientPort['signIn']>[0];
type AuthPath = '/api/auth/sign-up/email' | '/api/auth/sign-in/email';

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

const postCliAuth = async (
  baseUrl: string,
  path: AuthPath,
  body: SignUpInput | SignInInput,
  onToken: (token: string) => void,
): Promise<Result<{ token: string | null }, AppError>> => {
  let response: Response;
  try {
    response = await fetch(new URL(path, baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseUrl,
      },
      body: JSON.stringify(body),
      credentials: 'include',
    });
  } catch (cause) {
    return err(appError('internal', `Network error calling ${path}: ${String(cause)}`));
  }

  if (!response.ok) return toResult({ token: null }, await readAuthError(response));

  const token = response.headers.get('set-auth-token');
  if (token) onToken(token);
  return ok({ token });
};

/** Better Auth implementation of the client-side auth port. */
export const createBetterAuthClientAdapter = (baseUrl: string): AuthClientPort => {
  const client = createAuthClient({
    baseURL: baseUrl === '' ? undefined : baseUrl,
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
      return toResult({ token }, response.error);
    },
    signOut: async () => toResult(undefined, (await client.signOut()).error),
  };
};

export const createCliAuthAdapter = (baseUrl: string, onToken: (token: string) => void): AuthClientPort =>
  ({
    signUp: (input) => postCliAuth(baseUrl, '/api/auth/sign-up/email', input, onToken),
    signIn: (input) => postCliAuth(baseUrl, '/api/auth/sign-in/email', input, onToken),
    signOut: async () => ok(undefined),
  });
