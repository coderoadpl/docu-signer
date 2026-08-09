import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';

const DEMO_EMAIL = 'demo@agentproofarch.dev';
const DEMO_PASSWORD = 'demo1234';
const documentCreateResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    document: z.object({ id: z.string() }),
  }),
});

const validPdfBuffer = async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  pdf.addPage([200, 200]);
  return Buffer.from(await pdf.save());
};

const drawOnCanvas = async (
  page: Page,
  canvas: Locator,
  points: Array<{ x: number; y: number }>,
) => {
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing signing surface bounds');
  const [first, ...rest] = points;
  if (!first) throw new Error('Signing stroke needs at least one point');
  await page.mouse.move(box.x + box.width * first.x, box.y + box.height * first.y);
  await page.mouse.down();
  for (const point of rest) {
    await page.mouse.move(box.x + box.width * point.x, box.y + box.height * point.y);
  }
  await page.mouse.up();
};

const canvasInkState = async (canvas: Locator) =>
  canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) {
      throw new Error('Expected a canvas');
    }
    const context = element.getContext('2d');
    if (!context) throw new Error('Missing canvas context');
    const data = context.getImageData(0, 0, element.width, element.height).data;
    let pixels = 0;
    for (let index = 3; index < data.length; index += 4) {
      const alpha = data[index];
      if (alpha !== undefined && alpha > 0) pixels += 1;
    }
    return {
      pixels,
      width: element.width,
      height: element.height,
      bounds: element.getBoundingClientRect().toJSON(),
    };
  });

const expectCanvasInkGrew = async (
  canvas: Locator,
  before: Awaited<ReturnType<typeof canvasInkState>>,
) => {
  await expect
    .poll(async () => (await canvasInkState(canvas)).pixels)
    .toBeGreaterThan(before.pixels);
};

const dispatchPointerStroke = async ({
  canvas,
  pointerType,
  points,
}: {
  canvas: Locator;
  pointerType: 'pen' | 'touch';
  points: Array<{ x: number; y: number }>;
}) => {
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing signature pad bounds');
  const [first, ...rest] = points.map((point) => ({
    x: box.x + box.width * point.x,
    y: box.y + box.height * point.y,
  }));
  const last = rest.at(-1) ?? first;
  if (!first || !last) throw new Error('Signature pad stroke needs points');
  const pointerId = pointerType === 'pen' ? 901 : 902;
  await canvas.dispatchEvent('pointerdown', {
    bubbles: true,
    pointerId,
    pointerType,
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: first.x,
    clientY: first.y,
    pressure: pointerType === 'pen' ? 0.45 : 0.5,
  });
  for (const point of rest) {
    await canvas.dispatchEvent('pointermove', {
      bubbles: true,
      pointerId,
      pointerType,
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: point.x,
      clientY: point.y,
      pressure: pointerType === 'pen' ? 0.7 : 0.5,
    });
  }
  await canvas.dispatchEvent('pointerup', {
    bubbles: true,
    pointerId,
    pointerType,
    isPrimary: true,
    button: 0,
    buttons: 0,
    clientX: last.x,
    clientY: last.y,
    pressure: 0,
  });
};

const useSignaturePad = async (
  page: Page,
  points: Array<{ x: number; y: number }>,
) => {
  await page.getByRole('button', { name: 'Złóż podpis' }).click();
  const dialog = page.getByRole('dialog', { name: 'Złóż podpis' });
  const canvas = dialog.getByRole('application', {
    name: 'Powierzchnia do złożenia podpisu',
  });
  const before = await canvasInkState(canvas);
  await drawOnCanvas(page, canvas, points);
  await expectCanvasInkGrew(canvas, before);
  await dialog.getByRole('button', { name: 'Użyj podpisu' }).click();
};

const enterPolishDate = async (container: Locator, label: string, value: string) => {
  const field = container.getByRole('group', { name: new RegExp(`^${label}`, 'u') });
  await field.getByRole('spinbutton', { name: 'Day' }).click();
  await field.pressSequentially(value);
  await expect(field).toContainText(value);
};

const createSignableDocument = async (page: Page, title: string, sourceName: string) => {
  await page.goto('/login');
  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();

  await page.getByRole('link', { name: 'Dokumenty' }).click();
  await page.getByRole('button', { name: 'Dodaj dokument' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Dodaj dokument' });
  await dialog.getByRole('textbox', { name: 'Tytuł' }).fill(title);
  await dialog.getByLabel('Osoba').fill('Jan Kowalski');
  await enterPolishDate(dialog, 'Data podpisania', '01.01.2026');
  await dialog.getByRole('button', { name: 'Dodaj dokument' }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const sourceSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: /Źródło/ }) });
  await sourceSection.locator('input[type="file"]').setInputFiles({
    name: sourceName,
    mimeType: 'application/pdf',
    buffer: await validPdfBuffer(),
  });
  await expect(sourceSection.getByText(sourceName)).toBeVisible();
  await sourceSection.getByRole('button', { name: 'Podpisz' }).click();
  await expect(page.getByRole('heading', { name: 'Podpisz dokument' })).toBeVisible();
  await expect(page.getByText('Strona 1 z 2')).toBeVisible();
};

const createSourceDocument = async (
  page: Page,
  title: string,
  sourceName: string,
  docType = 'Umowa UoD',
) => {
  await page.getByRole('button', { name: 'Dodaj dokument' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Dodaj dokument' });
  await dialog.getByRole('textbox', { name: 'Tytuł' }).fill(title);
  await dialog.getByLabel('Typ').click();
  await page.getByRole('option', { name: docType }).click();
  await dialog.getByLabel('Osoba').fill('Jan Kowalski');
  await enterPolishDate(dialog, 'Data podpisania', '01.01.2026');
  await dialog.getByRole('button', { name: 'Dodaj dokument' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const sourceSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: /Źródło/ }) });
  await sourceSection.locator('input[type="file"]').setInputFiles({
    name: sourceName,
    mimeType: 'application/pdf',
    buffer: await validPdfBuffer(),
  });
  await expect(sourceSection.getByText(sourceName)).toBeVisible();
};

const placeSignaturePadStroke = async ({
  page,
  pointerType,
  points,
}: {
  page: Page;
  pointerType: 'pen' | 'touch';
  points: Array<{ x: number; y: number }>;
}) => {
  const pageCanvas = page.getByRole('application', {
    name: 'Powierzchnia do rysowania podpisu',
  });
  const pageBefore = await canvasInkState(pageCanvas);
  await page.getByRole('button', { name: 'Złóż podpis' }).click();
  const dialog = page.getByRole('dialog', { name: 'Złóż podpis' });
  const padCanvas = dialog.getByRole('application', {
    name: 'Powierzchnia do złożenia podpisu',
  });
  const padBefore = await canvasInkState(padCanvas);
  await dispatchPointerStroke({ canvas: padCanvas, pointerType, points });
  await expectCanvasInkGrew(padCanvas, padBefore);
  await expect(dialog.getByRole('button', { name: 'Użyj podpisu' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Użyj podpisu' }).click();
  await expect(dialog).toBeHidden();
  await expectCanvasInkGrew(pageCanvas, pageBefore);
};

const reopenSigningPage = async (page: Page, sourceName: string) => {
  await page.getByRole('button', { name: 'Zamknij' }).click();
  const sourceSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: /Źródło/ }) });
  await expect(sourceSection.getByText(sourceName)).toBeVisible();
  await sourceSection.getByRole('button', { name: 'Podpisz' }).click();
  await expect(page.getByRole('heading', { name: 'Podpisz dokument' })).toBeVisible();
  await expect(page.getByText('Strona 1 z 2')).toBeVisible();
};

const signVisiblePdf = async (page: Page) => {
  await expect(
    page.getByRole('heading', { name: 'Podpisz dokument' }),
  ).toBeVisible();
  await expect(page.getByText('Strona 1 z 2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Czarny' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Granatowy' })).toBeVisible();
  await page.getByRole('button', { name: 'Granatowy' }).click();

  await useSignaturePad(page, [
    { x: 0.25, y: 0.18 },
    { x: 0.35, y: 0.12 },
    { x: 0.45, y: 0.2 },
  ]);
  await page.getByRole('button', { name: 'Następna' }).click();
  await expect(page.getByText('Strona 2 z 2')).toBeVisible();

  await useSignaturePad(page, [
    { x: 0.25, y: 0.55 },
    { x: 0.45, y: 0.45 },
    { x: 0.65, y: 0.58 },
  ]);
  const save = page.getByRole('button', { name: 'Zapisz podpisany PDF' });
  await expect(save).toBeEnabled();
  await save.click();
};

const expectReviewPdfFitsViewport = async (page: Page) => {
  const canvas = page.getByLabel(/Strona \d+ dokumentu PDF/u);
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('Missing PDF review bounds');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
};

const placeMassSignature = async (
  page: Page,
  points: Array<{ x: number; y: number }>,
) => {
  await page.getByRole('button', { name: 'Złóż podpis' }).click();
  const dialog = page.getByRole('dialog', { name: 'Złóż podpis' });
  const canvas = dialog.getByRole('application', {
    name: 'Powierzchnia do złożenia podpisu',
  });
  const before = await canvasInkState(canvas);
  await drawOnCanvas(page, canvas, points);
  await expectCanvasInkGrew(canvas, before);
  await dialog.getByRole('button', { name: 'Użyj podpisu' }).click();
  await expect(dialog).toBeHidden();
};

const signIn = async (page: Page) => {
  await page.goto('/login');
  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Dokumenty' })).toBeVisible();
};

test('creates, uploads, previews and exports an archived document', async ({
  page,
}) => {
  const stamp = Date.now();
  const title = `Umowa e2e ${stamp}`;
  const sourceName = `umowa-${stamp}.pdf`;
  const signedName = `umowa-${stamp}-podpisany.pdf`;
  const signedAgainName = `umowa-${stamp}-podpisany-2.pdf`;
  const scanName = `umowa-${stamp}-podpisana.png`;

  await signIn(page);

  await page.getByRole('link', { name: 'Dokumenty' }).click();
  await expect(
    page.getByRole('heading', { name: 'Dokumenty' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Dodaj dokument' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Dodaj dokument' });
  await dialog.getByRole('textbox', { name: 'Tytuł' }).fill(title);
  await dialog.getByLabel('Osoba').fill('Jan Kowalski');
  await dialog.getByLabel('Tagi').fill('e2e, podpis');
  await enterPolishDate(dialog, 'Data podpisania', '01.01.2026');
  await dialog.getByText('Okres').click();
  await enterPolishDate(dialog, 'Od', '01.01.2026');
  await enterPolishDate(dialog, 'Do', '31.12.2026');
  await dialog.getByRole('button', { name: 'Dodaj dokument' }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Data podpisania: 01.01.2026')).toBeVisible();
  await expect(page.getByText('Okres: 01.01.2026 - 31.12.2026')).toBeVisible();

  await page.getByRole('button', { name: '← Dokumenty' }).click();
  await page.getByLabel('Tag').fill('e2e');
  await page.getByRole('tab', { name: 'Os czasu' }).click();
  await expect(page.getByRole('img', { name: 'Os czasu dokumentów' })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(title, 'u') })).toBeVisible();
  await page.getByRole('tab', { name: 'Lista' }).click();
  await page.getByRole('button', { name: 'Zapisz teczkę' }).click();
  const savedSearchDialog = page.getByRole('dialog', { name: 'Zapisz teczkę' });
  await savedSearchDialog.getByLabel('Nazwa').fill(`E2E ${stamp}`);
  await expect(savedSearchDialog.getByText('Tag: e2e')).toBeVisible();
  await savedSearchDialog.getByRole('button', { name: 'Zapisz teczkę' }).click();
  await expect(savedSearchDialog).toBeHidden();
  await page.getByLabel('Tag').fill('');
  await page.getByRole('tab', { name: 'Teczki' }).click();
  await page.getByRole('heading', { name: `E2E ${stamp}` }).click();
  await expect(page.getByRole('cell', { name: title, exact: true })).toBeVisible();
  await page.getByRole('cell', { name: title, exact: true }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  const sourceSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: /Źródło/ }) });
  await sourceSection.locator('input[type="file"]').setInputFiles({
    name: sourceName,
    mimeType: 'application/pdf',
    buffer: await validPdfBuffer(),
  });
  await expect(sourceSection.getByText(sourceName)).toBeVisible();

  await sourceSection.getByRole('button', { name: 'Podpisz' }).click();
  await signVisiblePdf(page);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  const signedSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: /Podpis cyfrowy/ }) });
  await expect(signedSection.getByText(signedName)).toBeVisible();
  await signedSection.getByRole('button', { name: 'Podpisz' }).click();
  await signVisiblePdf(page);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(signedSection.getByText(signedAgainName)).toBeVisible();

  const scanSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: /Podpisany skan/ }) });
  await scanSection.locator('input[type="file"]').setInputFiles({
    name: scanName,
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(scanSection.getByText(scanName)).toBeVisible();

  const sourcePreview = sourceSection.getByLabel(`Podgląd pliku ${sourceName}`);
  await expect(sourcePreview).toHaveAttribute('target', '_blank');
  const previewHref = await sourcePreview.getAttribute('href');
  if (!previewHref) throw new Error('Missing source preview href');
  expect(previewHref).toMatch(/\/api\/documents\/[^/]+\/files\/[^/]+\/content/u);
  const previewResponse = await page.request.get(previewHref);
  expect(previewResponse.ok()).toBe(true);
  expect(previewResponse.headers()['content-type']).toContain('application/pdf');
  await expect(
    scanSection.getByText(scanName),
  ).toBeVisible();

  await sourceSection.getByRole('button', {
    name: `Więcej akcji dla pliku ${sourceName}`,
  }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Eksportuj' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('umowa-e2e');

  await sourceSection.getByRole('button', {
    name: `Więcej akcji dla pliku ${sourceName}`,
  }).click();
  await page.getByRole('menuitem', { name: 'Przenieś do nowego dokumentu' }).click();
  const moveDialog = page.getByRole('dialog', { name: 'Przenieś do nowego dokumentu' });
  await expect(moveDialog.getByRole('textbox', { name: 'Tytuł' })).toHaveValue(
    sourceName.replace(/\.pdf$/u, ''),
  );
  await moveDialog.getByRole('button', { name: 'Przenieś' }).click();
  await expect(
    page.getByRole('heading', { name: sourceName.replace(/\.pdf$/u, '') }),
  ).toBeVisible();
});

test('moves a document to trash and restores it', async ({ page }) => {
  const stamp = Date.now();
  const title = `Kosz e2e ${stamp}`;

  await signIn(page);
  await page.getByRole('link', { name: 'Dokumenty' }).click();
  await expect(page.getByRole('heading', { name: 'Dokumenty' })).toBeVisible();

  await page.getByRole('button', { name: 'Dodaj dokument' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Dodaj dokument' });
  await dialog.getByRole('textbox', { name: 'Tytuł' }).fill(title);
  await dialog.getByLabel('Osoba').fill('Jan Kowalski');
  await enterPolishDate(dialog, 'Data podpisania', '02.08.2026');
  await dialog.getByRole('button', { name: 'Dodaj dokument' }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByRole('button', { name: 'Usuń dokument' }).click();
  const deleteDialog = page.getByRole('dialog', { name: 'Przenieść dokument do kosza?' });
  await expect(
    deleteDialog.getByText('Dokument trafi do kosza. Możesz go później przywrócić.'),
  ).toBeVisible();
  await deleteDialog.getByRole('button', { name: 'Przenieś do kosza' }).click();

  await expect(page.getByRole('heading', { name: 'Dokumenty' })).toBeVisible();
  await page.getByRole('tab', { name: 'Kosz' }).click();
  const trashRow = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: title, exact: true }) });
  await expect(trashRow).toBeVisible();
  await trashRow.getByRole('button', { name: 'Przywróć' }).click();
  await expect(page.getByRole('heading', { name: 'Kosz jest pusty' })).toBeVisible();

  await page.getByRole('tab', { name: 'Lista' }).click();
  await expect(page.getByRole('cell', { name: title, exact: true })).toBeVisible();
});

test('keeps draft filters after approving a draft and returning to the list', async ({ page }) => {
  const stamp = Date.now();
  const title = `Szkic e2e ${stamp}`;

  await signIn(page);
  const response = await page.request.post('/api/documents', {
    data: {
      title,
      docType: 'inny',
      documentDate: '2026-08-03',
      person: 'Jan Kowalski',
      tags: ['e2e-draft'],
      draft: true,
    },
  });
  expect(response.ok()).toBe(true);
  const created = documentCreateResponseSchema.parse(await response.json());

  await page.goto(`/app/documents?szkice=true&q=${encodeURIComponent(title)}`);
  await expect(page.getByRole('cell', { name: title, exact: true })).toBeVisible();
  await page.getByRole('cell', { name: title, exact: true }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Szkic. Dokument jest widoczny')).toBeVisible();
  let searchParams = new URL(page.url()).searchParams;
  expect(searchParams.get('q')).toBe(title);
  expect(searchParams.get('szkice')).toBe('true');

  await page.getByRole('button', { name: 'Zatwierdź' }).click();
  await expect(page.getByText('Szkic. Dokument jest widoczny')).toBeHidden();
  await page.getByRole('button', { name: '← Dokumenty' }).click();

  await expect(page.getByLabel('Szukaj po tytule')).toHaveValue(title);
  await expect(page.getByLabel('Szkice')).toContainText('Tylko szkice');
  await expect(page.getByRole('heading', { name: 'Brak wyników dla tych filtrów' })).toBeVisible();
  searchParams = new URL(page.url()).searchParams;
  expect(searchParams.get('q')).toBe(title);
  expect(searchParams.get('szkice')).toBe('true');
  expect(created.data.document.id.length).toBeGreaterThan(0);
});

test.describe('signature pad dialog', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test('accepts pen and touch pointers and places stamps', async ({ page }) => {
    const stamp = Date.now();
    const sourceName = `signature-pad-${stamp}.pdf`;
    await createSignableDocument(
      page,
      `Signature pad e2e ${stamp}`,
      sourceName,
    );

    await placeSignaturePadStroke({
      page,
      pointerType: 'pen',
      points: [
        { x: 0.18, y: 0.48 },
        { x: 0.35, y: 0.32 },
        { x: 0.52, y: 0.52 },
        { x: 0.72, y: 0.38 },
      ],
    });
    await page.getByRole('button', { name: 'Usuń' }).click();
    await expect
      .poll(
        async () =>
          (
            await canvasInkState(
              page.getByRole('application', {
                name: 'Powierzchnia do rysowania podpisu',
              }),
            )
          ).pixels,
      )
      .toBe(0);

    await placeSignaturePadStroke({
      page,
      pointerType: 'touch',
      points: [
        { x: 0.2, y: 0.58 },
        { x: 0.4, y: 0.42 },
        { x: 0.58, y: 0.62 },
        { x: 0.78, y: 0.46 },
      ],
    });
    await expect(
      page.getByRole('button', { name: 'Zapisz podpisany PDF' }),
    ).toBeEnabled();

    await reopenSigningPage(page, sourceName);
    await placeSignaturePadStroke({
      page,
      pointerType: 'pen',
      points: [
        { x: 0.28, y: 0.48 },
        { x: 0.44, y: 0.36 },
        { x: 0.62, y: 0.5 },
      ],
    });
  });
});

test('mass signing signs, skips and signs an already signed document', async ({ page }) => {
  const stamp = Date.now();
  const titlePrefix = `Masowe e2e ${stamp}`;
  const firstTitle = `${titlePrefix} protokół`;
  const secondTitle = `${titlePrefix} rachunek`;
  const thirdTitle = `${titlePrefix} umowa`;

  await signIn(page);
  await page.getByRole('link', { name: 'Dokumenty' }).click();
  await createSourceDocument(page, firstTitle, `masowe-a-${stamp}.pdf`, 'Protokół');
  await page.getByRole('button', { name: '← Dokumenty' }).click();
  await createSourceDocument(page, secondTitle, `masowe-b-${stamp}.pdf`, 'Rachunek');
  await page.getByRole('button', { name: '← Dokumenty' }).click();
  await createSourceDocument(page, thirdTitle, `masowe-c-${stamp}.pdf`, 'Umowa UoD');

  const sourceSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: /Źródło/ }) });
  await sourceSection.getByRole('button', { name: 'Podpisz' }).click();
  await signVisiblePdf(page);
  await expect(page.getByRole('heading', { name: thirdTitle })).toBeVisible();
  await page.getByRole('button', { name: '← Dokumenty' }).click();

  await page.getByLabel('Szukaj po tytule').fill(titlePrefix);
  await expect
    .poll(() => new URL(page.url()).searchParams.get('q'))
    .toBe(titlePrefix);
  await expect(page.getByRole('cell', { name: firstTitle, exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: secondTitle, exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: thirdTitle, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Masowe podpisywanie' }).click();

  await expect(page.getByRole('heading', { name: thirdTitle })).toBeVisible();
  await expectReviewPdfFitsViewport(page);
  await placeMassSignature(page, [
    { x: 0.2, y: 0.42 },
    { x: 0.36, y: 0.3 },
    { x: 0.52, y: 0.45 },
  ]);
  await placeMassSignature(page, [
    { x: 0.24, y: 0.62 },
    { x: 0.44, y: 0.48 },
    { x: 0.68, y: 0.6 },
  ]);
  await page.getByRole('button', { name: 'Usuń' }).click();
  await expect(page.getByRole('button', { name: 'Usuń' })).toBeHidden();
  await page.getByRole('button', { name: 'Przejdź' }).click();

  await expect(page.getByRole('heading', { name: firstTitle })).toBeVisible();
  await expectReviewPdfFitsViewport(page);
  await placeMassSignature(page, [
    { x: 0.18, y: 0.5 },
    { x: 0.42, y: 0.36 },
    { x: 0.66, y: 0.52 },
  ]);
  await page.getByRole('button', { name: 'Przejdź' }).click();

  await expect(page.getByRole('heading', { name: secondTitle })).toBeVisible();
  await expectReviewPdfFitsViewport(page);
  await page.getByRole('button', { name: 'Przejdź' }).click();

  await expect(page.getByRole('heading', { name: 'Podsumowanie' })).toBeVisible();
  await expect(page.getByText('Podpisano 2')).toBeVisible();
  await expect(page.getByText('Pominięto 1')).toBeVisible();
  await page.getByRole('button', { name: 'Wróć do listy' }).click();
  await expect(page.getByLabel('Szukaj po tytule')).toHaveValue(titlePrefix);
});
