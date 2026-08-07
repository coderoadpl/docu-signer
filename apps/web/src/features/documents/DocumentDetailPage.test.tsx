import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { DocumentDetailPage } from './DocumentDetailPage.js';

const files = [
  {
    id: 'source-1',
    documentId: 'document-1',
    role: 'source',
    fileName: 'oryginal.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1024,
    storageKey: 'source-key',
    createdAt: '2026-07-18T10:00:00.000Z',
  },
  {
    id: 'scan-1',
    documentId: 'document-1',
    role: 'signed-scan',
    fileName: 'podpisany-skan.pdf',
    contentType: 'application/pdf',
    sizeBytes: 2048,
    storageKey: 'scan-key',
    createdAt: '2026-07-19T10:00:00.000Z',
  },
];

const document = {
  id: 'document-1',
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
  const root = createRootRoute({ component: () => <DocumentDetailPage documentId="document-1" /> });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/documents/document-1'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('DocumentDetailPage', () => {
  it('groups files by role and asks before deleting a file', async () => {
    const remove = vi.fn();
    server.use(
      http.get('/api/documents/document-1', () =>
        HttpResponse.json({ ok: true, data: { document } }),
      ),
      http.delete('/api/documents/document-1/files/source-1', () => {
        remove();
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );
    await renderPage();

    expect(await screen.findByText('oryginal.pdf')).toBeInTheDocument();
    expect(screen.getByText('podpisany-skan.pdf')).toBeInTheDocument();
    expect(screen.getAllByText(/Podpisany skan/).length).toBeGreaterThan(0);

    const deleteButton = screen.getAllByRole('button', { name: 'Usuń' }).at(0);
    if (!deleteButton) throw new Error('Missing delete file button');
    await userEvent.click(deleteButton);
    expect(screen.getByRole('heading', { name: 'Usunąć plik?' })).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Usuń' }));

    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
  });

  it('edits metadata, cancels document deletion, and uploads through the server fallback', async () => {
    const update = vi.fn();
    const upload = vi.fn();
    const directUpload = vi.fn();
    const finalize = vi.fn();
    server.use(
      http.get('/api/documents/document-1', () =>
        HttpResponse.json({ ok: true, data: { document } }),
      ),
      http.patch('/api/documents/document-1', async ({ request }) => {
        update(await request.json());
        return HttpResponse.json({ ok: true, data: { document } });
      }),
      http.post('/api/documents/document-1/files/upload-request', async ({ request }) => {
        const body = await request.json();
        if (typeof body === 'object' && body && 'role' in body && body.role === 'signed-scan') {
          return HttpResponse.json({
            ok: true,
            data: {
              upload: {
                kind: 'direct',
                key: 'direct-key',
                target: { url: 'http://localhost/direct-upload', method: 'PUT', headers: {} },
              },
            },
          });
        }
        return HttpResponse.json({ ok: true, data: { upload: { kind: 'server', key: 'server-key' } } });
      }),
      http.post('/api/documents/document-1/files/upload', () => {
        upload();
        return HttpResponse.json({ ok: true, data: { file: files[0] } });
      }),
      http.put('http://localhost/direct-upload', () => {
        directUpload();
        return new HttpResponse(null, { status: 200 });
      }),
      http.post('/api/documents/document-1/files/finalize', () => {
        finalize();
        return HttpResponse.json({ ok: true, data: { file: files[1] } });
      }),
    );
    await renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Edytuj' }));
    const editDialog = screen.getByRole('dialog');
    const title = within(editDialog).getByRole('textbox', { name: 'Tytuł' });
    await userEvent.clear(title);
    await userEvent.type(title, 'Zmieniony tytuł');
    await userEvent.click(within(editDialog).getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edytuj dokument' })).not.toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Usuń dokument' }));
    const deleteDialog = screen.getByRole('dialog');
    await userEvent.click(within(deleteDialog).getByRole('button', { name: 'Anuluj' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Usunąć dokument?' })).not.toBeInTheDocument(),
    );

    const uploadButtons = screen.getAllByRole('button', { name: 'Wgraj plik' });
    const sourceUpload = uploadButtons.at(0);
    if (!sourceUpload) throw new Error('Missing source upload button');
    const input = sourceUpload.querySelector('input');
    if (!(input instanceof HTMLInputElement)) throw new Error('Missing source file input');
    await userEvent.upload(input, new File([new Uint8Array([1, 2, 3])], 'nowy.pdf', { type: 'application/pdf' }));

    await waitFor(() => expect(upload).toHaveBeenCalledOnce());

    const scanUpload = uploadButtons.at(1);
    if (!scanUpload) throw new Error('Missing scan upload button');
    const scanInput = scanUpload.querySelector('input');
    if (!(scanInput instanceof HTMLInputElement)) throw new Error('Missing scan file input');
    await userEvent.upload(
      scanInput,
      new File([new Uint8Array([4, 5])], 'skan.jpg', { type: 'image/jpeg' }),
    );
    await waitFor(() => expect(directUpload).toHaveBeenCalledOnce());
    expect(finalize).toHaveBeenCalledOnce();
  });

  it('renders missing optional metadata and an empty preview cleanly', async () => {
    server.use(
      http.get('/api/documents/document-1', () =>
        HttpResponse.json({
          ok: true,
          data: { document: { ...document, person: undefined, tags: [], files: [] } },
        }),
      ),
    );
    await renderPage();

    expect(await screen.findByText(/Bez przypisanej osoby/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Podgląd' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Brak plików w tej sekcji.')).toHaveLength(4);
  });
});
