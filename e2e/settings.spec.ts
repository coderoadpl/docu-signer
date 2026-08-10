import { expect, test, type Page } from '@playwright/test';

const DEMO_EMAIL = 'demo@agentproofarch.dev';
const DEMO_PASSWORD = 'demo1234';

const signIn = async (page: Page): Promise<void> => {
  await page.goto('/login');
  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
};

test('account settings contains personal security controls and the archive-wide record setting', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Konto' }).click();

  await expect(page.getByRole('heading', { name: 'Konto', level: 1 })).toBeVisible();
  await expect(page.getByText(/przechowuj zapis podpisów/i)).toBeVisible();
  await expect(page.getByText(/^Hasło$/i)).toBeVisible();
  await expect(page.getByText(/uwierzytelnianie dwuskładnikowe/i)).toBeVisible();
  await expect(page.getByText(/klucze dostępu/i)).toBeVisible();
  await expect(page.getByText(/firma|domena|administrator/i)).toHaveCount(0);
});

test('registration creates an account without exposing tenant management', async ({ page }) => {
  const email = `e2e-reg-${String(Date.now())}@agentproofarch.dev`;
  await page.goto('/register');
  await page.getByLabel('Imię i nazwisko').fill('E2E User');
  await page.getByLabel('Adres e-mail').fill(email);
  await page.getByLabel('Hasło', { exact: true }).fill('registrant-pass-1');
  await page.getByRole('button', { name: 'Utwórz konto' }).click();

  await expect(page.getByText('Brak dostępu do archiwum')).toBeVisible();
  await expect(page.getByText(/utwórz firmę|zmień firmę/i)).toHaveCount(0);
});
