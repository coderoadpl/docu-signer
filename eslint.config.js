import js from '@eslint/js';
import tanstackQuery from '@tanstack/eslint-plugin-query';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactCompiler from 'eslint-plugin-react-compiler';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import agentproofarch from './eslint-plugin-agentproofarch/index.js';

const sxLayoutBaseline = JSON.parse(
  readFileSync(
    join(import.meta.dirname, 'eslint-plugin-agentproofarch/sx-layout-baseline.json'),
    'utf8',
  ),
);

const AS_BAN = {
  selector: 'TSAsExpression:not([typeAnnotation.typeName.name="const"])',
  message: 'Type assertions (`as`) are forbidden; parse or narrow instead. `as const` is allowed.',
};

const AUTH_API_LITERAL_BAN = {
  selector: 'Literal[value=/api\\/auth/], TemplateElement[value.raw=/api\\/auth/]',
  message: 'Do not call or spell Better Auth HTTP routes outside adapters/auth; use the auth adapter port.',
};

const REACT_API_BANS = [
  {
    selector: 'TSQualifiedName[left.name="React"][right.name=/^(FC|FunctionComponent)$/]',
    message: 'React.FC is banned: type props explicitly with `({ ... }: Props)` (React 19 conventions).',
  },
  {
    selector: 'CallExpression[callee.name="forwardRef"], CallExpression[callee.property.name="forwardRef"]',
    message: 'forwardRef is banned: `ref` is a normal prop in React 19.',
  },
  {
    selector: 'MemberExpression[property.name="defaultProps"]',
    message: 'Component defaultProps are banned: use default parameter values instead.',
  },
  {
    selector: 'JSXMemberExpression[property.name="Provider"]',
    message: '<Context.Provider> is banned: render <Context> directly (React 19).',
  },
];

const QUERY_HOOK_BANS = [
  {
    selector: 'CallExpression[typeArguments][callee.name=/^(useQuery|useQueries|useMutation)$/]',
    message: 'No explicit type arguments on useQuery/useQueries/useMutation: types flow from core/client descriptors.',
  },
  {
    selector: 'VariableDeclarator[id.type="ObjectPattern"][init.callee.name="useQueryClient"]',
    message: 'Do not destructure useQueryClient(): QueryClient methods depend on `this` binding.',
  },
  {
    selector: 'Property[key.name="defaultOptions"] Property[key.name="queryFn"]',
    message: 'No global defaultOptions.queries.queryFn: it bypasses the typed core/client.',
  },
];

const NEW_QUERY_CLIENT_BAN = {
  selector: 'NewExpression[callee.name="QueryClient"]',
  message: 'new QueryClient() lives only in apps/web/src/query-client.ts and the test harness.',
};

const QUERY_KEY_BAN = {
  selector: 'Property[key.name="queryKey"]',
  message: 'Inline query definitions are banned in apps/web: keys live in core/client descriptors.',
};

const VI_MOCK_BAN = {
  selector:
    'CallExpression[callee.object.name=/^(vi|jest)$/][callee.property.name="mock"][arguments.0.value=/@tanstack\\/react-query|core\\/client/]',
  message: 'Mocking @tanstack/react-query or core/client is banned: use a real QueryClient + MSW.',
};

const NO_HTTP = 'No direct HTTP in apps/web: go through core/client descriptors via TanStack Query.';
const HTTP_GLOBALS = ['fetch', 'XMLHttpRequest', 'EventSource', 'WebSocket'].map((name) => ({
  name,
  message: NO_HTTP,
}));

const STORAGE_MESSAGE =
  'localStorage/sessionStorage are banned outside the designated persistence helper (theme-mode.tsx).';
const STORAGE_GLOBALS = ['localStorage', 'sessionStorage'].map((name) => ({
  name,
  message: STORAGE_MESSAGE,
}));

const HTTP_IMPORT_BANS = ['axios', 'ky', 'got'].map((name) => ({ name, message: NO_HTTP }));

const CLIENT_CONSTRUCTION_BANS = [
  {
    name: '#core/client/index.js',
    importNames: ['createApiClient'],
    message:
      'createApiClient is bound once in apps/web/src/api.ts: import bound actions from api.ts, never construct a client.',
  },
  {
    name: '#adapters/auth/client-adapter.js',
    message:
      'The auth client adapter is instantiated only in apps/web/src/api.ts: import bound actions from api.ts.',
  },
];

const DEVTOOLS_BAN = [
  {
    name: '@tanstack/react-query-devtools',
    message: 'Query Devtools are wired only in main.tsx (dev-only composition root).',
  },
];

const STATE_LIB_MESSAGE =
  'Global state libraries are banned: server state lives in TanStack Query, UI state stays local (React 19 / compiler).';
const STATE_LIB_BANS = [
  'redux',
  '@reduxjs/toolkit',
  'zustand',
  'jotai',
  'mobx',
  'valtio',
  'recoil',
].map((name) => ({ name, message: STATE_LIB_MESSAGE }));

const QUERY_CLIENT_SINGLETON_PATTERN = {
  regex: 'query-client\\.js$',
  message:
    'Do not import the QueryClient singleton: reach it via useQueryClient(). Only main.tsx wires it.',
};

/**
 * Layer boundaries (PRD §3.2). `boundaries/element-types` denies everything by
 * default; each rule below is an explicit permission. dependency-cruiser
 * double-checks the same graph plus vendor bans in `npm run depcruise`.
 */
export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', 'drizzle/**'],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        document: 'readonly',
        process: 'readonly',
      },
    },
    rules: js.configs.recommended.rules,
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        module: 'readonly',
        process: 'readonly',
        require: 'readonly',
      },
    },
    rules: js.configs.recommended.rules,
  },
  ...tseslint.configs.strict,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { boundaries },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'boundaries/elements': [
        { type: 'core-domain', pattern: 'core/domain/**', mode: 'full' },
        { type: 'core-contract', pattern: 'core/contract/**', mode: 'full' },
        { type: 'core-server', pattern: 'core/server/**', mode: 'full' },
        { type: 'core-client', pattern: 'core/client/**', mode: 'full' },
        { type: 'adapter-db', pattern: 'adapters/db/**', mode: 'full' },
        { type: 'adapter-auth', pattern: 'adapters/auth/**', mode: 'full' },
        { type: 'adapter-domains', pattern: 'adapters/domain-provisioning/**', mode: 'full' },
        { type: 'app-server', pattern: 'apps/server/**', mode: 'full' },
        { type: 'platform-entry', pattern: 'api/**', mode: 'full' },
        { type: 'web-main', pattern: 'apps/web/src/main.tsx', mode: 'full' },
        { type: 'web-api', pattern: 'apps/web/src/api.ts', mode: 'full' },
        { type: 'web-routes', pattern: 'apps/web/src/routes/**', mode: 'full' },
        {
          type: 'web-features',
          pattern: 'apps/web/src/features/(*)/**',
          mode: 'full',
          capture: ['feature'],
        },
        { type: 'web-ui', pattern: 'apps/web/src/components/ui/**', mode: 'full' },
        { type: 'web-lib', pattern: 'apps/web/src/lib/**', mode: 'full' },
        { type: 'web-test', pattern: 'apps/web/src/test/**', mode: 'full' },
        { type: 'web-theme', pattern: 'apps/web/src/theme*', mode: 'full' },
        { type: 'app-web', pattern: 'apps/web/**', mode: 'full' },
        { type: 'app-cli', pattern: 'apps/cli/**', mode: 'full' },
        { type: 'config', pattern: '*.config.ts', mode: 'full' },
      ],
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'no-restricted-syntax': ['error', AS_BAN, AUTH_API_LITERAL_BAN],
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          message: '${file.type} is not allowed to import ${dependency.type} (see PRD §3.2)',
          rules: [
            { from: ['core-domain'], allow: ['core-domain'] },
            { from: ['core-contract'], allow: ['core-domain', 'core-contract'] },
            { from: ['core-server'], allow: ['core-domain', 'core-server'] },
            { from: ['core-client'], allow: ['core-domain', 'core-contract', 'core-client'] },
            {
              from: ['adapter-db', 'adapter-auth', 'adapter-domains'],
              allow: [
                'core-domain',
                'core-server',
                'core-client',
                'adapter-db',
                'adapter-auth',
                'adapter-domains',
              ],
            },
            {
              from: ['app-server'],
              allow: [
                'core-domain',
                'core-contract',
                'core-server',
                'adapter-db',
                'adapter-auth',
                'adapter-domains',
                'app-server',
              ],
            },
            {
              from: ['platform-entry'],
              allow: ['app-server'],
            },
            {
              from: ['app-web'],
              allow: ['core-domain', 'core-contract', 'core-client', 'adapter-auth', 'app-web'],
            },
            {
              from: ['web-main'],
              allow: [
                'web-main',
                'web-api',
                'web-routes',
                'web-features',
                'web-ui',
                'web-lib',
                'web-theme',
                'app-web',
                'core-domain',
                'core-contract',
                'core-client',
                'adapter-auth',
              ],
            },
            {
              from: ['web-api'],
              allow: ['web-api', 'core-domain', 'core-contract', 'core-client', 'adapter-auth'],
            },
            {
              from: ['web-routes'],
              allow: ['web-routes', 'web-features', 'web-ui', 'web-lib'],
            },
            {
              from: ['web-features'],
              allow: [
                ['web-features', { feature: '${from.feature}' }],
                'web-api',
                'web-ui',
                'web-lib',
                'web-theme',
                'web-test',
                'core-domain',
                'core-contract',
                'core-client',
              ],
            },
            {
              from: ['web-test'],
              allow: ['web-test'],
            },
            {
              from: ['web-ui'],
              allow: ['web-ui', 'web-lib', 'web-theme'],
            },
            {
              from: ['web-lib'],
              allow: ['web-lib'],
            },
            {
              from: ['web-theme'],
              allow: ['web-theme'],
            },
            {
              from: ['app-cli'],
              allow: ['core-domain', 'core-contract', 'core-client', 'adapter-auth', 'app-cli'],
            },
          ],
        },
      ],
      'boundaries/external': [
        'error',
        {
          default: 'allow',
          rules: [
            {
              from: ['core-domain', 'core-contract', 'core-server'],
              disallow: ['react', 'react-dom', 'hono', 'drizzle-orm', 'better-auth', 'pg', 'commander'],
              message: 'Core stays pure TypeScript: no frameworks, servers or drivers (PRD §3.1)',
            },
            {
              from: ['core-client'],
              disallow: ['react', 'react-dom', 'hono', 'drizzle-orm', 'better-auth', 'pg'],
              message: 'core/client is framework-agnostic (PRD §3.1)',
            },
            {
              from: ['web-lib'],
              disallow: ['react', 'react-dom'],
              message: 'web-lib is pure TypeScript: no react (frontend-lint-plan Phase 2)',
            },
            {
              from: ['web-ui'],
              disallow: ['@tanstack/react-query', '@tanstack/react-router'],
              message:
                'components/ui is presentational: no TanStack Query/Router (frontend-lint-plan Phase 2)',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['adapters/auth/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', AS_BAN],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: {
      '@tanstack/query': tanstackQuery,
      agentproofarch,
      'jsx-a11y': jsxA11y,
      react,
      'react-compiler': reactCompiler,
      'react-hooks': reactHooks,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      '@tanstack/query/exhaustive-deps': 'error',
      '@tanstack/query/no-rest-destructuring': 'error',
      '@tanstack/query/stable-query-client': 'error',
      'agentproofarch/query-descriptors-only': 'error',
      'agentproofarch/sx-layout-only': ['error', { baseline: sxLayoutBaseline }],
      'react-compiler/react-compiler': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react/no-unstable-nested-components': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-restricted-globals': ['error', ...HTTP_GLOBALS, ...STORAGE_GLOBALS],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...HTTP_IMPORT_BANS,
            ...STATE_LIB_BANS,
            ...CLIENT_CONSTRUCTION_BANS,
            ...DEVTOOLS_BAN,
          ],
          patterns: [QUERY_CLIENT_SINGLETON_PATTERN],
        },
      ],
      'no-restricted-syntax': [
        'error',
        AS_BAN,
        AUTH_API_LITERAL_BAN,
        ...REACT_API_BANS,
        ...QUERY_HOOK_BANS,
        NEW_QUERY_CLIENT_BAN,
        QUERY_KEY_BAN,
      ],
    },
  },
  {
    files: ['apps/web/src/theme-mode.tsx'],
    rules: {
      'no-restricted-globals': ['error', ...HTTP_GLOBALS],
    },
  },
  {
    files: ['apps/web/src/query-client.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        AS_BAN,
        AUTH_API_LITERAL_BAN,
        ...REACT_API_BANS,
        ...QUERY_HOOK_BANS,
        QUERY_KEY_BAN,
      ],
    },
  },
  {
    files: ['apps/web/src/api.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...HTTP_IMPORT_BANS, ...STATE_LIB_BANS, ...DEVTOOLS_BAN],
          patterns: [QUERY_CLIENT_SINGLETON_PATTERN],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/main.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [...HTTP_IMPORT_BANS, ...STATE_LIB_BANS, ...CLIENT_CONSTRUCTION_BANS] },
      ],
    },
  },
  {
    files: ['apps/web/src/test/**/*.{ts,tsx}', 'apps/web/**/*.test.{ts,tsx}'],
    rules: {
      'agentproofarch/query-descriptors-only': 'off',
      'no-restricted-syntax': [
        'error',
        AS_BAN,
        AUTH_API_LITERAL_BAN,
        ...REACT_API_BANS,
        ...QUERY_HOOK_BANS,
        VI_MOCK_BAN,
      ],
    },
  },
  {
    // The wide event is the log: no step-logging in the server request path.
    files: ['apps/server/**/*.ts'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    // Scoped exception (Observability §Enforcement): composition-root startup/fatal path.
    files: ['apps/server/src/entry.*.ts', 'apps/server/src/env.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
