window.businessUi = (() => {
  const esc = accountEscape;
  let dashboard = null, timer = null, request = 0, busy = false;
  let collectionJob = null;
  const collectionRequests = new Map(), cashMessages = new Map();
  function pendingCollection(shopId) {
    if(!account)return null;
    const key=`jg:store-cash:${account.id}:${shopId}`;
    try{return collectionRequests.get(key)||localStorage.getItem(key);}catch{return collectionRequests.get(key)||null;}
  }
  function collectCashMarkup(shop) {
    const collecting=collectionJob?.shopId===shop.id,amount=shop.cashReady||0,pending=pendingCollection(shop.id);
    const message=cashMessages.get(shop.id);
    return `<div class="business-cash"><button type="button" class="business-cash-button${collecting?' is-collecting':''}" data-business="collect-cash" data-shop="${esc(shop.id)}" ${busy||(!amount&&!pending)?'disabled':''} aria-label="${esc(t('Collect cash','Kasse einsammeln'))}: ${esc(shop.name||typeName(shop.type))} · ${esc(justizEuro(amount))}"><svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="m18 8 6 3 6-3-4 10c10 5 14 12 13 18-1 6-7 8-15 8S10 42 9 36c-1-6 3-13 13-18L18 8Z" fill="currentColor" opacity=".2"/><path d="m18 8 6 3 6-3-4 10c10 5 14 12 13 18-1 6-7 8-15 8S10 42 9 36c-1-6 3-13 13-18L18 8Zm1 11h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><text x="24" y="36" text-anchor="middle" font-size="16" font-weight="700" fill="currentColor">€</text></svg><span class="business-cash-copy"><span>${collecting?t('Collecting…','Wird eingesammelt …'):pending?t('Retry collection','Erneut einsammeln'):amount?t('Collect cash','Kasse einsammeln'):t('Register empty','Kasse leer')}</span><strong>${justizEuro(amount)}</strong></span></button><small class="business-cash-status" role="status" aria-live="polite">${message?t(`Collected ${justizEuro(message)}!`,`${justizEuro(message)} eingesammelt!`):infoTip(t('Earnings stay here until you collect.','Einnahmen bleiben hier, bis du sie einsammelst.'),t('About store cash','Über die Ladenkasse'))}</small></div>`;
  }
  async function cashCelebration(button,amount,job) {
    if(!amount||!button?.isConnected||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const origin=button.getBoundingClientRect(),target=accountContent.querySelector('.business-hero-account strong')?.getBoundingClientRect();
    const layer=document.createElement('div');layer.className='business-cash-celebration';layer.setAttribute('aria-hidden','true');job.layer=layer;
    const x=origin.left+origin.width/2,y=origin.top+origin.height/2;
    layer.style.left=`${x}px`;layer.style.top=`${y}px`;
    layer.innerHTML=`<span class="business-cash-reward">+${esc(justizEuro(amount))}</span>${Array.from({length:12},()=>'<span class="business-cash-coin">€</span>').join('')}`;
    document.body.append(layer);
    const visibleTarget=target&&target.top>=0&&target.bottom<=innerHeight;
    const dx=visibleTarget?target.left+target.width/2-x:0,dy=visibleTarget?target.top+target.height/2-y:-100;
    job.animations=[layer.querySelector('.business-cash-reward').animate([{opacity:0,transform:'translate(-50%,0) scale(.7)'},{opacity:1,offset:.2,transform:'translate(-50%,-30px) scale(1.1)'},{opacity:0,transform:'translate(-50%,-100px) scale(1)'}],{duration:1250,easing:'ease-out'})];
    for(const [i,coin] of [...layer.querySelectorAll('.business-cash-coin')].entries()){
      const spread=(i-5.5)*12;
      job.animations.push(coin.animate([{opacity:0,transform:'translate(-50%,-50%) scale(.4)'},{opacity:1,offset:.3,transform:`translate(${spread}px,${-55-i%3*12}px) rotate(${i*40}deg) scale(1)`},{opacity:0,transform:`translate(${dx}px,${dy}px) rotate(${i*90+360}deg) scale(.3)`}],{duration:900+i*25,delay:i*12,easing:'cubic-bezier(.2,.7,.3,1)'}));
    }
    await Promise.all(job.animations.map(animation=>animation.finished.catch(()=>{})));layer.remove();
  }
  async function collectCash(button) {
    const shop=ownedShop(button.dataset.shop);if(busy||!account||!shop||(!shop.cashReady&&!pendingCollection(shop.id)))return;
    const job={shopId:shop.id,owner:account.id,visit:accountVisit,animations:[]};collectionJob=job;busy=true;
    const key=`jg:store-cash:${job.owner}:${shop.id}`;let requestId=collectionRequests.get(key);
    try{requestId=requestId||localStorage.getItem(key);}catch{}
    requestId=requestId||crypto.randomUUID();collectionRequests.set(key,requestId);try{localStorage.setItem(key,requestId);}catch{}
    render();
    const current=()=>collectionJob===job&&job.owner===account?.id&&job.visit===accountVisit;
    try{
      const result=await accountApi('businesses/collect',{shopId:shop.id,requestId});
      collectionRequests.delete(key);try{localStorage.removeItem(key);}catch{}
      if(!current())return;
      updateAccount(result.user);cashMessages.set(shop.id,result.collection.amount);
      const localShop=ownedShop(shop.id);if(localShop)localShop.cashReady=result.cashReady;
      const control=accountContent.querySelector(`[data-business="collect-cash"][data-shop="${CSS.escape(shop.id)}"]`);
      await cashCelebration(control,result.collection.amount,job);
      // Payment is confirmed even if the follow-up statistics refresh fails.
      if(current())await refresh(job.visit,false).catch(()=>{});
    }catch(error){
      if(error.code){collectionRequests.delete(key);try{localStorage.removeItem(key);}catch{}}
      if(current())showToast(error.message);
    }finally{
      job.layer?.remove();
      if(current()){
        collectionJob=null;busy=false;render();
        // Empty tills remain focusable through their status after collection.
        const status=accountContent.querySelector(`[data-business="collect-cash"][data-shop="${CSS.escape(shop.id)}"]`)?.closest('.business-cash')?.querySelector('.business-cash-status');
        if(status){status.tabIndex=-1;status.focus({preventScroll:true});}
      }
    }
  }
  let restockReturnFocus = null, restockShopId = null, restockGroups = [], restockSignature = null;
  let editorShopId = null, editorReturnFocus = null, quickJob = null;
  const quickDialog = document.createElement('dialog');
  quickDialog.className = 'business-quick-dialog'; quickDialog.setAttribute('aria-labelledby', 'quick-restock-title'); document.body.append(quickDialog);
  const businessSurface = () => ['/businesses', '/stores'].includes(currentAccountPage);
  const ownedShop = id => dashboard?.shops.find(shop => shop.id === id);
  function quickRestockMarkup(id) {
    const shop = ownedShop(id); if (!shop) return '';
    const space = Math.max(0, shop.capacity - shop.stock.length), available = dashboard.inventory.filter(item => item.type === shop.type).length;
    const label = !space ? t('Shelves full', 'Regale voll') : !available ? t('No matching inventory', 'Keine passenden Waren') : t('Quick restock', 'Schnell auffüllen');
    return `<button class="business-quick-button" type="button" data-business="quick-restock" data-shop="${esc(id)}" ${!space || !available || quickJob ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m13 2-8 12h6l-1 8 9-12h-6l1-8Z"/></svg>${label}</button>`;
  }
  function focusRestockControl(id) {
    const selector = `[data-shop="${CSS.escape(id)}"]`;
    const button = accountContent.querySelector(`[data-business="quick-restock"]${selector}:not(:disabled)`) || accountContent.querySelector(`[data-business="open-restock"]${selector}`) || accountContent.querySelector(`[data-business="open-edit"]${selector}`) || accountContent.querySelector(`a[href="/stores?shop=${encodeURIComponent(id)}"]`);
    button?.focus({preventScroll:true});
  }
  function cancelQuickRestock(repaint = true) {
    if (!quickJob || quickJob.phase === 'saving') return;
    const job = quickJob; job.cancelled = true; clearInterval(job.interval); clearTimeout(job.timeout); job.resolve?.(false);
    quickJob = null; busy = false; quickDialog.close();
    if (repaint && job.visit === accountVisit) { render(); focusRestockControl(job.shopId); }
  }
  function paintQuickProgress(job) {
    if (quickJob !== job || !quickDialog.open) return;
    const fraction = Math.min(.95, (performance.now() - job.started) / job.duration);
    const progress = quickDialog.querySelector('progress'); progress.value = Math.round(fraction * 100);
    quickDialog.querySelector('[data-quick-percent]').textContent = `${progress.value}%`;
    quickDialog.querySelector('[data-quick-stage]').textContent = job.phase === 'saving' ? t('Saving stock…', 'Waren werden gespeichert …') : t('Preparing stock…', 'Waren werden vorbereitet …');
  }
  async function quickRestock(button) {
    if (busy || quickJob || !account || !ownedShop(button.dataset.shop)) return;
    const job = { shopId: button.dataset.shop, owner: account.id, visit: accountVisit, phase: 'preparing', cancelled: false, duration: 6500 };
    quickJob = job; busy = true;
    try {
      await refresh(job.visit, false);
      if (job.cancelled || quickJob !== job || job.visit !== accountVisit || job.owner !== account?.id) return;
      const shop = ownedShop(job.shopId), available = dashboard.inventory.filter(item => item.type === shop?.type).length;
      if (!shop || shop.stock.length >= shop.capacity || !available) throw new Error(!available ? t('No compatible items in your inventory. Find stock in the Auction House.', 'Keine passenden Artikel in deinem Inventar. Finde Waren im Auktionshaus.') : t('These shelves are already full.', 'Diese Regale sind bereits voll.'));
      job.started = performance.now(); job.phase = 'packing';
      quickDialog.innerHTML = `<div class="business-quick-content"><span class="quick-restock-emblem" aria-hidden="true">↻</span><p class="eyebrow">${esc(shop.name || typeName(shop.type))}</p><h2 id="quick-restock-title">${t('Restocking', 'Wird aufgefüllt')}</h2><div class="quick-restock-status"><span data-quick-stage role="status" aria-live="polite"></span><strong data-quick-percent>0%</strong></div><progress max="100" value="0" aria-label="${t('Restock progress', 'Fortschritt beim Auffüllen')}"></progress><button class="secondary-button" type="button" data-business="cancel-quick">${t('Cancel', 'Abbrechen')}</button></div>`;
      quickDialog.showModal(); quickDialog.querySelector('button').focus(); paintQuickProgress(job);
      const ready = await new Promise(resolve => { job.resolve = resolve; job.interval = setInterval(() => paintQuickProgress(job), 100); job.timeout = setTimeout(() => resolve(true), job.duration); });
      clearInterval(job.interval); clearTimeout(job.timeout);
      if (!ready || job.cancelled || quickJob !== job || job.visit !== accountVisit || job.owner !== account?.id) return;
      // Re-read at completion: shelf capacity and unlocked inventory may have
      // changed in another tab while the presentation was running.
      job.phase = 'saving'; quickDialog.querySelector('button').disabled = true; paintQuickProgress(job);
      await refresh(job.visit, false);
      if (quickJob !== job || job.visit !== accountVisit || job.owner !== account?.id) return;
      const current = ownedShop(job.shopId);
      if (!current) throw new Error(accountError('business_not_found'));
      const groups = groupedRestockItems(dashboard.inventory.filter(item => item.type === current.type));
      const counts = autoRestockCounts(groups, current.stock.map(entry => entry.item.title), Math.max(0, current.capacity - current.stock.length));
      const inventoryIds = groups.flatMap((group, index) => group.items.slice(0, counts[index]).map(item => item.id));
      if (!inventoryIds.length) throw new Error(t('No free shelf space or compatible inventory remains.', 'Es sind keine freien Regalplätze oder passenden Waren mehr verfügbar.'));
      const result = await accountApi('businesses/stock', { shopId: job.shopId, inventoryIds });
      if (job.visit !== accountVisit || job.owner !== account?.id) return;
      if (result.user) updateAccount(result.user);
      dashboard.shops = dashboard.shops.map(shop => shop.id === job.shopId ? result.shop : shop);
      dashboard.inventory = dashboard.inventory.filter(item => !inventoryIds.includes(item.id));
      quickDialog.querySelector('progress').value = 100; quickDialog.querySelector('[data-quick-percent]').textContent = '100%';
      await refresh(job.visit, false);
      if (job.visit === accountVisit && job.owner === account?.id) showToast(t(`${inventoryIds.length} items added to your shelves.`, `${inventoryIds.length} Artikel in deine Regale eingeräumt.`));
    } catch (error) { if (job.visit === accountVisit && job.owner === account?.id) showToast(error.message); }
    finally {
      clearInterval(job.interval); clearTimeout(job.timeout);
      if (quickJob === job) { quickJob = null; busy = false; quickDialog.close(); if (job.visit === accountVisit) { render(); focusRestockControl(job.shopId); } }
    }
  }
  quickDialog.addEventListener('cancel', event => { event.preventDefault(); cancelQuickRestock(); });
  quickDialog.addEventListener('click', event => { if (event.target === quickDialog) cancelQuickRestock(); });
  const editorDialog = document.createElement('dialog');
  editorDialog.className = 'business-editor-dialog'; editorDialog.setAttribute('aria-labelledby', 'business-editor-title'); document.body.append(editorDialog);
  const restockDialog = document.createElement('dialog');
  restockDialog.className = 'business-buy-dialog business-restock-dialog';
  restockDialog.setAttribute('aria-labelledby', 'business-restock-title');
  document.body.append(restockDialog);
  const names = { wine: ['Wine store', 'Weinhandlung'], toys: ['Toy store', 'Spielwarenladen'],
    electronics: ['Electronics store', 'Elektronikladen'], cars: ['Car dealership', 'Autohaus'] };
  const sizeNames = { popup: ['Street pop-up', 'Strassenstand'], tiny: ['Small shop', 'Kleiner Laden'],
    medium: ['Medium shop', 'Mittlerer Laden'], large: ['Large shop', 'Grosser Laden'] };
  const typeName = id => names[id] ? t(...names[id]) : id;
  const sizeName = id => sizeNames[id] ? t(...sizeNames[id]) : id;
  const icon = (content, className) => `<svg class="${className}" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
  const typeIcons = {
    wine: '<path d="M27 5h9v7l3 5v22a4 4 0 0 1-4 4h-7a4 4 0 0 1-4-4V17l3-5V5Z M25 19h13 M8 7h12v8c0 6-2 9-6 9s-6-3-6-9V7Z M14 24v13 M8 41h12"/>',
    toys: '<rect x="5" y="18" width="18" height="21" rx="2"/><rect x="25" y="12" width="18" height="27" rx="2"/><path d="M9 18v-5h5v5m5 0v-5h4v5m7-6V7h5v5m4 0V7h4v5M5 39h38"/>',
    electronics: '<rect x="4" y="7" width="40" height="30" rx="3"/><path d="M17 43h14m-7-6v6M10 14h11v10H10z M27 16h10m-10 6h7m-7 6h10"/>',
    cars: '<path d="M7 25 11 13h26l4 12 M7 25h34a2 2 0 0 1 2 2v11H5V27a2 2 0 0 1 2-2Z M10 38v4h6v-4m16 0v4h6v-4M12 31h5m14 0h5M13 19h22"/>'
  };
  const sizeIcons = {
    popup: '<path d="M5 20h38l-4-9H9l-4 9Z M8 20v20h32V20 M17 20v20m14-20v20M5 27h38"/>',
    tiny: '<path d="M5 20h38l-4-10H9L5 20Z M8 20v22h32V20M13 28h10v7H13z M29 27h7v15h-7M5 20c4 5 8 5 12 0 4 5 10 5 14 0 4 5 8 5 12 0"/>',
    medium: '<path d="M4 19h40l-4-10H8L4 19Z M7 19v23h34V19M11 27h8v8h-8zm18 0h8v8h-8z M22 25h4v17M4 19c4 5 8 5 12 0 4 5 12 5 16 0 4 5 8 5 12 0"/>',
    large: '<path d="M5 43V8h38v35M4 43h40M11 14h7v7h-7zm15 0h7v7h-7zM11 27h7v7h-7zm15 0h7v7h-7zM20 43V30h4v13M5 8h38"/>'
  };
  const typeIcon = id => icon(typeIcons[id], 'business-type-icon');
  const sizeIcon = id => icon(sizeIcons[id], 'business-size-icon');
  async function refresh(visit, repaint = true) {
    const current = ++request, owner = account?.id;
    const shops = owner ? await accountApi('businesses') : null;
    if (current !== request || visit !== accountVisit || account?.id !== owner) return;
    dashboard = shops;
    if (owner) { const session = await accountApi('me'); if (current !== request || visit !== accountVisit || account?.id !== owner) return; updateAccount(session.user); }
    if (editorDialog.open) syncEditor();
    if (restockDialog.open) {
      if (stockManagerSignature() !== restockSignature) syncRestockDialog();
      else updateRestockSelection();
    }
    if (repaint && !busy && !restockDialog.open && !document.activeElement?.closest('[data-business-margin-form], [data-store-profile]')) render();
  }
  function stop() {
    if(collectionJob){collectionJob.animations.forEach(animation=>animation.cancel());collectionJob.layer?.remove();collectionJob=null;busy=false;}
    cashMessages.clear();
    if (quickJob) { quickJob.phase = 'cancelled'; cancelQuickRestock(false); }
    clearInterval(timer); timer = null; request++; dashboard = null;
    editorShopId = null; editorReturnFocus = null; editorDialog.close();
    restockReturnFocus = null; restockShopId = null; restockSignature = null; if (restockDialog.open) restockDialog.close();
  }
  async function load(visit) {
    if (account) await window.storeUi.loadEvents(visit);
    if (visit !== accountVisit) return;
    await refresh(visit, false);
    if (visit !== accountVisit) return;
    timer = setInterval(() => { if (!document.hidden && !busy) refresh(visit).catch(() => {}); }, 30_000);
  }
  const editIcon = () => icon('<path d="m8 32 23-23 8 8-23 23-11 3 3-11Z M27 13l8 8 M7 43h34"/>', 'business-action-icon');
  function storefrontArt(type) {
    return `<svg class="business-card-scene" viewBox="0 0 280 160" fill="none" aria-hidden="true"><circle cx="228" cy="30" r="15" fill="var(--choice-accent)" opacity=".12"/><path d="M14 144h252" stroke="var(--choice-accent)" opacity=".25"/><rect x="40" y="49" width="200" height="95" rx="3" fill="#fffaf0" stroke="var(--choice-accent)" stroke-width="2"/><rect x="48" y="27" width="184" height="27" rx="3" fill="var(--choice-accent)"/><text x="140" y="45" text-anchor="middle" fill="#fffaf0" font-size="10" font-family="Manrope, sans-serif" font-weight="700" letter-spacing="1">${esc(typeName(type).toUpperCase())}</text><path d="M36 54h208l-10 26H46L36 54Z" fill="var(--choice-accent)"/>${[0,1,2,3,4,5,6].map(n => `<path d="M${36+n*30} 54h15l${n < 3 ? 3 : -3} 26h-15Z" fill="#fffaf0" opacity=".85"/>`).join('')}<rect x="57" y="91" width="91" height="41" rx="2" fill="var(--choice-tint)" stroke="var(--choice-accent)" stroke-width="1.5"/><svg x="82" y="93" width="38" height="38" viewBox="0 0 48 48" stroke="var(--choice-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${typeIcons[type]}</svg><rect x="174" y="91" width="45" height="53" rx="2" fill="var(--choice-tint)" stroke="var(--choice-accent)" stroke-width="1.5"/><path d="M180 97h33v22h-33Z" fill="#fffaf0"/><circle cx="209" cy="130" r="2" fill="var(--choice-accent)"/><path d="M25 143v-15m-7 3 7-13 7 13" stroke="var(--choice-accent)" stroke-width="2" stroke-linecap="round"/><rect x="250" y="127" width="9" height="17" rx="1" fill="var(--choice-accent)" opacity=".45"/></svg>`;
  }
  function shopCard(shop) {
    const filled = Math.min(100, Math.round(shop.stock.length / shop.capacity * 100));
    return `<article class="business-shop business-type-${esc(shop.type)}"><div class="business-card-art"><div class="business-card-badges"><span>${esc(sizeName(shop.size))}</span><span class="business-card-state${!shop.stock.length ? ' is-empty' : ''}"><i aria-hidden="true"></i>${shop.stock.length ? t('Open for business', 'Laden geöffnet') : t('Needs stock', 'Waren fehlen')}</span></div>${storefrontArt(shop.type)}</div><div class="business-card-body"><p class="business-card-category">${esc(typeName(shop.type))}</p>${shop.location ? `<a class="business-card-address" href="/town?plot=${encodeURIComponent(shop.location.plotId)}" data-page>${shop.location.districtNumber}. ${esc(shop.location.districtName)} · ${esc(shop.location.streetName)} ↗</a>` : ''}<h2>${esc(shop.name || typeName(shop.type))}</h2>${shop.motto?`<p class="business-card-motto">${esc(shop.motto)}</p>`:''}${window.storeReputationUi?.meter(shop)||''}<dl class="business-card-stats"><div><dt>${t('Revenue today', 'Umsatz heute')}</dt><dd>${justizEuro(shop.revenueToday)}</dd></div><div><dt>${t('Sales today', 'Verkäufe heute')}</dt><dd>${number(shop.salesToday)}</dd></div></dl><div class="business-card-stock"><div><span>${t('On the shelves', 'In den Regalen')}</span><strong>${number(shop.stock.length)} <span>/ ${number(shop.capacity)}</span></strong></div><progress value="${shop.stock.length}" max="${shop.capacity}" aria-label="${esc(t('Shelf capacity used', 'Belegte Regalplätze'))}">${filled}%</progress></div><div class="business-card-details"><span>${number(shop.profitMargin)}% ${t('markup', 'Aufschlag')}</span>${shop.gooseGuard ? `<span>${t('Goose protected', 'Wachgans im Dienst')}</span>` : `<span>${number(shop.visitors)} ${t('visitors', 'Besucher')}</span>`}</div>${collectCashMarkup(shop)}${quickRestockMarkup(shop.id)}<div class="business-card-actions"><button class="business-edit-button" type="button" data-business="open-edit" data-shop="${esc(shop.id)}" aria-label="${esc(t('Edit store', 'Laden bearbeiten'))}: ${esc(shop.name || typeName(shop.type))}">${editIcon()}${t('Edit store', 'Laden bearbeiten')}</button><a href="/stores?shop=${encodeURIComponent(shop.id)}" data-page>${t('Open store', 'Laden öffnen')} <span aria-hidden="true">→</span></a></div></div></article>`;
  }
  function shopsView() {
    if (!account) return `<section class="business-guest"><h1 tabindex="-1">${t('Your stores', 'Deine Läden')}</h1><a class="primary-button" href="/login" data-page>${t('Sign in', 'Anmelden')}</a></section>`;
    const shops = dashboard?.shops || [], max = dashboard?.maxStores || 3, canBuy = shops.length < max;
    const total = key => shops.reduce((sum, shop) => sum + shop[key], 0);
    return `<div class="business-portfolio"><header class="business-hero"><div><h1 tabindex="-1">${t('Your stores', 'Deine Läden')}</h1><a href="/town" data-page>${t('Town map', 'Stadtplan')} <span aria-hidden="true">↗</span></a></div><div class="business-hero-account"><span class="business-location-count">${shops.length} / ${max} ${t('locations', 'Standorte')}</span><div class="business-location-dots" aria-hidden="true">${Array.from({length:max},(_,n)=>`<span class="${n < shops.length ? 'is-owned' : ''}">${String(n+1).padStart(2,'0')}</span>`).join('')}</div><small>${t('Balance', 'Guthaben')}</small><strong>${justizEuro(account.tokens)}</strong></div></header><dl class="business-portfolio-stats"><div><dt>${t('Revenue today', 'Umsatz heute')}</dt><dd>${justizEuro(total('revenueToday'))}</dd></div><div><dt>${t('Items on shelves', 'Artikel im Regal')}</dt><dd>${number(shops.reduce((sum, shop) => sum + shop.stock.length, 0))}</dd></div><div><dt>${t('Sales today', 'Verkäufe heute')}</dt><dd>${number(total('salesToday'))}</dd></div></dl><section class="business-owned"><div class="business-portfolio-heading"><div><h2>${t('Stores', 'Läden')}</h2></div><button class="business-new-button" type="button" data-business="open-buy" ${canBuy ? '' : 'disabled'}><span aria-hidden="true">＋</span>${canBuy ? t('Open a store', 'Laden eröffnen') : t('All locations filled', 'Alle Standorte belegt')}</button></div><div class="business-shop-grid">${shops.map(shopCard).join('')}${canBuy ? `<button class="business-add-card" type="button" data-business="open-buy"><span class="business-add-icon" aria-hidden="true">＋</span><strong>${t('Open a store','Laden eröffnen')}</strong></button>` : ''}</div></section></div>`;
  }
  function shelfGroups(stock) {
    const groups = new Map();
    for (const entry of stock) {
      const key = JSON.stringify([entry.item.title, entry.item.image || null, entry.askingPrice, entry.referencePrice]);
      if (!groups.has(key)) groups.set(key, { ...entry, quantity: 0 });
      groups.get(key).quantity++;
    }
    return [...groups.values()];
  }
  function ownerView(store) {
    const shop = ownedShop(store.id); if (!shop) return pageHeading(t('Loading your store…', 'Dein Laden wird geladen …'));
    const available = dashboard.inventory.filter(item => item.type === shop.type).length, space = Math.max(0, shop.capacity - shop.stock.length);
    return `<div class="store-owner-page business-type-${esc(shop.type)}"><a class="store-owner-back" href="/businesses" data-page>← ${t('Your stores', 'Deine Läden')}</a>
      <header class="store-owner-hero"><div class="store-owner-identity"><p class="eyebrow">${esc(typeName(shop.type))}</p><h1 tabindex="-1">${esc(shop.name || typeName(shop.type))}</h1>${shop.motto ? `<p class="store-owner-motto">${esc(shop.motto)}</p>` : ''}${window.storeReputationUi?.meter(shop)||''}<div class="store-owner-meta"><span>${esc(sizeName(shop.size))}</span><span>${store.rating === null ? t('No reviews yet', 'Noch keine Bewertungen') : `★ ${number(store.rating, 1)} / 5`}</span>${shop.gooseGuard ? `<span>${t('Goose guard active', 'Wachgans aktiv')}</span>` : ''}</div>${shop.location ? `<a class="store-owner-address" href="/town?plot=${encodeURIComponent(shop.location.plotId)}" data-page>${shop.location.districtNumber}. ${esc(shop.location.districtName)} · ${esc(shop.location.streetName)} ↗</a>` : ''}</div><div class="store-owner-art" aria-hidden="true">${storefrontArt(shop.type)}</div></header>
      <div class="store-owner-actions">${quickRestockMarkup(shop.id)}<button class="secondary-button" type="button" data-business="open-restock" data-shop="${esc(shop.id)}">${t('Manage stock', 'Warenbestand verwalten')}</button><button class="secondary-button" type="button" data-business="open-edit" data-shop="${esc(shop.id)}">${editIcon()}${t('Store settings', 'Ladeneinstellungen')}</button></div>
      <dl class="store-owner-stats"><div><dt>${t('Revenue today', 'Umsatz heute')}</dt><dd>${justizEuro(shop.revenueToday)}</dd></div><div><dt>${t('Sales today', 'Verkäufe heute')}</dt><dd>${number(shop.salesToday)}</dd></div><div><dt>${t('Markup', 'Aufschlag')}</dt><dd>${number(shop.profitMargin)}%</dd></div><div><dt>${t('Free shelf spaces', 'Freie Regalplätze')}</dt><dd>${number(space)} <small>/ ${number(shop.capacity)}</small></dd></div></dl>
      <div class="store-owner-workspace"><section class="store-owner-shelves" aria-labelledby="owner-shelves-title"><div class="store-owner-section-heading"><div><h2 id="owner-shelves-title">${t('On the shelves', 'In den Regalen')}</h2></div><span>${number(shop.stock.length)} / ${number(shop.capacity)}</span></div>
        ${shop.stock.length ? `<ul class="store-owner-stock-list">${shelfGroups(shop.stock).map(entry => `<li><div class="store-owner-item-art">${entry.item.image ? `<img src="${esc(entry.item.image)}" alt="" loading="lazy">` : typeIcon(shop.type)}</div><div class="store-owner-item-copy"><strong>${esc(entry.item.title)}${entry.quantity > 1 ? `<span class="store-owner-quantity">×${number(entry.quantity)}</span>` : ''}</strong><small>${t('Market estimate', 'Marktschätzung')} ${justizEuro(entry.referencePrice)}</small></div><div class="store-owner-item-price"><small>${t('Shelf price', 'Regalpreis')}</small><strong>${justizEuro(entry.askingPrice)}</strong></div><button class="store-owner-remove" type="button" data-business="unstock" data-shop="${esc(shop.id)}" data-item="${esc(entry.id)}" aria-label="${esc(t('Return to inventory', 'Zurück ins Inventar'))}: ${esc(entry.item.title)}">${entry.quantity > 1 ? t('Remove one', 'Einen entfernen') : t('Remove', 'Entfernen')}</button></li>`).join('')}</ul>` : `<div class="store-owner-empty">${typeIcon(shop.type)}<h3>${t('No stock', 'Keine Waren')}</h3></div>`}</section>
      <aside class="store-owner-supply"><div class="section-title-row"><h2>${t('Restock', 'Auffüllen')}</h2>${infoTip(t('Quick restock fills free shelf spaces with matching inventory at no cost.', 'Schnell auffüllen belegt freie Regalplätze mit passenden Artikeln aus deinem Inventar, ohne Kosten.'),t('How restocking works', 'So funktioniert Auffüllen'))}</div><div class="store-owner-capacity"><span>${t('Shelf space used', 'Belegte Regalplätze')}</span><strong>${number(shop.stock.length)} / ${number(shop.capacity)}</strong><progress value="${shop.stock.length}" max="${shop.capacity}" aria-label="${t('Shelf capacity used', 'Belegte Regalplätze')}"></progress></div><dl><div><dt>${t('Matching inventory', 'Passende Waren im Inventar')}</dt><dd>${number(available)}</dd></div><div><dt>${t('Ready to restock', 'Zum Auffüllen bereit')}</dt><dd>${number(Math.min(space, available))}</dd></div></dl><a href="/auction-house?stock=${encodeURIComponent(shop.type)}" data-page>${t('Find compatible stock', 'Passende Waren finden')} <span aria-hidden="true">↗</span></a></aside></div></div>`;
  }
  function renderEditor(draft = null) {
    const shop = dashboard?.shops.find(entry => entry.id === editorShopId); if (!shop) return;
    editorDialog.innerHTML = `<header class="business-editor-header"><span class="business-editor-icon business-type-${esc(shop.type)}">${typeIcon(shop.type)}</span><div><p class="eyebrow">${esc(typeName(shop.type))} · ${esc(sizeName(shop.size))}</p><h2 id="business-editor-title" data-editor-title>${esc(shop.name || typeName(shop.type))}</h2></div><button class="dialog-close" type="button" data-business="close-edit" aria-label="${t('Close', 'Schließen')}">×</button></header><div class="business-editor-content"><div><section class="business-editor-section"><h3>${t('Store details', 'Ladendetails')}</h3><form class="store-profile-form" data-store-profile data-shop="${esc(shop.id)}"><label>${t('Store name', 'Ladenname')}<input name="storeName" maxlength="60" value="${esc(draft?.name ?? shop.name ?? '')}" placeholder="${esc(typeName(shop.type))}"></label><label>${t('Tagline', 'Ladenspruch')}<input name="motto" maxlength="140" value="${esc(draft?.motto ?? shop.motto ?? '')}"></label><label class="store-guard-choice"><input name="gooseGuard" type="checkbox" ${shop.gooseGuard || draft?.guard ? 'checked' : ''} ${shop.gooseGuard ? 'disabled' : ''}><span data-editor-guard>${shop.gooseGuard ? t('Goose guard active', 'Wachgans aktiv') : t('Hire a goose guard · J€250 once · doubles the theft fine', 'Wachgans einstellen · einmalig J€250 · verdoppelt das Diebstahlbußgeld')}</span></label><button type="submit" class="business-edit-button">${t('Save storefront', 'Ladenauftritt speichern')}</button><p class="account-error" role="alert"></p></form></section><section class="business-editor-section"><div class="section-title-row"><h3>${t('Pricing', 'Preise')}</h3>${infoTip(t('Higher markups and expensive items reduce turnover. Markup is not your profit.', 'Höhere Aufschläge und teure Waren senken den Absatz. Aufschlag ist nicht dein Gewinn.'),t('About markup', 'Über den Aufschlag'))}</div><form class="business-margin" data-business-margin-form data-shop="${esc(shop.id)}"><label>${t('Markup over market estimate', 'Aufschlag auf Marktschätzung')}<span><input name="profitMargin" type="number" min="0" max="100" step="1" value="${draft?.margin ?? shop.profitMargin}" inputmode="numeric" required> %</span></label><button class="secondary-button" type="submit">${t('Save markup', 'Aufschlag speichern')}</button><p class="account-error" role="alert"></p></form></section></div><div><section class="business-editor-section business-editor-shelves"><span class="business-editor-shelf-art business-type-${esc(shop.type)}">${storefrontArt(shop.type)}</span><h3>${t('Stock', 'Warenbestand')}</h3><p data-editor-stock></p><button class="business-edit-button" type="button" data-business="open-restock" data-shop="${esc(shop.id)}">${t('Manage stock', 'Warenbestand verwalten')} <span aria-hidden="true">→</span></button><a href="/auction-house?stock=${encodeURIComponent(shop.type)}" data-page>${t('Find compatible stock', 'Passende Waren finden')} ↗</a></section><section class="business-editor-section"><h3>${t('Store statistics', 'Ladenstatistik')}</h3>${shop.location ? `<p>${shop.location.districtNumber}. ${esc(shop.location.districtName)} · ${esc(shop.location.streetName)}<br>${number(shop.location.trafficMultiplier,2)}× ${t('foot traffic','Laufkundschaft')} · ${number(Math.max(1,1/shop.location.theftMultiplier),2)}× ${t('theft fine','Diebstahlbußgeld')}</p><a href="/town?plot=${encodeURIComponent(shop.location.plotId)}" data-page>${t('View on town map','Auf dem Stadtplan ansehen')} ↗</a>` : ''}<dl class="business-editor-stats" data-editor-stats></dl></section></div></div>`;
    syncEditor();
  }
  function syncEditor() {
    const shop = dashboard?.shops.find(entry => entry.id === editorShopId);
    if (!shop) { if (editorDialog.open) editorDialog.close(); return; }
    editorDialog.querySelector('[data-editor-title]').textContent = shop.name || typeName(shop.type);
    const available = dashboard.inventory.filter(item => item.type === shop.type).length;
    editorDialog.querySelector('[data-editor-stock]').textContent = `${shop.stock.length} / ${shop.capacity} ${t('on shelves', 'im Regal')} · ${available} ${t('ready to add', 'zum Einräumen bereit')}`;
    const metrics = [[t('Total revenue','Umsatz gesamt'),justizEuro(shop.revenue)],[t('Realized trading profit','Realisierter Handelsgewinn'),justizEuro(shop.realizedTradingProfit)],[t('Reward proceeds','Belohnungserlöse'),justizEuro(shop.rewardProceeds)],[t('Sales with unknown cost','Verkäufe mit unbekannten Kosten'),number(shop.unknownCostSales)],[t('Total sales','Verkäufe gesamt'),number(shop.sales)],[t('Visitors','Besucher'),number(shop.visitors)],[t('Popularity','Beliebtheit'),`${number(shop.popularityPercent)}%`],[t('Buying rate','Kaufrate'),`${number(shop.buyChancePercent,1)}%`],[t('Markup over estimate','Aufschlag auf Schätzung'),`${shop.profitMargin}%`]];
    editorDialog.querySelector('[data-editor-stats]').innerHTML = metrics.map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
    if (shop.gooseGuard) {
      const guard = editorDialog.querySelector('[name="gooseGuard"]'); guard.checked = true; guard.disabled = true;
      editorDialog.querySelector('[data-editor-guard]').textContent = t('Goose guard active', 'Wachgans aktiv');
    }
  }
  function openEditor(button) {
    if (!dashboard?.shops.some(shop => shop.id === button.dataset.shop)) return;
    editorShopId = button.dataset.shop; editorReturnFocus = button; renderEditor(); editorDialog.showModal();
    editorDialog.querySelector('.dialog-close').focus({preventScroll:true});
  }
  editorDialog.addEventListener('close', () => {
    const id = editorShopId; editorShopId = null;
    const replacement = id ? accountContent.querySelector(`[data-business="open-edit"][data-shop="${CSS.escape(id)}"]`) : null;
    (replacement || (editorReturnFocus?.isConnected ? editorReturnFocus : null))?.focus({preventScroll:true}); editorReturnFocus = null;
  });
  editorDialog.addEventListener('click', event => { if (event.target === editorDialog) editorDialog.close(); });
  function openTownMap() { if (account && dashboard) navigateAccountPage('/town'); }
  function groupedRestockItems(items) {
    const groups = new Map();
    for (const item of items) {
      const key = JSON.stringify([item.title, item.price]);
      if (!groups.has(key)) groups.set(key, { title: item.title, price: item.price, items: [] });
      groups.get(key).items.push(item);
    }
    return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title) || a.price - b.price);
  }
  function autoRestockCounts(groups, shelfTitles, space) {
    const counts = groups.map(() => 0), seen = new Set(shelfTitles);
    let left = space;
    // First choose a unit of each title absent from the shelf. Then distribute
    // remaining room round-robin so one large stack cannot crowd out variety.
    groups.forEach((group, index) => {
      if (left && !seen.has(group.title)) { counts[index]++; seen.add(group.title); left--; }
    });
    while (left) {
      let added = false;
      groups.forEach((group, index) => {
        if (left && counts[index] < group.items.length) { counts[index]++; left--; added = true; }
      });
      if (!added) break;
    }
    return counts;
  }
  function updateRestockSelection(changed = null) {
    const shop = dashboard?.shops.find(entry => entry.id === restockShopId);
    if (!shop) return;
    const space = Math.max(0, shop.capacity - shop.stock.length);
    const inputs = [...restockDialog.querySelectorAll('input[name="quantity"]')];
    const values = inputs.map((input, index) => Math.max(0, Math.min(restockGroups[index].items.length, Math.floor(Number(input.value) || 0))));
    if (changed) {
      const index = inputs.indexOf(changed);
      if (index >= 0) values[index] = Math.min(values[index], Math.max(0, space - values.reduce((sum, value, at) => sum + (at === index ? 0 : value), 0)));
    }
    inputs.forEach((input, index) => {
      input.value = values[index];
      input.max = Math.max(values[index], Math.min(restockGroups[index].items.length,
        space - values.reduce((sum, value, at) => sum + (at === index ? 0 : value), 0)));
    });
    const selected = values.reduce((sum, value) => sum + value, 0);
    restockDialog.querySelector('[data-restock-summary]').textContent =
      `${selected} / ${space} ${t('spaces selected', 'Plätze ausgewählt')}`;
    restockDialog.querySelector('button[type="submit"]').disabled = busy || selected < 1 || selected > space;
  }
  function stockManagerSignature() {
    const shop = dashboard?.shops.find(entry => entry.id === restockShopId);
    return JSON.stringify([shop?.stock.map(entry => entry.id),
      dashboard?.inventory.filter(item => item.type === shop?.type).map(item => item.id)]);
  }
  function syncRestockDialog() {
    const selected = new Map(restockGroups.map((group, index) => [JSON.stringify([group.title, group.price]),
      Number(restockDialog.querySelectorAll('input[name="quantity"]')[index]?.value) || 0]));
    const shop = dashboard?.shops.find(entry => entry.id === restockShopId);
    if (!shop) { restockDialog.close(); return; }
    restockGroups = groupedRestockItems(dashboard.inventory.filter(item => item.type === shop.type));
    renderRestockDialog(restockGroups.map(group => selected.get(JSON.stringify([group.title, group.price])) || 0));
    restockSignature = stockManagerSignature();
  }
  function renderRestockDialog(quantities = []) {
    const shop = dashboard?.shops.find(entry => entry.id === restockShopId);
    if (!shop) return;
    const space = shop.capacity - shop.stock.length;
    restockDialog.innerHTML = `<form id="business-restock-form"><header class="business-dialog-header"><div><h2 id="business-restock-title">${t('Manage stock', 'Warenbestand verwalten')} · ${esc(typeName(shop.type))}</h2><small>${shop.stock.length} / ${shop.capacity} ${t('on shelves', 'im Regal')}</small></div><button class="dialog-close" type="button" data-business="close-restock" aria-label="${t('Close', 'Schließen')}">×</button></header>
      <div class="business-dialog-options business-stock-manager"><section class="business-stock-panel" aria-labelledby="business-available-title"><div class="business-stock-panel-heading"><div><h3 id="business-available-title">${t('Inventory', 'Inventar')}</h3><small>${restockGroups.reduce((sum, group) => sum + group.items.length, 0)} ${t('items', 'Artikel')} · ${space} ${t('spaces free', 'Plätze frei')}</small></div><button class="secondary-button" type="button" data-business="auto-restock" ${space && restockGroups.length ? '' : 'disabled'}>${t('Auto fill', 'Automatisch füllen')}</button></div>
        ${restockGroups.length ? `<div class="business-restock-list">${restockGroups.map((group, index) => `<label class="business-restock-row"><span><strong>${esc(group.title)}</strong><small>${group.items.length} ${t('available', 'verfügbar')} · ${justizEuro(Math.round(group.price))} ${t('each', 'pro Stück')}</small></span><input type="number" name="quantity" data-index="${index}" min="0" max="${Math.min(space, group.items.length)}" step="1" value="${quantities[index] || 0}" inputmode="numeric" aria-label="${esc(group.title)} ${t('quantity to add', 'Anzahl zum Einräumen')}"></label>`).join('')}</div>` : `<p class="business-panel-empty">${t('No matching inventory is available.', 'Keine passenden Artikel im Inventar verfügbar.')} <a href="/auction-house?stock=${encodeURIComponent(shop.type)}" data-page>${t('Bid on stock palettes', 'Auf Warenpaletten bieten')}</a></p>`}</section>
        <section class="business-stock-panel" aria-labelledby="business-shelves-title"><div class="business-stock-panel-heading"><div><h3 id="business-shelves-title">${t('On shelves', 'Im Regal')}</h3><small>${shop.stock.length} / ${shop.capacity} ${t('stocked', 'eingeräumt')}</small></div></div>
        ${shop.stock.length ? `<ul class="business-shelf-list">${shop.stock.map(entry => `<li><span><strong>${esc(entry.item.title)}</strong><small>${t('Acquisition cost','Anschaffungskosten')} ${entry.acquisitionCost==null?t('Cost unknown','Kosten unbekannt'):justizEuro(entry.acquisitionCost)} · ${t('Market', 'Markt')} ${justizEuro(entry.referencePrice)} · ${t('Shelf', 'Regal')} ${justizEuro(entry.askingPrice)}</small></span><button class="secondary-button" type="button" data-business="unstock" data-shop="${esc(shop.id)}" data-item="${esc(entry.id)}" aria-label="${esc(t('Remove from store', 'Aus Geschäft nehmen'))}: ${esc(entry.item.title)}">${t('Remove', 'Entfernen')}</button></li>`).join('')}</ul>` : `<p class="business-panel-empty">${t('No stock.', 'Keine Waren.')}</p>`}</section></div>
      <footer class="business-dialog-footer"><div><strong data-restock-summary></strong><p class="account-error" role="alert"></p></div><button class="primary-button" type="submit" disabled>${t('Add selected stock', 'Ausgewählte Artikel einräumen')}</button></footer></form>`;
    updateRestockSelection();
  }
  function openRestockDialog(button) {
    const shop = dashboard?.shops.find(entry => entry.id === button.dataset.shop);
    if (!shop || !account) return;
    restockShopId = shop.id; restockReturnFocus = button;
    restockGroups = groupedRestockItems(dashboard.inventory.filter(item => item.type === shop.type));
    renderRestockDialog();
    restockSignature = stockManagerSignature();
    restockDialog.showModal();
    (restockDialog.querySelector('input[name="quantity"]') || restockDialog.querySelector('.dialog-close'))?.focus({ preventScroll: true });
  }
  restockDialog.addEventListener('close', () => {
    const shopId = restockShopId;
    restockShopId = null; restockGroups = []; restockSignature = null;
    if (shopId && businessSurface()) render();
    const focus = editorDialog.open && restockReturnFocus?.isConnected ? restockReturnFocus : shopId ? accountContent.querySelector(`[data-business="open-restock"][data-shop="${CSS.escape(shopId)}"]`) : null;
    if (focus || restockReturnFocus?.isConnected) (focus || restockReturnFocus).focus({ preventScroll: true });
    restockReturnFocus = null;
  });
  restockDialog.addEventListener('click', event => { if (event.target === restockDialog) restockDialog.close(); });
  function render() {
    if (currentAccountPage === '/stores') { window.storeUi.render(); return; }
    if (currentAccountPage !== '/businesses') return;
    accountContent.innerHTML = economyOverviewMarkup() + traderMilestonesMarkup() + shopsView();
    if (editorDialog.open) syncEditor();
    window.storeUi.showEvents();
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-business]'); if (!button || !businessSurface()) return;
    if (button.dataset.business === 'cancel-quick') { cancelQuickRestock(); return; }
    if (button.dataset.business === 'quick-restock') { await quickRestock(button); return; }
    if (button.dataset.business === 'collect-cash') { await collectCash(button); return; }
    if (button.dataset.business === 'open-edit') { openEditor(button); return; }
    if (button.dataset.business === 'close-edit') { editorDialog.close(); return; }
    if (button.dataset.business === 'open-buy') { openTownMap(button); return; }
    if (button.dataset.business === 'open-restock') { openRestockDialog(button); return; }
    if (button.dataset.business === 'close-restock') { restockDialog.close(); return; }
    if (button.dataset.business === 'auto-restock') {
      const shop = dashboard?.shops.find(entry => entry.id === restockShopId);
      if (!shop) return;
      const counts = autoRestockCounts(restockGroups, shop.stock.map(entry => entry.item.title), shop.capacity - shop.stock.length);
      restockDialog.querySelectorAll('input[name="quantity"]').forEach((input, index) => { input.value = counts[index]; });
      updateRestockSelection();
      return;
    }
    if (button.dataset.business === 'unstock') {
      if (busy) return; busy = true; button.disabled = true;
      const visit = accountVisit, owner = account?.id;
      try {
        await accountApi('businesses/unstock', { shopId: button.dataset.shop, inventoryId: button.dataset.item });
        if (visit === accountVisit && account?.id === owner) {
          await refresh(visit);
          if (restockDialog.open) restockDialog.querySelector('.dialog-close')?.focus({ preventScroll: true });
        }
      } catch (error) { if (visit === accountVisit) showToast(error.message); }
      finally {
        busy = false;
        if (restockDialog.open) updateRestockSelection();
        if (visit === accountVisit) render();
      }
      return;
    }
  });
  document.addEventListener('input', event => {
    if (restockDialog.open && event.target.matches('input[name="quantity"]')) updateRestockSelection(event.target);
  });
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (businessSurface() && form.matches('[data-business-margin-form]')) {
      event.preventDefault();
      if (busy) return;
      const input = form.elements.profitMargin, profitMargin = Number(input.value);
      if (!Number.isSafeInteger(profitMargin) || profitMargin < 0 || profitMargin > 100) {
        form.querySelector('.account-error').textContent = accountError('invalid_profit_margin'); return;
      }
      busy = true;
      const visit = accountVisit, owner = account?.id, button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const result = await accountApi('businesses/margin', { shopId: form.dataset.shop, profitMargin });
        if (visit !== accountVisit || account?.id !== owner) return;
        updateAccount(result.user);
        await refresh(visit, false);
        if (visit === accountVisit) showToast(t('Markup saved.', 'Aufschlag gespeichert.'));
      } catch (error) { if (visit === accountVisit) form.querySelector('.account-error').textContent = error.message; }
      finally { busy = false; if (button.isConnected) button.disabled = false; if (visit === accountVisit) render(); }
      return;
    }
    if (!businessSurface() || form.id !== 'business-restock-form') return;
    event.preventDefault();
    if (busy) return;
    const quantities = [...form.querySelectorAll('input[name="quantity"]')].map(input => Number(input.value));
    const shop = dashboard?.shops.find(entry => entry.id === restockShopId);
    const space = shop ? shop.capacity - shop.stock.length : 0;
    if (!shop || quantities.some((value, index) =>
      !Number.isSafeInteger(value) || value < 0 || value > restockGroups[index].items.length)
      || quantities.reduce((sum, value) => sum + value, 0) < 1
      || quantities.reduce((sum, value) => sum + value, 0) > space) return;
    busy = true;
    const visit = accountVisit, owner = account?.id, button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    let completed = false;
    try {
      const result = await accountApi('businesses/stock', { shopId: restockShopId,
        inventoryIds: restockGroups.flatMap((group, index) => group.items.slice(0, quantities[index]).map(item => item.id)) });
      if (account?.id !== owner || visit !== accountVisit) return;
      if (result.user) updateAccount(result.user);
      await refresh(visit);
      completed = true;
      if (restockDialog.open) restockDialog.close();
      showToast(t('Done.', 'Erledigt.'));
    } catch (error) { if (visit === accountVisit) form.querySelector('.account-error').textContent = error.message; }
    finally {
      busy = false;
      if (restockDialog.open) updateRestockSelection();
      else if (button.isConnected) button.disabled = false;
      if (completed && visit === accountVisit) render();
    }
  });
  document.addEventListener('jg:language', () => {
    if (businessSurface()) render();
    if (editorDialog.open && !editorDialog.querySelector('button[type="submit"]:disabled')) {
      const form = editorDialog.querySelector('[data-store-profile]');
      renderEditor({name:form.elements.storeName.value,motto:form.elements.motto.value,guard:form.elements.gooseGuard.checked,margin:editorDialog.querySelector('[name="profitMargin"]').value});
    }
    if (quickJob && quickDialog.open) paintQuickProgress(quickJob);
    if (restockDialog.open) {
      const quantities = [...restockDialog.querySelectorAll('input[name="quantity"]')].map(input => Number(input.value));
      renderRestockDialog(quantities);
    }
  });
  return { load, stop, render, refresh, ownerView, ownedShop, quickRestockMarkup, isInteracting: () => busy || editorDialog.open || restockDialog.open || quickDialog.open };
})();
