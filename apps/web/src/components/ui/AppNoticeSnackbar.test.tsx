import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { appNoticeStore } from '../../lib/app-notice.js';
import { AppNoticeSnackbar } from './AppNoticeSnackbar.js';

describe('AppNoticeSnackbar', () => {
  it('survives route-level producers and can be dismissed', async () => {
    render(<AppNoticeSnackbar />);
    act(() => appNoticeStore.show('Nie udało się zachować zapisu podpisu.'));
    expect(await screen.findByText(/nie udało się zachować/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(appNoticeStore.snapshot()).toBeNull();
  });
});
