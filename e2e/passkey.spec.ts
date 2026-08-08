import { expect, test, type Page } from '@playwright/test';

const DEMO_EMAIL = 'demo@agentproofarch.dev';
const DEMO_PASSWORD = 'demo1234';

/**
 * A CTAP2 platform authenticator with a discoverable (resident) credential and
 * automatic user-verification, so the register and sign-in ceremonies resolve
 * deterministically — no real biometric prompt, no human touch (US-028a).
 */
const installVirtualAuthenticator = async (page: Page): Promise<void> => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
};

const signInWithPassword = async (page: Page): Promise<void> => {
  await page.goto('/login');
  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('button', { name: 'Switch tenant' })).toContainText('Acme');
};

test('register a passkey in settings, then sign in with it (US-028a)', async ({ page }) => {
  await installVirtualAuthenticator(page);

  await signInWithPassword(page);
  await page.goto('/app/settings');
  await page.locator('#passkey-name').fill('E2E Virtual Key');
  await page.getByRole('button', { name: 'register a passkey' }).click();
  await expect(page.getByText('E2E Virtual Key')).toBeVisible();

  await page.getByRole('button', { name: 'sign out' }).click();
  await page.goto('/login');

  // No email or password is entered: the discoverable credential is what signs in.
  await page.getByRole('button', { name: 'continue with a passkey' }).click();
  await expect(page.getByRole('button', { name: 'Switch tenant' })).toContainText('Acme');

  // The passkey was registered under the demo account, so the session it mints is demo's.
  const me = await page.request.get('/api/me');
  expect(me.ok()).toBeTruthy();
  const body: unknown = await me.json();
  expect(body).toMatchObject({ ok: true, data: { email: DEMO_EMAIL } });
});
