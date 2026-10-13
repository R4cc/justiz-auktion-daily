import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, upsertAuctions } from '../src/database.mjs';
import { loadPaletteCatalog } from '../src/palette-definitions.mjs';
import { createPaletteAuction, bidOnPaletteAuction, getPaletteAuctionRewards, paletteAuctionsByUser } from '../src/palette-auctions.mjs';
import { listItem, placeBid } from '../src/resale.mjs';
import { prepareSealedCase, insertSealedCase } from '../src/sealed-cases.mjs';
import { unopenedAuctionWinnings } from '../src/auction-winnings.mjs';

const now=Date.parse('2026-10-13T12:00:00Z'),hour=3_600_000,flags={resales:true,paletteAuctions:true,palettes:true};
async function fixture(t) {
  const dir=await mkdtemp('/tmp/jg-auction-winnings-');
  t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  const themes=[['Elektronik','Laptop Lenovo',40],['Werkzeuge','Bohrhammer Makita',20],['Getränke','Riesling Wein',8],['Fahrzeuge','BMW PKW',500],['Schmuck & Uhren','Gold Armbanduhr',90],['Sammlerstücke','Lego Modell',15]];
  upsertAuctions(dir,themes.flatMap(([category,title,price],n)=>Array.from({length:12},(_,i)=>({id:1000+n*100+i,title:`${title} ${n} ${1000+n*100+i}`,category,currentBid:price*(i+1),image:'/assets/tv.jpg'}))));
  const accounts=new Accounts(dir,{now:()=>now+2*hour,flags});
  const winner={id:'winner'},seller={id:'seller'},other={id:'other'};
  accounts.db(db=>{for(const user of [winner,seller,other])db.prepare("INSERT INTO users(id,username,password_hash,tokens,xp,created_at) VALUES(?,?,'disabled',10000000,40000,?)").run(user.id,user.id,now);});
  const prepared=prepareSealedCase(null,'common',{now,fallback:[{id:1,title:'SECRET CASE FIND',price:20,rarity:'common'}]});
  const box=accounts.db(db=>insertSealedCase(db,seller.id,prepared,now));
  const resale=listItem(dir,seller,{inventoryId:box.id,startPrice:100,endsAt:new Date(now+hour).toISOString()},{now});
  placeBid(dir,winner,resale.id,100,{now});
  const edition=loadPaletteCatalog(dir,{now}).palettes.find(entry=>entry.id==='fundkiste');assert.ok(edition.available,JSON.stringify(edition));
  const palette=createPaletteAuction(dir,{editionId:edition.editionId,requestId:'winnings-primary-auction-01'},{now,random:()=>0});
  bidOnPaletteAuction(dir,winner,palette.id,palette.reserve,{now});
  const queue=(user=winner,at=now+hour+1,featureFlags=flags)=>unopenedAuctionWinnings(dir,user,{now:at,flags:featureFlags});
  return {dir,accounts,winner,seller,other,box,resale,palette,queue};
}

test('expired wins settle into a private unopened queue without revealing box contents',async t=>{
  const f=await fixture(t);assert.deepEqual(f.queue(f.winner,now),[]);
  const rewards=f.queue();assert.equal(rewards.length,2);
  const box=rewards.find(entry=>entry.kind==='case'),palette=rewards.find(entry=>entry.kind==='palette');
  assert.equal(box.id,f.box.id);assert.equal(box.auctionId,f.resale.id);
  assert.equal(box.href,`/inventory?focus=${encodeURIComponent(f.box.id)}&action=open`);
  assert.equal(palette.id,f.palette.id);assert.equal(palette.href,`/auction-house?reveal=${encodeURIComponent(f.palette.id)}`);
  assert.doesNotMatch(JSON.stringify(rewards),/SECRET CASE FIND|rewardCount|inventoryIds|item_json|weights|\.jpg/);
  assert.deepEqual(f.queue(f.other),[]);
  assert.equal(f.accounts.db(db=>db.prepare('SELECT opened_at FROM sealed_cases WHERE inventory_id=?').get(f.box.id).opened_at),null);
  assert.equal(f.accounts.db(db=>db.prepare('SELECT revealed_at FROM primary_palette_auctions WHERE id=?').get(f.palette.id).revealed_at),null);
});

test('opened boxes and revealed palettes disappear immediately; ordinary inventory never joins the queue',async t=>{
  const f=await fixture(t);f.queue();
  f.accounts.openSealedCase(f.winner,f.box.id);
  assert.equal(f.queue().some(entry=>entry.kind==='case'),false);
  getPaletteAuctionRewards(f.dir,f.winner,f.palette.id,{now:now+hour+1});
  assert.deepEqual(f.queue(),[]);
  f.accounts.db(db=>db.prepare("INSERT INTO inventory(id,user_id,item,created_at) VALUES('regular','winner',?,?)").run(JSON.stringify({kind:'review-pack',title:'Ordinary review voucher',price:300}),now));
  assert.deepEqual(f.queue(),[]);
});

test('listed or transferred boxes are not promoted; the new auction winner receives their own opening link',async t=>{
  const f=await fixture(t);f.queue();
  const resale=listItem(f.dir,f.winner,{inventoryId:f.box.id,startPrice:200,endsAt:new Date(now+2*hour).toISOString()},{now:now+hour+1});
  assert.equal(f.queue().some(entry=>entry.kind==='case'),false);
  placeBid(f.dir,f.other,resale.id,200,{now:now+hour+2});
  assert.equal(f.queue(f.other,now+2*hour+1).find(entry=>entry.kind==='case').auctionId,resale.id);
  assert.equal(f.queue(f.winner,now+2*hour+1).some(entry=>entry.kind==='case'),false);
});

test('unopened discovery reaches older wins beyond the hundred-row bid history',async t=>{
  const f=await fixture(t);f.queue();
  f.accounts.db(db=>{
    const clone=db.prepare(`INSERT INTO primary_palette_auctions(id,creation_request_id,edition_id,reserve,current_bid,current_bidder_id,status,started_at,ends_at,settled_at,winner_id,valuation_at,required_level,public_snapshot_json)
      SELECT ?,?,edition_id,reserve,reserve,'other','ended',started_at,?,?,'other',valuation_at,required_level,public_snapshot_json FROM primary_palette_auctions WHERE id=?`);
    const bid=db.prepare('INSERT INTO primary_palette_bids(auction_id,bidder_id,amount,created_at) VALUES(?,?,?,?)');
    for(let i=0;i<105;i++){
      clone.run('newer-'+i,'newer-request-'+i,now+hour+100+i,now+hour+101+i,f.palette.id);
      bid.run('newer-'+i,f.winner.id,100,now);
    }
  });
  const history=paletteAuctionsByUser(f.dir,f.winner,{now:now+2*hour,limit:100});
  assert.equal(history.length,100);assert.equal(history.some(row=>row.id===f.palette.id),false);
  assert.equal(f.queue(f.winner,now+2*hour).some(reward=>reward.id===f.palette.id),true);
});

test('legacy sealed palettes stay discoverable, and seized rewards never get an Open Now action',async t=>{
  const f=await fixture(t);f.queue();
  f.accounts.db(db=>{
    db.prepare('INSERT INTO stock_palette_purchases VALUES(?,?,?,?,?,?,?,?,NULL,NULL)').run('old-pack',f.winner.id,'legacy-request','legacy-offer',100,
      JSON.stringify({name:'Legacy stock',nameDe:'Bisheriger Vorrat',category:'wine',quantity:6,items:['SECRET LEGACY POOL']}),JSON.stringify(['SECRET LEGACY FINDS']),now);
  });
  assert.equal(f.queue().some(reward=>reward.id==='old-pack'),true);
  assert.doesNotMatch(JSON.stringify(f.queue()),/SECRET LEGACY/);
  f.accounts.db(db=>{
    db.prepare('UPDATE stock_palette_purchases SET seized_at=? WHERE id=?').run(now+hour,'old-pack');
    db.prepare('INSERT INTO primary_palette_mystery_stock(auction_id,offer,seized_at) VALUES(?,?,?)').run(f.palette.id,'{}',now+hour);
  });
  assert.equal(f.queue().some(reward=>reward.id==='old-pack'||reward.id===f.palette.id),false);
});

test('discovery obeys feature flags and fresh account restrictions',async t=>{
  const f=await fixture(t);f.queue();
  assert.deepEqual(f.queue(f.winner,now+hour+1,{}),[]);
  for(const column of ['npc','banned','must_change_password']){
    f.accounts.db(db=>db.prepare(`UPDATE users SET ${column}=1 WHERE id=?`).run(f.winner.id));
    assert.throws(()=>f.queue(),column==='must_change_password'?/password_change_required/:/login_required/);
    f.accounts.db(db=>db.prepare(`UPDATE users SET ${column}=0 WHERE id=?`).run(f.winner.id));
  }
});
