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
import { prepareSealedCase, insertSealedCase } from '../src/sealed-cases.mjs';
import { createPaletteAuction, bidOnPaletteAuction } from '../src/palette-auctions.mjs';
import { loadPaletteCatalog } from '../src/palette-definitions.mjs';
import { createStockPaletteAuction, stockPaletteAuctionCatalog } from '../src/stock-palette-auctions.mjs';
import { listItem, placeBid, settleAuction } from '../src/resale.mjs';
import { supplyReviewAuctions } from '../src/review-auctions.mjs';
import { featureFlags } from '../src/features.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(tmpdir(), 'jg-house-browser-')), now = Date.now();
const env = { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'house-browser-password', COOKIE_SECURE: 'false' };
const flags = featureFlags(env);
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
const themes = [['Elektronik', 'Laptop Lenovo', 40], ['Werkzeuge', 'Bohrhammer Makita', 20], ['Getränke', 'Riesling Wein', 8], ['Fahrzeuge', 'BMW PKW', 500], ['Schmuck & Uhren', 'Gold Armbanduhr', 90], ['Sammlerstücke', 'Lego Modell', 15]];
upsertAuctions(dir, themes.flatMap(([category, title, price], n) => Array.from({ length: 12 }, (_, i) => ({ id: 1000 + n * 100 + i, title: `${title} ${n} ${i}`, category, currentBid: price * (i + 1), image: '/assets/tv.jpg' }))));
const accountApi = await createAccountApi({ dataDir: dir, json, env, flags, dailyPayload: async () => ({ auctions: [] }) });
const accounts = new Accounts(dir, { flags });
const token = await accounts.login({ username: 'admin', password: env.ADMIN_PASSWORD });
const owner = accounts.user(token), seller = { id: 'seller' }, rival = { id: 'rival' };
accounts.db(db => {
  db.prepare('UPDATE users SET tokens=10000000,xp=40000 WHERE id=?').run(owner.id);
  for (const [id, username] of [['seller', 'Seller <name> & '.repeat(8)], ['rival', 'Rival']]) db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES(?,?,'disabled',10000000,?)").run(id, username, now);
});
const endsAt = new Date(now + 3_600_000).toISOString();
function itemLot(id, title, price, { user = seller, quantity = 1, stock = false } = {}) {
  accounts.db(db => {
    for (let n = 0; n < quantity; n++) db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run(`${id}-${n}`, user.id, JSON.stringify({ id, title, price, rarity: 'common', image: '/assets/tv.jpg', ...(stock ? { businessCategory: 'wine', stockPaletteId: 'smoke-stock' } : {}) }), now);
  });
  return listItem(dir, user, { inventoryId: `${id}-0`, quantity, startPrice: price, endsAt }, { now });
}
const winning = itemLot('winning', 'Winning item', 73);
const outbid = itemLot('outbid', 'Outbid item', 91);
const normal = itemLot('normal', 'Normal item', 37);
const long = itemLot('long', 'A very long inventory title <escaped> & '.repeat(12), 987654);
const stock = itemLot('stock', 'Riesling stock', 149, { quantity: 12, stock: true });
const own = itemLot('own', 'Own listing', 59, { user: owner });
placeBid(dir, owner, winning.id, 73, { now });
placeBid(dir, owner, outbid.id, 91, { now });
placeBid(dir, rival, outbid.id, 200, { now });
const sealed = accounts.db(db => insertSealedCase(db, seller.id, prepareSealedCase(null, 'common', { now, fallback: [{ id: 1, title: 'SECRET CASE FIND', price: 20, rarity: 'common', image: '/assets/tv.jpg' }] }), now));
const caseLot = listItem(dir, seller, { inventoryId: sealed.id, startPrice: 101, endsAt }, { now });
const edition = loadPaletteCatalog(dir, { now }).palettes.find(entry => entry.id === 'fundkiste');
assert.ok(edition.available);
const mystery = createPaletteAuction(dir, { editionId: edition.editionId, requestId: 'house-browser-primary-0001' }, { now, random: () => 0 });
const mysteryOutbid = createPaletteAuction(dir, { editionId: edition.editionId, requestId: 'house-browser-primary-0002' }, { now, random: () => 0 });
const mysteryBrowse = createPaletteAuction(dir, { editionId: edition.editionId, requestId: 'house-browser-primary-0003' }, { now, random: () => 0 });
// Domain-qualified identity matters even when a resale and primary lot share an ID.
accounts.db(db => {
  db.exec('BEGIN; PRAGMA defer_foreign_keys=ON;');
  try {
    db.prepare('UPDATE primary_palette_auctions SET id=? WHERE id=?').run(winning.id, mysteryBrowse.id);
    db.prepare('UPDATE primary_palette_rewards SET auction_id=? WHERE auction_id=?').run(winning.id, mysteryBrowse.id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
});
mysteryBrowse.id = winning.id;
const offer = stockPaletteAuctionCatalog(dir, { now }).offers[0];
assert.ok(offer);
const paletteStock = createStockPaletteAuction(dir, { offerId: offer.id, requestId: 'house-browser-stock-00001' }, { now });
bidOnPaletteAuction(dir, owner, mystery.id, mystery.reserve, { now });
bidOnPaletteAuction(dir, owner, mysteryOutbid.id, mysteryOutbid.reserve, { now });
bidOnPaletteAuction(dir, rival, mysteryOutbid.id, mysteryOutbid.reserve + 1000, { now });
const day = Math.floor(now / 86400000) * 86400000;
const review = supplyReviewAuctions(dir, { now: day + 8 * 3600000 }).auctions[0];
accounts.db(db => db.prepare('UPDATE resale_auctions SET started_at=?,ends_at=? WHERE id=?').run(now, now + 3600000, review));
const economy = createEconomyApi({ dataDir: dir, json, flags, accounts });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (await accountApi(req, res, url) || economy(req, res, url)) return;
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
    const filename = url.pathname === '/' || !path.extname(url.pathname) ? '/index.html' : url.pathname;
    const content = await readFile(path.join(root, 'dist', filename));
    const extension = path.extname(filename);
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }[extension] || 'text/html';
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
  const card = (id, domain = 'resale') => page.locator(`article.house-lot[data-economy="${domain}"][data-id="${id}"]`);
  const rows = section => page.locator(`${section} .house-grid > article.house-lot`);
  const ids = section => rows(section).evaluateAll(nodes => nodes.map(node => `${node.dataset.economy}:${node.dataset.id}`));
  const filter = (key, value) => page.locator(`[data-house-filter="${key}"]`).selectOption(value);
  const language = value => page.evaluate(value => { const select = document.querySelector('#language-select'); select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }, value);
  const activeIds = [`resale:${winning.id}`, `resale:${outbid.id}`, `primary:${mystery.id}`, `primary:${mysteryOutbid.id}`];
  const pinned = async () => {
    assert.deepEqual(new Set(await ids('.house-active-bids')), new Set(activeIds));
    assert.equal(await card(winning.id).locator('.house-lot-state').innerText(), 'Winning');
    assert.equal(await card(outbid.id).locator('.house-lot-state').innerText(), 'Outbid');
    assert.equal(await card(mystery.id, 'primary').locator('.house-lot-state').innerText(), 'Winning');
    assert.equal(await card(mysteryOutbid.id, 'primary').locator('.house-lot-state').innerText(), 'Outbid');
    const browse = await ids('.house-results');
    assert.equal(browse.filter(id => activeIds.includes(id)).length, 0, 'Active bids must not duplicate in the results');
    const first = await page.locator('.house-active-bids').boundingBox(), next = await page.locator('.house-results').boundingBox();
    assert.ok(first.y + first.height <= next.y + 1, 'Active bids belong above all results');
  };
  await page.goto(base + '/auction-house'); await page.waitForSelector('.house-active-bids'); await language('en');
  await pinned();
  assert.equal(await page.locator('.house-case-store-card').getAttribute('href'), '/shop');
  assert.equal(await page.locator('.house-market-card').getAttribute('href'), '/market');
  const banner=await page.locator('.auction-house-shortcuts').boundingBox(),active=await page.locator('.house-active-bids').boundingBox();
  assert.ok(banner.y+banner.height<=active.y+1, 'Original banner stays above the auction grid');
  assert.doesNotMatch(await page.locator('.auction-house').innerText(), /SECRET CASE FIND/);
  assert.equal(await card(long.id).locator('script').count(), 0);
  assert.match(await card(stock.id).innerText(), /12/);

  // Prices are the visible current bid (or reserve), and both auction domains share one order.
  const resales = (await (await context.request.get(base + '/api/resales?limit=200')).json()).listings;
  const palettes = (await (await context.request.get(base + '/api/palette-auctions?limit=100')).json()).auctions;
  const prices = new Map([...resales.map(lot => [`resale:${lot.id}`, lot.currentBid ?? lot.startPrice]), ...palettes.map(lot => [`primary:${lot.id}`, lot.currentBid ?? lot.reserve])]);
  for (const direction of ['asc', 'desc']) {
    await filter('sort', `price-${direction}`);
    const values = (await ids('.house-results')).map(id => prices.get(id));
    assert.ok(values.every(Number.isFinite));
    assert.deepEqual(values, [...values].sort((a, b) => direction === 'asc' ? a - b : b - a));
    await pinned();
  }
  const groups = { items: [`resale:${normal.id}`, `resale:${long.id}`], stock: [`resale:${stock.id}`, `primary:${paletteStock.id}`], mystery: [`primary:${mysteryBrowse.id}`], cases: [`resale:${caseLot.id}`], reviews: [`resale:${review}`] };
  for (const [type, expected] of Object.entries(groups)) {
    await filter('type', type); const visible = await ids('.house-results');
    for (const id of expected) assert.ok(visible.includes(id), `${type} must include ${id}`);
    for (const [other, excluded] of Object.entries(groups)) if (other !== type) for (const id of excluded) assert.equal(visible.includes(id), false, `${type} must exclude ${id}`);
    await pinned();
  }
  await filter('type', 'mystery');
  assert.ok((await ids('.house-results')).includes(`primary:${mysteryBrowse.id}`));
  assert.ok((await ids('.house-results')).every(id => id.startsWith('primary:')), 'Mystery filter excludes resale lots');
  await pinned();
  await filter('type', 'all'); await filter('seller', 'players');
  assert.ok((await ids('.house-results')).includes(`resale:${normal.id}`));
  assert.equal((await ids('.house-results')).includes(`resale:${review}`), false);
  await filter('seller', 'npc');
  assert.equal((await ids('.house-results')).includes(`resale:${normal.id}`), false);
  assert.ok((await ids('.house-results')).includes(`resale:${review}`)); await pinned();
  await filter('seller', 'all'); await filter('view', 'mine');
  assert.deepEqual(await ids('.house-results'), [`resale:${own.id}`]); await pinned();
  await filter('view', 'bids'); await pinned();
  await filter('view', 'browse');
  await page.locator('[data-house-filter="search"]').fill('no-such-auction-title');
  await page.waitForFunction(() => !document.querySelector('.house-results article.house-lot'));
  await pinned();
  await page.locator('.house-clear').click();
  assert.equal(await page.locator('[data-house-filter="search"]').inputValue(), '');
  assert.equal(await page.locator('[data-house-filter="type"]').inputValue(), 'all');
  assert.ok(await card(normal.id).count());

  // All controls survive reload; history navigation restores the previous filters.
  await filter('type', 'items'); await filter('sort', 'price-desc');
  await page.locator('[data-house-filter="search"]').fill('Normal item');
  await page.waitForFunction(() => document.querySelector('.house-results article.house-lot')?.textContent.includes('Normal item'));
  const query = new URL(page.url()).search;
  await page.reload(); await page.waitForSelector('.house-results article.house-lot');
  assert.equal(new URL(page.url()).search, query);
  assert.equal(await page.locator('[data-house-filter="type"]').inputValue(), 'items');
  assert.equal(await page.locator('[data-house-filter="sort"]').inputValue(), 'price-desc');
  assert.equal(await page.locator('[data-house-filter="search"]').inputValue(), 'Normal item');
  await page.locator('[data-house-filter="search"]').evaluate(node => { node.focus(); node.setSelectionRange(2, 2); node.dataset.smokePoll = 'pending'; });
  await page.waitForFunction(() => !document.querySelector('[data-house-filter="search"][data-smoke-poll]'));
  assert.equal(await page.locator('[data-house-filter="search"]').evaluate(node => document.activeElement === node && node.selectionStart === 2 && node.selectionEnd === 2), true, 'Polling retains search focus and caret');
  await page.locator('[data-house-filter="search"]').fill(''); await filter('type', 'cases');
  await page.goBack(); await page.waitForFunction(() => document.querySelector('[data-house-filter="type"]')?.value === 'items');
  await page.goForward(); await page.waitForFunction(() => document.querySelector('[data-house-filter="type"]')?.value === 'cases');
  await page.locator('.house-clear').click();
  const typeLabels = { items: 'Items', mystery: 'Mystery palettes', reviews: 'Review packs', cases: 'Sealed cases', stock: 'Stock bundles' };
  for (const direction of ['asc', 'desc']) {
    await filter('sort', `type-${direction}`);
    const types = await rows('.house-results').evaluateAll(nodes => nodes.map(node => node.dataset.houseType));
    assert.ok(types.every(type => typeLabels[type]), 'Every card has a known filter type');
    assert.deepEqual(types, [...types].sort((a, b) => (direction === 'asc' ? 1 : -1) * typeLabels[a].localeCompare(typeLabels[b], 'en')));
    await pinned();
  }
  await filter('sort', 'ends'); await pinned();

  for (const width of [1440, 1024, 768, 390, 320]) for (const lang of ['en', 'de']) {
    await page.setViewportSize({ width, height: 1000 }); await language(lang);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px ${lang} page overflow`);
    assert.ok(await page.locator('.house-lot, .house-filters').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1)), `${width}px ${lang} card/control overflow`);
    assert.ok(await page.locator('.house-heading h1').evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${width}px ${lang} heading collision`);
    assert.equal(await card(winning.id).locator('.house-lot-state').innerText(), lang === 'en' ? 'Winning' : 'Du führst');
    assert.equal(await card(outbid.id).locator('.house-lot-state').innerText(), lang === 'en' ? 'Outbid' : 'Überboten');
    await page.evaluate(() => document.querySelector('#notification-toasts').replaceChildren());
    if ([1440, 390].includes(width) || (width === 320 && lang === 'de')) {
      await page.evaluate(async () => {
        document.querySelector('.site-header')?.classList.remove('is-open'); window.scrollTo(0, 0);
        await Promise.all((document.querySelector('.site-header')?.getAnimations({ subtree: true }) || []).map(animation => animation.finished.catch(() => {})));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      await page.screenshot({ path: path.join(tmpdir(), `jg-house-${width}-${lang}-top.png`), animations: 'disabled' });
      await page.screenshot({ path: path.join(tmpdir(), `jg-house-${width}-${lang}.png`), fullPage: true, animations: 'disabled' });
    }
  }
  await language('en'); await page.setViewportSize({ width: 1440, height: 1000 });
  await card(normal.id).focus(); await page.keyboard.press('Enter');
  await page.waitForSelector(`.auction-bid-form[data-id="${normal.id}"]`);
  await page.locator('.auction-bid-form input[name="amount"]').fill('500');
  await page.locator('.auction-bid-form button[type="submit"]').click();
  await page.waitForFunction(id => document.querySelector(`.house-active-bids [data-id="${id}"] .house-lot-state`)?.textContent === 'Winning', normal.id);
  assert.equal(accounts.db(db => db.prepare('SELECT current_bidder_id FROM resale_auctions WHERE id=?').get(normal.id).current_bidder_id), owner.id);
  await page.locator('.economy-dialog .dialog-close').click();
  placeBid(dir, rival, normal.id, 1000);
  await page.waitForFunction(id => document.querySelector(`.house-active-bids [data-id="${id}"] .house-lot-state`)?.textContent === 'Outbid', normal.id);
  accounts.db(db => db.prepare('UPDATE resale_auctions SET ends_at=? WHERE id=?').run(Date.now() - 1, normal.id));
  settleAuction(dir, normal.id);
  await page.waitForFunction(id => !document.querySelector(`.house-active-bids [data-id="${id}"]`), normal.id);
  await filter('view', 'bids');
  assert.equal(await card(normal.id).count(), 1, 'Settled bid stays visible in bid history');
  await filter('view', 'browse');
  await card(paletteStock.id, 'primary').focus(); await page.keyboard.press('Space');
  await page.waitForSelector(`.auction-bid-form[data-id="${paletteStock.id}"]`);
  await page.locator('.auction-bid-form input[name="amount"]').fill(String(paletteStock.reserve + 1000));
  await page.locator('.auction-bid-form button[type="submit"]').click();
  await page.waitForFunction(id => document.querySelector(`.house-active-bids [data-economy="primary"][data-id="${id}"] .house-lot-state`)?.textContent === 'Winning', paletteStock.id);
  assert.equal(accounts.db(db => db.prepare('SELECT current_bidder_id FROM primary_palette_auctions WHERE id=?').get(paletteStock.id).current_bidder_id), owner.id);
  await page.locator('.economy-dialog .dialog-close').click();
  bidOnPaletteAuction(dir, rival, paletteStock.id, paletteStock.reserve + 2000);
  await page.waitForFunction(id => document.querySelector(`.house-active-bids [data-economy="primary"][data-id="${id}"] .house-lot-state`)?.textContent === 'Outbid', paletteStock.id);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const motionCard = page.locator('.house-lot').first();
  assert.equal(await motionCard.evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.equal(await motionCard.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  await motionCard.hover();
  assert.equal(await motionCard.evaluate(el => getComputedStyle(el).transform), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const guest = await browser.newContext({ viewport: { width: 320, height: 1000 } }), anonymous = await guest.newPage();
  anonymous.on('pageerror', error => errors.push(error.message));
  await anonymous.goto(base + '/auction-house?view=bids'); await anonymous.waitForSelector('.auction-house');
  assert.equal(await anonymous.locator('.house-active-bids').count(), 0);
  assert.equal(await anonymous.locator('.house-lot-state').filter({ hasText: /Winning|Outbid|Du führst|Überboten/ }).count(), 0);
  assert.equal((await guest.request.get(base + '/api/account/resale/bids')).status(), 401);
  assert.ok(await anonymous.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  await guest.close(); await context.close();
  console.log('Auction House browser checks passed: unified prices and types, pinned winning/outbid lots, search/seller/view controls, URL history, real bidding/settlement, guest isolation, keyboard access, and EN/DE layouts at 1440/1024/768/390/320px.');
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve)); closeDataStore(dir);
  await rm(dir, { recursive: true, force: true });
}
