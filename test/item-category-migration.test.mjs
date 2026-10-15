import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { migrateSavedItemCategories, reconcileCategorizedStock, CATEGORY_CLASSIFICATION_VERSION } from '../src/item-category-migration.mjs';
import { transaction, setState, closeDataStore, readArchive, upsertAuctions, DATABASE_FILENAME } from '../src/database.mjs';
import { Accounts } from '../src/accounts.mjs';
import { businessTypeForItem } from '../src/stock-compatibility.mjs';

const glasses={id:211623,title:'Herrensonnenbrille Tom Ford -Thor u.a.',description:'Sonnenbrille mit Etui',category:'Fahrzeuge',currentBid:25,finalPrice:40};
const drill={auctionId:213009,title:'Fujitsu Lifebook E756',category:'Bücher & Medien',marketCategory:'books_media',price:79,rarity:'rare'};
const strip=value=>{
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!['category','sourceCategory','marketCategory','businessCategory','categoryVersion'].includes(key)).map(([key,item])=>[key,Array.isArray(item)?item.map(strip):strip(item)]));
};
function fixture(t) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE auctions(id INTEGER PRIMARY KEY, category TEXT, payload_json TEXT);
    CREATE TABLE inventory(id TEXT PRIMARY KEY,user_id TEXT,item TEXT,sold_at INTEGER);
    CREATE TABLE businesses(id TEXT PRIMARY KEY,user_id TEXT,type TEXT,cash_balance INTEGER);
    CREATE TABLE business_stock(inventory_id TEXT PRIMARY KEY,business_id TEXT,sold_at INTEGER);
    CREATE TABLE store_heists(inventory_id TEXT,status TEXT);
    CREATE TABLE resale_auctions(id TEXT PRIMARY KEY,status TEXT,winner_id TEXT,settled_at INTEGER);
    CREATE TABLE resale_auction_items(auction_id TEXT,inventory_id TEXT);
    CREATE TABLE app_state(key TEXT PRIMARY KEY,value_json TEXT,updated_at TEXT);`);
  db.prepare('INSERT INTO auctions VALUES(?,?,?)').run(glasses.id,glasses.category,JSON.stringify(glasses));
  return db;
}
const put=(db,table,field,value)=>{
  db.exec(`CREATE TABLE ${table}(id INTEGER PRIMARY KEY,${field} TEXT)`);
  db.prepare(`INSERT INTO ${table}(${field}) VALUES(?)`).run(JSON.stringify(value));
};
const json=(db,table,field)=>JSON.parse(db.prepare(`SELECT ${field} AS value FROM ${table}`).get().value);
const owned=(db,id,item,sold=null,owner='owner')=>db.prepare('INSERT INTO inventory VALUES(?,?,?,?)').run(id,owner,JSON.stringify(item),sold);
const shelf=(db,id,shop='wrong',sold=null)=>db.prepare('INSERT INTO business_stock VALUES(?,?,?)').run(id,shop,sold);

test('migration repairs frozen metadata and nested rewards without changing financial or draw data',t=>{
  const db=fixture(t);
  const toy={auctionId:555,title:'Lot 17',price:30,marketCategory:'other'};
  db.prepare('INSERT INTO auctions VALUES(?,?,?)').run(555,'Sonstiges',JSON.stringify({id:555,title:'Lot 17',description:'Enthalten sind Puppen und Puzzles.',category:'Sonstiges'}));
  owned(db,'glasses',{...glasses,id:'owned-glasses',auctionId:glasses.id,marketCategory:'vehicles',businessCategory:'cars',price:40});
  owned(db,'toy',toy);
  const nested={revision:'paid-v4',cost:900,quantity:12,items:[{item:drill,quantity:4}],rewards:[{item:toy,quantity:8}],draws:[{rarity:'rare',roll:.9}],answers:[{score:1000,actualBid:79}]};
  for(const [table,field] of [['account_games','payload'],['case_rotations','payload'],['stock_palette_editions','payload'],['primary_palette_stock_draws','rewards'],['store_receipts','result']])put(db,table,field,nested);
  const container={kind:'case',title:'Gold case',category:'special',marketCategory:null,price:1000,reward:drill};
  put(db,'case_purchases','item',container);
  put(db,'sealed_cases','reward',drill);
  const before=db.prepare('SELECT * FROM inventory').all();
  const report=transaction(db,()=>migrateSavedItemCategories(db));
  assert.ok(report.rows>=10);
  assert.equal(JSON.parse(db.prepare('SELECT payload_json FROM auctions WHERE id=?').get(glasses.id).payload_json).category,'Mode');
  assert.equal(JSON.parse(db.prepare('SELECT payload_json FROM auctions WHERE id=?').get(glasses.id).payload_json).sourceCategory,'Fahrzeuge');
  assert.equal(db.prepare('SELECT category FROM auctions WHERE id=?').get(glasses.id).category,'Mode');
  for(const row of db.prepare('SELECT * FROM inventory').all()) {
    const original=before.find(item=>item.id===row.id);
    assert.deepEqual(strip(JSON.parse(row.item)),strip(JSON.parse(original.item)));
    assert.equal(row.user_id,original.user_id);assert.equal(row.sold_at,original.sold_at);
  }
  const updatedToy=JSON.parse(db.prepare("SELECT item FROM inventory WHERE id='toy'").get().item);
  assert.equal(updatedToy.marketCategory,'collectibles');
  assert.equal(updatedToy.businessCategory,'toys');
  assert.equal(businessTypeForItem(updatedToy),'toys','description recovered from original archive survives stripped reward payloads');
  for(const [table,field] of [['account_games','payload'],['case_rotations','payload'],['stock_palette_editions','payload'],['primary_palette_stock_draws','rewards'],['store_receipts','result']]) {
    const saved=json(db,table,field);assert.deepEqual(strip(saved),strip(nested));
    assert.equal(saved.items[0].item.marketCategory,'electronics');
    assert.equal(saved.rewards[0].item.businessCategory,'toys');
  }
  const savedCase=json(db,'case_purchases','item');
  assert.equal(savedCase.category,'special');assert.equal(savedCase.marketCategory,null);assert.equal(savedCase.price,1000);
  assert.equal(savedCase.reward.marketCategory,'electronics');
  assert.deepEqual(strip(savedCase),strip(container));
  assert.equal(json(db,'sealed_cases','reward').price,79);
  assert.equal(migrateSavedItemCategories(db).rows,0,'repeat migration is idempotent');
  db.prepare("UPDATE auctions SET category='broken' WHERE id=?").run(glasses.id);
  assert.equal(migrateSavedItemCategories(db).rows,1,'repair indexed SQL category even when JSON is current');
});

test('dry-run predicts identical updates and shelf cleanup without writing',t=>{
  const db=fixture(t);
  db.exec("INSERT INTO businesses VALUES('wrong','owner','cars',444)");
  owned(db,'misfiled',{...glasses,price:40,marketCategory:'vehicles'});shelf(db,'misfiled');
  const before=db.prepare('SELECT * FROM inventory').all();
  const preview=migrateSavedItemCategories(db,{dryRun:true});
  assert.deepEqual(db.prepare('SELECT * FROM inventory').all(),before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM business_stock').get().n,1);
  const applied=transaction(db,()=>migrateSavedItemCategories(db));
  assert.deepEqual(applied,preview);
  assert.equal(applied.returnedToInventory,1);
  assert.equal(db.prepare('SELECT cash_balance FROM businesses').get().cash_balance,444);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory').get().n,1);
});

test('incompatible shelves return unsold owned items, defer live locks, and leave sale history intact',t=>{
  const db=fixture(t);
  db.exec("INSERT INTO businesses VALUES('wrong','owner','cars',444); INSERT INTO businesses VALUES('right','owner','electronics',555)");
  for(const id of ['free','heist','police','active','pending','settled','ended','sold','foreign']) {
    owned(db,id,{...glasses,price:40},id==='sold'?123:null,id==='foreign'?'buyer':'owner');shelf(db,id,'wrong',id==='sold'?123:null);
  }
  owned(db,'compatible',drill);shelf(db,'compatible','right');
  db.exec(`INSERT INTO store_heists VALUES('heist','active'),('police','police');
    INSERT INTO resale_auctions VALUES('active','active',NULL,NULL),('pending','ended','winner',NULL),('settled','ended','winner',123),('ended','ended',NULL,NULL);
    INSERT INTO resale_auction_items VALUES('active','active'),('pending','pending'),('settled','settled'),('ended','ended');`);
  const report=transaction(db,()=>migrateSavedItemCategories(db));
  assert.equal(report.returnedToInventory,3);assert.equal(report.deferredStock,4);
  assert.deepEqual(db.prepare('SELECT inventory_id FROM business_stock ORDER BY inventory_id').all().map(row=>row.inventory_id),['active','compatible','foreign','heist','pending','police','sold']);
  db.exec("UPDATE store_heists SET status='failed'; UPDATE resale_auctions SET status='ended',settled_at=123");
  assert.deepEqual(reconcileCategorizedStock(db),{returned:4,deferred:0});
  assert.deepEqual(reconcileCategorizedStock(db),{returned:0,deferred:0});
  assert.equal(db.prepare('SELECT sold_at FROM business_stock WHERE inventory_id=?').get('sold').sold_at,123);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory').get().n,10);
});

test('category migration and completion marker roll back together on update failure',t=>{
  const db=fixture(t);owned(db,'blocked',drill);
  db.exec("CREATE TRIGGER block_category BEFORE UPDATE ON inventory BEGIN SELECT RAISE(ABORT,'blocked'); END");
  assert.throws(()=>transaction(db,()=>{const report=migrateSavedItemCategories(db);setState(db,CATEGORY_CLASSIFICATION_VERSION,report);}),/blocked/);
  assert.equal(json(db,'auctions','payload_json').category,'Fahrzeuge');
  assert.equal(db.prepare('SELECT category FROM auctions').get().category,'Fahrzeuge');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM app_state').get().n,0);
});

test('startup upgrades an existing player database once and CLI previews and backs up before applying',async t=>{
  const dir=await mkdtemp('/tmp/jg-category-migration-');
  t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  const accounts=new Accounts(dir);upsertAuctions(dir,[glasses]);
  accounts.db(db=>{
    db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES('owner','owner','disabled',12345,1)").run();
    db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run('saved','owner',JSON.stringify({...glasses,auctionId:glasses.id,marketCategory:'vehicles',price:40}),1);
    db.prepare('DELETE FROM app_state WHERE key=?').run(CATEGORY_CLASSIFICATION_VERSION);
  });
  closeDataStore(dir);
  const filename=path.join(dir,DATABASE_FILENAME);
  const cli=(...args)=>JSON.parse(execFileSync(process.execPath,['scripts/migrate-item-categories.mjs',filename,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  const preview=cli();assert.equal(preview.mode,'dry-run');assert.equal(preview.backup,null);
  const raw=new DatabaseSync(filename);
  assert.equal(JSON.parse(raw.prepare('SELECT item FROM inventory').get().item).marketCategory,'vehicles');raw.close();
  const applied=cli('--apply');assert.equal(applied.rows,preview.rows);assert.ok((await readFile(applied.backup)).length>0);
  const backup=new DatabaseSync(applied.backup,{readOnly:true});
  assert.equal(JSON.parse(backup.prepare('SELECT item FROM inventory').get().item).marketCategory,'vehicles');backup.close();
  // Exercise automatic startup separately by resetting only the category marker
  // and stale metadata, exactly as an older deployed database would appear.
  const stale=new DatabaseSync(filename);
  stale.prepare('DELETE FROM app_state WHERE key=?').run(CATEGORY_CLASSIFICATION_VERSION);
  stale.prepare('UPDATE inventory SET item=?').run(JSON.stringify({...glasses,price:40,marketCategory:'vehicles'}));stale.close();
  assert.equal(readArchive(dir).auctions[0].category,'Mode');
  accounts.db(db=>{
    assert.equal(JSON.parse(db.prepare('SELECT item FROM inventory').get().item).marketCategory,'fashion');
    assert.equal(db.prepare("SELECT tokens FROM users WHERE id='owner'").get().tokens,12345);
    assert.ok(db.prepare('SELECT 1 FROM app_state WHERE key=?').get(CATEGORY_CLASSIFICATION_VERSION));
  });
  closeDataStore(dir);readArchive(dir);
  assert.equal(accounts.db(db=>migrateSavedItemCategories(db)).rows,0);
});
