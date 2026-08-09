import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { SettingsPage } from './SettingsPage.js';

describe('SettingsPage', () => {
  it('contains only account security settings', async () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getByRole('heading', { name: 'Konto', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/^Hasło$/i)).toBeInTheDocument();
    expect(screen.getByText(/uwierzytelnianie dwuskładnikowe/i)).toBeInTheDocument();
    expect(screen.getByText(/klucze dostępu/i)).toBeInTheDocument();
    expect(screen.getByText(/tokeny API/i)).toBeInTheDocument();
    expect(screen.queryByText(/firma/i)).not.toBeInTheDocument();
  });
});
