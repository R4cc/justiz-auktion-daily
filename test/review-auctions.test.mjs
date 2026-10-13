import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore } from '../src/database.mjs';
import { buyBusiness, stockBusiness, businessDashboard } from '../src/businesses.mjs';
import { visitStore, listStores, ensureStoreSchema } from '../src/storefronts.mjs';
import { supplyReviewAuctions, reviewAuctionWindows, redeemReviewPack, REVIEW_SUPPLIER_ID, REVIEW_PACK_SIZES, REVIEW_AUCTION_DURATION_MS, REVIEW_PRICE_PER_REVIEW } from '../src/review-auctions.mjs';
import { placeBid, settleAuction, getResale, listItem } from '../src/resale.mjs';
import { storeReputation, reviewTrafficMultiplier } from '../src/store-reputation.mjs';
import { weightedStoreRating } from '../src/skill-effects.mjs';
import { tickNpcBuyers } from '../src/npc-buyers.mjs';
import { townMap } from '../src/town-map.mjs';

const start = Date.parse('2026-10-13T08:00:00Z'), hour = 3_600_000, day = 24 * hour;
async function fixture(t) {
  const dir = await mkdtemp('/tmp/jg-review-auctions-');
  const accounts = new Accounts(dir, { now: () => start, flags: { resales: true } });
  const owner = { id: 'owner', admin: true }, other = { id: 'other' };
  accounts.db(db => {
    for (const user of [owner, other]) db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES(?,?,'disabled',100000,?)").run(user.id,user.id,start);
    db.prepare('UPDATE users SET admin=1 WHERE id=?').run(owner.id);
  });
  const shop = buyBusiness(dir, owner, 'wine', 'popup', { now: start }).shop;
  accounts.db(db => {
    db.prepare("INSERT INTO inventory(id,user_id,item,created_at) VALUES('stock','owner',?,?)").run(JSON.stringify({ title:'Wine',price:100,marketCategory:'wine' }),start);
  });
  stockBusiness(dir,owner,shop.id,['stock'],{now:start});
  t.after(async () => { closeDataStore(dir); await rm(dir,{recursive:true,force:true}); });
  const auction = supplyReviewAuctions(dir,{now:start}).auctions[0];
  const lot = getResale(dir,auction,{now:start});
  const win = (user = owner) => { placeBid(dir,user,auction,lot.startPrice+100,{now:start}); return settleAuction(dir,auction,{now:start+REVIEW_AUCTION_DURATION_MS+1}); };
  return {dir,accounts,owner,other,shop,auction,lot,win};
}

test('NPC supplies one or two fixed 12-hour auctions per UTC day with varied sizes and restart-safe windows', async t => {
  const f = await fixture(t), sizes = new Set();
  for (let d=0;d<14;d++) {
    const dayStart = Math.floor(start/day)*day+d*day;
    const windows = reviewAuctionWindows(dayStart);
    assert.ok([1,2].includes(windows.length));
    for (const window of windows) {
      supplyReviewAuctions(f.dir,{now:window.startsAt+1});
      assert.equal(supplyReviewAuctions(f.dir,{now:window.startsAt+2}).supplied,0);
    }
    const rows = f.accounts.db(db=>db.prepare('SELECT a.*,i.item FROM resale_auctions a JOIN inventory i ON i.id=a.inventory_id WHERE a.seller_id=? AND a.started_at>=? AND a.started_at<?').all(REVIEW_SUPPLIER_ID,dayStart,dayStart+day));
    assert.equal(rows.length,windows.length);
    for (const row of rows) {
      const item=JSON.parse(row.item);sizes.add(item.reviewCount);
      assert.ok(REVIEW_PACK_SIZES.includes(item.reviewCount));
      assert.equal(row.ends_at-row.started_at,REVIEW_AUCTION_DURATION_MS);
      assert.equal(row.start_price,item.reviewCount*REVIEW_PRICE_PER_REVIEW);
    }
  }
  assert.ok(sizes.size>2);
  assert.equal(supplyReviewAuctions(f.dir,{now:start+200*day+7*hour}).supplied<=1,true);
  assert.equal(f.accounts.db(db=>db.prepare('SELECT npc,password_hash FROM users WHERE id=?').get(REVIEW_SUPPLIER_ID)).npc,1);
});

test('normal auction escrow refunds outbids, settles one pack once, and redemption adds only five-star totals', async t => {
  const f=await fixture(t), balance=user=>f.accounts.db(db=>db.prepare('SELECT tokens FROM users WHERE id=?').get(user.id).tokens);
  const initial=balance(f.owner), second=balance(f.other);
  placeBid(f.dir,f.owner,f.auction,f.lot.startPrice,{now:start});
  assert.equal(balance(f.owner),initial-f.lot.startPrice);
  placeBid(f.dir,f.other,f.auction,f.lot.startPrice+f.lot.bidIncrement,{now:start+1});
  assert.equal(balance(f.owner),initial);
  placeBid(f.dir,f.owner,f.auction,f.lot.startPrice+2*f.lot.bidIncrement,{now:start+2});
  assert.equal(balance(f.other),second);
  const at=start+REVIEW_AUCTION_DURATION_MS+1;
  settleAuction(f.dir,f.auction,{now:at});settleAuction(f.dir,f.auction,{now:at});
  const pack=f.accounts.inventory(f.owner).find(item=>item.kind==='review-pack');
  assert.equal(pack.id,f.lot.inventoryId);assert.equal(pack.reviewCount,f.lot.item.reviewCount);
  assert.equal(f.accounts.inventory(f.owner).filter(item=>item.kind==='review-pack').length,1);
  const before=visitStore(f.dir,f.owner,f.shop.id,{now:at}).store;
  const receipt=redeemReviewPack(f.dir,f.owner,{inventoryId:pack.id,shopId:f.shop.id,reviewCount:10000},{now:at});
  assert.equal(receipt.reviewCount,pack.reviewCount);
  assert.deepEqual(redeemReviewPack(f.dir,f.owner,{inventoryId:pack.id,shopId:f.shop.id},{now:at+1}),receipt);
  const after=visitStore(f.dir,null,f.shop.id,{now:at+1}).store;
  assert.equal(after.reviewCount,before.reviewCount+pack.reviewCount);
  assert.equal(after.reviewDistribution[4].count,before.reviewDistribution[4].count+pack.reviewCount);
  assert.equal(after.reviews.length,before.reviews.length);
  assert.equal(f.accounts.inventory(f.owner).some(item=>item.id===pack.id),false);
  assert.equal(f.accounts.db(db=>db.prepare('SELECT COUNT(*) AS n FROM account_notifications WHERE source_key=?').get(`review-pack:${pack.id}`).n),1);
  closeDataStore(f.dir);
  assert.deepEqual(redeemReviewPack(f.dir,f.owner,{inventoryId:pack.id,shopId:f.shop.id},{now:at+2}),receipt);
});

test('redemption requires current pack ownership and an owned store, rejects forged packs and locked listings', async t => {
  const f=await fixture(t);f.win();
  const payload={inventoryId:f.lot.inventoryId,shopId:f.shop.id};
  assert.throws(()=>redeemReviewPack(f.dir,f.other,payload,{now:start+13*hour}),/review_pack_not_found/);
  const rival=buyBusiness(f.dir,f.other,'wine','popup',{now:start+13*hour}).shop;
  assert.throws(()=>redeemReviewPack(f.dir,f.owner,{...payload,shopId:rival.id},{now:start+13*hour}),/business_not_found/);
  f.accounts.db(db=>db.prepare("INSERT INTO inventory(id,user_id,item,created_at) VALUES('forged','owner',?,?)").run(JSON.stringify({kind:'review-pack',reviewCount:999999,price:1}),start));
  assert.throws(()=>redeemReviewPack(f.dir,f.owner,{...payload,inventoryId:'forged'},{now:start+13*hour}),/review_pack_not_found/);
  const listing=listItem(f.dir,f.owner,{inventoryId:payload.inventoryId,startPrice:100,endsAt:new Date(start+15*hour).toISOString()},{now:start+13*hour});
  assert.throws(()=>redeemReviewPack(f.dir,f.owner,payload,{now:start+13*hour}),/item_listed/);
  assert.equal(getResale(f.dir,listing.id,{now:start+13*hour}).item.reviewCount,f.lot.item.reviewCount);
});

test('failed redemption rolls back pack consumption, reputation and the notification', async t => {
  const f=await fixture(t);f.win();
  f.accounts.db(db=>db.exec("CREATE TRIGGER prevent_review_apply BEFORE UPDATE ON store_review_packs BEGIN SELECT RAISE(ABORT,'blocked apply'); END"));
  assert.throws(()=>redeemReviewPack(f.dir,f.owner,{inventoryId:f.lot.inventoryId,shopId:f.shop.id},{now:start+13*hour}),/blocked apply/);
  assert.equal(f.accounts.inventory(f.owner).some(item=>item.id===f.lot.inventoryId),true);
  assert.equal(visitStore(f.dir,f.owner,f.shop.id,{now:start+13*hour}).store.purchasedReviewCount,0);
});

test('paid-review weight is capped, Influence remains stronger, and traffic cannot exceed the existing popularity ceiling', async t => {
  const f=await fixture(t);
  f.accounts.db(db=>{
    ensureStoreSchema(db);
    db.prepare('INSERT INTO store_reviews VALUES(?,?,?,?,?)').run(f.shop.id,f.other.id,1,'Expensive',start);
    const add=db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)');
    for(let i=0;i<100;i++){
      add.run('extra-'+i,f.owner.id,JSON.stringify({kind:'review-pack',price:1800}),start);
      db.prepare('INSERT INTO store_review_packs VALUES(?,?,?,?,?)').run('extra-'+i,30,f.shop.id,f.owner.id,start+hour);
    }
    const multiplier=reviewTrafficMultiplier(db,f.shop.id,start+hour);
    assert.ok(multiplier<=1.034 && multiplier>=1);
    assert.equal(reviewTrafficMultiplier(db,f.shop.id,start),1-2/21*.05);
    const rating=weightedStoreRating(db,f.shop.id);assert.equal(rating.count,3001);
    assert.ok(Math.abs(rating.average-51/11)<1e-10);
    const summary=storeReputation(db,{id:f.shop.id,traffic_popularity:1.5},start+hour);
    assert.equal(summary.purchasedReviewInfluenceCapped,true);assert.equal(summary.popularityPercent,100);assert.equal(summary.reviewDistribution[4].count,3000);
    assert.equal(summary.reviewDistribution[0].count,1);
    assert.equal(storeReputation(db,{id:f.shop.id,traffic_popularity:0},start+hour).popularityPercent,0);
  });
});

test('purchased feedback appears consistently on public stores, owned stores and the town map; bans hide organic reviews', async t => {
  const f=await fixture(t);f.win();
  redeemReviewPack(f.dir,f.owner,{inventoryId:f.lot.inventoryId,shopId:f.shop.id},{now:start+13*hour});
  const a=listStores(f.dir,null,{now:start+13*hour}).stores[0];
  const b=businessDashboard(f.dir,f.owner,{now:start+13*hour}).shops[0];
  const c=townMap(f.dir,null,{now:start+13*hour}).plots.find(plot=>plot.business?.id===f.shop.id).business;
  assert.equal(a.popularityPercent,b.popularityPercent);assert.equal(b.popularityPercent,c.popularityPercent);
  assert.equal(a.purchasedReviewCount,f.lot.item.reviewCount);
  f.accounts.db(db=>{
    db.prepare('INSERT INTO store_reviews VALUES(?,?,?,?,?)').run(f.shop.id,f.other.id,1,'Poor',start);
    db.prepare('UPDATE users SET banned=1 WHERE id=?').run(f.other.id);
  });
  assert.equal(visitStore(f.dir,null,f.shop.id,{now:start+13*hour}).store.reviewDistribution[0].count,0);
});

test('NPC buyers cannot bid on review packs and economy reset removes redemption rows before stores/inventory', async t => {
  const f=await fixture(t);tickNpcBuyers(f.dir,{now:start});
  const npc=f.accounts.db(db=>db.prepare('SELECT id FROM users WHERE npc=1 AND id!=? LIMIT 1').get(REVIEW_SUPPLIER_ID));
  assert.ok(npc);assert.throws(()=>placeBid(f.dir,npc,f.auction,5000,{now:start}),/npc_case_bid_forbidden/);
  assert.equal(getResale(f.dir,f.auction,{now:start}).bidCount,0);
  f.win();redeemReviewPack(f.dir,f.owner,{inventoryId:f.lot.inventoryId,shopId:f.shop.id},{now:start+13*hour});
  f.accounts.resetEconomy(f.owner,'RESET ECONOMY');
  assert.equal(f.accounts.db(db=>db.prepare('SELECT COUNT(*) AS n FROM store_review_packs').get().n),0);
  assert.equal(f.accounts.inventory(f.owner).length,0);
});

test('fresh account bans, forced passwords and NPC identities prevent redemption without consuming a pack', async t => {
  const f=await fixture(t);f.win();
  const payload={inventoryId:f.lot.inventoryId,shopId:f.shop.id};
  for(const column of ['banned','must_change_password','npc']) {
    f.accounts.db(db=>db.prepare(`UPDATE users SET ${column}=1 WHERE id=?`).run(f.owner.id));
    assert.throws(()=>redeemReviewPack(f.dir,f.owner,payload,{now:start+13*hour}),/login_required/);
    f.accounts.db(db=>db.prepare(`UPDATE users SET ${column}=0 WHERE id=?`).run(f.owner.id));
    assert.ok(f.accounts.inventory(f.owner).some(item=>item.id===payload.inventoryId));
  }
});

test('review packs cannot be cashed out or stocked as merchandise; their rating effect starts at redemption', async t => {
  const f=await fixture(t);f.win();
  const service=new Accounts(f.dir,{flags:{resales:false},now:()=>start+13*hour});
  assert.throws(()=>service.sell(f.owner,f.lot.inventoryId),/review_pack_redeem_only/);
  assert.throws(()=>service.sellAll(f.owner,f.lot.inventoryId),/review_pack_redeem_only/);
  assert.throws(()=>stockBusiness(f.dir,f.owner,f.shop.id,[f.lot.inventoryId],{now:start+13*hour}),/wrong_shop_type/);
  const at=start+14*hour;
  visitStore(f.dir,f.owner,f.shop.id,{now:at});
  const before=f.accounts.db(db=>reviewTrafficMultiplier(db,f.shop.id,at-1));
  redeemReviewPack(f.dir,f.owner,{inventoryId:f.lot.inventoryId,shopId:f.shop.id},{now:at});
  assert.equal(f.accounts.db(db=>reviewTrafficMultiplier(db,f.shop.id,at-1)),before);
  assert.ok(f.accounts.db(db=>reviewTrafficMultiplier(db,f.shop.id,at))>before);
});
