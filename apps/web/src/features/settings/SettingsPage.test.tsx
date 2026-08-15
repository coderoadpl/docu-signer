import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { SettingsPage } from './SettingsPage.js';

describe('SettingsPage', () => {
  it('contains account security and organization settings', async () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getByRole('heading', { name: 'Konto', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/^Profil$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Hasło$/i)).toBeInTheDocument();
    expect(screen.getByText(/uwierzytelnianie dwuskładnikowe/i)).toBeInTheDocument();
    expect(screen.getByText(/klucze dostępu/i)).toBeInTheDocument();
    expect(screen.getByText(/tokeny API/i)).toBeInTheDocument();
    expect(screen.getByText(/ustawienia organizacji/i)).toBeInTheDocument();
    expect(screen.getByText(/^Zaproszenia$/i)).toBeInTheDocument();
    expect(
      await screen.findByRole('switch', { name: /przechowuj zapis podpisów/i }),
    ).toBeChecked();
    expect(screen.queryByText(/firma/i)).not.toBeInTheDocument();
  });
});
