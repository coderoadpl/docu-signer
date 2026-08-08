import { expect, test, type Page } from '@playwright/test';

const DEMO_EMAIL = 'demo@agentproofarch.dev';
const DEMO_PASSWORD = 'demo1234';
const EMPTY_ME = {
  ok: true,
  data: {
    userId: 'u1',
    email: DEMO_EMAIL,
    name: 'Demo',
    tenant: null,
  },
};

// The login form renders a Google button only once /api/config answers; waiting
// for that response pins the screenshot to the settled form, not a half-built one.
const openLogin = async (page: Page): Promise<void> => {
  const config = page.waitForResponse('**/api/config');
  await page.goto('/login');
  await config;
  await expect(page.getByRole('heading', { name: 'Podpisy' })).toBeVisible();
};

const submitSignIn = async (page: Page): Promise<void> => {
  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
};

test('login page', async ({ page }) => {
  await openLogin(page);

  await expect(page).toHaveScreenshot('login.png', { fullPage: true });
});

test('login page with a rejected sign-in', async ({ page }) => {
  await openLogin(page);
  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill('wrong-password');
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();

  await expect(page).toHaveScreenshot('login-error.png', { fullPage: true });
});

test('register page', async ({ page }) => {
  await page.goto('/register');
  await expect(page.getByRole('button', { name: 'create account' })).toBeVisible();

  await expect(page).toHaveScreenshot('register.png', { fullPage: true });
});

test('authenticated app bar chrome', async ({ page }) => {
  await openLogin(page);
  await submitSignIn(page);

  const chrome = page.getByRole('banner');
  await expect(chrome.getByRole('button', { name: 'Switch tenant' })).toContainText('Acme Sp. z o.o.');

  await expect(chrome).toHaveScreenshot('app-shell-chrome.png');
});

test('StatusView loading inside AppShell', async ({ page }) => {
  await openLogin(page);
  await page.route('**/api/me', () => undefined);
  await submitSignIn(page);
  await expect(page.getByText('Ładowanie aplikacji…')).toBeVisible();

  await expect(page).toHaveScreenshot('layout-status-view-loading.png', { fullPage: true });
});

test('StatusView error inside AppShell', async ({ page }) => {
  await openLogin(page);
  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        error: { code: 'internal', message: 'visual status error' },
      }),
    });
  });
  await submitSignIn(page);
  await expect(page.getByRole('alert')).toContainText('visual status error');

  await expect(page).toHaveScreenshot('layout-status-view-error.png', { fullPage: true });
});

test('StatusView empty inside FocusCard', async ({ page }) => {
  await openLogin(page);
  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(EMPTY_ME),
    });
  });
  await page.route('**/api/tenants', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: { tenants: [] } }),
    });
  });
  await submitSignIn(page);
  await expect(
    page.getByRole('heading', { name: 'no tenant here yet — create one to get started' }),
  ).toBeVisible();

  await expect(page).toHaveScreenshot('layout-status-view-empty.png', { fullPage: true });
});
