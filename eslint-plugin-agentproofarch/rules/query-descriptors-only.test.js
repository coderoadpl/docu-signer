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

it('query-descriptors-only', () => {
  ruleTester.run('query-descriptors-only', rule, {
    valid: [
      "import { actions } from './api.js'; useQuery(actions.me);",
      "import { actions } from './api.js'; useQuery(actions.todos());",
      "import { meQuery } from './q.js'; useQuery(meQuery);",
      "import { actions } from './api.js'; useMutation({ ...actions.addTodo, onSuccess() {} });",
      "import { actions } from './api.js'; useQueries({ queries: [actions.me, actions.todos()] });",
      "import { actions } from './api.js'; const q = actions.me; useQuery(q);",
      "foo({ queryKey: [] });",
    ],
    invalid: [
      {
        code: "useQuery({ queryKey: ['x'], queryFn: () => 1 });",
        errors: [{ messageId: 'inlineObject' }],
      },
      {
        code: "useMutation({ mutationFn: () => 1 });",
        errors: [{ messageId: 'inlineObject' }],
      },
      {
        code: "const local = { queryKey: [] }; useQuery(local);",
        errors: [{ messageId: 'notImported' }],
      },
      {
        code: "import { actions } from './api.js'; useQuery(somethingElse);",
        errors: [{ messageId: 'notImported' }],
      },
      {
        code: "useQueries({ queries: [{ queryKey: ['x'], queryFn() {} }] });",
        errors: [{ messageId: 'inlineObject' }],
      },
    ],
  });
});
