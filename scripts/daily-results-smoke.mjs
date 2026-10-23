import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { featureFlags } from '../src/features.mjs';
import { createGuestGameApi } from '../src/guest-game-api.mjs';
import { publicDailySummary } from '../src/game-rounds.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/home/lxadm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp('/tmp/jg-daily-results-');
const env = { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'daily-browser-password', COOKIE_SECURE: 'false' }, flags = featureFlags(env);
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
const seed = JSON.parse(await readFile(path.join(root, 'seed/auctions.json'), 'utf8'));
upsertAuctions(dir, seed.auctions);
const daily = { date: new Date().toISOString().slice(0, 10), gameNumber: 286, auctions: seed.auctions.slice(0, 5).map(item => ({ ...item, actualBid: item.currentBid })) };
const api = await createAccountApi({ dataDir: dir, json, env, flags, dailyPayload: async () => daily });
const accounts = new Accounts(dir, { flags });
const adminToken = await accounts.login({ username: 'admin', password: env.ADMIN_PASSWORD });
const admin = accounts.user(adminToken);
const secondToken = await accounts.register({ username: 'opener', password: env.ADMIN_PASSWORD, code: accounts.codes(admin, 1)[0] });
const economy = createEconomyApi({ dataDir: dir, json, flags, accounts });
const guestApi = createGuestGameApi({ dataDir: dir, json, env, dailyPayload: async () => daily, randomPayload: async () => daily });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/daily') return json(res, 200, publicDailySummary(daily));
    if (await api(req, res, url) || await economy(req, res, url) || await guestApi(req, res, url)) return;
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
    const filename = url.pathname === '/' || !path.extname(url.pathname) ? '/index.html' : url.pathname;
    const content = await readFile(path.join(root, 'dist', filename));
    res.writeHead(200, { 'content-type': filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(content);
  } catch (error) { json(res, 500, { error: error.message }); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  for (const [token, choice] of [[adminToken, 'keep'], [secondToken, 'open']]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: 'jg_session', value: token, url: base }]);
    const post = async (route, data) => {
      const response = await context.request.post(base + '/api/account/' + route, { data, headers: { 'x-requested-with': 'JUSTIZGUESSR' } });
      assert.ok(response.ok(), `${route}: ${await response.text()}`); return response.json();
    };
    const { run } = await post('games/start', { mode: 'daily' });
    for (let i = 0; i < 5; i++) {
      await post('games/round/start', { id: run.id, position: i });
      await post('games/answer', { id: run.id, position: i, answer: daily.auctions[i].actualBid });
    }
    await context.addInitScript(() => {
      window.copiedResults = [];
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => window.copiedResults.push(text) } });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => !!account && !!dailyMeta);
    await page.evaluate(() => startGame());
    await page.waitForSelector('.daily-case-dialog[open]');
    for (const width of [1440, 768, 390, 320]) for (const language of ['en', 'de']) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(lang => { document.querySelector('#language-select').value = lang; document.querySelector('#language-select').dispatchEvent(new Event('change', { bubbles: true })); }, language);
      assert.equal(await page.locator('.daily-case-dialog button').count(), 2);
      assert.deepEqual(await page.locator('.daily-case-dialog button').allTextContents(), language === 'en' ? ['Open Now', 'Add to inventory'] : ['Jetzt öffnen', 'Zum Inventar hinzufügen']);
      assert.equal(await page.locator('.results-actions button').count(), 2);
      assert.equal(await page.locator('.result-cell:visible').count(), 15);
      assert.deepEqual((await page.locator('.results-actions button').allTextContents()).map(text => text.trim().replace(/\s+→$/, '')), language === 'en' ? ['Copy Results', 'Play the archive'] : ['Ergebnis kopieren', 'Archiv spielen']);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px ${language} overflow`);
      assert.ok(await page.locator('.daily-case-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${width}px ${language} dialog overflow`);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(document.querySelector('.results-screen').getAnimations().map(animation => animation.finished.catch(() => {})));
        document.querySelector('#notification-toasts').replaceChildren();
      });
      if (choice === 'keep' && [1440, 390].includes(width)) {
        await page.screenshot({ path: `/tmp/jg-daily-popup-${width}-${language}.png`, fullPage: true });
        await page.evaluate(() => dailyCaseDialog.close());
        await page.screenshot({ path: `/tmp/jg-daily-results-${width}-${language}.png`, fullPage: true });
        await page.evaluate(() => renderDailyCaseDialog());
      }
    }
    await page.locator(`.daily-case-dialog [data-choice="${choice}"]`).click();
    await page.waitForFunction(() => !dailyCaseBusy && !dailyCaseDialog.open);
    if (choice === 'open') {
      await page.waitForSelector('.case-reveal[open] [data-account="close-reveal"]');
      assert.equal(await page.locator('.case-reveal[open] .case-reveal-actions button').count(),1);
      assert.equal(await page.locator('.case-reveal[open] .case-reveal-actions a').count(),0);
      assert.equal(accounts.inventory(accounts.user(token)).filter(item => item.kind === 'case').length, 0);
      await page.locator('.case-reveal[open] [data-account="close-reveal"]').click();
    } else assert.equal(accounts.inventory(accounts.user(token)).filter(item => item.kind === 'case').length, 1);
    assert.equal(new URL(page.url()).pathname, '/');
    assert.equal(await page.locator('.results-screen').isVisible(), true);
    await page.locator('.results-actions [data-action="copy"]').click();
    const copied = await page.evaluate(() => window.copiedResults.at(-1));
    assert.ok(copied.endsWith(base + '/')); assert.doesNotMatch(copied, /streak/i);
    await page.locator('.results-actions [data-action="random"]').click();
    await page.waitForSelector('#guess-form');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Daily browser checks passed: EN/DE at 1440/768/390/320px, exact actions, real keep/open rewards, clipboard URL, archive launch and no browser errors.');
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve)); closeDataStore(dir); await rm(dir, { recursive: true, force: true });
}
