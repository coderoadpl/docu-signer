import { expect, test, type Page } from '@playwright/test';

const DEMO_EMAIL = 'demo@agentproofarch.dev';
const DEMO_PASSWORD = 'demo1234';
const SEEDED_TODO = 'Wdrożyć walking skeleton na produkcję';

const signIn = async (page: Page, password: string): Promise<void> => {
  await page.goto('/login');
  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
};

test('login lands on documents and the ledger still shows seeded todos', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Podpisy' })).toBeVisible();

  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Zmień firmę' })).toContainText('Acme');
  await expect(page.getByRole('heading', { name: 'Dokumenty' })).toBeVisible();
  await page.getByRole('link', { name: 'Rejestr' }).click();
  await expect(page.getByText(SEEDED_TODO)).toBeVisible();
});

test('adding a todo shows it in the list without a reload', async ({ page }) => {
  await signIn(page, DEMO_PASSWORD);
  await page.getByRole('link', { name: 'Rejestr' }).click();
  await expect(page.getByText(SEEDED_TODO)).toBeVisible();

  const title = `e2e entry ${Date.now()}`;
  await page.getByLabel('Tytuł nowego wpisu').fill(title);
  await page.getByRole('button', { name: /Dodaj/i }).click();

  await expect(page.getByText(title)).toBeVisible();
});

test('a wrong password surfaces an error', async ({ page }) => {
  await signIn(page, 'wrong-password');

  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zmień firmę' })).toHaveCount(0);
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
    await expect(page.getByLabel('Adres e-mail')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dodaj' })).toHaveCount(0);
  }
});
