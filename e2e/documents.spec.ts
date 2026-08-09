import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const DEMO_EMAIL = 'demo@agentproofarch.dev';
const DEMO_PASSWORD = 'demo1234';

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

const useSignaturePad = async (
  page: Page,
  points: Array<{ x: number; y: number }>,
) => {
  await page.getByRole('button', { name: 'Złóż podpis' }).click();
  const dialog = page.getByRole('dialog', { name: 'Złóż podpis' });
  const canvas = dialog.getByRole('application', {
    name: 'Powierzchnia do złożenia podpisu',
  });
  await drawOnCanvas(page, canvas, points);
  await dialog.getByRole('button', { name: 'Użyj podpisu' }).click();
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

const signIn = async (page: Page) => {
  await page.goto('/login');
  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
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
  await dialog.getByText('Okres').click();
  await dialog.getByLabel('Od', { exact: true }).fill('2026-01-01');
  await dialog.getByLabel('Do', { exact: true }).fill('2026-12-31');
  await dialog.getByRole('button', { name: 'Dodaj dokument' }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Data podpisania: 01.01.2026')).toBeVisible();
  await expect(page.getByText('Okres: 01.01.2026 - 31.12.2026')).toBeVisible();

  await page.getByRole('button', { name: '← Dokumenty' }).click();
  await page.getByLabel('Tag').fill('e2e');
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
  await dialog.getByLabel('Data podpisania').fill('2026-08-02');
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
