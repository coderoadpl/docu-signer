import { expect, test, type Page } from '@playwright/test';

const DEMO_EMAIL = 'demo@agentproofarch.dev';
const DEMO_PASSWORD = 'demo1234';

const signInDemo = async (page: Page): Promise<void> => {
  await page.goto('/login');
  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('button', { name: 'Switch tenant' })).toContainText('Acme');
};

/** Register an account through the UI in a throwaway context (its own cookie jar). */
const registerAccount = async (page: Page, email: string): Promise<void> => {
  await page.goto('/register');
  await page.getByLabel('name').fill('Staff Target');
  await page.getByLabel('email').fill(email);
  await page.getByLabel('password').fill('staff-target-1');
  await page.getByRole('button', { name: 'create account' }).click();
  await expect(page.getByLabel('New tenant name')).toBeVisible();
};

test('register lands the new user in /app onboarding and creates the first tenant', async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-reg-${stamp}@agentproofarch.dev`;
  const tenantName = `E2E First ${stamp}`;

  await page.goto('/register');
  await page.getByLabel('name').fill('E2E Registrant');
  await page.getByLabel('email').fill(email);
  await page.getByLabel('password').fill('registrant-pass-1');
  await page.getByRole('button', { name: 'create account' }).click();

  // The new user has no access to the acme tenant this host resolves to, so the
  // authenticated shell lands them on the create-tenant onboarding (US-016).
  await expect(page.getByLabel('New tenant name')).toBeVisible();

  await page.getByLabel('New tenant name').fill(tenantName);
  await page.getByRole('button', { name: 'create tenant' }).click();

  // The freshly-created tenant (with its owner row) appears as a switch link.
  await expect(page.getByRole('link', { name: new RegExp(tenantName) })).toBeVisible();
});

test('an owner creates a tenant and sees it in the header switcher', async ({ page }) => {
  const stamp = Date.now();
  const tenantName = `E2E Brand ${stamp}`;

  await signInDemo(page);
  await page.goto('/app/settings');
  await page.getByLabel('New tenant name').fill(tenantName);
  await page.getByRole('button', { name: 'create tenant' }).click();

  await expect(page.getByText(new RegExp(tenantName))).toBeVisible();

  await page.getByRole('button', { name: 'Switch tenant' }).click();
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
  await page.getByLabel('Grant admin email').fill(email);
  await page.getByRole('button', { name: 'grant ↵' }).click();
  await expect(page.getByText(email)).toBeVisible();

  const row = page.getByRole('listitem').filter({ hasText: email });
  await row.getByRole('button', { name: 'revoke' }).click();
  // The mutation is gated: it fires only after confirming in the dialog.
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText(email)).toHaveCount(0);
});

test('an owner adds, checks and removes a custom domain', async ({ page }) => {
  const stamp = Date.now();
  const domain = `shop-${stamp}.acme.test`;

  await signInDemo(page);
  await page.goto('/app/settings/domains');

  // The add flow shows the DNS record derived from SELF_HOST_TARGET_CNAME.
  await expect(page.getByText(/CNAME record pointing your domain at apps\.agentproofarch\.test/)).toBeVisible();

  await page.getByLabel('New domain').fill(domain);
  await page.getByRole('button', { name: 'add domain' }).click();

  const row = page.getByRole('listitem').filter({ hasText: domain });
  await expect(row).toContainText('pending');

  // The noop provisioner resolves every domain, so check flips it to verified.
  await row.getByRole('button', { name: 'check' }).click();
  await expect(row).toContainText('verified');

  await row.getByRole('button', { name: 'remove' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText(domain)).toHaveCount(0);
});
