import { Command, CommanderError } from 'commander';
import { z } from 'zod';

import { createCliAuthAdapter, followMagicLink } from '#adapters/auth/client-adapter.js';
import type { AuthClientPort } from '#core/client/index.js';
import { createApiClient, type ApiClient } from '#core/client/index.js';
import {
  TENANT_HEADER,
  cardCreateInputSchema,
  cardMoveInputSchema,
  memberEnsureInputSchema,
  memberRemoveInputSchema,
  memberUpdateInputSchema,
  staffGrantInputSchema,
  staffRevokeInputSchema,
  tenantCreateInputSchema,
  todoCreateInputSchema,
} from '#core/contract/index.js';
import {
  boardIdSchema,
  canonicalSlugSchema,
  domainAddInputSchema,
  err,
  internal,
  normalizeSlug,
  notFound,
  ok,
  validation,
  type BoardId,
} from '#core/domain/index.js';

import { loadConfig, saveConfig, type CliConfig } from './config.js';
import { emit } from './output.js';

const program = new Command('agentproofarch')
  .description('Reference client for the agentproofarch API — the agent feedback loop')
  .option('--json', 'machine-readable JSON output', false)
  .option('--api-url <url>', 'API base URL (overrides config)')
  .option('--tenant <slug>', 'tenant slug for this invocation (overrides config)');

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
  tenant: string | null;
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
const tenantSwitchArgsSchema = z.object({ slug: canonicalSlugSchema });

// Merged global options (Commander parses them onto the root program). They flow
// straight into transport, so they are zod-parsed like every other boundary:
// --api-url must be a URL, --tenant a slug, before any client is constructed.
const globalOptionsSchema = z.object({
  json: z.boolean(),
  apiUrl: z.url('--api-url must be a valid URL').optional(),
  tenant: canonicalSlugSchema.optional(),
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
  const rawGlobals = program.opts<{ json: boolean; apiUrl?: string; tenant?: string }>();
  const globals = parseArgs(globalOptionsSchema, rawGlobals, rawGlobals.json);
  if (globals === undefined) throw new CliBail();
  const apiUrl = globals.apiUrl ?? config.apiUrl;
  const tenant = globals.tenant ?? config.tenant;
  const api = createApiClient({
    baseUrl: apiUrl,
    headers: () => ({
      ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
      ...(tenant ? { [TENANT_HEADER]: tenant } : {}),
    }),
  });
  const auth = createCliAuthAdapter(
    apiUrl,
    (token) => {
      saveConfig({ ...config, apiUrl, token });
    },
    () => config.token,
  );
  const publicApi = createApiClient({ baseUrl: apiUrl, headers: () => ({}) });
  return { config, api, publicApi, auth, apiUrl, tenant, json: globals.json };
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
      saveConfig({ ...ctx.config, apiUrl: ctx.apiUrl, token: result.value.token });
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
      saveConfig({ ...ctx.config, apiUrl: ctx.apiUrl, token: result.value.token });
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
    saveConfig({ ...ctx.config, apiUrl: ctx.apiUrl, token: followed.value.token });
    emit(ok({ signedIn: true, email: input.email }), ctx.json, () => `signed in as ${input.email} via magic link`);
  });

program.command('logout').description('Drop the stored session token').action(async () => {
  const ctx = cliCtx();
  // Revoke the session server-side FIRST (the CLI is bearer-authenticated, so a
  // local-only clear leaves the session valid), then drop the stored token.
  const signedOut = await ctx.auth.signOut();
  saveConfig({ ...ctx.config, token: null });
  emit(signedOut.ok ? ok({ loggedOut: true }) : signedOut, ctx.json, () => 'signed out');
});

program.command('whoami').description('Current user and active tenant').action(async () => {
  const ctx = cliCtx();
  emit(await ctx.api.me(), ctx.json, (me) =>
    me.tenant
      ? `${me.email} @ ${me.tenant.name} (${me.tenant.slug}, staff: ${me.tenant.staffRole ?? 'none'})`
      : `${me.email} (no tenant selected)`,
  );
});

const tenant = program.command('tenant').description('Tenant staff access');

tenant.command('list').description('Tenants you administer').action(async () => {
  const ctx = cliCtx();
  emit(await ctx.api.listTenants(), ctx.json, (data) =>
    data.tenants.length === 0
      ? 'no staff tenants'
      : data.tenants
          .map((m) => `${m.tenant.slug}\t${m.tenant.name}\t(${m.staffRole})`)
          .join('\n'),
  );
});

tenant
  .command('create <name...>')
  .description('Create a tenant and become its owner')
  .option('--slug <slug>', 'tenant slug')
  .action(async (nameWords: string[], options: { slug?: string }) => {
    const ctx = cliCtx();
    const name = nameWords.join(' ');
    const slug = options.slug ?? normalizeSlug(name);
    const input = parseArgs(tenantCreateInputSchema, { slug, name }, ctx.json);
    if (input === undefined) return;
    emit(await ctx.api.createTenant(input), ctx.json, (data) =>
      `created tenant: ${data.tenant.name} (${data.tenant.slug})`,
    );
  });

tenant
  .command('switch <slug>')
  .description('Set the active tenant for subsequent commands')
  .action(async (slugArg: string) => {
    const ctx = cliCtx();
    const input = parseArgs(tenantSwitchArgsSchema, { slug: slugArg }, ctx.json);
    if (input === undefined) return;
    const { slug } = input;
    const tenants = await ctx.api.listTenants();
    if (!tenants.ok) {
      emit(tenants, ctx.json, () => '');
      return;
    }
    const membership = tenants.value.tenants.find((m) => m.tenant.slug === slug);
    if (!membership) {
      emit(
        err(notFound(`You do not administer any tenant with slug "${slug}"`)),
        ctx.json,
        () => '',
      );
      return;
    }
    saveConfig({ ...ctx.config, tenant: slug });
    emit(ok(membership), ctx.json, (m) => `active tenant: ${m.tenant.name} (${m.tenant.slug})`);
  });

const todo = program.command('todo').description('Todos in the active tenant');

todo.command('list').description('List todos').action(async () => {
  const ctx = cliCtx();
  emit(await ctx.api.listTodos(), ctx.json, (data) =>
    data.todos.length === 0
      ? 'no todos'
      : data.todos.map((t) => `- ${t.title}  (${t.id.slice(0, 8)})`).join('\n'),
  );
});

todo
  .command('add <title...>')
  .description('Add a todo')
  .action(async (titleWords: string[]) => {
    const ctx = cliCtx();
    const input = parseArgs(todoCreateInputSchema, { title: titleWords.join(' ') }, ctx.json);
    if (input === undefined) return;
    emit(await ctx.api.addTodo(input), ctx.json, (data) =>
      `added: ${data.todo.title} (${data.todo.id.slice(0, 8)})`,
    );
  });

const card = program
  .command('card')
  .description(
    'Cards on a board in the active tenant (default: personal). ' +
      'The team board (--board team) enforces ordered columns todo->in-dev->review->done ' +
      'with WIP limits; illegal moves are rejected (validation, exit 2) naming the broken rule.',
  );

/** Parse a `--board` value into a `BoardId`, or null when it is not a known board. */
const parseBoard = (value: string): BoardId | null => {
  const parsed = boardIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

card
  .command('list')
  .description('List cards on a board, grouped by column')
  .option('--board <board>', 'board (personal|team)', 'personal')
  .action(async (options: { board: string }) => {
    const ctx = cliCtx();
    const board = parseBoard(options.board);
    if (board === null) {
      emit(err(validation(`--board must be personal or team, got "${options.board}"`)), ctx.json, () => '');
      return;
    }
    emit(await ctx.api.listCards(board), ctx.json, (data) =>
      data.cards.length === 0
        ? 'no cards'
        : [...data.cards]
            .sort((a, b) => a.column.localeCompare(b.column) || a.position - b.position)
            .map((c) => `- [${c.column}] ${c.title}  (${c.id.slice(0, 8)})`)
            .join('\n'),
    );
  });

card
  .command('add <title...>')
  .description('Add a card to a column (default: todo)')
  .option('--board <board>', 'board (personal|team)', 'personal')
  .option('--column <column>', 'target column', 'todo')
  .action(async (titleWords: string[], options: { board: string; column: string }) => {
    const ctx = cliCtx();
    const board = parseBoard(options.board);
    if (board === null) {
      emit(err(validation(`--board must be personal or team, got "${options.board}"`)), ctx.json, () => '');
      return;
    }
    const input = parseArgs(
      cardCreateInputSchema,
      { title: titleWords.join(' '), board, column: options.column },
      ctx.json,
    );
    if (input === undefined) return;
    emit(
      await ctx.api.addCard(input),
      ctx.json,
      (data) => `added: ${data.card.title} [${data.card.column}#${data.card.position}] (${data.card.id.slice(0, 8)})`,
    );
  });

card
  .command('move <id>')
  .description('Move a card to a column, at an optional 0-based index (default: end)')
  .option('--board <board>', 'board (personal|team)', 'personal')
  .requiredOption('--to <column>', 'destination column')
  .option('--index <n>', 'destination index within the column')
  .action(async (id: string, options: { board: string; to: string; index?: string }) => {
    const ctx = cliCtx();
    const board = parseBoard(options.board);
    if (board === null) {
      emit(err(validation(`--board must be personal or team, got "${options.board}"`)), ctx.json, () => '');
      return;
    }
    const toIndex = options.index === undefined ? Number.MAX_SAFE_INTEGER : Number(options.index);
    const input = parseArgs(
      cardMoveInputSchema,
      { cardId: id, board, toColumn: options.to, toIndex },
      ctx.json,
    );
    if (input === undefined) return;
    emit(
      await ctx.api.moveCard(input),
      ctx.json,
      (data) => `moved: ${data.card.title} -> [${data.card.column}#${data.card.position}] (${data.card.id.slice(0, 8)})`,
    );
  });

const member = program
  .command('member')
  .description('End customers (members) in the active tenant — staff only (owner/admin)');

member.command('list').description('List members').action(async () => {
  const ctx = cliCtx();
  emit(await ctx.api.listMembers(), ctx.json, (data) =>
    data.members.length === 0
      ? 'no members'
      : data.members
          .map((m) => {
            const tags = m.tags.length > 0 ? `  [${m.tags.join(', ')}]` : '';
            return `- ${m.email}\t${m.displayName ?? '—'}  (${m.id.slice(0, 8)})${tags}`;
          })
          .join('\n'),
  );
});

member
  .command('ensure <email>')
  .description('Idempotently find-or-create a member by email (the FR-20 entry point)')
  .option('--name <displayName>', 'display name')
  .option('--tag <tag...>', 'tag (repeatable)')
  .action(async (email: string, options: { name?: string; tag?: string[] }) => {
    const ctx = cliCtx();
    const input = parseArgs(
      memberEnsureInputSchema,
      {
        email,
        ...(options.name === undefined ? {} : { displayName: options.name }),
        ...(options.tag === undefined ? {} : { tags: options.tag }),
      },
      ctx.json,
    );
    if (input === undefined) return;
    emit(await ctx.api.ensureMember(input), ctx.json, (data) =>
      `${data.created ? 'created' : 'exists'}: ${data.member.email} (${data.member.id.slice(0, 8)})`,
    );
  });

member
  .command('update <id>')
  .description("Update a member's display name and tags")
  .option('--name <displayName>', 'set the display name')
  .option('--clear-name', 'clear the display name')
  .option('--tag <tag...>', 'replace all tags (repeatable)')
  .action(
    async (id: string, options: { name?: string; clearName?: boolean; tag?: string[] }) => {
      const ctx = cliCtx();
      const displayName = options.clearName
        ? { displayName: null }
        : options.name === undefined
          ? {}
          : { displayName: options.name };
      const input = parseArgs(
        memberUpdateInputSchema,
        { id, ...displayName, ...(options.tag === undefined ? {} : { tags: options.tag }) },
        ctx.json,
      );
      if (input === undefined) return;
      emit(await ctx.api.updateMember(input), ctx.json, (data) =>
        `updated: ${data.member.email} (${data.member.id.slice(0, 8)})`,
      );
    },
  );

member
  .command('remove <id>')
  .description('Remove a member and their tenant-scoped data (the global account is untouched)')
  .action(async (id: string) => {
    const ctx = cliCtx();
    const input = parseArgs(memberRemoveInputSchema, { id }, ctx.json);
    if (input === undefined) return;
    emit(await ctx.api.removeMember(input), ctx.json, (data) =>
      `removed: ${data.memberId} (members deleted: ${data.deleted.members})`,
    );
  });

member
  .command('export <id>')
  .description('Export one member as a JSON dump (GDPR access/portability)')
  .action(async (id: string) => {
    const ctx = cliCtx();
    const input = parseArgs(memberRemoveInputSchema, { id }, ctx.json);
    if (input === undefined) return;
    emit(await ctx.api.exportMember(input.id), ctx.json, (data) =>
      `exported ${data.member.email} at ${data.exportedAt}`,
    );
  });

const staff = program
  .command('staff')
  .description(
    'Tenant staff (owner/admin) in the active tenant — FR-8. Listing is staff-readable; ' +
      'granting and revoking admin access is owner-only. No invitations: the target user must ' +
      'already have an account (grant returns not_found otherwise).',
  );

staff.command('list').description('List the tenant staff (owner/admin)').action(async () => {
  const ctx = cliCtx();
  emit(await ctx.api.listStaff(), ctx.json, (data) =>
    data.staff.length === 0
      ? 'no staff'
      : data.staff.map((s) => `- ${s.email}\t${s.name}  (${s.role})`).join('\n'),
  );
});

staff
  .command('grant <email>')
  .description('Grant flat admin access to an existing account by email (owner-only)')
  .action(async (email: string) => {
    const ctx = cliCtx();
    const input = parseArgs(staffGrantInputSchema, { email }, ctx.json);
    if (input === undefined) return;
    emit(await ctx.api.grantStaff(input), ctx.json, (data) =>
      `${data.granted ? 'granted' : 'already staff'}: ${data.staff.email} (${data.staff.role})`,
    );
  });

staff
  .command('revoke')
  .description('Revoke a staff grant by --email or --user-id (owner-only; cannot revoke the last owner)')
  .option('--email <email>', 'target account email')
  .option('--user-id <userId>', 'target account id')
  .action(async (options: { email?: string; userId?: string }) => {
    const ctx = cliCtx();
    const input = parseArgs(
      staffRevokeInputSchema,
      {
        ...(options.email === undefined ? {} : { email: options.email }),
        ...(options.userId === undefined ? {} : { userId: options.userId }),
      },
      ctx.json,
    );
    if (input === undefined) return;
    emit(await ctx.api.revokeStaff(input), ctx.json, (data) =>
      `revoked: ${data.userId} (grants removed: ${data.revoked})`,
    );
  });

const domain = program
  .command('domain')
  .description(
    'Custom domains for the active tenant (US-019). Reading is staff-readable; ' +
      'adding, checking and removing a domain are owner-only. A newly added domain is ' +
      'unverified until `domain check` confirms DNS points at the deploy target.',
  );

domain.command('list').description('List the tenant custom domains and the DNS target').action(async () => {
  const ctx = cliCtx();
  emit(await ctx.api.listDomains(), ctx.json, (data) => {
    const target = data.target.cname
      ? `CNAME → ${data.target.cname}`
      : data.target.ip
        ? `A → ${data.target.ip}`
        : 'no DNS target configured';
    const rows =
      data.domains.length === 0
        ? 'no domains'
        : data.domains
            .map((d) => `- ${d.domain}\t${d.verified ? 'verified' : 'pending'}`)
            .join('\n');
    return `${rows}\n(${target})`;
  });
});

domain
  .command('add <domain>')
  .description('Attach a custom domain (owner-only; starts unverified)')
  .action(async (domainArg: string) => {
    const ctx = cliCtx();
    const input = parseArgs(domainAddInputSchema, { domain: domainArg }, ctx.json);
    if (input === undefined) return;
    emit(await ctx.api.addDomain(input), ctx.json, (data) =>
      `attached: ${data.domain.domain} (${data.domain.verified ? 'verified' : 'pending'})`,
    );
  });

domain
  .command('check <domain>')
  .description('Re-verify a domain against the DNS target (owner-only)')
  .action(async (domainArg: string) => {
    const ctx = cliCtx();
    const input = parseArgs(domainAddInputSchema, { domain: domainArg }, ctx.json);
    if (input === undefined) return;
    emit(await ctx.api.checkDomain(input), ctx.json, (data) =>
      `${data.domain.domain}: ${data.domain.verified ? 'verified' : 'pending'} — ${data.check.detail}`,
    );
  });

domain
  .command('remove <domain>')
  .description('Detach a custom domain (owner-only)')
  .action(async (domainArg: string) => {
    const ctx = cliCtx();
    const input = parseArgs(domainAddInputSchema, { domain: domainArg }, ctx.json);
    if (input === undefined) return;
    emit(await ctx.api.removeDomain(input), ctx.json, (data) =>
      `removed: ${data.domain} (rows: ${data.removed})`,
    );
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
    // Two-step, exercising the content-version flow: discover the current
    // version, then fetch the long-cached profile keyed on it.
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
  } else {
    throw error;
  }
}
