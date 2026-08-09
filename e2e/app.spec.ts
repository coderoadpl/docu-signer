import { expect, test, type Page } from '@playwright/test';

const DEMO_EMAIL = 'demo@agentproofarch.dev';
const DEMO_PASSWORD = 'demo1234';

const signIn = async (page: Page, password = DEMO_PASSWORD): Promise<void> => {
  await page.goto('/login');
  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
};

test('login lands on the document archive with product-only navigation', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Dokumenty' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Dokumenty' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Konto' })).toBeVisible();
  await expect(page.getByText(/rejestr|tablica|członkowie/i)).toHaveCount(0);
});

test('a wrong password surfaces an error', async ({ page }) => {
  await signIn(page, 'wrong-password');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dokumenty' })).toHaveCount(0);
});

test('API responses are no-store and health endpoints are attested', async ({ page }) => {
  const health = await page.request.get('/api/health');
  expect(health.headers()['cache-control']).toBe('no-store');

  const live = await page.request.get('/api/health/live');
  expect(live.status()).toBe(200);
  expect(await live.json()).toMatchObject({
    ok: true,
    data: { status: 'ok' },
  });

  const ready = await page.request.get('/api/health/ready');
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toMatchObject({
    ok: true,
    data: { database: 'up' },
  });
});

test('anonymous visitors are redirected from archive routes to login', async ({ page }) => {
  for (const path of ['/app/documents', '/app/settings']) {
    await page.goto(path);
    await expect(page.getByLabel('Adres e-mail')).toBeVisible();
  }
});
