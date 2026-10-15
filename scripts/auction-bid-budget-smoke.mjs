import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { createPaletteAuction, bidOnPaletteAuction } from '../src/palette-auctions.mjs';
import { loadPaletteCatalog } from '../src/palette-definitions.mjs';
import { listItem, placeBid } from '../src/resale.mjs';
import { featureFlags } from '../src/features.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(tmpdir(), 'jg-bid-budget-browser-')), now = Date.now();
const env = { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'bid-budget-browser-password', COOKIE_SECURE: 'false', FEATURE_BUSINESSES: 'false' };
const flags = featureFlags(env);
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
upsertAuctions(dir, Array.from({ length: 24 }, (_, n) => ({ id: 1000 + n, title: `Laptop Lenovo ${n}`,
  category: 'Elektronik', currentBid: 10 + n * 20, image: '/favicon.png' })));
const accountApi = await createAccountApi({ dataDir: dir, json, env, flags, dailyPayload: async () => ({ auctions: [] }) });
const accounts = new Accounts(dir, { flags }), token = await accounts.login({ username: 'admin', password: env.ADMIN_PASSWORD });
const bidder = accounts.user(token), seller = { id: 'budget-seller' }, rival = { id: 'bid-rival' };
accounts.db(db => {
  db.prepare('UPDATE users SET tokens=1000,xp=40000 WHERE id=?').run(bidder.id);
  db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES(?,?,'disabled',1000,?)").run(seller.id, 'Budget Seller', now);
  db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES(?,?,'disabled',100000,?)").run(rival.id, 'Bid Rival', now);
  db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run('budget-item', seller.id,
    JSON.stringify({ title: 'Budget tool', price: 100, rarity: 'common', marketCategory: 'tools' }), now);
});
const resale = listItem(dir, seller, { inventoryId: 'budget-item', startPrice: 10, endsAt: new Date(now + 3600_000).toISOString() }, { now });
placeBid(dir, bidder, resale.id, 161, { now });
const edition = loadPaletteCatalog(dir, { now }).palettes.find(p => p.id === 'fundkiste');
const palette = createPaletteAuction(dir, { editionId: edition.editionId, requestId: 'bid-budget-browser-primary' }, { now, random: () => 0 });
const economy = createEconomyApi({ dataDir: dir, json, flags, accounts });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (await accountApi(req, res, url) || economy(req, res, url)) return;
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
    const filename = path.extname(url.pathname) ? url.pathname : '/index.html';
    const content = await readFile(path.join(root, 'dist', filename));
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' }[path.extname(filename)] || 'text/html';
    res.writeHead(200, { 'content-type': mime }); res.end(content);
  } catch (error) { json(res, 500, { error: error.message }); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.addCookies([{ name: 'jg_session', value: token, url: base }]);
  // Deliberately incomplete participation lists must not hide the live escrow.
  await page.route('**/api/account/resale/bids', route => route.fulfill({ json: { listings: [] } }));
  await page.route(/\/api\/account\/palette-auctions\?/, route => route.fulfill({ json: { auctions: [] } }));
  await page.goto(base + '/auction-house');
  const language = async value => {
    await page.locator('#language-select').evaluate((select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }, value);
    await page.waitForSelector('.house-lot');
  };
  await language('en');
  await page.locator(`article.house-lot[data-id="${resale.id}"]`).click();
  const input = page.locator('.auction-bid-form input[name="amount"]');
  await input.waitFor();
  assert.equal(await input.getAttribute('max'), '1000');
  assert.match(await page.locator('[data-reserved-maximum]').innerText(), /161/);
  let posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/resale/bid')) posts++; });
  for (const [value, expected] of [['161', /at least.*162/], ['', /whole J€/], ['162.5', /whole J€/], ['1001', /up to/]]) {
    await input.fill(value);
    assert.match(await page.locator('#auction-bid-error').innerText(), expected);
    await page.locator('.auction-bid-form button[type="submit"]').click();
    assert.equal(await input.getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('[data-bid-preview]').isVisible(), false);
    if (value === '161') await page.screenshot({ path: '/tmp/bid-refinement-under-minimum.png' });
  }
  assert.equal(posts, 0, 'invalid input must never post a bid');
  await page.locator('[data-bid-minimum]').click();
  assert.equal(await input.inputValue(), '162');
  assert.equal(await page.locator('#auction-bid-error').innerText(), '');
  assert.match(await page.locator('[data-bid-charge]').innerText(), /1/);
  assert.equal(posts, 0, 'Use minimum only fills the draft');
  await input.fill('870');
  assert.match(await page.locator('[data-bid-charge]').innerText(), /709/);
  assert.match(await page.locator('[data-bid-wallet]').innerText(), /130/);
  assert.equal(await input.evaluate(node => node.checkValidity()), true);
  const response = page.waitForResponse(res => res.url().endsWith('/api/account/resale/bid') && res.request().method() === 'POST');
  await page.locator('.auction-bid-form button[type="submit"]').click();
  const result = await response; assert.equal(result.status(), 200); assert.equal((await result.json()).user.tokens, 130);
  await page.waitForFunction(() => document.querySelector('[data-reserved-maximum]')?.textContent.includes('870'));
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('Maximum saved'));
  await input.fill('1001');
  assert.equal(await input.evaluate(node => node.validity.rangeOverflow), true);
  // A rival changes the minimum between the form loading and submission.
  await input.fill('871');
  placeBid(dir, rival, resale.id, 900, { now: Date.now() });
  const raceResponse = page.waitForResponse(res => res.url().endsWith('/api/account/resale/bid') && res.status() === 409);
  await page.locator('.auction-bid-form button[type="submit"]').click(); await raceResponse;
  await page.waitForFunction(() => document.querySelector('#auction-bid-error')?.textContent.includes('872'));
  assert.equal(await input.inputValue(), '871', 'server rejection must preserve the draft');
  await page.locator('[data-bid-minimum]').click();
  assert.equal(await input.inputValue(), '872');
  const losingResponse = page.waitForResponse(res => res.url().endsWith('/api/account/resale/bid') && res.status() === 200);
  await page.locator('.auction-bid-form button[type="submit"]').click(); await losingResponse;
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('No J€ reserved'));
  assert.equal(accounts.profile(bidder).tokens, 1000, 'losing proxy challenges do not reserve funds');
  assert.equal(await page.locator('[data-reserved-maximum]').isVisible(), false);
  await input.fill('950');
  const retake = page.waitForResponse(res => res.url().endsWith('/api/account/resale/bid') && res.status() === 200);
  await page.locator('.auction-bid-form button[type="submit"]').click(); await retake;
  await page.waitForFunction(() => document.querySelector('[data-reserved-maximum]')?.textContent.includes('950'));
  // Check both layouts and languages with the reservation larger than wallet.
  for (const width of [1440, 768, 375, 320]) for (const lang of ['en', 'de']) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('dialog[open]').evaluate(node => node.close());
    await language(lang);
    await page.locator(`article.house-lot[data-id="${resale.id}"]`).click();
    await input.waitFor();
    assert.equal(await input.getAttribute('max'), '1000');
    assert.equal(await input.isDisabled(), false);
    assert.match(await page.locator('[data-reserved-maximum]').innerText(), /950/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await input.fill('951');
    await page.locator('[data-bid-wallet]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/bid-refinement-${width}-${lang}.png` });
    const bounds = await input.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
  }
  await page.locator('dialog[open]').evaluate(node => node.close());
  const first = palette.reserve + 160, maximum = first + 839;
  accounts.db(db => db.prepare('UPDATE users SET tokens=? WHERE id=?').run(maximum, bidder.id));
  bidOnPaletteAuction(dir, bidder, palette.id, first, { now: Date.now() });
  await page.reload(); await page.waitForSelector('.house-lot');
  await page.locator(`article.house-lot[data-id="${palette.id}"]`).click();
  await input.waitFor();
  assert.equal(await input.getAttribute('max'), String(maximum));
  await input.fill(String(first + 800));
  assert.equal(await input.evaluate(node => node.checkValidity()), true);
  const primaryResponse = page.waitForResponse(res => res.url().endsWith('/api/account/palette-auctions/bid') && res.request().method() === 'POST');
  await page.locator('.auction-bid-form button[type="submit"]').click();
  const raised = await primaryResponse; assert.equal(raised.status(), 200); assert.equal((await raised.json()).user.tokens, 39);
  // Confirmation follows the refreshed dialog; the earlier budget update
  // alone can precede the dialog being replaced.
  await page.waitForFunction(value => {
    const message = document.querySelector('#toast')?.textContent || '';
    return /Maximum saved:|Höchstgebot gespeichert:/.test(message) && message.replace(/\D/g, '') === String(value);
  }, first + 800);
  // Even a short viewport must allow the preview and action to be reached.
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.locator('[data-bid-wallet]').evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.screenshot({ path: '/tmp/bid-refinement-short-desktop.png' });
  const walletBounds = await page.locator('[data-bid-wallet]').boundingBox();
  assert.ok(walletBounds.y >= 0 && walletBounds.y + walletBounds.height <= 600);
  await page.waitForFunction(() => /Maximum saved|Höchstgebot gespeichert/.test(document.querySelector('#toast')?.textContent));
  assert.deepEqual(errors, []);
  console.log('Passed: 839 wallet + same-auction escrow, resale raise to 870, primary raises, inline minimum/maximum validation, explicit minimum action, live rejection recovery, correct leading/outbid feedback, stale history, 1440–320px EN/DE.');
} finally {
  await browser.close(); server.closeIdleConnections?.();
  await new Promise(resolve => server.close(resolve));
  closeDataStore(dir); await rm(dir, { recursive: true, force: true });
}
