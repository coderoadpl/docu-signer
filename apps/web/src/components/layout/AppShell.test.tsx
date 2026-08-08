import { render, screen } from '@testing-library/react';
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

    expect(screen.getByRole('banner')).toHaveTextContent('brandcontextmetaaction');
    expect(screen.getByRole('navigation')).toContainElement(screen.getByRole('link', { name: 'next' }));
    expect(screen.getByRole('main')).toHaveTextContent('page content');
  });

  it('keeps a non-happy state inside the shell width', () => {
    render(
      <AppShell
        brand={<span>brand</span>}
        navigation={<a href="/next">next</a>}
        state={{ kind: 'loading', label: 'opening the app…' }}
      >
        <p>page content</p>
      </AppShell>,
    );

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByTestId('app-shell-status')).toHaveStyle({ maxWidth: '44rem' });
    expect(screen.getByText('opening the app…')).toBeInTheDocument();
    expect(screen.queryByText('page content')).not.toBeInTheDocument();
  });
});
