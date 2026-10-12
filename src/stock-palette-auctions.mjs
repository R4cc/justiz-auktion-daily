import { createHash, randomInt, randomUUID } from 'node:crypto';
import { transaction, withDatabase } from './database.mjs';
import { stockPaletteCatalog, stockPaletteQuote, quantitySplits } from './stock-palettes.mjs';
import { ensurePaletteAuctionSchema, serializePublicAuction, PALETTE_AUCTION_DURATION_MS } from './palette-auctions.mjs';
import { drawItem } from './cases.mjs';
import { luckWeights, LUCK_BONUSES } from './skill-effects.mjs';
import { estimatedValueTokens, marketIndexes } from './market.mjs';
import { AccountError } from './errors.mjs';
const fail=(code,status=409)=>{throw new AccountError(code,status);};

// Trusted supply only; clients can acquire these lots solely through bidding.
// Freeze exact draws for each supported luck rank now, then select the winner's
// version once at settlement. Neither bidding nor revealing rerolls anything.
export function createStockPaletteAuction(dataDir,{offerId,requestId,endsAt},{now=Date.now(),random=randomInt,automaticSupply=false}={}) {
  if(typeof requestId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(requestId))fail('invalid_request',400);
  const previous=withDatabase(dataDir,db=>{ensurePaletteAuctionSchema(db,now);const row=db.prepare('SELECT * FROM primary_palette_auctions WHERE creation_request_id=?').get(requestId);
    if(row){if(JSON.parse(row.public_snapshot_json).stockOffer?.id!==offerId)fail('request_conflict');return serializePublicAuction(db,row);}return null;});
  if(previous)return previous;
  return withDatabase(dataDir,db=>transaction(db,()=>{
    ensurePaletteAuctionSchema(db,now);
    const existing=db.prepare('SELECT * FROM primary_palette_auctions WHERE creation_request_id=?').get(requestId);
    if(existing){if(JSON.parse(existing.public_snapshot_json).stockOffer?.id!==offerId)fail('request_conflict');return serializePublicAuction(db,existing);}
    // A second scheduler can have a stale board snapshot. Enforce one live
    // supplied lot per offer under the write lock, even across time buckets.
    if(automaticSupply){
      const live=db.prepare("SELECT * FROM primary_palette_auctions WHERE status='active' AND ends_at>? AND json_extract(public_snapshot_json,'$.stockOffer.id')=? LIMIT 1").get(now,offerId);
      if(live)return serializePublicAuction(db,live);
    }
    const catalog=stockPaletteQuote(db,now),quoted=catalog.offers.find(offer=>offer.id===offerId);
    if(!quoted)fail('invalid_palette',400);
    const end=endsAt===undefined?now+PALETTE_AUCTION_DURATION_MS:endsAt;
    if(!Number.isSafeInteger(end)||end<=now||end>now+PALETTE_AUCTION_DURATION_MS)fail('invalid_auction_end',400);
    const indexes=marketIndexes(db,now),offer={...quoted,items:quoted.items.map(item=>({...item,referenceValue:estimatedValueTokens(item,indexes)}))};
    const editionId=`stock:${offer.id}:${catalog.rotationDate}`;
    // Edition and lot snapshots retain the exact public pool; old primary
    // editions and already-won three-find palettes remain compatible.
    db.prepare(`INSERT OR IGNORE INTO palette_editions(id,palette_id,event_id,rotation_date,starts_at,ends_at,payload_json)
      VALUES (?,?,NULL,?,?,?,?)`).run(editionId,offer.id,catalog.rotationDate,Date.parse(catalog.rotationDate),Date.parse(catalog.rotationDate)+86400000+PALETTE_AUCTION_DURATION_MS,
        JSON.stringify({version:4,pricingVersion:4,paletteId:offer.id,kind:'stock',available:true,items:offer.items,weights:offer.weights,rewardCount:3,quantity:offer.quantity}));
    const id=randomUUID(),snapshot={paletteId:offer.id,name:`${offer.quantity}× ${offer.name} palette`,nameDe:`${offer.quantity}× ${offer.nameDe}-Palette`,
      badge:offer.tierName,kind:'stock',type:offer.category,rewardCount:3,items:offer.items,stockOffer:offer,
      allowedMarketCategories:[...new Set(offer.items.map(item=>item.marketCategory))],story:{en:'Sealed warehouse stock. Win the bid, then reveal the items and their quantities.',de:'Versiegelte Lagerware. Gewinne das Gebot und decke dann die Artikel und ihre Mengen auf.'}};
    db.prepare(`INSERT INTO primary_palette_auctions(id,creation_request_id,edition_id,reserve,status,started_at,ends_at,valuation_at,required_level,public_snapshot_json)
      VALUES (?,?,?,?,'active',?,?,?,1,?)`).run(id,requestId,editionId,offer.cost,now,end,now,JSON.stringify(snapshot));
    let roll=random(100),split;
    for(const candidate of quantitySplits(offer.quantity)){if(roll<candidate.weight){split=[...candidate.quantities];break;}roll-=candidate.weight;}
    for(let n=2;n>0;n--){const index=random(n+1);[split[n],split[index]]=[split[index],split[n]];}
    const draws=split.map((quantity,position)=>{
      for(let n=0;n<quantity;n++)db.prepare('INSERT INTO primary_palette_stock_units VALUES (?,?,?)').run(id,position,randomUUID());
      const byLuck=Object.fromEntries(LUCK_BONUSES.map(bonus=>[bonus,drawItem(null,{...offer,weights:luckWeights(offer.weights,bonus)},random)]));
      return {quantity,byLuck};
    });
    db.prepare('INSERT INTO primary_palette_stock_draws VALUES (?,?,NULL)').run(id,JSON.stringify(draws));
    return serializePublicAuction(db,db.prepare('SELECT * FROM primary_palette_auctions WHERE id=?').get(id));
  }));
}

// One live lot per available category/size keeps both affordable and premium
// stock on the normal board. Cold-start deadlines are staggered; replacement
// lots run a full hour, and frozen auctions can cross the daily pool rotation.
export function supplyStockPaletteAuctions(dataDir,{now=Date.now()}={}) {
  const catalog=stockPaletteCatalog(dataDir,{now}),offers=catalog.offers;
  const live=withDatabase(dataDir,db=>{ensurePaletteAuctionSchema(db,now);return db.prepare("SELECT id,ends_at,public_snapshot_json FROM primary_palette_auctions WHERE status='active' AND ends_at>?").all(now);});
  const active=new Set(live.map(row=>JSON.parse(row.public_snapshot_json).stockOffer?.id).filter(Boolean)),auctions=[];
  const period=PALETTE_AUCTION_DURATION_MS/Math.max(1,offers.length),bucket=Math.floor(now/PALETTE_AUCTION_DURATION_MS);
  for(const [index,offer] of offers.entries()){
    if(active.has(offer.id))continue;
    const latest=withDatabase(dataDir,db=>db.prepare("SELECT id FROM primary_palette_auctions WHERE json_extract(public_snapshot_json,'$.stockOffer.id')=? ORDER BY started_at DESC,id DESC LIMIT 1").get(offer.id));
    const requestId=createHash('sha256').update(`stock-palette:${offer.id}:${bucket}:${latest?.id||'initial'}`).digest('hex');
    const end=live.length||latest?now+PALETTE_AUCTION_DURATION_MS:now+Math.max(60_000,Math.round((index+1)*period));
    const lot=createStockPaletteAuction(dataDir,{offerId:offer.id,requestId,endsAt:end},{now,automaticSupply:true});
    if(lot.status==='active'&&lot.endsAt>now)auctions.push(lot.id);
  }
  return {auctions,skipped:[]};
}
