import { ensureTraderSchema,splitCost } from './trader.mjs';
import { withDatabase,transaction } from './database.mjs';
import { AccountError } from './errors.mjs';
import { scoreGuess } from './core.mjs';
import { ensureStatisticsSchema,statisticEvent } from './statistics-ledger.mjs';
import { discountedCaseCost } from './prestige-effects.mjs';

const has=(db,table)=>Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table));
const rows=(db,table,query,...args)=>has(db,table)?db.prepare(query).all(...args):[];
const reference=item=>Math.max(0,Math.round(Number(item?.price)||0));
const payload=value=>value?JSON.parse(value):{};

// Snapshot recoverable history before Prestige retires assets or clears ledgers.
// A source's stable key prevents repeated reads or payment retries inflating totals.
export function syncUserStatistics(db,userId,now=Date.now()) {
 ensureStatisticsSchema(db); ensureTraderSchema(db);
 db.prepare('INSERT OR IGNORE INTO user_statistics_state VALUES(?,?)').run(userId,now);
 const add=(key,kind,data)=>statisticEvent(db,userId,key,kind,data);
 for(const row of rows(db,'trader_sales','SELECT * FROM trader_sales WHERE user_id=?',userId)){
  const kind=row.business_id?'store':row.source_id.startsWith('resale:')?'auction':'instant';
  add(`sale:${row.source_id}:${row.inventory_id}`,`in:sale_${kind}`,{amount:row.proceeds,quantity:1,cost:row.cost,reward:row.reward,at:row.sold_at});
  if(row.guard_fee)add(`guard:${row.source_id}:${row.inventory_id}`,'out:guard',{amount:row.guard_fee,at:row.sold_at});
 }
 for(const row of rows(db,'resale_auctions',`SELECT a.*,(SELECT COUNT(*) FROM resale_auction_items ai WHERE ai.auction_id=a.id) AS quantity FROM resale_auctions a WHERE a.seller_id=? AND a.winner_id IS NOT NULL AND a.settled_at IS NOT NULL`,userId)){
  const known=db.prepare('SELECT 1 FROM user_statistics_events WHERE user_id=? AND event_key LIKE ? LIMIT 1').get(userId,`sale:resale:${row.id}:%`);
  add(`legacy-auction-sale:${row.id}`,'in:sale_auction',{amount:known?0:row.current_bid,quantity:known?0:row.quantity,at:row.settled_at});
 }
 for(const row of rows(db,'daily_rewards','SELECT * FROM daily_rewards WHERE user_id=?',userId))add(`reward:${row.date}:${row.mode}`,`in:${row.mode}`,{amount:row.earned,at:Date.parse(row.date)});
 for(const row of rows(db,'case_purchases','SELECT * FROM case_purchases WHERE user_id=?',userId)){
  const item=payload(row.item);add(`case-buy:${row.request_id}`,'out:case_shop',{amount:item.caseCost||0,quantity:1,at:item.createdAt||now});
 }
 for(const row of rows(db,'case_openings','SELECT * FROM case_openings WHERE user_id=?',userId)){
  const item=payload(row.item),cost=item.caseCost??null;
  add(`legacy-case-buy:${row.request_id}`,'out:case_shop',{amount:cost||0,quantity:1,at:item.createdAt||now});
  add(`legacy-case-open:${row.request_id}`,'case_open',{quantity:1,value:reference(item),cost,rarity:item.rarity||null,at:item.createdAt||now});
 }
 const prestigeRows=rows(db,'prestige_receipts','SELECT result FROM prestige_receipts WHERE user_id=?',userId).map(row=>payload(row.result));
 for(const row of rows(db,'sealed_cases',`SELECT s.*,i.item,i.user_id,a.cost FROM sealed_cases s JOIN inventory i ON i.id=s.inventory_id
  LEFT JOIN item_acquisitions a ON a.inventory_id=i.id AND a.user_id=i.user_id WHERE s.opened_at IS NOT NULL AND
  (i.user_id=? OR (i.user_id='npc-prestige-retired' AND i.id IN (
   SELECT json_extract(item,'$.id') FROM case_purchases WHERE user_id=? UNION
   SELECT ai.inventory_id FROM resale_auction_items ai JOIN resale_auctions r ON r.id=ai.auction_id WHERE r.winner_id=? UNION
   SELECT case_inventory_id FROM daily_case_rewards WHERE user_id=?)))`,userId,userId,userId,userId)){
  const last=rows(db,'resale_auctions',`SELECT r.*,ai.position,(SELECT COUNT(*) FROM resale_auction_items x WHERE x.auction_id=r.id) AS quantity FROM resale_auctions r JOIN resale_auction_items ai ON ai.auction_id=r.id
   WHERE ai.inventory_id=? AND r.settled_at IS NOT NULL AND r.winner_id IS NOT NULL ORDER BY r.rowid DESC LIMIT 1`,row.inventory_id)[0];
  const purchase=rows(db,'case_purchases',"SELECT user_id,item FROM case_purchases WHERE json_extract(item,'$.id')=? LIMIT 1",row.inventory_id)[0];
  const daily=rows(db,'daily_case_rewards','SELECT user_id FROM daily_case_rewards WHERE case_inventory_id=?',row.inventory_id)[0];
  const opener=last?.winner_id||purchase?.user_id||daily?.user_id;
  if(row.user_id!==userId&&opener!==userId)continue;
  let cost=row.cost??null;
  if(cost===null&&last?.winner_id===userId){const discount=prestigeRows.some(receipt=>receipt.buffId==='cases'&&receipt.createdAt<=last.settled_at)?50:0;cost=splitCost(discountedCaseCost(last.current_bid,discount),last.quantity)[last.position];}
  if(cost===null&&!last&&purchase?.user_id===userId)cost=payload(purchase.item).caseCost??null;
  if(cost===null&&!last&&daily?.user_id===userId)cost=0;
  const item=payload(row.reward);add(`case-open:${row.inventory_id}`,'case_open',{quantity:1,value:reference(item),cost,rarity:item.rarity||null,at:row.opened_at});
 }
 for(const row of rows(db,'daily_case_rewards','SELECT * FROM daily_case_rewards WHERE user_id=? AND opened_at IS NOT NULL AND case_inventory_id IS NULL',userId)){
  const item=payload(row.item);
  if(item.item?.kind==='case'||prestigeRows.some(receipt=>receipt.createdAt===row.opened_at))continue;
  add(`old-daily-case:${row.run_id}`,'case_open',{quantity:1,value:reference(item),cost:0,rarity:item.rarity||null,at:row.opened_at});
 }
 for(const row of rows(db,'resale_auctions',`SELECT a.*,i.item,(SELECT COUNT(*) FROM resale_auction_items ai WHERE ai.auction_id=a.id) AS quantity
  FROM resale_auctions a JOIN inventory i ON i.id=a.inventory_id WHERE a.winner_id=? AND a.settled_at IS NOT NULL`,userId)){
  const item=payload(row.item),isCase=item.kind==='case';
  const discount=isCase&&prestigeRows.some(receipt=>receipt.buffId==='cases'&&receipt.createdAt<=row.settled_at)?50:0;
  const cost=isCase?discountedCaseCost(row.current_bid,discount):row.current_bid;
  add(`resale-buy:${row.id}`,isCase?'out:case_auction':'out:auction',{amount:cost,quantity:row.quantity,at:row.settled_at});
  add(`resale-win:${row.id}`,'auction_win',{quantity:1,at:row.settled_at});
 }
 for(const row of rows(db,'primary_palette_auctions','SELECT * FROM primary_palette_auctions WHERE winner_id=? AND settled_at IS NOT NULL',userId)){
  add(`palette-buy:${row.id}`,'out:palette',{amount:row.current_bid,quantity:1,at:row.settled_at});
  add(`palette-win:${row.id}`,'auction_win',{quantity:1,at:row.settled_at});
  const saved=rows(db,'primary_palette_mystery_stock','SELECT rewards FROM primary_palette_mystery_stock WHERE auction_id=? AND rewards IS NOT NULL',row.id)[0];
  if(saved){const reveal=payload(saved.rewards);add(`palette-open:${row.id}`,'palette_open',{quantity:1,value:(reveal.rewards||[]).reduce((sum,r)=>sum+r.quantity,0),at:row.revealed_at||row.settled_at});}
  if(!saved&&row.revealed_at!==null&&!prestigeRows.some(receipt=>receipt.createdAt===row.revealed_at)){
   const legacy=rows(db,'primary_palette_stock_draws','SELECT rewards FROM primary_palette_stock_draws WHERE auction_id=? AND rewards IS NOT NULL',row.id)[0];
   const count=legacy?(payload(legacy.rewards).rewards||[]).reduce((sum,r)=>sum+r.quantity,0):rows(db,'primary_palette_rewards','SELECT position FROM primary_palette_rewards WHERE auction_id=?',row.id).length;
   if(count)add(`palette-open:${row.id}`,'palette_open',{quantity:1,value:count,at:row.revealed_at});
  }
 }
 for(const row of rows(db,'stock_palette_purchases','SELECT * FROM stock_palette_purchases WHERE user_id=?',userId)){
  add(`direct-palette-buy:${row.id}`,'out:palette',{amount:row.cost,quantity:1,at:row.created_at});
  if(row.revealed_at!==null)add(`direct-palette-open:${row.id}`,'palette_open',{quantity:1,value:payload(row.rewards).reduce((sum,r)=>sum+r.quantity,0),at:row.revealed_at});
 }
 for(const row of rows(db,'businesses','SELECT * FROM businesses WHERE user_id=? AND retired=0',userId)){
  const known=db.prepare('SELECT COALESCE(SUM(proceeds),0) AS revenue,COUNT(*) AS sales FROM trader_sales WHERE user_id=? AND business_id=?').get(userId,row.id);
  add(`legacy-store-sales:${row.id}`,'in:sale_store',{amount:Math.max(0,row.revenue-known.revenue),quantity:Math.max(0,row.sales-known.sales),at:now});
  add(`store-open:${row.id}`,'store_open',{quantity:1,cost:row.opening_cost??null,at:row.bought_at});
  if(row.opening_cost!==null&&row.opening_cost!==undefined)add(`store-cost:${row.id}`,'out:store',{amount:row.opening_cost,at:row.bought_at});
  add(`store-visitors:${row.id}`,'store_visitors',{quantity:row.visitors,at:now});
 }
 for(const row of rows(db,'store_visits',`SELECT v.* FROM store_visits v JOIN businesses b ON b.id=v.business_id WHERE b.user_id=?`,userId))add(`player-visit:${row.business_id}:${row.user_id}:${row.day}`,'store_player_visit',{quantity:1,at:row.created_at});
 for(const row of rows(db,'store_receipts','SELECT * FROM store_receipts WHERE user_id=? AND action IN (\'buy\',\'tip\',\'collect-cash\')',userId)){
  if(row.action==='collect-cash'){add(`collect:${row.id}`,'collected',{amount:row.amount,quantity:row.amount>0?1:0,at:row.created_at});continue;}
  add(`store-receipt:${row.id}`,row.action==='buy'?'out:store_item':'out:tip',{amount:row.amount,quantity:row.action==='buy'?1:0,at:row.created_at});
 }
 for(const row of rows(db,'store_receipts',`SELECT r.* FROM store_receipts r JOIN businesses b ON b.id=r.business_id
  WHERE b.user_id=? AND r.action='tip'`,userId))add(`tip-in:${row.id}`,'in:tip',{amount:row.amount,at:row.created_at});
 for(const row of rows(db,'store_heists','SELECT * FROM store_heists WHERE user_id=?',userId)){
  add(`heist:${row.id}`,`heist:${row.status}`,{quantity:1,value:row.fee,at:row.created_at});
  const result=payload(row.result),consequence=result.consequence;
  if(consequence){
   const tracked=db.prepare("SELECT 1 FROM user_statistics_events WHERE user_id=? AND event_key LIKE ? AND created_at=?").get(userId,`fine:${consequence.offences}:cash:%`,row.settled_at||row.created_at);
   if(!tracked)add(`fine:${consequence.offences}:legacy:${row.id}`,'out:fine',{amount:(consequence.paidCash||0)+(consequence.paidStoreCash||0),at:row.settled_at||row.created_at});
  }
 }
 for(const row of rows(db,'store_heists',"SELECT * FROM store_heists WHERE owner_id=? AND status='caught' AND blackjack IS NOT NULL",userId)){if(row.chance_basis_points!=null)add(`fine-in:${row.id}`,'in:fine',{amount:row.fee,at:row.settled_at||row.created_at});}
 for(const row of rows(db,'store_events','SELECT * FROM store_events WHERE owner_id=?',userId)){
  const result=payload(row.result);
  if(result.type==='windfall')add(`store-gift:${row.id}`,'in:store_event',{amount:Math.max(0,result.money||0),at:row.created_at});
  if((result.money||0)<0)add(`store-loss:${row.id}`,'out:store_event',{amount:-result.money,at:row.created_at});
 }
 const user=db.prepare('SELECT created_at FROM users WHERE id=?').get(userId);
 for(const row of rows(db,'user_token_grants','SELECT * FROM user_token_grants WHERE user_id=?',userId))add(`gift-personal:${row.admin_id}:${row.request_id}`,'in:gift',{amount:row.amount,at:row.created_at});
 for(const row of rows(db,'token_grants','SELECT * FROM token_grants WHERE created_at>=?',user.created_at))add(`gift-global:${row.admin_id}:${row.request_id}`,'in:gift',{amount:row.amount,at:row.created_at});
 for(const row of rows(db,'resale_auctions','SELECT * FROM resale_auctions WHERE seller_id=?',userId))add(`listed:${row.id}`,'auction_list',{quantity:1,at:row.started_at});
 for(const [table,prefix] of [['resale_bids','resale'],['primary_palette_bids','palette']])for(const row of rows(db,table,`SELECT * FROM ${table} WHERE bidder_id=?`,userId))add(`bid:${prefix}:${row.id}`,'auction_bid',{quantity:1,at:row.created_at});
 for(const row of rows(db,'xp_events','SELECT * FROM xp_events WHERE user_id=?',userId))add(`xp:${row.source_type}:${row.source_id}`,'xp_earned',{amount:row.amount,at:row.created_at});
 for(const row of rows(db,'prestige_receipts','SELECT request_id,result FROM prestige_receipts WHERE user_id=?',userId))add(`prestige:${row.request_id}`,'prestige',{quantity:1,at:payload(row.result).createdAt});
 for(const row of rows(db,'store_reviews','SELECT business_id,updated_at FROM store_reviews WHERE user_id=?',userId))add(`review:${row.business_id}`,'review',{quantity:1,at:row.updated_at});
 for(const row of rows(db,'account_games','SELECT * FROM account_games WHERE user_id=? AND complete=1',userId)){
  const run=payload(row.payload);let value=0;
  if(row.mode==='daily'&&run.answers?.length===5)value=run.answers.reduce((sum,guess,index)=>sum+scoreGuess(guess,run.auctions[index].actualBid),0);
  if(row.mode==='higher-lower')value=run.streak||0;
  add(`game:${row.id}`,`game:${row.mode}`,{quantity:1,value,at:Date.parse(row.date)});
 }
}

export function statisticsView(db,userId,now=Date.now()) {
 syncUserStatistics(db,userId,now);
 const events=db.prepare('SELECT * FROM user_statistics_events WHERE user_id=?').all(userId);
 const kinds=prefix=>events.filter(event=>event.kind.startsWith(prefix));
 const sum=(list,key='amount')=>list.reduce((total,event)=>total+(event[key]||0),0);
 const stat=(kind,key='amount')=>sum(events.filter(event=>event.kind===kind),key);
 const earned=kinds('in:'),spent=kinds('out:'),sales=kinds('in:sale_'),cases=events.filter(event=>event.kind==='case_open');
 const guards=stat('out:guard');
 const tracked=sales.filter(event=>event.cost!==null&&!event.reward);
 const trackedGuards=tracked.reduce((sum,event)=>sum+(events.find(fee=>fee.event_key===event.event_key.replace(/^sale:/,'guard:'))?.amount||0),0);
 const rarityIds=['common','uncommon','rare','epic','legendary'];
 return {userId,updatedAt:now,scope:'recorded-lifetime',
  money:{earned:sum(earned),spent:sum(spent),net:sum(earned)-sum(spent),guardCosts:guards,finesPaid:stat('out:fine'),gifts:stat('in:gift'),tipsGiven:stat('out:tip'),tipsReceived:stat('in:tip'),finesReceived:stat('in:fine'),dailyRewards:stat('in:daily'),higherLowerRewards:stat('in:higher-lower'),
   earnings:[['store','in:sale_store'],['auction','in:sale_auction'],['games','in:daily','in:higher-lower'],['other','in:sale_instant','in:gift','in:tip','in:fine','in:store_event']].map(([id,...keys])=>({id,amount:keys.reduce((total,key)=>total+stat(key),0)}))},
  cases:{opened:sum(cases,'quantity'),value:sum(cases,'value'),cost:stat('out:case_shop')+stat('out:case_auction'),bought:stat('out:case_shop','quantity')+stat('out:case_auction','quantity'),openedCost:sum(cases,'cost'),unknownCosts:cases.filter(event=>event.cost===null).length,bestValue:cases.reduce((best,event)=>Math.max(best,event.value),0),rarities:rarityIds.map(id=>({id,count:sum(cases.filter(event=>event.rarity===id),'quantity')}))},
  trading:{itemsSold:sum(sales,'quantity'),auctionWins:stat('auction_win','quantity'),auctionsListed:stat('auction_list','quantity'),bids:stat('auction_bid','quantity'),profit:sum(tracked)-sum(tracked,'cost')-trackedGuards,unknownCosts:sum(sales.filter(event=>event.cost===null),'quantity'),palettesOpened:stat('palette_open','quantity'),paletteItems:stat('palette_open','value')},
  stores:{opened:stat('store_open','quantity'),visitors:stat('store_visitors','quantity')+stat('store_player_visit','quantity'),playerVisits:stat('store_player_visit','quantity'),sales:stat('in:sale_store','quantity'),revenue:stat('in:sale_store'),collected:stat('collected'),collections:stat('collected','quantity'),unknownCosts:events.filter(event=>event.kind==='store_open'&&event.cost===null).length},
  theft:{attempts:sum(kinds('heist:'),'quantity'),stolen:stat('heist:stolen','quantity'),caught:stat('heist:caught','quantity'),escaped:stat('heist:escaped','quantity'),tied:stat('heist:push','quantity')},
  community:{prestiges:stat('prestige','quantity'),reviews:stat('review','quantity')},
  games:{xpEarned:stat('xp_earned'),dailyCompleted:stat('game:daily','quantity'),bestDailyScore:events.filter(event=>event.kind==='game:daily').reduce((best,event)=>Math.max(best,event.value),0),higherLowerCompleted:stat('game:higher-lower','quantity'),bestStreak:events.filter(event=>event.kind==='game:higher-lower').reduce((best,event)=>Math.max(best,event.value),0)}};
}
export function userStatistics(dataDir,user,{now=Date.now()}={}) {
 return withDatabase(dataDir,db=>transaction(db,()=>{
  const actor=db.prepare('SELECT id FROM users WHERE id=? AND npc=0 AND banned=0 AND must_change_password=0').get(user?.id||'');
  if(!actor)throw new AccountError('login_required',401);
  return statisticsView(db,actor.id,now);
 }));
}
