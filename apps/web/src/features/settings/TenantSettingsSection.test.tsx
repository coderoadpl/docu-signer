import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { TenantSettingsSection } from './TenantSettingsSection.js';

describe('TenantSettingsSection', () => {
  it('renders the stored state and persists switch changes', async () => {
    const update = vi.fn();
    server.use(
      http.get('*/api/tenant-settings', () =>
        HttpResponse.json({
          ok: true,
          data: {
            settings: {
              tenantId: 'tenant-default',
              storeSignatureRecords: false,
              pdfSealEnabled: false,
              dateMode: 'declared',
            },
          },
        }),
      ),
      http.put('*/api/tenant-settings', async ({ request }) => {
        const body = await request.json();
        update(body);
        return HttpResponse.json({
          ok: true,
          data: {
            settings: {
              tenantId: 'tenant-default',
              storeSignatureRecords: true,
              pdfSealEnabled: true,
              dateMode: 'actual',
            },
          },
        });
      }),
    );

    renderWithProviders(<TenantSettingsSection />);
    const toggle = await screen.findByRole('switch', {
      name: /przechowuj zapis podpisów/i,
    });
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(toggle).toBeEnabled();
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ storeSignatureRecords: true }),
    );

    const seal = screen.getByRole('switch', { name: /pieczęć cyfrowa pdf/i });
    await userEvent.click(seal);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ pdfSealEnabled: true }));

    await userEvent.click(screen.getByRole('combobox', { name: 'Tryb dat' }));
    await userEvent.click(screen.getByRole('option', { name: /daty rzeczywiste/i }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ dateMode: 'actual' }));
  });
});
