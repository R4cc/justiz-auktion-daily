// Optional browser regression check with isolated data; npm test needs no browser.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { buyBusiness, stockBusiness, businessDashboard, unstockBusiness } from '../src/businesses.mjs';
import { featureFlags } from '../src/features.mjs';

const runtime = process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(runtime);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp('/tmp/jg-business-owner-');
const env = { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'owner-browser-password', COOKIE_SECURE: 'false' }, flags = featureFlags(env);
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
const seed = JSON.parse(await readFile(path.join(root, 'seed/auctions.json'), 'utf8')); upsertAuctions(dir, seed.auctions);
const api = await createAccountApi({ dataDir: dir, json, env, flags, dailyPayload: async () => ({ auctions: seed.auctions.slice(0, 5) }) });
const accounts = new Accounts(dir, { flags }), token = await accounts.login({ username: 'admin', password: env.ADMIN_PASSWORD }), owner = accounts.user(token);
accounts.db(db => db.prepare('UPDATE users SET tokens=1000000, xp=36100 WHERE id=?').run(owner.id));
const wine = buyBusiness(dir, owner, 'wine', 'popup').shop, toys = buyBusiness(dir, owner, 'toys', 'popup').shop, tech = buyBusiness(dir, owner, 'electronics', 'popup').shop;
const addItem = (id, category, title) => accounts.db(db => db.prepare('INSERT INTO inventory (id,user_id,item,created_at) VALUES (?,?,?,?)').run(id, owner.id, JSON.stringify({ title, price: 30, marketCategory: category, rarity: 'common' }), Date.now()));
for (let n = 0; n < 12; n++) addItem(`wine-${n}`, 'wine', n < 10 ? 'Riesling' : 'Merlot');
for (let n = 0; n < 12; n++) addItem(`toy-${n}`, 'collectibles', `Toy ${n % 3}`);
stockBusiness(dir, owner, wine.id, Array.from({ length: 9 }, (_, n) => `wine-${n}`));
const economy = createEconomyApi({ dataDir: dir, json, flags, accounts }), writes = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api/account/businesses/stock') writes.push(Date.now());
    if (await api(req, res, url) || economy(req, res, url)) return;
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
    const filename = url.pathname === '/' || !path.extname(url.pathname) ? '/index.html' : url.pathname;
    const buf = await readFile(path.join(root, 'dist', filename));
    res.writeHead(200, { 'content-type': filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(buf);
  } catch (error) { json(res, 500, { error: error.message }); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/home/lxadm/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', headless: true, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message)); await context.addCookies([{ name: 'jg_session', value: token, url: base }]);
  const shelf = id => businessDashboard(dir, owner).shops.find(shop => shop.id === id).stock;
  const quick = id => page.locator(`[data-business="quick-restock"][data-shop="${id}"]`);
  await page.goto(base + '/businesses'); await page.waitForSelector('.business-shop');
  assert.equal(await page.locator('.business-card-body > [data-business="quick-restock"]').count(), 3);
  assert.equal(await quick(tech.id).isDisabled(), true);
  await page.locator(`.business-card-actions a[href="/stores?shop=${wine.id}"]`).click(); await page.waitForSelector('.store-owner-page');
  assert.equal(await page.locator('[data-store="buy"]').count(), 0); assert.equal(await page.locator('.store-owner-back').getAttribute('href'), '/businesses');
  assert.equal(await page.locator('.store-owner-stock-list > li').count(), 1); assert.equal(await page.locator('.store-owner-quantity').innerText(), '×9');
  // Save both settings in place, without bouncing to the portfolio.
  await page.locator('.store-owner-actions [data-business="open-edit"]').click();
  await page.locator('[name="storeName"]').fill('Vienna Wine & Finds'); await page.locator('[name="motto"]').fill('Good finds for curious collectors.');
  await page.locator('[data-store-profile] button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('.store-owner-identity h1')?.textContent === 'Vienna Wine & Finds');
  await page.locator('[name="profitMargin"]').fill('35'); await page.locator('[data-business-margin-form] button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('.store-owner-stats')?.textContent.includes('35%'));
  assert.ok(page.url().includes('/stores?shop='));
  await page.locator('.business-editor-dialog [data-business="open-restock"]').click(); await page.locator('[data-business="close-restock"]').click();
  assert.equal(await page.locator('.business-editor-dialog [data-business="open-restock"]').evaluate(el => el === document.activeElement), true);
  await page.locator('[data-business="close-edit"]').click();
  // Real 6.5-second wait; cancellation must leave every item untouched.
  await quick(wine.id).click(); await page.waitForSelector('.business-quick-dialog[open]'); await page.waitForFunction(() => document.querySelector('.business-quick-dialog progress').value > 0);
  await page.keyboard.press('Escape'); assert.equal(writes.length, 0); assert.equal(shelf(wine.id).length, 9);
  const balance = accounts.profile(owner).tokens;
  const started = Date.now(); await quick(wine.id).dblclick(); await page.waitForSelector('.business-quick-dialog[open]');
  await page.waitForFunction(() => document.querySelector('.business-quick-dialog progress').value > 20);
  assert.equal(writes.length, 0); assert.equal(shelf(wine.id).length, 9);
  await page.screenshot({ path: '/tmp/jg-owner-restocking.png' });
  await page.waitForSelector('.business-quick-dialog[open]', { state: 'hidden', timeout: 12000 });
  assert.equal(writes.length, 1); assert.ok(writes[0] - started >= 5000 && writes[0] - started <= 8000); assert.equal(shelf(wine.id).length, 10); assert.equal(accounts.profile(owner).tokens, balance);
  assert.ok(shelf(wine.id).some(entry => entry.item.title === 'Merlot')); assert.equal(await quick(wine.id).isDisabled(), true);
  // Removing one unit from a grouped shelf row preserves the other copies.
  await page.locator('.store-owner-remove').first().click();
  await page.waitForFunction(() => document.querySelector('.store-owner-section-heading > span')?.textContent === '9 / 10');
  assert.equal(shelf(wine.id).length, 9); assert.match(await page.locator('.store-owner-quantity').first().innerText(), /×8/);
  // The manual manager shares the same shelf operations.
  await page.locator('.store-owner-actions [data-business="open-restock"]').click(); await page.waitForSelector('.business-restock-dialog[open]');
  assert.equal(await page.locator('#business-restock-form button[type="submit"]').isDisabled(), true);
  await page.locator('.business-shelf-list [data-business="unstock"]').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.business-shelf-list > li').length === 8);
  await page.locator('[data-business="auto-restock"]').click(); await page.locator('#business-restock-form button[type="submit"]').click();
  await page.waitForSelector('.business-restock-dialog[open]', { state: 'hidden' }); assert.equal(shelf(wine.id).length, 10);
  // Screenshots and overflow checks across both translations.
  await page.waitForFunction(() => !document.querySelector('.notification-toast')); await page.waitForTimeout(3200);
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const lang of ['en', 'de']) {
      const hidden = !(await page.locator('#language-select').isVisible()); if (hidden) await page.locator('[data-action="sidebar"]').click();
      await page.locator('#language-select').selectOption(lang); if (hidden) await page.keyboard.press('Escape');
      await page.waitForFunction(l => document.querySelector('.store-owner-actions')?.textContent.includes(l === 'en' ? 'Store settings' : 'Ladeneinstellungen'), lang);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px ${lang} owner overflow`);
      if ([1440, 390, 320].includes(width)) await page.screenshot({ path: `/tmp/jg-owner-${width}-${lang}.png`, fullPage: true });
    }
  }
  // Quick restock works from the directory card and checks current capacity.
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.locator('#language-select').selectOption('en');
  await page.goto(base + '/stores'); await page.waitForSelector('.store-card-quick'); assert.equal(await page.locator('.store-card-quick').count(), 3);
  const before = writes.length; await quick(toys.id).click(); await page.waitForSelector('.business-quick-dialog[open]');
  stockBusiness(dir, owner, toys.id, Array.from({ length: 10 }, (_, n) => `toy-${n}`));
  await page.waitForSelector('.business-quick-dialog[open]', { state: 'hidden', timeout: 12000 }); assert.equal(writes.length, before); assert.equal(shelf(toys.id).length, 10);
  // A rejected mutation retains inventory and allows a fresh retry.
  unstockBusiness(dir, owner, toys.id, 'toy-0'); await page.reload(); await page.waitForSelector('.store-card-quick');
  await page.route('**/api/account/businesses/stock', route => route.fulfill({ status: 409, json: { error: 'item_locked' } }));
  await quick(toys.id).click(); await page.waitForSelector('.business-quick-dialog[open]'); await page.waitForSelector('.business-quick-dialog[open]', { state: 'hidden', timeout: 12000 });
  assert.equal(shelf(toys.id).length, 9); assert.equal(await quick(toys.id).isDisabled(), false); await page.unroute('**/api/account/businesses/stock');
  // The loading dialog remains readable at the narrowest German viewport.
  await page.setViewportSize({width:320,height:800}); await page.locator('[data-action="sidebar"]').click(); await page.locator('#language-select').selectOption('de'); await page.keyboard.press('Escape');
  await quick(toys.id).click(); await page.waitForSelector('.business-quick-dialog[open]');
  assert.ok(await page.locator('.business-quick-dialog').evaluate(el => { const box=el.getBoundingClientRect(); return box.left>=0 && box.right<=innerWidth && el.scrollWidth<=el.clientWidth+1; }));
  await page.screenshot({path:'/tmp/jg-owner-restocking-mobile-de.png'}); await page.keyboard.press('Escape'); assert.equal(shelf(toys.id).length,9);
  await page.setViewportSize({width:1440,height:1000}); await page.locator('#language-select').selectOption('en');
  // Leaving during the progress phase cancels any pending placement.
  await quick(toys.id).click(); await page.waitForSelector('.business-quick-dialog[open]'); const prior = writes.length;
  await page.evaluate(() => navigateAccountPage('/inventory')); await page.waitForURL('**/inventory');
  await page.waitForTimeout(7000); assert.equal(writes.length, prior); assert.equal(shelf(toys.id).length, 9);
  // A visitor retains shopping controls and has no owner operations.
  const visitorToken = await accounts.register({ username: 'visitor', password: env.ADMIN_PASSWORD, code: accounts.codes(owner, 1)[0] });
  await context.clearCookies(); await context.addCookies([{ name: 'jg_session', value: visitorToken, url: base }]);
  await page.goto(base + `/stores?shop=${wine.id}`); await page.waitForSelector('.store-shelf-card');
  assert.equal(await page.locator('.store-owner-page').count(), 0); assert.equal(await page.locator('[data-business="quick-restock"]').count(), 0); assert.ok(await page.locator('[data-store="buy"]').count() > 0);
  await context.clearCookies(); await page.reload(); await page.waitForSelector('.store-notice'); assert.equal(await page.locator('.store-owner-page').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Owner-store UI passed: direct settings, shelves and stock manager; EN/DE at 1440/1024/768/390/320px; timed restock, variety, capacity, double clicks, cancellation, stale capacity, rejected mutation, navigation cancellation, directory actions, visitor and guest views; no JS errors.');
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve)); closeDataStore(dir); await rm(dir, { recursive: true, force: true });
}
