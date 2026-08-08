import { describe, expect, it } from 'vitest';

import type { BoardId, Card, Identity } from '#core/domain/index.js';

import type { CardRepository } from '../ports.js';
import { addCard, listCards, moveCard } from './cards.js';

const identity = (tenantId: string | null): Identity => ({
  userId: 'u1',
  email: 'demo@example.com',
  name: 'Demo',
  tenantId,
  tenantSlug: tenantId ? 'acme' : null,
  tenantName: tenantId ? 'Acme Inc' : null,
  staffRole: tenantId ? 'owner' : null,
  memberId: null,
});

const memberIdentity: Identity = {
  userId: 'u2',
  email: 'member@example.com',
  name: 'Member',
  tenantId: 't-acme',
  tenantSlug: 'acme',
  tenantName: 'Acme Inc',
  staffRole: null,
  memberId: 'm-1',
};

const card = (
  id: string,
  tenantId: string,
  column: string,
  position: number,
  options: { title?: string; board?: BoardId; visited?: readonly string[] } = {},
): Card => ({
  id,
  tenantId,
  title: options.title ?? id,
  board: options.board ?? 'personal',
  column,
  position,
  visited: [...(options.visited ?? [column])],
  createdAt: '2026-01-01T00:00:00.000Z',
});

const fakeRepo = (initial: Card[] = []) => {
  const store = [...initial];
  const repo: CardRepository = {
    listByTenant: async (tenantId, board) =>
      store
        .filter((row) => row.tenantId === tenantId && row.board === board)
        .map((row) => ({ ...row })),
    create: async (row) => {
      store.push(row);
    },
    updatePositions: async (tenantId, board, updates) => {
      for (const update of updates) {
        const row = store.find(
          (entry) => entry.id === update.id && entry.tenantId === tenantId && entry.board === board,
        );
        if (row) {
          row.column = update.column;
          row.position = update.position;
          if (update.visited !== undefined) row.visited = [...update.visited];
        }
      }
    },
  };
  return { repo, store };
};

const deps = (repo: CardRepository, nextId = 'card-1') => ({
  cards: repo,
  ids: { nextId: () => nextId },
  clock: { nowIso: () => '2026-07-03T00:00:00.000Z' },
});

/** column -> ordered card ids, read back through listCards for one board. */
const layout = async (
  repo: CardRepository,
  tenantId: string,
  board: BoardId = 'personal',
): Promise<Record<string, string[]>> => {
  const listed = await listCards({ identity: identity(tenantId), tenantCreationMode: 'open' }, { board }, deps(repo));
  const result: Record<string, string[]> = {};
  if (listed.ok) {
    for (const row of [...listed.value].sort((a, b) => a.position - b.position)) {
      (result[row.column] ??= []).push(row.id);
    }
  }
  return result;
};

describe('cards use-cases — listing + adding', () => {
  it('scopes listing to the tenant in ctx', async () => {
    const { repo } = fakeRepo([card('a', 't-acme', 'todo', 0), card('b', 't-globex', 'todo', 0)]);
    const result = await listCards({ identity: identity('t-acme'), tenantCreationMode: 'open' }, { board: 'personal' }, deps(repo));
    expect(result.ok && result.value.map((row) => row.id)).toEqual(['a']);
  });

  it('scopes listing to the requested board (cross-board isolation)', async () => {
    const { repo } = fakeRepo([
      card('p', 't-acme', 'todo', 0, { board: 'personal' }),
      card('t', 't-acme', 'todo', 0, { board: 'team' }),
    ]);
    const personal = await listCards({ identity: identity('t-acme'), tenantCreationMode: 'open' }, { board: 'personal' }, deps(repo));
    expect(personal.ok && personal.value.map((row) => row.id)).toEqual(['p']);
    const team = await listCards({ identity: identity('t-acme'), tenantCreationMode: 'open' }, { board: 'team' }, deps(repo));
    expect(team.ok && team.value.map((row) => row.id)).toEqual(['t']);
  });

  it('defaults an omitted board to personal', async () => {
    const { repo } = fakeRepo([
      card('p', 't-acme', 'todo', 0, { board: 'personal' }),
      card('t', 't-acme', 'todo', 0, { board: 'team' }),
    ]);
    const result = await listCards({ identity: identity('t-acme'), tenantCreationMode: 'open' }, {}, deps(repo));
    expect(result.ok && result.value.map((row) => row.id)).toEqual(['p']);
  });

  it('denies a tenant-less caller with forbidden on every card use-case', async () => {
    const { repo } = fakeRepo();
    expect(await listCards({ identity: identity(null), tenantCreationMode: 'open' }, { board: 'personal' }, deps(repo))).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(
      await addCard({ identity: identity(null), tenantCreationMode: 'open' }, { title: 'x', column: 'todo' }, deps(repo)),
    ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(
      await moveCard(
        { identity: identity(null), tenantCreationMode: 'open' },
        { cardId: 'a', toColumn: 'todo', toIndex: 0 },
        deps(repo),
      ),
    ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('allows a tenant member to list, add and move cards (collaborative boards)', async () => {
    const { repo } = fakeRepo([card('a', 't-acme', 'todo', 0), card('b', 't-acme', 'todo', 1)]);
    expect(await listCards({ identity: memberIdentity, tenantCreationMode: 'open' }, { board: 'personal' }, deps(repo))).toMatchObject({
      ok: true,
    });
    expect(
      await addCard({ identity: memberIdentity, tenantCreationMode: 'open' }, { title: 'member card', column: 'todo' }, deps(repo)),
    ).toMatchObject({ ok: true, value: { tenantId: 't-acme', title: 'member card' } });
    expect(
      await moveCard(
        { identity: memberIdentity, tenantCreationMode: 'open' },
        { cardId: 'a', toColumn: 'doing', toIndex: 0 },
        deps(repo),
      ),
    ).toMatchObject({ ok: true, value: { id: 'a', column: 'doing' } });
  });

  it('validates input and stamps tenant on create', async () => {
    const { repo, store } = fakeRepo();
    const blank = await addCard(
      { identity: identity('t-acme'), tenantCreationMode: 'open' },
      { title: '  ', column: 'todo' },
      deps(repo),
    );
    expect(blank).toMatchObject({ ok: false, error: { code: 'validation' } });

    const created = await addCard(
      { identity: identity('t-acme'), tenantCreationMode: 'open' },
      { title: 'Ship it', column: 'todo' },
      deps(repo),
    );
    expect(created).toMatchObject({
      ok: true,
      value: { tenantId: 't-acme', title: 'Ship it', board: 'personal', column: 'todo', position: 0, visited: ['todo'] },
    });
    expect(store).toHaveLength(1);
  });

  it('rejects an unknown column with a validation error', async () => {
    const { repo } = fakeRepo();
    expect(
      await addCard({ identity: identity('t-acme'), tenantCreationMode: 'open' }, { title: 'x', column: 'backlog' }, deps(repo)),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('appends new cards to the end of their own column', async () => {
    const seed = [
      card('t1', 't-acme', 'todo', 0),
      card('t2', 't-acme', 'todo', 1),
      card('d1', 't-acme', 'doing', 0),
    ];
    const { repo } = fakeRepo(seed);
    const created = await addCard(
      { identity: identity('t-acme'), tenantCreationMode: 'open' },
      { title: 'third todo', column: 'todo' },
      deps(repo, 'card-new'),
    );
    expect(created).toMatchObject({ ok: true, value: { position: 2, column: 'todo' } });
  });

  it('adds to the team board with its own column set and starts visited history', async () => {
    const { repo } = fakeRepo();
    const created = await addCard(
      { identity: identity('t-acme'), tenantCreationMode: 'open' },
      { title: 'Team task', board: 'team', column: 'todo' },
      deps(repo),
    );
    expect(created).toMatchObject({
      ok: true,
      value: { board: 'team', column: 'todo', visited: ['todo'] },
    });
    // 'doing' is a personal column, not a team column.
    expect(
      await addCard(
        { identity: identity('t-acme'), tenantCreationMode: 'open' },
        { title: 'x', board: 'team', column: 'doing' },
        deps(repo),
      ),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('refuses to create a team card outside the entry column (entry-column rule)', async () => {
    const { repo } = fakeRepo();
    for (const column of ['in-dev', 'review', 'done']) {
      expect(
        await addCard(
          { identity: identity('t-acme'), tenantCreationMode: 'open' },
          { title: 'spawned late', board: 'team', column },
          deps(repo),
        ),
      ).toMatchObject({
        ok: false,
        error: { code: 'validation', details: { rule: 'entry-column' } },
      });
    }
    // The personal board keeps free placement.
    expect(
      await addCard(
        { identity: identity('t-acme'), tenantCreationMode: 'open' },
        { title: 'free', board: 'personal', column: 'done' },
        deps(repo),
      ),
    ).toMatchObject({ ok: true, value: { column: 'done' } });
  });
});

describe('cards use-cases — moveCard (personal, free movement)', () => {
  const seed = () => [
    card('a', 't-acme', 'todo', 0),
    card('b', 't-acme', 'todo', 1),
    card('c', 't-acme', 'todo', 2),
    card('x', 't-acme', 'doing', 0),
  ];

  it('reorders within a column and rewrites contiguous positions', async () => {
    const { repo } = fakeRepo(seed());
    const result = await moveCard(
      { identity: identity('t-acme'), tenantCreationMode: 'open' },
      { cardId: 'c', toColumn: 'todo', toIndex: 0 },
      deps(repo),
    );
    expect(result).toMatchObject({ ok: true, value: { id: 'c', column: 'todo', position: 0 } });
    expect(await layout(repo, 't-acme')).toEqual({ todo: ['c', 'a', 'b'], doing: ['x'] });
  });

  it('moves across columns and renumbers both source and target', async () => {
    const { repo } = fakeRepo(seed());
    const result = await moveCard(
      { identity: identity('t-acme'), tenantCreationMode: 'open' },
      { cardId: 'a', toColumn: 'doing', toIndex: 0 },
      deps(repo),
    );
    expect(result).toMatchObject({ ok: true, value: { id: 'a', column: 'doing', position: 0 } });
    expect(await layout(repo, 't-acme')).toEqual({ todo: ['b', 'c'], doing: ['a', 'x'] });
  });

  it('clamps an out-of-range toIndex to the end of the target column', async () => {
    const { repo } = fakeRepo(seed());
    const result = await moveCard(
      { identity: identity('t-acme'), tenantCreationMode: 'open' },
      { cardId: 'a', toColumn: 'doing', toIndex: 999 },
      deps(repo),
    );
    expect(result).toMatchObject({ ok: true, value: { column: 'doing', position: 1 } });
    expect(await layout(repo, 't-acme')).toEqual({ todo: ['b', 'c'], doing: ['x', 'a'] });
  });

  it('clamps a negative toIndex to the front of the target column', async () => {
    const { repo } = fakeRepo(seed());
    const result = await moveCard(
      { identity: identity('t-acme'), tenantCreationMode: 'open' },
      { cardId: 'b', toColumn: 'todo', toIndex: -5 },
      deps(repo),
    );
    expect(result).toMatchObject({ ok: true, value: { position: 0 } });
    expect(await layout(repo, 't-acme')).toEqual({ todo: ['b', 'a', 'c'], doing: ['x'] });
  });

  it('rejects a move into an unknown column', async () => {
    const { repo } = fakeRepo(seed());
    expect(
      await moveCard(
        { identity: identity('t-acme'), tenantCreationMode: 'open' },
        { cardId: 'a', toColumn: 'archive', toIndex: 0 },
        deps(repo),
      ),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('returns not_found for a card the tenant does not own (cross-tenant denial)', async () => {
    const { repo } = fakeRepo([...seed(), card('other', 't-globex', 'todo', 0)]);
    const result = await moveCard(
      { identity: identity('t-acme'), tenantCreationMode: 'open' },
      { cardId: 'other', toColumn: 'doing', toIndex: 0 },
      deps(repo),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await layout(repo, 't-globex')).toEqual({ todo: ['other'] });
  });
});

describe('cards use-cases — moveCard (team, guarded movement)', () => {
  // A team board sized so the legal path is walkable and each guard is reachable.
  const seed = () => [
    card('c', 't-acme', 'todo', 0, { board: 'team', visited: ['todo'] }),
  ];

  const move = async (repo: CardRepository, cardId: string, toColumn: string, toIndex = 0) =>
    moveCard(
      { identity: identity('t-acme'), tenantCreationMode: 'open' },
      { cardId, board: 'team', toColumn, toIndex },
      deps(repo),
    );

  it('walks the legal path todo -> in-dev -> review -> done, recording visited', async () => {
    const { repo, store } = fakeRepo(seed());
    expect(await move(repo, 'c', 'in-dev')).toMatchObject({ ok: true, value: { column: 'in-dev' } });
    expect(await move(repo, 'c', 'review')).toMatchObject({ ok: true, value: { column: 'review' } });
    const done = await move(repo, 'c', 'done');
    expect(done).toMatchObject({ ok: true, value: { column: 'done' } });
    // visited accumulated the whole path (dedup, order-preserving).
    const persisted = store.find((row) => row.id === 'c');
    expect(persisted?.visited).toEqual(['todo', 'in-dev', 'review', 'done']);
  });

  it('rejects review before in-dev with the review-requires-in-dev rule', async () => {
    const { repo } = fakeRepo(seed());
    const result = await move(repo, 'c', 'review');
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'validation', details: { rule: 'review-requires-in-dev' } },
    });
  });

  it('rejects done from anywhere but review with the done-only-from-review rule', async () => {
    const { repo } = fakeRepo([card('c', 't-acme', 'in-dev', 0, { board: 'team', visited: ['todo', 'in-dev'] })]);
    const result = await move(repo, 'c', 'done');
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'validation', details: { rule: 'done-only-from-review' } },
    });
  });

  it('enforces the WIP limit on the destination column', async () => {
    // in-dev limit is 3; fill it, then a fourth move is blocked.
    const { repo } = fakeRepo([
      card('o1', 't-acme', 'in-dev', 0, { board: 'team', visited: ['todo', 'in-dev'] }),
      card('o2', 't-acme', 'in-dev', 1, { board: 'team', visited: ['todo', 'in-dev'] }),
      card('o3', 't-acme', 'in-dev', 2, { board: 'team', visited: ['todo', 'in-dev'] }),
      card('c', 't-acme', 'todo', 0, { board: 'team', visited: ['todo'] }),
    ]);
    const result = await move(repo, 'c', 'in-dev');
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'validation', details: { rule: 'wip-limit' } },
    });
  });

  it('a rejected move persists nothing', async () => {
    const { repo } = fakeRepo(seed());
    await move(repo, 'c', 'review');
    // Still in todo, history untouched.
    expect(await layout(repo, 't-acme', 'team')).toEqual({ todo: ['c'] });
  });
});
