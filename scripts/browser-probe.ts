import { generateSync } from 'otplib';
import { chromium } from 'playwright-core';
import { z } from 'zod';

const optionalTotpSecret = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().trim().min(1).optional(),
);
const probeEnvSchema = z.object({
  BASE_URL: z.url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol)),
  SMOKE_EMAIL: z.email(),
  SMOKE_PASSWORD: z.string().min(1),
  SMOKE_TOTP_SECRET: optionalTotpSecret,
});

const fail = (message: string): never => {
  throw new Error(message);
};

const requireValue = <T>(value: T | undefined, message: string): T =>
  value === undefined ? fail(message) : value;

const runProbe = async (): Promise<void> => {
  const env = probeEnvSchema.parse(process.env);
  const deploymentOrigin = new URL(env.BASE_URL).origin;
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);

    console.log(`browser-probe: loading ${deploymentOrigin}/login`);
    await page.goto(new URL('/login', deploymentOrigin).toString(), {
      waitUntil: 'domcontentloaded',
    });

    const emailInput = page.locator('#login-email');
    const passwordInput = page.locator('#login-password');
    const signInButton = page.getByRole('button', { name: 'Zaloguj się', exact: true });
    await emailInput.waitFor({ state: 'visible' });
    await passwordInput.waitFor({ state: 'visible' });
    await signInButton.waitFor({ state: 'visible' });
    console.log('browser-probe: login form rendered');

    await emailInput.fill(env.SMOKE_EMAIL);
    await passwordInput.fill(env.SMOKE_PASSWORD);
    await signInButton.click();

    const documentsHeading = page.getByRole('heading', { name: 'Dokumenty', exact: true });
    const totpInput = page.locator('#login-totp');
    const requiresTotp = await Promise.race([
      documentsHeading.waitFor({ state: 'visible' }).then(() => false),
      totpInput.waitFor({ state: 'visible' }).then(() => true),
    ]);

    if (requiresTotp) {
      const totpSecret = requireValue(
        env.SMOKE_TOTP_SECRET,
        'login requires TOTP but SMOKE_TOTP_SECRET is not configured',
      );
      console.log('browser-probe: completing TOTP challenge');
      await totpInput.fill(generateSync({ secret: totpSecret }));
      await page.getByRole('button', { name: 'Potwierdź kod', exact: true }).click();
      await documentsHeading.waitFor({ state: 'visible' });
    }

    const cookies = await context.cookies(deploymentOrigin);
    if (cookies.length === 0) fail('browser cookie jar is empty after sign-in');
    const sessionCookie = requireValue(
      cookies.find(({ name, value }) => {
        const normalizedName = name.toLowerCase();
        return normalizedName.includes('better-auth') && normalizedName.includes('session') && value.length > 0;
      }),
      'browser cookie jar has no non-empty Better Auth session cookie after sign-in',
    );
    console.log(`browser-probe: session cookie present for ${sessionCookie.domain}`);

    const me = await page.evaluate(async () => {
      const response = await fetch('/api/me', { credentials: 'include' });
      return { status: response.status, body: await response.text() };
    });
    if (me.status !== 200) fail(`/api/me returned ${String(me.status)}: ${me.body}`);
    console.log('browser-probe: /api/me returned 200');

    await documentsHeading.waitFor({ state: 'visible' });
    await page.getByRole('link', { name: 'Dokumenty', exact: true }).waitFor({ state: 'visible' });
    console.log('browser-probe: Dokumenty app shell rendered');
  } finally {
    await browser.close();
  }
};

const startedAt = Date.now();
try {
  await runProbe();
  console.log(`browser-probe: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  console.error(`browser-probe: FAIL\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
