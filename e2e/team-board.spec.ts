import { expect, test, type Page } from '@playwright/test';

const signIn = async (page: Page): Promise<void> => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Podpisy' })).toBeVisible();
  await page.getByLabel('Adres e-mail').fill('demo@agentproofarch.dev');
  await page.getByLabel('Hasło').fill('demo1234');
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zmień firmę' })).toContainText('Acme');
};

const COLUMN_LABELS: Record<string, string> = {
  todo: 'Do zrobienia',
  'in-dev': 'W realizacji',
  review: 'Weryfikacja',
  done: 'Gotowe',
};

const column = (page: Page, name: string) =>
  page.locator(`section[aria-label="${COLUMN_LABELS[name] ?? name}"]`);

// Card titles render as the only <p> elements inside a column section; filter to
// this attempt's own cards so retries and parallel runs never interfere.
const titlesIn = async (page: Page, columnName: string, mine: string[]): Promise<string[]> => {
  const texts = await column(page, columnName).locator('p').allTextContents();
  return texts.filter((text) => mine.includes(text));
};

const addCard = async (page: Page, title: string): Promise<void> => {
  await column(page, 'todo').getByLabel('Nowa karta w kolumnie Do zrobienia').fill(title);
  await column(page, 'todo').getByRole('button', { name: 'Dodaj' }).click();
  await expect(column(page, 'todo').getByText(title)).toBeVisible();
};

const settled = async (page: Page): Promise<void> => {
  await expect(page.locator('section[aria-label] [aria-busy="true"]')).toHaveCount(0);
};

const moveTo = async (page: Page, title: string, target: string): Promise<void> => {
  await page.getByRole('button', {
    name: `Przenieś ${title} do kolumny ${COLUMN_LABELS[target] ?? target}`,
  }).click();
};

// The WIP counter reads "occupancy of limit" — the spec fills in-dev to its
// limit RELATIVE to whatever the database already holds (a failed attempt's
// leftovers included), so the test is idempotent across retries.
const inDevOccupancy = async (page: Page): Promise<number> => {
  const label = await column(page, 'in-dev')
    .getByLabel(/W realizacji: praca w toku/)
    .textContent();
  const occupancy = Number((label ?? '0/3').split('/')[0]);
  return Number.isNaN(occupancy) ? 0 : occupancy;
};

test('team board: entry column only, WIP guard blocks visibly and releases, legal chain persists', async ({
  page,
}) => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const walker = `e2e team walker ${stamp}`;

  await signIn(page);
  await page.goto('/app/team-board');
  await expect(page.getByRole('heading', { name: 'Tablica zespołu' })).toBeVisible();
  await settled(page);

  await expect(page.getByLabel('Nowa karta w kolumnie Do zrobienia')).toBeVisible();
  await expect(page.getByLabel('Nowa karta w kolumnie Gotowe')).toHaveCount(0);
  await expect(page.getByLabel('Nowa karta w kolumnie Weryfikacja')).toHaveCount(0);

  const fillers: string[] = [];
  let occupancy = await inDevOccupancy(page);
  while (occupancy < 3) {
    const filler = `e2e team filler ${fillers.length} ${stamp}`;
    fillers.push(filler);
    await addCard(page, filler);
    await moveTo(page, filler, 'in-dev');
    await expect.poll(() => inDevOccupancy(page)).toBeGreaterThan(occupancy);
    occupancy += 1;
  }
  await addCard(page, walker);
  await settled(page);

  const blockedMove = page.getByRole('button', {
    name: `Przenieś ${walker} do kolumny W realizacji (zablokowane: limit pracy w toku)`,
  });
  await expect(blockedMove).toBeVisible();
  await expect(blockedMove).toBeDisabled();
  await expect(column(page, 'todo').getByText('zablokowane: limit pracy w toku').first()).toBeVisible();

  // Free a slot: the guard releases and the same move becomes enabled. Any
  // in-dev card will do — prefer one of ours, fall back to a leftover.
  const inDevMine = await titlesIn(page, 'in-dev', fillers);
  const leftover = await column(page, 'in-dev').locator('p').first().textContent();
  const toRelease = inDevMine[0] ?? leftover ?? '';
  await moveTo(page, toRelease, 'review');
  await expect(page.getByRole('button', { name: `Przenieś ${walker} do kolumny W realizacji` })).toBeEnabled();
  await moveTo(page, toRelease, 'done');
  await settled(page);

  // The legal chain: todo -> in-dev -> review -> done, each step an enabled
  // button (the oracle allows it). Drain our cards into the unbounded done
  // column so retries never inherit saturated WIP columns from us.
  await moveTo(page, walker, 'in-dev');
  await expect.poll(() => titlesIn(page, 'in-dev', [walker])).toContain(walker);
  await moveTo(page, walker, 'review');
  await moveTo(page, walker, 'done');
  await expect.poll(() => titlesIn(page, 'done', [walker])).toContain(walker);
  for (const filler of fillers.filter((title) => title !== toRelease)) {
    await moveTo(page, filler, 'review');
    await expect.poll(() => titlesIn(page, 'review', [filler])).toContain(filler);
    await moveTo(page, filler, 'done');
    await expect.poll(() => titlesIn(page, 'done', [filler])).toContain(filler);
  }
  await settled(page);

  // Reload: the island store dies, the server truth does not — positions AND
  // the verdicts survive, because `visited` history is recorded server-side.
  // The walker walked through in-dev, so moving back into review is allowed.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tablica zespołu' })).toBeVisible();
  await expect.poll(() => titlesIn(page, 'done', [walker])).toContain(walker);
  await expect(page.getByRole('button', { name: `Przenieś ${walker} do kolumny Weryfikacja` })).toBeEnabled();
});
