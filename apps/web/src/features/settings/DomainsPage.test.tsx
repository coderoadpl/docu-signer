import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { DomainsPage } from './DomainsPage.js';

const domainBodySchema = z.object({ domain: z.string() });

const listBody = (domains: unknown[]) => ({
  ok: true,
  data: { domains, target: { cname: 'apps.example.com', ip: null } },
});

const pendingDomain = { id: 'd1', tenantId: 't1', domain: 'shop.acme.com', kind: 'custom', verified: false };

const renderDomains = async () => {
  const rootRoute = createRootRoute({ component: DomainsPage });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/app/settings/domains'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('DomainsPage', () => {
  it('lists domains with status and shows the CNAME DNS instruction', async () => {
    server.use(http.get('/api/domains', () => HttpResponse.json(listBody([pendingDomain]))));

    await renderDomains();

    expect(await screen.findByText('shop.acme.com')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText(/CNAME record pointing your domain at apps\.example\.com/)).toBeInTheDocument();
  });

  it('shows the empty state and an A-record instruction when the target is an IP', async () => {
    server.use(
      http.get('/api/domains', () =>
        HttpResponse.json({ ok: true, data: { domains: [], target: { cname: null, ip: '203.0.113.10' } } }),
      ),
    );

    await renderDomains();

    expect(await screen.findByText('— no custom domains yet —')).toBeInTheDocument();
    expect(screen.getByText(/A record pointing your domain at 203\.0\.113\.10/)).toBeInTheDocument();
  });

  it('falls back to generic guidance when no DNS target is configured', async () => {
    server.use(
      http.get('/api/domains', () =>
        HttpResponse.json({ ok: true, data: { domains: [], target: { cname: null, ip: null } } }),
      ),
    );

    await renderDomains();

    expect(await screen.findByText(/Point your domain at this deployment/)).toBeInTheDocument();
  });

  it('adds a domain through the add form', async () => {
    let added: string | null = null;
    server.use(
      http.get('/api/domains', () => HttpResponse.json(listBody([]))),
      http.post('/api/domains', async ({ request }) => {
        const body = domainBodySchema.parse(await request.json());
        added = body.domain;
        return HttpResponse.json({ ok: true, data: { domain: { ...pendingDomain, domain: body.domain } } });
      }),
    );

    await renderDomains();
    await userEvent.type(await screen.findByLabelText('New domain'), 'shop.acme.com');
    await userEvent.click(screen.getByRole('button', { name: 'add domain' }));

    await screen.findByRole('button', { name: 'add domain' });
    expect(added).toBe('shop.acme.com');
  });

  it('runs a per-domain check', async () => {
    let checked: string | null = null;
    server.use(
      http.get('/api/domains', () => HttpResponse.json(listBody([pendingDomain]))),
      http.post('/api/domains/check', async ({ request }) => {
        const body = domainBodySchema.parse(await request.json());
        checked = body.domain;
        return HttpResponse.json({
          ok: true,
          data: { domain: { ...pendingDomain, verified: true }, check: { resolved: true, detail: 'ok' } },
        });
      }),
    );

    await renderDomains();
    await userEvent.click(await screen.findByRole('button', { name: 'check' }));
    await screen.findByText('shop.acme.com');
    expect(checked).toBe('shop.acme.com');
  });

  it('shows a verified domain and surfaces an add error', async () => {
    server.use(
      http.get('/api/domains', () =>
        HttpResponse.json(listBody([{ ...pendingDomain, verified: true }])),
      ),
      http.post('/api/domains', () =>
        HttpResponse.json({ ok: false, error: { code: 'conflict', message: 'already attached' } }, { status: 409 }),
      ),
    );

    await renderDomains();
    expect(await screen.findByText('verified')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('New domain'), 'other.acme.com');
    await userEvent.click(screen.getByRole('button', { name: 'add domain' }));
    expect(await screen.findByText('already attached')).toBeInTheDocument();
  });

  it('gates remove behind a confirmation dialog', async () => {
    let removeCalls = 0;
    server.use(
      http.get('/api/domains', () => HttpResponse.json(listBody([pendingDomain]))),
      http.post('/api/domains/remove', () => {
        removeCalls += 1;
        return HttpResponse.json({ ok: true, data: { domain: 'shop.acme.com', removed: 1 } });
      }),
    );

    await renderDomains();
    await userEvent.click(await screen.findByRole('button', { name: 'remove' }));
    const dialog = await screen.findByRole('dialog');
    expect(removeCalls).toBe(0);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await screen.findByText('shop.acme.com');
    expect(removeCalls).toBe(1);
  });
});
