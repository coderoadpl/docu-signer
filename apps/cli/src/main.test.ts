import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
  type MockInstance,
} from 'vitest';

import type { ApiClientOptions } from '#core/client/index.js';
import { appError, err, ok, type AppError, type Result } from '#core/domain/index.js';

import type {
  CliConfig,
  ResolveCliConfigInput,
  ResolvedCliConfig,
} from './config.js';

type Async<T> = () => Promise<Result<T, AppError>>;
type AsyncIn<I, T> = (input: I) => Promise<Result<T, AppError>>;

type Health = { status: 'ok'; database: string; version: string };
type Me = { email: string; tenant: { name: string; slug: string; staffRole: string | null } | null };
type Membership = { tenant: { slug: string; name: string }; staffRole: string };
type TenantList = { tenants: Membership[] };
type TenantCreate = { tenant: { name: string; slug: string } };
type TodoList = { todos: { id: string; title: string }[] };
type TodoCreate = { todo: { id: string; title: string } };
type CardItem = { id: string; title: string; column: string; position: number };
type CardList = { cards: CardItem[] };
type CardWrite = { card: CardItem };
type PageQuery = { cursor?: string; limit?: number };
type MemberList = {
  members: { id: string; email: string; displayName: string | null; tags: string[] }[];
  nextCursor: string | null;
};
type StaffList = {
  staff: { email: string; name: string; role: string }[];
  nextCursor: string | null;
};
type Session = { token: string | null };
type PublicDiscovery = { slug: string; contentVersion: string };
type PublicProfile = { slug: string; displayName: string; contentVersion: string };

const CARD_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_CARD_ID = '22222222-2222-4222-8222-222222222222';

interface FakeApi {
  health: Mock<Async<Health>>;
  me: Mock<Async<Me>>;
  listTenants: Mock<Async<TenantList>>;
  createTenant: Mock<AsyncIn<{ slug: string; name: string }, TenantCreate>>;
  listTodos: Mock<Async<TodoList>>;
  addTodo: Mock<AsyncIn<{ title: string }, TodoCreate>>;
  listCards: Mock<Async<CardList>>;
  addCard: Mock<AsyncIn<{ title: string; board: string; column: string }, CardWrite>>;
  moveCard: Mock<AsyncIn<{ cardId: string; board: string; toColumn: string; toIndex: number }, CardWrite>>;
  listMembers: Mock<AsyncIn<PageQuery, MemberList>>;
  listStaff: Mock<AsyncIn<PageQuery, StaffList>>;
  publicTenantDiscovery: Mock<AsyncIn<string, PublicDiscovery>>;
  publicTenantProfile: Mock<(slug: string, version: string) => Promise<Result<PublicProfile, AppError>>>;
}

interface FakeAuth {
  signUp: Mock<AsyncIn<{ name: string; email: string; password: string }, Session>>;
  signIn: Mock<AsyncIn<{ email: string; password: string }, Session>>;
  signOut: Mock<Async<void>>;
}

interface Hoisted {
  config: CliConfig;
  loadError: Error | null;
  repoDetected: boolean;
  saved: CliConfig[];
  apiOptions: ApiClientOptions | null;
  authBaseUrl: string | null;
  onToken: ((token: string) => void) | null;
  api: FakeApi;
  auth: FakeAuth;
}

const h = vi.hoisted(
  (): Hoisted => ({
    config: {
      version: 2,
      currentOrigin: 'http://localhost:47100',
      profiles: {
        'http://localhost:47100': { token: null, tenant: null },
      },
    },
    loadError: null,
    repoDetected: false,
    saved: [],
    apiOptions: null,
    authBaseUrl: null,
    onToken: null,
    api: {
      health: vi.fn<Async<Health>>(),
      me: vi.fn<Async<Me>>(),
      listTenants: vi.fn<Async<TenantList>>(),
      createTenant: vi.fn<AsyncIn<{ slug: string; name: string }, TenantCreate>>(),
      listTodos: vi.fn<Async<TodoList>>(),
      addTodo: vi.fn<AsyncIn<{ title: string }, TodoCreate>>(),
      listCards: vi.fn<Async<CardList>>(),
      addCard: vi.fn<AsyncIn<{ title: string; board: string; column: string }, CardWrite>>(),
      moveCard: vi.fn<AsyncIn<{ cardId: string; board: string; toColumn: string; toIndex: number }, CardWrite>>(),
      listMembers: vi.fn<AsyncIn<PageQuery, MemberList>>(),
      listStaff: vi.fn<AsyncIn<PageQuery, StaffList>>(),
      publicTenantDiscovery: vi.fn<AsyncIn<string, PublicDiscovery>>(),
      publicTenantProfile: vi.fn<(slug: string, version: string) => Promise<Result<PublicProfile, AppError>>>(),
    },
    auth: {
      signUp: vi.fn<AsyncIn<{ name: string; email: string; password: string }, Session>>(),
      signIn: vi.fn<AsyncIn<{ email: string; password: string }, Session>>(),
      signOut: vi.fn<Async<void>>(),
    },
  }),
);

vi.mock('./config.js', () => ({
  apiOrigin: (apiUrl: string): string => new URL(apiUrl).origin,
  loadConfig: (): CliConfig => {
    if (h.loadError) throw h.loadError;
    return h.config;
  },
  resolveCliConfig: (input: ResolveCliConfigInput): ResolvedCliConfig => {
    const selection =
      input.apiUrl !== undefined
        ? { apiUrl: input.apiUrl, originSource: 'flag' as const }
        : input.env.APP_CLI_API_URL !== undefined
          ? { apiUrl: input.env.APP_CLI_API_URL, originSource: 'env' as const }
          : h.repoDetected
            ? { apiUrl: 'http://localhost:47100', originSource: 'repo' as const }
            : { apiUrl: input.config.currentOrigin, originSource: 'stored' as const };
    const origin = new URL(selection.apiUrl).origin;
    const profile = input.config.profiles[origin] ?? { token: null, tenant: null };
    return {
      ...selection,
      origin,
      profile,
      tenant: input.tenant ?? input.env.APP_CLI_TENANT ?? profile.tenant,
    };
  },
  saveConfig: (config: CliConfig): void => {
    h.saved.push(config);
  },
  updateOriginProfile: (
    config: CliConfig,
    origin: string,
    patch: { token?: string | null; tenant?: string | null },
    setCurrent: boolean,
  ): CliConfig => ({
    ...config,
    currentOrigin: setCurrent ? origin : config.currentOrigin,
    profiles: {
      ...config.profiles,
      [origin]: {
        ...(config.profiles[origin] ?? { token: null, tenant: null }),
        ...patch,
      },
    },
  }),
}));

vi.mock('#core/client/index.js', () => ({
  // Capture the FIRST client built (the primary authed one); cliCtx also builds a
  // second, header-less client for the public surface.
  createApiClient: (options: ApiClientOptions): FakeApi => {
    h.apiOptions ??= options;
    return h.api;
  },
}));

vi.mock('#adapters/auth/client-adapter.js', () => ({
  createCliAuthAdapter: (baseUrl: string, onToken: (token: string) => void): FakeAuth => {
    h.authBaseUrl = baseUrl;
    h.onToken = onToken;
    return h.auth;
  },
}));

const originalArgv = process.argv;
const originalApiUrlEnv = process.env['APP_CLI_API_URL'];
const originalTenantEnv = process.env['APP_CLI_TENANT'];

const singleProfile = (
  origin: string,
  token: string | null,
  tenant: string | null,
): CliConfig => ({
  version: 2,
  currentOrigin: origin,
  profiles: {
    [origin]: { token, tenant },
  },
});

let logSpy: MockInstance<typeof console.log>;
let errorSpy: MockInstance<typeof console.error>;

const run = async (...args: string[]): Promise<void> => {
  process.argv = ['node', 'podpisy', ...args];
  vi.resetModules();
  await import('./main.js');
};

const soleJson = (): unknown => {
  expect(logSpy).toHaveBeenCalledTimes(1);
  const [line] = logSpy.mock.calls[0] ?? [];
  return JSON.parse(String(line));
};

beforeEach(() => {
  h.config = singleProfile('http://localhost:47100', null, null);
  h.loadError = null;
  h.repoDetected = false;
  delete process.env['APP_CLI_API_URL'];
  delete process.env['APP_CLI_TENANT'];
  h.saved = [];
  h.apiOptions = null;
  h.authBaseUrl = null;
  h.onToken = null;

  for (const fn of [
    h.api.health,
    h.api.me,
    h.api.listTenants,
    h.api.createTenant,
    h.api.listTodos,
    h.api.addTodo,
    h.api.listCards,
    h.api.addCard,
    h.api.moveCard,
    h.api.listMembers,
    h.api.listStaff,
    h.api.publicTenantDiscovery,
    h.api.publicTenantProfile,
  ]) {
    fn.mockReset();
  }
  h.auth.signUp.mockReset();
  h.auth.signIn.mockReset();
  h.auth.signOut.mockReset();

  h.api.health.mockResolvedValue(ok({ status: 'ok', database: 'up', version: '1.2.3', sha: 'cafe1234' }));
  h.api.me.mockResolvedValue(ok({ email: 'demo@x', tenant: null }));
  h.api.listTenants.mockResolvedValue(ok({ tenants: [] }));
  h.api.createTenant.mockResolvedValue(ok({ tenant: { name: 'Acme Corp', slug: 'acme-corp' } }));
  h.api.listTodos.mockResolvedValue(ok({ todos: [] }));
  h.api.addTodo.mockResolvedValue(ok({ todo: { id: 'todo-1234abcd', title: 'buy milk' } }));
  h.api.listCards.mockResolvedValue(ok({ cards: [] }));
  h.api.addCard.mockResolvedValue(
    ok({ card: { id: CARD_ID, title: 'ship it', column: 'todo', position: 0 } }),
  );
  h.api.moveCard.mockResolvedValue(
    ok({ card: { id: CARD_ID, title: 'ship it', column: 'doing', position: 1 } }),
  );
  h.api.listMembers.mockResolvedValue(ok({ members: [], nextCursor: null }));
  h.api.listStaff.mockResolvedValue(ok({ staff: [], nextCursor: null }));
  h.api.publicTenantDiscovery.mockResolvedValue(ok({ slug: 'acme', contentVersion: 'v1abc' }));
  h.api.publicTenantProfile.mockResolvedValue(
    ok({ slug: 'acme', displayName: 'Acme Corp', contentVersion: 'v1abc' }),
  );
  h.auth.signIn.mockResolvedValue(ok({ token: 'sess-tok' }));
  h.auth.signUp.mockResolvedValue(ok({ token: 'reg-tok' }));
  h.auth.signOut.mockResolvedValue(ok(undefined));

  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.exitCode = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

afterAll(() => {
  process.argv = originalArgv;
  if (originalApiUrlEnv === undefined) delete process.env['APP_CLI_API_URL'];
  else process.env['APP_CLI_API_URL'] = originalApiUrlEnv;
  if (originalTenantEnv === undefined) delete process.env['APP_CLI_TENANT'];
  else process.env['APP_CLI_TENANT'] = originalTenantEnv;
});

describe('command wiring', () => {
  it('routes `health` to api.health and prints the human summary', async () => {
    await run('health');

    expect(h.api.health).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('status=ok db=up v1.2.3 sha=cafe1234');
    expect(process.exitCode).toBe(0);
  });

  it('routes `whoami` to api.me and prints the tenant-less summary', async () => {
    await run('whoami');

    expect(h.api.me).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('demo@x (no tenant selected)');
  });

  it('formats `whoami` with the active tenant and staff role', async () => {
    h.api.me.mockResolvedValue(
      ok({ email: 'demo@x', tenant: { name: 'Acme', slug: 'acme', staffRole: 'owner' } }),
    );

    await run('whoami');

    expect(logSpy).toHaveBeenCalledExactlyOnceWith('demo@x @ Acme (acme, staff: owner)');
  });

  it('falls back to "none" when the active tenant has no staff role', async () => {
    h.api.me.mockResolvedValue(
      ok({ email: 'demo@x', tenant: { name: 'Acme', slug: 'acme', staffRole: null } }),
    );

    await run('whoami');

    expect(logSpy).toHaveBeenCalledExactlyOnceWith('demo@x @ Acme (acme, staff: none)');
  });

  it('lists administered tenants for `tenant list`', async () => {
    h.api.listTenants.mockResolvedValue(
      ok({ tenants: [{ tenant: { slug: 'acme', name: 'Acme' }, staffRole: 'owner' }] }),
    );

    await run('tenant', 'list');

    expect(h.api.listTenants).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('acme\tAcme\t(owner)');
  });

  it('reports the empty state for `tenant list`', async () => {
    await run('tenant', 'list');
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('no staff tenants');
  });

  it('formats a non-empty `todo list`', async () => {
    h.api.listTodos.mockResolvedValue(
      ok({ todos: [{ id: 'abcdef1234', title: 'Ship it' }] }),
    );

    await run('todo', 'list');

    expect(logSpy).toHaveBeenCalledExactlyOnceWith('- Ship it  (abcdef12)');
  });

  it('reports the empty state for `todo list`', async () => {
    await run('todo', 'list');
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('no todos');
  });

  it('joins variadic words and calls api.addTodo with the assembled title', async () => {
    await run('todo', 'add', 'buy', 'milk');

    expect(h.api.addTodo).toHaveBeenCalledExactlyOnceWith({ title: 'buy milk' });
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('added: buy milk (todo-123)');
  });

  it('routes `todo list` to api.listTodos', async () => {
    await run('todo', 'list');
    expect(h.api.listTodos).toHaveBeenCalledTimes(1);
  });

  it('derives the tenant slug from the name when --slug is omitted', async () => {
    await run('tenant', 'create', 'Acme', 'Corp');
    expect(h.api.createTenant).toHaveBeenCalledExactlyOnceWith({ slug: 'acme-corp', name: 'Acme Corp' });
  });

  it('uses the explicit --slug override for `tenant create`', async () => {
    await run('tenant', 'create', '--slug', 'custom-slug', 'Acme', 'Corp');
    expect(h.api.createTenant).toHaveBeenCalledExactlyOnceWith({ slug: 'custom-slug', name: 'Acme Corp' });
  });
});

describe('card commands', () => {
  it('reports the empty state for `card list`', async () => {
    await run('card', 'list');
    expect(h.api.listCards).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('no cards');
  });

  it('groups a non-empty `card list` by column then position', async () => {
    h.api.listCards.mockResolvedValue(
      ok({
        cards: [
          { id: 'ddddddddaa', title: 'Deploy', column: 'doing', position: 1 },
          { id: 'aaaaaaaabb', title: 'Design', column: 'doing', position: 0 },
          { id: 'ccccccccdd', title: 'Done thing', column: 'done', position: 0 },
        ],
      }),
    );

    await run('card', 'list');

    expect(logSpy).toHaveBeenCalledExactlyOnceWith(
      ['- [doing] Design  (aaaaaaaa)', '- [doing] Deploy  (dddddddd)', '- [done] Done thing  (cccccccc)'].join('\n'),
    );
  });

  it('joins variadic words and defaults the column to todo for `card add`', async () => {
    await run('card', 'add', 'ship', 'it');

    expect(h.api.addCard).toHaveBeenCalledExactlyOnceWith({ title: 'ship it', board: 'personal', column: 'todo' });
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('added: ship it [todo#0] (11111111)');
  });

  it('passes the explicit --column to `card add`', async () => {
    await run('card', 'add', '--column', 'doing', 'ship', 'it');
    expect(h.api.addCard).toHaveBeenCalledExactlyOnceWith({ title: 'ship it', board: 'personal', column: 'doing' });
  });

  it('passes an explicit --board to `card add`', async () => {
    await run('card', 'add', '--board', 'team', 'ship', 'it');
    expect(h.api.addCard).toHaveBeenCalledExactlyOnceWith({ title: 'ship it', board: 'team', column: 'todo' });
  });

  it('adds a team card into the todo column and reports where it landed', async () => {
    h.api.addCard.mockResolvedValue(
      ok({ card: { id: TEAM_CARD_ID, title: 'ship it', column: 'todo', position: 0 } }),
    );

    await run('card', 'add', '--board', 'team', 'ship', 'it');

    expect(h.api.addCard).toHaveBeenCalledExactlyOnceWith({ title: 'ship it', board: 'team', column: 'todo' });
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('added: ship it [todo#0] (22222222)');
    expect(process.exitCode).toBe(0);
  });

  it('surfaces a rejected team move as a validation envelope (exit 2) naming the broken rule', async () => {
    h.api.moveCard.mockResolvedValue(
      err(appError('validation', 'Move blocked by rule "done-only-from-review"', {
        rule: 'done-only-from-review',
      })),
    );

    await run('--json', 'card', 'move', TEAM_CARD_ID, '--board', 'team', '--to', 'done');

    expect(h.api.moveCard).toHaveBeenCalledExactlyOnceWith({
      cardId: TEAM_CARD_ID,
      board: 'team',
      toColumn: 'done',
      toIndex: Number.MAX_SAFE_INTEGER,
    });
    expect(soleJson()).toMatchObject({
      ok: false,
      error: { code: 'validation', details: { rule: 'done-only-from-review' } },
    });
    expect(process.exitCode).toBe(2);
  });

  it('walks the legal team chain todo -> in-dev -> review -> done, each move exiting 0', async () => {
    for (const column of ['in-dev', 'review', 'done'] as const) {
      h.api.moveCard.mockResolvedValue(
        ok({ card: { id: TEAM_CARD_ID, title: 'ship it', column, position: 0 } }),
      );

      await run('card', 'move', TEAM_CARD_ID, '--board', 'team', '--to', column);

      expect(h.api.moveCard).toHaveBeenLastCalledWith({
        cardId: TEAM_CARD_ID,
        board: 'team',
        toColumn: column,
        toIndex: Number.MAX_SAFE_INTEGER,
      });
      expect(process.exitCode).toBe(0);
    }
  });

  it('rejects an unknown --board locally (validation, exit 2) without calling the API', async () => {
    await run('--json', 'card', 'add', '--board', 'nope', 'ship', 'it');
    expect(h.api.addCard).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });

  it('moves a card to the end of a column when --index is omitted', async () => {
    await run('card', 'move', CARD_ID, '--to', 'doing');

    expect(h.api.moveCard).toHaveBeenCalledExactlyOnceWith({
      cardId: CARD_ID,
      board: 'personal',
      toColumn: 'doing',
      toIndex: Number.MAX_SAFE_INTEGER,
    });
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('moved: ship it -> [doing#1] (11111111)');
  });

  it('passes an explicit --index to `card move`', async () => {
    await run('card', 'move', CARD_ID, '--to', 'doing', '--index', '0');
    expect(h.api.moveCard).toHaveBeenCalledExactlyOnceWith({
      cardId: CARD_ID,
      board: 'personal',
      toColumn: 'doing',
      toIndex: 0,
    });
  });

  it('passes an explicit --board to `card move`', async () => {
    h.api.moveCard.mockResolvedValue(
      ok({ card: { id: CARD_ID, title: 'ship it', column: 'in-dev', position: 0 } }),
    );
    await run('card', 'move', CARD_ID, '--board', 'team', '--to', 'in-dev');
    expect(h.api.moveCard).toHaveBeenCalledExactlyOnceWith({
      cardId: CARD_ID,
      board: 'team',
      toColumn: 'in-dev',
      toIndex: Number.MAX_SAFE_INTEGER,
    });
  });

  it('rejects a non-integer --index locally (validation, exit 2) without calling the API', async () => {
    await run('--json', 'card', 'move', CARD_ID, '--to', 'doing', '--index', 'abc');

    expect(h.api.moveCard).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });

  it('maps an unauthorized `card list` to exit code 3', async () => {
    h.api.listCards.mockResolvedValue(err(appError('unauthorized', 'login first')));

    await run('--json', 'card', 'list');

    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
    expect(process.exitCode).toBe(3);
  });
});

describe('paginated roster commands', () => {
  it('passes cursor and limit through `member list` and prints the continuation token', async () => {
    h.api.listMembers.mockResolvedValue(
      ok({
        members: [
          { id: 'member-1', email: 'alice@example.com', displayName: 'Alice', tags: ['vip'] },
        ],
        nextCursor: 'next-members',
      }),
    );

    await run('member', 'list', '--cursor', 'opaque-members', '--limit', '12');

    expect(h.api.listMembers).toHaveBeenCalledExactlyOnceWith({
      cursor: 'opaque-members',
      limit: 12,
    });
    expect(logSpy).toHaveBeenCalledExactlyOnceWith(
      '- alice@example.com\tAlice  (member-1)  [vip]\nnext cursor: next-members',
    );
  });

  it('passes cursor and a server-capped limit through `staff list`', async () => {
    await run('staff', 'list', '--cursor', 'opaque-staff', '--limit', '999');

    expect(h.api.listStaff).toHaveBeenCalledExactlyOnceWith({
      cursor: 'opaque-staff',
      limit: 100,
    });
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('no staff');
  });
});

describe('--json envelope', () => {
  it('prints exactly one success envelope on stdout', async () => {
    await run('--json', 'health');

    expect(soleJson()).toEqual({
      ok: true,
      data: { status: 'ok', database: 'up', version: '1.2.3', sha: 'cafe1234' },
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it('prints exactly one error envelope on stdout for a failing call', async () => {
    h.api.me.mockResolvedValue(err(appError('unauthorized', 'Login required')));

    await run('--json', 'whoami');

    expect(soleJson()).toEqual({
      ok: false,
      error: { code: 'unauthorized', message: 'Login required' },
    });
  });
});

describe('exit-code mapping', () => {
  it('maps an unauthorized client error to exit code 3', async () => {
    h.api.me.mockResolvedValue(err(appError('unauthorized', 'nope')));

    await run('--json', 'whoami');

    expect(process.exitCode).toBe(3);
  });

  it('maps a not_found client error to exit code 5', async () => {
    h.api.listTodos.mockResolvedValue(err(appError('not_found', 'gone')));

    await run('todo', 'list');

    expect(process.exitCode).toBe(5);
    expect(errorSpy).toHaveBeenCalledExactlyOnceWith('error(not_found): gone');
  });

  it('maps a validation client error to exit code 2', async () => {
    h.api.addTodo.mockResolvedValue(err(appError('validation', 'title required')));

    await run('todo', 'add', 'x');

    expect(process.exitCode).toBe(2);
  });
});

describe('auth commands persist the session token', () => {
  it('saves the token returned by login', async () => {
    h.auth.signIn.mockResolvedValue(ok({ token: 'sess-tok' }));

    await run('login', '--email', 'demo@x', '--password', 'pw');

    expect(h.auth.signIn).toHaveBeenCalledExactlyOnceWith({ email: 'demo@x', password: 'pw' });
    expect(h.saved).toEqual([
      singleProfile('http://localhost:47100', 'sess-tok', null),
    ]);
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('signed in as demo@x');
    expect(process.exitCode).toBe(0);
  });

  it('reports an internal error and saves nothing when login returns no token', async () => {
    h.auth.signIn.mockResolvedValue(ok({ token: null }));

    await run('--json', 'login', '--email', 'demo@x', '--password', 'pw');

    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(h.saved).toHaveLength(0);
    expect(process.exitCode).toBe(10);
  });

  it('saves the token returned by register', async () => {
    h.auth.signUp.mockResolvedValue(ok({ token: 'reg-tok' }));

    await run('register', '--name', 'Ada', '--email', 'ada@x', '--password', 'pw');

    expect(h.auth.signUp).toHaveBeenCalledExactlyOnceWith({ name: 'Ada', email: 'ada@x', password: 'pw' });
    expect(h.saved).toEqual([
      singleProfile('http://localhost:47100', 'reg-tok', null),
    ]);
  });

  it('writes a login token only under the explicitly active origin', async () => {
    h.config = {
      version: 2,
      currentOrigin: 'https://stored.example',
      profiles: {
        'https://stored.example': { token: 'stored-token', tenant: 'stored' },
        'https://active.example': { token: 'old-active-token', tenant: 'active' },
      },
    };

    await run(
      '--api-url',
      'https://active.example/path',
      'login',
      '--email',
      'demo@x',
      '--password',
      'pw',
    );

    expect(h.saved).toEqual([
      {
        version: 2,
        currentOrigin: 'https://active.example',
        profiles: {
          'https://stored.example': { token: 'stored-token', tenant: 'stored' },
          'https://active.example': { token: 'sess-tok', tenant: 'active' },
        },
      },
    ]);
  });

  it('writes a repo-default login token under the dev origin without moving currentOrigin', async () => {
    h.repoDetected = true;
    h.config = {
      version: 2,
      currentOrigin: 'https://stored.example',
      profiles: {
        'https://stored.example': { token: 'stored-token', tenant: 'stored' },
      },
    };

    await run('login', '--email', 'demo@x', '--password', 'pw');

    expect(h.saved).toEqual([
      {
        version: 2,
        currentOrigin: 'https://stored.example',
        profiles: {
          'https://stored.example': { token: 'stored-token', tenant: 'stored' },
          'http://localhost:47100': { token: 'sess-tok', tenant: null },
        },
      },
    ]);
  });

  it('revokes the session server-side then clears the stored token on logout', async () => {
    h.config = singleProfile('http://localhost:47100', 'existing', 'acme');

    await run('logout');

    expect(h.auth.signOut).toHaveBeenCalledTimes(1);
    expect(h.saved).toEqual([
      singleProfile('http://localhost:47100', null, 'acme'),
    ]);
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('signed out');
  });

  it('surfaces a failed server sign-out (and still clears the local token)', async () => {
    h.config = singleProfile('http://localhost:47100', 'existing', 'acme');
    h.auth.signOut.mockResolvedValue(err(appError('internal', 'sign-out failed')));

    await run('--json', 'logout');

    expect(h.auth.signOut).toHaveBeenCalledTimes(1);
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(h.saved).toEqual([
      singleProfile('http://localhost:47100', null, 'acme'),
    ]);
    expect(process.exitCode).toBe(10);
  });
});

describe('CLI boundary validation', () => {
  it('rejects an empty --email at the CLI boundary (validation, exit 2) without calling auth', async () => {
    await run('--json', 'login', '--email', '', '--password', 'pw');

    expect(h.auth.signIn).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });
});

describe('Commander parse-failure protocol', () => {
  it('emits one validation envelope (exit 2) for `--json login` with missing options', async () => {
    await run('--json', 'login');

    expect(h.auth.signIn).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });

  it('emits one validation envelope (exit 2) for an unknown subcommand in --json mode', async () => {
    await run('--json', 'bogus-command');

    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });

  it('emits a single clean human error line (exit 2) for a missing option without --json', async () => {
    await run('login', '--email', 'demo@x');

    expect(h.auth.signIn).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('error(validation)');
    expect(process.exitCode).toBe(2);
  });
});

describe('global option validation', () => {
  it('rejects a non-URL --api-url with a validation envelope (exit 2) before any client call', async () => {
    await run('--json', '--api-url', 'not a url', 'health');

    expect(h.api.health).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });

  it('rejects a non-slug --tenant with a validation envelope (exit 2) before any client call', async () => {
    await run('--json', '--tenant', 'Not A Slug', 'health');

    expect(h.api.health).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });
});

describe('tenant switch', () => {
  it('stores the slug when it matches an administered tenant', async () => {
    h.api.listTenants.mockResolvedValue(
      ok({ tenants: [{ tenant: { slug: 'acme', name: 'Acme' }, staffRole: 'owner' }] }),
    );

    await run('tenant', 'switch', 'acme');

    expect(h.saved).toEqual([
      singleProfile('http://localhost:47100', null, 'acme'),
    ]);
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('active tenant: Acme (acme)');
  });

  it('emits a not_found error (exit 5) and saves nothing for an unknown slug', async () => {
    h.api.listTenants.mockResolvedValue(ok({ tenants: [] }));

    await run('--json', 'tenant', 'switch', 'ghost');

    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.saved).toHaveLength(0);
    expect(process.exitCode).toBe(5);
  });

  it('propagates a failed tenant listing without saving', async () => {
    h.api.listTenants.mockResolvedValue(err(appError('unauthorized', 'login first')));

    await run('--json', 'tenant', 'switch', 'acme');

    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
    expect(h.saved).toHaveLength(0);
    expect(process.exitCode).toBe(3);
  });
});

describe('global options feed the client and auth adapter', () => {
  it('honours --api-url and --tenant overrides and builds request headers', async () => {
    h.config = {
      version: 2,
      currentOrigin: 'http://localhost:47100',
      profiles: {
        'http://localhost:47100': { token: 'local-token', tenant: null },
        'https://override.test': { token: 'override-token', tenant: 'stored-override' },
      },
    };

    await run('--api-url', 'https://override.test', '--tenant', 'acme', 'health');

    expect(h.apiOptions?.baseUrl).toBe('https://override.test');
    expect(h.authBaseUrl).toBe('https://override.test');
    expect(h.apiOptions?.headers?.()).toEqual({
      authorization: 'Bearer override-token',
      'x-tenant': 'acme',
    });
  });

  it('falls back to the stored config and omits auth/tenant headers when unset', async () => {
    h.config = singleProfile('http://cfg-url', null, null);

    await run('health');

    expect(h.apiOptions?.baseUrl).toBe('http://cfg-url');
    expect(h.apiOptions?.headers?.()).toEqual({});
  });

  it('honours env overrides below flags and reads that origin profile', async () => {
    h.config = {
      version: 2,
      currentOrigin: 'https://stored.example',
      profiles: {
        'https://stored.example': { token: 'stored-token', tenant: 'stored' },
        'https://env.example': { token: 'env-token', tenant: 'env-stored' },
      },
    };
    process.env['APP_CLI_API_URL'] = 'https://env.example/api';
    process.env['APP_CLI_TENANT'] = 'env-tenant';

    await run('health');

    expect(h.apiOptions?.baseUrl).toBe('https://env.example/api');
    expect(h.apiOptions?.headers?.()).toEqual({
      authorization: 'Bearer env-token',
      'x-tenant': 'env-tenant',
    });
  });

  it('wires the adapter onToken callback to persist a freshly issued token', async () => {
    h.config = singleProfile('http://cfg-url', null, null);

    await run('health');
    h.onToken?.('adapter-token');

    expect(h.saved).toEqual([
      singleProfile('http://cfg-url', 'adapter-token', null),
    ]);
  });
});

describe('origin commands', () => {
  it('lists origins without exposing token values', async () => {
    h.config = {
      version: 2,
      currentOrigin: 'https://two.example',
      profiles: {
        'https://two.example': { token: 'secret-two', tenant: 'two' },
        'https://one.example': { token: null, tenant: null },
      },
    };

    await run('--json', 'origin', 'list');

    expect(soleJson()).toEqual({
      ok: true,
      data: {
        origins: [
          {
            origin: 'https://one.example',
            current: false,
            hasToken: false,
            tenant: null,
          },
          {
            origin: 'https://two.example',
            current: true,
            hasToken: true,
            tenant: 'two',
          },
        ],
      },
    });
    expect(logSpy.mock.calls.flat().join(' ')).not.toContain('secret-two');
  });

  it('selects a canonical origin without making an API call', async () => {
    h.config = singleProfile('https://one.example', 'one-token', 'one');

    await run('origin', 'use', 'HTTPS://TWO.example:443/path');

    expect(h.saved).toEqual([
      {
        version: 2,
        currentOrigin: 'https://two.example',
        profiles: {
          'https://one.example': { token: 'one-token', tenant: 'one' },
          'https://two.example': { token: null, tenant: null },
        },
      },
    ]);
    expect(h.api.health).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledExactlyOnceWith(
      'active origin: https://two.example',
    );
  });
});

describe('fatal config protocol', () => {
  it('emits exactly one internal envelope for a corrupted config under --json', async () => {
    h.loadError = new Error(
      'podpisy: invalid ~/.config/agentproofarch/config.json: malformed JSON',
    );

    await run('--json', 'health');

    expect(h.api.health).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({
      ok: false,
      error: {
        code: 'internal',
        message: 'podpisy: invalid ~/.config/agentproofarch/config.json: malformed JSON',
      },
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(10);
  });

  it('prints one human error line for a corrupted config', async () => {
    h.loadError = new Error(
      'podpisy: invalid ~/.config/agentproofarch/config.json: malformed JSON',
    );

    await run('health');

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
      'error(internal): podpisy: invalid ~/.config/agentproofarch/config.json: malformed JSON',
    );
    expect(process.exitCode).toBe(10);
  });
});

describe('public surface (no session)', () => {
  it('discovers the version then fetches the profile keyed on it', async () => {
    await run('--json', 'public', 'profile', 'acme');

    expect(h.api.publicTenantDiscovery).toHaveBeenCalledWith('acme');
    expect(h.api.publicTenantProfile).toHaveBeenCalledWith('acme', 'v1abc');
    expect(soleJson()).toMatchObject({
      ok: true,
      data: { slug: 'acme', displayName: 'Acme Corp' },
    });
    expect(process.exitCode).toBe(0);
  });

  it('rejects a non-slug tenant before any call (validation, exit 2)', async () => {
    await run('--json', 'public', 'profile', 'Not A Slug');

    expect(h.api.publicTenantDiscovery).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(2);
  });

  it('surfaces a discovery error without fetching the profile', async () => {
    h.api.publicTenantDiscovery.mockResolvedValue(err(appError('not_found', 'no profile')));

    await run('--json', 'public', 'profile', 'ghost');

    expect(h.api.publicTenantProfile).not.toHaveBeenCalled();
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(process.exitCode).toBe(5);
  });
});
