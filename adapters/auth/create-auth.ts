import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';

import type { AuthPort } from '#core/server/index.js';
import type { Db } from '#adapters/db/client.js';

export interface AuthSettings {
  secret: string;
  /** Public URL of the API, e.g. http://localhost:47100 */
  baseUrl: string;
  /** Cookie domain root so sessions survive tenant subdomains, e.g. "localhost". */
  baseDomain: string;
  trustedOrigins: string[] | ((request?: Request) => string[] | Promise<string[]>);
  secureCookies: boolean;
}

export const BETTER_AUTH_API_PATH_PATTERN = '/api/auth/*';

export const createAuth = (db: Db, settings: AuthSettings) =>
  betterAuth({
    database: drizzleAdapter(db, { provider: 'pg' }),
    secret: settings.secret,
    baseURL: settings.baseUrl,
    trustedOrigins: settings.trustedOrigins,
    emailAndPassword: { enabled: true },
    // In-memory counters reset with every serverless isolate, so the limiter
    // stores its windows in the database we already have (no Redis needed).
    rateLimit: { enabled: true, storage: 'database' },
    plugins: [bearer()],
    advanced: {
      useSecureCookies: settings.secureCookies,
      // Browsers reject Domain=.localhost cookies, so sessions are per-subdomain
      // in local dev; on a real base domain they span all tenant subdomains.
      ...(settings.baseDomain === 'localhost'
        ? {}
        : { crossSubDomainCookies: { enabled: true, domain: `.${settings.baseDomain}` } }),
    },
  });

export type Auth = ReturnType<typeof createAuth>;

/** AuthPort implementation: the only place the core's identity touches Better Auth. */
export const createAuthPort = (auth: Auth): AuthPort => ({
  getAuthenticatedUser: async (requestHeaders) => {
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (!session) return null;
    return {
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
    };
  },
});
