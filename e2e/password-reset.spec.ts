import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { fetchPasswordResetLink } from '../scripts/mailpit.js';

const MAILPIT_API_URL = 'http://localhost:9980';
const OLD_PASSWORD = 'stare-haslo-1';
const NEW_PASSWORD = 'nowe-haslo-1';

test('reset link sets a new password and the old one stops working', async ({ page }) => {
  const email = `reset-${randomUUID()}@example.com`;

  await page.goto('/register');
  await page.locator('#register-name').fill('Reset User');
  await page.locator('#register-email').fill(email);
  await page.locator('#register-password').fill(OLD_PASSWORD);
  await page.getByRole('button', { name: 'Utwórz konto' }).click();
  await expect(page.getByText('Brak dostępu do archiwum')).toBeVisible();

  await page.getByRole('button', { name: 'Wyloguj się' }).click();
  await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Nie pamiętasz hasła?' }).click();
  await page.locator('#forgot-email').fill(email);
  await page.getByRole('button', { name: 'Wyślij link resetowania' }).click();
  await expect(page.getByText(/Jeśli ten adres ma konto/i)).toBeVisible();

  const link = await fetchPasswordResetLink(MAILPIT_API_URL, email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password\?token=/);

  await page.locator('#reset-password').fill(NEW_PASSWORD);
  await page.locator('#reset-password-confirm').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Ustaw nowe hasło' }).click();
  await expect(page.getByText(/Hasło zostało zmienione/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toBeVisible();

  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(OLD_PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/Nieprawidłowy adres e-mail lub hasło/i);

  await page.locator('#login-password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.getByText('Brak dostępu do archiwum')).toBeVisible();
});

test('reset page refuses a link without a token', async ({ page }) => {
  await page.goto('/reset-password');
  await expect(page.getByRole('alert')).toContainText(/nieprawidłowy albo wygasł/i);
  await expect(page.getByRole('link', { name: 'Poproś o nowy link' })).toBeVisible();
});
