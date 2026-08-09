import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const DEMO_EMAIL = 'demo@agentproofarch.dev';
const DEMO_PASSWORD = 'demo1234';

const validPdfBuffer = async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  return Buffer.from(await pdf.save());
};

test('creates, uploads, previews and exports an archived document', async ({
  page,
}) => {
  const stamp = Date.now();
  const title = `Umowa e2e ${stamp}`;
  const sourceName = `umowa-${stamp}.pdf`;
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
  await expect(
    page.getByRole('heading', { name: 'Podpisz dokument' }),
  ).toBeVisible();
  await expect(page.getByText('Strona 1 z 1')).toBeVisible();
  await expect(
    page.getByRole('application', {
      name: 'Powierzchnia do rysowania podpisu',
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Zamknij' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

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
    page.getByRole('img', { name: `Podgląd: ${scanName}` }),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await sourceSection.getByRole('link', { name: 'Eksportuj' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('umowa-e2e');
});
