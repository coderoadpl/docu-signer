import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { text as consumeText } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';

import { Command, CommanderError } from 'commander';
import { z } from 'zod';

import { createCliAuthAdapter, followMagicLink } from '#adapters/auth/client-adapter.js';
import { verifyPdfSeal, type PdfSealVerification } from '#adapters/pdf-seal/verify.js';
import type { AuthClientPort } from '#core/client/index.js';
import {
  createApiClient,
  replaySignatureRecordsPdf,
  type ApiClient,
} from '#core/client/index.js';
import {
  apiTokenCreateInputSchema,
  documentCreateInputSchema,
  invitationCreateInputSchema,
  tenantSettingsUpdateInputSchema,
} from '#core/contract/index.js';
import {
  canonicalSlugSchema,
  err,
  internal,
  notFound,
  ok,
  unauthorized,
  validation,
  type DocumentListFilter,
  type DocumentListItem,
} from '#core/domain/index.js';

import {
  apiOrigin,
  loadConfig,
  resolveCliConfig,
  saveConfig,
  updateOriginProfile,
  type CliConfig,
  type CliOriginSource,
  type CliProfile,
} from './config.js';
import { emit } from './output.js';

const program = new Command('podpisy')
  .description('Reference client for the podpisy API — the agent feedback loop')
  .option('--json', 'machine-readable JSON output', false)
  .option('--api-url <url>', 'API base URL (overrides config)')
  .option('--token <value>', 'API token for this command (overrides APP_CLI_TOKEN and stored session)');

// Own Commander's parse failures (unknown command, missing option/argument, bad
// option) instead of letting it process.exit(1) with plain-text stderr: throw so
// the catch around parseAsync can emit exactly one `validation` envelope with the
// taxonomy exit code, and swallow the default stderr so nothing prints twice.
// Set before any subcommand exists so every command inherits it (Commander copies
// _exitCallback / _outputConfiguration into subcommands at registration).
program.exitOverride().configureOutput({ writeErr: () => {} });

interface CliCtx {
  config: CliConfig;
  api: ApiClient;
  /** A no-session client for the public surface: carries neither token nor tenant. */
  publicApi: ApiClient;
  auth: AuthClientPort;
  apiUrl: string;
  origin: string;
  originSource: CliOriginSource;
  profile: CliProfile;
  json: boolean;
}

// Auth args have no shared contract schema (the auth flow goes through Better
// Auth, not the API routes), so the CLI carries its own boundary schemas.
// Format/policy stays the server's job; the CLI only refuses empty input.
const registerArgsSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().min(1),
  password: z.string().min(1),
});
const loginArgsSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
  code: z.string().trim().min(1).optional(),
});
export const loginCredentialSelectionIsValid = (
  password: string | undefined,
  passwordStdin: boolean,
): boolean => (password !== undefined) !== passwordStdin;
const loginOptionsSchema = z
  .object({
    email: z.string().trim().min(1),
    password: z.string().optional(),
    passwordStdin: z.boolean(),
    code: z.string().trim().min(1).optional(),
  })
  .refine(({ password, passwordStdin }) => loginCredentialSelectionIsValid(password, passwordStdin), {
    message: 'Use exactly one of --password or --password-stdin',
  });
const changePasswordArgsSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
  signOutOtherSessions: z.boolean(),
});
type LoginInput = z.output<typeof loginArgsSchema>;
interface LoginActionCtx {
  auth: Pick<AuthClientPort, 'signIn' | 'verifyTotp'>;
  json: boolean;
  saveToken: (token: string) => void;
}
export const normalizeStdinPassword = (value: string): string => value.replace(/\r?\n$/, '');
const magicLinkArgsSchema = z.object({ email: z.string().trim().min(1) });
const passwordResetArgsSchema = z.object({ email: z.string().trim().min(1) });

// Merged global options (Commander parses them onto the root program). They flow
// straight into transport, so they are zod-parsed like every other boundary:
// --api-url must be a URL before any client is constructed.
const globalOptionsSchema = z.object({
  json: z.boolean(),
  apiUrl: z.url('--api-url must be a valid URL').optional(),
  token: z.string().min(1).optional(),
});
const cliEnvSchema = z.object({
  APP_CLI_API_URL: z.url('APP_CLI_API_URL must be a valid URL').optional(),
  APP_CLI_TOKEN: z.string().min(1).optional(),
});
const originUseArgsSchema = z.object({
  url: z.url('origin URL must be a valid URL'),
});
const tokenListFilterSchema = z.object({
  draft: z.enum(['true', 'false', 'all']).optional(),
});
const documentListOptionsSchema = z.object({
  signer: z.string().trim().min(1).optional(),
});
export const documentListFilterFromOptions = (
  options: z.output<typeof documentListOptionsSchema>,
): DocumentListFilter =>
  options.signer === undefined ? {} : { signerAccountId: options.signer };
const booleanOptionSchema = z.enum(['true', 'false']).transform((value) => value === 'true');
const tenantDateModeOptionSchema = z.enum(['declared', 'actual']);

export const verifySealBytes = (
  bytes: Uint8Array,
) => {
  try {
    const verification = verifyPdfSeal(bytes);
    return verification.integrity
      ? ok(verification)
      : err(validation('PDF seal integrity check failed', verification));
  } catch (cause) {
    return err(validation(`PDF seal could not be verified: ${String(cause)}`));
  }
};

const formatSealVerification = (verification: PdfSealVerification): string =>
  [
    `subject: ${verification.subject}`,
    `declared-time: ${verification.declaredAt}`,
    `integrity: ${verification.integrity ? 'valid' : 'invalid'}`,
  ].join('\n');

/**
 * Thrown by cliCtx after it has already emitted a `validation` envelope for a
 * bad global option, so the top-level catch stays silent (no second envelope).
 */
class CliBail extends Error {}

/**
 * Parse Commander-collected args/options through a domain/contract schema at
 * the CLI boundary (architecture: zod-parse every boundary). On failure it
 * emits one `validation` envelope (exit 2) and returns undefined so the action
 * bails without ever calling the API.
 */
const parseArgs = <T>(schema: z.ZodType<T>, value: unknown, json: boolean): T | undefined => {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  emit(err(validation('Invalid CLI arguments', result.error.flatten())), json, () => '');
  return undefined;
};

const cliCtx = (): CliCtx => {
  const config = loadConfig();
  const rawGlobals = program.opts<{ json: boolean; apiUrl?: string }>();
  const globals = parseArgs(globalOptionsSchema, rawGlobals, rawGlobals.json);
  if (globals === undefined) throw new CliBail();
  const env = parseArgs(cliEnvSchema, process.env, globals.json);
  if (env === undefined) throw new CliBail();
  const resolved = resolveCliConfig({
    config,
    cwd: process.cwd(),
    env,
    ...(globals.apiUrl === undefined ? {} : { apiUrl: globals.apiUrl }),
  });
  const { apiUrl, origin, originSource, profile } = resolved;
  const apiBearer = globals.token ?? env.APP_CLI_TOKEN ?? profile.token;
  const api = createApiClient({
    baseUrl: apiUrl,
    headers: () => ({
      ...(apiBearer ? { authorization: `Bearer ${apiBearer}` } : {}),
    }),
  });
  const auth = createCliAuthAdapter(
    apiUrl,
    (token) => {
      saveConfig(updateOriginProfile(config, origin, { token }, originSource !== 'repo'));
    },
    () => profile.token,
  );
  const publicApi = createApiClient({ baseUrl: apiUrl, headers: () => ({}) });
  return {
    config,
    api,
    publicApi,
    auth,
    apiUrl,
    origin,
    originSource,
    profile,
    json: globals.json,
  };
};

const saveActiveProfile = (ctx: CliCtx, patch: Partial<CliProfile>): void => {
  saveConfig(
    updateOriginProfile(ctx.config, ctx.origin, patch, ctx.originSource !== 'repo'),
  );
};

export const runLoginAction = async (ctx: LoginActionCtx, input: LoginInput): Promise<void> => {
  const result = await ctx.auth.signIn(input);
  if (!result.ok) {
    emit(result, ctx.json, () => '');
    return;
  }
  if (result.value.twoFactorRequired === true) {
    if (input.code === undefined) {
      emit(
        err(unauthorized('Two-factor authentication required. Pass --code with the current code from your authenticator app.')),
        ctx.json,
        () => '',
      );
      return;
    }
    const verified = await ctx.auth.verifyTotp({ code: input.code });
    if (!verified.ok) {
      emit(verified, ctx.json, () => '');
      return;
    }
    if (!verified.value.token) {
      emit(err(internal('Server did not return a session token')), ctx.json, () => '');
      return;
    }
    ctx.saveToken(verified.value.token);
    emit(verified, ctx.json, () => `signed in as ${input.email}`);
    return;
  }
  if (!result.value.token) {
    emit(err(internal('Server did not return a session token')), ctx.json, () => '');
    return;
  }
  ctx.saveToken(result.value.token);
  emit(result, ctx.json, () => `signed in as ${input.email}`);
};

program.command('health').description('API and database status').action(async () => {
  const ctx = cliCtx();
  emit(
    await ctx.api.health(),
    ctx.json,
    (h) => `status=${h.status} db=${h.database} v${h.version} sha=${h.sha}`,
  );
});

program
  .command('register')
  .description('Create an account (and sign in)')
  .requiredOption('--name <name>')
  .requiredOption('--email <email>')
  .requiredOption('--password <password>')
  .action(async (options: { name: string; email: string; password: string }) => {
    const ctx = cliCtx();
    const input = parseArgs(registerArgsSchema, options, ctx.json);
    if (input === undefined) return;
    const result = await ctx.auth.signUp(input);
    if (result.ok && result.value.token) {
      saveActiveProfile(ctx, { token: result.value.token });
    }
    emit(result, ctx.json, () => `registered and signed in as ${input.email}`);
  });

program
  .command('login')
  .description('Sign in and store the session token')
  .requiredOption('--email <email>')
  .option('--password <password>', 'password supplied as an argument')
  .option('--password-stdin', 'read password from stdin', false)
  .option('--code <totp>', 'current TOTP code from your authenticator app')
  .action(async (options: { email: string; password?: string; passwordStdin: boolean; code?: string }) => {
    const ctx = cliCtx();
    if (options.password !== undefined && options.passwordStdin) {
      emit(
        err(validation('Use either --password or --password-stdin, not both')),
        ctx.json,
        () => '',
      );
      return;
    }
    const parsedOptions = parseArgs(loginOptionsSchema, options, ctx.json);
    if (parsedOptions === undefined) return;
    const password = parsedOptions.password ?? normalizeStdinPassword(await consumeText(process.stdin));
    const input = parseArgs(loginArgsSchema, { ...parsedOptions, password }, ctx.json);
    if (input === undefined) return;
    await runLoginAction({
      auth: ctx.auth,
      json: ctx.json,
      saveToken: (token) => saveActiveProfile(ctx, { token }),
    }, input);
  });

program
  .command('login-link')
  .description(
    'Passwordless magic-link sign-in (US-026). Without --link it requests a link ' +
      '(read it from your inbox; in dev/CI the local Mailpit captures it — UI/API at ' +
      'the SMTP capture, no in-app route). With --link <url> it follows that link and ' +
      'establishes the session.',
  )
  .requiredOption('--email <email>')
  .option('--link <url>', 'follow a magic link (copied from Mailpit/inbox) and sign in with it')
  .action(async (options: { email: string; link?: string }) => {
    const ctx = cliCtx();
    const input = parseArgs(magicLinkArgsSchema, { email: options.email }, ctx.json);
    if (input === undefined) return;

    if (options.link === undefined) {
      const requested = await ctx.auth.requestMagicLink({ email: input.email, callbackURL: ctx.apiUrl });
      emit(
        requested.ok ? ok({ requested: true, email: input.email }) : requested,
        ctx.json,
        () => `magic link requested for ${input.email} — open it from your inbox (dev/CI: Mailpit)`,
      );
      return;
    }

    const followed = await followMagicLink(options.link);
    if (!followed.ok) {
      emit(followed, ctx.json, () => '');
      return;
    }
    if (!followed.value.token) {
      emit(err(internal('Magic link did not yield a session token')), ctx.json, () => '');
      return;
    }
    saveActiveProfile(ctx, { token: followed.value.token });
    emit(ok({ signedIn: true, email: input.email }), ctx.json, () => `signed in as ${input.email} via magic link`);
  });

const account = program.command('account').description('Manage the signed-in account');

account
  .command('change-password')
  .description('Change the account password')
  .requiredOption('--current-password <password>')
  .requiredOption('--new-password <password>')
  .option('--sign-out-other-sessions', 'invalidate every other active session', false)
  .action(async (options: { currentPassword: string; newPassword: string; signOutOtherSessions: boolean }) => {
    const ctx = cliCtx();
    const input = parseArgs(changePasswordArgsSchema, options, ctx.json);
    if (input === undefined) return;
    const result = await ctx.auth.changePassword({
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      revokeOtherSessions: input.signOutOtherSessions,
    });
    emit(
      result.ok
        ? ok({ changed: true, revokedOtherSessions: input.signOutOtherSessions })
        : result,
      ctx.json,
      () =>
        input.signOutOtherSessions
          ? 'password changed; other sessions signed out'
          : 'password changed',
    );
  });

account
  .command('request-password-reset')
  .description('Email a password-reset link; completing the reset happens from the web link.')
  .requiredOption('--email <email>')
  .action(async (options: { email: string }) => {
    const ctx = cliCtx();
    const input = parseArgs(passwordResetArgsSchema, options, ctx.json);
    if (input === undefined) return;
    const result = await ctx.auth.requestPasswordReset({
      email: input.email,
      redirectTo: new URL('/reset-password', ctx.apiUrl).toString(),
    });
    emit(
      result.ok ? ok({ requested: true, email: input.email }) : result,
      ctx.json,
      () => `password-reset link requested for ${input.email} — if that account exists, open the link from your inbox (dev/CI: Mailpit)`,
    );
  });

account.command('list').description('List accounts in the active tenant').action(async () => {
  const ctx = cliCtx();
  emit(await ctx.api.listTenantAccounts(), ctx.json, (data) =>
    data.accounts.length === 0
      ? 'no tenant accounts'
      : data.accounts
          .map((tenantAccount) => `${tenantAccount.name}\t(${tenantAccount.accountId})`)
          .join('\n'),
  );
});

program.command('logout').description('Drop the stored session token').action(async () => {
  const ctx = cliCtx();
  // Revoke the session server-side FIRST (the CLI is bearer-authenticated, so a
  // local-only clear leaves the session valid), then drop the stored token.
  const signedOut = await ctx.auth.signOut();
  saveActiveProfile(ctx, { token: null });
  emit(signedOut.ok ? ok({ loggedOut: true }) : signedOut, ctx.json, () => 'signed out');
});

program.command('whoami').description('Current user and archive access').action(async () => {
  const ctx = cliCtx();
  emit(await ctx.api.me(), ctx.json, (me) =>
    me.tenant
      ? `${me.email} @ ${me.tenant.name}`
      : `${me.email} (no archive access)`,
  );
});

const tenantSettings = program
  .command('tenant-settings')
  .description('Manage settings for the active tenant');

tenantSettings.command('show').description('Show tenant settings').action(async () => {
  const ctx = cliCtx();
  emit(await ctx.api.getTenantSettings(), ctx.json, (data) =>
    [
      `store-signature-records=${String(data.settings.storeSignatureRecords)}`,
      `pdf-seal-enabled=${String(data.settings.pdfSealEnabled)}`,
      `signature-box-enabled=${String(data.settings.signatureBoxEnabled)}`,
      `date-mode=${data.settings.dateMode}`,
    ].join('\n'),
  );
});

tenantSettings
  .command('set')
  .description('Update tenant settings')
  .option('--store-signature-records <value>', 'true|false')
  .option('--pdf-seal-enabled <value>', 'true|false')
  .option('--signature-box-enabled <value>', 'true|false')
  .option('--date-mode <mode>', 'declared|actual')
  .action(async (options: {
    storeSignatureRecords?: string;
    pdfSealEnabled?: string;
    signatureBoxEnabled?: string;
    dateMode?: string;
  }) => {
    const ctx = cliCtx();
    const storeSignatureRecords = options.storeSignatureRecords === undefined
      ? undefined
      : parseArgs(booleanOptionSchema, options.storeSignatureRecords, ctx.json);
    if (options.storeSignatureRecords !== undefined && storeSignatureRecords === undefined) return;
    const pdfSealEnabled = options.pdfSealEnabled === undefined
      ? undefined
      : parseArgs(booleanOptionSchema, options.pdfSealEnabled, ctx.json);
    if (options.pdfSealEnabled !== undefined && pdfSealEnabled === undefined) return;
    const signatureBoxEnabled = options.signatureBoxEnabled === undefined
      ? undefined
      : parseArgs(booleanOptionSchema, options.signatureBoxEnabled, ctx.json);
    if (options.signatureBoxEnabled !== undefined && signatureBoxEnabled === undefined) return;
    const dateMode = options.dateMode === undefined
      ? undefined
      : parseArgs(tenantDateModeOptionSchema, options.dateMode, ctx.json);
    if (options.dateMode !== undefined && dateMode === undefined) return;
    const input = parseArgs(
      tenantSettingsUpdateInputSchema,
      {
        ...(storeSignatureRecords === undefined ? {} : { storeSignatureRecords }),
        ...(pdfSealEnabled === undefined ? {} : { pdfSealEnabled }),
        ...(signatureBoxEnabled === undefined ? {} : { signatureBoxEnabled }),
        ...(dateMode === undefined ? {} : { dateMode }),
      },
      ctx.json,
    );
    if (input === undefined) return;
    emit(await ctx.api.updateTenantSettings(input), ctx.json, (data) =>
      [
        `store-signature-records=${String(data.settings.storeSignatureRecords)}`,
        `pdf-seal-enabled=${String(data.settings.pdfSealEnabled)}`,
        `signature-box-enabled=${String(data.settings.signatureBoxEnabled)}`,
        `date-mode=${data.settings.dateMode}`,
      ].join('\n'),
    );
  });

const origin = program.command('origin').description('API-origin profiles');

origin.command('list').description('List configured API origins').action(() => {
  const ctx = cliCtx();
  const origins = Object.entries(ctx.config.profiles)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([profileOrigin, profile]) => ({
      origin: profileOrigin,
      current: profileOrigin === ctx.config.currentOrigin,
      hasToken: profile.token !== null,
    }));
  emit(ok({ origins }), ctx.json, (data) =>
    data.origins.length === 0
      ? 'no configured origins'
      : data.origins
          .map(
            (entry) =>
              `${entry.current ? '*' : ' '} ${entry.origin}\ttoken=${entry.hasToken ? 'present' : 'absent'}`,
          )
          .join('\n'),
  );
});

origin
  .command('use <url>')
  .description('Select an API origin without making a network call')
  .action((url: string) => {
    const ctx = cliCtx();
    const input = parseArgs(originUseArgsSchema, { url }, ctx.json);
    if (input === undefined) return;
    const selectedOrigin = apiOrigin(input.url);
    saveConfig(updateOriginProfile(ctx.config, selectedOrigin, {}, true));
    emit(ok({ origin: selectedOrigin }), ctx.json, (data) => `active origin: ${data.origin}`);
  });

const document = program
  .command('document')
  .description('Documents in the active tenant — staff only (owner/admin)');

const formatDocumentRows = (documents: DocumentListItem[]): string =>
  documents.length === 0
    ? 'no documents'
    : documents
        .map((row) => {
          const signers = row.signers.map((signer) => signer.name).join(', ');
          return `- ${row.documentDate}\t${row.draft ? 'DRAFT\t' : ''}${row.title}\t${row.docType}\t(${row.id.slice(0, 8)})${signers ? `\t${signers}` : ''}`;
        })
        .join('\n');

document
  .command('list')
  .description('List documents')
  .option('--signer <accountId>', 'filter by contributing account ID')
  .action(async (options: { signer?: string }) => {
    const ctx = cliCtx();
    const parsed = parseArgs(documentListOptionsSchema, options, ctx.json);
    if (parsed === undefined) return;
    emit(await ctx.api.listDocuments(documentListFilterFromOptions(parsed)), ctx.json, (data) =>
      formatDocumentRows(data.documents),
    );
  });

document.command('trash-list').description('List soft-deleted documents').action(async () => {
  const ctx = cliCtx();
  emit(await ctx.api.listTrashedDocuments(), ctx.json, (data) =>
    data.documents.length === 0
      ? 'no trashed documents'
      : data.documents
          .map(
            (row) =>
              `- ${row.deletedAt ?? 'deleted'}\t${row.title}\t${row.docType}\t(${row.id.slice(0, 8)})`,
          )
          .join('\n'),
  );
});

document
  .command('search')
  .description('List documents with filters')
  .option('--draft <draft>', 'true|false|all')
  .action(async (options: { draft?: string }) => {
    const ctx = cliCtx();
    const filter = parseArgs(tokenListFilterSchema, options, ctx.json);
    if (filter === undefined) return;
    emit(await ctx.api.listDocuments(filter), ctx.json, (data) =>
      formatDocumentRows(data.documents),
    );
  });

export const signatureRecordsProbeResult = (
  recordsResult: { ok: true; value: { items: readonly unknown[] } } | { ok: false },
): boolean | null => (recordsResult.ok ? recordsResult.value.items.length > 0 : null);

document
  .command('show <id>')
  .description('Show a document and its attachments')
  .action(async (id: string) => {
    const ctx = cliCtx();
    const documentResult = await ctx.api.getDocument(id);
    if (!documentResult.ok) {
      emit(documentResult, ctx.json, () => '');
      return;
    }
    const recordsResult = await ctx.api.listSignatureRecords(id, { limit: 1 });
    const data = {
      document: documentResult.value.document,
      signatureRecordsExist: signatureRecordsProbeResult(recordsResult),
    };
    emit(ok(data), ctx.json, (value) => {
      const files = value.document.files
        .map((file) => `  - ${file.role}\t${file.fileName}\t(${file.id.slice(0, 8)})`)
        .join('\n');
      const records =
        value.signatureRecordsExist === null
          ? ''
          : `signature-records=${String(value.signatureRecordsExist)}\n`;
      return `${value.document.documentDate}\t${value.document.draft ? 'DRAFT\t' : ''}${value.document.title}\n${records}${files || '  no files'}`;
    });
  });

document
  .command('verify-seal <id>')
  .description('Download the newest signed-digital PDF and verify its organization seal')
  .action(async (id: string) => {
    const ctx = cliCtx();
    const documentResult = await ctx.api.getDocument(id);
    if (!documentResult.ok) {
      emit(documentResult, ctx.json, () => '');
      return;
    }
    const newest = documentResult.value.document.files
      .filter((file) => file.role === 'signed-digital')
      .reduce<(typeof documentResult.value.document.files)[number] | undefined>(
        (current, file) => !current || file.createdAt > current.createdAt ? file : current,
        undefined,
      );
    if (!newest) {
      emit(err(notFound('Signed-digital PDF not found')), ctx.json, () => '');
      return;
    }
    const downloaded = await ctx.api.downloadDocumentFile(id, newest.id);
    if (!downloaded.ok) {
      emit(downloaded, ctx.json, () => '');
      return;
    }
    emit(verifySealBytes(downloaded.value.bytes), ctx.json, formatSealVerification);
  });

document
  .command('add <title...>')
  .description('Create a document entry')
  .requiredOption('--type <type>', 'umowa-uod|uchwala|protokol|rachunek|inny')
  .requiredOption('--date <date>', 'signature date (YYYY-MM-DD)')
  .option('--period-start <date>', 'period start (YYYY-MM-DD)')
  .option('--period-end <date>', 'period end (YYYY-MM-DD)')
  .option('--person <person>', 'person')
  .option('--tag <tag...>', 'tags')
  .option('--draft', 'create as a draft awaiting owner approval', false)
  .action(
    async (
      titleWords: string[],
      options: {
        type: string;
        date: string;
        periodStart?: string;
        periodEnd?: string;
        person?: string;
        tag?: string[];
        draft: boolean;
      },
    ) => {
      const ctx = cliCtx();
      const input = parseArgs(
        documentCreateInputSchema,
        {
          title: titleWords.join(' '),
          docType: options.type,
          documentDate: options.date,
          ...(options.periodStart === undefined ? {} : { periodStart: options.periodStart }),
          ...(options.periodEnd === undefined ? {} : { periodEnd: options.periodEnd }),
          ...(options.person === undefined ? {} : { person: options.person }),
          tags: options.tag ?? [],
          ...(options.draft ? { draft: true } : {}),
        },
        ctx.json,
      );
      if (input === undefined) return;
      emit(await ctx.api.createDocument(input), ctx.json, (data) =>
        `added: ${data.document.draft ? 'draft ' : ''}${data.document.title} (${data.document.id})`,
      );
    },
  );

document
  .command('approve <id>')
  .description('Approve a draft document')
  .action(async (id: string) => {
    const ctx = cliCtx();
    emit(await ctx.api.approveDocument(id), ctx.json, (data) =>
      `approved: ${data.document.title} (${data.document.id})`,
    );
  });

document
  .command('unapprove <id>')
  .description('Revert an approved document to draft')
  .action(async (id: string) => {
    const ctx = cliCtx();
    emit(await ctx.api.unapproveDocument(id), ctx.json, (data) =>
      `unapproved: ${data.document.title} (${data.document.id})`,
    );
  });

document
  .command('waive-signature <id>')
  .description('Mark a document as not requiring a signature')
  .action(async (id: string) => {
    const ctx = cliCtx();
    emit(await ctx.api.waiveDocumentSignature(id), ctx.json, (data) =>
      `signature not required: ${data.document.title} (${data.document.id})`,
    );
  });

document
  .command('require-signature <id>')
  .description('Mark a document as requiring a signature')
  .action(async (id: string) => {
    const ctx = cliCtx();
    emit(await ctx.api.requireDocumentSignature(id), ctx.json, (data) =>
      `signature required: ${data.document.title} (${data.document.id})`,
    );
  });

document
  .command('upload <id> <path>')
  .description('Upload an attachment through the server')
  .requiredOption('--role <role>', 'source|signed-scan|signed-digital|other')
  .option('--content-type <contentType>', 'MIME type', 'application/pdf')
  .action(
    async (
      id: string,
      path: string,
      options: { role: string; contentType: string },
    ) => {
      const ctx = cliCtx();
      const bytes = new Uint8Array(await readFile(path));
      const input = parseArgs(
        z.object({
          fileName: z.string().min(1),
          contentType: z.string().min(1),
          role: z.enum(['source', 'signed-scan', 'signed-digital', 'other']),
          bytes: z.instanceof(Uint8Array),
        }),
        {
          fileName: basename(path),
          contentType: options.contentType,
          role: options.role,
          bytes,
        },
        ctx.json,
      );
      if (input === undefined) return;
      emit(await ctx.api.uploadDocumentFile(id, input), ctx.json, (data) =>
        `uploaded: ${data.file.fileName} (${data.file.id})`,
      );
    },
  );

const sourceUpdateContentType = (path: string): string => {
  const extension = extname(path).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  return 'application/pdf';
};

document
  .command('update-source <id> <path>')
  .description('Replace a document source and explicitly handle digital signatures')
  .requiredOption('--signatures <mode>', 'delete|transfer')
  .action(
    async (
      id: string,
      path: string,
      options: { signatures: string },
    ) => {
      const ctx = cliCtx();
      const mode = parseArgs(
        z.enum(['delete', 'transfer']),
        options.signatures,
        ctx.json,
      );
      if (mode === undefined) return;
      const bytes = new Uint8Array(await readFile(path));
      const fileName = basename(path);
      const contentType = sourceUpdateContentType(path);
      const uploaded = await ctx.api.uploadDocumentFile(id, {
        fileName,
        contentType,
        role: 'other',
        bytes,
      });
      if (!uploaded.ok) {
        emit(uploaded, ctx.json, () => '');
        return;
      }
      const created = await ctx.api.createSourceUpdateRequest(id, {
        newSourceFileId: uploaded.value.file.id,
        mode: mode === 'delete' ? 'delete-signed' : 'transfer',
      });
      if (!created.ok) {
        emit(created, ctx.json, () => '');
        return;
      }
      if (created.value.request.approvals.length > 0) {
        emit(created, ctx.json, (data) =>
          `pending approvals: ${data.request.approvals.length} (${data.request.id})`,
        );
        return;
      }
      if (mode === 'delete') {
        emit(
          await ctx.api.completeSourceUpdateRequest(created.value.request.id, {}),
          ctx.json,
          () => `source updated: ${id}`,
        );
        return;
      }
      const records = [];
      let cursor: string | undefined;
      do {
        const page = await ctx.api.listSignatureRecords(id, {
          limit: 100,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!page.ok) {
          emit(page, ctx.json, () => '');
          return;
        }
        records.push(...page.value.items);
        cursor = page.value.nextCursor ?? undefined;
      } while (cursor !== undefined);
      if (records.length === 0) {
        emit(
          await ctx.api.completeSourceUpdateRequest(created.value.request.id, {}),
          ctx.json,
          () => `source updated: ${id}`,
        );
        return;
      }
      const signedBytes = await replaySignatureRecordsPdf(bytes, records);
      const signedName = `${fileName.replace(/\.pdf$/iu, '') || 'dokument'}-podpisany.pdf`;
      const signed = await ctx.api.uploadDocumentFile(id, {
        fileName: signedName,
        contentType: 'application/pdf',
        role: 'other',
        bytes: signedBytes,
      });
      if (!signed.ok) {
        emit(signed, ctx.json, () => '');
        return;
      }
      emit(
        await ctx.api.completeSourceUpdateRequest(created.value.request.id, {
          signedFileId: signed.value.file.id,
        }),
        ctx.json,
        () => `source updated with transferred signatures: ${id}`,
      );
    },
  );

document
  .command('export <id>')
  .description('Export one document as a deterministic ZIP archive')
  .option('--output <path>', 'output file', 'eksport-dokumentow.zip')
  .action(async (id: string, options: { output: string }) => {
    const ctx = cliCtx();
    const result = await ctx.api.exportDocuments({ documentIds: [id] });
    if (!result.ok) {
      emit(result, ctx.json, () => '');
      return;
    }
    await writeFile(options.output, result.value.bytes);
    emit(
      ok({
        path: options.output,
        fileName: result.value.fileName,
        sizeBytes: result.value.bytes.byteLength,
      }),
      ctx.json,
      (data) => `exported: ${data.path} (${data.sizeBytes} bytes)`,
    );
  });

document
  .command('remove <id>')
  .description('Move a document to trash')
  .action(async (id: string) => {
    const ctx = cliCtx();
    emit(await ctx.api.deleteDocument(id), ctx.json, () => `removed: ${id}`);
  });

document
  .command('restore <id>')
  .description('Restore a document from trash')
  .action(async (id: string) => {
    const ctx = cliCtx();
    emit(await ctx.api.restoreDocument(id), ctx.json, (data) =>
      `restored: ${data.document.title} (${data.document.id})`,
    );
  });

document
  .command('purge <id>')
  .description('Permanently delete a document and its attachments')
  .option('--yes', 'confirm permanent deletion', false)
  .action(async (id: string, options: { yes: boolean }) => {
    const ctx = cliCtx();
    if (!options.yes) {
      emit(err(validation('Pass --yes to permanently delete a document')), ctx.json, () => '');
      return;
    }
    emit(await ctx.api.purgeDocument(id), ctx.json, () => `purged: ${id}`);
  });

const collectScope = (value: string, previous: string[]): string[] => [...previous, value];

const token = program.command('token').description('Manage personal API tokens');

token
  .command('create')
  .description('Create a scoped API token; the value is shown once')
  .requiredOption('--name <name>')
  .requiredOption('--scope <scope>', 'read|write|write:draft; repeat for multiple scopes', collectScope, [])
  .action(async (options: { name: string; scope: string[] }) => {
    const ctx = cliCtx();
    const input = parseArgs(
      apiTokenCreateInputSchema,
      { name: options.name, scopes: options.scope },
      ctx.json,
    );
    if (input === undefined) return;
    emit(await ctx.api.createApiToken(input), ctx.json, (data) =>
      `created: ${data.apiToken.name} (${data.apiToken.id})\nvalue: ${data.value}`,
    );
  });

token.command('list').description('List personal API tokens').action(async () => {
  const ctx = cliCtx();
  emit(await ctx.api.listApiTokens(), ctx.json, (data) =>
    data.apiTokens.length === 0
      ? 'no API tokens'
      : data.apiTokens
          .map((apiToken) => {
            const state = apiToken.revokedAt ? 'revoked' : 'active';
            return `- ${apiToken.name}\t${apiToken.scopes.join(',')}\t${state}\t(${apiToken.id})`;
          })
          .join('\n'),
  );
});

token.command('revoke <id>').description('Revoke a personal API token').action(async (id: string) => {
  const ctx = cliCtx();
  emit(await ctx.api.revokeApiToken(id), ctx.json, () => `revoked: ${id}`);
});

const invitation = program.command('invitation').description('Manage archive invitations');

invitation
  .command('create')
  .description('Create or regenerate an invitation; the link is shown once')
  .requiredOption('--email <email>')
  .requiredOption('--role <role>', 'owner|admin')
  .action(async (options: { email: string; role: string }) => {
    const ctx = cliCtx();
    const input = parseArgs(
      invitationCreateInputSchema,
      { email: options.email, role: options.role },
      ctx.json,
    );
    if (input === undefined) return;
    emit(await ctx.api.createInvitation(input), ctx.json, (data) =>
      `created: ${data.invitation.email} (${data.invitation.id})\nlink: ${data.url}`,
    );
  });

invitation.command('list').description('List archive invitations').action(async () => {
  const ctx = cliCtx();
  emit(await ctx.api.listInvitations(), ctx.json, (data) =>
    data.invitations.length === 0
      ? 'no invitations'
      : data.invitations
          .map((item) => `- ${item.email}\t${item.role}\t${item.status}\t(${item.id})`)
          .join('\n'),
  );
});

invitation.command('revoke <id>').description('Revoke a pending invitation').action(async (id: string) => {
  const ctx = cliCtx();
  emit(await ctx.api.revokeInvitation(id), ctx.json, () => `revoked: ${id}`);
});

const publicCmd = program
  .command('public')
  .description('Public, unauthenticated read-only surface (US-028) — hit with NO session');

publicCmd
  .command('profile <tenant>')
  .description('Fetch a tenant public profile with no session (content-version keyed)')
  .action(async (tenantArg: string) => {
    const ctx = cliCtx();
    const slug = parseArgs(canonicalSlugSchema, tenantArg, ctx.json);
    if (slug === undefined) return;
    const discovery = await ctx.publicApi.publicTenantDiscovery(slug);
    if (!discovery.ok) {
      emit(discovery, ctx.json, () => '');
      return;
    }
    emit(
      await ctx.publicApi.publicTenantProfile(slug, discovery.value.contentVersion),
      ctx.json,
      (profile) => `${profile.slug}\t${profile.displayName}\t(v${profile.contentVersion})`,
    );
  });

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const wantsJson = process.argv.includes('--json');
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CliBail) {
      // cliCtx already emitted the validation envelope and set the exit code.
    } else if (error instanceof CommanderError) {
      // Commander parse failure surfaced via exitOverride. exitCode 0 = help/version
      // whose text is already on stdout; anything else is a real parse failure that
      // must become one validation envelope with the taxonomy exit code.
      if (error.exitCode !== 0) {
        emit(err(validation(error.message.replace(/^error:\s*/i, ''))), wantsJson, () => '');
      }
    } else if (error instanceof Error && error.message.startsWith('podpisy:')) {
      emit(err(internal(error.message)), wantsJson, () => '');
    } else {
      throw error;
    }
  }
}
