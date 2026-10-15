import { createHash, randomUUID } from 'node:crypto';
import { transaction, withDatabase } from './database.mjs';
import { stockPaletteQuote } from './stock-palettes.mjs';
import { ensurePaletteAuctionSchema, serializePublicAuction, PALETTE_AUCTION_DURATION_MS } from './palette-auctions.mjs';
import { mysteryStockOffer, publicMysteryOffer, MYSTERY_STOCK_MODE } from './mystery-stock.mjs';
import { marketIndexes } from './market.mjs';
import { skillEffects } from './skill-effects.mjs';
import { AccountError } from './errors.mjs';
const fail=(code,status=409)=>{throw new AccountError(code,status);};

// Trusted supply only; clients can acquire these lots solely through bidding.
// Freeze the price-based odds and private source pool now. Draw actual items
// and independent amounts only at the winner's first opening.
function catalog(db,now){
  const quoted=stockPaletteQuote(db,now),indexes=marketIndexes(db,now);
  return {...quoted,offers:quoted.offers.map(offer=>mysteryStockOffer(offer,indexes))};
}
export function stockPaletteAuctionCatalog(dataDir,{now=Date.now(),userId=null}={}){
  return withDatabase(dataDir,db=>transaction(db,()=>{const result=catalog(db,now);return {...result,revision:'opening-v2:'+createHash('sha256').update(JSON.stringify([result.revision,result.offers.map(offer=>[offer.id,offer.cost,offer.quantityOdds])])).digest('hex'),offers:result.offers.map(offer=>publicMysteryOffer(offer,skillEffects(db,userId).luckPercent))};}));
}

export function createStockPaletteAuction(dataDir,{offerId,requestId,endsAt},{now=Date.now(),automaticSupply=false}={}) {
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
    const quotedCatalog=catalog(db,now),quoted=quotedCatalog.offers.find(offer=>offer.id===offerId);
    if(!quoted)fail('invalid_palette',400);
    const end=endsAt===undefined?now+PALETTE_AUCTION_DURATION_MS:endsAt;
    if(!Number.isSafeInteger(end)||end<=now||end>now+PALETTE_AUCTION_DURATION_MS)fail('invalid_auction_end',400);
    const offer=quoted,publicOffer=publicMysteryOffer(offer);
    const editionId=`stock:${offer.id}:${quotedCatalog.rotationDate}`;
    // The private offer keeps the source pool. Public lots show odds only;
    // existing fixed-size rewards keep their original contract.
    db.prepare(`INSERT OR IGNORE INTO palette_editions(id,palette_id,event_id,rotation_date,starts_at,ends_at,payload_json)
      VALUES (?,?,NULL,?,?,?,?)`).run(editionId,offer.id,quotedCatalog.rotationDate,Date.parse(quotedCatalog.rotationDate),Date.parse(quotedCatalog.rotationDate)+86400000+PALETTE_AUCTION_DURATION_MS,
        JSON.stringify({version:4,pricingVersion:4,paletteId:offer.id,kind:'stock',available:true,items:offer.items,weights:offer.weights,rewardCount:3,openingMode:MYSTERY_STOCK_MODE}));
    const id=randomUUID(),snapshot={paletteId:offer.id,name:`${offer.name} mystery palette · ${offer.tierName}`,nameDe:`${offer.nameDe}-Überraschungspalette · ${offer.tierNameDe}`,
      badge:offer.tierName,kind:'stock',type:offer.category,rewardCount:3,items:[],stockOffer:publicOffer,
      allowedMarketCategories:[...new Set(offer.items.map(item=>item.marketCategory))],story:{en:'Sealed warehouse stock. Win the bid, then reveal the items and their quantities.',de:'Versiegelte Lagerware. Gewinne das Gebot und decke dann die Artikel und ihre Mengen auf.'}};
    db.prepare(`INSERT INTO primary_palette_auctions(id,creation_request_id,edition_id,reserve,status,started_at,ends_at,valuation_at,required_level,public_snapshot_json)
      VALUES (?,?,?,?,'active',?,?,?,1,?)`).run(id,requestId,editionId,offer.cost,now,end,now,JSON.stringify(snapshot));
    db.prepare('INSERT INTO primary_palette_mystery_stock(auction_id,offer) VALUES (?,?)').run(id,JSON.stringify(offer));
    return serializePublicAuction(db,db.prepare('SELECT * FROM primary_palette_auctions WHERE id=?').get(id));
  }));
}

// One live lot per available category/size keeps both affordable and premium
// stock on the normal board. Cold-start deadlines are staggered; replacement
// lots run a full hour, and frozen auctions can cross the daily pool rotation.
export function supplyStockPaletteAuctions(dataDir,{now=Date.now()}={}) {
  // Retire unbid old fixed-size lots; bidder-backed lots keep their contract.
  withDatabase(dataDir,db=>transaction(db,()=>{
    ensurePaletteAuctionSchema(db,now);
    const obsolete=db.prepare("SELECT id FROM primary_palette_auctions WHERE status='active' AND current_bidder_id IS NULL AND NOT EXISTS (SELECT 1 FROM primary_palette_bids b WHERE b.auction_id=primary_palette_auctions.id) AND json_extract(public_snapshot_json,'$.stockOffer.id') IS NOT NULL AND COALESCE(json_extract(public_snapshot_json,'$.stockOffer.openingMode'),'')!=?").all(MYSTERY_STOCK_MODE);
    for(const lot of obsolete){
      db.prepare('DELETE FROM primary_palette_stock_units WHERE auction_id=?').run(lot.id);
      db.prepare('DELETE FROM primary_palette_stock_draws WHERE auction_id=?').run(lot.id);
      db.prepare("UPDATE primary_palette_auctions SET status='ended',closed_at=?,settled_at=?,ends_at=? WHERE id=?").run(now,now,now,lot.id);
    }
  }));
  const quotedCatalog=stockPaletteAuctionCatalog(dataDir,{now}),offers=quotedCatalog.offers;
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
