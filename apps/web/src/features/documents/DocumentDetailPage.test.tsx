import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { DocumentDetailPage } from './DocumentDetailPage.js';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SCAN_ID = '33333333-3333-4333-8333-333333333333';

const files = [
  {
    id: SOURCE_ID,
    documentId: DOCUMENT_ID,
    role: 'source',
    fileName: 'oryginal.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1024,
    storageKey: 'source-key',
    createdAt: '2026-07-18T10:00:00.000Z',
  },
  {
    id: SCAN_ID,
    documentId: DOCUMENT_ID,
    role: 'signed-scan',
    fileName: 'podpisany-skan.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 2048,
    storageKey: 'scan-key',
    createdAt: '2026-07-19T10:00:00.000Z',
  },
];

const document = {
  id: DOCUMENT_ID,
  tenantId: 'tenant-1',
  title: 'Umowa z Anną',
  docType: 'umowa-uod',
  documentDate: '2026-07-18',
  person: 'Anna Nowak',
  tags: ['ważne'],
  createdAt: '2026-07-18T10:00:00.000Z',
  updatedAt: '2026-07-18T10:00:00.000Z',
  files,
};

const renderPage = async () => {
  const root = createRootRoute();
  const detail = createRoute({
    getParentRoute: () => root,
    path: '/app/documents/$id',
    component: () => <DocumentDetailPage documentId={DOCUMENT_ID} />,
  });
  const list = createRoute({
    getParentRoute: () => root,
    path: '/app/documents',
    component: () => <p>Lista dokumentów</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([detail, list]),
    history: createMemoryHistory({
      initialEntries: [`/app/documents/${DOCUMENT_ID}`],
    }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('DocumentDetailPage', () => {
  it('surfaces a failed document query and retries it', async () => {
    const requests = vi.fn();
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () => {
        requests();
        return requests.mock.calls.length === 1
          ? HttpResponse.json(
              {
                ok: false,
                error: { code: 'internal', message: 'Nie udało się pobrać dokumentu' },
              },
              { status: 500 },
            )
          : HttpResponse.json({ ok: true, data: { document } });
      }),
    );
    await renderPage();

    expect(
      await screen.findByText('Nie udało się pobrać dokumentu'),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Spróbuj ponownie' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Umowa z Anną' }),
    ).toBeInTheDocument();
    expect(requests).toHaveBeenCalledTimes(2);
  });

  it('groups files by role and asks before deleting a file', async () => {
    const remove = vi.fn();
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({ ok: true, data: { document } }),
      ),
      http.delete(
        `/api/documents/${DOCUMENT_ID}/files/${SOURCE_ID}`,
        () => {
          remove();
          return HttpResponse.json({
            ok: true,
            data: { deleted: true },
          });
        },
      ),
    );
    await renderPage();

    expect(await screen.findByText('oryginal.pdf')).toBeInTheDocument();
    expect(screen.getByText('podpisany-skan.jpg')).toBeInTheDocument();
    expect(screen.getAllByText(/Podpisany skan/).length).toBeGreaterThan(0);
    expect(
      screen.getByRole('img', { name: 'Podgląd: podpisany-skan.jpg' }),
    ).toHaveAttribute(
      'src',
      `/api/documents/${DOCUMENT_ID}/files/${SCAN_ID}/content`,
    );
    expect(
      screen.getAllByRole('link', { name: 'Eksportuj' }).at(0),
    ).toHaveAttribute(
      'href',
      `/api/documents/${DOCUMENT_ID}/files/${SOURCE_ID}/export`,
    );
    expect(screen.getAllByRole('button', { name: 'Podpisz' })).toHaveLength(1);

    const deleteButton = screen
      .getAllByRole('button', { name: 'Usuń' })
      .at(0);
    if (!deleteButton) throw new Error('Missing delete file button');
    await userEvent.click(deleteButton);
    expect(
      screen.getByRole('heading', { name: 'Usunąć plik?' }),
    ).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Usuń' }));

    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
  });

  it('edits metadata and uploads through both storage paths', async () => {
    const update = vi.fn();
    const upload = vi.fn();
    const directUpload = vi.fn();
    const finalize = vi.fn();
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({ ok: true, data: { document } }),
      ),
      http.patch(`/api/documents/${DOCUMENT_ID}`, async ({ request }) => {
        update(await request.json());
        return HttpResponse.json({ ok: true, data: { document } });
      }),
      http.post(
        `/api/documents/${DOCUMENT_ID}/files/upload-request`,
        async ({ request }) => {
          const body = await request.json();
          if (
            typeof body === 'object' &&
            body &&
            'role' in body &&
            body.role === 'signed-scan'
          ) {
            return HttpResponse.json({
              ok: true,
              data: {
                upload: {
                  kind: 'direct',
                  key: 'direct-key',
                  target: {
                    url: 'http://localhost/direct-upload',
                    method: 'PUT',
                    headers: {},
                  },
                },
              },
            });
          }
          return HttpResponse.json({
            ok: true,
            data: {
              upload: { kind: 'server', key: 'server-key' },
            },
          });
        },
      ),
      http.post(`/api/documents/${DOCUMENT_ID}/files/upload`, () => {
        upload();
        return HttpResponse.json({
          ok: true,
          data: { file: files[0] },
        });
      }),
      http.put('http://localhost/direct-upload', () => {
        directUpload();
        return new HttpResponse(null, { status: 200 });
      }),
      http.post(`/api/documents/${DOCUMENT_ID}/files/finalize`, () => {
        finalize();
        return HttpResponse.json({
          ok: true,
          data: { file: files[1] },
        });
      }),
    );
    await renderPage();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Edytuj' }),
    );
    const editDialog = screen.getByRole('dialog');
    const title = within(editDialog).getByRole('textbox', { name: 'Tytuł' });
    await userEvent.clear(title);
    await userEvent.type(title, 'Zmieniony tytuł');
    await userEvent.click(
      within(editDialog).getByRole('button', { name: 'Zapisz' }),
    );
    await waitFor(() => expect(update).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Edytuj dokument' }),
      ).not.toBeInTheDocument(),
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Usuń dokument' }),
    );
    const deleteDialog = screen.getByRole('dialog');
    await userEvent.click(
      within(deleteDialog).getByRole('button', { name: 'Anuluj' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Usunąć dokument?' }),
      ).not.toBeInTheDocument(),
    );

    const uploadButtons = screen.getAllByRole('button', {
      name: 'Wgraj plik',
    });
    const sourceInput = uploadButtons.at(0)?.querySelector('input');
    if (!(sourceInput instanceof HTMLInputElement)) {
      throw new Error('Missing source file input');
    }
    await userEvent.upload(
      sourceInput,
      new File([new Uint8Array([1, 2, 3])], 'nowy.pdf', {
        type: 'application/pdf',
      }),
    );
    await waitFor(() => expect(upload).toHaveBeenCalledOnce());

    const scanInput = uploadButtons.at(1)?.querySelector('input');
    if (!(scanInput instanceof HTMLInputElement)) {
      throw new Error('Missing scan file input');
    }
    await userEvent.upload(
      scanInput,
      new File([new Uint8Array([4, 5])], 'skan.jpg', {
        type: 'image/jpeg',
      }),
    );
    await waitFor(() => expect(directUpload).toHaveBeenCalledOnce());
    expect(finalize).toHaveBeenCalledOnce();
  });

  it('renders missing metadata and empty file groups cleanly', async () => {
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({
          ok: true,
          data: {
            document: { ...document, person: null, tags: [], files: [] },
          },
        }),
      ),
    );
    await renderPage();

    expect(
      await screen.findByText(/Bez przypisanej osoby/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Podgląd' }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('Brak plików w tej sekcji.')).toHaveLength(4);
  });

  it('navigates before invalidating after deleting a document', async () => {
    const detailRequests = vi.fn();
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () => {
        detailRequests();
        return HttpResponse.json({ ok: true, data: { document } });
      }),
      http.delete(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({ ok: true, data: { deleted: true } }),
      ),
    );
    await renderPage();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Usuń dokument' }),
    );
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Usuń' }),
    );

    expect(await screen.findByText('Lista dokumentów')).toBeInTheDocument();
    expect(detailRequests).toHaveBeenCalledOnce();
  });
});
