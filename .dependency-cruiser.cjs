/** Second, independent enforcement of PRD §3.2 — including vendor lock bans. */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'core-domain-depends-on-nothing',
      severity: 'error',
      from: { path: '^core/domain' },
      to: { path: '^(core/(contract|server|client)|adapters|apps)' },
    },
    {
      name: 'core-server-pure',
      severity: 'error',
      from: { path: '^core/server' },
      to: { path: '^(core/(contract|client)|adapters|apps)' },
    },
    {
      name: 'core-contract-only-domain',
      severity: 'error',
      from: { path: '^core/contract' },
      to: { path: '^(core/(server|client)|adapters|apps)' },
    },
    {
      name: 'core-client-never-server-side',
      severity: 'error',
      from: { path: '^core/client' },
      to: { path: '^(core/server|adapters|apps)' },
    },
    {
      name: 'adapters-never-import-apps',
      severity: 'error',
      from: { path: '^adapters' },
      to: { path: '^apps' },
    },
    {
      name: 'web-never-server-side',
      severity: 'error',
      from: { path: '^apps/web' },
      to: { path: '^(core/server|adapters/db|adapters/domain-provisioning|apps/(server|cli))' },
    },
    {
      name: 'cli-is-a-pure-api-client',
      severity: 'error',
      from: { path: '^apps/cli' },
      to: { path: '^(core/server|adapters/(db|domain-provisioning)|apps/(server|web))' },
    },
    {
      name: 'vercel-and-neon-only-in-adapters',
      severity: 'error',
      comment: 'Zero platform lock-in in core and apps (PRD: Goals)',
      from: { pathNot: '^(adapters|apps/server/src/entry\\.vercel\\.ts|api/index\\.ts)' },
      to: { path: 'node_modules/(@vercel|@neondatabase)' },
    },
    {
      name: 'no-frameworks-in-core',
      severity: 'error',
      from: { path: '^core' },
      to: { path: 'node_modules/(hono|react|react-dom|drizzle-orm|better-auth|pg|commander)(/|$)' },
    },
    {
      name: 'web-ui-is-presentational',
      severity: 'error',
      comment: 'components/ui: no core, adapters, features, routes or TanStack (frontend-lint-plan Phase 2)',
      from: { path: '^apps/web/src/components/ui' },
      to: {
        path: '^(core|adapters|apps/web/src/(features|routes))|node_modules/@tanstack/react-(query|router)(/|$)',
      },
    },
    {
      name: 'web-lib-no-react',
      severity: 'error',
      comment: 'lib is pure TypeScript: no react (frontend-lint-plan Phase 2)',
      from: { path: '^apps/web/src/lib' },
      to: { path: 'node_modules/(react|react-dom)(/|$)' },
    },
    {
      name: 'web-lib-has-no-app-internal-deps',
      severity: 'error',
      comment: 'lib is a pure utility leaf: no app-internal imports (frontend-lint-plan Phase 2)',
      from: { path: '^apps/web/src/lib' },
      to: { path: '^(core|adapters|apps)', pathNot: '^apps/web/src/lib' },
    },
    {
      name: 'web-routes-stay-thin',
      severity: 'error',
      comment: 'routes render features only: no core, adapters or api wiring (frontend-lint-plan Phase 2)',
      from: { path: '^apps/web/src/routes' },
      to: { path: '^(core|adapters)|^apps/web/src/api\\.' },
    },
    {
      name: 'web-features-consume-bound-actions',
      severity: 'error',
      comment:
        'features consume bound actions from api.ts, never adapters directly (frontend-lint-plan Phase 2)',
      from: { path: '^apps/web/src/features' },
      to: { path: '^adapters' },
    },
    {
      name: 'web-features-are-islands',
      severity: 'error',
      comment:
        'a feature imports only itself, never a sibling feature (frontend-lint-plan Phase 2)',
      from: { path: '^apps/web/src/features/([^/]+)/' },
      to: {
        path: '^apps/web/src/features/([^/]+)/',
        pathNot: '^apps/web/src/features/$1/',
      },
    },
    {
      name: 'web-api-is-the-only-client-construction-site',
      severity: 'error',
      comment:
        'api.ts is the only web module besides main.tsx that binds adapters (frontend-lint-plan Phase 2)',
      from: {
        path: '^apps/web/src',
        pathNot: '^apps/web/src/(api\\.ts|main\\.tsx)',
      },
      to: { path: '^adapters/auth' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
