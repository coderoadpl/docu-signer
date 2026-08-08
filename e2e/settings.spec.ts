import { expect, test, type Page } from '@playwright/test';

const DEMO_EMAIL = 'demo@agentproofarch.dev';
const DEMO_PASSWORD = 'demo1234';

const signInDemo = async (page: Page): Promise<void> => {
  await page.goto('/login');
  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zmień firmę' })).toContainText('Acme');
};

const registerAccount = async (page: Page, email: string): Promise<void> => {
  await page.goto('/register');
  await page.getByLabel('name').fill('Staff Target');
  await page.getByLabel('email').fill(email);
  await page.getByLabel('password').fill('staff-target-1');
  await page.getByRole('button', { name: 'Utwórz konto' }).click();
  await expect(page.getByLabel('Nazwa nowej firmy')).toBeVisible();
};

test('register lands the new user in /app onboarding and creates the first tenant', async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-reg-${stamp}@agentproofarch.dev`;
  const tenantName = `E2E First ${stamp}`;

  await page.goto('/register');
  await page.getByLabel('name').fill('E2E Registrant');
  await page.getByLabel('email').fill(email);
  await page.getByLabel('password').fill('registrant-pass-1');
  await page.getByRole('button', { name: 'Utwórz konto' }).click();

  await expect(page.getByLabel('Nazwa nowej firmy')).toBeVisible();

  await page.getByLabel('Nazwa nowej firmy').fill(tenantName);
  await page.getByRole('button', { name: 'Utwórz firmę' }).click();

  await expect(page.getByRole('link', { name: new RegExp(tenantName) })).toBeVisible();
});

test('an owner creates a tenant and sees it in the header switcher', async ({ page }) => {
  const stamp = Date.now();
  const tenantName = `E2E Brand ${stamp}`;

  await signInDemo(page);
  await page.goto('/app/settings');
  await page.getByLabel('Nazwa nowej firmy').fill(tenantName);
  await page.getByRole('button', { name: 'Utwórz firmę' }).click();

  await expect(page.getByText(new RegExp(tenantName))).toBeVisible();

  await page.getByRole('button', { name: 'Zmień firmę' }).click();
  await expect(page.getByRole('menu')).toContainText(tenantName);
});

test('an owner grants then revokes admin access, gated by a confirmation dialog', async ({ page, browser }) => {
  const stamp = Date.now();
  const email = `e2e-staff-${stamp}@agentproofarch.dev`;

  // Register the grant target in an isolated browser context so its session
  // cookie never lands in the context the owner drives below.
  const targetContext = await browser.newContext();
  await registerAccount(await targetContext.newPage(), email);
  await targetContext.close();

  await signInDemo(page);
  await page.goto('/app/settings/staff');
  await page.getByLabel('E-mail nowego administratora').fill(email);
  await page.getByRole('button', { name: 'grant ↵' }).click();
  await expect(page.getByText(email)).toBeVisible();

  const row = page.getByRole('listitem').filter({ hasText: email });
  await row.getByRole('button', { name: 'Odbierz' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText(email)).toHaveCount(0);
});

test('an owner adds, checks and removes a custom domain', async ({ page }) => {
  const stamp = Date.now();
  const domain = `shop-${stamp}.acme.test`;

  await signInDemo(page);
  await page.goto('/app/settings/domains');

  await expect(page.getByText(/CNAME record pointing your domain at apps\.agentproofarch\.test/)).toBeVisible();

  await page.getByLabel('Nowa domena').fill(domain);
  await page.getByRole('button', { name: 'Dodaj domenę' }).click();

  const row = page.getByRole('listitem').filter({ hasText: domain });
  await expect(row).toContainText('pending');

  await row.getByRole('button', { name: 'check' }).click();
  await expect(row).toContainText('verified');

  await row.getByRole('button', { name: 'remove' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText(domain)).toHaveCount(0);
});
