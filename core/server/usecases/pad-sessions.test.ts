import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  Identity,
  PadParticipant,
  PadQueuedSubmission,
  PadSession,
  PadStrokeSubmission,
} from '#core/domain/index.js';
import type { PadSessionRepository } from '../ports.js';
import {
  closePadSession,
  consumePadSubmission,
  consumePadStrokes,
  createPadSession,
  disconnectPadSession,
  getActivePadSession,
  getPadState,
  joinOwnPadSession,
  requestPadSignature,
  setPadCurrentDocument,
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
  name: 'Other Owner',
};

const ctx = (identity: Identity) => ({ identity });

const submitted = (id = requestId): PadStrokeSubmission => ({
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

const attributedSubmission = (
  submission = submitted(),
  contributor: Identity = owner(),
) => ({
  ...submission,
  contributedBy: {
    accountId: contributor.userId,
    label: contributor.name,
  },
});

const fake = (initial: PadSession[] = []) => {
  const sessions = [...initial];
  const participants: PadParticipant[] = [];
  const submissions: PadQueuedSubmission[] = [];
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
        currentDocument: null,
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
    findActiveShared: async (tenantId, excludeUserId) =>
      sessions.find(
        (session) =>
          session.tenantId === tenantId &&
          session.createdBy !== excludeUserId &&
          session.mode === 'shared' &&
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
    setCurrentDocument: async (tenantId, id, document) => {
      const index = sessions.findIndex(
        (session) => session.tenantId === tenantId && session.id === id,
      );
      const session = sessions[index];
      if (!session) return null;
      sessions[index] = { ...session, currentDocument: document };
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
    touchParticipant: async (_tenantId, _id, participant) => {
      const index = participants.findIndex(
        (current) => current.accountId === participant.accountId,
      );
      const next = {
        accountId: participant.accountId,
        label: participant.label,
        lastPolledAt: participant.lastPolledAt,
      };
      if (index === -1) participants.push(next);
      else participants[index] = next;
    },
    listParticipants: async () => [...participants],
    removeParticipant: async (_tenantId, _id, accountId) => {
      const index = participants.findIndex(
        (participant) => participant.accountId === accountId,
      );
      if (index === -1) return false;
      participants.splice(index, 1);
      return true;
    },
    enqueueSubmission: async (_tenantId, _id, submission) => {
      submissions.push(submission);
      if (submission.requestId) {
        const index = sessions.findIndex(
          (session) => session.currentRequest?.requestId === submission.requestId,
        );
        const session = sessions[index];
        if (session) sessions[index] = { ...session, currentRequest: null };
      }
    },
    listSubmissions: async () => [...submissions],
    consumeSubmission: async (_tenantId, _id, submissionId) => {
      const index = submissions.findIndex((submission) => submission.id === submissionId);
      if (index === -1) return null;
      return submissions.splice(index, 1)[0] ?? null;
    },
    close: async (tenantId, id) => {
      const index = sessions.findIndex(
        (session) => session.tenantId === tenantId && session.id === id,
      );
      const session = sessions[index];
      if (!session) return false;
      sessions[index] = { ...session, status: 'closed', currentRequest: null, submittedStrokes: null };
      participants.splice(0);
      submissions.splice(0);
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
    participants,
    submissions,
  };
};

const activeSession = (overrides: Partial<PadSession> = {}): PadSession => ({
  id: sessionId,
  tenantId: 'tenant-a',
  createdBy: 'user-owner',
  secretHash: 'hash:pad_secret',
  mode: 'private',
  status: 'active',
  createdAt: '2026-08-04T10:00:00.000Z',
  expiresAt: '2026-08-04T14:00:00.000Z',
  lastPolledAt: null,
  currentRequest: null,
  currentDocument: null,
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

  it('returns no active host session when the user has none', async () => {
    const state = fake();
    await expect(getActivePadSession(ctx(owner()), state.deps)).resolves.toEqual({
      ok: true,
      value: null,
    });
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

  it('rejects a pad poll when renewal loses the active session', async () => {
    const state = fake([activeSession()]);
    vi.spyOn(state.deps.padSessions, 'renew').mockResolvedValueOnce(null);
    await expect(
      getPadState(ctx(owner()), sessionId, 'pad_secret', state.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'unauthorized' } });
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
      value: {
        mode: 'private',
        status: 'closed',
        currentRequest: null,
        currentDocument: null,
      },
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
        submittedStrokes: attributedSubmission(),
        lastPolledAt: '2026-08-04T10:00:00.000Z',
        participants: [],
        submissions: [],
      },
    });
    await expect(consumePadStrokes(ctx(owner()), sessionId, state.deps)).resolves.toEqual({
      ok: true,
      value: {
        submittedStrokes: null,
        lastPolledAt: '2026-08-04T10:00:00.000Z',
        participants: [],
        submissions: [],
      },
    });
    await expect(closePadSession(ctx(owner()), sessionId, state.deps)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('attributes submitted ink from server identity and ignores a spoofed contributor', async () => {
    const state = fake([
      activeSession({
        mode: 'shared',
        currentDocument: { key: 'document-a:file-a', title: 'Umowa' },
        currentRequest: { requestId, documentTitle: 'Umowa' },
      }),
    ]);
    await expect(
      submitPadStrokes(
        ctx(otherOwner),
        sessionId,
        'pad_secret',
        {
          ...submitted(),
          contributedBy: { accountId: 'user-spoofed', label: 'Spoofed' },
        },
        state.deps,
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(state.submissions[0]).toMatchObject({
      requestId,
      contributedBy: { accountId: 'user-other', label: 'Other Owner' },
    });
    expect(state.sessions[0]?.currentRequest).toBeNull();
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

    const pad = fake([
      activeSession({
        mode: 'shared',
        currentDocument: { key: 'document-a:file-a', title: 'Umowa' },
      }),
    ]);
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

  it('lets another tenant account join a shared session without disturbing its own slot', async () => {
    const participantSessionId = '33333333-3333-4333-8333-333333333333';
    const state = fake([
      activeSession({ mode: 'shared' }),
      activeSession({
        id: participantSessionId,
        createdBy: 'user-other',
      }),
    ]);

    await expect(joinOwnPadSession(ctx(otherOwner), state.deps)).resolves.toMatchObject({
      ok: true,
      value: { id: sessionId, mode: 'shared', createdBy: 'user-owner' },
    });
    expect(state.sessions).toEqual([
      expect.objectContaining({ id: sessionId, status: 'active' }),
      expect.objectContaining({ id: participantSessionId, status: 'active' }),
    ]);
    expect(state.participants).toEqual([
      expect.objectContaining({ accountId: 'user-other', label: 'Other Owner' }),
    ]);
  });

  it('tracks shared participants while private sessions remain same-user-only', async () => {
    const shared = fake([activeSession({ mode: 'shared' })]);
    await expect(
      getPadState(ctx(otherOwner), sessionId, 'pad_secret', shared.deps),
    ).resolves.toMatchObject({
      ok: true,
      value: { mode: 'shared', status: 'active' },
    });
    expect(shared.participants).toEqual([
      {
        accountId: 'user-other',
        label: 'Other Owner',
        lastPolledAt: '2026-08-04T10:00:00.000Z',
      },
    ]);

    const privateSession = fake([activeSession()]);
    await expect(
      getPadState(ctx(otherOwner), sessionId, 'pad_secret', privateSession.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('queues proactive shared submissions and lets only the host consume the tray', async () => {
    const state = fake([
      activeSession({
        mode: 'shared',
        currentDocument: { key: 'document-a:file-a', title: 'Umowa' },
      }),
    ]);
    const proactive = {
      inkColor: 'navy' as const,
      sourceSize: { width: 834, height: 620 },
      strokes: submitted().strokes,
    };

    await expect(
      submitPadStrokes(ctx(otherOwner), sessionId, 'pad_secret', proactive, state.deps),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(consumePadStrokes(ctx(owner()), sessionId, state.deps)).resolves.toMatchObject({
      ok: true,
      value: {
        submissions: [
          {
            document: { key: 'document-a:file-a', title: 'Umowa' },
            requestId: null,
            contributedBy: { accountId: 'user-other', label: 'Other Owner' },
          },
        ],
      },
    });
    const queued = state.submissions[0];
    if (!queued) throw new Error('Expected queued shared submission');
    await expect(
      consumePadSubmission(ctx(otherOwner), sessionId, queued.id, state.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    await expect(
      consumePadSubmission(ctx(owner()), sessionId, queued.id, state.deps),
    ).resolves.toMatchObject({ ok: true, value: { id: queued.id } });
    expect(state.submissions).toEqual([]);
  });

  it('denies shared-session joins and pushes across tenants', async () => {
    const state = fake([
      activeSession({
        mode: 'shared',
        currentDocument: { key: 'document-a:file-a', title: 'Umowa' },
      }),
    ]);
    await expect(joinOwnPadSession(ctx(owner('tenant-b')), state.deps)).resolves.toMatchObject({
      ok: true,
      value: { tenantId: 'tenant-b', createdBy: 'user-owner' },
    });
    await expect(
      submitPadStrokes(
        ctx({ ...otherOwner, tenantId: 'tenant-b' }),
        sessionId,
        'pad_secret',
        submitted(),
        state.deps,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'unauthorized' } });
    expect(state.submissions).toEqual([]);
  });

  it('lets the shared-session host publish the active document', async () => {
    const state = fake([activeSession({ mode: 'shared' })]);
    await expect(
      setPadCurrentDocument(
        ctx(owner()),
        sessionId,
        { document: { key: 'document-a:file-a', title: 'Umowa' } },
        state.deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: { key: 'document-a:file-a', title: 'Umowa' },
    });
    expect(state.sessions[0]?.currentDocument).toEqual({
      key: 'document-a:file-a',
      title: 'Umowa',
    });
  });

  it('enforces shared-document publication state and host ownership', async () => {
    const validDocument = {
      document: { key: 'document-a:file-a', title: 'Umowa' },
    };
    const shared = fake([activeSession({ mode: 'shared' })]);
    await expect(
      setPadCurrentDocument(ctx(owner()), sessionId, { document: null }, shared.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    await expect(
      setPadCurrentDocument(ctx(otherOwner), sessionId, validDocument, shared.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });

    const expired = fake([
      activeSession({ mode: 'shared', expiresAt: '2026-08-04T09:59:59.000Z' }),
    ]);
    await expect(
      setPadCurrentDocument(ctx(owner()), sessionId, validDocument, expired.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'unauthorized' } });

    const closed = fake([activeSession({ mode: 'shared', status: 'closed' })]);
    await expect(
      setPadCurrentDocument(ctx(owner()), sessionId, validDocument, closed.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });

    const privateSession = fake([activeSession()]);
    await expect(
      setPadCurrentDocument(ctx(owner()), sessionId, validDocument, privateSession.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });

    vi.spyOn(shared.deps.padSessions, 'setCurrentDocument').mockResolvedValueOnce(null);
    await expect(
      setPadCurrentDocument(ctx(owner()), sessionId, validDocument, shared.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('rejects shared pushes until the host publishes a document', async () => {
    const state = fake([activeSession({ mode: 'shared' })]);
    await expect(
      submitPadStrokes(ctx(otherOwner), sessionId, 'pad_secret', submitted(), state.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('enforces tray consumption state and returns missing submissions', async () => {
    const expired = fake([
      activeSession({ mode: 'shared', expiresAt: '2026-08-04T09:59:59.000Z' }),
    ]);
    await expect(
      consumePadSubmission(ctx(owner()), sessionId, requestId, expired.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'unauthorized' } });

    const closed = fake([activeSession({ mode: 'shared', status: 'closed' })]);
    await expect(
      consumePadSubmission(ctx(owner()), sessionId, requestId, closed.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });

    const active = fake([activeSession({ mode: 'shared' })]);
    await expect(
      consumePadSubmission(ctx(owner()), sessionId, requestId, active.deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('closes a private session when its owner disconnects the pad', async () => {
    const state = fake([activeSession()]);
    await expect(
      disconnectPadSession(ctx(owner()), sessionId, '', state.deps),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(state.sessions[0]?.status).toBe('closed');
  });
});
