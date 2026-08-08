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

  // The authenticated shell resolves the tenant from the host (localhost = acme)
  // and shows it in the header switcher; the seeded ledger renders below.
  await expect(page.getByRole('button', { name: 'Switch tenant' })).toContainText('Acme');
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
  await expect(page.getByRole('button', { name: 'Switch tenant' })).toHaveCount(0);
});

test('tenant-scoped API responses are never cached', async ({ page }) => {
  const response = await page.request.get('/api/health');
  expect(response.headers()['cache-control']).toBe('no-store');
});

test('liveness is 200 with attestation and never gates on the database', async ({ page }) => {
  const response = await page.request.get('/api/health/live');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.ok).toBe(true);
  expect(body.data.status).toBe('ok');
  expect(typeof body.data.sha).toBe('string');
  expect(typeof body.data.version).toBe('string');
});

test('readiness is 200 with database up when the stack is healthy', async ({ page }) => {
  const response = await page.request.get('/api/health/ready');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.ok).toBe(true);
  expect(body.data.database).toBe('up');
});

test('anonymous visitors are redirected off the boards to login', async ({ page }) => {
  for (const path of ['/app/board', '/app/team-board']) {
    await page.goto(path);
    // The redirect must land on the login form, and no operable board shell
    // (add-card form) may ever be shown to an anonymous visitor.
    await expect(page.getByLabel('email')).toBeVisible();
    await expect(page.getByRole('button', { name: 'add' })).toHaveCount(0);
  }
});
