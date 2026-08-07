import path from 'node:path';

import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { it } from 'vitest';

import rule from './sx-layout-only.js';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const REL = 'apps/web/src/features/Sample.tsx';
const filename = path.join(process.cwd(), REL);
const withBaseline = (count) => [{ baseline: { [REL]: count } }];

it('sx-layout-only', () => {
  ruleTester.run('sx-layout-only', rule, {
    valid: [
      {
        code: "const C = () => <div sx={{ p: 2, display: 'flex', mt: 1, minWidth: '2rem' }} />;",
        filename,
      },
      {
        code: "const C = () => <div sx={{ '& input': { p: 1 }, position: 'fixed', top: 0 }} />;",
        filename,
      },
      {
        code: "const C = () => <div sx={{ color: 'red' }} />;",
        filename,
        options: withBaseline(1),
      },
      {
        code: "const C = () => <div sx={{ color: 'red', fontSize: 12 }} />;",
        filename,
        options: withBaseline(2),
      },
    ],
    invalid: [
      {
        code: "const C = () => <div sx={{ color: 'red' }} />;",
        filename,
        errors: [{ messageId: 'reserved' }],
      },
      {
        code: "const C = () => <div sx={{ fontSize: 12, border: 1, background: 'x', bgcolor: 'y' }} />;",
        filename,
        errors: [
          { messageId: 'reserved' },
          { messageId: 'reserved' },
          { messageId: 'reserved' },
          { messageId: 'reserved' },
        ],
      },
      {
        code: "const C = () => <div sx={{ color: 'a', backgroundColor: 'b' }} />;",
        filename,
        options: withBaseline(1),
        errors: [{ messageId: 'reserved' }],
      },
      {
        code: "const C = () => <div sx={{ p: 1 }} />;",
        filename,
        options: withBaseline(1),
        errors: [{ messageId: 'staleBaseline' }],
      },
    ],
  });
});
