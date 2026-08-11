import { describe, expect, it } from 'vitest';

import { ApiError } from '#core/client/index.js';
import { documentTypeSchema } from '#core/domain/index.js';

import {
  DOCUMENT_TYPE_COLORS,
  documentFilterSummary,
  documentFiltersFromSearch,
  documentReviewSearchSchema,
  documentsSearchFromSigningSearch,
  documentsSearchFromState,
  documentsSearchSchema,
  emptyDocumentFilters,
  filesByRole,
  fileNameStem,
  formatFileSize,
  formatCanonicalDocumentInterval,
  formatVisTimelineMajorLabel,
  formatVisTimelineMinorLabel,
  groupDocumentsCanonically,
  groupDocumentsForTimeline,
  hasDocumentFilter,
  hasSignedDocumentFile,
  massReviewQueueDocumentIds,
  massReviewQueueSearch,
  massSigningQueueTargets,
  newestDocumentFileByRole,
  newestSignablePdfFile,
  reviewModeFromSearch,
  reviewQueueFromSearch,
  signingQueueFromSearch,
  signingQueueSearch,
  suggestDocumentDate,
  timelineIntervalForDocument,
  toVisTimelineData,
  toDocumentFilter,
  toDocumentFilterValues,
  toDocumentInput,
  unionTimelineIntervals,
  uniqueDocumentPersons,
  uniqueDocumentTags,
  uploadErrorMessage,
  visTimelineFittedWindow,
} from './documents.logic.js';

describe('document view logic', () => {
  it('normalizes form values and tag chips', () => {
    expect(
      toDocumentInput({
        title: '  Uchwała ',
        docType: 'uchwala',
        documentDate: '2026-07-18',
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
        person: '  Anna ',
        tags: ['zarząd', ' ważne ', 'zarząd', ''],
      }),
    ).toEqual({
      title: 'Uchwała',
      docType: 'uchwala',
      documentDate: '2026-07-18',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
      person: 'Anna',
      tags: ['zarząd', 'ważne'],
    });
    expect(
      toDocumentInput({
        title: 'Notatka',
        docType: 'inny',
        documentDate: '2026-07-18',
        periodStart: '',
        periodEnd: '',
        person: ' ',
        tags: [],
      }),
    ).toEqual({
      title: 'Notatka',
      docType: 'inny',
      documentDate: '2026-07-18',
      periodStart: null,
      periodEnd: null,
      tags: [],
    });
  });

  it('suggests a signing date from period fields without overwriting user input', () => {
    const base = {
      title: '',
      docType: 'umowa-uod' as const,
      documentDate: '',
      periodStart: '',
      periodEnd: '',
      person: '',
      tags: [],
    };
    expect(suggestDocumentDate(base, 'periodStart', '2026-07-01').documentDate).toBe(
      '2026-07-01',
    );
    expect(
      suggestDocumentDate(
        { ...base, docType: 'protokol' },
        'periodEnd',
        '2026-07-31',
      ).documentDate,
    ).toBe('2026-07-31');
    expect(
      suggestDocumentDate(
        { ...base, documentDate: '2026-06-30' },
        'periodStart',
        '2026-07-01',
      ).documentDate,
    ).toBe('2026-06-30');
    expect(suggestDocumentDate({ ...base, docType: 'inny' }, 'periodStart', '2026-07-01')).toEqual({
      ...base,
      docType: 'inny',
      periodStart: '2026-07-01',
    });
  });

  it('omits blank filters and groups files by role', () => {
    expect(emptyDocumentFilters()).toEqual({
      text: '',
      docType: '',
      person: '',
      tag: '',
      dateFrom: '',
      dateTo: '',
      signatureStatus: '',
      signerAccountId: '',
      draft: 'false',
    });
    expect(
      toDocumentFilter({
        text: ' umowa ',
        docType: '',
        person: ' ',
        tag: '',
        dateFrom: '',
        dateTo: '2026-12-31',
        signatureStatus: '',
        signerAccountId: '',
        draft: 'false',
      }),
    ).toEqual({ text: 'umowa', dateTo: '2026-12-31' });
    expect(
      toDocumentFilter({
        text: '',
        docType: 'uchwala',
        person: 'Anna',
        tag: ' ważne ',
        dateFrom: '2026-01-01',
        dateTo: '',
        signatureStatus: 'needs-signature',
        signerAccountId: 'account-1',
        draft: 'all',
      }),
    ).toEqual({
      docType: 'uchwala',
      person: 'Anna',
      tag: 'ważne',
      dateFrom: '2026-01-01',
      signatureStatus: 'needs-signature',
      signerAccountId: 'account-1',
      draft: 'all',
    });
    expect(hasDocumentFilter({})).toBe(false);
    expect(hasDocumentFilter({ tag: 'ważne', signatureStatus: 'signed' })).toBe(true);
    expect(toDocumentFilterValues({ text: 'umowa', tag: 'ważne', signatureStatus: 'signed' })).toEqual({
      text: 'umowa',
      docType: '',
      person: '',
      tag: 'ważne',
      dateFrom: '',
      dateTo: '',
      signatureStatus: 'signed',
      signerAccountId: '',
      draft: 'false',
    });
    const file = {
      id: '11111111-1111-4111-8111-111111111111',
      documentId: '22222222-2222-4222-8222-222222222222',
      role: 'source' as const,
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      storageKey: 'key',
      createdAt: '2026-07-18T00:00:00.000Z',
    };
    expect(filesByRole([file])).toMatchObject({ source: [file], other: [] });
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0 MB');
    expect(formatFileSize(10)).toBe('10 B');
  });

  it('keeps the draft filter as a plain URL boolean', () => {
    const parsed = documentsSearchSchema.parse({ q: 'Szkic', szkice: 'true' });
    expect(parsed).toEqual({ q: 'Szkic', szkice: true });
    expect(documentFiltersFromSearch(parsed)).toMatchObject({ text: 'Szkic', draft: 'true' });
    expect(
      documentsSearchFromState('list', {
        ...emptyDocumentFilters(),
        text: 'Szkic',
        draft: 'true',
      }),
    ).toEqual({ q: 'Szkic', szkice: true });
  });

  it('round-trips the signer account through URLs and saved filters', () => {
    const parsed = documentsSearchSchema.parse({ podpisal: 'account-1' });
    expect(documentFiltersFromSearch(parsed)).toMatchObject({ signerAccountId: 'account-1' });
    expect(
      documentsSearchFromState('list', {
        ...emptyDocumentFilters(),
        signerAccountId: 'account-1',
      }),
    ).toEqual({ podpisal: 'account-1' });
    expect(toDocumentFilterValues({ signerAccountId: 'account-1' })).toMatchObject({
      signerAccountId: 'account-1',
    });
  });

  it('serializes and parses client-side signing queue state', () => {
    const targets = [
      {
        documentId: '11111111-1111-4111-8111-111111111111',
        fileId: '33333333-3333-4333-8333-333333333333',
      },
      {
        documentId: '22222222-2222-4222-8222-222222222222',
        fileId: '44444444-4444-4444-8444-444444444444',
      },
    ];
    const search = signingQueueSearch({
      signedCount: 1,
      targets: targets.slice(1),
      total: 2,
    });
    expect(search).toEqual({
      kolejka: '22222222-2222-4222-8222-222222222222',
      pliki: '44444444-4444-4444-8444-444444444444',
      podpisane: 1,
      razem: 2,
    });
    expect(signingQueueSearch({ signedCount: 0, targets: [], total: 0 })).toEqual({
      podpisane: 0,
      razem: 0,
    });
    expect(signingQueueFromSearch(search)).toEqual([targets[1]]);
    expect(
      signingQueueFromSearch({
        kolejka: '22222222-2222-4222-8222-222222222222',
        pliki: undefined,
      }),
    ).toEqual([]);
    expect(
      documentsSearchFromSigningSearch({
        ...search,
        q: 'umowa',
        tag: 'ważne',
        status: 'needs-signature',
      }),
    ).toEqual({ q: 'umowa', tag: 'ważne', status: 'needs-signature' });
  });

  it('canonically orders the selected mass-signing documents and uses newest signable PDFs', () => {
    const sourceFile = {
      id: '33333333-3333-4333-8333-333333333333',
      documentId: '11111111-1111-4111-8111-111111111111',
      role: 'source' as const,
      fileName: 'source.pdf',
      contentType: 'application/pdf',
      sizeBytes: 10,
      storageKey: 'source',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const oldSignedFile = {
      ...sourceFile,
      id: '44444444-4444-4444-8444-444444444444',
      role: 'signed-digital' as const,
      fileName: 'source-podpisany.pdf',
      createdAt: '2026-02-01T00:00:00.000Z',
    };
    const newestSignedFile = {
      ...sourceFile,
      id: '55555555-5555-4555-8555-555555555555',
      role: 'signed-digital' as const,
      fileName: 'source-podpisany-2.pdf',
      createdAt: '2026-03-01T00:00:00.000Z',
    };
    const protocol = {
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: 'tenant-1',
      title: 'Protokół',
      docType: 'protokol' as const,
      documentDate: '2026-05-10',
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      person: 'Anna',
      tags: [],
      draft: false,
      deletedAt: null,
      createdAt: '2026-05-10T00:00:00.000Z',
      updatedAt: '2026-05-10T00:00:00.000Z',
      files: [sourceFile, oldSignedFile, newestSignedFile],
    };
    const bill = {
      ...protocol,
      id: '22222222-2222-4222-8222-222222222222',
      title: 'Rachunek',
      docType: 'rachunek' as const,
      files: [
        {
          ...sourceFile,
          id: '66666666-6666-4666-8666-666666666666',
          documentId: '22222222-2222-4222-8222-222222222222',
        },
      ],
    };
    const contract = {
      ...protocol,
      id: '77777777-7777-4777-8777-777777777777',
      title: 'Umowa',
      docType: 'umowa-uod' as const,
      documentDate: '2026-05-09',
      files: [
        {
          ...sourceFile,
          id: '88888888-8888-4888-8888-888888888888',
          documentId: '77777777-7777-4777-8777-777777777777',
        },
      ],
    };

    expect(newestSignablePdfFile(protocol)?.id).toBe(newestSignedFile.id);
    expect(massSigningQueueTargets([contract, bill, protocol])).toEqual([
      {
        documentId: contract.id,
        fileId: '88888888-8888-4888-8888-888888888888',
      },
      { documentId: protocol.id, fileId: newestSignedFile.id },
      {
        documentId: bill.id,
        fileId: '66666666-6666-4666-8666-666666666666',
      },
    ]);
    expect(massSigningQueueTargets([protocol, contract])).toEqual([
      {
        documentId: contract.id,
        fileId: '88888888-8888-4888-8888-888888888888',
      },
      { documentId: protocol.id, fileId: newestSignedFile.id },
    ]);
    expect(massReviewQueueDocumentIds([bill, protocol, contract])).toEqual([
      contract.id,
      protocol.id,
      bill.id,
    ]);
    expect(newestDocumentFileByRole(protocol, 'signed-digital')?.id).toBe(
      newestSignedFile.id,
    );
  });

  it('round-trips the mass-review queue and defaults invalid modes to source', () => {
    const queue = ['document-a', 'document-b', 'document-a'];
    const search = documentReviewSearchSchema.parse({
      ...massReviewQueueSearch(queue),
      tryb: 'podpisany',
    });

    expect(reviewQueueFromSearch(search)).toEqual(['document-a', 'document-b']);
    expect(reviewModeFromSearch(search)).toBe('signed');
    expect(
      reviewModeFromSearch(documentReviewSearchSchema.parse({ tryb: 'nieznany' })),
    ).toBe('source');
  });

  it('groups filtered documents by canonical period, person and type order', () => {
    const documents = [
      {
        id: 'other-first',
        title: 'Inny pierwszy',
        docType: 'inny' as const,
        documentDate: '2026-05-20',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        person: 'Łukasz',
      },
      {
        id: 'protocol',
        title: 'Protokół',
        docType: 'protokol' as const,
        documentDate: '2026-05-21',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        person: 'Łukasz',
      },
      {
        id: 'bill',
        title: 'Rachunek',
        docType: 'rachunek' as const,
        documentDate: '2026-05-22',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        person: 'Łukasz',
      },
      {
        id: 'contract',
        title: 'Umowa',
        docType: 'umowa-uod' as const,
        documentDate: '2026-05-23',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        person: 'Łukasz',
      },
      {
        id: 'contract-second',
        title: 'Umowa druga',
        docType: 'umowa-uod' as const,
        documentDate: '2026-05-23',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        person: 'Łukasz',
      },
      {
        id: 'other-second',
        title: 'Inny drugi',
        docType: 'uchwala' as const,
        documentDate: '2026-05-24',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        person: 'Łukasz',
      },
      {
        id: 'anna',
        title: 'Anna',
        docType: 'inny' as const,
        documentDate: '2026-05-25',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        person: 'Anna',
      },
      {
        id: 'no-person',
        title: 'Bez osoby',
        docType: 'inny' as const,
        documentDate: '2026-05-26',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        person: null,
      },
      {
        id: 'instant-old',
        title: 'Bez okresu stary',
        docType: 'inny' as const,
        documentDate: '2025-12-20',
        periodStart: null,
        periodEnd: null,
        person: 'Żaneta',
      },
      {
        id: 'older-interval',
        title: 'Starszy okres',
        docType: 'inny' as const,
        documentDate: '2024-02-10',
        periodStart: '2024-02-01',
        periodEnd: '2024-02-29',
        person: 'Jan',
      },
      {
        id: 'future',
        title: 'Przyszły',
        docType: 'inny' as const,
        documentDate: '2027-01-10',
        periodStart: null,
        periodEnd: null,
        person: 'Jan',
      },
    ];

    const groups = groupDocumentsCanonically(documents);

    expect(groups.map((group) => [group.start, group.end])).toEqual([
      ['2024-02-01', '2024-02-29'],
      ['2025-12-20', '2025-12-20'],
      ['2026-05-01', '2026-05-31'],
      ['2027-01-10', '2027-01-10'],
    ]);
    expect(formatCanonicalDocumentInterval(groups[0] ?? { start: '', end: '' })).toBe(
      '01.02.2024-29.02.2024',
    );
    expect(formatCanonicalDocumentInterval(groups[1] ?? { start: '', end: '' })).toBe(
      '20.12.2025',
    );

    const mayGroup = groups.at(2);
    if (!mayGroup) throw new Error('Missing May group');
    expect(mayGroup.people.map((group) => group.person)).toEqual([
      'Anna',
      'Łukasz',
      'Bez osoby',
    ]);
    expect(mayGroup.people.at(1)?.documents.map((item) => item.id)).toEqual([
      'contract',
      'contract-second',
      'protocol',
      'bill',
      'other-first',
      'other-second',
    ]);
    expect(
      groupDocumentsCanonically([
        {
          id: 'no-person-first',
          docType: 'inny' as const,
          documentDate: '2026-06-01',
          periodStart: null,
          periodEnd: null,
          person: null,
        },
        {
          id: 'anna-second',
          docType: 'inny' as const,
          documentDate: '2026-06-01',
          periodStart: null,
          periodEnd: null,
          person: 'Anna',
        },
      ]).at(0)?.people.map((group) => group.person),
    ).toEqual(['Anna', 'Bez osoby']);
  });

  it('builds tag suggestions and saved-search summaries', () => {
    const documents = [
      {
        tags: ['ważne', 'podpis'],
        documentDate: '2026-07-18',
        periodStart: '2025-12-01',
        periodEnd: '2026-01-15',
      },
      {
        tags: ['ważne'],
        documentDate: '2027-03-01',
        periodStart: null,
        periodEnd: null,
      },
    ];

    expect(uniqueDocumentTags(documents)).toEqual(['podpis', 'ważne']);
    expect(
      uniqueDocumentPersons([
        { person: 'Anna Nowak' },
        { person: ' Jan Kowalski ' },
        { person: 'Anna Nowak' },
        { person: null },
      ]),
    ).toEqual(['Anna Nowak', 'Jan Kowalski']);
    expect(
      documentFilterSummary({
        text: 'umowa',
        docType: 'umowa-uod',
        person: 'Anna',
        tag: 'ważne',
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
        signatureStatus: 'needs-signature',
      }),
    ).toBe(
      'Tytuł: umowa · Typ: Umowa UoD · Osoba: Anna · Tag: ważne · Od: 01.01.2026 · Do: 31.12.2026 · Status podpisu: Do podpisania',
    );
    expect(documentFilterSummary({})).toBe('Wszystkie dokumenty');
  });

  it('derives file name stems', () => {
    expect(fileNameStem('umowa.pdf')).toBe('umowa');
    expect(fileNameStem('.env')).toBe('.env');
  });

  it('maps API errors to Polish upload messages', () => {
    expect(
      uploadErrorMessage(
        new ApiError({ code: 'forbidden', message: 'Not allowed' }),
      ),
    ).toBe('Nie masz uprawnień do wgrania tego pliku.');
    expect(
      uploadErrorMessage(
        new ApiError({ code: 'unavailable', message: 'Storage unavailable' }),
      ),
    ).toBe('Magazyn plików jest chwilowo niedostępny.');
    expect(uploadErrorMessage(new Error('Błąd pliku'))).toBe('Błąd pliku');
    expect(uploadErrorMessage('unknown')).toBe('Nie udało się wgrać pliku.');
  });

  it('groups timeline documents by person and keeps visible interval gaps', () => {
    const sourceFile = {
      id: '33333333-3333-4333-8333-333333333333',
      documentId: '11111111-1111-4111-8111-111111111111',
      role: 'source' as const,
      fileName: 'source.pdf',
      contentType: 'application/pdf',
      sizeBytes: 10,
      storageKey: 'source',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const signedFile = { ...sourceFile, role: 'signed-digital' as const };
    const documents = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Styczeń',
        docType: 'umowa-uod' as const,
        documentDate: '2026-01-15',
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        person: 'Anna',
        files: [sourceFile],
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        title: 'Marzec',
        docType: 'protokol' as const,
        documentDate: '2026-03-15',
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
        person: 'Anna',
        files: [signedFile],
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        title: 'Bez okresu',
        docType: 'inny' as const,
        documentDate: '2026-02-10',
        periodStart: null,
        periodEnd: null,
        person: null,
        files: [],
      },
    ];

    expect(hasSignedDocumentFile({ files: [signedFile] })).toBe(true);
    const instantDocument = documents.at(2);
    if (!instantDocument) throw new Error('Missing instant timeline document');
    expect(timelineIntervalForDocument(instantDocument)).toMatchObject({
      start: '2026-02-10',
      end: '2026-02-10',
      instant: true,
      signed: false,
    });
    expect(
      unionTimelineIntervals([
        { start: '2026-01-01', end: '2026-01-10' },
        { start: '2026-01-05', end: '2026-01-20' },
        { start: '2026-03-01', end: '2026-03-31' },
      ]),
    ).toEqual([
      { start: '2026-01-01', end: '2026-01-20' },
      { start: '2026-03-01', end: '2026-03-31' },
    ]);
    expect(groupDocumentsForTimeline(documents)).toMatchObject([
      {
        person: 'Anna',
        intervals: [
          { start: '2026-01-01', end: '2026-01-31' },
          { start: '2026-03-01', end: '2026-03-31' },
        ],
        documents: [
          { title: 'Styczeń', signed: false },
          { title: 'Marzec', signed: true },
        ],
      },
      {
        person: 'Bez osoby',
        intervals: [{ start: '2026-02-10', end: '2026-02-10' }],
        documents: [{ title: 'Bez okresu', instant: true }],
      },
    ]);
  });

  it('maps timeline groups to escaped vis data with document and signature classes', () => {
    const data = toVisTimelineData([
      {
        person: 'Żaneta <&>"\'',
        intervals: [{ start: '2026-02-10', end: '2026-02-10' }],
        documents: [
          {
            id: 'instant',
            title: 'Punkt <&>"\'',
            docType: 'inny',
            start: '2026-02-10',
            end: '2026-02-10',
            instant: true,
            signed: false,
          },
        ],
      },
      {
        person: 'Anna',
        intervals: [{ start: '2026-01-01', end: '2026-01-31' }],
        documents: [
          {
            id: 'range',
            title: 'Umowa <pierwsza>',
            docType: 'umowa-uod',
            start: '2026-01-01',
            end: '2026-01-31',
            instant: false,
            signed: true,
          },
        ],
      },
    ]);

    expect(data.groups).toEqual([
      { id: 'Anna', content: 'Anna' },
      { id: 'Żaneta <&>"\'', content: 'Żaneta &lt;&amp;&gt;&quot;&#39;' },
    ]);
    expect(data.items).toEqual([
      {
        id: 'range',
        group: 'Anna',
        start: '2026-01-01',
        end: '2026-01-31',
        type: 'range',
        content: '<span>✓</span><span>Umowa &lt;pierwsza&gt;</span>',
        className: 'doc doc--umowa-uod is-signed',
        title: 'Umowa &lt;pierwsza&gt;\nUmowa UoD\n01.01.2026 - 31.01.2026\nPodpisane',
      },
      {
        id: 'instant',
        group: 'Żaneta <&>"\'',
        start: '2026-02-10',
        type: 'point',
        content: '<span>○</span><span>Punkt &lt;&amp;&gt;&quot;&#39;</span>',
        className: 'doc doc--inny is-unsigned',
        title: 'Punkt &lt;&amp;&gt;&quot;&#39;\nInny\n10.02.2026\nDo podpisania',
      },
    ]);
  });

  it('keeps timeline colors exhaustive and fits the window to the visible items', () => {
    expect(Object.keys(DOCUMENT_TYPE_COLORS).sort()).toEqual(
      [...documentTypeSchema.options].sort(),
    );

    expect(visTimelineFittedWindow([], 1000)).toBeNull();

    const day = 86_400_000;
    const single = visTimelineFittedWindow([{ start: '2026-02-10' }], 1000);
    expect(single?.start).toEqual(new Date(Date.UTC(2026, 1, 10) - 7 * day));
    expect(single?.end).toEqual(new Date(Date.UTC(2026, 1, 10) + 30 * day));

    const many = visTimelineFittedWindow(
      [
        { start: '2026-06-01', end: '2026-07-31' },
        { start: '2026-01-01', end: '2026-03-31' },
        { start: '2026-12-01', end: '2027-01-01' },
      ],
      1000,
    );
    const windowStart = Date.UTC(2026, 0, 1) - (Date.UTC(2027, 0, 1) - Date.UTC(2026, 0, 1)) * 0.05;
    expect(many?.start).toEqual(new Date(windowStart));
    expect(many?.end).toEqual(
      new Date(windowStart + (Date.UTC(2026, 11, 1) - windowStart) / (1 - 320 / 1000)),
    );
  });

  it('formats vis axis labels with Polish Intl rules', () => {
    const date = new Date(2026, 0, 15, 13, 5);
    expect(formatVisTimelineMinorLabel(date, 'year')).toBe('2026');
    expect(formatVisTimelineMinorLabel(date, 'month')).toMatch(/^sty/u);
    expect(formatVisTimelineMinorLabel(date, 'day')).toMatch(/^15 sty/u);
    expect(formatVisTimelineMinorLabel(date, 'hour')).toMatch(/13:05/u);
    expect(formatVisTimelineMajorLabel(date, 'year')).toBe('');
    expect(formatVisTimelineMajorLabel(date, 'month')).toBe('2026');
    expect(formatVisTimelineMajorLabel(date, 'day')).toBe('styczeń 2026');
    expect(formatVisTimelineMajorLabel(date, 'hour')).toBe('15 stycznia 2026');
  });
});
