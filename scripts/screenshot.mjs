// Screenshot helper for demo verification (drives installed Chrome, headless).
// Usage: node scripts/screenshot.mjs <url> <out.png> [width] [email] [password]
// Logs in with the demo account when the login form appears.
import { chromium } from 'playwright-core';

const [url, out, width = '1200', email = 'demo@agentproofarch.dev', password = 'demo1234'] =
  process.argv.slice(2);

if (!url || !out) {
  console.error('usage: node scripts/screenshot.mjs <url> <out.png> [width] [email] [password]');
  process.exit(2);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (
  await browser.newContext({ viewport: { width: Number(width), height: 900 } })
).newPage();

// Works against both markup generations: hand-written CSS (main) and MUI.
const LEDGER = '.MuiChip-root, .role-badge';
await page.goto(url);
await page.waitForSelector(`${LEDGER}, input[type=email]`, { timeout: 15000 });
if (process.env.NO_LOGIN === '1') {
  await page.waitForTimeout(800);
  await page.screenshot({ path: out, animations: 'disabled' });
  console.log(`saved ${out} (${width}px, no login) for ${url}`);
  await browser.close();
  process.exit(0);
}
if (await page.$('input[type=email]')) {
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.click('button[type=submit]');
  await page.waitForSelector(LEDGER, { timeout: 15000 });
}
// THEME=material clicks the top-of-page theme switcher before capturing.
if (process.env.THEME) {
  await page.click(`button[value="${process.env.THEME}"]`);
  await page.waitForTimeout(400);
}
await page.waitForTimeout(800);
await page.screenshot({ path: out, animations: 'disabled' });
console.log(`saved ${out} (${width}px) for ${url}`);
await browser.close();
