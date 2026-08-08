import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import { magicLink } from 'better-auth/plugins/magic-link';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { passkey } from '@better-auth/passkey';

import type { AuthPort, EmailPort } from '#core/server/index.js';
import type { Db } from '#adapters/db/client.js';

export interface GoogleSettings {
  clientId: string;
  clientSecret: string;
}

export interface AuthSettings {
  secret: string;
  /** Public URL of the API, e.g. http://localhost:47100 */
  baseUrl: string;
  /** Cookie domain root so sessions survive tenant subdomains, e.g. "localhost". */
  baseDomain: string;
  trustedOrigins: string[] | ((request?: Request) => string[] | Promise<string[]>);
  secureCookies: boolean;
  /** Off only in test harnesses (e2e drives many sign-ins from one bucket). */
  rateLimitEnabled: boolean;
  /** Delivers the magic link; the dev transport captures it instead of sending. */
  email: EmailPort;
  /** Wired only when both env keys are present (FR-26), like SENTRY_DSN gating. */
  google?: GoogleSettings;
}

export const BETTER_AUTH_API_PATH_PATTERN = '/api/auth/*';

const magicLinkSubject = 'Your Agentproofarch sign-in link';

export const createAuth = (db: Db, settings: AuthSettings) =>
  betterAuth({
    database: drizzleAdapter(db, { provider: 'pg' }),
    secret: settings.secret,
    baseURL: settings.baseUrl,
    trustedOrigins: settings.trustedOrigins,
    emailAndPassword: { enabled: true },
    ...(settings.google
      ? { socialProviders: { google: { clientId: settings.google.clientId, clientSecret: settings.google.clientSecret } } }
      : {}),
    // In-memory counters reset with every serverless isolate, so the limiter
    // stores its windows in the database we already have (no Redis needed).
    rateLimit: { enabled: settings.rateLimitEnabled, storage: 'database' },
    plugins: [
      bearer(),
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await settings.email.sendMail({
            to: email,
            subject: magicLinkSubject,
            text: `Sign in to Agentproofarch:\n\n${url}\n\nThis link signs you in and expires shortly.`,
            link: url,
          });
        },
      }),
      twoFactor(),
      // rpID is the registrable domain the credential is scoped to; keying it on
      // the base domain lets one passkey work across every tenant subdomain
      // (browsers scope WebAuthn to the registrable suffix, not the full origin).
      passkey({ rpID: settings.baseDomain, rpName: 'Agentproofarch' }),
    ],
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
