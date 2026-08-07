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

import type { CliConfig } from './config.js';

type Async<T> = () => Promise<Result<T, AppError>>;
type AsyncIn<I, T> = (input: I) => Promise<Result<T, AppError>>;

type Health = { status: 'ok'; database: string; version: string };
type Me = { email: string; tenant: { name: string; slug: string; staffRole: string | null } | null };
type Membership = { tenant: { slug: string; name: string }; staffRole: string };
type TenantList = { tenants: Membership[] };
type TenantCreate = { tenant: { name: string; slug: string } };
type TodoList = { todos: { id: string; title: string }[] };
type TodoCreate = { todo: { id: string; title: string } };
type Session = { token: string | null };

interface FakeApi {
  health: Mock<Async<Health>>;
  me: Mock<Async<Me>>;
  listTenants: Mock<Async<TenantList>>;
  createTenant: Mock<AsyncIn<{ slug: string; name: string }, TenantCreate>>;
  listTodos: Mock<Async<TodoList>>;
  addTodo: Mock<AsyncIn<{ title: string }, TodoCreate>>;
}

interface FakeAuth {
  signUp: Mock<AsyncIn<{ name: string; email: string; password: string }, Session>>;
  signIn: Mock<AsyncIn<{ email: string; password: string }, Session>>;
}

interface Hoisted {
  config: CliConfig;
  saved: CliConfig[];
  apiOptions: ApiClientOptions | null;
  authBaseUrl: string | null;
  onToken: ((token: string) => void) | null;
  api: FakeApi;
  auth: FakeAuth;
}

const h = vi.hoisted(
  (): Hoisted => ({
    config: { apiUrl: 'http://localhost:47100', token: null, tenant: null },
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
    },
    auth: {
      signUp: vi.fn<AsyncIn<{ name: string; email: string; password: string }, Session>>(),
      signIn: vi.fn<AsyncIn<{ email: string; password: string }, Session>>(),
    },
  }),
);

vi.mock('./config.js', () => ({
  loadConfig: (): CliConfig => h.config,
  saveConfig: (config: CliConfig): void => {
    h.saved.push(config);
  },
}));

vi.mock('#core/client/index.js', () => ({
  createApiClient: (options: ApiClientOptions): FakeApi => {
    h.apiOptions = options;
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

let logSpy: MockInstance<typeof console.log>;
let errorSpy: MockInstance<typeof console.error>;

const run = async (...args: string[]): Promise<void> => {
  process.argv = ['node', 'agentproofarch', ...args];
  vi.resetModules();
  await import('./main.js');
};

const soleJson = (): unknown => {
  expect(logSpy).toHaveBeenCalledTimes(1);
  const [line] = logSpy.mock.calls[0] ?? [];
  return JSON.parse(String(line));
};

beforeEach(() => {
  h.config = { apiUrl: 'http://localhost:47100', token: null, tenant: null };
  h.saved = [];
  h.apiOptions = null;
  h.authBaseUrl = null;
  h.onToken = null;

  for (const fn of [h.api.health, h.api.me, h.api.listTenants, h.api.createTenant, h.api.listTodos, h.api.addTodo]) {
    fn.mockReset();
  }
  h.auth.signUp.mockReset();
  h.auth.signIn.mockReset();

  h.api.health.mockResolvedValue(ok({ status: 'ok', database: 'up', version: '1.2.3' }));
  h.api.me.mockResolvedValue(ok({ email: 'demo@x', tenant: null }));
  h.api.listTenants.mockResolvedValue(ok({ tenants: [] }));
  h.api.createTenant.mockResolvedValue(ok({ tenant: { name: 'Acme Corp', slug: 'acme-corp' } }));
  h.api.listTodos.mockResolvedValue(ok({ todos: [] }));
  h.api.addTodo.mockResolvedValue(ok({ todo: { id: 'todo-1234abcd', title: 'buy milk' } }));
  h.auth.signIn.mockResolvedValue(ok({ token: 'sess-tok' }));
  h.auth.signUp.mockResolvedValue(ok({ token: 'reg-tok' }));

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
});

describe('command wiring', () => {
  it('routes `health` to api.health and prints the human summary', async () => {
    await run('health');

    expect(h.api.health).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('status=ok db=up v1.2.3');
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

describe('--json envelope', () => {
  it('prints exactly one success envelope on stdout', async () => {
    await run('--json', 'health');

    expect(soleJson()).toEqual({
      ok: true,
      data: { status: 'ok', database: 'up', version: '1.2.3' },
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
    expect(h.saved).toEqual([{ apiUrl: 'http://localhost:47100', token: 'sess-tok', tenant: null }]);
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
    expect(h.saved).toEqual([{ apiUrl: 'http://localhost:47100', token: 'reg-tok', tenant: null }]);
  });

  it('clears the stored token on logout', async () => {
    h.config = { apiUrl: 'http://localhost:47100', token: 'existing', tenant: 'acme' };

    await run('logout');

    expect(h.saved).toEqual([{ apiUrl: 'http://localhost:47100', token: null, tenant: 'acme' }]);
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('signed out');
  });
});

describe('tenant switch', () => {
  it('stores the slug when it matches an administered tenant', async () => {
    h.api.listTenants.mockResolvedValue(
      ok({ tenants: [{ tenant: { slug: 'acme', name: 'Acme' }, staffRole: 'owner' }] }),
    );

    await run('tenant', 'switch', 'acme');

    expect(h.saved).toEqual([{ apiUrl: 'http://localhost:47100', token: null, tenant: 'acme' }]);
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
    h.config = { apiUrl: 'http://localhost:47100', token: 'cfg-token', tenant: null };

    await run('--api-url', 'https://override.test', '--tenant', 'acme', 'health');

    expect(h.apiOptions?.baseUrl).toBe('https://override.test');
    expect(h.authBaseUrl).toBe('https://override.test');
    expect(h.apiOptions?.headers?.()).toEqual({
      authorization: 'Bearer cfg-token',
      'x-tenant': 'acme',
    });
  });

  it('falls back to the stored config and omits auth/tenant headers when unset', async () => {
    h.config = { apiUrl: 'http://cfg-url', token: null, tenant: null };

    await run('health');

    expect(h.apiOptions?.baseUrl).toBe('http://cfg-url');
    expect(h.apiOptions?.headers?.()).toEqual({});
  });

  it('wires the adapter onToken callback to persist a freshly issued token', async () => {
    h.config = { apiUrl: 'http://cfg-url', token: null, tenant: null };

    await run('health');
    h.onToken?.('adapter-token');

    expect(h.saved).toEqual([{ apiUrl: 'http://cfg-url', token: 'adapter-token', tenant: null }]);
  });
});
