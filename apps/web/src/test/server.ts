import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { z } from 'zod';

/**
 * The unauthenticated client-config read fires on mount of the pre-auth pages
 * (LoginPage), so a default handler keeps `onUnhandledRequest: 'error'` happy
 * without every test re-declaring it. A test that needs Google on can override
 * this with its own `server.use(...)`.
 */
export const server = setupServer(
  http.get('*/api/config', () => HttpResponse.json({ ok: true, data: { googleEnabled: false, passwordResetEnabled: true } })),
  http.get('*/api/saved-searches', () =>
    HttpResponse.json({ ok: true, data: { savedSearches: [] } }),
  ),
  http.get('*/api/documents/trash', () =>
    HttpResponse.json({ ok: true, data: { documents: [] } }),
  ),
  http.get('*/api/api-tokens', () =>
    HttpResponse.json({ ok: true, data: { apiTokens: [] } }),
  ),
  http.get('*/api/me/preferences/:key', () =>
    HttpResponse.json({ ok: true, data: { preference: null } }),
  ),
  http.get('*/api/tenant-settings', () =>
    HttpResponse.json({
      ok: true,
      data: {
        settings: {
          tenantId: 'tenant-default',
          storeSignatureRecords: true,
        },
      },
    }),
  ),
  http.post('*/api/documents/:documentId/signature-records', async ({ params, request }) => {
    const body = await request.json();
    const parsed = z.object({
      fileId: z.string(),
      payload: z.array(z.unknown()),
    }).parse(body);
    return HttpResponse.json({
      ok: true,
      data: {
        signatureRecord: {
          id: '99999999-9999-4999-8999-999999999999',
          tenantId: 'tenant-default',
          documentId: params['documentId'],
          fileId: parsed.fileId,
          signedBy: 'user-owner',
          payload: parsed.payload,
          createdAt: '2026-08-07T10:00:00.000Z',
        },
      },
    });
  }),
  http.get('*/api/pad-sessions/active', () =>
    HttpResponse.json({ ok: true, data: { session: null } }),
  ),
  // SettingsPage's PasskeySection reads the passkey roster on mount; a default
  // empty list keeps every page-level test that isn't about passkeys quiet. A
  // passkey-focused test overrides this with its own `server.use(...)`.
  http.get('*/passkey/list-user-passkeys', () => HttpResponse.json([])),
);
