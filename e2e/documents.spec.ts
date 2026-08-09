import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const DEMO_EMAIL = 'demo@agentproofarch.dev';
const DEMO_PASSWORD = 'demo1234';

const validPdfBuffer = async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  return Buffer.from(await pdf.save());
};

const signVisiblePdf = async (page: Page) => {
  await expect(
    page.getByRole('heading', { name: 'Podpisz dokument' }),
  ).toBeVisible();
  await expect(page.getByText('Strona 1 z 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Czarny' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Granatowy' })).toBeVisible();
  await page.getByRole('button', { name: 'Granatowy' }).click();
  const canvas = page.getByRole('application', {
    name: 'Powierzchnia do rysowania podpisu',
  });
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing signing surface bounds');
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.58);
  await page.mouse.up();
  const save = page.getByRole('button', { name: 'Zapisz podpisany PDF' });
  await expect(save).toBeEnabled();
  await save.click();
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

  await page.goto('/login');
  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();

  await page.getByRole('link', { name: 'Dokumenty' }).click();
  await expect(
    page.getByRole('heading', { name: 'Dokumenty' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Dodaj dokument' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Dodaj dokument' });
  await dialog.getByRole('textbox', { name: 'Tytuł' }).fill(title);
  await dialog.getByLabel('Osoba').fill('Jan Kowalski');
  await dialog.getByLabel('Tagi').fill('e2e, podpis');
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

  await expect(
    page.locator(`object[aria-label="Podgląd: ${sourceName}"]`),
  ).toBeVisible();
  await expect(
    page.locator(`object[aria-label="Podgląd: ${signedName}"]`),
  ).toBeVisible();
  await expect(
    scanSection.getByText(scanName),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await sourceSection.getByRole('link', { name: 'Eksportuj' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('umowa-e2e');
});
