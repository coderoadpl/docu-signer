import { expect, test, type Page } from '@playwright/test';

const DEMO_EMAIL = 'demo@agentproofarch.dev';
const DEMO_PASSWORD = 'demo1234';

// The login form renders a Google button only once /api/config answers; waiting
// for that response pins the screenshot to the settled form, not a half-built one.
const openLogin = async (page: Page): Promise<void> => {
  const config = page.waitForResponse('**/api/config');
  await page.goto('/login');
  await config;
  await expect(page.getByRole('heading', { name: 'agentproofarch' })).toBeVisible();
};

test('login page', async ({ page }) => {
  await openLogin(page);

  await expect(page).toHaveScreenshot('login.png', { fullPage: true });
});

test('login page with a rejected sign-in', async ({ page }) => {
  await openLogin(page);
  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill('wrong-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('alert')).toBeVisible();

  await expect(page).toHaveScreenshot('login-error.png', { fullPage: true });
});

test('register page', async ({ page }) => {
  await page.goto('/register');
  await expect(page.getByRole('button', { name: 'create account' })).toBeVisible();

  await expect(page).toHaveScreenshot('register.png', { fullPage: true });
});

// The seeded ledger rows share one createdAt, so their order is a database tie
// and their rendered date is the day the seed ran: the list is not a stable
// surface. The shell chrome around it is fully determined by the seed.
test('authenticated app shell chrome', async ({ page }) => {
  await openLogin(page);
  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  const chrome = page.getByRole('banner');
  await expect(chrome.getByRole('button', { name: 'Switch tenant' })).toContainText('Acme Sp. z o.o.');

  await expect(chrome).toHaveScreenshot('app-shell-chrome.png');
});
