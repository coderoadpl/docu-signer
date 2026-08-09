import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { Command, CommanderError } from 'commander';
import { z } from 'zod';

import { createCliAuthAdapter, followMagicLink } from '#adapters/auth/client-adapter.js';
import type { AuthClientPort } from '#core/client/index.js';
import { createApiClient, type ApiClient } from '#core/client/index.js';
import { documentCreateInputSchema } from '#core/contract/index.js';
import {
  canonicalSlugSchema,
  err,
  internal,
  ok,
  validation,
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
  .option('--api-url <url>', 'API base URL (overrides config)');

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
});
const magicLinkArgsSchema = z.object({ email: z.string().trim().min(1) });

// Merged global options (Commander parses them onto the root program). They flow
// straight into transport, so they are zod-parsed like every other boundary:
// --api-url must be a URL before any client is constructed.
const globalOptionsSchema = z.object({
  json: z.boolean(),
  apiUrl: z.url('--api-url must be a valid URL').optional(),
});
const cliEnvSchema = z.object({
  APP_CLI_API_URL: z.url('APP_CLI_API_URL must be a valid URL').optional(),
});
const originUseArgsSchema = z.object({
  url: z.url('origin URL must be a valid URL'),
});

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
  const api = createApiClient({
    baseUrl: apiUrl,
    headers: () => ({
      ...(profile.token ? { authorization: `Bearer ${profile.token}` } : {}),
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
  .requiredOption('--password <password>')
  .action(async (options: { email: string; password: string }) => {
    const ctx = cliCtx();
    const input = parseArgs(loginArgsSchema, options, ctx.json);
    if (input === undefined) return;
    const result = await ctx.auth.signIn(input);
    if (result.ok) {
      if (!result.value.token) {
        emit(err(internal('Server did not return a session token')), ctx.json, () => '');
        return;
      }
      saveActiveProfile(ctx, { token: result.value.token });
    }
    emit(result, ctx.json, () => `signed in as ${input.email}`);
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

document.command('list').description('List documents').action(async () => {
  const ctx = cliCtx();
  emit(await ctx.api.listDocuments(), ctx.json, (data) =>
    data.documents.length === 0
      ? 'no documents'
      : data.documents
          .map(
            (row) =>
              `- ${row.documentDate}\t${row.title}\t${row.docType}\t(${row.id.slice(0, 8)})`,
          )
          .join('\n'),
  );
});

document
  .command('show <id>')
  .description('Show a document and its attachments')
  .action(async (id: string) => {
    const ctx = cliCtx();
    emit(await ctx.api.getDocument(id), ctx.json, (data) => {
      const files = data.document.files
        .map((file) => `  - ${file.role}\t${file.fileName}\t(${file.id.slice(0, 8)})`)
        .join('\n');
      return `${data.document.documentDate}\t${data.document.title}\n${files || '  no files'}`;
    });
  });

document
  .command('add <title...>')
  .description('Create a document entry')
  .requiredOption('--type <type>', 'umowa-uod|uchwala|protokol|rachunek|inny')
  .requiredOption('--date <date>', 'document date (YYYY-MM-DD)')
  .option('--person <person>', 'person')
  .option('--tag <tag...>', 'tags')
  .action(
    async (
      titleWords: string[],
      options: { type: string; date: string; person?: string; tag?: string[] },
    ) => {
      const ctx = cliCtx();
      const input = parseArgs(
        documentCreateInputSchema,
        {
          title: titleWords.join(' '),
          docType: options.type,
          documentDate: options.date,
          ...(options.person === undefined ? {} : { person: options.person }),
          tags: options.tag ?? [],
        },
        ctx.json,
      );
      if (input === undefined) return;
      emit(await ctx.api.createDocument(input), ctx.json, (data) =>
        `added: ${data.document.title} (${data.document.id})`,
      );
    },
  );

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
  .description('Delete a document and its attachments')
  .action(async (id: string) => {
    const ctx = cliCtx();
    emit(await ctx.api.deleteDocument(id), ctx.json, () => `removed: ${id}`);
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
