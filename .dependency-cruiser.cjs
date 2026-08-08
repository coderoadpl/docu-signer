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
    // `adapters/domain-provisioning` below is reserved for US-009 (DomainPort);
    // the directory does not exist yet — the ban is pre-wired so it holds from
    // the day the adapter lands.
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
      comment:
        'Zero platform lock-in in core and apps (PRD: Goals). api/index.ts is the sanctioned exemption: it is the Vercel platform entry (PRD §0 Errata).',
      from: { pathNot: '^(adapters|api/index\\.ts)' },
      to: { path: 'node_modules/(@vercel|@neondatabase)' },
    },
    {
      name: 'no-frameworks-in-core',
      severity: 'error',
      from: { path: '^core' },
      to: { path: 'node_modules/(hono|react|react-dom|drizzle-orm|better-auth|pg|commander)(/|$)' },
    },
    {
      name: 'auth-provider-sdk-only-in-adapters-auth',
      severity: 'error',
      comment:
        'US-028a grep-proof: the auth provider SDK — better-auth, its plugins (magic-link, two-factor), the client plugins, and any @better-auth/* package — is imported ONLY in adapters/auth, so no provider name leaks into core, apps or other adapters.',
      from: { pathNot: '^adapters/auth' },
      to: { path: 'node_modules/(better-auth|@better-auth)(/|$)' },
    },
    {
      name: 'smtp-sdk-only-in-adapters-email',
      severity: 'error',
      comment:
        'Every email-vendor SDK (the nodemailer SMTP client and the Amazon SES v2 SDK) lives only behind the EmailPort in adapters/email — no vendor name leaks into core, apps or other adapters.',
      from: { pathNot: '^adapters/email' },
      to: { path: 'node_modules/(nodemailer|@aws-sdk)(/|$)' },
    },
    {
      name: 'core-domain-only-zod',
      severity: 'error',
      comment:
        'core/domain depends on zod ONLY — an allow-list, not a deny-list: no other external package may enter (PRD §3.1). Test files are exempt (vitest).',
      from: { path: '^core/domain', pathNot: '\\.(test|spec)\\.[jt]sx?$' },
      to: { path: 'node_modules', pathNot: 'node_modules/zod(/|$)' },
    },
    {
      name: 'island-core-is-framework-agnostic',
      severity: 'error',
      comment:
        'island cores (features/*/core) stay pure TS: no react/react-dom/@tanstack/react-query or their store React bindings — a depcruise mirror of the ESLint island-core ban, wired now that real cores exist (ADR-0005, frontend-lint-plan Phase 5).',
      from: { path: '^apps/web/src/features/[^/]+/core/' },
      to: {
        path: 'node_modules/(react|react-dom|@tanstack/react-query|@xstate/store/react|@xstate/react)(/|$)',
      },
    },
    {
      name: 'island-core-is-portable',
      severity: 'error',
      comment:
        'island cores (features/*/core) import no web composition: not api.ts, not a sibling feature, not any apps/web path outside their own core — the gateway + bound descriptors are injected in features/<name>/index.web.ts. A depcruise mirror of the ESLint parent-import ban, so the core typechecks without DOM and runs in plain node (ADR-0005 §Pure-TS cores).',
      from: { path: '^apps/web/src/features/([^/]+)/core/' },
      to: { path: '^apps/web/src/', pathNot: '^apps/web/src/features/$1/core/' },
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
