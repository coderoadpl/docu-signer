import { Command } from 'commander';

import { createCliAuthAdapter } from '#adapters/auth/client-adapter.js';
import type { AuthClientPort } from '#core/client/index.js';
import { createApiClient, type ApiClient } from '#core/client/index.js';
import { TENANT_HEADER } from '#core/contract/index.js';
import { err, internal, notFound, ok } from '#core/domain/index.js';

import { loadConfig, saveConfig, type CliConfig } from './config.js';
import { emit } from './output.js';

const program = new Command('agentproofarch')
  .description('Reference client for the agentproofarch API — the agent feedback loop')
  .option('--json', 'machine-readable JSON output', false)
  .option('--api-url <url>', 'API base URL (overrides config)')
  .option('--tenant <slug>', 'tenant slug for this invocation (overrides config)');

interface CliCtx {
  config: CliConfig;
  api: ApiClient;
  auth: AuthClientPort;
  apiUrl: string;
  tenant: string | null;
  json: boolean;
}

const slugFromName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const cliCtx = (): CliCtx => {
  const config = loadConfig();
  const globals = program.opts<{ json: boolean; apiUrl?: string; tenant?: string }>();
  const apiUrl = globals.apiUrl ?? config.apiUrl;
  const tenant = globals.tenant ?? config.tenant;
  const api = createApiClient({
    baseUrl: apiUrl,
    headers: () => ({
      ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
      ...(tenant ? { [TENANT_HEADER]: tenant } : {}),
    }),
  });
  const auth = createCliAuthAdapter(apiUrl, (token) => {
    saveConfig({ ...config, apiUrl, token });
  });
  return { config, api, auth, apiUrl, tenant, json: globals.json };
};

program.command('health').description('API and database status').action(async () => {
  const ctx = cliCtx();
  emit(await ctx.api.health(), ctx.json, (h) => `status=${h.status} db=${h.database} v${h.version}`);
});

program
  .command('register')
  .description('Create an account (and sign in)')
  .requiredOption('--name <name>')
  .requiredOption('--email <email>')
  .requiredOption('--password <password>')
  .action(async (options: { name: string; email: string; password: string }) => {
    const ctx = cliCtx();
    const result = await ctx.auth.signUp(options);
    if (result.ok && result.value.token) {
      saveConfig({ ...ctx.config, apiUrl: ctx.apiUrl, token: result.value.token });
    }
    emit(result, ctx.json, () => `registered and signed in as ${options.email}`);
  });

program
  .command('login')
  .description('Sign in and store the session token')
  .requiredOption('--email <email>')
  .requiredOption('--password <password>')
  .action(async (options: { email: string; password: string }) => {
    const ctx = cliCtx();
    const result = await ctx.auth.signIn(options);
    if (result.ok) {
      if (!result.value.token) {
        emit(err(internal('Server did not return a session token')), ctx.json, () => '');
        return;
      }
      saveConfig({ ...ctx.config, apiUrl: ctx.apiUrl, token: result.value.token });
    }
    emit(result, ctx.json, () => `signed in as ${options.email}`);
  });

program.command('logout').description('Drop the stored session token').action(() => {
  const ctx = cliCtx();
  saveConfig({ ...ctx.config, token: null });
  emit(ok({ loggedOut: true }), ctx.json, () => 'signed out');
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
    const slug = options.slug ?? slugFromName(name);
    emit(await ctx.api.createTenant({ slug, name }), ctx.json, (data) =>
      `created tenant: ${data.tenant.name} (${data.tenant.slug})`,
    );
  });

tenant
  .command('switch <slug>')
  .description('Set the active tenant for subsequent commands')
  .action(async (slug: string) => {
    const ctx = cliCtx();
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
    emit(await ctx.api.addTodo({ title: titleWords.join(' ') }), ctx.json, (data) =>
      `added: ${data.todo.title} (${data.todo.id.slice(0, 8)})`,
    );
  });

await program.parseAsync(process.argv);
