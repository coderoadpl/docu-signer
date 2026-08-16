import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';

import { clearMailpit, fetchMagicLink } from '../scripts/mailpit.js';

const DEMO_EMAIL = 'demo@agentproofarch.dev';
const DEMO_PASSWORD = 'demo1234';
const MAGIC_EMAIL = 'mag@example.com';
const MAILPIT_API_URL = 'http://localhost:9980';
const PRODUCT_PASS_SCREENSHOT_DIR = process.env['PRODUCT_PASS_SCREENSHOT_DIR'];
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
    let left = element.width;
    let right = 0;
    let top = element.height;
    let bottom = 0;
    for (let index = 3; index < data.length; index += 4) {
      const alpha = data[index];
      if (alpha !== undefined && alpha > 0) {
        pixels += 1;
        const pixel = (index - 3) / 4;
        const x = pixel % element.width;
        const y = Math.floor(pixel / element.width);
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    return {
      pixels,
      width: element.width,
      height: element.height,
      bounds: element.getBoundingClientRect().toJSON(),
      inkBounds:
        pixels > 0
          ? {
              left,
              right,
              top,
              bottom,
            }
          : undefined,
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
  pointerType: 'mouse' | 'pen' | 'touch';
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
  await dialog.getByLabel('Strona').fill('Jan Kowalski');
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
  await dialog.getByLabel('Strona').fill('Jan Kowalski');
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

const createDocumentWithFilesViaApi = async ({
  page,
  title,
  docType,
  files,
}: {
  page: Page;
  title: string;
  docType: 'umowa-uod' | 'protokol' | 'rachunek';
  files: Array<{
    fileName: string;
    role: 'source' | 'signed-digital';
  }>;
}) => {
  const response = await page.request.post('/api/documents', {
    data: {
      title,
      docType,
      documentDate: '2026-01-01',
      person: 'Jan Kowalski',
      tags: [],
    },
  });
  expect(response.ok()).toBe(true);
  const created = documentCreateResponseSchema.parse(await response.json());

  await Promise.all(
    files.map(async ({ fileName, role }) => {
      const upload = await page.request.post(
        `/api/documents/${created.data.document.id}/files/upload?fileName=${encodeURIComponent(fileName)}&role=${role}`,
        {
          headers: { 'content-type': 'application/pdf' },
          data: await validPdfBuffer(),
        },
      );
      expect(upload.ok()).toBe(true);
    }),
  );
  return created.data.document.id;
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
  await expect(page.getByLabel('Ładowanie podglądu pliku')).toBeHidden();
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Missing PDF review viewport');
  await expect
    .poll(async () => (await canvas.boundingBox())?.height ?? 0)
    .toBeGreaterThan(viewport.height * 0.5);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing PDF review bounds');
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

const dragSelectedStampLong = async (page: Page) => {
  const canvas = page.getByRole('application', {
    name: 'Powierzchnia do rysowania podpisu',
  });
  const before = await canvasInkState(canvas);
  if (!before.inkBounds) throw new Error('Missing stamp ink before drag');
  const start = {
    x:
      before.bounds.x +
      ((before.inkBounds.left + before.inkBounds.right) / 2 / before.width) *
        before.bounds.width,
    y:
      before.bounds.y +
      ((before.inkBounds.top + before.inkBounds.bottom) / 2 / before.height) *
        before.bounds.height,
  };
  const target = {
    x: before.bounds.x + before.bounds.width * 0.18,
    y: before.bounds.y + before.bounds.height * 0.2,
  };
  const pointerId = 903;
  await canvas.dispatchEvent('pointerdown', {
    bubbles: true,
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: start.x,
    clientY: start.y,
    pressure: 0.5,
    width: 12,
    height: 12,
  });
  for (let step = 1; step <= 20; step += 1) {
    await canvas.dispatchEvent('pointermove', {
      bubbles: true,
      pointerId,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: start.x + ((target.x - start.x) * step) / 20,
      clientY: start.y + ((target.y - start.y) * step) / 20,
      pressure: 0.5,
      width: 12,
      height: 12,
    });
  }
  await canvas.dispatchEvent('pointerup', {
    bubbles: true,
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    buttons: 0,
    clientX: target.x,
    clientY: target.y,
    pressure: 0,
    width: 12,
    height: 12,
  });
  await expect
    .poll(async () => (await canvasInkState(canvas)).inkBounds?.left ?? before.width)
    .toBeLessThan(before.inkBounds.left - before.width * 0.2);
};

const signIn = async (page: Page) => {
  await page.goto('/login');
  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Dokumenty' })).toBeVisible();
};

const signInWithMagicLink = async (page: Page) => {
  await clearMailpit(MAILPIT_API_URL);
  await page.goto('/login');
  await page.locator('#login-email').fill(MAGIC_EMAIL);
  await page.getByRole('button', { name: 'Wyślij link do logowania' }).click();
  const link = await fetchMagicLink(MAILPIT_API_URL, MAGIC_EMAIL);
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Dokumenty' })).toBeVisible();
};

const productPassScreenshot = async (page: Page, fileName: string) => {
  if (!PRODUCT_PASS_SCREENSHOT_DIR) return;
  await mkdir(PRODUCT_PASS_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: `${PRODUCT_PASS_SCREENSHOT_DIR}/${fileName}`,
    fullPage: false,
  });
};

test('creates, uploads, previews and exports an archived document', async ({
  page,
}) => {
  const stamp = Date.now();
  const title = `Umowa e2e ${stamp}`;
  const sourceName = `umowa-${stamp}.pdf`;
  const scanName = `umowa-${stamp}-podpisana.png`;

  await signIn(page);

  await page.getByRole('link', { name: 'Dokumenty' }).click();
  await expect(
    page.getByRole('heading', { name: 'Dokumenty' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Dodaj dokument' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Dodaj dokument' });
  await dialog.getByRole('textbox', { name: 'Tytuł' }).fill(title);
  await dialog.getByLabel('Strona').fill('Jan Kowalski');
  await dialog.getByLabel('Tagi').fill('e2e, podpis');
  await enterPolishDate(dialog, 'Data podpisania', '01.01.2026');
  await dialog.getByText('Okres').click();
  await enterPolishDate(dialog, 'Od', '01.01.2026');
  await enterPolishDate(dialog, 'Do', '31.12.2026');
  await dialog.getByRole('button', { name: 'Dodaj dokument' }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Data podpisania: 01.01.2026')).toBeVisible();
  await expect(page.getByText('Okres: 01.01.2026 - 31.12.2026')).toBeVisible();

  await page.getByRole('link', { name: '← Dokumenty' }).click();
  await page.getByLabel('Tag').fill('e2e');
  await page.getByRole('button', { name: 'Oś czasu' }).click();
  const timeline = page.getByRole('region', { name: 'Oś czasu dokumentów' });
  await expect(timeline.locator('.vis-timeline')).toBeVisible();
  await expect(timeline.locator('.vis-item.doc', { hasText: title })).toBeVisible();
  await page.getByRole('button', { name: 'Lista' }).click();
  await page.getByRole('button', { name: 'Zapisz teczkę' }).click();
  const savedSearchDialog = page.getByRole('dialog', { name: 'Zapisz teczkę' });
  await savedSearchDialog.getByLabel('Nazwa').fill(`E2E ${stamp}`);
  await expect(savedSearchDialog.getByText('Tag: e2e')).toBeVisible();
  await savedSearchDialog.getByRole('button', { name: 'Zapisz teczkę' }).click();
  await expect(savedSearchDialog).toBeHidden();
  await page.getByLabel('Tag').fill('');
  await page.getByRole('link', { name: `E2E ${stamp}`, exact: true }).click();
  await expect(page.getByRole('rowheader', { name: title, exact: true })).toBeVisible();
  await page.getByRole('rowheader', { name: title, exact: true }).click();
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

test('signs a source document from the detail page', async ({ page }) => {
  const stamp = Date.now();
  const title = `Podpis e2e ${stamp}`;
  const sourceName = `podpis-${stamp}.pdf`;
  const signedName = `podpis-${stamp}-podpisany.pdf`;
  const signedAgainName = `podpis-${stamp}-podpisany-2.pdf`;

  await signIn(page);
  await page.getByRole('link', { name: 'Dokumenty' }).click();
  await createSourceDocument(page, title, sourceName);

  const sourceSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: /Źródło/ }) });
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
});

test('updates the source and immediately transfers the current account signatures', async ({
  page,
}) => {
  const stamp = Date.now();
  const title = `Aktualizacja źródła e2e ${stamp}`;
  const sourceName = `aktualizacja-stara-${stamp}.pdf`;
  const replacementName = `aktualizacja-nowa-${stamp}.pdf`;
  const transferredName = `aktualizacja-nowa-${stamp}-podpisany.pdf`;

  await signIn(page);
  await page.getByRole('link', { name: 'Dokumenty' }).click();
  await createSourceDocument(page, title, sourceName);

  const sourceSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: /Źródło/ }) });
  await sourceSection.getByRole('button', { name: 'Podpisz' }).click();
  await signVisiblePdf(page);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await page.getByRole('button', { name: 'Więcej akcji', exact: true }).click();
  const updateSource = page.getByRole('menuitem', { name: 'Uaktualnij źródło' });
  await expect(updateSource).toBeEnabled();
  await updateSource.click();
  const updateDialog = page.getByRole('dialog', { name: 'Uaktualnij źródło' });
  await updateDialog.locator('input[type="file"]').setInputFiles({
    name: replacementName,
    mimeType: 'application/pdf',
    buffer: await validPdfBuffer(),
  });
  await updateDialog.getByRole('radio', { name: /Przenieś podpisy/u }).check();
  await updateDialog.getByRole('button', { name: 'Uaktualnij' }).click();
  await expect(updateDialog).toBeHidden();

  await expect(sourceSection.getByText(replacementName)).toBeVisible();
  await expect(sourceSection.getByText(sourceName)).toBeHidden();
  const signedSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: /Podpis cyfrowy/ }) });
  await expect(signedSection.getByText(transferredName)).toBeVisible();
  const preview = signedSection.getByLabel(`Podgląd pliku ${transferredName}`);
  const previewHref = await preview.getAttribute('href');
  if (!previewHref) throw new Error('Missing transferred signature preview href');
  const previewResponse = await page.request.get(previewHref);
  expect(previewResponse.ok()).toBe(true);
  expect(previewResponse.headers()['content-type']).toContain('application/pdf');
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
  await dialog.getByLabel('Strona').fill('Jan Kowalski');
  await enterPolishDate(dialog, 'Data podpisania', '02.08.2026');
  await dialog.getByRole('button', { name: 'Dodaj dokument' }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByRole('button', { name: 'Więcej akcji', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Usuń dokument' }).click();
  const deleteDialog = page.getByRole('dialog', { name: 'Przenieść dokument do kosza?' });
  await expect(
    deleteDialog.getByText('Dokument trafi do kosza. Możesz go później przywrócić.'),
  ).toBeVisible();
  await deleteDialog.getByRole('button', { name: 'Przenieś do kosza' }).click();

  await expect(page.getByRole('heading', { name: 'Dokumenty' })).toBeVisible();
  await page.getByRole('link', { name: /^Kosz( \d+)?$/ }).click();
  const trashRow = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: title, exact: true }) });
  await expect(trashRow).toBeVisible();
  await trashRow.getByRole('button', { name: 'Przywróć' }).click();
  await expect(page.getByRole('heading', { name: 'Kosz jest pusty' })).toBeVisible();

  await page.getByRole('link', { name: 'Dokumenty' }).click();
  await expect(page.getByRole('rowheader', { name: title, exact: true })).toBeVisible();
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
  await expect(page.getByRole('rowheader', { name: title, exact: true })).toBeVisible();
  await page.getByRole('rowheader', { name: title, exact: true }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Szkic. Dokument jest widoczny')).toBeVisible();
  let searchParams = new URL(page.url()).searchParams;
  expect(searchParams.get('q')).toBe(title);
  expect(searchParams.get('szkice')).toBe('true');

  await page.getByRole('button', { name: 'Zatwierdź' }).click();
  await expect(page.getByText('Szkic. Dokument jest widoczny')).toBeHidden();
  await page.getByRole('link', { name: '← Dokumenty' }).click();

  await expect(page.getByLabel('Szukaj po tytule')).toHaveValue(title);
  await expect(page.getByLabel('Szkice')).toContainText('Tylko szkice');
  await expect(page.getByRole('heading', { name: 'Brak wyników dla tych filtrów' })).toBeVisible();
  searchParams = new URL(page.url()).searchParams;
  expect(searchParams.get('q')).toBe(title);
  expect(searchParams.get('szkice')).toBe('true');
  expect(created.data.document.id.length).toBeGreaterThan(0);

  const bulkPrefix = `Szkice bulk e2e ${stamp}`;
  const firstBulkTitle = `${bulkPrefix} A`;
  const secondBulkTitle = `${bulkPrefix} B`;
  const bulkDrafts = await Promise.all(
    [firstBulkTitle, secondBulkTitle].map(async (draftTitle) => {
      const bulkResponse = await page.request.post('/api/documents', {
        data: {
          title: draftTitle,
          docType: 'inny',
          documentDate: '2026-08-03',
          person: 'Jan Kowalski',
          tags: ['e2e-draft'],
          draft: true,
        },
      });
      expect(bulkResponse.ok()).toBe(true);
      return documentCreateResponseSchema.parse(await bulkResponse.json());
    }),
  );

  await page.goto(`/app/documents?szkice=true&q=${encodeURIComponent(bulkPrefix)}`);
  const firstRow = page
    .getByRole('rowgroup')
    .filter({ has: page.getByRole('rowheader', { name: firstBulkTitle, exact: true }) });
  const secondRow = page
    .getByRole('rowgroup')
    .filter({ has: page.getByRole('rowheader', { name: secondBulkTitle, exact: true }) });
  await expect(firstRow).toBeVisible();
  await expect(secondRow).toBeVisible();
  await expect(firstRow.getByText('Szkic', { exact: true })).toBeVisible();
  await expect(secondRow.getByText('Szkic', { exact: true })).toBeVisible();
  await firstRow.getByRole('checkbox', { name: `Zaznacz dokument: ${firstBulkTitle}` }).click();
  await secondRow.getByRole('checkbox', { name: `Zaznacz dokument: ${secondBulkTitle}` }).click();
  await expect(page.getByRole('button', { name: 'Zatwierdź (2)' })).toBeEnabled();
  await page.getByRole('button', { name: 'Zatwierdź (2)' }).click();
  await expect(page.getByText('Zatwierdzono 2, błędów 0.')).toBeVisible();
  await expect(firstRow).toBeHidden();
  await expect(secondRow).toBeHidden();

  await page.getByLabel('Szkice').click();
  await page.getByRole('option', { name: 'Wszystkie' }).click();
  const approvedFirstRow = page
    .getByRole('rowgroup')
    .filter({ has: page.getByRole('rowheader', { name: firstBulkTitle, exact: true }) });
  const approvedSecondRow = page
    .getByRole('rowgroup')
    .filter({ has: page.getByRole('rowheader', { name: secondBulkTitle, exact: true }) });
  await expect(approvedFirstRow).toBeVisible();
  await expect(approvedSecondRow).toBeVisible();
  await expect(approvedFirstRow.getByText('Szkic', { exact: true })).toBeHidden();
  await expect(approvedSecondRow.getByText('Szkic', { exact: true })).toBeHidden();
  expect(bulkDrafts.map((draft) => draft.data.document.id)).toHaveLength(2);
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

test('mass signing can receive a signature from a QR pad browser context', async ({ browser, page }) => {
  test.setTimeout(60_000);
  const stamp = Date.now();
  const title = `QR pad e2e ${stamp}`;
  const sourceName = `qr-pad-${stamp}.pdf`;

  if (PRODUCT_PASS_SCREENSHOT_DIR) {
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  await signIn(page);
  await createDocumentWithFilesViaApi({
    page,
    title,
    docType: 'umowa-uod',
    files: [{ fileName: sourceName, role: 'source' }],
  });
  await page.goto('/app/documents');
  await page.getByLabel('Szukaj po tytule').fill(title);
  await expect
    .poll(() => new URL(page.url()).searchParams.get('q'))
    .toBe(title);
  await expect(page.getByRole('rowheader', { name: title, exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: `Zaznacz dokument: ${title}` }).click();
  await page.getByRole('button', { name: 'Masowe podpisywanie (1)' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expectReviewPdfFitsViewport(page);

  await page.getByRole('button', { name: 'Pad QR' }).click();
  await expect(page.getByRole('dialog', { name: 'Pad QR' })).toBeVisible();
  await expect(page.getByText('Może dołączyć każde konto organizacji.')).toBeVisible();
  await productPassScreenshot(page, 'e-qr-modal-shared-copy.png');
  await page.getByRole('button', { name: 'Schowaj kod QR' }).click();
  await expect(page.getByRole('dialog', { name: 'Pad QR' })).toBeHidden();

  const hostPadPage = await page.context().newPage();
  const padContext = await browser.newContext({ viewport: { width: 834, height: 720 } });
  try {
    await hostPadPage.goto('/app');
    await hostPadPage.getByRole('button', { name: 'Tryb pada' }).click();
    const guestPadPage = await padContext.newPage();
    await signInWithMagicLink(guestPadPage);
    await guestPadPage.getByRole('button', { name: 'Tryb pada' }).click();

    await expect(
      hostPadPage.getByRole('heading', { name: 'Możesz złożyć podpis' }),
    ).toBeVisible();
    await expect(
      guestPadPage.getByRole('heading', { name: 'Możesz złożyć podpis' }),
    ).toBeVisible();
    await expect(guestPadPage.getByText(title)).toBeVisible();
    await productPassScreenshot(guestPadPage, 'd-pad-shared-live-canvas-834.png');
    await page.bringToFront();
    await expect(page.getByText('Pad połączony')).toBeVisible();

    const submitFromPad = async (padPage: Page, offset: number) => {
      const padCanvas = padPage.getByRole('application', {
        name: 'Powierzchnia pada do podpisu',
      });
      await dispatchPointerStroke({
        canvas: padCanvas,
        pointerType: 'mouse',
        points: [
          { x: 0.18, y: 0.5 + offset },
          { x: 0.34, y: 0.36 + offset },
          { x: 0.52, y: 0.56 + offset },
          { x: 0.74, y: 0.4 + offset },
        ],
      });
      await expect(padPage.getByRole('button', { name: 'Zatwierdź' })).toBeEnabled();
      await padPage.getByRole('button', { name: 'Zatwierdź' }).click();
    };

    await submitFromPad(hostPadPage, 0);
    await submitFromPad(guestPadPage, 0.02);
    await page.bringToFront();
    await page.getByRole('button', { name: 'Poproś pad o podpis' }).click();
    await guestPadPage.bringToFront();
    await expect(guestPadPage.getByText('Prośba o podpis')).toBeVisible();
    await submitFromPad(guestPadPage, -0.02);
    await page.bringToFront();

    const tray = page.getByRole('button', {
      name: 'Podpisy: Demo User (1) · Magic Link User (2)',
    });
    await expect(tray).toBeVisible();
    await productPassScreenshot(page, 'a-desktop-toolbar-two-account-tray-1440.png');
    await tray.click();
    await expect(page.getByText('Podpisy do umieszczenia')).toBeVisible();
    await productPassScreenshot(page, 'b-tray-popover-open.png');

    await page.getByRole('button', { name: 'Umieść' }).first().click();
    await expect(page.getByText('Podpis: Demo User')).toBeVisible();
    await productPassScreenshot(page, 'c-placed-tray-stamp-selected-attribution.png');
    await dragSelectedStampLong(page);
    await page.getByRole('button', { name: 'Dalej' }).click();
    await expect(
      page.getByText('W skrzynce są nieumieszczone podpisy dla tego dokumentu.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Odrzuć i przejdź dalej' }).click();
    await expect(page.getByRole('heading', { name: 'Podsumowanie' })).toBeVisible();
    await expect(page.getByText('Podpisano 1')).toBeVisible();
  } finally {
    await hostPadPage.close();
    await padContext.close();
  }
});

test('mass review renders full-size and defaults each document to its best file', async ({
  page,
}) => {
  const stamp = Date.now();
  const signedTitle = `Mass review signed ${stamp}`;
  const sourceTitle = `Mass review source ${stamp}`;

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const signedDocumentId = await createDocumentWithFilesViaApi({
    page,
    title: signedTitle,
    docType: 'umowa-uod',
    files: [
      { fileName: `review-source-${stamp}.pdf`, role: 'source' },
      { fileName: `review-signed-${stamp}.pdf`, role: 'signed-digital' },
    ],
  });
  const sourceDocumentId = await createDocumentWithFilesViaApi({
    page,
    title: sourceTitle,
    docType: 'protokol',
    files: [{ fileName: `review-source-only-${stamp}.pdf`, role: 'source' }],
  });

  await page.goto(
    `/app/documents/${signedDocumentId}/review?kolejka=${signedDocumentId},${sourceDocumentId}`,
  );
  await expect(page.getByRole('heading', { name: signedTitle })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Podpisany', pressed: true })).toBeVisible();
  await expectReviewPdfFitsViewport(page);

  await page.getByRole('button', { name: 'Źródło' }).click();
  await expect(page.getByRole('button', { name: 'Źródło', pressed: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('tryb')).toBe('zrodlo');
  await expectReviewPdfFitsViewport(page);
  await page.getByRole('button', { name: 'Edycja' }).click();
  await expect(page.getByRole('button', { name: 'Edycja', pressed: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('tryb')).toBe('edycja');
  await expect(page.getByRole('textbox', { name: 'Tytuł' })).toHaveValue(signedTitle);
  await page.getByRole('button', { name: 'Podpisany' }).click();
  await expect(page.getByRole('button', { name: 'Podpisany', pressed: true })).toBeVisible();
  await expectReviewPdfFitsViewport(page);

  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.getByRole('heading', { name: sourceTitle })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Źródło', pressed: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('tryb')).toBeNull();
  await expectReviewPdfFitsViewport(page);
});

test('mass signing signs a document', async ({ page }) => {
  const stamp = Date.now();
  const title = `Mass sign e2e ${stamp}`;

  await signIn(page);
  await createDocumentWithFilesViaApi({
    page,
    title,
    docType: 'protokol',
    files: [{ fileName: `mass-sign-${stamp}.pdf`, role: 'source' }],
  });
  await page.getByRole('link', { name: 'Dokumenty' }).click();

  await page.getByLabel('Szukaj po tytule').fill(title);
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(title);
  await expect(page.getByRole('rowheader', { name: title, exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: `Zaznacz dokument: ${title}` }).click();
  await page.getByRole('button', { name: 'Masowe podpisywanie (1)' }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expectReviewPdfFitsViewport(page);
  await placeMassSignature(page, [
    { x: 0.18, y: 0.5 },
    { x: 0.42, y: 0.36 },
    { x: 0.66, y: 0.52 },
  ]);
  await page.getByRole('button', { name: 'Dalej' }).click();

  await expect(page.getByRole('heading', { name: 'Podsumowanie' })).toBeVisible();
  await expect(page.getByText('Podpisano 1')).toBeVisible();
  await expect(page.getByText('Pominięto 0')).toBeVisible();
  await page.getByRole('button', { name: 'Wróć do listy' }).click();
  await expect(page.getByLabel('Szukaj po tytule')).toHaveValue(title);
});

test('mass signing skips a document', async ({ page }) => {
  const stamp = Date.now();
  const title = `Mass skip e2e ${stamp}`;

  await signIn(page);
  await createDocumentWithFilesViaApi({
    page,
    title,
    docType: 'rachunek',
    files: [{ fileName: `mass-skip-${stamp}.pdf`, role: 'source' }],
  });
  await page.getByRole('link', { name: 'Dokumenty' }).click();

  await page.getByLabel('Szukaj po tytule').fill(title);
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(title);
  await expect(page.getByRole('rowheader', { name: title, exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: `Zaznacz dokument: ${title}` }).click();
  await page.getByRole('button', { name: 'Masowe podpisywanie (1)' }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expectReviewPdfFitsViewport(page);
  await page.getByRole('button', { name: 'Dalej' }).click();

  await expect(page.getByRole('heading', { name: 'Podsumowanie' })).toBeVisible();
  await expect(page.getByText('Podpisano 0')).toBeVisible();
  await expect(page.getByText('Pominięto 1')).toBeVisible();
  await page.getByRole('button', { name: 'Wróć do listy' }).click();
  await expect(page.getByLabel('Szukaj po tytule')).toHaveValue(title);
});

test('mass signing passes through an already signed document', async ({ page }) => {
  const stamp = Date.now();
  const titlePrefix = `Masowe podpisane e2e ${stamp}`;
  const title = `${titlePrefix} umowa`;
  const signedName = `masowe-podpisane-${stamp}.pdf`;

  await signIn(page);
  const documentId = await createDocumentWithFilesViaApi({
    page,
    title,
    docType: 'umowa-uod',
    files: [
      { fileName: `masowe-zrodlo-${stamp}.pdf`, role: 'source' },
      { fileName: signedName, role: 'signed-digital' },
    ],
  });
  await page.goto(`/app/documents/${documentId}`);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByRole('link', { name: '← Dokumenty' }).click();

  await page.getByLabel('Szukaj po tytule').fill(titlePrefix);
  await expect
    .poll(() => new URL(page.url()).searchParams.get('q'))
    .toBe(titlePrefix);
  await expect(page.getByRole('rowheader', { name: title, exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: `Zaznacz dokument: ${title}` }).click();
  await page.getByRole('button', { name: 'Masowe podpisywanie (1)' }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
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
  await page.getByRole('button', { name: 'Dalej' }).click();

  await expect(page.getByRole('heading', { name: 'Podsumowanie' })).toBeVisible();
  await expect(page.getByText('Podpisano 1')).toBeVisible();
});
