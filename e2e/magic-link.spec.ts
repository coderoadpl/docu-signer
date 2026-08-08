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
  await page.getByRole('button', { name: /email me a sign-in link/i }).click();

  // The request is confirmed on the page without exposing the link.
  await expect(page.getByText(/captured by mailpit/i)).toBeVisible();

  // Recover the captured link from Mailpit (as a human would from the inbox).
  const link = await fetchMagicLink(MAILPIT_API_URL, PROVISIONED_MEMBER);
  expect(link).toContain('magic-link/verify');

  await page.goto(link);

  // The verify redirects to the app shell; localhost resolves to acme, and the
  // now-bound member sees the authenticated shell for that tenant (the switcher
  // shows the acme slug — a member is not staff, so it has no tenant-name roster).
  await expect(page.getByRole('button', { name: 'Switch tenant' })).toContainText(/acme/i);

  // The bound identity is the provisioned member's email (not the demo owner).
  const me = await page.request.get('/api/me');
  const meBody = await me.json();
  expect(meBody.ok).toBe(true);
  expect(meBody.data.email).toBe(PROVISIONED_MEMBER);
  expect(meBody.data.tenant.memberId).toBe('member-acme-mag');
});
