import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createAccountApi } from '../src/account-api.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { maskListing, maskUsername } from '../src/username-privacy.mjs';
import { createPaletteAuction, bidOnPaletteAuction, paletteBidIncrement } from '../src/palette-auctions.mjs';
import { loadPaletteCatalog } from '../src/palette-definitions.mjs';
import { listItem, placeBid } from '../src/resale.mjs';
import { marketState } from '../src/market.mjs';
import { featureFlags } from '../src/features.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { Accounts } from '../src/accounts.mjs';
import { checkStoreEvents } from '../src/store-events.mjs';
import { buyBusiness, stockBusiness } from '../src/businesses.mjs';

const password = 'economy-foundation-password';
const lots = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, title: `Product ${i + 100}`,
  category: 'Werkzeug', image: `/assets/${i}.jpg`, currentBid: 100 + i }));
const env = {
  ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password, COOKIE_SECURE: 'true',
  FEATURE_NEWS: '1', FEATURE_MARKET: 'yes', FEATURE_RESALES: 'true', FEATURE_PALETTES: 'on'
};

async function fixture(t, flags = env) {
  flags = { ...{ FEATURE_NEWS: 'false', FEATURE_MARKET: 'false', FEATURE_RESALES: 'false', FEATURE_PALETTES: 'false', FEATURE_PALETTE_AUCTIONS: 'false' }, ...flags };
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-economy-'));
  upsertAuctions(dir, lots);
  const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  const testFlags = { ...featureFlags(flags), news: flags.FEATURE_NEWS === '1' };
  const economyApi = createEconomyApi({ dataDir: dir, json, flags: testFlags });
  const accountApi = await createAccountApi({ dataDir: dir, dailyPayload: async () => ({ auctions: lots.slice(0, 5) }), json, env: flags, flags: testFlags });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (await economyApi(req, res, url)) return;
    if (await accountApi(req, res, url)) return;
    json(res, 404, { error: 'not_found' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeIdleConnections?.();
    await new Promise(resolve => server.close(resolve));
    server.closeAllConnections?.();
    closeDataStore(dir);
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, base: `http://127.0.0.1:${server.address().port}`, server };
}

const post = (base, route, value, cookie = '') => fetch(`${base}/api/account/${route}`, { method: 'POST',
  headers: { 'content-type': 'application/json', 'x-requested-with': 'JUSTIZGUESSR', cookie }, body: JSON.stringify(value) });

test('public storefronts and player interactions use feature flags, sessions, CSRF and atomic live stock', async t => {
  const { base, dir } = await fixture(t);
  const accounts = new Accounts(dir), time = Date.now();
  const ownerCookie = (await post(base, 'login', { username: 'admin', password })).headers.get('set-cookie');
  const owner = accounts.db(db => db.prepare("SELECT id FROM users WHERE username = 'admin'").get());
  accounts.db(db => {
    db.prepare('UPDATE users SET tokens = 100000 WHERE id = ?').run(owner.id);
    for (let n = 0; n < 3; n++) db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)')
      .run(`http-wine-${n}`, owner.id, JSON.stringify({ title: 'API Wine', price: 100, marketCategory: 'wine' }), time);
  });
  const shop = buyBusiness(dir, owner, 'wine', 'popup', { now: time }).shop;
  stockBusiness(dir, owner, shop.id, ['http-wine-0','http-wine-1','http-wine-2'], { now: time });
  const codes = (await (await post(base, 'codes', { count: 2 }, ownerCookie)).json()).codes;
  const buyerCookie = (await post(base, 'register', { username: 'StoreBuyer', password, code: codes[0] })).headers.get('set-cookie');
  const rivalCookie = (await post(base, 'register', { username: 'StoreRival', password, code: codes[1] })).headers.get('set-cookie');
  assert.equal((await (await fetch(`${base}/api/stores`)).json()).stores[0].owner, 'ad****');
  const view = async cookie => (await (await fetch(`${base}/api/stores/${shop.id}`, { headers: { cookie } })).json()).store;
  assert.equal((await view(buyerCookie)).owner, 'admin');
  const payload = { shopId: shop.id, inventoryId: 'http-wine-0', expectedPrice: 120, requestId: 'store-http-purchase-0001' };
  assert.equal((await post(base, 'stores/buy', payload)).status, 401);
  assert.equal((await fetch(`${base}/api/account/stores/buy`, { method: 'POST', headers: { cookie: buyerCookie, 'content-type': 'application/json' }, body: JSON.stringify(payload) })).status, 403);
  const [buyer, rival] = await Promise.all([post(base, 'stores/buy', payload, buyerCookie), post(base, 'stores/buy', { ...payload, requestId: 'store-http-rival-000001' }, rivalCookie)]);
  assert.deepEqual([buyer.status, rival.status].sort(), [200,409]);
  const winnerCookie = buyer.status === 200 ? buyerCookie : rivalCookie, winningPayload = buyer.status === 200 ? payload : { ...payload, requestId: 'store-http-rival-000001' };
  const replay = await post(base, 'stores/buy', winningPayload, winnerCookie);
  assert.equal(replay.status, 200); assert.equal((await view(winnerCookie)).stock.length, 2);
  const collect={shopId:shop.id,requestId:'http-store-collect-0001',amount:999999};
  assert.equal((await post(base,'businesses/collect',collect)).status,401);
  assert.equal((await fetch(base+'/api/account/businesses/collect',{method:'POST',headers:{cookie:ownerCookie,'content-type':'application/json'},body:JSON.stringify(collect)})).status,403);
  assert.equal((await post(base,'businesses/collect',collect,winnerCookie)).status,404);
  const ownerBalance=accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(owner.id).tokens);
  const collected=await post(base,'businesses/collect',collect,ownerCookie);assert.equal(collected.status,200);
  const paid=await collected.json();assert.equal(paid.collection.amount,120);assert.ok(paid.collectionVersion>0);
  const retry=await (await post(base,'businesses/collect',collect,ownerCookie)).json();
  assert.equal(retry.collection.amount,120);assert.equal(retry.collectionVersion,paid.collectionVersion);
  assert.equal(retry.user.tokens,paid.user.tokens);
  assert.equal(accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(owner.id).tokens),ownerBalance+120);
  assert.equal((await post(base, 'stores/review', { shopId: shop.id, stars: 5, comment: 'Great shop!' }, winnerCookie)).status, 200);
  assert.equal((await view(winnerCookie)).reviewCount, 1);
  assert.equal((await post(base, 'stores/visit', { shopId: shop.id }, winnerCookie)).status, 200);
  assert.equal((await post(base, 'stores/react', { shopId: shop.id, reaction: 'bell' }, winnerCookie)).status, 200);
  assert.ok((await view(winnerCookie)).stock[0].theft);
  assert.equal((await post(base, 'businesses/profile', {shopId:shop.id,name:'API shop',motto:'',securityGuard:false,mischiefEnabled:true,requestId:'enable-mischief-http-001'}, ownerCookie)).status, 200);
  const start = await post(base, 'stores/heist/start', { ...payload, inventoryId: 'http-wine-1', expectedFine:200, requestId: 'store-http-heist-000001' }, winnerCookie);
  assert.equal(start.status, 200);
  const { heist } = await start.json();
  assert.ok(!('sequence' in heist)); assert.ok(!('roll' in heist)); assert.ok(!('deck' in heist.blackjack));
  assert.equal((await view('')).heist, null);
  assert.equal((await post(base, 'stores/heist/action', { heistId: heist.id, action:'stand', turn:0,requestId:'foreign-blackjack-0001' }, ownerCookie)).status, 404);
  accounts.db(db => {
    // A natural win can transfer the item during start. Restore the shelf as
    // well as the hand so this forced stand always tests a live target.
    db.prepare('UPDATE inventory SET user_id=? WHERE id=?').run(owner.id, 'http-wine-1');
    db.prepare('INSERT OR IGNORE INTO business_stock(inventory_id,business_id,stocked_at,asking_price) VALUES(?,?,?,?)')
      .run('http-wine-1', shop.id, time, payload.expectedPrice);
    db.prepare("UPDATE store_heists SET status='active',result=NULL,blackjack=? WHERE id=?")
      .run(JSON.stringify({player:[9,8],dealer:[6,10],deck:[1,2,3,4,5],turn:0,outcome:'active'}),heist.id);
  });
  const finish = await post(base, 'stores/heist/action', { heistId: heist.id, action:'stand',turn:0,requestId:'http-blackjack-action-001' }, winnerCookie);
  assert.equal(finish.status, 200); assert.equal((await finish.json()).heist.outcome, 'stolen');
  assert.ok(!('policeWheel' in (await (await fetch(`${base}/api/stores/${shop.id}`,{headers:{cookie:winnerCookie}})).json()).store.heist));
  assert.equal((await post(base,'stores/heist/spin',{heistId:heist.id,requestId:'http-no-wheel-on-win-1'},winnerCookie)).status,409);
  // Jail applies to every account/game route and authenticated public economy
  // route, while session state, logout and password access stay available.
  const player=accounts.user(winnerCookie.match(/jg_session=([a-f0-9]+)/)[1]);
  accounts.db(db=>db.prepare('INSERT INTO player_justice(user_id,jailed_until,offences) VALUES (?,?,1) ON CONFLICT(user_id) DO UPDATE SET jailed_until=excluded.jailed_until').run(player.id,Date.now()+60000));
  for(const route of ['/api/account/inventory','/api/account/net-worth','/api/account/criminal-record','/api/account/cases','/api/account/leaderboard','/api/stores','/api/town','/api/market'])assert.equal((await fetch(base+route,{headers:{cookie:winnerCookie}})).status,423,route);
  assert.equal((await post(base,'games/start',{mode:'daily'},winnerCookie)).status,423);
  assert.equal((await fetch(base+'/api/account/me',{headers:{cookie:winnerCookie}})).status,200);
  assert.equal((await fetch(base+'/api/account/me',{headers:{cookie:winnerCookie}}).then(r=>r.json())).user.justice.jailed,true);
  accounts.db(db=>db.prepare('UPDATE player_justice SET jailed_until=? WHERE user_id=?').run(Date.now()-1,player.id));
  assert.equal((await fetch(base+'/api/account/inventory',{headers:{cookie:winnerCookie}})).status,200);
  const hidden = createEconomyApi({ dataDir: dir, json: () => {}, flags: { ...featureFlags({}), businesses: false } });
  assert.equal(hidden({ method: 'GET' }, null, new URL('/api/stores', base)), false);
  assert.equal(hidden({ method: 'GET' }, null, new URL(`/api/stores/${shop.id}`, base)), false);
});

test('disabled businesses hide authenticated store interactions', async t => {
  const { base } = await fixture(t, { ...env, FEATURE_BUSINESSES: 'false' });
  const cookie = (await post(base, 'login', { username: 'admin', password })).headers.get('set-cookie');
  for (const route of ['stores/buy','stores/heist/start','stores/review','stores/visit','businesses/profile','businesses/collect']) assert.equal((await post(base, route, {}, cookie)).status, 404);
  assert.equal((await fetch(`${base}/api/stores`)).status, 404);
});

test('admin market overview is read-only and removed adjustment routes cannot change prices',async t=>{
  const {base,dir}=await fixture(t),read=cookie=>fetch(`${base}/api/account/admin/market`,{headers:{cookie}});
  assert.equal((await read('')).status,401);
  const cookie=(await post(base,'login',{username:'admin',password})).headers.get('set-cookie');
  const code=(await(await post(base,'codes',{count:1},cookie)).json()).codes[0];
  const player=(await post(base,'register',{username:'MarketPlayer',password,code})).headers.get('set-cookie');
  assert.equal((await read(player)).status,403);
  const before=await(await read(cookie)).json();assert.equal(before.categories.length,14);
  assert.deepEqual(Object.keys(before),['categories']);
  for(const session of [cookie,player])for(const payload of [
    {category:'wine',percent:-80,requestId:'removed-market-change-01'},
    {category:'wine',action:'reset',requestId:'removed-market-reset-001'}
  ]){
    const response=await post(base,'admin/market/adjust',payload,session);assert.equal(response.status,404);
    assert.deepEqual(await response.json(),{error:'not_found'});
  }
  assert.equal((await post(base,'admin/market/adjust',{},'')).status,401);
  assert.deepEqual(await(await read(cookie)).json(),before);
  const accounts=new Accounts(dir);
  assert.equal(accounts.db(db=>db.prepare('SELECT count(*) n FROM admin_market_adjustments').get().n),0);
  const publicMarket=await(await fetch(base+'/api/market')).json();
  assert.deepEqual(before.categories.map(category=>category.currentIndex),publicMarket.categories.map(category=>category.currentIndex));
});

test('admin market overview stays read-only when the public market flag is disabled',async t=>{
  const {base}=await fixture(t,{...env,FEATURE_MARKET:'false'});
  const cookie=(await post(base,'login',{username:'admin',password})).headers.get('set-cookie');
  assert.equal((await fetch(base+'/api/market')).status,404);
  const read=()=>fetch(base+'/api/account/admin/market',{headers:{cookie}});
  const before=await(await read()).json();assert.equal(before.categories.length,14);
  for(const action of ['adjust','reset'])assert.equal((await post(base,'admin/market/adjust',
    {category:'wine',action,percent:10,requestId:'removed-market-flag-001'},cookie)).status,404);
  assert.deepEqual(await(await read()).json(),before);
});

test('disabled feature flags fall through so unfinished systems stay invisible', () => {
  const handler = createEconomyApi({ dataDir: 'unused', json: () => {}, flags: featureFlags({ FEATURE_NEWS: 'false', FEATURE_MARKET: 'false', FEATURE_RESALES: 'false', FEATURE_PALETTES: 'false', FEATURE_PALETTE_AUCTIONS: 'false' }) });
  for (const path of ['/api/news', '/api/market', '/api/palettes', '/api/resales', '/api/resales/abc']) {
    assert.equal(handler({ method: 'GET' }, null, new URL(path, 'http://localhost')), false);
  }
  assert.equal(handler({ method: 'POST' }, null, new URL('/api/news', 'http://localhost')), false);
});

test('economy endpoints expose news, global market, palettes and resale listings', async t => {
  const { dir, base, server } = await fixture(t);
  const endsAt = new Date(Date.now() + 3600_000).toISOString();
  const login = await post(base, 'login', { username: 'admin', password });
  const cookie = login.headers.get('set-cookie');
  // Admin news tooling seeds the public feed with a real market effect.
  const news = await post(base, 'admin/news', { id: 'news-tool-bust', title: 'Tool importer busted',
    body: 'Seized tools will be auctioned soon.', status: 'published',
    marketEffects: [{ category: 'tools', direction: 'down', magnitude: 4 }] }, cookie);
  assert.equal(news.status, 200);
  const publicNews = await (await fetch(`${base}/api/news`)).json();
  assert.deepEqual(publicNews.news.map(item => item.id), ['news-tool-bust']);
  assert.deepEqual(publicNews.news[0].marketEffects, [{ category: 'tools', direction: 'down', magnitude: 4 }]);
  // Non-admins cannot seed news; bad events are rejected.
  assert.equal((await post(base, 'admin/news', { title: 'x', body: 'y' })).status, 401);
  assert.equal((await post(base, 'admin/news', { title: '', body: 'y' }, cookie)).status, 400);
  assert.equal((await post(base, 'admin/news', { id: 'x', title: 'x', body: 'y', status: 'published',
    marketEffects: [{ category: 'tools', direction: 'down' }] }, cookie)).status, 400);
  const market = await (await fetch(`${base}/api/market`)).json();
  assert.ok(market.categories.length >= 8);
  // The publication moved its category deterministically; the rest stays neutral.
  assert.equal(market.categories.find(category => category.category === 'tools').currentIndex, 96);
  assert.ok(market.categories.filter(category => category.category !== 'tools')
    .every(category => category.currentIndex === 100 && category.baseIndex === 100));
  const palettes = await (await fetch(`${base}/api/palettes`)).json();
  assert.ok(palettes.palettes.some(palette => palette.id === 'fundkiste'));
  assert.doesNotMatch(JSON.stringify(palettes), /"(?:odds|weights|chance)":/);
  // The persisted edition catalog exposes frozen edition metadata and no
  // purchase path.
  const fundkiste = palettes.palettes.find(palette => palette.id === 'fundkiste');
  assert.equal(fundkiste.kind, 'base');
  assert.equal(fundkiste.rewardCount, 3);
  assert.equal(fundkiste.acquisitionMode, 'auction');
  assert.equal(fundkiste.purchasable, false);
  assert.ok(fundkiste.editionId.startsWith('base:fundkiste:'));
  assert.ok(fundkiste.story.fictional);
  assert.equal(fundkiste.available, fundkiste.availability === 'available');
  // Resale flow over HTTP: list an owned item, see it publicly, sell attempt blocked.
  const catalogResponse = await (await fetch(`${base}/api/account/cases`)).json();
  const opened = await (await post(base, 'cases/open', { caseId: 'fundkiste', requestId: 'economy-open-000001',
    revision: catalogResponse.revision }, cookie)).json();
  const listing = await (await post(base, 'resale/listings', { inventoryId: opened.item.id, startPrice: 40, endsAt }, cookie)).json();
  assert.equal(listing.listing.status, 'active');
  const marketplace = (await (await fetch(`${base}/api/resales`)).json()).listings;
  assert.ok(marketplace.some(row => row.id === listing.listing.id));
  // This fixture has only tools, so the business supplier has no eligible
  // auction records and must not invent stock lots.
  assert.equal(marketplace.filter(row => row.sellerUsername === 'St****').length, 0);
  const detail = await (await fetch(`${base}/api/resales/${listing.listing.id}`)).json();
  assert.equal(detail.listing.item.marketCategory, 'tools');
  assert.deepEqual(detail.listing.bids, []);
  // Guests only ever see censored seller names; sessions see the real ones.
  assert.equal((await (await fetch(`${base}/api/resales`)).json()).listings
    .find(row => row.id === listing.listing.id).sellerUsername, 'ad****');
  assert.equal((await (await fetch(`${base}/api/resales/${listing.listing.id}`)).json()).listing.sellerUsername, 'ad****');
  assert.equal((await (await fetch(`${base}/api/resales`, { headers: { cookie } })).json()).listings
    .find(row => row.id === listing.listing.id).sellerUsername, 'admin');
  assert.equal((await (await post(base, 'inventory/sell', { id: opened.item.id }, cookie)).json()).error, 'instant_sell_disabled');
  assert.equal((await fetch(`${base}/api/account/resale/listings`)).status, 401);
  assert.equal((await post(base, 'resale/listings', { inventoryId: opened.item.id, startPrice: 40, endsAt })).status, 401);
  const own = await (await fetch(`${base}/api/account/resale/listings`, { headers: { cookie } })).json();
  assert.deepEqual(own.listings.map(row => row.id), [listing.listing.id]);
  assert.equal((await (await post(base, 'resale/cancel', { id: listing.listing.id }, cookie)).json()).listing.status, 'cancelled');
  assert.equal((await fetch(`${base}/api/resales/missing`)).status, 404);
});

test('marketplace bidder names are censored for guests and full for signed-in players', async t => {
  const { base } = await fixture(t);
  const endsAt = new Date(Date.now() + 3600_000).toISOString();
  const login = await post(base, 'login', { username: 'admin', password });
  const cookie = login.headers.get('set-cookie');
  const code = (await (await post(base, 'codes', { count: 1 }, cookie)).json()).codes[0];
  const join = await post(base, 'register', { username: 'Bidder01', password: 'economy-bidder-password-123', code });
  assert.equal(join.status, 200);
  const bidderCookie = join.headers.get('set-cookie');
  const catalogResponse = await (await fetch(`${base}/api/account/cases`)).json();
  const opened = await (await post(base, 'cases/open', { caseId: 'fundkiste', requestId: 'economy-open-000002',
    revision: catalogResponse.revision }, cookie)).json();
  const listing = await (await post(base, 'resale/listings', { inventoryId: opened.item.id, startPrice: 5, endsAt }, cookie)).json();
  const bid = await (await post(base, 'resale/bid', { id: listing.listing.id, amount: 7 }, bidderCookie)).json();
  assert.equal(bid.listing.currentBid, 5);
  const guest = await (await fetch(`${base}/api/resales/${listing.listing.id}`)).json();
  assert.equal(guest.listing.sellerUsername, 'ad****');
  assert.deepEqual(guest.listing.bids.map(row => row.bidderUsername), ['Bi****']);
  const signedIn = await (await fetch(`${base}/api/resales/${listing.listing.id}`, { headers: { cookie: bidderCookie } })).json();
  assert.equal(signedIn.listing.sellerUsername, 'admin');
  assert.deepEqual(signedIn.listing.bids.map(row => row.bidderUsername), ['Bidder01']);
});

test('archived marketplace bids are authenticated, flag-gated and start empty', async t => {
  const { base } = await fixture(t);
  assert.equal((await fetch(`${base}/api/account/resale/bids/archived`)).status, 401);
  const login = await post(base, 'login', { username: 'admin', password });
  const cookie = login.headers.get('set-cookie');
  const archived = await (await fetch(`${base}/api/account/resale/bids/archived`, { headers: { cookie } })).json();
  assert.deepEqual(archived, { listings: [] });
});

test('username censoring keeps a short prefix and never reveals short names whole', () => {
  assert.equal(maskUsername('admin'), 'ad****');
  assert.equal(maskUsername('mira fund'), 'mi****');
  assert.equal(maskUsername('bob'), 'b****');
  assert.equal(maskUsername('jo'), 'j****');
  assert.equal(maskUsername('x'), '****');
  assert.equal(maskUsername(null), null);
  assert.deepEqual(maskListing({ id: 1, sellerUsername: 'admin', bids: [{ amount: 7, bidderUsername: 'mira fund' }] }),
    { id: 1, sellerUsername: 'ad****', bids: [{ amount: 7, bidderUsername: 'mi****' }] });
  assert.equal(maskListing({ id: 2, sellerUsername: null }).sellerUsername, null);
});

test('account api hides resale routes entirely while the resales flag is off', async t => {
  const { base, server } = await fixture(t, { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password, COOKIE_SECURE: 'true' });
  const login = await post(base, 'login', { username: 'admin', password });
  const cookie = login.headers.get('set-cookie');
  assert.equal((await fetch(`${base}/api/account/resale/listings`, { headers: { cookie } })).status, 404);
  assert.equal((await post(base, 'resale/listings', { inventoryId: 'x', startPrice: 1, endsAt: 'nope' }, cookie)).status, 404);
  assert.equal((await fetch(`${base}/api/news`)).status, 404);
  assert.equal((await fetch(`${base}/api/market`)).status, 404);
  assert.equal((await fetch(`${base}/api/palettes`)).status, 404);
  assert.equal((await fetch(`${base}/api/resales`)).status, 404);
});

test('publication registers market effects even while the market endpoint is hidden', async t => {
  const { dir, base } = await fixture(t, {
    ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password, COOKIE_SECURE: 'true',
    FEATURE_NEWS: '1' // market flag deliberately off
  });
  const login = await post(base, 'login', { username: 'admin', password });
  const cookie = login.headers.get('set-cookie');
  assert.equal((await fetch(`${base}/api/market`)).status, 404);
  const news = await (await post(base, 'admin/news', { id: 'hidden-market-bust', title: 'Wine cellar seized',
    body: 'B.', status: 'published', marketEffects: [{ category: 'wine', direction: 'up', magnitude: 6 }] }, cookie)).json();
  assert.equal(news.event.status, 'published');
  const state = marketState(dir);
  assert.equal(state.categories.find(category => category.category === 'wine').currentIndex, 106);
});


test('both instant-sell HTTP paths reject unlisted items with resales enabled, legacy mode still sells', async t => {
  for (const enabled of [true, false]) {
    const { base } = await fixture(t, { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: password, FEATURE_RESALES: enabled ? '1' : '0' });
    const login = await post(base, 'login', { username: 'admin', password });
    const cookie = login.headers.get('set-cookie');
    const catalog = await fetch(base + '/api/account/cases').then(r => r.json());
    const opened = await post(base, 'cases/open', { caseId: 'fundkiste', requestId: 'instant-guard-00001', revision: catalog.revision }, cookie).then(r => r.json());
    for (const route of ['inventory/sell', 'inventory/sell-all']) {
      const response = await post(base, route, { id: opened.item.id }, cookie);
      assert.equal(response.status, enabled ? 409 : 200);
      if (enabled) assert.equal((await response.json()).error, 'instant_sell_disabled');
    }
  }
});

test('case store stays public with auction features on or off and purchases sealed cases over HTTP', async t => {
  for (const enabled of ['true', 'false']) {
    const { base } = await fixture(t, { ...env, FEATURE_PALETTE_AUCTIONS: enabled, FEATURE_RESALES: enabled });
    const quote = await (await fetch(`${base}/api/account/case-store`)).json();
    assert.deepEqual(quote.cases.map(box => box.id), ['lost-property', 'evidence-locker', 'seizure', 'vault', 'collectors-cache']);
    assert.doesNotMatch(JSON.stringify(quote), /"(?:reward|weights|odds|chance)":/);
    const payload = { caseId: 'lost-property', requestId: 'http-case-purchase-0001', revision: quote.revision };
    assert.equal((await post(base, 'cases/buy', payload)).status, 401);
    const login = await post(base, 'login', { username: 'admin', password });
    const cookie = login.headers.get('set-cookie');
    assert.equal((await post(base, 'cases/buy', { ...payload, revision: undefined }, cookie)).status, 409);
    const before = (await (await fetch(`${base}/api/account/me`, { headers: { cookie } })).json()).user.tokens;
    const results = await Promise.all([post(base, 'cases/buy', payload, cookie), post(base, 'cases/buy', payload, cookie)]);
    assert.ok(results.every(response => response.status === 200));
    const [first, retry] = await Promise.all(results.map(response => response.json()));
    assert.deepEqual(retry.item, first.item);
    assert.equal(first.user.tokens, before - quote.cases[0].cost);
    assert.equal(first.item.kind, 'case'); assert.equal(first.item.caseType, 'lost-property');
    assert.equal(first.store.cases[0].stock.remaining, 99);
    const publicStock = await (await fetch(`${base}/api/account/case-store`)).json();
    assert.equal(publicStock.cases[0].stock.remaining, 99);
    assert.equal(publicStock.revision, quote.revision);
    assert.ok(!('reward' in first.item) && !('auctionId' in first.item));
    const inventory = await (await fetch(`${base}/api/account/inventory`, { headers: { cookie } })).json();
    assert.equal(inventory.items.length, 1); assert.equal(inventory.items[0].id, first.item.id);
    const opened = await post(base, 'inventory/case/open', { id: first.item.id }, cookie);
    assert.equal(opened.status, 200);
    assert.ok((await opened.json()).item.auctionId);
    assert.equal((await post(base, 'cases/buy', { ...payload, caseId: 'seizure' }, cookie)).status, 409);
  }
});


test('concurrent direct case purchases cannot exceed global stock over HTTP', async t => {
  const { base, dir } = await fixture(t);
  const accounts = new Accounts(dir);
  accounts.db(db => db.prepare('UPDATE users SET tokens = 10000000 WHERE username = ?').run('admin'));
  const login = await post(base, 'login', { username: 'admin', password });
  const cookie = login.headers.get('set-cookie');
  const quote = await (await fetch(`${base}/api/account/case-store`)).json();
  const before = (await (await fetch(`${base}/api/account/me`, { headers: { cookie } })).json()).user.tokens;
  const limit = quote.cases[0].stock.limit;
  assert.equal(limit, 100);
  const results = await Promise.all(Array.from({ length: limit + 2 }, (_, i) => post(base, 'cases/buy', {
    caseId: 'lost-property', revision: quote.revision, requestId: `concurrent-case-stock-${i}-0001`
  }, cookie)));
  assert.equal(results.filter(response => response.status === 200).length, limit);
  const rejected = results.filter(response => response.status !== 200);
  assert.equal(rejected.length, 2);
  for (const response of rejected) {
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'case_out_of_stock' });
  }
  const stock = await (await fetch(`${base}/api/account/case-store`)).json();
  assert.equal(stock.cases[0].stock.remaining, 0);
  assert.deepEqual(stock.cases.slice(1).map(box => box.stock.remaining), [60, 35, 20, 10]);
  const inventory = await (await fetch(`${base}/api/account/inventory`, { headers: { cookie } })).json();
  assert.equal(inventory.items.length, limit);
  const after = (await (await fetch(`${base}/api/account/me`, { headers: { cookie } })).json()).user.tokens;
  assert.equal(after, before - limit * quote.cases[0].cost);
});

test('store events and the three-store cap use live sessions, CSRF, private results and idempotent acknowledgement', async t => {
  const { base, dir } = await fixture(t);
  const accounts = new Accounts(dir), time = Date.now();
  const ownerCookie = (await post(base, 'login', { username: 'admin', password })).headers.get('set-cookie');
  const owner = accounts.db(db => db.prepare("SELECT id FROM users WHERE username = 'admin'").get());
  accounts.db(db => db.prepare('UPDATE users SET tokens=100000 WHERE id=?').run(owner.id));
  const shop = buyBusiness(dir, owner, 'wine', 'popup', { now: time }).shop;
  buyBusiness(dir, owner, 'wine', 'popup', { now: time });
  buyBusiness(dir, owner, 'toys', 'popup', { now: time });
  const before = accounts.db(db => db.prepare('SELECT tokens FROM users WHERE id=?').get(owner.id).tokens);
  const capped = await post(base, 'businesses/buy', { type: 'electronics', size: 'popup' }, ownerCookie);
  assert.equal(capped.status,409); assert.equal((await capped.json()).error,'store_limit_reached');
  assert.equal(accounts.db(db => db.prepare('SELECT tokens FROM users WHERE id=?').get(owner.id).tokens),before);
  accounts.db(db => db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES (?,?,?,?)').run('event-api-item',owner.id,JSON.stringify({title:'Event wine',price:100,marketCategory:'wine'}),time));
  stockBusiness(dir,owner,shop.id,['event-api-item'],{now:time});
  accounts.db(db => db.prepare('UPDATE businesses SET bought_at=?, last_tick_at=?, traffic_popularity=0 WHERE id=?').run(time-2*86400000,time,shop.id));
  const event = checkStoreEvents(dir,owner,{now:time,random:()=>0}).events[0];
  assert.equal((await post(base,'stores/events/check',{})).status,401);
  assert.equal((await fetch(base+'/api/account/stores/events/acknowledge',{method:'POST',headers:{cookie:ownerCookie,'content-type':'application/json'},body:JSON.stringify({ids:[event.id]})})).status,403);
  const code=(await (await post(base,'codes',{count:1},ownerCookie)).json()).codes[0];
  const rivalCookie=(await post(base,'register',{username:'EventRival',password,code})).headers.get('set-cookie');
  assert.deepEqual((await (await post(base,'stores/events/check',{},rivalCookie)).json()).events,[]);
  await post(base,'stores/events/acknowledge',{ids:[event.id]},rivalCookie);
  const pending=(await (await post(base,'stores/events/check',{event:'windfall',random:0,shopId:shop.id},ownerCookie)).json()).events;
  assert.equal(pending.length,1); assert.equal(pending[0].type,'bombing');
  assert.equal((await post(base,'stores/events/acknowledge',{ids:[]},ownerCookie)).status,400);
  assert.deepEqual((await (await post(base,'stores/events/acknowledge',{ids:[event.id]},ownerCookie)).json()).events,[]);
  assert.deepEqual((await (await post(base,'stores/events/acknowledge',{ids:[event.id]},ownerCookie)).json()).events,[]);
  assert.deepEqual((await (await post(base,'stores/events/check',{},ownerCookie)).json()).events,[]);
});


test('police wheel HTTP requires authentication, CSRF and ownership, conceals the saved outcome and settles retries once',async t=>{
 const {base,dir}=await fixture(t);const accounts=new Accounts(dir),now=Date.now();
 const ownerCookie=(await post(base,'login',{username:'admin',password})).headers.get('set-cookie');
 const owner=accounts.db(db=>db.prepare("SELECT id FROM users WHERE username='admin'").get());
 accounts.db(db=>{db.prepare('UPDATE users SET tokens=100000 WHERE id=?').run(owner.id);db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run('wheel-wine',owner.id,JSON.stringify({title:'Wine',price:100,marketCategory:'wine'}),now);});
 const shop=buyBusiness(dir,owner,'wine','popup',{now}).shop;stockBusiness(dir,owner,shop.id,['wheel-wine'],{now});
 const codes=(await (await post(base,'codes',{count:1},ownerCookie)).json()).codes;
 const cookie=(await post(base,'register',{username:'WheelPlayer',password,code:codes[0]})).headers.get('set-cookie');
 const quote=(await (await fetch(`${base}/api/stores/${shop.id}`,{headers:{cookie}})).json()).store.stock[0];
 const started=await post(base,'stores/heist/start',{shopId:shop.id,inventoryId:quote.id,expectedPrice:quote.price,expectedFine:quote.theft.fine,requestId:'http-wheel-start-0001'},cookie);
 const id=(await started.json()).receipt.id;
 accounts.db(db=>{
  // A random natural can win before we replace this isolated test hand.
  db.prepare('UPDATE inventory SET user_id=? WHERE id=?').run(owner.id,'wheel-wine');
  db.prepare('INSERT OR IGNORE INTO business_stock(inventory_id,business_id,stocked_at,asking_price) VALUES(?,?,?,?)').run('wheel-wine',shop.id,now,quote.price);
  db.prepare("UPDATE store_heists SET status='active',result=NULL,blackjack=? WHERE id=?").run(JSON.stringify({player:[2,3],dealer:[9,8],deck:[0,1,4,5,6],turn:0,outcome:'active'}),id);
 });
 const losing=await post(base,'stores/heist/action',{heistId:id,action:'stand',turn:0,requestId:'http-wheel-loss-00001'},cookie);
 const staged=(await losing.json()).heist;assert.equal(staged.outcome,'police');assert.ok(!('sector' in staged.policeWheel));assert.ok(!('roll' in staged));
 const payload={heistId:id,requestId:'http-wheel-spin-00001',outcome:'caught',roll:0};
 assert.equal((await post(base,'stores/heist/spin',payload)).status,401);
 assert.equal((await fetch(base+'/api/account/stores/heist/spin',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(payload)})).status,403);
 assert.equal((await post(base,'stores/heist/spin',payload,ownerCookie)).status,404);
 assert.equal((await post(base,'stores/heist/spin',{requestId:'http-wheel-bad-id-001'},cookie)).status,404);
 accounts.db(db=>db.prepare('UPDATE store_heists SET roll=999999 WHERE id=?').run(id));
 const spun=(await (await post(base,'stores/heist/spin',payload,cookie)).json());assert.equal(spun.heist.outcome,'escaped');assert.equal(spun.user.justice.offences,0);
 assert.deepEqual((await (await post(base,'stores/heist/spin',payload,cookie)).json()).heist,spun.heist);
 assert.equal(accounts.db(db=>db.prepare('SELECT user_id FROM inventory WHERE id=?').get('wheel-wine').user_id),owner.id);
});


test('auction details expose only the viewer own escrow and allow raises above the free wallet balance', async t => {
  const { base, dir } = await fixture(t, { ...env, FEATURE_PALETTE_AUCTIONS: 'true', FEATURE_BUSINESSES: 'false' });
  const adminCookie = (await post(base, 'login', { username: 'admin', password })).headers.get('set-cookie');
  const codes = (await (await post(base, 'codes', { count: 2 }, adminCookie)).json()).codes;
  const bidderCookie = (await post(base, 'register', { username: 'EscrowBidder', password, code: codes[0] })).headers.get('set-cookie');
  const otherCookie = (await post(base, 'register', { username: 'EscrowViewer', password, code: codes[1] })).headers.get('set-cookie');
  const accounts = new Accounts(dir), now = Date.now();
  const user = cookie => accounts.user(cookie.match(/jg_session=([a-f0-9]+)/)[1]);
  const admin = user(adminCookie), bidder = user(bidderCookie);
  accounts.db(db => db.prepare('INSERT INTO inventory (id, user_id, item, created_at) VALUES (?, ?, ?, ?)')
    .run('escrow-http-item', admin.id, JSON.stringify({ title: 'Tool', price: 100, rarity: 'common', marketCategory: 'tools' }), now));
  const resale = listItem(dir, admin, { inventoryId: 'escrow-http-item', startPrice: 10,
    endsAt: new Date(now + 3600_000).toISOString() }, { now });
  placeBid(dir, bidder, resale.id, 161, { now });
  const read = async (path, cookie) => {
    const response = await fetch(base + path, { headers: cookie ? { cookie } : {} });
    assert.equal(response.status, 200); return response.json();
  };
  const resalePath = '/api/resales/' + resale.id;
  const own = (await read(resalePath, bidderCookie)).listing;
  assert.equal(own.bidding.availableTokens, 839);
  assert.equal(own.bidding.reservedMaximum, 161);
  assert.equal(own.bidding.maximumBid, 1000);
  assert.equal(own.bidding.leading, true);
  const raised = await post(base, 'resale/bid', { id: resale.id, amount: 870 }, bidderCookie);
  assert.equal(raised.status, 200); assert.equal((await raised.json()).user.tokens, 130);
  const ownRaised = (await read(resalePath, bidderCookie)).listing;
  assert.equal(ownRaised.bidding.reservedMaximum, 870);
  assert.equal(ownRaised.bidding.maximumBid, 1000);
  assert.ok(!('bidding' in (await read(resalePath)).listing));
  const other = (await read(resalePath, otherCookie)).listing;
  assert.equal(other.bidding.reservedMaximum, 0); assert.equal(other.bidding.leading, false);
  assert.equal(other.bidding.maximumBid, 1000);
  assert.equal((await post(base, 'resale/bid', { id: resale.id, amount: 1001 }, bidderCookie)).status, 409);
  assert.equal(accounts.profile(bidder).tokens, 130);
  // The same private budget and raise semantics apply to primary palettes.
  upsertAuctions(dir, Array.from({ length: 24 }, (_, n) => ({ id: 1000 + n, title: `Laptop Lenovo ${n}`,
    category: 'Elektronik', currentBid: 10 + n * 20, image: '/favicon.png' })));
  const edition = loadPaletteCatalog(dir, { now }).palettes.find(p => p.id === 'fundkiste');
  const palette = createPaletteAuction(dir, { editionId: edition.editionId, requestId: 'escrow-http-palette' }, { now, random: () => 0 });
  const first = palette.reserve + 160, maximum = first + 839;
  accounts.db(db => db.prepare('UPDATE users SET tokens = ? WHERE id = ?').run(maximum, bidder.id));
  bidOnPaletteAuction(dir, bidder, palette.id, first, { now });
  const palettePath = '/api/palette-auctions/' + palette.id;
  const ownPalette = (await read(palettePath, bidderCookie)).auction;
  assert.equal(ownPalette.bidding.availableTokens, 839);
  assert.equal(ownPalette.bidding.reservedMaximum, first);
  assert.equal(ownPalette.bidding.maximumBid, maximum);
  const increment = paletteBidIncrement(palette.reserve), next = first + Math.max(800, increment);
  assert.ok(next > 839);
  const primaryRaised = await post(base, 'palette-auctions/bid', { id: palette.id, amount: next }, bidderCookie);
  assert.equal(primaryRaised.status, 200);
  assert.equal((await primaryRaised.json()).user.tokens, maximum - next);
  assert.ok(!('bidding' in (await read(palettePath)).auction));
  const otherPalette = (await read(palettePath, otherCookie)).auction;
  assert.equal(otherPalette.bidding.reservedMaximum, 0); assert.equal(otherPalette.bidding.leading, false);
  assert.equal(otherPalette.bidding.maximumBid, 1000);
});

test('palette bidder names require a current unrestricted session', async t => {
  const { base, dir } = await fixture(t, { ...env, FEATURE_PALETTE_AUCTIONS: 'true', FEATURE_BUSINESSES: 'false' });
  const accounts = new Accounts(dir), now = Date.now();
  const bidder = accounts.db(db => db.prepare("SELECT id FROM users WHERE username='admin'").get());
  accounts.db(db => {
    db.prepare('UPDATE users SET tokens=100000 WHERE id=?').run(bidder.id);
    db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES ('privacy-viewer','PrivacyViewer','disabled',1000,?)").run(now);
  });
  upsertAuctions(dir, Array.from({ length: 24 }, (_, n) => ({ id: 1000 + n, title: `Laptop Lenovo ${n}`,
    category: 'Elektronik', currentBid: 10 + n * 20, image: '/favicon.png' })));
  const edition = loadPaletteCatalog(dir, { now }).palettes.find(p => p.id === 'fundkiste');
  const auction = createPaletteAuction(dir, { editionId: edition.editionId, requestId: 'bidder-privacy-http' }, { now, random: () => 0 });
  bidOnPaletteAuction(dir, bidder, auction.id, auction.reserve, { now });
  const session = id => accounts.atomic(db => accounts.session(db, id));
  const read = async (token, expected) => {
    const response = await fetch(`${base}/api/palette-auctions/${auction.id}`, {
      headers: token === undefined ? {} : { cookie: `jg_session=${token}` }
    });
    assert.equal(response.status, 200);
    const result = (await response.json()).auction;
    assert.equal(result.id, auction.id);
    assert.deepEqual(result.bids.map(bid => bid.bidderUsername), [expected]);
    assert.equal(result.bids[0].amount, auction.reserve);
  };
  for (const token of [undefined, 'invalid', 'a'.repeat(64)]) await read(token, 'ad****');
  await read(session(bidder.id), 'admin');
  await read(session('privacy-viewer'), 'admin');
  const loggedOut = session('privacy-viewer');
  accounts.logout(loggedOut);
  await read(loggedOut, 'ad****');
  for (const state of ['expired', 'banned', 'temporary']) {
    accounts.db(db => db.prepare("UPDATE users SET banned=0,must_change_password=0 WHERE id='privacy-viewer'").run());
    const token = session('privacy-viewer');
    accounts.db(db => {
      if (state === 'expired') db.prepare("UPDATE account_sessions SET expires=0 WHERE user_id='privacy-viewer'").run();
      else if (state === 'banned') db.prepare("UPDATE users SET banned=1 WHERE id='privacy-viewer'").run();
      else db.prepare("UPDATE users SET must_change_password=2 WHERE id='privacy-viewer'").run();
    });
    await read(token, 'ad****');
  }
});
