import { expect, test } from '@playwright/test';

import { fetchMagicLink } from '../scripts/mailpit.js';

const MAGIC_USER = 'mag@example.com';
const MAILPIT_API_URL = 'http://localhost:47980';

test('magic link signs in a trusted archive user', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#login-email').fill(MAGIC_USER);
  await page.getByRole('button', { name: 'Wyślij link do logowania' }).click();

  await expect(page.getByText(/znajdziesz w Mailpit/i)).toBeVisible();

  const link = await fetchMagicLink(MAILPIT_API_URL, MAGIC_USER);
  expect(link).toContain('magic-link/verify');

  await page.goto(link);

  await expect(page.getByRole('heading', { name: 'Dokumenty' })).toBeVisible();

  const me = await page.request.get('/api/me');
  const meBody = await me.json();
  expect(meBody.ok).toBe(true);
  expect(meBody.data.email).toBe(MAGIC_USER);
  expect(meBody.data.tenant.slug).toBe('default');
});
