import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Identity, PadSession, PadSubmittedStrokes } from '#core/domain/index.js';
import type { PadSessionRepository } from '../ports.js';
import {
  closePadSession,
  consumePadStrokes,
  createPadSession,
  disconnectPadSession,
  getActivePadSession,
  getPadState,
  joinOwnPadSession,
  requestPadSignature,
  submitPadStrokes,
} from './pad-sessions.js';

const sessionId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';

const owner = (tenantId = 'tenant-a'): Identity => ({
  userId: 'user-owner',
  email: 'owner@example.com',
  name: 'Owner',
  tenantId,
  tenantSlug: tenantId,
  tenantName: 'Archive',
  staffRole: 'owner',
  apiToken: null,
});

const visitor: Identity = {
  ...owner(),
  userId: 'user-visitor',
  staffRole: null,
};

const otherOwner: Identity = {
  ...owner(),
  userId: 'user-other',
  email: 'other@example.com',
};

const ctx = (identity: Identity) => ({ identity });

const submitted = (id = requestId): PadSubmittedStrokes => ({
  requestId: id,
  inkColor: 'navy',
  sourceSize: { width: 834, height: 620 },
  strokes: [
    {
      points: [
        { x: 0.1, y: 0.2, pressure: 0.5 },
        { x: 0.5, y: 0.6, pressure: 0.7 },
      ],
    },
  ],
});

const fake = (initial: PadSession[] = []) => {
  const sessions = [...initial];
  const repository: PadSessionRepository = {
    create: async (input) => {
      for (let index = 0; index < sessions.length; index += 1) {
        const session = sessions[index];
        if (
          session?.tenantId === input.tenantId &&
          session.createdBy === input.createdBy &&
          session.status === 'active'
        ) {
          sessions[index] = {
            ...session,
            status: 'closed',
            currentRequest: null,
            submittedStrokes: null,
          };
        }
      }
      const session: PadSession = {
        ...input,
        status: 'active',
        createdAt: '2026-08-04T10:00:00.000Z',
        lastPolledAt: null,
        currentRequest: null,
        submittedStrokes: null,
      };
      sessions.push(session);
      return session;
    },
    findById: async (tenantId, id) =>
      sessions.find((session) => session.tenantId === tenantId && session.id === id) ?? null,
    findActiveByUser: async (tenantId, userId) =>
      sessions.find(
        (session) =>
          session.tenantId === tenantId &&
          session.createdBy === userId &&
          session.status === 'active',
      ) ?? null,
    renew: async (tenantId, id, expiresAt, lastPolledAt) => {
      const index = sessions.findIndex(
        (session) =>
          session.tenantId === tenantId && session.id === id && session.status === 'active',
      );
      const session = sessions[index];
      if (!session) return null;
      sessions[index] = { ...session, expiresAt, lastPolledAt };
      return sessions[index] ?? null;
    },
    requestSignature: async (tenantId, id, request) => {
      const index = sessions.findIndex(
        (session) => session.tenantId === tenantId && session.id === id,
      );
      const session = sessions[index];
      if (!session) return null;
      sessions[index] = { ...session, currentRequest: request, submittedStrokes: null };
      return sessions[index] ?? null;
    },
    submitStrokes: async (tenantId, id, strokes) => {
      const index = sessions.findIndex(
        (session) => session.tenantId === tenantId && session.id === id,
      );
      const session = sessions[index];
      if (!session) return null;
      sessions[index] = { ...session, submittedStrokes: strokes };
      return sessions[index] ?? null;
    },
    consumeStrokes: async (tenantId, id) => {
      const index = sessions.findIndex(
        (session) => session.tenantId === tenantId && session.id === id,
      );
      const session = sessions[index];
      if (!session?.submittedStrokes) return null;
      sessions[index] = { ...session, currentRequest: null, submittedStrokes: null };
      return session.submittedStrokes;
    },
    close: async (tenantId, id) => {
      const index = sessions.findIndex(
        (session) => session.tenantId === tenantId && session.id === id,
      );
      const session = sessions[index];
      if (!session) return false;
      sessions[index] = { ...session, status: 'closed', currentRequest: null, submittedStrokes: null };
      return true;
    },
  };
  return {
    deps: {
      ids: { nextId: vi.fn(() => (sessions.length === 0 ? sessionId : requestId)) },
      padSessions: repository,
      padSessionSecrets: {
        generate: () => 'pad_secret',
        hash: (value: string) => `hash:${value}`,
        matchesHash: (value: string, hash: string) => `hash:${value}` === hash,
      },
    },
    sessions,
  };
};

const activeSession = (overrides: Partial<PadSession> = {}): PadSession => ({
  id: sessionId,
  tenantId: 'tenant-a',
  createdBy: 'user-owner',
  secretHash: 'hash:pad_secret',
  status: 'active',
  createdAt: '2026-08-04T10:00:00.000Z',
  expiresAt: '2026-08-04T14:00:00.000Z',
  lastPolledAt: null,
  currentRequest: null,
  submittedStrokes: null,
  ...overrides,
});

describe('pad session use-cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a tenant-scoped session and returns the plaintext secret once', async () => {
    const state = fake();
    await expect(createPadSession(ctx(owner()), state.deps)).resolves.toMatchObject({
      ok: true,
      value: {
        secret: 'pad_secret',
        session: {
          id: sessionId,
          tenantId: 'tenant-a',
          createdBy: 'user-owner',
          status: 'active',
          expiresAt: '2026-08-04T14:00:00.000Z',
        },
      },
    });
    expect(JSON.stringify(state.sessions)).toContain('hash:pad_secret');
  });

  it('supersedes the same user\'s previous active session on create', async () => {
    const state = fake([activeSession()]);
    await expect(createPadSession(ctx(owner()), state.deps)).resolves.toMatchObject({
      ok: true,
      value: { session: { id: requestId, status: 'active' } },
    });
    expect(state.sessions).toEqual([
      expect.objectContaining({ id: sessionId, status: 'closed' }),
      expect.objectContaining({ id: requestId, status: 'active' }),
    ]);
  });

  it('returns or creates only the signed-in user\'s active session', async () => {
    const state = fake([activeSession()]);
    await expect(getActivePadSession(ctx(owner()), state.deps)).resolves.toMatchObject({
      ok: true,
      value: { id: sessionId },
    });
    await expect(joinOwnPadSession(ctx(owner()), state.deps)).resolves.toMatchObject({
      ok: true,
      value: { id: sessionId },
    });
    await expect(joinOwnPadSession(ctx(otherOwner), state.deps)).resolves.toMatchObject({
      ok: true,
      value: { createdBy: 'user-other' },
    });
    expect(state.sessions.filter((session) => session.status === 'active')).toHaveLength(2);
  });

  it('denies before repository access when the signed-in user lacks archive capability', async () => {
    const state = fake();
    const spy = vi.spyOn(state.deps.padSessions, 'create');
    await expect(createPadSession(ctx(visitor), state.deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('denies every pad action before repository access without the required capability', async () => {
    const state = fake([activeSession()]);
    const find = vi.spyOn(state.deps.padSessions, 'findById');
    const findActive = vi.spyOn(state.deps.padSessions, 'findActiveByUser');
    await expect(getActivePadSession(ctx(visitor), state.deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    await expect(joinOwnPadSession(ctx(visitor), state.deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    await expect(getPadState(ctx(visitor), sessionId, 'pad_secret', state.deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    await expect(
      requestPadSignature(ctx(visitor), sessionId, { documentTitle: 'Umowa' }, state.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    await expect(
      submitPadStrokes(ctx(visitor), sessionId, 'pad_secret', submitted(), state.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    await expect(consumePadStrokes(ctx(visitor), sessionId, state.deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    await expect(closePadSession(ctx(visitor), sessionId, state.deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    await expect(
      disconnectPadSession(ctx(visitor), sessionId, '', state.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(find).not.toHaveBeenCalled();
    expect(findActive).not.toHaveBeenCalled();
  });

  it('rejects cross-tenant desktop access and wrong pad secrets', async () => {
    const state = fake([activeSession()]);
    await expect(
      requestPadSignature(ctx(owner('tenant-b')), sessionId, { documentTitle: 'Umowa' }, state.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
    await expect(getPadState(ctx(owner()), sessionId, 'wrong', state.deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'unauthorized' },
    });
    await expect(getPadState(ctx(otherOwner), sessionId, '', state.deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('renews the sliding expiry and last-poll timestamp on every pad poll', async () => {
    const state = fake([activeSession()]);
    await getPadState(ctx(owner()), sessionId, '', state.deps);
    expect(state.sessions[0]).toMatchObject({
      expiresAt: '2026-08-04T14:00:00.000Z',
      lastPolledAt: '2026-08-04T10:00:00.000Z',
    });
    vi.setSystemTime(new Date('2026-08-04T12:00:00.000Z'));
    await getPadState(ctx(owner()), sessionId, '', state.deps);
    expect(state.sessions[0]).toMatchObject({
      expiresAt: '2026-08-04T16:00:00.000Z',
      lastPolledAt: '2026-08-04T12:00:00.000Z',
    });
  });

  it('retires a lapsed session instead of offering it to the owner', async () => {
    const state = fake([activeSession({ expiresAt: '2026-08-04T09:59:59.000Z' })]);
    await expect(getActivePadSession(ctx(owner()), state.deps)).resolves.toEqual({
      ok: true,
      value: null,
    });
    expect(state.sessions[0]).toMatchObject({ id: sessionId, status: 'closed' });

    const rejoined = fake([activeSession({ expiresAt: '2026-08-04T09:59:59.000Z' })]);
    await expect(joinOwnPadSession(ctx(owner()), rejoined.deps)).resolves.toMatchObject({
      ok: true,
      value: { id: requestId, expiresAt: '2026-08-04T14:00:00.000Z' },
    });
    expect(rejoined.sessions[0]).toMatchObject({ id: sessionId, status: 'closed' });
  });

  it('refuses to end or disconnect another user\'s session', async () => {
    const state = fake([activeSession()]);
    await expect(closePadSession(ctx(otherOwner), sessionId, state.deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    await expect(
      disconnectPadSession(ctx(otherOwner), sessionId, '', state.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    await expect(
      requestPadSignature(ctx(otherOwner), sessionId, { documentTitle: 'Umowa' }, state.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    await expect(consumePadStrokes(ctx(otherOwner), sessionId, state.deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(state.sessions[0]).toMatchObject({ status: 'active' });
  });

  it('rejects expired and closed sessions', async () => {
    const expired = fake([activeSession({ expiresAt: '2026-08-04T09:59:59.000Z' })]);
    await expect(getPadState(ctx(owner()), sessionId, 'pad_secret', expired.deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'unauthorized' },
    });
    await expect(
      requestPadSignature(ctx(owner()), sessionId, { documentTitle: 'Umowa' }, expired.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'unauthorized' } });
    const closed = fake([activeSession({ status: 'closed' })]);
    await expect(
      requestPadSignature(ctx(owner()), sessionId, { documentTitle: 'Umowa' }, closed.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('returns closed pad state without leaking an old request', async () => {
    const state = fake([
      activeSession({
        status: 'closed',
        currentRequest: { requestId, documentTitle: 'Umowa' },
      }),
    ]);
    await expect(getPadState(ctx(owner()), sessionId, 'pad_secret', state.deps)).resolves.toEqual({
      ok: true,
      value: { status: 'closed', currentRequest: null },
    });
  });

  it('rejects invalid desktop requests and handles vanished sessions on update', async () => {
    const state = fake([activeSession()]);
    await expect(
      requestPadSignature(ctx(owner()), sessionId, { documentTitle: '' }, state.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    vi.spyOn(state.deps.padSessions, 'requestSignature').mockResolvedValueOnce(null);
    await expect(
      requestPadSignature(ctx(owner()), sessionId, { documentTitle: 'Umowa' }, state.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('rejects invalid, closed and expired stroke flows', async () => {
    const closed = fake([
      activeSession({
        status: 'closed',
        currentRequest: { requestId, documentTitle: 'Umowa' },
      }),
    ]);
    await expect(
      submitPadStrokes(ctx(owner()), sessionId, 'pad_secret', { requestId }, closed.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    await expect(
      submitPadStrokes(ctx(owner()), sessionId, 'pad_secret', submitted(), closed.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });

    const expired = fake([activeSession({ expiresAt: '2026-08-04T09:59:59.000Z' })]);
    await expect(consumePadStrokes(ctx(owner()), sessionId, expired.deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'unauthorized' },
    });
    const closedForConsume = fake([activeSession({ status: 'closed' })]);
    await expect(consumePadStrokes(ctx(owner()), sessionId, closedForConsume.deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    const missing = fake();
    await expect(consumePadStrokes(ctx(owner()), sessionId, missing.deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('runs request, submit, consume and close as a roundtrip', async () => {
    const state = fake([activeSession()]);
    await expect(
      requestPadSignature(ctx(owner()), sessionId, { documentTitle: 'Umowa' }, state.deps),
    ).resolves.toEqual({
      ok: true,
      value: { requestId, documentTitle: 'Umowa' },
    });
    await expect(getPadState(ctx(owner()), sessionId, 'pad_secret', state.deps)).resolves.toMatchObject({
      ok: true,
      value: { currentRequest: { requestId, documentTitle: 'Umowa' } },
    });
    await expect(submitPadStrokes(ctx(owner()), sessionId, 'pad_secret', submitted(), state.deps)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(consumePadStrokes(ctx(owner()), sessionId, state.deps)).resolves.toEqual({
      ok: true,
      value: {
        submittedStrokes: submitted(),
        lastPolledAt: '2026-08-04T10:00:00.000Z',
      },
    });
    await expect(consumePadStrokes(ctx(owner()), sessionId, state.deps)).resolves.toEqual({
      ok: true,
      value: {
        submittedStrokes: null,
        lastPolledAt: '2026-08-04T10:00:00.000Z',
      },
    });
    await expect(closePadSession(ctx(owner()), sessionId, state.deps)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('makes desktop close and pad disconnect idempotent', async () => {
    const desktop = fake([activeSession()]);
    await expect(closePadSession(ctx(owner()), sessionId, desktop.deps)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(closePadSession(ctx(owner()), sessionId, desktop.deps)).resolves.toEqual({
      ok: true,
      value: undefined,
    });

    const pad = fake([activeSession()]);
    await expect(
      disconnectPadSession(ctx(otherOwner), sessionId, 'pad_secret', pad.deps),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(
      disconnectPadSession(ctx(otherOwner), sessionId, 'pad_secret', pad.deps),
    ).resolves.toEqual({ ok: true, value: undefined });
  });

  it('rejects stale request ids', async () => {
    const state = fake([
      activeSession({ currentRequest: { requestId, documentTitle: 'Umowa' } }),
    ]);
    await expect(
      submitPadStrokes(ctx(owner()), sessionId, 'wrong', submitted(), state.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'unauthorized' } });
    await expect(
      submitPadStrokes(
        ctx(owner()),
        sessionId,
        'pad_secret',
        submitted('33333333-3333-4333-8333-333333333333'),
        state.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});
