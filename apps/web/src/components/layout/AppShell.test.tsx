import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { AppShell } from './AppShell.js';

describe('AppShell', () => {
  it('renders chrome slots and page content', () => {
    render(
      <AppShell
        brand={<span>brand</span>}
        context={<span>context</span>}
        meta={<span>meta</span>}
        actions={<button type="button">action</button>}
        navigation={<a href="/next">next</a>}
      >
        <p>page content</p>
      </AppShell>,
    );

    expect(screen.getAllByText('brand')).toHaveLength(2);
    expect(screen.getByRole('banner')).toHaveTextContent('contextmetaaction');
    expect(screen.getByRole('navigation')).toContainElement(screen.getByRole('link', { name: 'next' }));
    expect(screen.getByRole('main')).toHaveTextContent('page content');
  });

  it('opens the temporary navigation drawer from the mobile menu button', async () => {
    render(
      <AppShell
        brand={<span>brand</span>}
        navigation={<a href="/next">next</a>}
      >
        <p>page content</p>
      </AppShell>,
    );

    expect(screen.getAllByRole('navigation')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Otwórz nawigację' }));

    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('navigation')).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Zamknij nawigację' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
  });

  it('keeps a non-happy state inside the shell width', () => {
    render(
      <AppShell
        brand={<span>brand</span>}
        navigation={<a href="/next">next</a>}
        state={{ kind: 'loading', label: 'Ładowanie aplikacji…' }}
      >
        <p>page content</p>
      </AppShell>,
    );

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByTestId('app-shell-status')).toHaveStyle({ maxWidth: '44rem' });
    expect(screen.getByText('Ładowanie aplikacji…')).toBeInTheDocument();
    expect(screen.queryByText('page content')).not.toBeInTheDocument();
  });
});
