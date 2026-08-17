import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { DocumentDetailPage } from './DocumentDetailPage.js';
import { documentsSearchSchema } from './documents.logic.js';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SCAN_ID = '33333333-3333-4333-8333-333333333333';
const SIGNED_ID = '44444444-4444-4444-8444-444444444444';
const RELATED_ID = '55555555-5555-4555-8555-555555555555';

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
  {
    id: SIGNED_ID,
    documentId: DOCUMENT_ID,
    role: 'signed-digital',
    fileName: 'oryginal-podpisany.pdf',
    contentType: 'application/pdf',
    sizeBytes: 3072,
    storageKey: 'signed-key',
    createdAt: '2026-07-20T10:00:00.000Z',
  },
];

const document = {
  id: DOCUMENT_ID,
  tenantId: 'tenant-1',
  title: 'Umowa z Anną',
  docType: 'umowa-uod',
  documentDate: '2026-07-18',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
  person: 'Anna Nowak',
  tags: ['ważne'],
  createdAt: '2026-07-18T10:00:00.000Z',
  updatedAt: '2026-07-18T10:00:00.000Z',
  signers: [],
  files,
};

const renderPage = async (
  documentList = [document],
  initialEntry = `/app/documents/${DOCUMENT_ID}`,
) => {
  server.use(
    http.get('/api/documents', () =>
      HttpResponse.json({ ok: true, data: { documents: documentList } }),
    ),
  );
  const root = createRootRoute();
  const detail = createRoute({
    getParentRoute: () => root,
    path: '/app/documents/$id',
    validateSearch: documentsSearchSchema,
    component: () => <DocumentDetailPage documentId={DOCUMENT_ID} />,
  });
  const list = createRoute({
    getParentRoute: () => root,
    path: '/app/documents',
    validateSearch: documentsSearchSchema,
    component: () => <p>Lista dokumentów</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([detail, list]),
    history: createMemoryHistory({
      initialEntries: [initialEntry],
    }),
  });
  await router.load();
  return { router, ...renderWithProviders(<RouterProvider router={router} />) };
};

describe('DocumentDetailPage', () => {
  it('shows pending metadata diffs and approves or rejects each proposal', async () => {
    const approve = vi.fn();
    const reject = vi.fn();
    const firstId = '61616161-6161-4161-8161-616161616161';
    const secondId = '62626262-6262-4262-8262-626262626262';
    let proposals = [
      {
        id: firstId,
        tenantId: 'tenant-1',
        documentId: DOCUMENT_ID,
        changes: { title: 'Nowy tytuł', person: null, tags: ['ważne', 'pilne'] },
        creator: { accountId: 'user-importer', name: 'Importer' },
        createdAt: '2026-08-16T10:00:00.000Z',
      },
      {
        id: secondId,
        tenantId: 'tenant-1',
        documentId: DOCUMENT_ID,
        changes: { documentDate: '2026-08-20' },
        creator: { accountId: 'user-importer', name: 'Importer' },
        createdAt: '2026-08-16T11:00:00.000Z',
      },
    ];
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({
          ok: true,
          data: {
            document: {
              ...document,
              pendingDrafts: { comments: 0, links: 0, metadataProposals: proposals.length },
            },
          },
        }),
      ),
      http.get(`/api/documents/${DOCUMENT_ID}/metadata-proposals`, () =>
        HttpResponse.json({ ok: true, data: { items: proposals, nextCursor: null } }),
      ),
      http.post(`/api/document-metadata-proposals/${firstId}/approve`, () => {
        approve();
        proposals = proposals.filter((proposal) => proposal.id !== firstId);
        return HttpResponse.json({ ok: true, data: { document: { ...document, title: 'Nowy tytuł' } } });
      }),
      http.post(`/api/document-metadata-proposals/${secondId}/reject`, () => {
        reject();
        proposals = proposals.filter((proposal) => proposal.id !== secondId);
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );
    await renderPage();

    expect(
      await screen.findByLabelText('2 propozycje zmian'),
    ).toBeInTheDocument();
    expect(screen.getByText('Umowa z Anną → Nowy tytuł')).toBeInTheDocument();
    expect(screen.getByText('Anna Nowak → Brak')).toBeInTheDocument();
    expect(screen.getByText('ważne → ważne, pilne')).toBeInTheDocument();
    const firstRow = screen.getByText('Umowa z Anną → Nowy tytuł').closest('li');
    if (!firstRow) throw new Error('Proposal row was not rendered');
    await userEvent.click(within(firstRow).getByRole('button', { name: 'Zatwierdź' }));
    await waitFor(() => expect(approve).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.queryByText('Umowa z Anną → Nowy tytuł')).not.toBeInTheDocument(),
    );

    const secondRow = screen.getByText('18.07.2026 → 20.08.2026').closest('li');
    if (!secondRow) throw new Error('Proposal row was not rendered');
    await userEvent.click(within(secondRow).getByRole('button', { name: 'Odrzuć' }));
    await waitFor(() => expect(reject).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Proponowane zmiany' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('renders, adds, and restricts comment deletion to the current user', async () => {
    const ownCommentId = '67676767-6767-4767-8767-676767676767';
    const foreignCommentId = '68686868-6868-4868-8868-686868686868';
    const addedCommentId = '69696969-6969-4969-8969-696969696969';
    const createdAt = new Date(2026, 7, 16, 14, 5).toISOString();
    const add = vi.fn();
    const remove = vi.fn();
    let comments = [
      {
        id: ownCommentId,
        tenantId: 'tenant-1',
        documentId: DOCUMENT_ID,
        author: { accountId: 'user-owner', name: 'Owner' },
        body: 'Pierwsza linia\nDruga linia',
        createdAt,
      },
      {
        id: foreignCommentId,
        tenantId: 'tenant-1',
        documentId: DOCUMENT_ID,
        author: { accountId: 'user-other', name: 'Anna Nowak' },
        body: 'Komentarz Anny',
        createdAt,
      },
    ];
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({ ok: true, data: { document } }),
      ),
      http.get(`/api/documents/${DOCUMENT_ID}/comments`, () =>
        HttpResponse.json({ ok: true, data: { items: comments, nextCursor: null } }),
      ),
      http.post(`/api/documents/${DOCUMENT_ID}/comments`, async ({ request }) => {
        const body: unknown = await request.json();
        add(body);
        if (
          typeof body !== 'object' ||
          body === null ||
          !('body' in body) ||
          typeof body.body !== 'string'
        ) {
          return HttpResponse.json(
            { ok: false, error: { code: 'validation', message: 'Invalid comment' } },
            { status: 400 },
          );
        }
        const comment = {
          id: addedCommentId,
          tenantId: 'tenant-1',
          documentId: DOCUMENT_ID,
          author: { accountId: 'user-owner', name: 'Owner' },
          body: body.body.trim(),
          createdAt,
        };
        comments = [...comments, comment];
        return HttpResponse.json({ ok: true, data: { comment } });
      }),
      http.delete(`/api/documents/${DOCUMENT_ID}/comments/${ownCommentId}`, () => {
        remove();
        comments = comments.filter((comment) => comment.id !== ownCommentId);
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );
    await renderPage();

    expect(await screen.findByRole('heading', { name: 'Komentarze' })).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getAllByText('Anna Nowak')).toHaveLength(2);
    expect(screen.getAllByText('16.08.2026 14:05')).toHaveLength(2);
    const preservedBody = screen.getByText(/Pierwsza linia/u);
    expect(preservedBody).toHaveStyle({ whiteSpace: 'pre-wrap' });
    expect(screen.getByLabelText(`Usuń komentarz ${ownCommentId}`)).toBeInTheDocument();
    expect(screen.queryByLabelText(`Usuń komentarz ${foreignCommentId}`)).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox', { name: 'Komentarz' }), 'Nowy komentarz');
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj komentarz' }));
    await waitFor(() => expect(add).toHaveBeenCalledWith({ body: 'Nowy komentarz' }));
    expect(await screen.findByText('Nowy komentarz')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(`Usuń komentarz ${ownCommentId}`));
    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
  });

  it('renders related documents with labels and removes a link', async () => {
    const remove = vi.fn();
    let links = [
      {
        linkId: '66666666-6666-4666-8666-666666666666',
        label: 'podstawa',
        document: {
          ...document,
          id: RELATED_ID,
          title: 'Umowa ramowa',
          files: undefined,
          signers: undefined,
          deletedAt: '2026-08-16T12:00:00.000Z',
        },
      },
    ];
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({ ok: true, data: { document } }),
      ),
      http.get(`/api/documents/${DOCUMENT_ID}/links`, () =>
        HttpResponse.json({ ok: true, data: { links } }),
      ),
      http.delete(`/api/documents/${DOCUMENT_ID}/links/${RELATED_ID}`, () => {
        remove();
        links = [];
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );
    await renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Powiązane dokumenty' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Umowa ramowa')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Umowa ramowa/u })).toHaveAttribute(
      'href',
      `/app/documents/${RELATED_ID}`,
    );
    expect(screen.getByText('podstawa')).toBeInTheDocument();
    expect(screen.getByText('W koszu')).toBeInTheDocument();
    const linkedRow = screen.getByText('Umowa ramowa').closest('li');
    expect(linkedRow).not.toBeNull();
    if (!linkedRow) throw new Error('Related-document row was not rendered');
    await userEvent.click(within(linkedRow).getByRole('button', { name: 'Usuń' }));
    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByText('Umowa ramowa')).not.toBeInTheDocument());
  });

  it('renders draft annotation chips and approves links and comments', async () => {
    const linkId = '66666666-6666-4666-8666-666666666666';
    const commentId = '67676767-6767-4767-8767-676767676767';
    const approveLink = vi.fn();
    const approveComment = vi.fn();
    let linkDraft = true;
    let commentDraft = true;
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({ ok: true, data: { document } }),
      ),
      http.get(`/api/documents/${DOCUMENT_ID}/links`, () =>
        HttpResponse.json({
          ok: true,
          data: {
            links: [{
              linkId,
              label: null,
              draft: linkDraft,
              document: {
                ...document,
                id: RELATED_ID,
                title: 'Umowa ramowa',
                files: undefined,
                signers: undefined,
              },
            }],
          },
        }),
      ),
      http.get(`/api/documents/${DOCUMENT_ID}/comments`, () =>
        HttpResponse.json({
          ok: true,
          data: {
            items: [{
              id: commentId,
              tenantId: 'tenant-1',
              documentId: DOCUMENT_ID,
              author: { accountId: 'user-other', name: 'Anna Nowak' },
              body: 'Komentarz do zatwierdzenia',
              draft: commentDraft,
              createdAt: '2026-08-16T12:00:00.000Z',
            }],
            nextCursor: null,
          },
        }),
      ),
      http.post(`/api/document-links/${linkId}/approve`, () => {
        approveLink();
        linkDraft = false;
        return HttpResponse.json({
          ok: true,
          data: {
            link: {
              id: linkId,
              tenantId: 'tenant-1',
              fromDocumentId: DOCUMENT_ID,
              toDocumentId: RELATED_ID,
              label: null,
              draft: false,
            },
          },
        });
      }),
      http.post(`/api/document-comments/${commentId}/approve`, () => {
        approveComment();
        commentDraft = false;
        return HttpResponse.json({
          ok: true,
          data: {
            comment: {
              id: commentId,
              tenantId: 'tenant-1',
              documentId: DOCUMENT_ID,
              author: { accountId: 'user-other', name: 'Anna Nowak' },
              body: 'Komentarz do zatwierdzenia',
              draft: false,
              createdAt: '2026-08-16T12:00:00.000Z',
            },
          },
        });
      }),
    );
    await renderPage();

    const linkedRow = (await screen.findByText('Umowa ramowa')).closest('li');
    const commentRow = screen.getByText('Komentarz do zatwierdzenia').closest('li');
    expect(linkedRow).not.toBeNull();
    expect(commentRow).not.toBeNull();
    if (!linkedRow || !commentRow) throw new Error('Draft annotation rows were not rendered');
    expect(within(linkedRow).getByText('Szkic')).toBeInTheDocument();
    expect(within(commentRow).getByText('Szkic')).toBeInTheDocument();

    await userEvent.click(within(linkedRow).getByRole('button', { name: 'Zatwierdź' }));
    await waitFor(() => expect(approveLink).toHaveBeenCalledOnce());
    await waitFor(() => expect(within(linkedRow).queryByText('Szkic')).not.toBeInTheDocument());

    await userEvent.click(within(commentRow).getByRole('button', { name: 'Zatwierdź' }));
    await waitFor(() => expect(approveComment).toHaveBeenCalledOnce());
    await waitFor(() => expect(within(commentRow).queryByText('Szkic')).not.toBeInTheDocument());
  });

  it('refreshes document lists when the last draft comment is approved', async () => {
    const commentId = '67676767-6767-4767-8767-676767676767';
    let commentDraft = true;
    const comment = {
      id: commentId,
      tenantId: 'tenant-1',
      documentId: DOCUMENT_ID,
      author: { accountId: 'user-other', name: 'Anna Nowak' },
      body: 'Komentarz do zatwierdzenia',
      createdAt: '2026-08-16T12:00:00.000Z',
    };
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({
          ok: true,
          data: {
            document: {
              ...document,
              pendingDrafts: {
                comments: commentDraft ? 1 : 0,
                links: 0,
                metadataProposals: 0,
              },
            },
          },
        }),
      ),
      http.get(`/api/documents/${DOCUMENT_ID}/comments`, () =>
        HttpResponse.json({
          ok: true,
          data: { items: [{ ...comment, draft: commentDraft }], nextCursor: null },
        }),
      ),
      http.post(`/api/document-comments/${commentId}/approve`, () => {
        commentDraft = false;
        return HttpResponse.json({
          ok: true,
          data: { comment: { ...comment, draft: false } },
        });
      }),
    );
    await renderPage();

    expect(await screen.findByLabelText('1 komentarz-szkic')).toBeInTheDocument();
    const listRequests = vi.fn();
    server.use(
      http.get('/api/documents', () => {
        listRequests();
        return HttpResponse.json({ ok: true, data: { documents: [] } });
      }),
    );

    const commentRow = screen.getByText('Komentarz do zatwierdzenia').closest('li');
    if (!commentRow) throw new Error('Draft comment row was not rendered');
    await userEvent.click(within(commentRow).getByRole('button', { name: 'Zatwierdź' }));

    await waitFor(() => expect(listRequests).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByLabelText('1 komentarz-szkic')).not.toBeInTheDocument(),
    );
  });

  it('renders the related-documents section after every other section', async () => {
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({ ok: true, data: { document } }),
      ),
      http.get(`/api/documents/${DOCUMENT_ID}/metadata-proposals`, () =>
        HttpResponse.json({ ok: true, data: { items: [], nextCursor: null } }),
      ),
    );
    await renderPage();

    await screen.findByRole('heading', { name: 'Powiązane dokumenty' });
    const sections = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);
    expect(sections).toEqual(['Komentarze', 'Pliki', 'Powiązane dokumenty']);
    expect(
      screen.queryByRole('heading', { name: 'Proponowane zmiany' }),
    ).not.toBeInTheDocument();
  });

  it('keeps draft chips visible without approval buttons when approval is unavailable', async () => {
    server.use(
      http.get('/api/me', () =>
        HttpResponse.json({
          ok: true,
          data: {
            userId: 'visitor',
            email: 'visitor@example.com',
            name: 'Visitor',
            tenant: null,
          },
        }),
      ),
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({ ok: true, data: { document } }),
      ),
      http.get(`/api/documents/${DOCUMENT_ID}/links`, () =>
        HttpResponse.json({
          ok: true,
          data: {
            links: [{
              linkId: '66666666-6666-4666-8666-666666666666',
              label: null,
              draft: true,
              document: {
                ...document,
                id: RELATED_ID,
                title: 'Umowa ramowa',
                files: undefined,
                signers: undefined,
              },
            }],
          },
        }),
      ),
    );
    await renderPage();

    const linkedRow = (await screen.findByText('Umowa ramowa')).closest('li');
    expect(linkedRow).not.toBeNull();
    if (!linkedRow) throw new Error('Draft link row was not rendered');
    expect(within(linkedRow).getByText('Szkic')).toBeInTheDocument();
    expect(within(linkedRow).queryByRole('button', { name: 'Zatwierdź' })).not.toBeInTheDocument();
  });

  it('collapses related documents beyond three entries', async () => {
    const links = [
      ['66666666-6666-4666-8666-666666666661', 'Umowa pierwsza'],
      ['66666666-6666-4666-8666-666666666662', 'Umowa druga'],
      ['66666666-6666-4666-8666-666666666663', 'Umowa trzecia'],
      ['66666666-6666-4666-8666-666666666664', 'Umowa czwarta'],
    ].map(([linkId, title], index) => ({
      linkId,
      label: null,
      document: {
        ...document,
        id: `77777777-7777-4777-8777-77777777777${index}`,
        title,
        files: undefined,
        signers: undefined,
      },
    }));
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({ ok: true, data: { document } }),
      ),
      http.get(`/api/documents/${DOCUMENT_ID}/links`, () =>
        HttpResponse.json({ ok: true, data: { links } }),
      ),
    );
    await renderPage();

    expect(await screen.findByText('Umowa pierwsza')).toBeInTheDocument();
    expect(screen.getByText('Umowa druga')).toBeInTheDocument();
    expect(screen.getByText('Umowa trzecia')).toBeInTheDocument();
    expect(screen.queryByText('Umowa czwarta')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dodaj powiązanie' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Pokaż wszystkie (4)' }));

    expect(screen.getByText('Umowa czwarta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dodaj powiązanie' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zwiń' }));

    expect(screen.queryByText('Umowa czwarta')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pokaż wszystkie (4)' })).toBeInTheDocument();
  });

  it('enables source updates with signature records and shows both dialog choices', async () => {
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({ ok: true, data: { document } }),
      ),
      http.get(`/api/documents/${DOCUMENT_ID}/signature-records`, () =>
        HttpResponse.json({
          ok: true,
          data: {
            items: [
              {
                id: '55555555-5555-4555-8555-555555555555',
                tenantId: 'tenant-1',
                documentId: DOCUMENT_ID,
                fileId: SIGNED_ID,
                signedBy: 'user-owner',
                payload: [
                  {
                    strokes: [{ points: [{ x: 0.1, y: 0.2, pressure: 0.5 }] }],
                    pageIndex: 0,
                    placement: { offsetX: 0, offsetY: 0, scale: 1 },
                    inkColor: 'black',
                    inkSize: 2,
                  },
                ],
                signerBoxEntries: null,
                createdAt: '2026-08-08T10:00:00.000Z',
              },
            ],
            nextCursor: null,
          },
        }),
      ),
    );
    await renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Więcej akcji' }));
    const action = screen.getByRole('menuitem', { name: 'Uaktualnij źródło' });
    expect(action).toBeEnabled();
    await userEvent.click(action);
    const dialog = screen.getByRole('dialog', { name: 'Uaktualnij źródło' });
    expect(within(dialog).getByRole('radio', { name: /Usuń podpisany/u })).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /Przenieś podpisy/u })).toBeInTheDocument();
  });

  it('disables source updates for legacy signed files and explains why', async () => {
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({ ok: true, data: { document } }),
      ),
    );
    await renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Więcej akcji' }));
    const action = screen.getByRole('menuitem', { name: 'Uaktualnij źródło' });
    expect(action).toHaveAttribute('aria-disabled', 'true');
    await userEvent.hover(action.parentElement ?? action);
    expect(
      await screen.findByText(
        'Brak zapisu podpisów — dokumenty podpisane przed włączeniem zapisu wymagają ponownego podpisania.',
      ),
    ).toBeInTheDocument();
  });

  it('shows signer decisions on a pending source update', async () => {
    const decision = vi.fn();
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({ ok: true, data: { document } }),
      ),
      http.get('/api/me', () =>
        HttpResponse.json({
          ok: true,
          data: {
            userId: 'user-signer',
            email: 'signer@example.com',
            name: 'Signer',
            tenant: {
              id: 'tenant-1',
              slug: 'default',
              name: 'Archiwum',
              staffRole: 'admin',
            },
          },
        }),
      ),
      http.get(`/api/documents/${DOCUMENT_ID}/source-update-request`, () =>
        HttpResponse.json({
          ok: true,
          data: {
            request: {
              id: '66666666-6666-4666-8666-666666666666',
              tenantId: 'tenant-1',
              documentId: DOCUMENT_ID,
              requestedBy: 'user-owner',
              newSourceFileId: '77777777-7777-4777-8777-777777777777',
              mode: 'transfer',
              status: 'pending',
              approvals: [
                {
                  id: '88888888-8888-4888-8888-888888888888',
                  approverId: 'user-signer',
                  decision: 'pending',
                },
              ],
            },
          },
        }),
      ),
      http.post('/api/source-update-requests/:requestId/decision', async ({ request }) => {
        decision(await request.json());
        return HttpResponse.json({
          ok: true,
          data: {
            request: {
              id: '66666666-6666-4666-8666-666666666666',
              tenantId: 'tenant-1',
              documentId: DOCUMENT_ID,
              requestedBy: 'user-owner',
              newSourceFileId: '77777777-7777-4777-8777-777777777777',
              mode: 'transfer',
              status: 'rejected',
              approvals: [
                {
                  id: '88888888-8888-4888-8888-888888888888',
                  approverId: 'user-signer',
                  decision: 'rejected',
                },
              ],
            },
          },
        });
      }),
    );
    await renderPage();

    expect(
      await screen.findByText(/oczekuje na akceptację wymaganych podpisujących/u),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zaakceptuj' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Odrzuć' }));
    await waitFor(() => expect(decision).toHaveBeenCalledWith({ decision: 'reject' }));
  });

  it('returns to documents with the preserved list search params', async () => {
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({ ok: true, data: { document } }),
      ),
    );
    const { router } = await renderPage(
      [document],
      `/app/documents/${DOCUMENT_ID}?q=Szkic&szkice=true`,
    );

    expect(await screen.findByRole('heading', { name: 'Umowa z Anną' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '← Dokumenty' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/app/documents'));
    expect(router.state.location.search).toMatchObject({ q: 'Szkic', szkice: true });
  });

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
    expect(screen.getByText('Data podpisania: 18.07.2026')).toBeInTheDocument();
    expect(screen.getByText('Okres: 01.07.2026 - 31.07.2026')).toBeInTheDocument();
    expect(screen.getByText('podpisany-skan.jpg')).toBeInTheDocument();
    expect(screen.queryByText('19.07.2026')).not.toBeInTheDocument();
    expect(screen.getByText('1.0 KB')).toBeInTheDocument();
    expect(screen.getAllByText(/Podpisany skan/).length).toBeGreaterThan(0);
    expect(
      screen.getByLabelText('Podgląd pliku oryginal.pdf'),
    ).toHaveAttribute(
      'href',
      `/api/documents/${DOCUMENT_ID}/files/${SOURCE_ID}/content`,
    );
    expect(
      screen.getByLabelText('Podgląd pliku oryginal.pdf'),
    ).toHaveAttribute('target', '_blank');
    expect(
      screen.getByLabelText('Pobierz plik oryginal.pdf'),
    ).toHaveAttribute(
      'href',
      `/api/documents/${DOCUMENT_ID}/files/${SOURCE_ID}/content`,
    );
    expect(
      screen.queryByRole('heading', { name: 'Podgląd' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Powiązane' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Eksportuj' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Podpisz' })).toHaveLength(2);
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Więcej akcji dla pliku oryginal.pdf',
      }),
    );
    expect(
      screen.getByRole('menuitem', { name: 'Eksportuj' }),
    ).toHaveAttribute(
      'href',
      `/api/documents/${DOCUMENT_ID}/files/${SOURCE_ID}/export`,
    );

    await userEvent.click(screen.getByRole('menuitem', { name: 'Usuń' }));
    expect(
      await screen.findByRole('heading', { name: 'Usunąć plik?' }),
    ).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Usuń' }));

    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
  });

  it('opens seal verification details from the sealed-file chip', async () => {
    const signedFile = files[2];
    if (!signedFile) throw new Error('Missing signed file fixture');
    const sealedFile = { ...signedFile, sealed: true };
    const unsealedFile = {
      ...signedFile,
      id: '55555555-5555-4555-8555-555555555555',
      fileName: 'bez-pieczeci.pdf',
      storageKey: 'unsealed-key',
      sealed: false,
    };
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({
          ok: true,
          data: { document: { ...document, files: [sealedFile, unsealedFile] } },
        }),
      ),
      http.get(`/api/documents/${DOCUMENT_ID}/files/${SIGNED_ID}/seal`, () =>
        HttpResponse.json({
          ok: true,
          data: {
            verification: {
              subject: 'Amazing Company Sp. z o.o. — pieczęć dokumentowa',
              name: 'Amazing Company Sp. z o.o. — pieczęć dokumentowa',
              reason: 'Signed by: Anna Żółć, Marek Nowak',
              declaredAt: '2026-08-16T10:00:00.000Z',
              byteRangeValid: true,
              digestValid: true,
              signatureValid: true,
              integrity: true,
            },
          },
        }),
      ),
    );
    await renderPage();

    const sealedRow = (await screen.findByText(sealedFile.fileName)).closest('li');
    const unsealedRow = screen.getByText(unsealedFile.fileName).closest('li');
    expect(sealedRow).not.toBeNull();
    expect(unsealedRow).not.toBeNull();
    if (!sealedRow || !unsealedRow) return;
    expect(within(sealedRow).getByText('Pieczęć')).toBeInTheDocument();
    expect(within(unsealedRow).queryByText('Pieczęć')).not.toBeInTheDocument();

    await userEvent.click(
      within(sealedRow).getByRole('button', {
        name: `Pokaż szczegóły pieczęci pliku ${sealedFile.fileName}`,
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Szczegóły pieczęci' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Pieczęć jest kryptograficznie poprawna/u)).toBeInTheDocument();
    expect(
      screen.getByText('Amazing Company Sp. z o.o. — pieczęć dokumentowa'),
    ).toBeInTheDocument();
    expect(screen.getByText('16.08.2026')).toBeInTheDocument();
    expect(screen.getByText('Anna Żółć, Marek Nowak')).toBeInTheDocument();
    expect(screen.getByText('Signed by: Anna Żółć, Marek Nowak')).toBeInTheDocument();
    expect(screen.queryByText('2026-08-16T10:00:00.000Z')).not.toBeInTheDocument();
  });

  it('shows the seal verification error inside the dialog', async () => {
    const signedFile = files[2];
    if (!signedFile) throw new Error('Missing signed file fixture');
    const sealedFile = { ...signedFile, sealed: true };
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({
          ok: true,
          data: { document: { ...document, files: [sealedFile] } },
        }),
      ),
      http.get(`/api/documents/${DOCUMENT_ID}/files/${SIGNED_ID}/seal`, () =>
        HttpResponse.json(
          {
            ok: false,
            error: { code: 'validation', message: 'Pieczęć nie może zostać zweryfikowana' },
          },
          { status: 400 },
        ),
      ),
    );
    await renderPage();

    await userEvent.click(
      await screen.findByRole('button', {
        name: `Pokaż szczegóły pieczęci pliku ${sealedFile.fileName}`,
      }),
    );
    expect(
      await screen.findByText(/Pieczęć nie może zostać zweryfikowana/u),
    ).toBeInTheDocument();
  });

  it('names each failed partial seal check in an invalid verdict', async () => {
    const signedFile = files[2];
    if (!signedFile) throw new Error('Missing signed file fixture');
    const sealedFile = { ...signedFile, sealed: true };
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({
          ok: true,
          data: { document: { ...document, files: [sealedFile] } },
        }),
      ),
      http.get(`/api/documents/${DOCUMENT_ID}/files/${SIGNED_ID}/seal`, () =>
        HttpResponse.json({
          ok: true,
          data: {
            verification: {
              subject: 'Amazing Company Sp. z o.o.',
              name: null,
              reason: null,
              declaredAt: '2026-08-16T10:00:00.000Z',
              byteRangeValid: false,
              digestValid: false,
              signatureValid: false,
              integrity: false,
            },
          },
        }),
      ),
    );
    await renderPage();

    await userEvent.click(
      await screen.findByRole('button', {
        name: `Pokaż szczegóły pieczęci pliku ${sealedFile.fileName}`,
      }),
    );
    expect(
      await screen.findByText(
        'Pieczęć jest nieprawidłowa. Nieprawidłowe kontrole: zakres bajtów dokumentu, skrót dokumentu, podpis kryptograficzny.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Brak danych')).toBeInTheDocument();
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
        return HttpResponse.json({
          ok: true,
          data: { outcome: 'updated', document, proposal: null },
        });
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
    fireEvent.change(title, { target: { value: 'Zmieniony tytuł' } });
    await userEvent.click(
      within(editDialog).getByRole('button', { name: 'Zapisz' }),
    );
    await waitFor(() => expect(update).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Edytuj dokument' }),
      ).not.toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Więcej akcji' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Usuń dokument' }));
    const deleteDialog = screen.getByRole('dialog');
    expect(
      within(deleteDialog).getByText('Dokument trafi do kosza. Możesz go później przywrócić.'),
    ).toBeInTheDocument();
    expect(
      within(deleteDialog).getByRole('button', { name: 'Przenieś do kosza' }),
    ).toBeInTheDocument();
    await userEvent.click(
      within(deleteDialog).getByRole('button', { name: 'Anuluj' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Przenieść dokument do kosza?' }),
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

  it('moves a file to a new document from the overflow menu', async () => {
    const move = vi.fn();
    const movedDocument = {
      ...document,
      id: '55555555-5555-4555-8555-555555555555',
      title: 'oryginal',
      docType: 'umowa-uod',
      files: [{ ...files[0], documentId: '55555555-5555-4555-8555-555555555555' }],
    };
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({ ok: true, data: { document } }),
      ),
      http.post(
        `/api/documents/${DOCUMENT_ID}/files/${SOURCE_ID}/move`,
        async ({ request }) => {
          move(await request.json());
          return HttpResponse.json({
            ok: true,
            data: { document: movedDocument },
          });
        },
      ),
    );
    const { router } = await renderPage([
      document,
      {
        ...document,
        id: '66666666-6666-4666-8666-666666666666',
        title: 'Uchwała powiązana',
        docType: 'uchwala',
        files: [],
      },
    ]);

    expect(await screen.findByText('oryginal.pdf')).toBeInTheDocument();
    expect(screen.queryByText('Uchwała powiązana · Uchwała')).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Więcej akcji dla pliku oryginal.pdf',
      }),
    );
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Przenieś do nowego dokumentu' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Przenieś do nowego dokumentu' });
    expect(within(dialog).getByRole('textbox', { name: 'Tytuł' })).toHaveValue('oryginal');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Przenieś' }));

    await waitFor(() =>
      expect(move).toHaveBeenCalledWith({ title: 'oryginal', docType: 'umowa-uod' }),
    );
    expect(router.state.location.pathname).toBe(
      '/app/documents/55555555-5555-4555-8555-555555555555',
    );
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
      await screen.findByText(/Bez przypisanej strony/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Podgląd' }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('Brak plików w tej sekcji.')).toHaveLength(4);
  });

  it('approves a draft document from the banner action', async () => {
    const approve = vi.fn();
    let currentDocument = { ...document, draft: true };
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({ ok: true, data: { document: currentDocument } }),
      ),
      http.post(`/api/documents/${DOCUMENT_ID}/approve`, () => {
        approve();
        currentDocument = { ...document, draft: false };
        return HttpResponse.json({ ok: true, data: { document: currentDocument } });
      }),
    );
    await renderPage();

    expect(await screen.findByText('Szkic')).toBeInTheDocument();
    expect(screen.getByText(/czeka na zatwierdzenie/u)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zatwierdź' }));

    await waitFor(() => expect(approve).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.queryByText(/czeka na zatwierdzenie/u)).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Zatwierdź' })).not.toBeInTheDocument();
  });

  it('reverts an approved document to draft from the secondary action', async () => {
    const unapprove = vi.fn();
    let currentDocument = { ...document, draft: false };
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({ ok: true, data: { document: currentDocument } }),
      ),
      http.post(`/api/documents/${DOCUMENT_ID}/unapprove`, () => {
        unapprove();
        currentDocument = { ...document, draft: true };
        return HttpResponse.json({ ok: true, data: { document: currentDocument } });
      }),
    );
    await renderPage();

    const action = await screen.findByRole('button', { name: 'Cofnij do szkicu' });
    expect(action).toHaveClass('MuiButton-outlined');
    await userEvent.click(action);

    await waitFor(() => expect(unapprove).toHaveBeenCalledOnce());
    expect(await screen.findByText(/czeka na zatwierdzenie/u)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cofnij do szkicu' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zatwierdź' })).toBeInTheDocument();
  });

  it('waives the signature requirement from the primary action', async () => {
    const waive = vi.fn();
    let currentDocument = { ...document, signatureNotRequired: false };
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({ ok: true, data: { document: currentDocument } }),
      ),
      http.post(`/api/documents/${DOCUMENT_ID}/waive-signature`, () => {
        waive();
        currentDocument = { ...document, signatureNotRequired: true };
        return HttpResponse.json({ ok: true, data: { document: currentDocument } });
      }),
    );
    await renderPage();

    const action = await screen.findByRole('button', { name: 'Nie wymaga podpisu' });
    expect(action).toHaveClass('MuiButton-contained');
    expect(screen.queryByText('Nie wymaga')).not.toBeInTheDocument();
    await userEvent.click(action);

    await waitFor(() => expect(waive).toHaveBeenCalledOnce());
    expect(await screen.findByText('Nie wymaga')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Nie wymaga podpisu' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wymaga podpisu' })).toBeInTheDocument();
  });

  it('restores the signature requirement from the secondary action', async () => {
    const requireSignature = vi.fn();
    let currentDocument = { ...document, signatureNotRequired: true };
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({ ok: true, data: { document: currentDocument } }),
      ),
      http.post(`/api/documents/${DOCUMENT_ID}/require-signature`, () => {
        requireSignature();
        currentDocument = { ...document, signatureNotRequired: false };
        return HttpResponse.json({ ok: true, data: { document: currentDocument } });
      }),
    );
    await renderPage();

    expect(await screen.findByText('Nie wymaga')).toBeInTheDocument();
    const action = screen.getByRole('button', { name: 'Wymaga podpisu' });
    expect(action).toHaveClass('MuiButton-outlined');
    await userEvent.click(action);

    await waitFor(() => expect(requireSignature).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByText('Nie wymaga')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Wymaga podpisu' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nie wymaga podpisu' })).toBeInTheDocument();
  });

  it('renders a trashed document as read-only with restore and purge actions', async () => {
    const restore = vi.fn();
    const purge = vi.fn();
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({
          ok: true,
          data: {
            document: { ...document, deletedAt: '2026-08-02T09:00:00.000Z' },
          },
        }),
      ),
      http.post(`/api/documents/${DOCUMENT_ID}/restore`, () => {
        restore();
        return HttpResponse.json({
          ok: true,
          data: { document: { ...document, deletedAt: null } },
        });
      }),
      http.delete(`/api/documents/${DOCUMENT_ID}/purge`, () => {
        purge();
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );
    await renderPage();

    expect(await screen.findByText(/W koszu/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Przywróć' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usuń trwale' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edytuj' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Usuń dokument' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Wgraj plik' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Podpisz' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Podgląd pliku oryginal.pdf')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Pobierz plik oryginal.pdf')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Eksportuj' })).not.toBeInTheDocument();
    expect(screen.getByText('oryginal.pdf')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Przywróć' }));
    await waitFor(() => expect(restore).toHaveBeenCalledOnce());

    await userEvent.click(screen.getByRole('button', { name: 'Usuń trwale' }));
    const dialog = await screen.findByRole('dialog', { name: 'Usunąć trwale?' });
    expect(within(dialog).getByText(/magazynu blob/u)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń trwale' }));
    await waitFor(() => expect(purge).toHaveBeenCalledOnce());
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

    await userEvent.click(await screen.findByRole('button', { name: 'Więcej akcji' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Usuń dokument' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Przenieś do kosza' }),
    );

    expect(await screen.findByText('Lista dokumentów')).toBeInTheDocument();
    expect(detailRequests).toHaveBeenCalledOnce();
  });
});
