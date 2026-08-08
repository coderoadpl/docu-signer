import { expect, test } from '@playwright/test';

import { fetchMagicLink } from '../scripts/mailpit.js';

// US-026 end to end over the real stack: a provisioned member (seeded
// `mag@example.com`, null userId in the acme tenant) requests a passwordless
// magic link from the login page. The real smtp transport delivers to the dev/CI
// Mailpit (no dev route); the test reads the captured message back over Mailpit's
// HTTP API, follows the link, and lands authenticated with the member bound.
const PROVISIONED_MEMBER = 'mag@example.com';
const MAILPIT_API_URL = 'http://localhost:47980';

test('magic link signs in a provisioned member and binds them to the tenant', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#login-email').fill(PROVISIONED_MEMBER);
  await page.getByRole('button', { name: 'Wyślij link do logowania' }).click();

  await expect(page.getByText(/znajdziesz w Mailpit/i)).toBeVisible();

  const link = await fetchMagicLink(MAILPIT_API_URL, PROVISIONED_MEMBER);
  expect(link).toContain('magic-link/verify');

  await page.goto(link);

  await expect(page.getByRole('button', { name: 'Zmień firmę' })).toContainText(/acme/i);

  const me = await page.request.get('/api/me');
  const meBody = await me.json();
  expect(meBody.ok).toBe(true);
  expect(meBody.data.email).toBe(PROVISIONED_MEMBER);
  expect(meBody.data.tenant.memberId).toBe('member-acme-mag');
});
