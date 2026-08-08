import path from 'node:path';

import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { it } from 'vitest';

import rule from './query-descriptors-only.js';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

// Origin is decided by RESOLVED repo-relative path, so fixtures carry the
// importing file: `./api.js` from a web src file resolves to the one canonical
// `apps/web/src/api.ts`; `./core/index.js` from a feature file resolves to that
// island's `core/index.ts`.
const webFile = path.join(process.cwd(), 'apps/web/src/App.tsx');
const boardFile = path.join(process.cwd(), 'apps/web/src/features/board/BoardPage.tsx');
const at = (file) => (code) => ({ code, filename: file });
const web = at(webFile);
const board = at(boardFile);

it('query-descriptors-only', () => {
  ruleTester.run('query-descriptors-only', rule, {
    valid: [
      web("import { actions } from './api.js'; useQuery(actions.me);"),
      web("import { actions } from './api.js'; useQuery(actions.todos());"),
      // Canonical descriptor source: #core/client.
      web("import { meQuery } from '#core/client/index.js'; useQuery(meQuery);"),
      // Island core public seam re-exports the bound descriptors.
      board("import { boardSelectors } from './core/index.js'; useQuery(boardSelectors.list);"),
      // Island web composition (index.web.ts): where the portable core is bound to
      // its real gateway + descriptors; the view consumes the seam through it.
      board("import { boardSelectors } from './index.web.js'; useQuery(boardSelectors.list);"),
      web("import { actions } from './api.js'; useMutation({ ...actions.addTodo, onSuccess() {} });"),
      web("import { actions } from './api.js'; useQueries({ queries: [actions.me, actions.todos()] });"),
      web("import { actions } from './api.js'; const q = actions.me; useQuery(q);"),
      web('foo({ queryKey: [] });'),
    ],
    invalid: [
      {
        ...web("useQuery({ queryKey: ['x'], queryFn: () => 1 });"),
        errors: [{ messageId: 'inlineObject' }],
      },
      {
        ...web('useMutation({ mutationFn: () => 1 });'),
        errors: [{ messageId: 'inlineObject' }],
      },
      {
        ...web('const local = { queryKey: [] }; useQuery(local);'),
        errors: [{ messageId: 'notImported' }],
      },
      {
        ...web("import { actions } from './api.js'; useQuery(somethingElse);"),
        errors: [{ messageId: 'notImported' }],
      },
      {
        ...web("useQueries({ queries: [{ queryKey: ['x'], queryFn() {} }] });"),
        errors: [{ messageId: 'inlineObject' }],
      },
      {
        // Local-module evasion: a look-alike descriptor from an arbitrary module.
        ...web("import { meQuery } from './q.js'; useQuery(meQuery);"),
        errors: [{ messageId: 'foreignModule' }],
      },
      {
        // Re-export evasion: importing a descriptor from a non-canonical
        // re-export module does not pass.
        ...web("import { fake } from './descriptors-reexport.js'; useMutation(fake);"),
        errors: [{ messageId: 'foreignModule' }],
      },
      {
        // Look-alike evasion (CP-1): a local file that merely ends in `/api.js`
        // is not the canonical web binding once the path is resolved.
        ...web("import { fake } from './helpers/api.js'; useQuery(fake);"),
        errors: [{ messageId: 'foreignModule' }],
      },
    ],
  });
});
