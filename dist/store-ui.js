window.storeUi = (() => {
  const esc = accountEscape;
  const names = { wine: ['Wine store', 'Weinhandlung'], toys: ['Toy store', 'Spielwarenladen'], electronics: ['Electronics store', 'Elektronikladen'], cars: ['Car dealership', 'Autohaus'] };
  const symbols = { wine: 'VIN', toys: 'TOY', electronics: 'TECH', cars: 'AUTO' };
  const typeName = type => names[type] ? t(...names[type]) : type;
  let data = null, timer = null, generation = 0, busy = false, game = null, gameVersion = 0, timers = [], returnFocus = null;
  let eventQueue = [], eventOwner = null, eventPending = false, eventReturnFocus = null;
  const eventDialog = document.createElement('dialog');
  eventDialog.className = 'store-event-dialog'; eventDialog.setAttribute('aria-labelledby', 'store-event-title'); document.body.append(eventDialog);
  const heistDialog = document.createElement('dialog');
  heistDialog.className = 'store-heist-dialog'; heistDialog.setAttribute('aria-labelledby', 'store-heist-title'); document.body.append(heistDialog);
  const later = (fn, milliseconds) => { const handle = setTimeout(fn, milliseconds); timers.push(handle); };
  function clearGameTimers() { timers.forEach(clearTimeout); timers = []; gameVersion++; }
  function stop() { eventQueue = []; eventOwner = null; eventReturnFocus = null; eventDialog.close(); busy = false; clearInterval(timer); timer = null; generation++; clearGameTimers(); game = null; data = null; returnFocus = null; heistDialog.close(); }
  function shopId() { return new URLSearchParams(location.search).get('shop'); }
  async function read(url) {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    const result = await response.json();
    if (!response.ok) { const error = new Error(accountError(result.error)); error.code = result.error; throw error; }
    return result;
  }
  async function refresh(visit, repaint = true) {
    const current = ++generation, owner = account?.id, params = new URLSearchParams(location.search), id = params.get('shop');
    const result = await read(id ? `/api/stores/${encodeURIComponent(id)}` : `/api/stores?${params}`);
    if (current !== generation || visit !== accountVisit || account?.id !== owner) return;
    if (owner) { await window.businessUi.refresh(visit, false); if (current !== generation || visit !== accountVisit || account?.id !== owner) return; }
    data = result;
    if (repaint) render();
  }
  async function load(visit) {
    await economyReady;
    if (!economyFlags.businesses) { data = { disabled: true }; return; }
    await loadEvents(visit);
    if (visit !== accountVisit) return;
    await refresh(visit, false);
    if (visit !== accountVisit) return;
    if (account && data?.store && !data.store.own) {
      await accountApi('stores/visit', { shopId: data.store.id });
      if (visit !== accountVisit) return;
      await refresh(visit, false);
    }
    timer = setInterval(() => {
      if (!document.hidden && !busy && !heistDialog.open && !eventDialog.open && !window.businessUi.isInteracting() && !document.activeElement?.closest('.store-review-form, .store-search')) refresh(visit).catch(() => {});
    }, 30000);
  }
  async function loadEvents(visit) {
    const owner = account?.id; if (!owner) return;
    const result = await accountApi('stores/events/check', {});
    if (visit !== accountVisit || account?.id !== owner) return;
    updateAccount(result.user); eventQueue = result.events; eventOwner = owner;
  }
  function showEvents(force = false) {
    if (eventDialog.open && !force) return;
    if (!eventQueue.length || eventOwner !== account?.id || !['/stores','/businesses'].includes(currentAccountPage)) return;
    eventDialog.innerHTML = `<div class="store-event-content"><h2 id="store-event-title" tabindex="-1">${t('Store events', 'Ladenereignisse')}</h2><div class="store-event-list">${eventQueue.map(event => `<article><p class="store-event-shop">${esc(event.shopName || typeName(event.shopType))}</p><h3>${esc(t(event.titleEn, event.titleDe))}</h3><p>${esc(t(event.bodyEn, event.bodyDe))}</p><div class="store-event-outcome">${event.itemsLost ? `<span>${number(event.itemsLost)} ${t('items lost', 'Artikel verloren')}</span>` : ''}${event.itemsSold ? `<span>${number(event.itemsSold)} ${t('items sold', 'Artikel verkauft')}</span>` : ''}<strong>${event.money > 0 ? '+' : event.money < 0 ? '−' : ''}${justizEuro(Math.abs(event.money))}</strong></div><small>${new Date(event.createdAt).toLocaleString(uiLocale())}</small></article>`).join('')}</div><p class="account-error" role="alert"></p><button class="primary-button" data-store-events-dismiss>${t('Close', 'Schließen')}</button></div>`;
    if (!eventDialog.open) { eventReturnFocus = document.activeElement; eventDialog.showModal(); eventDialog.querySelector('h2').focus({preventScroll:true}); eventDialog.scrollTop = 0; }
  }
  async function dismissEvents() {
    if (eventPending || eventOwner !== account?.id) return;
    const visit = accountVisit, owner = eventOwner; eventPending = true;
    const button = eventDialog.querySelector('button'); button.disabled = true;
    try {
      const result = await accountApi('stores/events/acknowledge', { ids: eventQueue.map(event => event.id) });
      if (visit !== accountVisit || owner !== account?.id) return;
      eventQueue = result.events;
      if (eventQueue.length) showEvents(true); else eventDialog.close();
    } catch (error) { if (visit === accountVisit && eventDialog.open) eventDialog.querySelector('.account-error').textContent = error.message; }
    finally { eventPending = false; if (button.isConnected) button.disabled = false; }
  }
  eventDialog.addEventListener('click', event => { if (event.target.closest('[data-store-events-dismiss]')) dismissEvents(); });
  eventDialog.addEventListener('cancel', event => { event.preventDefault(); dismissEvents(); });
  eventDialog.addEventListener('close', () => { if (eventReturnFocus?.isConnected) eventReturnFocus.focus({preventScroll:true}); eventReturnFocus = null; });
  const storeTitle = store => store.name || `${store.owner} · ${typeName(store.type)}`;
  function rating(store) { return store.rating === null ? t('No reviews yet', 'Noch keine Bewertungen') : `★ ${number(store.rating, 1)} / 5 · ${number(store.reviewCount)} ${t('reviews', 'Bewertungen')}`; }
  function card(store) {
    const own = store.ownerId === account?.id, shop = own ? window.businessUi.ownedShop(store.id) : null;
    return `<article class="store-card store-type-${esc(store.type)}"><a class="store-card-link" href="/stores?shop=${encodeURIComponent(store.id)}" data-page><div class="store-awning" aria-hidden="true"><span>${esc(symbols[store.type] || 'JG')}</span></div><div class="store-card-content"><small>${esc(typeName(store.type))} · ${own ? t('Your store', 'Dein Laden') : esc(store.owner)}</small><h2>${esc(storeTitle(store))}</h2>${store.motto?`<p>${esc(store.motto)}</p>`:''}<p>${rating(store)}</p><strong>${number(shop?.stock.length ?? store.stockCount)} ${t('items on shelves', 'Artikel im Regal')} · ${number(store.playerVisits)} ${t('player visits', 'Spielerbesuche')}</strong>${store.gooseGuard ? `<p class="store-goose">${t('Goose guard active', 'Wachgans aktiv')}</p>` : ''}</div></a>${own ? `<div class="store-card-quick">${window.businessUi.quickRestockMarkup(store.id)}</div>` : ''}</article>`;
  }
  function directory() {
    const params = new URLSearchParams(location.search), query = params.get('query') || '', type = params.get('type') || '';
    const offset = data.offset || 0;
    const pageLink = start => { const next = new URLSearchParams(params); next.set('offset', start); return `/stores?${next}`; };
    return `${pageHeading(t('Visit stores', 'Läden besuchen'))}<div class="store-action-row"><a href="/businesses" class="secondary-button" data-page>${t('Manage your stores', 'Deine Läden verwalten')}</a></div><form class="store-search"><label>${t('Search stores or owners', 'Läden oder Besitzer suchen')}<input name="query" maxlength="80" value="${esc(query)}" type="search"></label><label>${t('Store type', 'Ladentyp')}<select name="type"><option value="">${t('All stores', 'Alle Läden')}</option>${Object.keys(names).map(id => `<option value="${id}" ${type === id ? 'selected' : ''}>${esc(typeName(id))}</option>`).join('')}</select></label><button class="primary-button" type="submit">${t('Explore', 'Entdecken')}</button></form><p>${number(data.total || 0)} ${t('stores', 'Läden')}</p><div class="store-directory">${data.stores?.length ? data.stores.map(card).join('') : `<p class="collection-empty">${t('No stores found.', 'Keine Läden gefunden.')}</p>`}</div><nav class="store-action-row" aria-label="${t('Store pages', 'Ladenseiten')}">${offset > 0 ? `<a href="${esc(pageLink(Math.max(0, offset - data.limit)))}" class="secondary-button" data-page>← ${t('Previous', 'Zurück')}</a>` : ''}${offset + data.limit < data.total ? `<a href="${esc(pageLink(offset + data.limit))}" class="secondary-button" data-page>${t('Next', 'Weiter')} →</a>` : ''}</nav>`;
  }
  function shelfCard(entry, store) {
    const available = account && !store.own;
    const cooling = Date.now() < store.cooldownUntil;
    return `<article class="store-shelf-card">${entry.item.image ? `<img src="${esc(entry.item.image)}" alt="" loading="lazy">` : `<div class="store-item-placeholder" aria-hidden="true">${esc(symbols[store.type])}</div>`}<div class="store-shelf-info"><h3>${esc(entry.item.title)}</h3><p class="store-price">${justizEuro(entry.price)}</p><div class="store-action-row"><button class="primary-button" data-store="buy" data-item="${esc(entry.id)}" ${!available || busy || account.tokens < entry.price ? 'disabled' : ''}>${t('Buy', 'Kaufen')} · ${justizEuro(entry.price)}</button>${entry.theft ? `<button class="secondary-button" data-store="heist" data-item="${esc(entry.id)}" ${!available || busy || cooling || account.tokens < entry.theft.fee ? 'disabled' : ''}>${t('Try to steal', 'Diebstahl versuchen')}</button><small>${t('Mischief fee', 'Unfuggebühr')} ${justizEuro(entry.theft.fee)} · ${entry.theft.chancePercent}% ${t('chance to land on your color', 'Chance auf deine Farbe')}</small>` : ''}</div></div></article>`;
  }
  function reviewStars(stars) {
    return `<span class="store-review-stars" role="img" aria-label="${stars} ${t('out of 5 stars', 'von 5 Sternen')}">${[1,2,3,4,5].map(value => `<span aria-hidden="true" class="${value <= stars ? 'is-filled' : ''}">★</span>`).join('')}</span>`;
  }
  function reviewForm(review) {
    return `<form class="store-review-form"><fieldset class="store-rating"><legend>${t('Your rating', 'Deine Bewertung')}</legend><div class="store-star-picker">${[1,2,3,4,5].map(stars => `<label class="store-star-option"><input type="radio" name="stars" value="${stars}" aria-label="${stars} ${stars === 1 ? t('star', 'Stern') : t('stars', 'Sterne')} / 5" ${review?.stars === stars ? 'checked' : ''} required><span class="store-star-symbol" aria-hidden="true">★</span></label>`).join('')}</div></fieldset><label>${t('Your review', 'Dein Bewertungstext')}<textarea name="comment" maxlength="240" rows="4" placeholder="${t('Tell others about your visit…', 'Erzähle anderen von deinem Besuch …')}">${esc(review?.comment || '')}</textarea><small class="store-hint">${t('Up to 240 characters.', 'Bis zu 240 Zeichen.')}</small></label><button class="primary-button" type="submit">${t('Save review', 'Bewertung speichern')}</button><p class="account-error" role="alert"></p></form>`;
  }
  function detail(store) {
    if (store.own) return window.businessUi.ownerView(store) + `<details class="store-owner-reviews"><summary>${t('Customer reviews', 'Kundenbewertungen')} <span>${number(store.reviewCount)}</span></summary><div class="store-review-list">${store.reviews.length ? store.reviews.map(review => `<article><header><strong>${esc(review.username)}</strong>${reviewStars(review.stars)}</header><p>${esc(review.comment)}</p><small>${new Date(review.updatedAt).toLocaleDateString(uiLocale())}</small></article>`).join('') : `<p>${t('No reviews yet. Reviews appear after a customer buys from your store.', 'Noch keine Bewertungen. Sie erscheinen, sobald ein Kunde in deinem Laden gekauft hat.')}</p>`}</div></details>`;
    const eligible = account && !store.own, review = store.myReview;
    return `<p><a href="/stores" data-page>← ${t('All stores', 'Alle Läden')}</a></p><header class="store-front store-type-${esc(store.type)}"><div class="store-awning" aria-hidden="true"><span>${esc(symbols[store.type])}</span></div><div><p class="eyebrow">${esc(typeName(store.type))} · ${esc(store.owner)}</p>${pageHeading(esc(storeTitle(store)))}${store.location ? `<p><a href="/town?plot=${encodeURIComponent(store.location.plotId)}" data-page>${store.location.districtNumber}. ${esc(store.location.districtName)} · ${esc(store.location.streetName)} ↗</a></p>` : ''}${store.motto?`<p>${esc(store.motto)}</p>`:''}<p>${rating(store)} · ${number(store.playerVisits)} ${t('player visits', 'Spielerbesuche')}</p>${store.gooseGuard ? `<p class="store-goose">${t('Goose guard active · halves theft chance', 'Wachgans aktiv · halbiert Diebstahlchance')}</p>` : ''}</div></header>
      ${!account ? `<p class="store-notice"><a href="/login" data-page>${t('Sign in', 'Anmelden')}</a> ${t('to buy, review or make mischief.', 'zum Kaufen, Bewerten oder Unfugmachen.')}</p>` : ''}
      <section class="store-shelves"><div class="section-title-row"><h2>${t('On the shelves', 'In den Regalen')}</h2><a href="/inventory" data-page>${t('Your inventory', 'Dein Inventar')}</a></div>${eligible && store.heist?.outcome === 'active' ? `<p><button class="secondary-button" data-store="resume">${t('Resume attempt', 'Versuch fortsetzen')}</button></p>` : ''}${eligible && Date.now() < store.cooldownUntil ? `<p class="store-hint">${t('Next theft attempt available after', 'Nächster Diebstahlversuch ab')} ${new Date(store.cooldownUntil).toLocaleTimeString(uiLocale(),{hour:'2-digit',minute:'2-digit'})}. ${t('One attempt per player every 30 minutes; one per store every 5 minutes.', 'Ein Versuch pro Spieler alle 30 Minuten; pro Laden alle 5 Minuten.')}</p>` : ''}<div class="store-shelf-grid">${store.stock.length ? store.stock.map(entry => shelfCard(entry, store)).join('') : `<p class="collection-empty">${t('No items in stock.', 'Keine Waren im Regal.')}</p>`}</div></section>
      <section class="store-reviews"><h2>${t('Customer reviews', 'Kundenbewertungen')}</h2><p class="store-hint">${t('Only customers who bought an item here can review. One editable review per customer.', 'Nur Käufer dieses Ladens können bewerten. Eine bearbeitbare Bewertung pro Kunde.')}</p>${store.canReview ? reviewForm(review) : ''}<div class="store-review-list">${store.reviews.length ? store.reviews.map(review => `<article><header><strong>${esc(review.username)}</strong><span class="store-review-meta">${reviewStars(review.stars)}<span>${t('Verified purchase', 'Bestätigter Kauf')}</span></span></header><p>${esc(review.comment)}</p><small>${new Date(review.updatedAt).toLocaleDateString(uiLocale())}</small></article>`).join('') : `<p>${t('No reviews yet.', 'Noch keine Bewertungen.')}</p>`}</div></section>`;
  }
  function render() {
    if (currentAccountPage !== '/stores' || !data) return;
    accountContent.innerHTML = data.disabled ? pageHeading(t('Stores are unavailable.', 'Läden sind nicht verfügbar.')) : data.store ? detail(data.store) : directory();
    showEvents();
  }
  async function mutate(route, payload, retry = false) {
    let key;
    if (retry) {
      key = `jg:store-pending:${account.id}:${route}:${JSON.stringify(payload)}`;
      let id; try { id = localStorage.getItem(key); } catch {}
      payload = { ...payload, requestId: id || crypto.randomUUID() };
      try { localStorage.setItem(key, payload.requestId); } catch {}
    }
    try {
      const result = await accountApi(route, payload);
      if (key) try { localStorage.removeItem(key); } catch {}
      return result;
    } catch (error) {
      if (error.code && key) try { localStorage.removeItem(key); } catch {}
      throw error;
    }
  }
  function closeButton() { return `<button type="button" class="dialog-close" data-store="close-heist" aria-label="${t('Close', 'Schließen')}">×</button>`; }
  const colorName = color => color === 'red' ? t('Red', 'Rot') : t('Black', 'Schwarz');
  const rouletteCard = item => `<div class="roulette-card roulette-${item.rarity}"><span aria-hidden="true">${item.rarity === 'red' ? '◆' : '♠'}</span><strong>${colorName(item.rarity)}</strong></div>`;
  function openHeist(entry, button) {
    returnFocus = button; clearGameTimers(); game = { entry, choice: null };
    heistDialog.innerHTML = `<div class="store-heist-content roulette-content">${closeButton()}<p class="eyebrow">${t('PLAYER THEFT', 'SPIELERDIEBSTAHL')}</p><h2 id="store-heist-title">${t('Pick your color', 'Wähle deine Farbe')}</h2><h3>${esc(entry.item.title)}</h3><p>${t('Land on your color to steal this item. Both choices have the same odds; store security weights the result.', 'Lande auf deiner Farbe, um diesen Artikel zu stehlen. Beide Farben haben dieselbe Chance; die Ladensicherheit bestimmt die Gewichtung.')}</p><div class="roulette-choices" role="group" aria-label="${t('Choose a color', 'Farbe wählen')}">${['red','black'].map(color => `<button type="button" class="roulette-choice roulette-${color}" data-store="choose-color" data-color="${color}" aria-pressed="false"><span aria-hidden="true">${color === 'red' ? '◆' : '♠'}</span>${colorName(color)}</button>`).join('')}</div><dl class="roulette-quote"><div><dt>${t('Success chance', 'Erfolgschance')}</dt><dd>${entry.theft.chancePercent}%</dd></div><div><dt>${t('Attempt fee', 'Versuchsgebühr')}</dt><dd>${justizEuro(entry.theft.fee)}</dd></div></dl><p class="store-hint">${t('You pay on every attempt. The owner keeps the fee, even if you lose or close the spin. Repeated attempts lose value on average. One attempt every 30 minutes; one per store every 5 minutes.', 'Du zahlst bei jedem Versuch. Der Besitzer behält die Gebühr, auch wenn du verlierst oder das Drehen schließt. Wiederholte Versuche verlieren im Durchschnitt an Wert. Ein Versuch alle 30 Minuten; pro Laden alle 5 Minuten.')}</p><button class="primary-button" data-store="start-heist" disabled>${t('Pay fee & spin', 'Gebühr zahlen & drehen')} · ${justizEuro(entry.theft.fee)}</button><p class="account-error" role="alert"></p></div>`;
    heistDialog.showModal(); heistDialog.querySelector('[data-store="choose-color"]').focus();
  }
  function playHeist(attempt) {
    clearGameTimers(); game = { attempt, phase: 'finish' };
    heistDialog.innerHTML = `<div class="store-heist-content roulette-content">${closeButton()}<p class="eyebrow">${t('PLAYER THEFT', 'SPIELERDIEBSTAHL')}</p><h2 id="store-heist-title">${t('Red or black?', 'Rot oder Schwarz?')}</h2><p>${t('Your pick', 'Deine Wahl')}: <strong>${colorName(attempt.choice)}</strong> · ${attempt.chancePercent}%</p><div class="case-window roulette-window" aria-hidden="true"><div class="case-marker"></div><div class="case-reel">${Array.from({length:6}, (_,n) => rouletteCard({rarity:n%2?'black':'red'})).join('')}</div></div><p data-roulette-status role="status">${t('Spinning…', 'Die Rolle dreht sich …')}</p><p class="account-error" role="alert"></p><button class="secondary-button" data-store="retry-finish" hidden>${t('Resume spin', 'Drehen fortsetzen')}</button></div>`;
    if (!heistDialog.open) heistDialog.showModal();
    // Legacy paid attempts may still have a ready_at delay. New roulette
    // attempts settle immediately, before the shared case animation plays.
    later(() => finishHeist(), Math.max(0, attempt.readyAt - Date.now()));
  }
  const outcomes = {
    stolen: ['Color matched. You stole the item! It’s in your inventory.', 'Farbe getroffen. Artikel gestohlen! Er liegt in deinem Inventar.'],
    caught: ['Wrong color. No item this time.', 'Falsche Farbe. Diesmal kein Artikel.'],
    fumbled: ['This older attempt failed.', 'Dieser ältere Versuch ist gescheitert.'],
    gone: ['The item already left the shelf. Your attempt fee was spent.', 'Der Artikel ist bereits aus dem Regal verschwunden. Deine Versuchsgebühr wurde bezahlt.'],
    expired: ['This paid attempt expired. The fee stays with the owner.', 'Dieser bezahlte Versuch ist abgelaufen. Die Gebühr bleibt beim Besitzer.']
  };
  async function finishHeist() {
    if (!game?.attempt || busy) return;
    const visit = accountVisit, owner = account?.id, attempt = game.attempt, version = gameVersion;
    busy = true;
    try {
      const result = await accountApi('stores/heist/finish', { heistId: attempt.id });
      if (owner !== account?.id || visit !== accountVisit) return;
      updateAccount(result.user); await refresh(visit);
      if (version !== gameVersion || !heistDialog.open) return;
      const color = result.heist.color || (result.heist.outcome === 'stolen' ? attempt.choice : attempt.choice === 'red' ? 'black' : 'red');
      const reel = heistDialog.querySelector('.case-reel'), viewport = heistDialog.querySelector('.case-window');
      await spinCaseReel(reel, viewport, {rarity:color}, [{rarity:'red'},{rarity:'black'}], () => version === gameVersion && owner === account?.id && visit === accountVisit && heistDialog.open, rouletteCard);
      if (version !== gameVersion || !heistDialog.open || owner !== account?.id || visit !== accountVisit) return;
      game.phase = 'done';
      heistDialog.querySelector('[data-roulette-status]').innerHTML = `<strong>${colorName(color)}</strong> · ${t(...outcomes[result.heist.outcome])}`;
      heistDialog.querySelector('.account-error').textContent = '';
      heistDialog.querySelector('[data-store="retry-finish"]').hidden = true;
      heistDialog.querySelector('.roulette-content').insertAdjacentHTML('beforeend', `<p class="store-hint">${t('Attempt fee paid to the owner', 'Versuchsgebühr an den Besitzer gezahlt')}: ${justizEuro(result.heist.fee)}</p><div class="store-action-row">${result.heist.outcome === 'stolen' ? `<a href="/inventory" class="primary-button" data-page>${t('View inventory', 'Inventar ansehen')}</a>` : ''}<button class="secondary-button" data-store="close-heist">${t('Back to the store', 'Zurück zum Laden')}</button></div>`);
      heistDialog.querySelector('.store-action-row [data-store="close-heist"]').focus();
    } catch (error) {
      if (version === gameVersion && heistDialog.open) { heistDialog.querySelector('.account-error').textContent = error.message; heistDialog.querySelector('[data-store="retry-finish"]').hidden = false; }
    } finally { if (visit === accountVisit) { busy = false; render(); } }
  }
  heistDialog.addEventListener('close', () => {
    clearGameTimers(); game = null;
    if (currentAccountPage === '/stores') {
      render();
      const item = returnFocus?.dataset.item;
      const replacement = item ? accountContent.querySelector(`[data-store="heist"][data-item="${CSS.escape(item)}"]`) : accountContent.querySelector('[data-store="resume"]');
      (replacement && !replacement.disabled ? replacement : accountContent.querySelector('h1'))?.focus({preventScroll:true});
    }
    returnFocus = null;
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-store]'); if (!button || currentAccountPage !== '/stores') return;
    const action = button.dataset.store;
    if (action === 'close-heist') { heistDialog.close(); return; }
    if (action === 'choose-color') {
      if (busy || !game?.entry || !['red','black'].includes(button.dataset.color)) return;
      game.choice = button.dataset.color;
      heistDialog.querySelectorAll('[data-store="choose-color"]').forEach(entry => entry.setAttribute('aria-pressed', String(entry.dataset.color === game.choice)));
      heistDialog.querySelector('[data-store="start-heist"]').disabled = false;
      return;
    }
    if (action === 'retry-finish') { await finishHeist(); return; }
    if (busy || !account || !data?.store) return;
    const store = data.store, visit = accountVisit, owner = account.id;
    if (action === 'heist') { const entry = store.stock.find(entry => entry.id === button.dataset.item); if (entry) openHeist(entry, button); return; }
    if (action === 'resume') { if (store.heist?.outcome === 'active') { returnFocus = button; playHeist(store.heist); } return; }
    busy = true; button.disabled = true;
    try {
      let result;
      if (action === 'start-heist') {
        const entry = game?.entry; if (!entry || !['red','black'].includes(game.choice)) return;
        result = await mutate('stores/heist/start', { shopId: store.id, inventoryId: entry.id, expectedPrice: entry.price, expectedFee: entry.theft.fee, expectedChance: entry.theft.chancePercent, choice: game.choice }, true);
        if (visit !== accountVisit || owner !== account?.id) return;
        updateAccount(result.user); data = {store:result.store}; render();
        if (heistDialog.open && result.store.heist?.outcome === 'active') playHeist(result.store.heist);
        else { heistDialog.close(); await refresh(visit); }
        return;
      }
      if (action === 'buy') {
        const entry = store.stock.find(entry => entry.id === button.dataset.item); if (!entry) return;
        result = await mutate('stores/buy', { shopId: store.id, inventoryId: entry.id, expectedPrice: entry.price }, true);
      }
      if (action === 'tip') result = await mutate('stores/tip', { shopId: store.id, amount: Number(button.dataset.amount) }, true);
      if (action === 'react') result = await mutate('stores/react', { shopId: store.id, reaction: button.dataset.reaction });
      if (visit !== accountVisit || owner !== account?.id) return;
      if (result?.user) updateAccount(result.user);
      await refresh(visit);
      showToast(action === 'buy' ? t('Bought! Find it in your inventory.', 'Gekauft! Schau in dein Inventar.') : action === 'tip' ? t('A little kindness in the tip jar.', 'Eine kleine Nettigkeit für die Trinkgeldkasse.') : button.dataset.reaction === 'joke' ? t('Why did the price tag blush? It saw the bottom line.', 'Warum wurde das Preisschild rot? Es sah die nackten Zahlen.') : button.dataset.reaction === 'bell' ? t('Ding ding! Excellent bell. Five stars.', 'Ding dong! Hervorragende Klingel. Fünf Sterne.') : t('A standing ovation for these shelves!', 'Standing Ovations für diese Regale!'));
    } catch (error) {
      if (visit === accountVisit && owner === account?.id) {
        if (heistDialog.open) heistDialog.querySelector('.account-error').textContent = error.message;
        else showToast(error.message);
        if (['store_price_changed','store_risk_changed','stock_not_found','heist_cooldown'].includes(error.code)) {
          if (heistDialog.open) { heistDialog.close(); showToast(error.message); }
          await refresh(visit).catch(() => {});
        }
      }
    } finally { if (visit === accountVisit) { busy = false; if (button.isConnected) button.disabled = false; render(); } }
  });
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (currentAccountPage === '/stores' && form.matches('.store-search')) {
      event.preventDefault(); const params = new URLSearchParams(new FormData(form)); await navigateAccountPage(`/stores?${params}`); return;
    }
    const profile = ['/businesses', '/stores'].includes(currentAccountPage) && form.matches('[data-store-profile]');
    const review = currentAccountPage === '/stores' && form.matches('.store-review-form');
    if (!profile && !review) return;
    event.preventDefault(); if (busy || !account) return;
    const visit = accountVisit, owner = account.id; busy = true; const button = form.querySelector('[type="submit"]'); button.disabled = true;
    try {
      const result = profile ? await mutate('businesses/profile', { shopId: form.dataset.shop, name: form.elements.storeName.value, motto: form.elements.motto.value, gooseGuard: form.elements.gooseGuard.checked }, true)
        : await mutate('stores/review', { shopId: data.store.id, stars: Number(form.elements.stars.value), comment: form.elements.comment.value });
      if (visit !== accountVisit || owner !== account?.id) return;
      if (result.user) updateAccount(result.user);
      if (profile) { await window.businessUi.refresh(visit, false); window.businessUi.render(); }
      else await refresh(visit);
      showToast(t('Saved.', 'Gespeichert.'));
    } catch (error) { if (visit === accountVisit) form.querySelector('.account-error').textContent = error.message; }
    finally { if (visit === accountVisit) { busy = false; if (button.isConnected) button.disabled = false; } }
  });
  document.addEventListener('jg:language', () => { if (currentAccountPage === '/stores') render(); if (eventDialog.open) showEvents(true); });
  return { load, stop, render, loadEvents, showEvents };
})();
