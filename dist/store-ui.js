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
  function rating(store) { return store.rating === null ? t('No reviews yet', 'Noch keine Bewertungen') : `★ ${number(store.rating, 1)} / 5 · ${number(store.reviewCount)} ${t(store.reviewCount===1?'review':'reviews',store.reviewCount===1?'Bewertung':'Bewertungen')}`; }
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
  const visitorIcons={bag:'<path d="M4 7h16l1 14H3L4 7Zm4 0V5a4 4 0 0 1 8 0v2"/>',cards:'<rect x="3" y="3" width="12" height="16" rx="2"/><path d="m16 5 5 2-4 14-5-2M7 8h4m-2-2v4"/>',shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',bell:'<path d="M5 16v-5a7 7 0 0 1 14 0v5l2 2H3l2-2Zm5 5h4M12 2v2"/>',smile:'<circle cx="12" cy="12" r="9"/><path d="M8 9h.01M16 9h.01M8 14c2 3 6 3 8 0"/>'};
  const visitorIcon=id=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${visitorIcons[id]||visitorIcons.star}</svg>`;
  const stockGroupKey=entry=>JSON.stringify([entry.item.title,entry.item.image,entry.item.rarity,entry.price,entry.theft?.fine]);
  function groupedStock(stock){
    const groups=new Map();for(const entry of stock){const key=stockGroupKey(entry);if(!groups.has(key))groups.set(key,{...entry,groupKey:key,quantity:0});groups.get(key).quantity++;}return [...groups.values()];
  }
  function shelfCard(entry, store) {
    const available=Boolean(account&&!store.own),cooling=Date.now()<store.cooldownUntil,unpaid=Boolean(account?.justice?.fineDue),affordable=available&&account.tokens>=entry.price;
    const rarity=['common','uncommon','rare','epic','legendary'].includes(entry.item.rarity)?entry.item.rarity:'common';
    return `<article class="store-shelf-card visitor-stock-card rarity-${rarity}" data-stock-group="${esc(entry.groupKey)}"><div class="visitor-stock-media"><span class="visitor-rarity">${rarityLabel(rarity)}</span><span class="visitor-stock-quantity">×${number(entry.quantity)} <small>${t('in stock','im Regal')}</small></span>${entry.item.image?`<img src="${esc(entry.item.image)}" alt="" loading="lazy">`:`<div class="visitor-stock-placeholder" aria-hidden="true">${window.townArtwork.icon(store.type)}</div>`}</div><div class="store-shelf-info"><h3>${esc(entry.item.title)}</h3><div class="visitor-stock-price"><strong>${justizEuro(entry.price)}</strong><span>${t('per item','pro Artikel')}</span></div><div class="visitor-stock-actions"><button type="button" class="primary-button" data-store="buy" data-item="${esc(entry.id)}" data-stock-group="${esc(entry.groupKey)}" ${!affordable||busy?'disabled':''}>${visitorIcon('bag')}${entry.quantity>1?t('Buy one','Ein Exemplar kaufen'):t('Buy item','Artikel kaufen')} <span aria-hidden="true">→</span></button>${entry.theft?`<button type="button" class="visitor-steal-button" data-store="heist" data-item="${esc(entry.id)}" title="${esc(t('Estimated fine if caught','Geschätztes Bußgeld bei Erwischtwerden')+': '+fineEstimate(entry.theft.fine))}" ${!available||busy||cooling||unpaid?'disabled':''}>${visitorIcon('cards')}${t('Try to steal','Diebstahl versuchen')}</button>`:''}</div>${available&&!affordable?`<small class="visitor-balance-hint">${t('Need','Es fehlen')} ${justizEuro(entry.price-account.tokens)} ${t('more to buy','zum Kaufen')}</small>`:''}</div></article>`;
  }
  function visitorHero(store){
    const initial=[...store.owner][0]?.toLocaleUpperCase(uiLocale())||'?';
    return `<header class="store-front visitor-hero"><div class="visitor-hero-copy"><p class="eyebrow">${window.townArtwork.icon(store.type)}${esc(typeName(store.type))} · ${t('PLAYER STORE','SPIELERLADEN')}</p><h1 tabindex="-1">${esc(store.name||typeName(store.type))}</h1><div class="visitor-owner"><span aria-hidden="true">${esc(initial)}</span><div><small>${t('Run by','Geführt von')}</small><strong>@${esc(store.owner)}</strong></div></div>${store.motto?`<p class="visitor-motto">${esc(store.motto)}</p>`:''}<div class="visitor-hero-chips"><a class="visitor-rating-link" href="#store-reviews">${visitorIcon('star')}${rating(store).replace(/^★ /,'')}</a><span>${visitorIcon('bag')}${number(store.stock.length)} ${t(store.stock.length===1?'item on shelves':'items on shelves',store.stock.length===1?'Artikel im Regal':'Artikel im Regal')}</span>${store.gooseGuard?`<span class="visitor-guard">${visitorIcon('shield')}${t('Goose guard on watch','Wachgans im Dienst')}</span>`:''}</div>${store.location?`<a class="visitor-address" href="/town?plot=${encodeURIComponent(store.location.plotId)}" data-page>${store.location.districtNumber}. ${esc(store.location.districtName)} · ${esc(store.location.streetName)} ↗</a>`:''}</div><div class="visitor-hero-art" aria-hidden="true"><div class="visitor-shop-illustration">${window.townArtwork.storefront()}<span>${window.townArtwork.icon(store.type)}</span></div><span class="visitor-shop-sign">${t('FIND YOUR NEXT TREASURE','FINDE DEINEN NÄCHSTEN SCHATZ')}</span></div></header>`;
  }
  function visitorReactions(store){
    const reactions=[['applause','star',t('Applaud','Applaudieren')],['bell','bell',t('Ring the bell','Klingeln')],['joke','smile',t('Tell a joke','Witz erzählen')]];
    return `<section class="visitor-reactions" tabindex="-1" aria-label="${t('Say hello to the shop','Sag dem Laden Hallo')}"><div><strong>${t('Say hello','Sag Hallo')}</strong><p>${t('A little good energy for the shopkeeper.','Ein bisschen gute Laune für den Ladenbesitzer.')}</p></div><div class="visitor-reaction-buttons">${reactions.map(([id,icon,label])=>{const used=store.myReactions.includes(id),count=store.reactions.find(entry=>entry.reaction===id)?.count||0;return `<button type="button" data-store="react" data-reaction="${id}" aria-pressed="${used}" title="${esc(used?t('Already sent today','Heute schon gesendet'):label)}" ${!account||busy||used?'disabled':''}>${visitorIcon(icon)}<span>${label}</span><small>${used?'✓':number(count)}</small></button>`;}).join('')}</div></section>`;
  }
  function reviewStars(stars) {
    return `<span class="store-review-stars" role="img" aria-label="${stars} ${t('out of 5 stars', 'von 5 Sternen')}">${[1,2,3,4,5].map(value => `<span aria-hidden="true" class="${value <= stars ? 'is-filled' : ''}">★</span>`).join('')}</span>`;
  }
  function reviewCard(review) {
    const voices = [null, ['Known voice', 'Bekannte Stimme'], ['Influential voice', 'Einflussreiche Stimme'], ['Leading voice', 'Meinungsführer']];
    const comments = {
      bargain: ['Great value. Very happy with my purchase!', 'Tolles Preis-Leistungs-Verhältnis. Mit meinem Kauf sehr zufrieden!'],
      fair: ['A fair price. Happy with my purchase.', 'Ein fairer Preis. Mit meinem Kauf zufrieden.'],
      price_high: ['Found what I wanted, but the price was too high.', 'Gefunden, was ich wollte, aber der Preis war zu hoch.']
    };
    const comment = review.npc && comments[review.feedback] ? t(...comments[review.feedback]) : review.comment;
    const support = t('Influence attracts community support. Agreeing NPC shoppers and players can add likes.', 'Einfluss bringt Unterstützung aus der Community. Zustimmende NPC-Kunden und Spieler können Likes hinzufügen.');
    const label = review.liked ? t('Unlike review', 'Like zurücknehmen') : t('Like review', 'Bewertung liken');
    const content = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M7 10H3v11h4m0-11 5-7c1-1 3 0 2 3l-1 4h6c2 0 2 2 1 4l-2 6H7V10Z"/></svg><span>${number(review.likes)} ${t('likes', 'Likes')}</span>`;
    return `<article class="store-review-card ${review.npc ? 'is-npc' : 'is-player'}" data-reviewer="${esc(review.reviewerId)}"><header><div class="store-review-author"><strong>${esc(review.username)}</strong>${review.npc ? `<span class="store-review-kind">${t('NPC customer', 'NPC-Kunde')}</span>` : voices[review.influenceRank] ? `<span class="store-review-influence">${t(...voices[review.influenceRank])}</span>` : ''}</div>${reviewStars(review.stars)}</header>${comment ? `<p>${esc(comment)}</p>` : ''}<footer><small>${review.npc ? t('Purchased here', 'Hier eingekauft') : t('Verified purchase', 'Bestätigter Kauf')} · ${new Date(review.updatedAt).toLocaleDateString(uiLocale())}</small>${review.canLike ? `<button type="button" class="store-review-like ${review.liked ? 'is-liked' : ''}" data-store="like-review" data-reviewer="${esc(review.reviewerId)}" aria-pressed="${review.liked}" aria-label="${esc(label)} · ${number(review.likes)} ${t('likes', 'Likes')}" title="${esc(support)}" ${busy ? 'disabled' : ''}>${content}</button>` : `<span class="store-review-like" title="${esc(support)}">${content}</span>`}</footer></article>`;
  }
  function reviewList(store) {
    const players = store.reviews.filter(review => !review.npc), npcs = store.reviews.filter(review => review.npc);
    return `<div class="store-review-list">${players.map(reviewCard).join('')}${npcs.length ? `<h3 class="store-npc-review-heading">${t('From NPC shoppers', 'Von NPC-Kunden')}</h3>${npcs.map(reviewCard).join('')}` : ''}${!players.length && !npcs.length ? `<p>${t('No reviews yet.', 'Noch keine Bewertungen.')}</p>` : ''}</div>`;
  }
  function reviewForm(review) {
    return `<form class="store-review-form"><fieldset class="store-rating"><legend>${t('Your rating', 'Deine Bewertung')}</legend><div class="store-star-picker">${[1,2,3,4,5].map(stars => `<label class="store-star-option"><input type="radio" name="stars" value="${stars}" aria-label="${stars} ${stars === 1 ? t('star', 'Stern') : t('stars', 'Sterne')} / 5" ${review?.stars === stars ? 'checked' : ''} required><span class="store-star-symbol" aria-hidden="true">★</span></label>`).join('')}</div></fieldset><label>${t('Your review', 'Dein Bewertungstext')}<textarea name="comment" maxlength="240" rows="4" placeholder="${t('Tell others about your visit…', 'Erzähle anderen von deinem Besuch …')}">${esc(review?.comment || '')}</textarea><small class="store-hint">${t('Up to 240 characters.', 'Bis zu 240 Zeichen.')}</small></label><button class="primary-button" type="submit">${t('Save review', 'Bewertung speichern')}</button><p class="account-error" role="alert"></p></form>`;
  }
  function detail(store) {
    if (store.own) return window.businessUi.ownerView(store) + `<details class="store-owner-reviews"><summary>${t('Customer reviews', 'Kundenbewertungen')} <span>${number(store.reviewCount)}</span></summary>${reviewList(store)}</details>`;
    const eligible=Boolean(account),groups=groupedStock(store.stock),active=store.heist?.outcome==='active',cooling=Date.now()<store.cooldownUntil;
    return `<div class="visitor-storefront store-type-${esc(store.type)}" data-visitor-shop="${esc(store.id)}" data-visitor-account="${esc(account?.id||'')}"><nav class="visitor-breadcrumbs" aria-label="${t('Store navigation','Ladennavigation')}"><a href="/stores" data-page>← ${t('All stores','Alle Läden')}</a>${account?`<a href="/inventory" data-page>${t('Your inventory','Dein Inventar')} ↗</a>`:''}</nav>${visitorHero(store)}
      ${!account?`<section class="store-notice visitor-login"><div><strong>${t('Your next find is waiting.','Dein nächster Fund wartet.')}</strong><p>${t('Sign in to buy, review or try your luck at stealing.','Melde dich an, um zu kaufen, zu bewerten oder einen Diebstahl zu versuchen.')}</p></div><a href="/login" data-page class="primary-button">${t('Sign in','Anmelden')} →</a></section>`:''}
      <section class="store-shelves"><div class="visitor-section-heading"><div><p class="eyebrow">${t('THE SHOPKEEPER’S PICKS','DIE AUSWAHL DES LADENBESITZERS')}</p><h2 id="store-stock-title" tabindex="-1">${t('On the shelves','In den Regalen')}</h2></div><span>${number(store.stock.length)} ${t(store.stock.length===1?'item':'items',store.stock.length===1?'Artikel':'Artikel')}</span></div>${eligible&&(active||cooling||account.justice?.fineDue)?`<div class="visitor-theft-status" role="status">${visitorIcon('cards')}<span>${active?t('Your blackjack hand is still in play.','Deine Blackjack-Runde läuft noch.'):account.justice?.fineDue?t('Settle your outstanding fine before another theft attempt.','Begleiche dein offenes Bußgeld vor einem weiteren Diebstahlversuch.'):`${t('Next theft attempt after','Nächster Diebstahlversuch ab')} ${new Date(store.cooldownUntil).toLocaleTimeString(uiLocale(),{hour:'2-digit',minute:'2-digit'})}`}</span>${active?`<button type="button" class="secondary-button" data-store="resume">${t('Resume attempt','Versuch fortsetzen')} →</button>`:''}</div>`:''}<div class="store-shelf-grid">${groups.length?groups.map(entry=>shelfCard(entry,store)).join(''):`<div class="visitor-empty">${window.townArtwork.icon(store.type)}<h3>${t('The shelves are empty for now.','Die Regale sind gerade leer.')}</h3><p>${t('Explore the neighbourhood for your next find.','Entdecke die Nachbarschaft für deinen nächsten Fund.')}</p><a class="secondary-button" href="/stores" data-page>${t('Explore other stores','Andere Läden entdecken')} →</a></div>`}</div></section>
      ${visitorReactions(store)}<section class="store-reviews visitor-reviews" id="store-reviews"><div class="visitor-section-heading"><div><p class="eyebrow">${t('WORD ON THE STREET','DAS GESPRÄCH DER NACHBARSCHAFT')}</p><h2>${t('Customer reviews','Kundenbewertungen')}</h2></div><span>${number(store.reviewCount)}</span></div>${store.canReview?`<details class="visitor-review-compose"><summary>${visitorIcon('star')}${store.myReview?t('Edit your review','Deine Bewertung bearbeiten'):t('Write a review','Bewertung schreiben')} →</summary>${reviewForm(store.myReview)}</details>`:`<p class="store-hint">${t('Buy an item here to leave a verified review.','Kaufe hier einen Artikel, um eine verifizierte Bewertung zu schreiben.')}</p>`}${reviewList(store)}</section></div>`;
  }
  function render() {
    if (currentAccountPage !== '/stores' || !data) return;
    const old=accountContent.querySelector('.visitor-storefront'),oldForm=old?.querySelector('.store-review-form');
    const draft=oldForm&&old.dataset.visitorShop===data.store?.id&&old.dataset.visitorAccount===(account?.id||'')?{open:oldForm.closest('details').open,comment:oldForm.elements.comment.value,stars:oldForm.elements.stars.value}:null;
    accountContent.innerHTML = data.disabled ? pageHeading(t('Stores are unavailable.', 'Läden sind nicht verfügbar.')) : data.store ? detail(data.store) : directory();
    const form=accountContent.querySelector('.visitor-review-compose .store-review-form');
    if(draft&&form){form.closest('details').open=draft.open;form.elements.comment.value=draft.comment;const star=form.querySelector(`input[name="stars"][value="${draft.stars}"]`);if(star)star.checked=true;}
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
      if (action === 'like-review') {
        const review = store.reviews.find(review => review.reviewerId === button.dataset.reviewer);
        if (!review?.canLike) return;
        await mutate('stores/review/like', { shopId:store.id, reviewerId:review.reviewerId, liked:!review.liked });
        if (visit !== accountVisit || owner !== account?.id) return;
        await refresh(visit);
        return;
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
    } finally { if (visit === accountVisit) {
      busy = false; if (button.isConnected) button.disabled = false; render();
      if (action === 'buy') {const next=[...accountContent.querySelectorAll('[data-store="buy"]')].find(node=>node.dataset.stockGroup===button.dataset.stockGroup);(next&&!next.disabled?next:accountContent.querySelector('#store-stock-title'))?.focus({preventScroll:true});}
      if (action === 'react') accountContent.querySelector('.visitor-reactions')?.focus({preventScroll:true});
      if (action === 'like-review') accountContent.querySelector(`.store-review-like[data-reviewer="${CSS.escape(button.dataset.reviewer)}"]`)?.focus({preventScroll:true});
    } }
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
    const visit = accountVisit, owner = account.id; busy = true; let saved=false; const button = form.querySelector('[type="submit"]'); button.disabled = true;
    try {
      const result = profile ? await mutate('businesses/profile', { shopId: form.dataset.shop, name: form.elements.storeName.value, motto: form.elements.motto.value, gooseGuard: form.elements.gooseGuard.checked }, true)
        : await mutate('stores/review', { shopId: data.store.id, stars: Number(form.elements.stars.value), comment: form.elements.comment.value });
      if (visit !== accountVisit || owner !== account?.id) return;
      if (result.user) updateAccount(result.user);
      if (profile) { await window.businessUi.refresh(visit, false); window.businessUi.render(); }
      else await refresh(visit);
      saved=true;showToast(t('Saved.', 'Gespeichert.'));
    } catch (error) { if (visit === accountVisit) form.querySelector('.account-error').textContent = error.message; }
    finally { if (visit === accountVisit) { busy = false; if (button.isConnected) button.disabled = false; if(review&&saved){render();accountContent.querySelector('.store-review-form button[type="submit"]')?.focus({preventScroll:true});} } }
  });
  document.addEventListener('jg:language', () => { if(heistDialog.open){if(game?.attempt)paintBlackjack();else if(game?.entry)heistIntro(game.entry);} if (currentAccountPage === '/stores') render(); if (eventDialog.open) showEvents(true); });
  return { load, stop, render, loadEvents, showEvents };
})();
