import { beforeEach, describe, expect, it, vi } from 'vitest';

interface StaticContext {
  header: (name: string, value: string) => void;
}

interface StaticOptions {
  root?: string;
  path?: string;
  onFound?: (path: string, context: StaticContext) => void;
}

interface EntryEnv {
  PORT: number;
  INTERNAL_PORT: number | undefined;
  WEB_DIST_DIR: string;
}

const h = vi.hoisted(() => {
  const env: EntryEnv = {
    PORT: 47100,
    INTERNAL_PORT: undefined,
    WEB_DIST_DIR: '/web-dist',
  };
  const app = { fetch: vi.fn(), get: vi.fn(), use: vi.fn() };
  const internalApp = { fetch: vi.fn() };
  return {
    env,
    app,
    internalApp,
    buildApp: vi.fn(() => app),
    buildInternalApp: vi.fn(() => internalApp),
    createDeps: vi.fn(() => ({ marker: 'deps' })),
    loadEnv: vi.fn(() => env),
    serve: vi.fn(),
    serveStatic: vi.fn<(options: StaticOptions) => StaticOptions>((options) => options),
    startServerObservability: vi.fn(),
    warnIfDistStale: vi.fn(),
  };
});

vi.mock('@hono/node-server', () => ({ serve: h.serve }));
vi.mock('@hono/node-server/serve-static', () => ({ serveStatic: h.serveStatic }));
vi.mock('./app.js', () => ({ buildApp: h.buildApp }));
vi.mock('./composition.js', () => ({ createDeps: h.createDeps }));
vi.mock('./dist-freshness.js', () => ({ warnIfDistStale: h.warnIfDistStale }));
vi.mock('./env.js', () => ({ loadEnv: h.loadEnv }));
vi.mock('./internal-app.js', () => ({ buildInternalApp: h.buildInternalApp }));
vi.mock('./observability.js', () => ({
  startServerObservability: h.startServerObservability,
}));

const importEntry = () => import('./entry.node.js');

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  h.env.PORT = 47100;
  h.env.INTERNAL_PORT = undefined;
  h.env.WEB_DIST_DIR = '/web-dist';
});

describe('entry.node composition', () => {
  it('registers immutable asset caching and revalidating SPA fallback', async () => {
    await importEntry();

    expect(h.serveStatic).toHaveBeenCalledTimes(2);
    expect(h.app.use).toHaveBeenCalledWith('*', h.serveStatic.mock.results[0]?.value);
    expect(h.app.get).toHaveBeenCalledWith('*', h.serveStatic.mock.results[1]?.value);

    const assetHeaders = vi.fn();
    h.serveStatic.mock.calls[0]?.[0].onFound?.('/assets/app-123.js', {
      header: assetHeaders,
    });
    expect(assetHeaders).toHaveBeenCalledWith(
      'cache-control',
      'public, max-age=31536000, immutable',
    );

    const indexHeaders = vi.fn();
    h.serveStatic.mock.calls[1]?.[0].onFound?.('/web-dist/index.html', {
      header: indexHeaders,
    });
    expect(indexHeaders).toHaveBeenCalledWith(
      'cache-control',
      'public, max-age=0, must-revalidate',
    );
    expect(h.serveStatic.mock.calls[1]?.[0].path).toBe('/web-dist/index.html');
  });

  it('starts only the public listener when INTERNAL_PORT is absent', async () => {
    await importEntry();

    expect(h.serve).toHaveBeenCalledTimes(1);
    expect(h.serve).toHaveBeenCalledWith(
      { fetch: h.app.fetch, port: 47100, hostname: '0.0.0.0' },
      expect.any(Function),
    );
    expect(h.buildInternalApp).not.toHaveBeenCalled();
  });

  it('starts the internal listener when INTERNAL_PORT is configured', async () => {
    h.env.INTERNAL_PORT = 47101;

    await importEntry();

    expect(h.serve).toHaveBeenCalledTimes(2);
    expect(h.buildInternalApp).toHaveBeenCalledWith({ marker: 'deps' });
    expect(h.serve).toHaveBeenNthCalledWith(
      2,
      { fetch: h.internalApp.fetch, port: 47101, hostname: '0.0.0.0' },
      expect.any(Function),
    );
  });

  it('propagates public-listener startup failures', async () => {
    h.serve.mockImplementationOnce(() => {
      throw new Error('port unavailable');
    });

    await expect(importEntry()).rejects.toThrow('port unavailable');
    expect(h.buildInternalApp).not.toHaveBeenCalled();
  });
});
