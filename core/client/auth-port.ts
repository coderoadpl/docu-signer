import type { WriteResult } from './http.js';

export interface AuthSessionResult {
  token: string | null;
}

/**
 * Client-side auth port. Web (and future mobile/Electron) programs against
 * this interface; the Better Auth client adapter implements it.
 * Session state itself is read through the API (`/api/me`), not through here.
 * Auth side effects are commands, so every method returns a write-tagged result.
 */
export interface AuthClientPort {
  signUp(input: { name: string; email: string; password: string }): Promise<WriteResult<AuthSessionResult>>;
  signIn(input: { email: string; password: string }): Promise<WriteResult<AuthSessionResult>>;
  signOut(): Promise<WriteResult<void>>;
}
