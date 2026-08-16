import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { NotFoundPage } from './NotFoundPage.js';

describe('NotFoundPage', () => {
  it('offers a Polish route back to documents', async () => {
    const root = createRootRoute();
    const missing = createRoute({
      getParentRoute: () => root,
      path: '/app/missing',
      component: NotFoundPage,
    });
    const documents = createRoute({
      getParentRoute: () => root,
      path: '/app/documents',
      component: () => <p>Lista dokumentów</p>,
    });
    const router = createRouter({
      routeTree: root.addChildren([missing, documents]),
      history: createMemoryHistory({ initialEntries: ['/app/missing'] }),
    });
    await router.load();
    renderWithProviders(<RouterProvider router={router} />);

    expect(
      screen.getByRole('heading', { name: 'Nie znaleziono strony' }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('link', { name: 'Wróć do dokumentów' }),
    );
    expect(await screen.findByText('Lista dokumentów')).toBeInTheDocument();
  });
});
