import { expect, test, type Page } from '@playwright/test';

const DEMO_EMAIL = 'demo@agentproofarch.dev';
const DEMO_PASSWORD = 'demo1234';

const signIn = async (page: Page): Promise<void> => {
  await page.goto('/login');
  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('button', { name: 'Switch tenant' })).toContainText('Acme');
};

const column = (page: Page, name: string) => page.locator(`section[aria-label="${name}"]`);

// Card titles render as the only <p> elements inside a column section. Other
// e2e workers never touch the board, but titles are filtered to this test's own
// cards anyway so a retry (leftover rows) cannot break order assertions.
const titlesIn = async (page: Page, columnName: string, mine: string[]): Promise<string[]> => {
  const texts = await column(page, columnName).locator('p').allTextContents();
  return texts.filter((text) => mine.includes(text));
};

const settled = async (page: Page): Promise<void> => {
  await expect(page.locator('section[aria-label] [aria-busy="true"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'undo' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();

  // Add two cards to todo; wait until the optimistic rows reconcile.
  await column(page, 'todo').getByLabel('New card in todo').fill(cardA);
  await column(page, 'todo').getByRole('button', { name: 'add' }).click();
  await expect(column(page, 'todo').getByText(cardA)).toBeVisible();
  await column(page, 'todo').getByLabel('New card in todo').fill(cardB);
  await column(page, 'todo').getByRole('button', { name: 'add' }).click();
  await expect(column(page, 'todo').getByText(cardB)).toBeVisible();
  await expect(page.locator('section[aria-label] [aria-busy="true"]')).toHaveCount(0);
  await expect.poll(() => titlesIn(page, 'todo', mine)).toEqual([cardA, cardB]);

  // Reorder within the column via the accessible buttons.
  await page.getByRole('button', { name: `Move ${cardB} up` }).click();
  await expect.poll(() => titlesIn(page, 'todo', mine)).toEqual([cardB, cardA]);
  await settled(page);

  // The order is server truth: it survives a reload, while the island store
  // (and with it the undo step) dies — exactly the two-machines contract.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();
  await expect.poll(() => titlesIn(page, 'todo', mine)).toEqual([cardB, cardA]);
  await expect(page.getByRole('button', { name: 'undo' })).toHaveCount(0);

  // Cross-column move persists too.
  await page.getByRole('button', { name: `Move ${cardB} right` }).click();
  await expect.poll(() => titlesIn(page, 'doing', mine)).toEqual([cardB]);
  await settled(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();
  await expect.poll(() => titlesIn(page, 'doing', mine)).toEqual([cardB]);
  await expect.poll(() => titlesIn(page, 'todo', mine)).toEqual([cardA]);

  // Move A over to doing as well, then undo — A returns to todo.
  await page.getByRole('button', { name: `Move ${cardA} right` }).click();
  await expect.poll(() => titlesIn(page, 'doing', mine)).toEqual([cardB, cardA]);
  await settled(page);
  await page.getByRole('button', { name: 'undo' }).click();
  await expect.poll(() => titlesIn(page, 'todo', mine)).toEqual([cardA]);
  await expect.poll(() => titlesIn(page, 'doing', mine)).toEqual([cardB]);
  // The undo move committed and consumed the single undo step.
  await expect(page.getByRole('button', { name: 'undo' })).toHaveCount(0);

  // And the restored layout is durable.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();
  await expect.poll(() => titlesIn(page, 'todo', mine)).toEqual([cardA]);
  await expect.poll(() => titlesIn(page, 'doing', mine)).toEqual([cardB]);
});
