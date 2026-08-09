import { describe, expect, it } from 'vitest';

import { ApiError } from '#core/client/index.js';

import {
  documentFilterSummary,
  documentFiltersFromSearch,
  documentsSearchFromSigningSearch,
  documentsSearchFromState,
  documentsSearchSchema,
  emptyDocumentFilters,
  filesByRole,
  fileNameStem,
  formatFileSize,
  formatCanonicalDocumentInterval,
  createTimelineScale,
  groupDocumentsCanonically,
  groupDocumentsForTimeline,
  hasDocumentFilter,
  hasSignedDocumentFile,
  massSigningQueueTargets,
  newestSignablePdfFile,
  signingQueueFromSearch,
  signingQueueSearch,
  signingQueueTargets,
  suggestDocumentDate,
  timelineIntervalForDocument,
  timelineMonthTicks,
  toDocumentFilter,
  toDocumentFilterValues,
  toDocumentInput,
  unionTimelineIntervals,
  uniqueDocumentPersons,
  uniqueDocumentTags,
  uploadErrorMessage,
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
        draft: 'all',
      }),
    ).toEqual({
      docType: 'uchwala',
      person: 'Anna',
      tag: 'ważne',
      dateFrom: '2026-01-01',
      signatureStatus: 'needs-signature',
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

  it('builds and parses the client-side signing queue', () => {
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
    const first = {
      id: '11111111-1111-4111-8111-111111111111',
      files: [sourceFile],
    };
    const second = {
      id: '22222222-2222-4222-8222-222222222222',
      files: [
        {
          ...sourceFile,
          id: '44444444-4444-4444-8444-444444444444',
          documentId: '22222222-2222-4222-8222-222222222222',
        },
      ],
    };
    const alreadySigned = {
      id: '55555555-5555-4555-8555-555555555555',
      files: [
        {
          ...sourceFile,
          id: '66666666-6666-4666-8666-666666666666',
          documentId: '55555555-5555-4555-8555-555555555555',
        },
        {
          ...sourceFile,
          id: '77777777-7777-4777-8777-777777777777',
          documentId: '55555555-5555-4555-8555-555555555555',
          role: 'signed-digital' as const,
        },
      ],
    };

    const targets = signingQueueTargets([first, alreadySigned, second]);
    expect(targets).toEqual([
      {
        documentId: '11111111-1111-4111-8111-111111111111',
        fileId: '33333333-3333-4333-8333-333333333333',
      },
      {
        documentId: '22222222-2222-4222-8222-222222222222',
        fileId: '44444444-4444-4444-8444-444444444444',
      },
    ]);
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

  it('builds the mass-signing queue from canonical order and newest signable PDFs', () => {
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
    const future = {
      ...protocol,
      id: '77777777-7777-4777-8777-777777777777',
      title: 'Przyszły',
      docType: 'umowa-uod' as const,
      documentDate: '2026-06-10',
      periodStart: null,
      periodEnd: null,
      files: [
        {
          ...sourceFile,
          id: '88888888-8888-4888-8888-888888888888',
          documentId: '77777777-7777-4777-8777-777777777777',
        },
      ],
    };

    expect(newestSignablePdfFile(protocol)?.id).toBe(newestSignedFile.id);
    expect(massSigningQueueTargets([future, bill, protocol])).toEqual([
      { documentId: protocol.id, fileId: newestSignedFile.id },
      {
        documentId: bill.id,
        fileId: '66666666-6666-4666-8666-666666666666',
      },
      {
        documentId: future.id,
        fileId: '88888888-8888-4888-8888-888888888888',
      },
    ]);
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
      'protocol',
      'bill',
      'contract',
      'other-first',
      'other-second',
    ]);
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

  it('builds a deterministic timeline x scale and month ticks', () => {
    const emptyScale = createTimelineScale([], 120);
    expect(emptyScale).toMatchObject({
      start: '1970-01-01',
      end: '1970-01-01',
      width: 120,
    });
    expect(emptyScale.x('2026-01-01')).toBe(0);

    const scale = createTimelineScale(
      [
        { start: '2026-01-15', end: '2026-01-31' },
        { start: '2026-03-01', end: '2026-03-31' },
      ],
      120,
    );

    expect(scale.start).toBe('2026-01-15');
    expect(scale.end).toBe('2026-03-31');
    expect(scale.width).toBeGreaterThanOrEqual(240);
    expect(scale.x('2026-01-15')).toBe(0);
    expect(Math.round(scale.x('2026-03-31'))).toBe(scale.width);
    expect(timelineMonthTicks(scale)).toEqual([
      { date: '2026-01-01', label: '01.2026', year: '2026' },
      { date: '2026-02-01', label: '02.2026', year: '2026' },
      { date: '2026-03-01', label: '03.2026', year: '2026' },
    ]);
  });
});
