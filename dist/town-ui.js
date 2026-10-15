window.townUi = (() => {
  const esc = accountEscape, art = window.townArtwork, ui = window.shopUi, typeName = ui.typeName, sizeName = ui.sizeName;
  let data = null, timer = null, request = 0, district = null, selected = null, view = 'shops', storeType = 'wine';
  let busy = false, returnFocus = null, zoom = 1, typeFilter = '', listMode = false, purchaseStep = 1, takeoverRequestId = null, restore = null, filtersOpen = false;
  const dialog = document.createElement('dialog');
  dialog.className = 'shop-task town-purchase-dialog'; dialog.setAttribute('aria-labelledby', 'town-purchase-title'); document.body.append(dialog);
  const stateKey = () => `jg:town:${account?.id || 'guest'}`;
  const area = () => data?.districts.find(a => a.id === district);
  function bounds() { const a = area(); return a ? [a.bounds[0]-20,a.bounds[1]-20,a.bounds[2]+40,a.bounds[3]+40] : [0,0,860,730]; }
  function saveState() {
    const map = accountContent.querySelector('.town-map-scroll');
    const state = {district, selected, view, zoom, typeFilter, listMode, x:map?.scrollLeft || 0, y:map?.scrollTop || 0};
    try { sessionStorage.setItem(stateKey(), JSON.stringify(state)); } catch {}
    const p = new URLSearchParams();
    if (district) p.set('district',district); if (selected) p.set('plot',selected);
    if (view !== 'shops') p.set('view',view); if (typeFilter) p.set('type',typeFilter);
    if (listMode) p.set('display','list'); else if (view !== 'shops') p.set('display','map'); if (zoom !== 1) p.set('zoom',zoom);
    if (state.x) p.set('x',Math.round(state.x)); if (state.y) p.set('y',Math.round(state.y));
    history.replaceState({},'', '/town' + (p.size ? '?' + p : ''));
  }
  function stop() {
    if (currentAccountPage === '/town' && data) saveState();
    clearInterval(timer); request++; data = null; busy = false; dialog.close();
  }
  async function refresh(visit, repaint = true) {
    const current = ++request, owner = account?.id;
    const response = await fetch('/api/town',{headers:{accept:'application/json'}}), result = await response.json();
    if (!response.ok) throw Error(accountError(result.error));
    if (visit !== accountVisit || current !== request || owner !== account?.id) return;
    data = result;
    if (!area()) district = null;
    if (selected && !visiblePlots().some(p => p.id === selected)) selected = null;
    if (repaint) render();
  }
  async function load(visit) {
    await economyReady;
    if (!economyFlags.businesses) { data = {disabled:true}; return; }
    let saved = {}; try { const value = JSON.parse(sessionStorage.getItem(stateKey()) || '{}'); if (value && typeof value === 'object') saved = value; } catch {}
    const q = new URLSearchParams(location.search), explicit = q.size > 0;
    const value = (key, fallback) => q.get(key) ?? (!explicit ? saved[fallback || key] : null);
    district = value('district') || null; selected = value('plot','selected') || null;
    view = ['shops','mine','open'].includes(value('view')) ? value('view') : 'shops';
    typeFilter = value('type','typeFilter') || ''; zoom = Math.min(3,Math.max(1,Math.round(Number(value('zoom')) || 1)));
    listMode = q.has('display') ? q.get('display') === 'list' : explicit ? view !== 'shops' : Boolean(saved.listMode);
    filtersOpen = false;
    // Resolve direct plot links before applying neighborhood filters.
    await refresh(visit,false); if (visit !== accountVisit || !data) return;
    const linked = q.get('plot') && data.plots.find(p => p.id === q.get('plot'));
    if (linked) { if (!listMode) district = linked.districtId; if ((view === 'mine' && !linked.business?.own) || (view === 'open' && linked.occupied && !linked.abandoned)) view = 'shops'; if (typeFilter && linked.business?.type !== typeFilter) typeFilter = ''; selected = linked.id; }
    if (!data.types.some(type => type.id === typeFilter)) typeFilter = '';
    restore = q.has('x') || q.has('y') || (!explicit && (saved.x || saved.y)) ? {x:Math.max(0,Number(value('x')) || 0),y:Math.max(0,Number(value('y')) || 0)} : null;
    timer = setInterval(() => {
      if (!document.hidden && !busy && !dialog.open && !document.activeElement?.closest('.town-toolbar,.town-map-shell,.town-context')) refresh(visit).catch(() => {});
    },30000);
  }
  function matchingPlots() {
    return data.plots.filter(p => (view !== 'mine' || p.business?.own) && (view !== 'open' || !p.occupied || p.abandoned) && (!typeFilter || p.business?.type === typeFilter || ((!p.occupied || p.abandoned) && view === 'open')));
  }
  function visiblePlots() { return matchingPlots().filter(p => !district || p.districtId === district); }
  function plotLabel(p) { return p.business?.name || (p.business ? typeName(p.business.type) : p.occupied ? t('Reserved location','Reservierter Standort') : t('Available plot','Freies Grundstück')); }
  const price = p => Math.min(...Object.values(p.costs));
  function metrics(p) {
    return `<dl class="town-plot-facts"><div><dt>${t('Size','Größe')}</dt><dd>${esc(sizeName(p.size))}</dd></div><div><dt>${t('From','Ab')}</dt><dd>${justizEuro(price(p))}</dd></div><div><dt>${t('Foot traffic','Laufkundschaft')}</dt><dd>${number(p.trafficMultiplier,2)}×</dd></div><div><dt>${t('Level','Level')}</dt><dd>${p.requiredLevel}</dd></div></dl>`;
  }
  function preview(p) {
    if (!p) return '';
    const b = p.business;
    return `<article class="town-preview shop-color-${esc(b?.type || storeType)}"><button class="town-preview-close" data-town-clear aria-label="${t('Close selection','Auswahl schließen')}">×</button>${b ? ui.art(b.type) : `<span class="town-preview-plot" aria-hidden="true">${art.icon(p.occupied ? 'lock' : 'plus')}</span>`}<div class="town-preview-heading"><span class="shop-kicker">${b ? esc(typeName(b.type)) : p.occupied ? t('Reserved','Reserviert') : t('Available plot','Freies Grundstück')}${p.abandoned ? ` · ${t('Abandoned','Verlassen')}` : ''}${b?.own ? ` · ★ ${t('Yours','Deiner')}` : ''}</span><h2 tabindex="-1">${esc(b ? plotLabel(p) : p.streetName)}</h2><p>${p.districtNumber}. ${esc(p.districtName)}${b ? ` · @${esc(b.owner)}` : ''}</p></div>${p.abandoned && !b?.own ? `<p>${justizEuro(p.takeoverPrice)}</p><button class="primary-button" data-town-open="${esc(p.id)}">${t('Purchase abandoned store','Verlassenen Laden kaufen')} →</button>` : ''}${b ? `<p class="town-stock-count">${b.stockCount} ${t('items on shelves','Artikel im Regal')}</p><a class="primary-button" href="${esc(ui.href(b))}" data-page>${b.own ? t('Manage store','Laden verwalten') : t('Visit store','Laden besuchen')} →</a>` : p.abandoned ? '' : p.occupied ? `<p>${t('This location is unavailable.','Dieser Standort ist nicht verfügbar.')}</p>` : `${metrics(p)}<button class="primary-button" data-town-open="${esc(p.id)}">${t('Choose store type','Ladentyp wählen')} →</button>`}</article>`;
  }
  function mapPin(p) {
    const point = art.position(p,data.districts), b = p.business, [x,y,w,h] = bounds();
    return `<button type="button" class="town-pin shop-color-${esc(b?.type || 'wine')} ${b ? 'is-store' : p.occupied ? 'is-reserved' : 'is-plot'} ${b?.own ? 'is-own' : ''} ${selected === p.id ? 'is-selected' : ''}" style="left:${(point.x-x)/w*100}%;top:${(point.y-y)/h*100}%" data-town-select="${esc(p.id)}" aria-pressed="${selected === p.id}" aria-label="${esc(plotLabel(p))} · ${esc(p.streetName)}">${b ? ui.art(b.type) : `<span class="town-plot-plus" aria-hidden="true">${p.occupied ? art.icon('lock') : '+'}</span>`}<span class="town-pin-name">${esc(b ? plotLabel(p) : p.streetName)}</span>${b?.own ? '<i aria-hidden="true">★</i>' : ''}</button>`;
  }
  function districtChip(a) {
    const all = data.plots.filter(p => p.districtId === a.id), matches = matchingPlots().filter(p => p.districtId === a.id), [x,y] = art.overviewPosition(a.id);
    return `<button class="town-district-chip ${matches.length ? '' : 'is-muted'}" style="left:${x/8.6}%;top:${y/7.3}%;--district-color:${a.color}" data-town-area="${a.id}" aria-label="${a.number}. ${esc(a.name)} · ${matches.length} ${t('matching locations','passende Standorte')}"><span class="town-district-number">${a.number}</span><strong>${esc(a.name)}</strong><small>${view === 'shops' && !typeFilter ? `${all.filter(p => p.business).length} ${all.filter(p => p.business).length === 1 ? t('store','Laden') : t('stores','Läden')} · ${all.filter(p => !p.occupied).length} ${all.filter(p => !p.occupied).length === 1 ? t('plot','Grundstück') : t('plots','Grundstücke')}` : `${matches.length} ${t('locations','Standorte')}`}</small></button>`;
  }
  function directory(places) {
    return `<section class="town-place-directory" aria-label="${t('Locations list','Standortliste')}" ${listMode ? '' : 'hidden'}><div class="town-list-heading"><h2>${area() ? esc(area().name) : t('All districts','Alle Bezirke')}</h2><span>${places.length} ${t('locations','Standorte')}</span></div><div class="town-place-list">${places.map(p => `<button class="town-place-row ${selected === p.id ? 'is-selected' : ''}" data-town-select="${esc(p.id)}" aria-pressed="${selected === p.id}"><span class="town-list-symbol shop-color-${esc(p.business?.type || 'wine')}">${p.business ? ui.art(p.business.type) : art.icon(p.occupied ? 'lock' : 'plus')}</span><span><strong>${esc(p.business ? plotLabel(p) : p.streetName)}${p.business?.own ? ' ★' : ''}</strong><small>${esc(p.districtName)} · ${p.business ? esc(typeName(p.business.type)) : esc(sizeName(p.size))}</small></span><span class="town-row-price">${p.abandoned ? t('Abandoned','Verlassen') : p.business ? `${p.business.stockCount} ${t('items','Artikel')}` : p.occupied ? t('Reserved','Reserviert') : `${t('From','Ab')} ${justizEuro(price(p))}`}<span aria-hidden="true"> →</span></span></button>`).join('') || emptyState()}</div></section>`;
  }
  function emptyState() { return `<div class="town-empty"><span aria-hidden="true">${art.icon(view === 'open' ? 'lock' : 'plus')}</span><h2>${view === 'mine' ? t('No stores here yet','Hier noch keine eigenen Läden') : t('No matching locations','Keine passenden Standorte')}</h2><button class="secondary-button" data-town-reset>${t('Show all locations','Alle Standorte anzeigen')}</button></div>`; }
  function render() {
    if (currentAccountPage !== '/town' || !data) return;
    if (data.disabled) { accountContent.innerHTML = pageHeading(t('Town map is unavailable.','Stadtplan ist nicht verfügbar.')); return; }
    const old = accountContent.querySelector('.town-map-scroll'), scroll = restore || (old ? {x:old.scrollLeft,y:old.scrollTop} : null);
    const places = visiblePlots(), plot = places.find(p => p.id === selected), a = area();
    if (!plot) selected = null;
    const modes = [['shops',t('Explore','Entdecken')],['mine',t('My stores','Meine Läden')],['open',t('Open a store','Laden eröffnen')]];
    accountContent.innerHTML = `<div class="town-page stores-workspace ${listMode ? 'is-list-mode' : ''} ${plot ? 'has-selection' : ''}"><header class="shop-page-heading"><h1 tabindex="-1">${t('Town map','Stadtplan')}</h1><a class="town-portfolio-link" href="/businesses" data-page>${t('Your stores','Deine Läden')} ↗</a></header>
      <div class="town-toolbar"><div class="town-intents shop-tabs" role="group" aria-label="${t('Map filters','Kartenfilter')}">${modes.map(([id,label]) => `<button data-town-view="${id}" ${id === 'mine' ? 'data-town-mine' : ''} aria-pressed="${view === id}">${id === 'mine' ? '<span aria-hidden="true">★</span> ' : id === 'open' ? '<span aria-hidden="true">＋</span> ' : ''}${label}</button>`).join('')}</div><div class="town-display-switch" role="group" aria-label="${t('Display','Ansicht')}"><button data-town-display="map" aria-pressed="${!listMode}">${t('Map','Karte')}</button><button data-town-display="list" aria-pressed="${listMode}">${t('List','Liste')}</button></div><details class="town-filters" ${filtersOpen ? 'open' : ''}><summary>${t('Filters','Filter')}${typeFilter || district ? ' •' : ''}</summary><div><label>${t('District','Bezirk')}<select data-town-district><option value="">${t('All districts','Alle Bezirke')}</option>${data.districts.map(d => `<option value="${d.id}" ${district === d.id ? 'selected' : ''}>${d.number}. ${esc(d.name)}</option>`).join('')}</select></label><label ${view === 'open' ? 'hidden' : ''}>${t('Store type','Ladentyp')}<select data-town-type><option value="">${t('All types','Alle Typen')}</option>${data.types.map(type => `<option value="${type.id}" ${typeFilter === type.id ? 'selected' : ''}>${esc(typeName(type.id))}</option>`).join('')}</select></label>${typeFilter || district ? `<button class="secondary-button" data-town-reset>${t('Clear filters','Filter löschen')}</button>` : ''}</div></details></div>
      <div class="town-layout"><section class="town-map-shell" aria-label="${t('Interactive town map','Interaktiver Stadtplan')}" ${listMode ? 'hidden' : ''}><div class="town-map-controls"><div class="town-breadcrumb"><button data-town-fit ${!district && zoom === 1 ? 'disabled' : ''}>${district ? '← ' : ''}${t('Vienna','Wien')}</button>${a ? `<span aria-hidden="true">/</span><strong>${esc(a.name)}</strong>` : `<span>${t('Choose a district','Bezirk wählen')}</span>`}</div><div class="town-zoom"><button data-town-zoom="-1" aria-label="${t('Zoom out','Verkleinern')}" ${zoom <= 1 ? 'disabled' : ''}>−</button><span aria-live="polite">${[100,150,200][zoom-1]}%</span><button data-town-zoom="1" aria-label="${t('Zoom in','Vergrößern')}" ${zoom >= 3 ? 'disabled' : ''}>+</button></div></div><div class="town-map-scroll" tabindex="0" aria-label="${t('Town map. Drag to pan; use arrow keys to move, plus and minus to zoom.','Stadtplan. Zum Verschieben ziehen; Pfeiltasten zum Bewegen, Plus und Minus zum Zoomen.')}"><div class="town-canvas ${a ? 'is-neighborhood' : 'is-overview'}" data-zoom="${zoom}">${a ? art.render(data,a.id,esc,false,bounds()) + places.map(mapPin).join('') : art.overview(data,esc) + data.districts.map(districtChip).join('')}</div></div>${a && !places.length ? emptyState() : ''}<footer class="town-map-legend"><span>★ ${t('Your store','Dein Laden')}</span><span>＋ ${t('Available plot','Freies Grundstück')}</span><span aria-live="polite">${places.length} ${t('locations','Standorte')}</span></footer></section>${directory(places)}<aside class="town-context" aria-label="${t('Selected location','Ausgewählter Standort')}" ${plot ? '' : 'hidden'}><div class="town-selection">${preview(plot)}</div></aside></div></div>`;
    const map = accountContent.querySelector('.town-map-scroll'); sizeMap();
    if (scroll) { map.scrollLeft = scroll.x; map.scrollTop = scroll.y; restore = null; }
    else if (selected) centerPlot(selected);
    bindPan(map); if (!scroll) revealSelection(); saveState();
  }
  const mapMetrics = new WeakMap();
  function sizeMap() {
    const map = accountContent.querySelector('.town-map-scroll'), canvas = map?.querySelector('.town-canvas');
    if (!canvas || !map.clientWidth || !map.clientHeight) return;
    const previous = mapMetrics.get(map), center = previous ? {x:(map.scrollLeft+previous.width/2)/previous.worldWidth,y:(map.scrollTop+previous.height/2)/previous.worldHeight} : null;
    const [, ,w,h] = bounds(), scale = Math.min(map.clientWidth/w,map.clientHeight/h) * [1,1.5,2][zoom-1];
    const width = w*scale, height = h*scale;
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    if (center) { map.scrollLeft = center.x*width-map.clientWidth/2; map.scrollTop = center.y*height-map.clientHeight/2; }
    mapMetrics.set(map,{width:map.clientWidth,height:map.clientHeight,worldWidth:width,worldHeight:height});
  }
  function centerPlot(id) {
    const p = data?.plots.find(p => p.id === id), map = accountContent.querySelector('.town-map-scroll'), canvas = map?.querySelector('.town-canvas');
    if (!p || !canvas || !area()) return;
    const point = art.position(p,data.districts), [x,y,w,h] = bounds();
    map.scrollLeft = (point.x-x)/w*canvas.clientWidth-map.clientWidth/2; map.scrollTop = (point.y-y)/h*canvas.clientHeight-map.clientHeight/2;
  }
  function selectPlot(id) {
    const p = visiblePlots().find(p => p.id === id); if (!p) return;
    selected = id;
    // Selection updates only the card and marker state; preserve the live map.
    for (const button of accountContent.querySelectorAll('[data-town-select]')) { const active = button.dataset.townSelect === id; button.classList.toggle('is-selected',active); button.setAttribute('aria-pressed',String(active)); }
    const context = accountContent.querySelector('.town-context'); context.hidden = false;
    context.querySelector('.town-selection').innerHTML = preview(p);
    accountContent.querySelector('.town-page').classList.add('has-selection');
    sizeMap(); revealSelection(); context.querySelector('h2')?.focus({preventScroll:true}); saveState();
  }
  function revealSelection() {
    if (!selected || listMode) return;
    const pin = accountContent.querySelector('.town-pin.is-selected'), map = accountContent.querySelector('.town-map-scroll');
    if (!pin || !map) return;
    const marker = pin.getBoundingClientRect(), frame = map.getBoundingClientRect();
    if (marker.left < frame.left || marker.right > frame.right || marker.top < frame.top || marker.bottom > frame.bottom) centerPlot(selected);
    if (innerWidth <= 1000) {
      const card = accountContent.querySelector('.town-context').getBoundingClientRect();
      const overlap = pin.getBoundingClientRect().bottom + 34 - card.top;
      if (overlap > 0) window.scrollBy({top:overlap,behavior:'instant'});
    }
  }
  function clearSelection() {
    const id = selected; selected = null;
    const context = accountContent.querySelector('.town-context'); context.hidden = true; context.querySelector('.town-selection').innerHTML = '';
    accountContent.querySelector('.town-page').classList.remove('has-selection');
    for (const b of accountContent.querySelectorAll('[data-town-select]')) { b.classList.remove('is-selected'); b.setAttribute('aria-pressed','false'); }
    sizeMap();
    [...accountContent.querySelectorAll('[data-town-select]')].find(b => b.dataset.townSelect === id && b.getClientRects().length)?.focus({preventScroll:true}); saveState();
  }
  function bindPan(map) {
    let drag = null;
    const finish = () => { drag = null; map.classList.remove('is-dragging'); if (currentAccountPage === '/town') saveState(); };
    map.addEventListener('pointerdown',e => { if (e.target.closest('button') || e.pointerType === 'touch') return; drag = {x:e.clientX,y:e.clientY,sx:map.scrollLeft,sy:map.scrollTop}; map.setPointerCapture(e.pointerId); map.classList.add('is-dragging'); });
    map.addEventListener('pointermove',e => { if (!drag) return; map.scrollLeft = drag.sx+drag.x-e.clientX; map.scrollTop = drag.sy+drag.y-e.clientY; });
    map.addEventListener('pointerup',finish); map.addEventListener('pointercancel',finish); map.addEventListener('lostpointercapture',finish);
    map.addEventListener('scroll',() => { clearTimeout(map.saveTimer); map.saveTimer = setTimeout(() => { if (map.isConnected && currentAccountPage === '/town') saveState(); },150); });
    map.addEventListener('keydown',e => { if (e.target !== map) return; const delta = {ArrowLeft:[-80,0],ArrowRight:[80,0],ArrowUp:[0,-80],ArrowDown:[0,80]}[e.key]; if (delta) { e.preventDefault(); map.scrollBy(...delta); } if (['+','=','-'].includes(e.key)) { e.preventDefault(); setZoom(e.key === '-' ? -1 : 1); } });
  }
  function setZoom(delta) {
    zoom = Math.min(3,Math.max(1,zoom+delta));
    const canvas = accountContent.querySelector('.town-canvas'); canvas.dataset.zoom = zoom; sizeMap();
    accountContent.querySelector('.town-zoom>span').textContent = `${[100,150,200][zoom-1]}%`;
    for (const b of accountContent.querySelectorAll('[data-town-zoom]')) b.disabled = Number(b.dataset.townZoom) < 0 ? zoom <= 1 : zoom >= 3;
    accountContent.querySelector('[data-town-fit]').disabled = !district && zoom === 1;
    saveState();
  }
  function focusControl(selector) { accountContent.querySelector(selector)?.focus({preventScroll:true}); }
  function showDistrict(id) { district = data.districts.some(a => a.id === id) ? id : null; selected = null; zoom = 1; restore = {x:0,y:0}; render(); focusControl('.town-map-scroll'); }
  function purchaseMarkup(){
    const plot=data.plots.find(plot=>plot.id===selected);if(!plot||plot.occupied&&!plot.abandoned)return '';
    if(plot.abandoned)return takeoverMarkup(plot);
    const cost=plot.costs[storeType],capacity=storeType==='cars'?plot.carCapacity:plot.capacity,capped=data.myStoreCount>=data.maxStores,locked=account&&(data.playerLevel??1)<plot.requiredLevel;
    return `<div class="town-purchase-content"><button type="button" class="dialog-close" data-town-close aria-label="${t('Close','Schließen')}">×</button><p class="eyebrow">${esc(plot.districtName)}</p><h2 id="town-purchase-title" tabindex="-1">${esc(plot.streetName)}</h2><p class="town-location-size">${esc(sizeName(plot.size))}</p><form class="town-purchase"><fieldset ${purchaseStep===2?'hidden':''}><legend>${t('Store type','Ladentyp')}</legend><div class="town-type-grid">${data.types.map(type=>`<label class="town-type-choice${storeType===type.id?' is-selected':''}"><input type="radio" name="type" value="${type.id}" ${storeType===type.id?'checked':''} ${busy?'disabled':''}>${art.icon(type.id)}<span>${esc(typeName(type.id))}</span><strong class="town-type-price">${justizEuro(plot.costs[type.id])}</strong>${ui.stockHint(type.id)?`<small class="town-type-hint">${esc(ui.stockHint(type.id))}</small>`:''}</label>`).join('')}</div></fieldset><div class="town-purchase-checkout"><div class="town-buy-summary"><span>${esc(typeName(storeType))}<small>${capacity} ${t('shelf spaces','Regalplätze')}</small></span><strong>${justizEuro(cost)}</strong></div>${account?`<p class="town-purchase-note">${capped?t('Your store limit is reached.','Dein Ladenlimit ist erreicht.'):locked?t(`Requires level ${plot.requiredLevel}.`,`Benötigt Level ${plot.requiredLevel}.`):account.tokens<cost?t(`You need ${justizEuro(cost-account.tokens)} more.`,`Dir fehlen noch ${justizEuro(cost-account.tokens)}.`):t(`Balance after purchase: ${justizEuro(account.tokens-cost)}.`,`Guthaben nach dem Kauf: ${justizEuro(account.tokens-cost)}.`)}</p><button type="${purchaseStep===1?'button':'submit'}" ${purchaseStep===1?'data-town-review':''} class="primary-button" ${busy||capped||locked||account.tokens<cost?'disabled':''}>${busy?t('Opening…','Wird eröffnet …'):purchaseStep===1?t('Review location','Standort prüfen'):t('Confirm & open store','Bestätigen & Laden eröffnen')} →</button>`:`<a href="/login" data-page class="primary-button">${t('Sign in to open here','Anmelden und hier eröffnen')} →</a>`}<p class="account-error" role="alert"></p></div></form>${purchaseStep===2?`<button class="secondary-button" data-town-back>${t('Change store type','Ladentyp ändern')}</button>`:''}<details class="town-location-details" ${purchaseStep===2?'open':''}><summary>${t('Location details','Standortdetails')}</summary><dl><div><dt>${t('Required level','Benötigtes Level')}</dt><dd>${plot.requiredLevel}</dd></div><div><dt>${t('Foot traffic','Laufkundschaft')}</dt><dd>${number(plot.trafficMultiplier,2)}×</dd></div><div><dt>${t('Location price','Standortpreis')}</dt><dd>${number(plot.priceMultiplier,2)}×</dd></div><div><dt>${t('Theft fine','Diebstahlbußgeld')}</dt><dd>${number(Math.max(1,1/plot.theftMultiplier),2)}×</dd></div><div><dt>${t('Compatible inventory','Passendes Inventar')}</dt><dd>${data.compatibleStock?.[storeType]||0}</dd></div></dl><p>${t('One store per plot. Store size cannot be changed.','Ein Laden pro Grundstück. Die Ladengröße kann nicht geändert werden.')}</p></details></div>`;
  }
  function takeoverMarkup(plot) {
    const capped=data.myStoreCount>=data.maxStores,locked=account&&(data.playerLevel??1)<plot.requiredLevel,cost=plot.takeoverPrice;
    return `<div class="town-purchase-content"><button type="button" class="dialog-close" data-town-close aria-label="${t('Close','Schließen')}">×</button><p class="eyebrow">${t('Abandoned','Verlassen')}</p><h2 id="town-purchase-title" tabindex="-1">${t('Purchase abandoned store','Verlassenen Laden kaufen')}</h2><p>${esc(plot.streetName)} · ${esc(typeName(plot.takeoverType))} · ${esc(sizeName(plot.size))}</p><p>${t('You receive a fresh store. Previous stock and cash return to the previous owner.','Du erhältst einen neuen Laden. Bisherige Waren und Kasseneinnahmen bleiben beim bisherigen Besitzer.')}</p><form class="town-purchase"><div class="town-buy-summary"><span>${t('Purchase price','Kaufpreis')}</span><strong>${justizEuro(cost)}</strong></div>${account?`<p>${capped?t('Your store limit is reached.','Dein Ladenlimit ist erreicht.'):locked?t(`Requires level ${plot.requiredLevel}.`,`Benötigt Level ${plot.requiredLevel}.`):account.tokens<cost?t('Not enough J€.','Nicht genug J€.'):t(`Balance after purchase: ${justizEuro(account.tokens-cost)}.`,`Guthaben nach dem Kauf: ${justizEuro(account.tokens-cost)}.`)}</p><button type="submit" class="primary-button" ${busy||capped||locked||account.tokens<cost?'disabled':''}>${busy?t('Purchasing…','Wird gekauft …'):t('Confirm purchase','Kauf bestätigen')}</button>`:`<a href="/login" data-page class="primary-button">${t('Sign in to purchase','Zum Kaufen anmelden')}</a>`}<p class="account-error" role="alert"></p></form></div>`;
  }
  function paintPurchase(){const expanded=dialog.querySelector('.town-location-details')?.open;dialog.innerHTML=purchaseMarkup();if(expanded&&dialog.querySelector('details'))dialog.querySelector('details').open=true;}
  function openPurchase(id,button=null){const plot=data.plots.find(plot=>plot.id===id);if(!plot||plot.occupied&&!plot.abandoned||plot.business?.own)return;selected=id;purchaseStep=plot.abandoned?2:1;takeoverRequestId=crypto.randomUUID();returnFocus=button;centerPlot(id);paintPurchase();if(!dialog.open)dialog.showModal();dialog.querySelector('h2')?.focus({preventScroll:true});}
  dialog.addEventListener('close',()=>{if(currentAccountPage!=='/town')return;(returnFocus?.isConnected?returnFocus:accountContent.querySelector('[data-town-view="open"]'))?.focus({preventScroll:true});returnFocus=null;});
  document.addEventListener('click', event => {
    if (currentAccountPage !== '/town' || !data) return;
    const filters = accountContent.querySelector('.town-filters');
    if (filters?.open && !event.target.closest('.town-filters')) { filters.open = false; filtersOpen = false; }
    const b = event.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-town-close')) { dialog.close(); return; }
    if (busy) return;
    if (b.hasAttribute('data-town-review')) { purchaseStep = 2; paintPurchase(); dialog.querySelector('h2')?.focus(); return; }
    if (b.hasAttribute('data-town-back')) { purchaseStep = 1; paintPurchase(); dialog.querySelector('legend')?.setAttribute('tabindex','-1'); dialog.querySelector('legend')?.focus(); return; }
    if (b.dataset.townSelect) selectPlot(b.dataset.townSelect);
    if (b.dataset.townOpen) openPurchase(b.dataset.townOpen,b);
    if (b.dataset.townView) {
      view = b.dataset.townView; typeFilter = ''; district = null; selected = null; zoom = 1; listMode = view !== 'shops'; restore = {x:0,y:0};
      render(); focusControl(`[data-town-view="${view}"]`);
    }
    if (b.dataset.townArea) showDistrict(b.dataset.townArea);
    if (b.dataset.townZoom) setZoom(Number(b.dataset.townZoom));
    if (b.hasAttribute('data-town-fit')) showDistrict(null);
    if (b.hasAttribute('data-town-clear')) clearSelection();
    if (b.hasAttribute('data-town-reset')) { district = null; typeFilter = ''; view = 'shops'; selected = null; zoom = 1; restore = {x:0,y:0}; render(); focusControl('[data-town-view="shops"]'); }
    if (b.dataset.townDisplay) { listMode = b.dataset.townDisplay === 'list'; if (!listMode && selected) { district = data.plots.find(p => p.id === selected)?.districtId || null; zoom = 1; restore = {x:0,y:0}; } render(); focusControl(`[data-town-display="${b.dataset.townDisplay}"]`); }
  });
  document.addEventListener('keydown',event => {
    if (currentAccountPage !== '/town' || event.key !== 'Escape' || dialog.open) return;
    const filters = accountContent.querySelector('.town-filters');
    if (filters?.open) { filters.open = false; filtersOpen = false; focusControl('.town-filters>summary'); }
    else if (selected) { event.preventDefault(); clearSelection(); }
  });
  document.addEventListener('click',event => {
    const link = event.target.closest('a[data-page]');
    if (currentAccountPage !== '/town' || !link || !link.getAttribute('href')?.startsWith('/stores?')) return;
    saveState(); const url = new URL(link.href); url.searchParams.set('returnTo',location.pathname+location.search); link.href = url.pathname+url.search;
  },true);
  document.addEventListener('toggle',event => { if (event.target.matches?.('.town-filters')) filtersOpen = event.target.open; },true);
  document.addEventListener('change',event => {
    if (currentAccountPage !== '/town' || !data || busy) return;
    const target = event.target;
    if (target.matches('[data-town-district]')) { filtersOpen = true; showDistrict(target.value); focusControl('[data-town-district]'); }
    if (target.matches('[data-town-type]')) { typeFilter = target.value; selected = null; filtersOpen = true; render(); focusControl('[data-town-type]'); }
    if (target.matches('.town-purchase [name="type"]')) { storeType = target.value; paintPurchase(); dialog.querySelector(`[value="${storeType}"]`)?.focus(); }
  });
  document.addEventListener('submit',async event=>{if(currentAccountPage!=='/town'||!event.target.matches('.town-purchase'))return;event.preventDefault();if(busy||!account||purchaseStep!==2)return;const plot=data.plots.find(p=>p.id===selected);if(!plot||plot.occupied&&!plot.abandoned)return;const visit=accountVisit,owner=account.id;busy=true;paintPurchase();try{const result=await accountApi(plot.abandoned?'businesses/takeover':'businesses/buy',plot.abandoned?{shopId:plot.business?.id||plot.abandonedBusinessId,expectedPrice:plot.takeoverPrice,requestId:takeoverRequestId}:{plotId:plot.id,type:storeType});if(visit!==accountVisit||owner!==account?.id)return;updateAccount(result.user);saveState();await navigateAccountPage('/businesses');showToast(t('Store opened. Add stock to start trading.','Laden eröffnet. Räume Waren ein, um loszulegen.'));}catch(error){if(visit===accountVisit&&owner===account?.id){await refresh(visit,false).catch(()=>{});busy=false;if(!purchaseMarkup()){dialog.close();render();showToast(error.message);}else{paintPurchase();dialog.querySelector('.account-error').textContent=error.message;}}}finally{if(visit===accountVisit)busy=false;}});
  window.addEventListener('resize',() => { if (currentAccountPage === '/town' && data) { sizeMap(); revealSelection(); } });
  document.addEventListener('jg:language',() => { if (currentAccountPage === '/town' && dialog.open) paintPurchase(); });
  return {load,stop,render};
})();
