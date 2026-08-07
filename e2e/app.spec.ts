import { expect, test, type Page } from '@playwright/test';

const DEMO_EMAIL = 'demo@agentproofarch.dev';
const DEMO_PASSWORD = 'demo1234';
// Seeded for the acme tenant (adapters/db/seed.ts); localhost resolves to acme.
const SEEDED_TODO = 'Wdrożyć walking skeleton na produkcję';

const signIn = async (page: Page, password: string): Promise<void> => {
  await page.goto('/login');
  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
};

test('login lands on the tenant ledger with seeded todos', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'agentproofarch' })).toBeVisible();

  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page.getByRole('heading', { name: 'Acme Sp. z o.o.' })).toBeVisible();
  await expect(page.getByText(SEEDED_TODO)).toBeVisible();
});

test('adding a todo shows it in the list without a reload', async ({ page }) => {
  await signIn(page, DEMO_PASSWORD);
  await expect(page.getByText(SEEDED_TODO)).toBeVisible();

  const title = `e2e entry ${Date.now()}`;
  await page.getByLabel('New todo title').fill(title);
  await page.getByRole('button', { name: /add/i }).click();

  await expect(page.getByText(title)).toBeVisible();
});

test('a wrong password surfaces an error', async ({ page }) => {
  await signIn(page, 'wrong-password');

  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Acme Sp. z o.o.' })).toHaveCount(0);
});

test('tenant-scoped API responses are never cached', async ({ page }) => {
  const response = await page.request.get('/api/health');
  expect(response.headers()['cache-control']).toBe('no-store');
});
