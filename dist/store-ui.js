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
    if (!response.ok) { const error = new Error(accountError(result.error)); error.code = result.error; if(result.justice&&account){account.justice=result.justice;window.justiceUi?.sync(account);} throw error; }
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
  function fineEstimate(fine) {
    // Broad, rounded guidance; the authoritative fine stays unchanged.
    const step=10**Math.max(1,Math.floor(Math.log10(Math.max(1,fine)))-1);
    const lower=Math.max(0,Math.floor(fine*.8/step)*step),upper=Math.ceil(fine*1.2/step)*step;
    return `${justizEuro(lower)} – ${justizEuro(upper)}`;
  }
  function estimatedFine(fine) {
    return `<div class="blackjack-risk"><span>${t('Estimated fine if caught','Geschätztes Bußgeld bei Erwischtwerden')}</span><strong>${fineEstimate(fine)}</strong></div>`;
  }
  function shelfCard(entry, store) {
    const available = account && !store.own;
    const cooling = Date.now() < store.cooldownUntil;
    return `<article class="store-shelf-card">${entry.item.image ? `<img src="${esc(entry.item.image)}" alt="" loading="lazy">` : `<div class="store-item-placeholder" aria-hidden="true">${esc(symbols[store.type])}</div>`}<div class="store-shelf-info"><h3>${esc(entry.item.title)}</h3><p class="store-price">${justizEuro(entry.price)}</p><div class="store-action-row"><button class="primary-button" data-store="buy" data-item="${esc(entry.id)}" ${!available || busy || account.tokens < entry.price ? 'disabled' : ''}>${t('Buy', 'Kaufen')} · ${justizEuro(entry.price)}</button>${entry.theft ? `<button class="secondary-button" data-store="heist" data-item="${esc(entry.id)}" ${!available || busy || cooling ? 'disabled' : ''}>${t('Try to steal', 'Diebstahl versuchen')}</button><small>${t('Estimated fine', 'Geschätztes Bußgeld')}: ${fineEstimate(entry.theft.fine)}</small>` : ''}</div></div></article>`;
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
    return `<p><a href="/stores" data-page>← ${t('All stores', 'Alle Läden')}</a></p><header class="store-front store-type-${esc(store.type)}"><div class="store-awning" aria-hidden="true"><span>${esc(symbols[store.type])}</span></div><div><p class="eyebrow">${esc(typeName(store.type))} · ${esc(store.owner)}</p>${pageHeading(esc(storeTitle(store)))}${store.location ? `<p><a href="/town?plot=${encodeURIComponent(store.location.plotId)}" data-page>${store.location.districtNumber}. ${esc(store.location.districtName)} · ${esc(store.location.streetName)} ↗</a></p>` : ''}${store.motto?`<p>${esc(store.motto)}</p>`:''}<p>${rating(store)} · ${number(store.playerVisits)} ${t('player visits', 'Spielerbesuche')}</p>${store.gooseGuard ? `<p class="store-goose">${t('Goose guard active · doubles the theft fine', 'Wachgans aktiv · verdoppelt das Diebstahlbußgeld')}</p>` : ''}</div></header>
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
  function heistIntro(entry) {
    heistDialog.innerHTML=`<div class="store-heist-content blackjack-content blackjack-intro">${closeButton()}<p class="eyebrow">${t('PLAYER THEFT','SPIELERDIEBSTAHL')}</p><h2 id="store-heist-title">${t('A risky hand','Ein riskantes Blatt')}</h2><div class="blackjack-target">${entry.item.image?`<img src="${esc(entry.item.image)}" alt="">`:`<span aria-hidden="true">♠</span>`}<div><small>${t('Your target','Dein Ziel')}</small><h3>${esc(entry.item.title)}</h3></div></div><p class="blackjack-intro-copy">${t('Beat the dealer to steal it. Lose and you get caught. A tie means no loot and no fine.','Schlage den Dealer, um den Artikel zu stehlen. Verlierst du, wirst du erwischt. Bei Gleichstand gibt es weder Beute noch Bußgeld.')}</p>${estimatedFine(entry.theft.fine)}<button class="primary-button blackjack-start" data-store="start-heist">${t('Deal cards · free','Karten geben · kostenlos')}</button><p class="store-hint blackjack-commitment">${t('Finish within 10 minutes. Leaving does not cancel the hand.','Beende das Blatt innerhalb von 10 Minuten. Verlassen bricht es nicht ab.')}</p><details class="blackjack-details"><summary>${t('Rules & consequences','Regeln & Folgen')}</summary><div><p>${t('Get closer to 21 than the dealer without going over. Aces count as 1 or 11, face cards as 10. The dealer stands on all 17s. A two-card blackjack beats any other 21. One fair 52-card deck; no splits or doubles.','Komme näher an 21 als der Dealer, ohne sie zu überschreiten. Asse zählen 1 oder 11, Bildkarten 10. Der Dealer hält bei jeder 17. Blackjack mit zwei Karten schlägt jede andere 21. Ein fairer Stapel mit 52 Karten; kein Teilen oder Verdoppeln.')}</p><p>${t('Fines are collected from your balance first, then your belongings. If nothing remains, unpaid debt leads to jail; repeat offences mean longer sentences.','Bußgeld wird zuerst vom Guthaben eingezogen, danach werden deine Sachen gepfändet. Bleibt nichts übrig, führt die offene Schuld zu Haft; wiederholte Vergehen verlängern die Haft.')}</p><p>${t('An unfinished hand counts as caught after 10 minutes. One attempt per player every 30 minutes, and per store every 5 minutes.','Ein unvollendetes Blatt zählt nach 10 Minuten als erwischt. Ein Versuch pro Spieler alle 30 Minuten, pro Laden alle 5 Minuten.')}</p></div></details><p class="account-error" role="alert"></p></div>`;
  }
  function openHeist(entry, button) {
    returnFocus=button;clearGameTimers();game={entry};heistIntro(entry);
    heistDialog.showModal();heistDialog.querySelector('[data-store="start-heist"]').focus();
  }
  function cardMarkup(card) {
    if(card===null)return `<div class="blackjack-card is-hidden" aria-label="${t('Hidden dealer card','Verdeckte Dealerkarte')}"><span aria-hidden="true">JG</span></div>`;
    const rank=['A','2','3','4','5','6','7','8','9','10','J','Q','K'][card%13],suit=['♣','♦','♥','♠'][Math.floor(card/13)];
    return `<div class="blackjack-card ${suit==='♥'||suit==='♦'?'is-red':''}" aria-label="${esc(rank+' '+suit)}"><strong>${rank}</strong><span aria-hidden="true">${suit}</span><small>${rank}</small></div>`;
  }
  const outcomes={stolen:['You beat the dealer. The stolen item is in your inventory.','Du hast den Dealer geschlagen. Der gestohlene Artikel liegt in deinem Inventar.'],caught:['Caught! The fine is being enforced.','Erwischt! Das Bußgeld wird vollstreckt.'],push:['A tie. You leave empty-handed, without a fine.','Gleichstand. Du gehst ohne Beute und ohne Bußgeld.'],gone:['You won, but the item already left the shelf. No fine.','Du hast gewonnen, aber der Artikel hat das Regal bereits verlassen. Kein Bußgeld.'],expired:['This older paid attempt expired.','Dieser ältere bezahlte Versuch ist abgelaufen.'],fumbled:['This older attempt failed.','Dieser ältere Versuch ist gescheitert.']};
  function paintBlackjack() {
    const attempt=game?.attempt;if(!attempt)return;
    const hand=attempt.blackjack,active=attempt.outcome==='active',fine=attempt.consequence;
    heistDialog.innerHTML=`<div class="store-heist-content blackjack-content">${closeButton()}<p class="eyebrow">${t('PLAYER THEFT','SPIELERDIEBSTAHL')}</p><h2 id="store-heist-title">${t('Blackjack getaway','Blackjack-Flucht')}</h2>${hand?`<div class="blackjack-table"><section><h3>${t('Dealer','Dealer')} <span>${hand.dealerTotal??'?'}</span></h3><div class="blackjack-hand">${hand.dealer.map(cardMarkup).join('')}</div></section><section><h3>${t('Your hand','Dein Blatt')} <span>${hand.playerTotal}</span></h3><div class="blackjack-hand">${hand.player.map(cardMarkup).join('')}</div></section></div>`:''}<p class="blackjack-status" role="status">${active?t('Get closer to 21 than the dealer without going over.','Komme näher an 21 als der Dealer, ohne sie zu überschreiten.'):t(...(outcomes[attempt.outcome]||outcomes.expired))}</p>${active&&hand?`${estimatedFine(attempt.fine)}<p class="store-hint">${t('Finish before','Beende das Blatt vor')} ${new Date(attempt.expiresAt).toLocaleTimeString(uiLocale())}. ${t('Leaving does not cancel the attempt.','Verlassen bricht den Versuch nicht ab.')}</p><div class="blackjack-actions"><button class="primary-button" data-store="hit" ${busy?'disabled':''}>${t('Hit · take a card','Ziehen · eine Karte')}</button><button class="secondary-button" data-store="stand" ${busy?'disabled':''}>${t('Stand · hold your hand','Halten · Blatt behalten')}</button></div>`:active?`<p>${t('Resume this older paid attempt.','Setze diesen älteren bezahlten Versuch fort.')}</p><button class="primary-button" data-store="retry-finish">${t('Finish attempt','Versuch abschließen')}</button>`:''}${fine?`<div class="blackjack-consequence"><h3>${t('Gerichtsvollzieher · bailiff','Gerichtsvollzieher')}</h3><p>${t('Fine','Bußgeld')}: ${justizEuro(attempt.fine)} · ${t('Cash collected','Guthaben eingezogen')}: ${justizEuro(fine.paidCash)}</p>${fine.seized.length?`<ul>${fine.seized.map(item=>`<li>${esc(item.title)} · ${justizEuro(item.value)}</li>`).join('')}</ul>`:`<p>${t('No inventory seized.','Kein Inventar gepfändet.')}</p>`}${fine.remainingFine?`<p>${t('Remaining fine','Offenes Bußgeld')}: ${justizEuro(fine.remainingFine)}. ${t('Collected when assets become available. New theft attempts are blocked until paid.','Wird bei verfügbarem Vermögen eingezogen. Neue Diebstahlversuche sind bis zur Zahlung gesperrt.')}</p>`:''}</div>`:''}<p class="account-error" role="alert"></p>${!active?`<div class="store-action-row">${attempt.outcome==='stolen'?`<a href="/inventory" data-page class="primary-button">${t('View inventory','Inventar ansehen')}</a>`:''}<button class="secondary-button" data-store="close-heist">${t('Back to store','Zurück zum Laden')}</button></div>`:''}</div>`;
  }
  function playHeist(attempt) {clearGameTimers();game={attempt};paintBlackjack();if(!heistDialog.open)heistDialog.showModal();heistDialog.querySelector('[data-store="hit"], [data-store="close-heist"], [data-store="retry-finish"]')?.focus();}
  async function moveBlackjack(action) {
    if(!game?.attempt||busy)return;
    const visit=accountVisit,owner=account.id,attempt=game.attempt;busy=true;paintBlackjack();
    try {
      const result=await mutate('stores/heist/action',{heistId:attempt.id,action,turn:attempt.blackjack.turn},true);
      if(visit!==accountVisit||owner!==account?.id)return;
      game.attempt=result.heist;updateAccount(result.user);
      if(account.justice?.jailed)return;
      busy=false;paintBlackjack();await refresh(visit);heistDialog.querySelector(`[data-store="${result.heist.outcome==='active'?action:'close-heist'}"]`)?.focus();
    }catch(error){if(visit===accountVisit&&heistDialog.open){busy=false;paintBlackjack();heistDialog.querySelector('.account-error').textContent=error.message;if(error.code==='blackjack_turn_changed'){await refresh(visit);if(data.store.heist)playHeist(data.store.heist);}}}
    finally{if(visit===accountVisit){busy=false;if(!account?.justice?.jailed)render();}}
  }
  async function finishHeist() {
    if(!game?.attempt||busy)return;busy=true;
    try{const result=await accountApi('stores/heist/finish',{heistId:game.attempt.id});updateAccount(result.user);game.attempt=result.heist;paintBlackjack();await refresh(accountVisit);}
    catch(error){if(heistDialog.open)heistDialog.querySelector('.account-error').textContent=error.message;}
    finally{busy=false;}
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
    if (['hit','stand'].includes(action)) {await moveBlackjack(action);return;}
    if (action === 'retry-finish') { await finishHeist(); return; }
    if (busy || !account || !data?.store) return;
    const store = data.store, visit = accountVisit, owner = account.id;
    if (action === 'heist') { const entry = store.stock.find(entry => entry.id === button.dataset.item); if (entry) openHeist(entry, button); return; }
    if (action === 'resume') { if (store.heist?.outcome === 'active') { returnFocus = button; playHeist(store.heist); } return; }
    busy = true; button.disabled = true;
    try {
      let result;
      if (action === 'start-heist') {
        const entry = game?.entry; if (!entry) return;
        result = await mutate('stores/heist/start', { shopId: store.id, inventoryId: entry.id, expectedPrice: entry.price, expectedFine:entry.theft.fine }, true);
        if (visit !== accountVisit || owner !== account?.id) return;
        updateAccount(result.user);
        if(account.justice?.jailed)return;
        data={store:result.store};render();busy=false;
        if(heistDialog.open)playHeist(result.store.heist || result.heist);
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
  document.addEventListener('jg:language', () => { if(heistDialog.open){if(game?.attempt)paintBlackjack();else if(game?.entry)heistIntro(game.entry);} if (currentAccountPage === '/stores') render(); if (eventDialog.open) showEvents(true); });
  return { load, stop, render, loadEvents, showEvents };
})();
