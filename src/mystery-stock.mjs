import { randomInt, randomUUID } from 'node:crypto';
import { drawItem, RARITIES } from './cases.mjs';
import { expectedItemValue, ECONOMY_BALANCE } from './economy-balance.mjs';
import { luckWeights, skillEffects } from './skill-effects.mjs';
import { estimatedValueTokens, marketIndexes } from './market.mjs';
import { acquireItems } from './trader.mjs';
import { AccountError } from './errors.mjs';
import { assertPlayerFree } from './justice.mjs';

export const MYSTERY_STOCK_MODE='opening-v2';
// Reference odds used for pricing and NPC risk budgets. New offers improve
// upper-quantity odds without charging that improvement back to the player.
// Three independent item/quantity pairs. Even premium lots can have a poor
// haul before return protection; budget lots retain a genuine jackpot tail.
export const MYSTERY_QUANTITIES={
  budget:[[1,5500],[2,2500],[3,1200],[6,600],[12,180],[24,20]],
  standard:[[1,2200],[3,2800],[6,2400],[12,1800],[24,700],[48,100]],
  premium:[[1,500],[4,1000],[12,2500],[24,3500],[48,2000],[96,500]]
};
export function boostedQuantityOdds(choices,bonus=0){
  const weights=luckWeights(choices.map(choice=>choice.weight),bonus),total=weights.reduce((a,b)=>a+b,0);
  return choices.map((choice,index)=>({quantity:choice.quantity,weight:weights[index],percent:weights[index]/total*100}));
}
export function referenceQuantityOdds(tier){
  const choices=MYSTERY_QUANTITIES[tier];
  if(!choices)throw new AccountError('invalid_palette',400);
  return boostedQuantityOdds(choices.map(([quantity,weight])=>({quantity,weight})));
}
export function quantityOdds(tier,bonus=0){
  const reference=referenceQuantityOdds(tier);
  const mean=reference.reduce((sum,entry)=>sum+entry.quantity*entry.percent/100,0);
  const boost=ECONOMY_BALANCE.paletteQuantityBoost[tier];
  return boostedQuantityOdds(reference.map(({quantity,weight})=>({quantity,
    weight:weight*(quantity>=mean?100+boost:100)})),bonus);
}
export const expectedQuantity=(odds,rolls=3)=>rolls*odds.reduce((sum,entry)=>sum+entry.quantity*entry.percent/100,0);
export function mysteryStockOffer(quoted,indexes){
  const odds=quantityOdds(quoted.tier),amount=expectedQuantity(odds);
  const bidReferenceQuantity=expectedQuantity(referenceQuantityOdds(quoted.tier));
  const items=quoted.items.map(item=>({...item,referenceValue:estimatedValueTokens(item,indexes)}));
  const baseline=Math.max(expectedItemValue(items,quoted.weights),expectedItemValue(items,quoted.weights,item=>item.referenceValue));
  const cost=Math.ceil(baseline*bidReferenceQuantity/ECONOMY_BALANCE.paidCaseReturn);
  if(!Number.isSafeInteger(cost)||cost<1)throw new AccountError('invalid_palette',400);
  const {quantity,quantitySplits,multiplierChances,...offer}=quoted;
  return {...offer,openingMode:MYSTERY_STOCK_MODE,items,cost,quantityOdds:odds,expectedQuantity:amount,bidReferenceQuantity,
    expectedMarket:expectedItemValue(items,offer.weights,item=>item.referenceValue)*amount};
}
export function publicMysteryOffer(offer,bonus=offer.luckPercent||0){
  const {id,category,name,nameDe,tier,tierName,tierNameDe,cost,weights,quantityOdds:baseQuantityOdds,rolls,openingMode}=offer;
  const personalWeights=luckWeights(weights,bonus),total=personalWeights.reduce((a,b)=>a+b,0);
  return {id,category,name,nameDe,tier,tierName,tierNameDe,cost,weights:personalWeights,luckPercent:bonus,
    dropChances:RARITIES.map((rarity,index)=>({rarity:rarity.id,percent:personalWeights[index]/total*100})),
    quantityOdds:boostedQuantityOdds(baseQuantityOdds,bonus),rolls,openingMode,
    acquisitionMode:'auction',purchasable:false};
}
// Add real copies of a drawn item, never inflate its price or remove a jackpot.
// The most valuable draw needs the fewest extra inventory rows. Protection
// uses today's inventory valuation and the visible paid bid, not max escrow.
export function protectMysteryDraws(draws,cost,indexes,random=randomInt){
  const profit=random(100)<ECONOMY_BALANCE.paletteProfitChance;
  const percent=profit?ECONOMY_BALANCE.paletteProfitReturnPercent:ECONOMY_BALANCE.paletteMinimumReturnPercent;
  const target=Math.ceil(cost*percent/100);
  const values=draws.map(draw=>estimatedValueTokens(draw.item,indexes));
  const value=draws.reduce((sum,draw,index)=>sum+draw.quantity*values[index],0);
  const best=values.indexOf(Math.max(...values));
  return draws.map((draw,index)=>({...draw,quantity:draw.quantity+(index===best?Math.max(0,Math.ceil((target-value)/values[index])):0)}));
}
export function openMysteryStock(db,row,userId,now,random=randomInt){
  if(row.winner_id!==userId||row.settled_at===null||now<row.ends_at)throw new AccountError('palette_rewards_not_found',404);
  const saved=db.prepare('SELECT * FROM primary_palette_mystery_stock WHERE auction_id=?').get(row.id);
  if(!saved||saved.seized_at!==null)throw new AccountError('palette_rewards_not_found',404);
  const player=db.prepare('SELECT npc,banned,must_change_password FROM users WHERE id=?').get(userId);
  if(!player||player.npc||player.banned)throw new AccountError('forbidden',403);
  if(player.must_change_password)throw new AccountError('password_change_required',403);
  assertPlayerFree(db,userId,now);
  if(saved.rewards)return JSON.parse(saved.rewards);
  const offer=JSON.parse(saved.offer),luckPercent=skillEffects(db,userId).luckPercent;
  const weights=luckWeights(offer.weights,luckPercent),odds=boostedQuantityOdds(offer.quantityOdds,luckPercent),total=odds.reduce((sum,entry)=>sum+entry.weight,0);
  const draws=Array.from({length:3},(_,position)=>{
    const original=drawItem(null,{items:offer.items,weights},random);
    let roll=random(total),choice=0;while(roll>=odds[choice].weight)roll-=odds[choice++].weight;
    const quantity=odds[choice].quantity;
    const item={...original,paletteAuctionId:row.id,paletteEditionId:row.edition_id,rewardPosition:position,bundleCostTokens:row.current_bid,luckPercent};
    return {position,quantity,item};
  });
  const insert=db.prepare('INSERT INTO inventory (id,user_id,item,created_at) VALUES (?,?,?,?)');
  const rewards=protectMysteryDraws(draws,row.current_bid,marketIndexes(db,now),random).map(draw=>{
    const inventoryIds=Array.from({length:draw.quantity},()=>randomUUID());
    for(const id of inventoryIds)insert.run(id,userId,JSON.stringify({...draw.item,id}),now);
    return {...draw,inventoryIds};
  });
  acquireItems(db,userId,rewards.flatMap(reward=>reward.inventoryIds),row.current_bid,'purchase',now);
  const winningOffer=publicMysteryOffer(offer,luckPercent);
  const payload={offer:{...winningOffer,quantity:rewards.reduce((sum,reward)=>sum+reward.quantity,0),
    multiplierChances:winningOffer.quantityOdds},rewards,pool:offer.items};
  db.prepare('UPDATE primary_palette_mystery_stock SET rewards=? WHERE auction_id=? AND rewards IS NULL').run(JSON.stringify(payload),row.id);
  return payload;
}
