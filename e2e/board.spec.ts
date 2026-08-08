import { expect, test, type Page } from '@playwright/test';

const DEMO_EMAIL = 'demo@agentproofarch.dev';
const DEMO_PASSWORD = 'demo1234';

const signIn = async (page: Page): Promise<void> => {
  await page.goto('/login');
  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zmień firmę' })).toContainText('Acme');
};

const COLUMN_LABELS: Record<string, string> = {
  todo: 'Do zrobienia',
  doing: 'W toku',
  done: 'Gotowe',
};

const column = (page: Page, name: string) =>
  page.locator(`section[aria-label="${COLUMN_LABELS[name] ?? name}"]`);

// Card titles render as the only <p> elements inside a column section. Other
// e2e workers never touch the board, but titles are filtered to this test's own
// cards anyway so a retry (leftover rows) cannot break order assertions.
const titlesIn = async (page: Page, columnName: string, mine: string[]): Promise<string[]> => {
  const texts = await column(page, columnName).locator('p').allTextContents();
  return texts.filter((text) => mine.includes(text));
};

const settled = async (page: Page): Promise<void> => {
  await expect(page.locator('section[aria-label] [aria-busy="true"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cofnij' })).toBeVisible();
};

test('board: add, reorder, persist across reload, move across columns, undo restores', async ({
  page,
}) => {
  const stamp = Date.now();
  const cardA = `e2e card A ${stamp}`;
  const cardB = `e2e card B ${stamp}`;
  const mine = [cardA, cardB];

  await signIn(page);
  await page.goto('/app/board');
  await expect(page.getByRole('heading', { name: 'Tablica' })).toBeVisible();

  await column(page, 'todo').getByLabel('Nowa karta w kolumnie Do zrobienia').fill(cardA);
  await column(page, 'todo').getByRole('button', { name: 'Dodaj' }).click();
  await expect(column(page, 'todo').getByText(cardA)).toBeVisible();
  await column(page, 'todo').getByLabel('Nowa karta w kolumnie Do zrobienia').fill(cardB);
  await column(page, 'todo').getByRole('button', { name: 'Dodaj' }).click();
  await expect(column(page, 'todo').getByText(cardB)).toBeVisible();
  await expect(page.locator('section[aria-label] [aria-busy="true"]')).toHaveCount(0);
  await expect.poll(() => titlesIn(page, 'todo', mine)).toEqual([cardA, cardB]);

  await page.getByRole('button', { name: `Przenieś ${cardB} w górę` }).click();
  await expect.poll(() => titlesIn(page, 'todo', mine)).toEqual([cardB, cardA]);
  await settled(page);

  // The order is server truth: it survives a reload, while the island store
  // (and with it the undo step) dies — exactly the two-machines contract.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tablica' })).toBeVisible();
  await expect.poll(() => titlesIn(page, 'todo', mine)).toEqual([cardB, cardA]);
  await expect(page.getByRole('button', { name: 'Cofnij' })).toHaveCount(0);

  await page.getByRole('button', { name: `Przenieś ${cardB} w prawo` }).click();
  await expect.poll(() => titlesIn(page, 'doing', mine)).toEqual([cardB]);
  await settled(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tablica' })).toBeVisible();
  await expect.poll(() => titlesIn(page, 'doing', mine)).toEqual([cardB]);
  await expect.poll(() => titlesIn(page, 'todo', mine)).toEqual([cardA]);

  await page.getByRole('button', { name: `Przenieś ${cardA} w prawo` }).click();
  await expect.poll(() => titlesIn(page, 'doing', mine)).toEqual([cardB, cardA]);
  await settled(page);
  await page.getByRole('button', { name: 'Cofnij' }).click();
  await expect.poll(() => titlesIn(page, 'todo', mine)).toEqual([cardA]);
  await expect.poll(() => titlesIn(page, 'doing', mine)).toEqual([cardB]);
  await expect(page.getByRole('button', { name: 'Cofnij' })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tablica' })).toBeVisible();
  await expect.poll(() => titlesIn(page, 'todo', mine)).toEqual([cardA]);
  await expect.poll(() => titlesIn(page, 'doing', mine)).toEqual([cardB]);
});
