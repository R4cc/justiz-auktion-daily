import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Accounts } from '../src/accounts.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { featureFlags } from '../src/features.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-green-profile-'));
const env = { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'profile-browser-password', COOKIE_SECURE: 'false' };
const flags = featureFlags(env);
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
const seed = JSON.parse(await readFile(path.join(root, 'seed/auctions.json'), 'utf8'));
upsertAuctions(dir, seed.auctions);
const api = await createAccountApi({ dataDir: dir, json, env, flags, dailyPayload: async () => ({ auctions: seed.auctions.slice(0, 5) }) });
const accounts = new Accounts(dir, { flags });
const token = await accounts.login({ username: 'admin', password: env.ADMIN_PASSWORD });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (await api(req, res, url)) return;
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
    const filename = path.extname(url.pathname) ? url.pathname : '/index.html';
    const content = await readFile(path.join(root, 'dist', filename));
    res.writeHead(200, { 'content-type': filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.woff2') ? 'font/woff2' : 'text/html' });
    res.end(content);
  } catch (error) { json(res, 500, { error: error.message }); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true, reducedMotion: 'reduce' });
  await context.addCookies([{ name: 'jg_session', value: token, url: base }]);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/profile');
  await page.waitForSelector('.theft-heat .info-tip button');
  const wallet = page.locator('#persistent-wallet');
  assert.equal(await wallet.getAttribute('href'), '/profile');
  assert.ok(await wallet.locator('.user-card-avatar').isVisible());
  await wallet.focus();
  assert.equal(await wallet.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
  await wallet.press('Enter');
  assert.equal(new URL(page.url()).pathname, '/profile');
  for (const width of [1440, 900, 768, 390, 320]) for (const lang of ['en', 'de']) {
    await page.setViewportSize({ width, height: width <= 390 ? 667 : 1000 });
    await page.evaluate(lang => {
      const select = document.querySelector('#language-select');
      select.value = lang; select.dispatchEvent(new Event('change', { bubbles: true }));
    }, lang);
    for (const tokens of [0, 12450, Number.MAX_SAFE_INTEGER]) {
      await page.evaluate(tokens => updateAccount({ ...account, username: 'Long_Profile_Name', tokens }), tokens);
      const fits = await wallet.evaluate(el => {
        const card = el.getBoundingClientRect(), name = el.querySelector('#user-card-name').getBoundingClientRect();
        const avatar = el.querySelector('.user-card-avatar').getBoundingClientRect(), amount = el.querySelector('#wallet-amount');
        return card.left >= 0 && card.right <= innerWidth && avatar.right <= name.left && amount.scrollWidth <= amount.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1;
      });
      assert.ok(fits, `card fits ${width} ${lang} ${tokens}`);
    }
    const tip = page.locator('.theft-heat .info-tip'), button = tip.locator('button'), tooltip = tip.locator('[role=tooltip]');
    await button.scrollIntoViewIfNeeded();
    if (width > 900) await button.hover(); else await button.tap();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.theft-heat [role=tooltip]')).opacity === '1');
    assert.equal(await button.getAttribute('aria-describedby'), await tooltip.getAttribute('id'));
    const bounds = await tooltip.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= (width <= 390 ? 667 : 1000), `tooltip fits ${width} ${lang}: ${JSON.stringify(bounds)}`);
    assert.match(await tooltip.innerText(), lang === 'en' ? /Half a star fades/ : /halber Stern/);
    await page.mouse.move(0, 0);
    await button.focus();
    assert.equal(await tooltip.evaluate(el => getComputedStyle(el).opacity), '1');
    await page.screenshot({ path: path.join(os.tmpdir(), `jg-green-profile-${width}-${lang}.png`) });
    await button.blur();
  }
  assert.deepEqual(errors, []);
  console.log('User card passed: avatar, keyboard profile link, zero/large balances, EN/DE 1440–320px; Heat tooltip hover, focus, touch and viewport bounds; no JS errors.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  closeDataStore(dir);
  await rm(dir, { recursive: true, force: true });
}
