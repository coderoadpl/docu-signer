import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { CreateTenantForm } from './CreateTenantForm.js';

const tenantBodySchema = z.object({ name: z.string(), slug: z.string() });

describe('CreateTenantForm', () => {
  it('previews the canonical slug live as the name is typed (reusing the slug VO)', async () => {
    renderWithProviders(<CreateTenantForm />);
    await userEvent.type(screen.getByLabelText('New tenant name'), 'Acme  Sp. z o.o.');
    expect(screen.getByTestId('slug-preview')).toHaveTextContent('acme-sp-z-o-o');
  });

  it('submits the name and previewed slug to createTenant and reports the new slug', async () => {
    let created: { name: string; slug: string } | null = null;
    server.use(
      http.post('/api/tenants', async ({ request }) => {
        created = tenantBodySchema.parse(await request.json());
        return HttpResponse.json({ ok: true, data: { tenant: { id: 't9', slug: created.slug, name: created.name } } });
      }),
      http.get('/api/tenants', () => HttpResponse.json({ ok: true, data: { tenants: [] } })),
      http.get('/api/me', () => HttpResponse.json({ ok: true, data: { userId: 'u1', email: 'e', name: 'n', tenant: null } })),
    );

    let onCreatedSlug: string | null = null;
    renderWithProviders(<CreateTenantForm onCreated={(slug) => (onCreatedSlug = slug)} />);
    await userEvent.type(screen.getByLabelText('New tenant name'), 'Globex Corp');
    await userEvent.click(screen.getByRole('button', { name: 'create tenant' }));

    await screen.findByRole('button', { name: 'create tenant' });
    expect(created).toEqual({ name: 'Globex Corp', slug: 'globex-corp' });
    expect(onCreatedSlug).toBe('globex-corp');
  });

  it('surfaces a conflict error from the server', async () => {
    server.use(
      http.post('/api/tenants', () =>
        HttpResponse.json({ ok: false, error: { code: 'conflict', message: 'Tenant "globex" already exists' } }, { status: 409 }),
      ),
    );

    renderWithProviders(<CreateTenantForm />);
    await userEvent.type(screen.getByLabelText('New tenant name'), 'Globex');
    await userEvent.click(screen.getByRole('button', { name: 'create tenant' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  });
});
