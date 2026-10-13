// Shared handoffs: the same find can be kept, auctioned or stocked.
let traderStores = [];
function traderCategoryLabel(id) {
  const labels={electronics:['Electronics','Elektronik'],vehicles:['Vehicles','Fahrzeuge'],wine:['Wine & drinks','Wein & Getränke'],collectibles:['Collectibles','Sammlerstücke'],watches_jewelry:['Watches & jewellery','Uhren & Schmuck'],tools:['Tools','Werkzeuge'],household:['Household','Haushalt'],luxury_goods:['Luxury goods','Luxuswaren'],bicycles:['Bicycles','Fahrräder'],books_media:['Books & media','Bücher & Medien'],fashion:['Fashion','Mode'],cosmetics:['Cosmetics','Kosmetik'],sport_leisure:['Sport & leisure','Sport & Freizeit'],other:['Other','Sonstiges']};
  return accountEscape(labels[id]?t(...labels[id]):id);
}
function traderStoreLabel(id) {
  const labels={wine:['Wine store','Weinhandlung'],toys:['Toy store','Spielwarenladen'],electronics:['Electronics store','Elektronikladen'],cars:['Car dealership','Autohaus']};
  return labels[id]?t(...labels[id]):id;
}
function traderMilestoneState() {
  const done = new Set((account.traderMilestones || []).map(entry => entry.step));
  const steps = [
    ['daily', t('Complete Daily', 'Daily abschließen'), '/'],
    ['find', t('Manage your first find', 'Ersten Fund verwalten'), '/inventory'],
    ['sale', t('Complete a sale', 'Einen Verkauf abschließen'), '/inventory?state=available'],
    ['reinvest', t('Reinvest in your next find', 'In den nächsten Fund investieren'), '/auction-house']
  ];
  let next = steps.find(([id]) => !done.has(id));
  if (next?.[0]==='sale' && account.traderStock?.listed) next=['sale',t('Follow your listed finds','Verfolge deine angebotenen Funde'),'/auction-house?view=mine'];
  else if (next?.[0]==='sale' && !account.traderStock?.available && account.traderStock?.inStores) next=['sale',t('Check your store sales','Prüfe deine Ladenverkäufe'),'/businesses'];
  else if (next?.[0]==='sale' && account.traderStock?.available===0) next=['sale',t('Acquire your next find','Erwirb deinen nächsten Fund'),account.tokens>0?'/auction-house':'/'];
  if (next?.[0]==='reinvest' && account.tokens===0) next=['reinvest',t('Earn capital with Daily','Verdiene Handelskapital mit Daily'),'/'];
  return {done,steps,next};
}
function traderMilestonesMarkup() {
  if (!account) return '';
  const {done,steps,next}=traderMilestoneState();
  return `<section class="trader-progress" aria-label="${t('Milestones','Meilensteine')}">${next?`<div><strong>${t('Next step','Nächster Schritt')}: ${next[1]}</strong></div><a class="secondary-button" href="${next[2]}" data-page>${t('Continue','Weiter')} →</a>`:''}<details><summary>${t('Milestones','Meilensteine')} · ${steps.filter(([id])=>done.has(id)).length}/4</summary><ol>${steps.map(([id,label])=>`<li>${done.has(id)?'✓':'○'} ${label}</li>`).join('')}</ol></details></section>`;
}

function traderItemActions(item, copies) {
  if (item.kind === 'review-pack') return `<div class="item-actions"><button class="primary-button" data-review-pack-action="choose" data-id="${accountEscape(item.id)}" ${item.listed?'disabled':''}>${t('Redeem reviews','Bewertungen einlösen')}</button></div>`;
  const available = copies.find(copy => copy.id===item.id&&!copy.listed&&!copy.storeId)||copies.find(copy => !copy.listed && !copy.storeId);
  if (!available) return `<p class="item-state">${item.storeId?t('On store shelves','Im Ladenregal'):t('Listed for auction','Zur Auktion angeboten')}</p>${item.storeId?`<button class="secondary-button" data-trader="unstock" data-id="${accountEscape(item.id)}" data-shop="${accountEscape(item.storeId)}">${t('Return to inventory','Zurück ins Inventar')}</button>`:`<a href="/auction-house?view=mine" data-page>${t('View listing','Angebot ansehen')} →</a>`}`;
  const compatible = traderStores.filter(shop=>shop.type===available.businessType);
  const hasSpace = compatible.some(shop=>shop.stock.length<shop.capacity);
  return `<div class="item-actions trader-item-actions"><button class="secondary-button" data-trader="keep" data-id="${accountEscape(available.id)}">${t('Keep','Behalten')}</button>${economyFlags.resales?`<button class="primary-button" data-economy="list" data-id="${accountEscape(available.id)}">${t('List for auction','Zur Auktion anbieten')}</button>`:''}${economyFlags.businesses&&available.kind!=='case'?`<button class="secondary-button" data-trader="stock" data-id="${accountEscape(available.id)}" ${hasSpace?'':'disabled'}>${t('Stock a store','In einen Laden einräumen')}</button>${!hasSpace?`<small>${compatible.length?t('Compatible stores are full. Remove stock or auction this find.','Passende Läden sind voll. Entferne Waren oder versteigere den Fund.'):t('No compatible store. You can keep or auction this find.','Kein passender Laden. Du kannst den Fund behalten oder versteigern.')}</small>`:''}`:''}</div>`;
}

function traderItemFacts(item) {
  const category = item.marketCategory;
  return `<div class="trader-item-facts"><p>${t('Acquisition cost','Anschaffungskosten')}: <strong>${item.acquisitionCost==null?t('Cost unknown','Kosten unbekannt'):justizEuro(item.acquisitionCost)}</strong>${item.acquisitionSource==='reward'?` · ${t('Daily reward','Daily-Belohnung')}`:''}</p>${item.kind!=='case'?`<details><summary>${t('Item details','Details zum Gegenstand')}</summary><p>${t('Historical real-auction value','Historischer Wert der echten Auktion')}: ${euro(item.price)}</p></details>`:''}${economyFlags.market&&category?`<a href="/market?category=${encodeURIComponent(category)}" data-page>${t('Market Trends','Markttrends')} ↗</a>`:''}</div>`;
}

const traderStockDialog = document.createElement('dialog');
traderStockDialog.className = 'economy-dialog';
traderStockDialog.setAttribute('aria-labelledby','trader-stock-title');
document.body.append(traderStockDialog);
let traderReturnFocus = null, traderBusy = false;
traderStockDialog.addEventListener('close',()=>{
  const replacement = accountContent.querySelector(`[data-trader="stock"][data-id="${CSS.escape(traderReturnFocus?.dataset.id||'')}"]`);
  (replacement || (traderReturnFocus?.isConnected?traderReturnFocus:null) || accountContent.querySelector('h1'))?.focus({preventScroll:true});
});
document.addEventListener('click',async event=>{
  const button = event.target.closest('[data-trader]'); if(!button||traderBusy||!account)return;
  const action=button.dataset.trader, visit=accountVisit, owner=account.id;
  if(action==='close'){traderStockDialog.close();return;}
  const item = accountItems.find(entry=>entry.id===button.dataset.id);
  if(action==='stock'){
    if(!item||item.listed||item.storeId)return;
    caseReveal.close();
    traderReturnFocus=button;
    const shops=traderStores.filter(shop=>shop.type===item.businessType);
    traderStockDialog.innerHTML=`<div class="economy-dialog-content"><button class="dialog-close" data-trader="close" aria-label="${t('Close','Schließen')}">×</button><h2 id="trader-stock-title">${t('Choose a store','Laden auswählen')}</h2><p>${accountEscape(item.title)}</p><div class="trader-store-choices">${shops.map(shop=>`<button class="secondary-button" data-trader="stock-confirm" data-id="${accountEscape(item.id)}" data-shop="${accountEscape(shop.id)}" ${shop.stock.length>=shop.capacity?'disabled':''}>${accountEscape(shop.name||traderStoreLabel(shop.type))} · ${shop.stock.length}/${shop.capacity}</button>`).join('')}</div><p class="account-error" role="alert"></p></div>`;
    traderStockDialog.showModal(); (traderStockDialog.querySelector('[data-trader="stock-confirm"]:not(:disabled)') || traderStockDialog.querySelector('.dialog-close'))?.focus(); return;
  }
  traderBusy=true;button.disabled=true;
  try{
    const result=action==='keep'?await accountApi('inventory/keep',{id:button.dataset.id}):await accountApi(action==='unstock'?'businesses/unstock':'businesses/stock',action==='unstock'?{shopId:button.dataset.shop,inventoryId:button.dataset.id}:{shopId:button.dataset.shop,inventoryIds:[button.dataset.id]});
    if(visit!==accountVisit||account?.id!==owner)return;
    updateAccount(result.user);
    traderStockDialog.close();
    await navigateAccountPage('/inventory'+location.search,false);
    showToast(action==='keep'?t('Kept in your inventory.','Im Inventar behalten.'):action==='unstock'?t('Returned to inventory.','Zurück im Inventar.'):t('Stocked. Customers can now buy this find.','Eingeräumt. Kund:innen können den Fund jetzt kaufen.'));
  }catch(error){if(visit===accountVisit&&account?.id===owner){if(traderStockDialog.open)traderStockDialog.querySelector('.account-error').textContent=error.message;else showToast(error.message);}}
  finally{traderBusy=false;if(button.isConnected)button.disabled=false;}
});
function applyInventoryFilter(key, value, categoryCard = false) {
  if (currentAccountPage !== '/inventory' || !['state', 'category', 'rarity'].includes(key)) return;
  const query = new URLSearchParams(location.search);
  if (value === 'all') query.delete(key); else query.set(key, value);
  query.delete('focus');
  history.replaceState({}, '', '/inventory' + (query.size ? '?' + query : ''));
  accountInventoryPage = 0; renderInventory();
  const target = categoryCard ? `[data-inventory-category="${CSS.escape(value)}"]` : `[data-inventory-filter="${key}"]`;
  accountContent.querySelector(target)?.focus({preventScroll:true});
}
document.addEventListener('click', event => {
  const card = event.target.closest('[data-inventory-category]');
  if (card) applyInventoryFilter('category', card.dataset.inventoryCategory, true);
});
document.addEventListener('change', event => {
  const key = event.target.dataset.inventoryFilter;
  if (key) applyInventoryFilter(key, event.target.value);
});
