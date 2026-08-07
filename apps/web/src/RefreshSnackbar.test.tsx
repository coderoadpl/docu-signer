import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RefreshSnackbar } from './RefreshSnackbar.js';
import { refreshToastStore } from './refresh-toast.js';

afterEach(() => act(() => refreshToastStore.dismiss()));

describe('RefreshSnackbar', () => {
  it('renders nothing while there is no toast', () => {
    render(<RefreshSnackbar />);

    expect(screen.queryByText(/couldn't refresh/)).not.toBeInTheDocument();
  });

  it('shows the refresh-failure notice pushed from the store', async () => {
    render(<RefreshSnackbar />);

    act(() => refreshToastStore.show('server exploded'));

    expect(await screen.findByText("couldn't refresh — server exploded")).toBeInTheDocument();
  });
});
