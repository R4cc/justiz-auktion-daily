import { skillEffects, luckWeights } from './skill-effects.mjs';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readArchiveRows, transaction, withDatabase } from './database.mjs';
import { businessTypeForItem } from './stock-compatibility.mjs';
import { auctionGallery } from './auction-images.mjs';
import { auctionSelectionCategory, buildAuctionFamilies } from './auction-selection.mjs';
import { buildEditionItems, drawItem, matchesTheme, RARITIES, rotationDate } from './cases.mjs';
import { estimatedValueTokens, marketCategoryForItem, marketIndexes } from './market.mjs';
import { ECONOMY_BALANCE, expectedItemValue } from './economy-balance.mjs';
import { acquireItems } from './trader.mjs';
import { AccountError } from './errors.mjs';
import { justiceStatus, collectFine } from './justice.mjs';

// Each palette contains exactly the advertised number of physical units.
// The quantity split and three independent item draws are frozen at purchase.
export const STOCK_PALETTE_TIERS = [
  { id: 'budget', name: 'Starter', nameDe: 'Starter', quantity: 6, weights: [8500,1200,250,49,1] },
  { id: 'standard', name: 'Warehouse', nameDe: 'Lager', quantity: 24, weights: [6500,2500,750,240,10] },
  { id: 'premium', name: 'Jackpot', nameDe: 'Jackpot', quantity: 72, weights: [2000,4500,2500,900,100] }
];
const categories = [
  ['wine','Wine','Wein','wine'], ['electronics','Electronics','Elektronik','electronics'],
  ['cars','Cars','Autos','cars'], ['toys','Toys','Spielzeug','collectibles'],
  ['tools','Tools','Werkzeuge','tools'], ['jewellery','Jewellery & watches','Schmuck & Uhren','jewellery']
];
const starter = JSON.parse(readFileSync(new URL('../seed/auctions.json', import.meta.url), 'utf8')).auctions;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code, status=409) => { throw new AccountError(code,status); };
export function ensureStockPaletteSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS stock_palette_editions (
    date TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload))
  ) STRICT;
  CREATE TABLE IF NOT EXISTS stock_palette_purchases (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
    offer_id TEXT NOT NULL, cost INTEGER NOT NULL CHECK(cost>0),
    offer TEXT NOT NULL CHECK(json_valid(offer)), rewards TEXT NOT NULL CHECK(json_valid(rewards)),
    created_at INTEGER NOT NULL, revealed_at INTEGER, seized_at INTEGER, UNIQUE(user_id,request_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS stock_palette_owner ON stock_palette_purchases(user_id,created_at)`);
}
function pools(db, now) {
  ensureStockPaletteSchema(db);
  const date=rotationDate(now), stored=db.prepare('SELECT payload FROM stock_palette_editions WHERE date=?').get(date);
  if(stored) return JSON.parse(stored.payload);
  const archived=readArchiveRows(db).auctions;
  const sources=[...archived, ...starter.filter(item=>!archived.some(archive=>archive.id===item.id))]
    .filter(item=>item.title && auctionGallery(item).length && Number.isFinite(item.finalPrice??item.currentBid) && (item.finalPrice??item.currentBid)>0 && (item.finalPrice??item.currentBid)<=Number.MAX_SAFE_INTEGER/1000);
  const families=buildAuctionFamilies(sources);
  const result=categories.map(([id,name,nameDe,theme])=>{
    const eligible=item=>matchesTheme(item,theme) && (id!=='toys' || businessTypeForItem(item)==='toys');
    let categoryFamilies=families.filter(family=>family.some(eligible));
    if(!categoryFamilies.length)categoryFamilies=buildAuctionFamilies(starter.filter(eligible));
    let items=buildEditionItems({id,category:theme},categoryFamilies,Math.floor(now/86400000),eligible,50);
    // Thin categories still offer genuine archived stock. Only populated tiers
    // receive probability; we never invent five different versions of one find.
    if(!items.length) items=categoryFamilies.map(family=>family.find(eligible)).filter(Boolean)
      .sort((a,b)=>(a.finalPrice??a.currentBid)-(b.finalPrice??b.currentBid))
      .slice(0,50).map((item,index)=>({auctionId:item.id,title:item.title,image:auctionGallery(item)[0],
        category:auctionSelectionCategory(item),price:item.finalPrice??item.currentBid,
        rarity:RARITIES[Math.min(index,4)].id}));
    return {id,name,nameDe,items:items.map(item=>({...item,marketCategory:marketCategoryForItem(item),...(['wine','electronics','cars','toys'].includes(id)?{businessCategory:id}:{})}))};
  });
  db.prepare('INSERT INTO stock_palette_editions VALUES (?,?)').run(date,JSON.stringify(result));
  db.prepare('DELETE FROM stock_palette_editions WHERE date<?').run(rotationDate(now-30*86400000));
  return result;
}
export function quantitySplits(quantity) {
  const unit=quantity/6;
  return [{quantities:[unit,unit,4*unit],weight:40},{quantities:[unit,2*unit,3*unit],weight:45},{quantities:[2*unit,2*unit,2*unit],weight:15}];
}
function quote(db,now,userId=null) {
  const luckPercent=skillEffects(db,userId).luckPercent;
  const indexes=marketIndexes(db,now), categoryPools=pools(db,now), date=rotationDate(now);
  const offers=categoryPools.flatMap(category=>{
    if(!category.items.length) return [];
    let previous=0;
    return STOCK_PALETTE_TIERS.map(tier=>{
      const baseWeights=tier.weights.map((weight,index)=>category.items.some(item=>item.rarity===RARITIES[index].id)?weight:0);
      // Exchangeable random permutations mean each roll gets quantity/3 on
      // average, independently of the item's tier. EV includes every unit.
      const expectedBase=expectedItemValue(category.items,baseWeights)*tier.quantity;
      const expectedMarket=expectedItemValue(category.items,baseWeights,item=>estimatedValueTokens(item,indexes))*tier.quantity;
      const cost=Math.max(previous+1,Math.ceil(Math.max(expectedBase,expectedMarket)/ECONOMY_BALANCE.paidCaseReturn));
      if(!Number.isSafeInteger(cost)) return null;
      previous=cost;
      const weights=luckWeights(baseWeights,luckPercent);
      const total=weights.reduce((sum,value)=>sum+value,0), splits=quantitySplits(tier.quantity), chances=new Map();
      for(const split of splits)for(const qty of split.quantities)chances.set(qty,(chances.get(qty)||0)+split.weight/3);
      return {id:category.id+'-'+tier.id,category:category.id,name:category.name,nameDe:category.nameDe,tier:tier.id,
        tierName:tier.name,tierNameDe:tier.nameDe,quantity:tier.quantity,rolls:3,cost,expectedMarket:expectedItemValue(category.items,weights,item=>estimatedValueTokens(item,indexes))*tier.quantity,luckPercent,
        items:category.items,weights,quantitySplits:splits,
        dropChances:RARITIES.map((rarity,index)=>({rarity:rarity.id,percent:weights[index]/total*100})),
        multiplierChances:[...chances].sort((a,b)=>a[0]-b[0]).map(([quantity,percent])=>({quantity,percent}))};
    }).filter(Boolean);
  });
  return {revision:hash({date,offers}),rotationDate:date,rotatesAt:new Date(Date.parse(date)+86400000).toISOString(),
    categories:categoryPools.map(({items,...category})=>({...category,available:items.length>0})),offers};
}
export function stockPaletteCatalog(dataDir,{now=Date.now(),userId=null}={}) {
  return withDatabase(dataDir,db=>transaction(db,()=>quote(db,now,userId)));
}
function player(db,user,now) {
  const row=db.prepare('SELECT * FROM users WHERE id=? AND npc=0 AND banned=0').get(user?.id);
  if(!row)fail('login_required',401);
  if(row.must_change_password)fail('password_change_required',403);
  collectFine(db,row.id,now);
  const justice=justiceStatus(db,row.id,now);
  if(justice.jailed){const error=new AccountError('player_jailed',423);error.justice=justice;throw error;}
  return row;
}
function receipt(row) {
  // Purchase lists and retries never disclose the frozen winners before reveal.
  const {items,weights,quantitySplits,...offer}=JSON.parse(row.offer);
  return {id:row.id,offer,cost:row.cost,createdAt:row.created_at,revealedAt:row.revealed_at};
}
export function buyStockPalette(dataDir,user,{offerId,requestId,revision},{now=Date.now(),random=randomInt}={}) {
  if(typeof requestId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(requestId))fail('invalid_request',400);
  return withDatabase(dataDir,db=>transaction(db,()=>{
    ensureStockPaletteSchema(db);player(db,user,now);
    const previous=db.prepare('SELECT * FROM stock_palette_purchases WHERE user_id=? AND request_id=?').get(user.id,requestId);
    if(previous){if(previous.offer_id!==offerId)fail('request_conflict');return receipt(previous);}
    const catalog=quote(db,now,user.id),offer=catalog.offers.find(entry=>entry.id===offerId);
    if(!offer)fail('invalid_palette',400);
    if(catalog.revision!==revision)fail('catalog_changed');
    if(!db.prepare('UPDATE users SET tokens=tokens-? WHERE id=? AND tokens>=?').run(offer.cost,user.id,offer.cost).changes)fail('insufficient_tokens');
    let roll=random(100), split;
    for(const entry of offer.quantitySplits){if(roll<entry.weight){split=[...entry.quantities];break;}roll-=entry.weight;}
    for(let n=split.length-1;n>0;n--){const i=random(n+1);[split[n],split[i]]=[split[i],split[n]];}
    const id=randomUUID(),rewards=split.map(quantity=>({item:{...drawItem(null,offer,random),stockPaletteId:id,createdAt:now},quantity,
      inventoryIds:Array.from({length:quantity},()=>randomUUID())}));
    db.prepare('INSERT INTO stock_palette_purchases VALUES (?,?,?,?,?,?,?,?,NULL,NULL)').run(id,user.id,requestId,offer.id,offer.cost,JSON.stringify(offer),JSON.stringify(rewards),now);
    return receipt(db.prepare('SELECT * FROM stock_palette_purchases WHERE id=?').get(id));
  }));
}
export function stockPalettesByUser(dataDir,user,{now=Date.now()}={}) {
  return withDatabase(dataDir,db=>transaction(db,()=>{
    ensureStockPaletteSchema(db);player(db,user,now);
    return db.prepare('SELECT * FROM stock_palette_purchases WHERE user_id=? AND revealed_at IS NULL AND seized_at IS NULL ORDER BY created_at DESC').all(user.id).map(receipt);
  }));
}
export function revealStockPalette(dataDir,user,id,{now=Date.now()}={}) {
  return withDatabase(dataDir,db=>transaction(db,()=>{
    ensureStockPaletteSchema(db);player(db,user,now);
    const row=db.prepare('SELECT * FROM stock_palette_purchases WHERE id=? AND user_id=? AND seized_at IS NULL').get(String(id),user.id);
    if(!row)fail('palette_rewards_not_found',404);
    const rewards=JSON.parse(row.rewards);
    if(row.revealed_at===null){
      const insert=db.prepare('INSERT INTO inventory (id,user_id,item,created_at) VALUES (?,?,?,?)');
      for(const reward of rewards)for(const inventoryId of reward.inventoryIds)insert.run(inventoryId,user.id,JSON.stringify({...reward.item,id:inventoryId}),now);
      acquireItems(db,user.id,rewards.flatMap(reward=>reward.inventoryIds),row.cost,'purchase',now);
      db.prepare('UPDATE stock_palette_purchases SET revealed_at=? WHERE id=?').run(now,row.id);
    }
    return {...receipt({...row,revealed_at:row.revealed_at??now}),pool:JSON.parse(row.offer).items,rewards};
  }));
}
