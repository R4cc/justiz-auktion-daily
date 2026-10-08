import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, transaction } from '../src/database.mjs';
import { advanceShop, businessDashboard, buyBusiness, ensureBusinessSchema, stockBusiness } from '../src/businesses.mjs';
import { ensureTownSchema, TOWN_PLOTS } from '../src/town-plots.mjs';
import { townMap } from '../src/town-map.mjs';
import { visitStore, startStoreHeist, customizeStore } from '../src/storefronts.mjs';
import { createEconomyApi } from '../src/economy-api.mjs';
import { createAccountApi } from '../src/account-api.mjs';
import { featureFlags } from '../src/features.mjs';

const now = Date.parse('2026-10-08T12:00:00Z'), hour = 3_600_000;
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jg-town-'));
  const accounts = new Accounts(dir, { now: () => now });
  const owner = { id: 'owner', admin: true }, buyer = { id: 'buyer' };
  accounts.db(db => {
    for (const user of [owner, buyer]) db.prepare(`INSERT INTO users (id, username, password_hash, tokens, created_at, admin)
      VALUES (?, ?, 'disabled', 1000000, ?, ?)`).run(user.id, `${user.id}Name`, now, Number(Boolean(user.admin)));
  });
  t.after(async () => { closeDataStore(dir); await rm(dir, { recursive: true, force: true }); });
  return { dir, accounts, owner, buyer, balance: user => accounts.db(db => db.prepare('SELECT tokens FROM users WHERE id=?').get(user.id).tokens) };
}

test('town has 25 durable plots in six districts, fixed sizes, prices and public store locations', async t => {
  const f = await fixture(t), initial = townMap(f.dir, null, { now });
  assert.equal(initial.total, 25); assert.equal(initial.available, 25);
  assert.equal(initial.districts.length, 6); assert.equal(new Set(initial.plots.map(p => p.id)).size, 25);
  assert.deepEqual(new Set(initial.plots.map(p => p.streetType)), new Set(['main', 'side', 'residential']));
  assert.equal(initial.plots.find(p => p.id === 'hietzing-1').costs.wine, 1700);
  assert.equal(initial.plots.find(p => p.id === 'favoriten-1').theftMultiplier, 1.8);
  const shop = buyBusiness(f.dir, f.owner, 'wine', null, { now, plotId: 'hietzing-1' }).shop;
  const guest = townMap(f.dir, null, { now }), signed = townMap(f.dir, f.owner, { now });
  assert.equal(guest.available, 24); assert.equal(guest.myStoreCount, 0);
  assert.equal(guest.plots.find(p => p.id === 'hietzing-1').business.owner, 'ow****');
  assert.equal(signed.plots.find(p => p.id === 'hietzing-1').business.owner, 'ownerName');
  assert.equal(signed.plots.find(p => p.id === 'hietzing-1').business.own, true);
  assert.equal(signed.myStoreCount, 1);
  assert.equal(visitStore(f.dir, null, shop.id, { now }).store.location.plotId, 'hietzing-1');
  assert.doesNotMatch(JSON.stringify(guest), /password_hash|last_tick|plot_since|tokens|ownerName|user_id/);
  f.accounts.db(db => db.prepare('UPDATE users SET must_change_password=1 WHERE id=?').run(f.owner.id));
  assert.equal(townMap(f.dir, f.owner, { now }).plots.find(p => p.id === 'hietzing-1').business.owner, 'ow****');
  f.accounts.db(db => db.prepare('UPDATE users SET banned=1 WHERE id=?').run(f.owner.id));
  const reserved = townMap(f.dir, f.buyer, { now }).plots.find(p => p.id === 'hietzing-1');
  assert.equal(reserved.occupied, true); assert.equal(reserved.business, null);
  closeDataStore(f.dir);
  assert.deepEqual(townMap(f.dir, null, { now }).plots.map(p => [p.id, p.size]), initial.plots.map(p => [p.id, p.size]));
});

test('legacy businesses receive unique plots once without losing size, stock, names or money', async t => {
  const f = await fixture(t);
  f.accounts.db(db => {
    db.exec('DROP INDEX businesses_plot; ALTER TABLE businesses DROP COLUMN plot_id; ALTER TABLE businesses DROP COLUMN plot_since; DELETE FROM town_plots');
    for (let n = 0; n < 25; n++) db.prepare(`INSERT INTO businesses (id,user_id,type,size,bought_at,last_tick_at,store_name)
      VALUES (?,'owner','wine','large',?,?,'Legacy cellar')`).run(`legacy-${String(n).padStart(2, '0')}`, now - hour + n, now);
    db.prepare('INSERT INTO inventory (id,user_id,item,created_at) VALUES (?,?,?,?)')
      .run('legacy-stock', 'owner', JSON.stringify({title: 'Legacy Riesling', price: 100, marketCategory: 'wine'}), now);
    db.prepare(`INSERT INTO business_stock (inventory_id,business_id,stocked_at,asking_price) VALUES ('legacy-stock','legacy-00',?,120)`).run(now);
  });
  const balance = f.balance(f.owner);
  f.accounts.db(db => transaction(db, () => ensureBusinessSchema(db, { now })));
  const migrated = townMap(f.dir, f.owner, { now });
  assert.equal(migrated.total, 25); assert.equal(migrated.available, 0);
  assert.equal(migrated.myStoreCount, 25);
  assert.ok(migrated.plots.every(p => p.size === 'large' && p.business.name === 'Legacy cellar'));
  assert.equal(migrated.plots.reduce((sum, p) => sum + p.business.stockCount, 0), 1);
  assert.equal(f.balance(f.owner), balance);
  const assignments = () => f.accounts.db(db => db.prepare('SELECT id,plot_id,plot_since,size FROM businesses ORDER BY id').all());
  const first = assignments();
  assert.equal(new Set(first.map(b => b.plot_id)).size, 25); assert.ok(first.every(b => b.plot_since === now));
  assert.equal(businessDashboard(f.dir, f.owner, { now }).shops[0].capacity, 150);
  closeDataStore(f.dir);
  f.accounts.db(db => ensureBusinessSchema(db, { now: now + hour }));
  assert.deepEqual(assignments(), first);
  assert.throws(() => buyBusiness(f.dir, f.owner, 'wine', null, { now, plotId: 'hietzing-1' }), /store_limit_reached/);
  assert.throws(() => buyBusiness(f.dir, f.buyer, 'wine', 'large', { now }), /no_available_plot/);
});

test('saves already above 25 stores get only enough grandfathered plots; future purchases never expand the catalog', async t => {
  const f = await fixture(t);
  f.accounts.db(db => {
    db.prepare('DELETE FROM town_plots').run();
    for (let n = 0; n < 32; n++) db.prepare(`INSERT INTO businesses (id,user_id,type,size,bought_at,last_tick_at)
      VALUES (?,'owner','wine','popup',?,?)`).run(`overflow-${n}`, now, now);
    transaction(db, () => ensureTownSchema(db, { now }));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM businesses WHERE plot_id IS NULL').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM town_plots').get().n, 32);
  });
  assert.equal(townMap(f.dir, f.owner, { now }).total,32);
  assert.throws(() => buyBusiness(f.dir, f.buyer, 'wine', 'popup', { now }), /no_available_plot/);
  closeDataStore(f.dir);
  assert.equal(townMap(f.dir, f.owner, { now }).total,32);
});

test('plot purchase enforces fixed capacity, location price, exclusivity and the three-store cap atomically', async t => {
  const f = await fixture(t), before = f.balance(f.owner);
  const purchase = buyBusiness(f.dir, f.owner, 'cars', null, { now, plotId: 'hietzing-2' });
  assert.equal(purchase.cost, 17000); assert.equal(purchase.shop.size, 'tiny'); assert.equal(purchase.shop.capacity, 3);
  assert.equal(f.balance(f.owner), before - 17000);
  const buyerBefore = f.balance(f.buyer);
  assert.throws(() => buyBusiness(f.dir, f.buyer, 'wine', null, { now, plotId: 'hietzing-2' }), /plot_occupied/);
  assert.throws(() => buyBusiness(f.dir, f.buyer, 'wine', 'large', { now, plotId: 'favoriten-1' }), /plot_size_mismatch/);
  assert.throws(() => buyBusiness(f.dir, f.buyer, 'wine', null, { now, plotId: {} }), /invalid_plot/);
  assert.throws(() => buyBusiness(f.dir, f.buyer, 'wine', null, { now, plotId: 'missing' }), /plot_not_found/);
  assert.equal(f.balance(f.buyer), buyerBefore);
  buyBusiness(f.dir, f.owner, 'wine', null, { now, plotId: 'favoriten-1' });
  buyBusiness(f.dir, f.owner, 'toys', null, { now, plotId: 'neubau-1' });
  const capped = f.balance(f.owner);
  assert.throws(() => buyBusiness(f.dir, f.owner, 'wine', null, { now, plotId: 'leopoldstadt-1' }), /store_limit_reached/);
  assert.equal(f.balance(f.owner), capped);
  f.accounts.db(db => db.prepare('UPDATE users SET tokens=1 WHERE id=?').run(f.buyer.id));
  assert.throws(() => buyBusiness(f.dir, f.buyer, 'wine', null, { now, plotId: 'leopoldstadt-1' }), /insufficient_tokens/);
  assert.equal(townMap(f.dir, f.buyer, { now }).plots.find(p => p.id === 'leopoldstadt-1').occupied, false);
  f.accounts.resetEconomy(f.owner, 'RESET ECONOMY');
  const reset = townMap(f.dir, f.owner, { now });
  assert.equal(reset.available, 25); assert.equal(reset.myStoreCount, 0);
  assert.deepEqual(reset.plots.map(p => p.size), [...TOWN_PLOTS].sort((a,b) => a.id.localeCompare(b.id)).map(p => p.size));
});

test('street traffic changes actual hourly visitors and applies only after migration time', async t => {
  const visitors = {};
  for (const street of ['side', 'main', 'residential']) {
    const f = await fixture(t), shop = buyBusiness(f.dir, f.owner, 'wine', null, { now, plotId: 'leopoldstadt-3' }).shop;
    f.accounts.db(db => {
      db.prepare('UPDATE town_plots SET street_type=? WHERE id=?').run(street, shop.location.plotId);
      db.prepare('UPDATE businesses SET id=?,traffic_popularity=1 WHERE id=?').run('same-traffic-shop', shop.id);
      advanceShop(db, db.prepare('SELECT * FROM businesses').get(), now + 200 * hour);
      visitors[street] = db.prepare('SELECT visitors FROM businesses').get().visitors;
    });
  }
  assert.equal(visitors.side, 1000);
  assert.ok(visitors.main > visitors.side * 1.4); assert.ok(visitors.residential < visitors.side * .75);
  const f = await fixture(t), shop = buyBusiness(f.dir, f.owner, 'wine', null, { now, plotId: 'leopoldstadt-3' }).shop;
  f.accounts.db(db => {
    db.prepare('UPDATE businesses SET traffic_popularity=1,plot_since=? WHERE id=?').run(now + 2 * hour, shop.id);
    advanceShop(db, db.prepare('SELECT * FROM businesses').get(), now + hour);
    assert.equal(db.prepare('SELECT visitors FROM businesses').get().visitors, 5);
  });
});

test('district theft odds appear in quotes, reject stale odds and freeze into paid attempts', async t => {
  const f = await fixture(t);
  const shops = ['favoriten-1', 'hietzing-1'].map(plotId => buyBusiness(f.dir, f.owner, 'wine', null, { now, plotId }).shop);
  for (const [n,shop] of shops.entries()) {
    f.accounts.db(db => db.prepare('INSERT INTO inventory (id,user_id,item,created_at) VALUES (?,?,?,?)')
      .run(`wine-${n}`, f.owner.id, JSON.stringify({title:'Riesling',price:100,marketCategory:'wine'}), now));
    stockBusiness(f.dir, f.owner, shop.id, [`wine-${n}`], { now });
  }
  const stock = shop => visitStore(f.dir, f.buyer, shop.id, { now }).store.stock[0];
  assert.equal(stock(shops[0]).theft.chancePercent, 52); assert.equal(stock(shops[1]).theft.chancePercent, 18);
  const payload = { shopId:shops[0].id, inventoryId:'wine-0', expectedPrice:120, expectedFee:10, expectedChance:29, requestId:'town-heist-attempt-001' };
  const before = f.balance(f.buyer);
  assert.throws(() => startStoreHeist(f.dir, f.buyer, payload, { now }), /store_risk_changed/);
  assert.equal(f.balance(f.buyer), before);
  const attempt = startStoreHeist(f.dir, f.buyer, { ...payload, expectedChance:52 }, { now, draw:() => 0 });
  assert.equal(f.balance(f.buyer), before - 10);
  customizeStore(f.dir, f.owner, {shopId:shops[0].id,name:'Goose',motto:'',gooseGuard:true,requestId:'town-goose-profile-001'}, { now });
  assert.equal(stock(shops[0]).theft.chancePercent, 26);
  assert.equal(f.accounts.db(db => db.prepare('SELECT chance FROM store_heists WHERE id=?').get(attempt.id).chance), 52);
});

test('public town HTTP routes respect feature flags and sessions; simultaneous claims cannot charge the losing request', async t => {
  const f = await fixture(t), password = 'town-test-password';
  const env = {ADMIN_USERNAME:'admin',ADMIN_PASSWORD:password,COOKIE_SECURE:'false'}, flags = featureFlags(env);
  const json = (res,status,value) => {res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  const accountApi = await createAccountApi({dataDir:f.dir,json,env,flags,dailyPayload:async()=>({auctions:[]})});
  const economyApi = createEconomyApi({dataDir:f.dir,json,flags,accounts:f.accounts});
  f.accounts.db(db => db.prepare("UPDATE users SET tokens=100000 WHERE username='admin'").run());
  const server = createServer(async(req,res) => {
    const url = new URL(req.url,'http://localhost');
    if (await accountApi(req,res,url) || economyApi(req,res,url)) return;
    json(res,404,{error:'not_found'});
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(async () => {server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));});
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route,data,cookie='',csrf=true) => fetch(`${base}/api/account/${route}`,{method:'POST',headers:{'content-type':'application/json',cookie,...(csrf?{'x-requested-with':'JUSTIZGUESSR'}:{})},body:JSON.stringify(data)});
  assert.equal((await (await fetch(base+'/api/town')).json()).total,25);
  const hidden = createEconomyApi({dataDir:f.dir,json,flags:{...flags,businesses:false},accounts:f.accounts});
  assert.equal(hidden({method:'GET'},null,new URL(base+'/api/town')),false);
  const cookie = (await post('login',{username:'admin',password})).headers.get('set-cookie');
  const payload = {type:'electronics',plotId:'favoriten-2',cost:1,capacity:999};
  assert.equal((await post('businesses/buy',payload)).status,401);
  assert.equal((await post('businesses/buy',payload,cookie,false)).status,403);
  const responses = await Promise.all([post('businesses/buy',payload,cookie),post('businesses/buy',payload,cookie)]);
  assert.deepEqual(responses.map(res=>res.status).sort(),[200,409]);
  const results = await Promise.all(responses.map(res=>res.json()));
  const winner = results.find(res=>res.shop);
  assert.equal(winner.cost,4080); assert.equal(winner.shop.capacity,25); assert.equal(winner.shop.size,'tiny');
  assert.equal(winner.user.tokens,95920); assert.equal(results.find(res=>res.error).error,'plot_occupied');
  const publicMap = await (await fetch(base+'/api/town')).json();
  const privateMap = await (await fetch(base+'/api/town',{headers:{cookie}})).json();
  assert.equal(publicMap.plots.find(p=>p.id==='favoriten-2').business.owner,'ad****');
  assert.equal(privateMap.plots.find(p=>p.id==='favoriten-2').business.owner,'admin');
});
