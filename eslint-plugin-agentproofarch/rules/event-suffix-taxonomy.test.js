import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { it } from 'vitest';

import rule from './event-suffix-taxonomy.js';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
    parser: tseslint.parser,
  },
});

it('event-suffix-taxonomy', () => {
  ruleTester.run('event-suffix-taxonomy', rule, {
    valid: [
      "export type PersonalBoardEvent = { type: 'cardMoved' } | { type: 'cardSelected' } | { type: 'moveRequested' };",
      "export type CardEvent = { type: 'itemAdded' };",
      "export type ColumnEvent = 'columnOpened' | 'columnClosed';",
      [
        "type CardMovedEvent = { type: 'cardMoved' };",
        "type CardRemovedEvent = { type: 'cardRemoved' };",
        'export type BoardEvent = CardMovedEvent | CardRemovedEvent;',
      ].join('\n'),
      // Every exported union is inspected regardless of its alias name — a
      // non-`*Event` name with well-formed intent members still passes.
      "export type BoardEvents = { type: 'cardMoved' } | { type: 'cardRemoved' };",
      // Helper aliases with no statically determinable discriminant are skipped.
      "type CardId = string; export type Card = { id: CardId };",
      'export type DynamicEvent = { type: string };',
    ],
    invalid: [
      {
        // CP-2: renaming the alias (`*Events`, not `*Event`) no longer disables
        // the taxonomy — the imperative member still fires.
        code: "export type FooEvents = { type: 'deleteCard' } | { type: 'cardMoved' };",
        errors: [{ messageId: 'badSuffix' }],
      },
      {
        // R4-1a: exporting through an export list is still an export.
        code: [
          "type FooEvent = { type: 'deleteCard' } | { type: 'cardMoved' };",
          'export type { FooEvent };',
        ].join('\n'),
        errors: [{ messageId: 'badSuffix' }],
      },
      {
        // R4-1b: a same-file union alias standing behind the exported name is
        // statically determinable and resolved one level deep.
        code: [
          "type Inner = { type: 'deleteCard' } | { type: 'cardMoved' };",
          'export type FooEvents = Inner;',
        ].join('\n'),
        errors: [{ messageId: 'badSuffix' }],
      },
      {
        code: "export type BoardEvent = { type: 'deleteCard' } | { type: 'cardMoved' };",
        errors: [{ messageId: 'badSuffix' }],
      },
      {
        code: "export type ColumnEvent = 'openColumn' | 'columnOpened';",
        errors: [{ messageId: 'badSuffix' }],
      },
      {
        code: [
          "type DeleteCardEvent = { type: 'deleteCard' };",
          'export type BoardEvent = DeleteCardEvent;',
        ].join('\n'),
        errors: [{ messageId: 'badSuffix' }],
      },
      {
        code: "export type BoardEvent = { type: 'foo' } | { type: 'bar' };",
        errors: [{ messageId: 'badSuffix' }, { messageId: 'badSuffix' }],
      },
    ],
  });
});
