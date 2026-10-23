window.townUi = (() => {
  const esc = accountEscape, art = window.townArtwork, ui = window.shopUi, typeName = ui.typeName, sizeName = ui.sizeName;
  let data = null, timer = null, request = 0, selected = null, linkedPlot = null, storeType = 'wine';
  let busy = false, returnFocus = null, purchaseStep = 1, takeoverRequestId = null;
  const dialog = document.createElement('dialog');
  dialog.className = 'shop-task town-purchase-dialog'; dialog.setAttribute('aria-labelledby', 'town-purchase-title'); document.body.append(dialog);
  function stop() { clearInterval(timer); request++; data = null; linkedPlot = null; busy = false; dialog.close(); }
  async function refresh(visit, repaint = true) {
    const current = ++request, owner = account?.id;
    const response = await fetch('/api/town', {headers:{accept:'application/json'}}), result = await response.json();
    if (!response.ok) throw Error(accountError(result.error));
    if (visit !== accountVisit || current !== request || owner !== account?.id) return;
    data = result;
    if (repaint) render();
  }
  async function load(visit) {
    await economyReady;
    if (!economyFlags.businesses) { data = {disabled:true}; return; }
    selected = null; linkedPlot = new URLSearchParams(location.search).get('plot');
    await refresh(visit, false);
    if (visit !== accountVisit) return;
    timer = setInterval(() => {
      if (!document.hidden && !busy && !dialog.open) refresh(visit).catch(() => {});
    },30000);
  }
  const price = p => p.abandoned ? p.takeoverPrice : Math.min(...Object.values(p.costs));
  function locationRow(p) {
    const locked = account && (data.playerLevel??1) < p.requiredLevel;
    return `<button type="button" class="town-place-row${locked?' is-locked':''}" data-town-open="${esc(p.id)}"><span class="town-location-copy"><strong>${esc(sizeName(p.size))}</strong><small>${esc(p.streetName)}</small></span><span class="town-location-level">${t('Level','Level')} ${p.requiredLevel}${p.abandoned?`<small>${t('Abandoned','Verlassen')}</small>`:''}</span><span class="town-row-price"><small>${p.abandoned?t('Purchase','Kauf'):t('From','Ab')}</small>${justizEuro(price(p))}<span aria-hidden="true"> →</span></span></button>`;
  }
  function districtCard(district) {
    const seen = new Set();
    const places = data.plots.filter(p => {
      if(p.districtId!==district.id)return false;
      if(p.occupied)return p.abandoned&&!p.business?.own;
      const key=JSON.stringify([p.streetName,p.streetType,p.size]);if(seen.has(key))return false;seen.add(key);return true;
    }).sort((a,b)=>price(a)-price(b)||a.id.localeCompare(b.id));
    return `<article class="town-location-district" style="--district-color:${esc(district.color)}"><header><span class="town-district-number" aria-hidden="true">${district.number}</span><h3>${esc(district.name)}</h3></header><div>${places.map(locationRow).join('')}</div></article>`;
  }
  function render() {
    if (currentAccountPage !== '/town' || !data) return;
    if (data.disabled) { accountContent.innerHTML = pageHeading(t('Store opening is unavailable.','Ladeneröffnung ist nicht verfügbar.')); return; }
    const tiers = [
      {id:'budget',name:t('Budget','Günstig'),min:0,max:1},
      {id:'midrange',name:t('Midrange','Mittelklasse'),min:1,max:1.5},
      {id:'premium',name:t('Premium','Premium'),min:1.5,max:Infinity}
    ];
    accountContent.innerHTML = `<div class="town-page stores-workspace"><header class="shop-page-heading"><h1 tabindex="-1">${t('Open a store','Laden eröffnen')}</h1><a class="secondary-button" href="/stores" data-page>← ${t('Stores','Läden')}</a></header>${account?`<p class="town-store-limit">${t('Your stores','Deine Läden')}: <strong>${data.myStoreCount} / ${data.maxStores}</strong></p>`:''}${tiers.map((tier,index)=>{const districts=data.districts.filter(d=>d.priceMultiplier>tier.min&&d.priceMultiplier<=tier.max).sort((a,b)=>a.priceMultiplier-b.priceMultiplier);return `<section class="town-location-tier tier-${tier.id}" aria-labelledby="town-tier-${tier.id}"><header class="town-tier-heading"><span class="town-tier-number" aria-hidden="true">0${index+1}</span><h2 id="town-tier-${tier.id}">${tier.name}</h2><span class="town-tier-price">${number(districts[0].priceMultiplier,2)}–${number(districts.at(-1).priceMultiplier,2)}× ${t('location cost','Standortpreis')}</span></header><div class="town-tier-grid">${districts.map(districtCard).join('')}</div></section>`;}).join('')}</div>`;
    if (linkedPlot) { const id=linkedPlot; linkedPlot=null; openPurchase(id); }
  }
  function purchaseMarkup(){
    const plot=data.plots.find(plot=>plot.id===selected);if(!plot||plot.occupied&&!plot.abandoned)return '';
    if(plot.abandoned)return takeoverMarkup(plot);
    const cost=plot.costs[storeType],capacity=storeType==='cars'?plot.carCapacity:plot.capacity,capped=data.myStoreCount>=data.maxStores,locked=account&&(data.playerLevel??1)<plot.requiredLevel;
    return `<div class="town-purchase-content"><button type="button" class="dialog-close" data-town-close aria-label="${t('Close','Schließen')}">×</button><p class="eyebrow">${esc(plot.districtName)}</p><h2 id="town-purchase-title" tabindex="-1">${esc(plot.streetName)}</h2><p class="town-location-size">${esc(sizeName(plot.size))}</p><form class="town-purchase"><fieldset ${purchaseStep===2?'hidden':''}><legend>${t('Store type','Ladentyp')}</legend><div class="town-type-grid">${data.types.map(type=>`<label class="town-type-choice${storeType===type.id?' is-selected':''}"><input type="radio" name="type" value="${type.id}" ${storeType===type.id?'checked':''} ${busy?'disabled':''}>${art.icon(type.id)}<span>${esc(typeName(type.id))}</span><strong class="town-type-price">${justizEuro(plot.costs[type.id])}</strong>${ui.stockHint(type.id)?`<small class="town-type-hint">${esc(ui.stockHint(type.id))}</small>`:''}</label>`).join('')}</div></fieldset><div class="town-purchase-checkout"><div class="town-buy-summary"><span>${esc(typeName(storeType))}<small>${capacity} ${t('shelf spaces','Regalplätze')}</small></span><strong>${justizEuro(cost)}</strong></div>${account?`<p class="town-purchase-note">${capped?t('Your store limit is reached.','Dein Ladenlimit ist erreicht.'):locked?t(`Requires level ${plot.requiredLevel}.`,`Benötigt Level ${plot.requiredLevel}.`):account.tokens<cost?t(`You need ${justizEuro(cost-account.tokens)} more.`,`Dir fehlen noch ${justizEuro(cost-account.tokens)}.`):t(`Balance after purchase: ${justizEuro(account.tokens-cost)}.`,`Guthaben nach dem Kauf: ${justizEuro(account.tokens-cost)}.`)}</p><button type="${purchaseStep===1?'button':'submit'}" ${purchaseStep===1?'data-town-review':''} class="primary-button" ${busy||capped||locked||account.tokens<cost?'disabled':''}>${busy?t('Opening…','Wird eröffnet …'):purchaseStep===1?t('Review location','Standort prüfen'):t('Confirm & open store','Bestätigen & Laden eröffnen')} →</button>`:`<a href="/login" data-page class="primary-button">${t('Sign in to open here','Anmelden und hier eröffnen')} →</a>`}<p class="account-error" role="alert"></p></div></form>${purchaseStep===2?`<button class="secondary-button" data-town-back>${t('Change store type','Ladentyp ändern')}</button>`:''}<details class="town-location-details" ${purchaseStep===2?'open':''}><summary>${t('Location details','Standortdetails')}</summary><dl><div><dt>${t('Required level','Benötigtes Level')}</dt><dd>${plot.requiredLevel}</dd></div><div><dt>${t('Foot traffic','Laufkundschaft')}</dt><dd>${number(plot.trafficMultiplier,2)}×</dd></div><div><dt>${t('Location price','Standortpreis')}</dt><dd>${number(plot.priceMultiplier,2)}×</dd></div><div><dt>${t('Theft fine','Diebstahlbußgeld')}</dt><dd>${number(Math.max(1,1/plot.theftMultiplier),2)}×</dd></div><div><dt>${t('Compatible inventory','Passendes Inventar')}</dt><dd>${data.compatibleStock?.[storeType]||0}</dd></div></dl></details></div>`;
  }
  function takeoverMarkup(plot) {
    const capped=data.myStoreCount>=data.maxStores,locked=account&&(data.playerLevel??1)<plot.requiredLevel,cost=plot.takeoverPrice;
    return `<div class="town-purchase-content"><button type="button" class="dialog-close" data-town-close aria-label="${t('Close','Schließen')}">×</button><p class="eyebrow">${t('Abandoned','Verlassen')}</p><h2 id="town-purchase-title" tabindex="-1">${t('Purchase abandoned store','Verlassenen Laden kaufen')}</h2><p>${esc(plot.streetName)} · ${esc(typeName(plot.takeoverType))} · ${esc(sizeName(plot.size))}</p><p>${t('You receive a fresh store. Previous stock and cash return to the previous owner.','Du erhältst einen neuen Laden. Bisherige Waren und Kasseneinnahmen bleiben beim bisherigen Besitzer.')}</p><form class="town-purchase"><div class="town-buy-summary"><span>${t('Purchase price','Kaufpreis')}</span><strong>${justizEuro(cost)}</strong></div>${account?`<p>${capped?t('Your store limit is reached.','Dein Ladenlimit ist erreicht.'):locked?t(`Requires level ${plot.requiredLevel}.`,`Benötigt Level ${plot.requiredLevel}.`):account.tokens<cost?t('Not enough J€.','Nicht genug J€.'):t(`Balance after purchase: ${justizEuro(account.tokens-cost)}.`,`Guthaben nach dem Kauf: ${justizEuro(account.tokens-cost)}.`)}</p><button type="submit" class="primary-button" ${busy||capped||locked||account.tokens<cost?'disabled':''}>${busy?t('Purchasing…','Wird gekauft …'):t('Confirm purchase','Kauf bestätigen')}</button>`:`<a href="/login" data-page class="primary-button">${t('Sign in to purchase','Zum Kaufen anmelden')}</a>`}<p class="account-error" role="alert"></p></form></div>`;
  }
  function paintPurchase(){const expanded=dialog.querySelector('.town-location-details')?.open;dialog.innerHTML=purchaseMarkup();if(expanded&&dialog.querySelector('details'))dialog.querySelector('details').open=true;}
  function openPurchase(id,button=null){const plot=data.plots.find(plot=>plot.id===id);if(!plot||plot.occupied&&!plot.abandoned||plot.business?.own)return;selected=id;purchaseStep=plot.abandoned?2:1;takeoverRequestId=crypto.randomUUID();returnFocus=button;paintPurchase();if(!dialog.open)dialog.showModal();dialog.querySelector('h2')?.focus({preventScroll:true});}
  dialog.addEventListener('close',()=>{if(currentAccountPage!=='/town')return;(returnFocus?.isConnected?returnFocus:accountContent.querySelector('[data-town-open]'))?.focus({preventScroll:true});returnFocus=null;});
  document.addEventListener('click', event => {
    if (currentAccountPage !== '/town' || !data) return;
    const b=event.target.closest('button'); if(!b)return;
    if(b.hasAttribute('data-town-close')){dialog.close();return;}
    if(busy)return;
    if(b.hasAttribute('data-town-review')){purchaseStep=2;paintPurchase();dialog.querySelector('h2')?.focus();return;}
    if(b.hasAttribute('data-town-back')){purchaseStep=1;paintPurchase();dialog.querySelector('legend')?.setAttribute('tabindex','-1');dialog.querySelector('legend')?.focus();return;}
    if(b.dataset.townOpen)openPurchase(b.dataset.townOpen,b);
  });
  document.addEventListener('change',event=>{
    if(currentAccountPage!=='/town'||!data||busy||!event.target.matches('.town-purchase [name="type"]'))return;
    storeType=event.target.value;paintPurchase();dialog.querySelector(`[value="${storeType}"]`)?.focus();
  });
  document.addEventListener('submit',async event=>{if(currentAccountPage!=='/town'||!event.target.matches('.town-purchase'))return;event.preventDefault();if(busy||!account||purchaseStep!==2)return;const plot=data.plots.find(p=>p.id===selected);if(!plot||plot.occupied&&!plot.abandoned)return;const visit=accountVisit,owner=account.id;busy=true;paintPurchase();try{const result=await accountApi(plot.abandoned?'businesses/takeover':'businesses/buy',plot.abandoned?{shopId:plot.business?.id||plot.abandonedBusinessId,expectedPrice:plot.takeoverPrice,requestId:takeoverRequestId}:{plotId:plot.id,type:storeType});if(visit!==accountVisit||owner!==account?.id)return;updateAccount(result.user);await navigateAccountPage('/businesses');showToast(t('Store opened. Add stock to start trading.','Laden eröffnet. Räume Waren ein, um loszulegen.'));}catch(error){if(visit===accountVisit&&owner===account?.id){await refresh(visit,false).catch(()=>{});busy=false;if(!purchaseMarkup()){dialog.close();render();showToast(error.message);}else{paintPurchase();dialog.querySelector('.account-error').textContent=error.message;}}}finally{if(visit===accountVisit)busy=false;}});
  document.addEventListener('jg:language',()=>{if(currentAccountPage==='/town'&&dialog.open)paintPurchase();});
  return {load,stop,render};
})();
