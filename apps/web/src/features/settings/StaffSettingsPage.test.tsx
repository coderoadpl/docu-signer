import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { StaffSettingsPage } from './StaffSettingsPage.js';

const meOwner = {
  userId: 'u-owner',
  email: 'owner@acme.dev',
  name: 'Owner',
  tenant: { id: 't1', slug: 'acme', name: 'Acme Inc', staffRole: 'owner', memberId: null },
};

const roster = {
  staff: [
    { id: 'g1', userId: 'u-owner', email: 'owner@acme.dev', name: 'Owner', role: 'owner' },
    { id: 'g2', userId: 'u-admin', email: 'admin@acme.dev', name: 'Admin', role: 'admin' },
  ],
};

/** The owner row renders a disabled revoke button; the admin's is the enabled one. */
const enabledRevoke = (): HTMLElement => {
  const button = screen
    .getAllByRole('button', { name: 'revoke' })
    .find((candidate) => !candidate.hasAttribute('disabled'));
  if (!button) throw new Error('no enabled revoke button');
  return button;
};

const renderStaff = async (me: unknown = meOwner) => {
  server.use(http.get('/api/me', () => HttpResponse.json({ ok: true, data: me })));
  const rootRoute = createRootRoute({ component: StaffSettingsPage });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/app/settings/staff'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('StaffSettingsPage', () => {
  it('gates revoke behind a confirmation dialog — the mutation fires only on confirm', async () => {
    let revokeCalls = 0;
    server.use(
      http.get('/api/staff', () => HttpResponse.json({ ok: true, data: roster })),
      http.post('/api/staff/revoke', () => {
        revokeCalls += 1;
        return HttpResponse.json({ ok: true, data: { userId: 'u-admin', revoked: 1 } });
      }),
    );

    await renderStaff();
    expect(await screen.findByText('admin@acme.dev')).toBeInTheDocument();

    await userEvent.click(enabledRevoke());
    // Dialog is open but nothing has been revoked yet.
    const dialog = await screen.findByRole('dialog');
    expect(revokeCalls).toBe(0);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    await screen.findByText('admin@acme.dev');
    expect(revokeCalls).toBe(1);
  });

  it('cancelling the dialog does not revoke', async () => {
    let revokeCalls = 0;
    server.use(
      http.get('/api/staff', () => HttpResponse.json({ ok: true, data: roster })),
      http.post('/api/staff/revoke', () => {
        revokeCalls += 1;
        return HttpResponse.json({ ok: true, data: { userId: 'u-admin', revoked: 1 } });
      }),
    );

    await renderStaff();
    await screen.findByText('admin@acme.dev');
    await userEvent.click(enabledRevoke());
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(revokeCalls).toBe(0);
  });

  it('grants admin access by email through the grant form', async () => {
    let granted: string | null = null;
    server.use(
      http.get('/api/staff', () => HttpResponse.json({ ok: true, data: roster })),
      http.post('/api/staff', async ({ request }) => {
        const body = z.object({ email: z.string() }).parse(await request.json());
        granted = body.email;
        return HttpResponse.json({
          ok: true,
          data: { staff: { id: 'g3', userId: 'u-new', email: body.email, name: 'New', role: 'admin' }, granted: true },
        });
      }),
    );

    await renderStaff();
    await userEvent.type(await screen.findByLabelText('Grant admin email'), 'new@acme.dev');
    await userEvent.click(screen.getByRole('button', { name: 'grant ↵' }));

    await screen.findByText('admin@acme.dev');
    expect(granted).toBe('new@acme.dev');
  });

  it('surfaces a not-found grant error humanely', async () => {
    server.use(
      http.get('/api/staff', () => HttpResponse.json({ ok: true, data: roster })),
      http.post('/api/staff', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'not_found', message: 'No account for "ghost@acme.dev" — the user must register first' } },
          { status: 404 },
        ),
      ),
    );

    await renderStaff();
    await userEvent.type(await screen.findByLabelText('Grant admin email'), 'ghost@acme.dev');
    await userEvent.click(screen.getByRole('button', { name: 'grant ↵' }));

    expect(await screen.findByText(/must register first/)).toBeInTheDocument();
  });

  it('hides the grant form and revoke controls from a non-owner admin', async () => {
    const meAdmin = { ...meOwner, tenant: { ...meOwner.tenant, staffRole: 'admin' } };
    server.use(http.get('/api/staff', () => HttpResponse.json({ ok: true, data: roster })));

    await renderStaff(meAdmin);
    expect(await screen.findByText('admin@acme.dev')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'revoke' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Grant admin email')).not.toBeInTheDocument();
  });
});
