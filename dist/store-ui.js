window.storeUi = (() => {
  const esc = accountEscape;
  const names = { wine: ['Wine store', 'Weinhandlung'], toys: ['Toy store', 'Spielwarenladen'], electronics: ['Electronics store', 'Elektronikladen'], cars: ['Car dealership', 'Autohaus'], jeweler: ['Jeweler','Juwelier'], hardware: ['Hardware store','Baumarkt'] };
  const symbols = { wine: 'VIN', toys: 'TOY', electronics: 'TECH', cars: 'AUTO', jeweler: 'GEM', hardware: 'DIY' };
  const typeName = type => names[type] ? t(...names[type]) : type;
  let data = null, timer = null, generation = 0, busy = false, game = null, gameVersion = 0, timers = [], returnFocus = null;
  let lastAction = null;
  let wheelAnimation = null, pendingPoliceUser = null;
  function applyPoliceUser() { const user=pendingPoliceUser; pendingPoliceUser=null; if(user && account?.id===user.id && !account.justice?.jailed) updateAccount(user); }
  let eventQueue = [], eventOwner = null, eventPending = false, eventReturnFocus = null;
  const eventDialog = document.createElement('dialog');
  eventDialog.className = 'store-event-dialog'; eventDialog.setAttribute('aria-labelledby', 'store-event-title'); document.body.append(eventDialog);
  const heistDialog = document.createElement('dialog');
  heistDialog.className = 'store-heist-dialog shop-game-task'; heistDialog.setAttribute('aria-labelledby', 'store-heist-title'); document.body.append(heistDialog);
  const later = (fn, milliseconds) => { const handle = setTimeout(fn, milliseconds); timers.push(handle); };
  function clearGameTimers() { wheelAnimation?.cancel(); wheelAnimation=null; timers.forEach(clearTimeout); timers = []; gameVersion++; }
  function stop() { eventQueue = []; eventOwner = null; eventReturnFocus = null; eventDialog.close(); busy = false; clearInterval(timer); timer = null; generation++; clearGameTimers(); game = null; data = null; returnFocus = null; lastAction=null; heistDialog.close(); applyPoliceUser(); }
  function shopId() { return new URLSearchParams(location.search).get('shop'); }
  async function read(url) {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    const result = await response.json();
    if (!response.ok) { const error = new Error(accountError(result.error)); error.code = result.error; if(result.justice&&account){account.justice=result.justice;window.justiceUi?.sync(account);} throw error; }
    return result;
  }
  async function refresh(visit, repaint = true, recordVisit = false, events = null) {
    const current = ++generation, owner = account?.id, params = new URLSearchParams(location.search), id = params.get('shop');
    const result = recordVisit && owner && id ? await accountApi('stores/visit', { shopId: id })
      : await read(id ? `/api/stores/${encodeURIComponent(id)}` : `/api/stores?${params}`);
    if (current !== generation || visit !== accountVisit || account?.id !== owner) return;
    // Only the management view needs the owner's full stock and inventory.
    if (result.store?.own) {
      await events;
      if (current !== generation || visit !== accountVisit || account?.id !== owner) return;
      await window.businessUi.refresh(visit, false, !recordVisit);
      if (current !== generation || visit !== accountVisit || account?.id !== owner) return;
    }
    data = result;
    if (repaint) render();
  }
  async function load(visit) {
    await economyReady;
    if (!economyFlags.businesses) { data = { disabled: true }; return; }
    const events = loadEvents(visit);
    await Promise.all([events, refresh(visit, false, true, events)]);
    if (visit !== accountVisit) return;
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
    if (!force) {
      const host=accountContent.querySelector('[data-shop-activity]');
      if(host)host.innerHTML=eventQueue.length&&eventOwner===account?.id?`<details class="shop-activity"><summary>${t('Store activity','Ladenaktivität')} (${eventQueue.length})</summary>${eventQueue.map(event=>`<article><strong>${esc(event.shopName||typeName(event.shopType))} · ${esc(t(event.titleEn,event.titleDe))}</strong><p>${esc(t(event.bodyEn,event.bodyDe))}</p><small>${new Date(event.createdAt).toLocaleString(uiLocale())}</small></article>`).join('')}<button class="secondary-button" data-shop-events-read>${t('Mark as read','Als gelesen markieren')}</button></details>`:'';
      return;
    }
    if (!eventQueue.length || eventOwner !== account?.id || !['/stores','/businesses'].includes(currentAccountPage)) return;
    eventDialog.innerHTML = `<div class="store-event-content"><h2 id="store-event-title" tabindex="-1">${t('Store events', 'Ladenereignisse')}</h2><div class="store-event-list">${eventQueue.map(event => `<article><p class="store-event-shop">${esc(event.shopName || typeName(event.shopType))}</p><h3>${esc(t(event.titleEn, event.titleDe))}</h3><p>${esc(t(event.bodyEn, event.bodyDe))}</p><div class="store-event-outcome">${event.itemsLost ? `<span>${number(event.itemsLost)} ${t('items lost', 'Artikel verloren')}</span>` : ''}${event.itemsSold ? `<span>${number(event.itemsSold)} ${t('items sold', 'Artikel verkauft')}</span>` : ''}<strong>${event.money > 0 ? '+' : event.money < 0 ? '−' : ''}${justizEuro(Math.abs(event.money))}</strong></div><small>${new Date(event.createdAt).toLocaleString(uiLocale())}</small></article>`).join('')}</div><p class="account-error" role="alert"></p><button class="primary-button" data-store-events-dismiss>${t('Continue', 'Weiter')}</button></div>`;
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
  document.addEventListener('click',event=>{if(!event.target.closest('[data-shop-events-read]')||eventPending)return;const visit=accountVisit,owner=account?.id;eventPending=true;void accountApi('stores/events/acknowledge',{ids:eventQueue.map(e=>e.id)}).then(result=>{if(visit!==accountVisit||owner!==account?.id)return;eventQueue=result.events;showEvents();}).catch(error=>{if(visit===accountVisit)showToast(error.message);}).finally(()=>{eventPending=false;});});
  eventDialog.addEventListener('click', event => { if (event.target.closest('[data-store-events-dismiss]')) dismissEvents(); });
  eventDialog.addEventListener('cancel', event => { event.preventDefault(); dismissEvents(); });
  eventDialog.addEventListener('close', () => { if (eventReturnFocus?.isConnected) eventReturnFocus.focus({preventScroll:true}); eventReturnFocus = null; });
  const storeTitle = store => store.name || `${store.owner} · ${typeName(store.type)}`;
  function rating(store) { return store.rating === null ? t('No reviews yet', 'Noch keine Bewertungen') : `★ ${number(store.rating, 1)} / 5 · ${number(store.reviewCount)} ${t(store.reviewCount===1?'review':'reviews',store.reviewCount===1?'Bewertung':'Bewertungen')}`; }
  function card(store){return window.shopUi.card(store,store.ownerId===account?.id?'manage':'visit');}
  function directory() {
    const params=new URLSearchParams(location.search),query=params.get('query')||'',type=params.get('type')||'',district=params.get('district')||'',sort=params.get('sort')||'newest',minRating=params.get('minRating')||'',inStock=params.get('inStock')==='1';
    const offset=data.offset||0,summary=data.summary||{},active=Boolean(query||type||district||minRating||inStock);
    const link=changes=>{const next=new URLSearchParams(params);next.delete('offset');for(const [key,value] of Object.entries(changes)){if(value)next.set(key,value);else next.delete(key);}return '/stores'+(next.size?'?'+next:'');};
    const category=(id,label,count)=>`<a href="${esc(link({type:id}))}" data-page class="market-category ${type===id?'is-active':''}" ${type===id?'aria-current="true"':''}><span aria-hidden="true">${id?window.townArtwork.icon(id):visitorIcon('bag')}</span><strong>${esc(label)}</strong><small>${number(count||0)}</small></a>`;
    return `<div class="marketplace-page"><header class="marketplace-heading"><h1 tabindex="-1">${t('Stores','Läden')}</h1><div><a href="/businesses" data-page class="secondary-button">${t('Your stores','Deine Läden')}</a><a href="/town?view=open" data-page class="primary-button">＋ ${t('Open a store','Laden eröffnen')}</a></div></header>
      <section class="marketplace-hero"><div><div class="marketplace-hero-stats"><div><strong>${number(summary.stores||0)}</strong><span>${t('Stores','Läden')}</span></div><div><strong>${number(summary.items||0)}</strong><span>${t('Items in stock','Artikel auf Lager')}</span></div></div></div><div class="marketplace-hero-art" aria-hidden="true"><span class="market-hero-spark">✦</span><div class="market-hero-shop shop-color-wine">${window.shopUi.art('wine')}</div><div class="market-hero-ticket">${window.townArtwork.icon('toys')}<span>J€</span></div><span class="market-hero-seal">J€</span></div></section>
      <form class="store-search marketplace-controls"><div class="marketplace-searchbar"><label class="sr-only" for="market-search">${t('Search stores, owners or locations','Läden, Besitzer oder Standorte suchen')}</label>${visitorIcon('bag')}<input id="market-search" name="query" type="search" maxlength="80" value="${esc(query)}" placeholder="${t('Search stores, owners or locations','Läden, Besitzer oder Standorte suchen')}"><button type="submit" class="primary-button">${t('Search','Suchen')} →</button></div><input type="hidden" name="type" value="${esc(type)}">
      <nav class="marketplace-categories" aria-label="${t('Store categories','Ladenkategorien')}">${category('',t('All stores','Alle Läden'),summary.stores)}${(data.categories||[]).map(entry=>category(entry.id,typeName(entry.id),entry.count)).join('')}</nav>
      <div class="marketplace-layout"><aside class="marketplace-filters" aria-label="${t('Store filters','Ladenfilter')}"><div class="market-filter-heading"><h2>${t('Filters','Filter')}</h2>${active?`<a href="/stores" data-page>${t('Reset','Zurücksetzen')}</a>`:''}</div><label>${t('District','Bezirk')}<select name="district"><option value="">${t('All districts','Alle Bezirke')}</option>${(data.districts||[]).map(entry=>`<option value="${esc(entry.id)}" ${district===entry.id?'selected':''}>${entry.number}. ${esc(entry.name)} (${entry.count})</option>`).join('')}</select></label><label>${t('Customer rating','Kundenbewertung')}<select name="minRating"><option value="">${t('Any rating','Alle Bewertungen')}</option>${[4,3,2,1].map(value=>`<option value="${value}" ${minRating===String(value)?'selected':''}>★ ${value}+ / 5</option>`).join('')}</select></label><label class="market-stock-toggle"><input name="inStock" type="checkbox" value="1" ${inStock?'checked':''}><span>${t('In stock only','Nur mit Waren')}</span></label><button class="secondary-button" type="submit">${t('Apply filters','Filter anwenden')}</button><a class="market-open-link" href="/town?view=open" data-page><span aria-hidden="true">＋</span>${t('Open a store','Laden eröffnen')} ↗</a></aside>
      <section class="marketplace-results" aria-labelledby="market-results-title"><header class="marketplace-results-heading"><div><h2 id="market-results-title">${type?esc(typeName(type)):t('All stores','Alle Läden')} <small>(${number(data.total||0)})</small></h2></div><label>${t('Sort by','Sortieren nach')}<select name="sort">${[['newest',t('Newest stores','Neueste Läden')],['rating',t('Top rated','Bestbewertet')],['stock',t('Most stock','Meiste Waren')],['popular',t('Popularity','Beliebtheit')],['name',t('Name A–Z','Name A–Z')]].map(([id,label])=>`<option value="${id}" ${sort===id?'selected':''}>${label}</option>`).join('')}</select></label></header><div class="store-directory marketplace-grid">${data.stores?.length?data.stores.map(card).join(''):`<div class="marketplace-empty">${visitorIcon('bag')}<h3>${t('No stores found','Keine Läden gefunden')}</h3><a href="/stores" data-page class="secondary-button">${t('Clear filters','Filter löschen')}</a></div>`}</div><nav class="marketplace-pagination" aria-label="${t('Store pages','Ladenseiten')}">${offset>0?`<a href="${esc(link({offset:String(Math.max(0,offset-data.limit))}))}" class="secondary-button" data-page>← ${t('Previous','Zurück')}</a>`:''}${data.total?`<span>${offset+1}–${Math.min(offset+data.limit,data.total)} / ${data.total}</span>`:''}${offset+data.limit<data.total?`<a href="${esc(link({offset:String(offset+data.limit)}))}" class="secondary-button" data-page>${t('Next','Weiter')} →</a>`:''}</nav></section></div></form></div>`;
  }
  function fineClass(fine) {
    const level=1+[500,2500,10000,50000].filter(limit=>fine>=limit).length;
    const labels=[['Low potential fine','Niedriges mögliches Bußgeld'],['Moderate potential fine','Mittleres mögliches Bußgeld'],['High potential fine','Hohes mögliches Bußgeld'],['Very high potential fine','Sehr hohes mögliches Bußgeld'],['Extreme potential fine','Extremes mögliches Bußgeld']];
    return {level,label:`${t(...labels[level-1])} (${t('class','Klasse')} ${level} ${t('of','von')} 5)`};
  }
  function fineIndicator(fine) {
    const rating=fineClass(fine);
    return `<span class="theft-fine-class is-level-${rating.level}" role="img" aria-label="${esc(rating.label)}" title="${esc(rating.label)}">${Array.from({length:5},(_,index)=>`<span class="theft-fine-unit ${index<rating.level?'is-active':'is-inactive'}" aria-hidden="true">€</span>`).join('')}</span>`;
  }
  function estimatedFine(fine) {
    return `<div class="blackjack-risk"><span>${t('Potential fine if caught','Mögliches Bußgeld bei Erwischtwerden')}</span><strong>${fineIndicator(fine)}</strong></div>`;
  }
  const visitorIcons={bag:'<path d="M4 7h16l1 14H3L4 7Zm4 0V5a4 4 0 0 1 8 0v2"/>',cards:'<rect x="3" y="3" width="12" height="16" rx="2"/><path d="m16 5 5 2-4 14-5-2M7 8h4m-2-2v4"/>',shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',bell:'<path d="M5 16v-5a7 7 0 0 1 14 0v5l2 2H3l2-2Zm5 5h4M12 2v2"/>',smile:'<circle cx="12" cy="12" r="9"/><path d="M8 9h.01M16 9h.01M8 14c2 3 6 3 8 0"/>'};
  const visitorIcon=id=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${visitorIcons[id]||visitorIcons.star}</svg>`;
  const stockGroupKey=entry=>JSON.stringify([entry.item.title,entry.item.image,entry.item.rarity,entry.price,entry.theft?.fine]);
  function groupedStock(stock){
    const groups=new Map();for(const entry of stock){const key=stockGroupKey(entry);if(!groups.has(key))groups.set(key,{...entry,groupKey:key,quantity:0});groups.get(key).quantity++;}return [...groups.values()];
  }
  function shelfCard(entry, store) {
    const available=Boolean(account&&!store.own),cooling=store.heistInProgress,unpaid=Boolean(account?.justice?.fineDue),affordable=available&&account.tokens>=entry.price;
    const rarity=['common','uncommon','rare','epic','legendary'].includes(entry.item.rarity)?entry.item.rarity:'common';
    return `<article class="store-shelf-card visitor-stock-card rarity-${rarity}" data-stock-group="${esc(entry.groupKey)}"><div class="visitor-stock-media"><span class="visitor-rarity">${rarityLabel(rarity)}</span><span class="visitor-stock-quantity">×${number(entry.quantity)} <small>${t('in stock','im Regal')}</small></span>${entry.item.image?`<img src="${esc(entry.item.image)}" alt="" loading="lazy">`:`<div class="visitor-stock-placeholder" aria-hidden="true">${window.townArtwork.icon(store.type)}</div>`}</div><div class="store-shelf-info"><h3>${esc(entry.item.title)}</h3><div class="visitor-stock-price"><strong>${justizEuro(entry.price)}</strong><span>${t('per item','pro Artikel')}</span></div><div class="visitor-stock-actions"><button type="button" class="primary-button" data-store="buy" data-item="${esc(entry.id)}" data-stock-group="${esc(entry.groupKey)}" ${!affordable||busy?'disabled':''}>${visitorIcon('bag')}${entry.quantity>1?t('Buy one','Ein Exemplar kaufen'):t('Buy item','Artikel kaufen')} <span aria-hidden="true">→</span></button>${entry.theft?`<button type="button" class="visitor-steal-button" data-store="heist" data-item="${esc(entry.id)}" title="${esc(fineClass(entry.theft.fine).label)}" ${!available||busy||cooling||unpaid?'disabled':''}>${visitorIcon('cards')}<span class="visitor-steal-label">${t('Try to steal','Diebstahl versuchen')}</span>${fineIndicator(entry.theft.fine)}</button>`:''}</div>${available&&!affordable?`<small class="visitor-balance-hint">${t('Need','Es fehlen')} ${justizEuro(entry.price-account.tokens)} ${t('more to buy','zum Kaufen')}</small>`:''}</div></article>`;
  }
  function visitorHero(store){return window.shopUi.header(store)+`<div class="shop-visitor-meta"><span>@${esc(store.owner)}</span><a href="#store-reviews">${rating(store)}</a>${store.securityGuard?`<span>${t('Security guard active','Sicherheitsdienst aktiv')}</span>`:''}</div>`;}
  function visitorReactions(store){
    const reactions=[['applause','star',t('Applaud','Applaudieren')],['bell','bell',t('Ring the bell','Klingeln')],['joke','smile',t('Tell a joke','Witz erzählen')]];
    return `<section class="visitor-reactions" tabindex="-1" aria-label="${t('Store reactions','Ladenreaktionen')}"><div><strong>${t('Reactions','Reaktionen')}</strong></div><div class="visitor-reaction-buttons">${reactions.map(([id,icon,label])=>{const used=store.myReactions.includes(id),count=store.reactions.find(entry=>entry.reaction===id)?.count||0;return `<button type="button" data-store="react" data-reaction="${id}" aria-pressed="${used}" title="${esc(used?t('Already sent today','Heute schon gesendet'):label)}" ${!account||busy||used?'disabled':''}>${visitorIcon(icon)}<span>${label}</span><small>${used?'✓':number(count)}</small></button>`;}).join('')}</div></section>`;
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
    return `<div class="store-review-list">${players.map(reviewCard).join('')}${npcs.length ? `<h3 class="store-npc-review-heading">${t('From NPC shoppers', 'Von NPC-Kunden')}</h3>${npcs.map(reviewCard).join('')}` : ''}${!players.length && !npcs.length && !store.reviewCount ? `<p>${t('No reviews yet.', 'Noch keine Bewertungen.')}</p>` : ''}</div>`;
  }
  function reviewForm(review) {
    return `<form class="store-review-form"><fieldset class="store-rating"><legend>${t('Your rating', 'Deine Bewertung')}</legend><div class="store-star-picker">${[1,2,3,4,5].map(stars => `<label class="store-star-option"><input type="radio" name="stars" value="${stars}" aria-label="${stars} ${stars === 1 ? t('star', 'Stern') : t('stars', 'Sterne')} / 5" ${review?.stars === stars ? 'checked' : ''} required><span class="store-star-symbol" aria-hidden="true">★</span></label>`).join('')}</div></fieldset><label>${t('Your review', 'Dein Bewertungstext')}<textarea name="comment" maxlength="240" rows="4">${esc(review?.comment || '')}</textarea><small class="store-hint">${t('Up to 240 characters.', 'Bis zu 240 Zeichen.')}</small></label><button class="primary-button" type="submit">${t('Save review', 'Bewertung speichern')}</button><p class="account-error" role="alert"></p></form>`;
  }
  function detail(store) {
    if (store.own) return window.businessUi.ownerView(store);
    const eligible=Boolean(account),groups=groupedStock(store.stock),active=['active','police'].includes(store.heist?.outcome),cooling=store.heistInProgress;
    return `<div class="visitor-storefront stores-workspace store-type-${esc(store.type)}" data-visitor-shop="${esc(store.id)}" data-visitor-account="${esc(account?.id||'')}"><nav class="visitor-breadcrumbs" aria-label="${t('Store navigation','Ladennavigation')}"><a href="${esc(window.shopUi.returnTo())}" data-page>← ${window.shopUi.returnTo().startsWith('/businesses')?t('Your stores','Deine Läden'):window.shopUi.returnTo().startsWith('/town')?t('Store locations','Ladenstandorte'):t('Stores','Läden')}</a>${account?`<a href="/inventory" data-page>${t('Your inventory','Dein Inventar')} ↗</a>`:''}</nav>${visitorHero(store)}${lastAction?.shopId===store.id?`<p class="shop-inline-status" role="status">${esc(lastAction.text)}${lastAction.buy?` <a href="/inventory?returnShop=${encodeURIComponent(store.id)}&returnTo=${encodeURIComponent(window.shopUi.returnTo())}" data-page>${t('View in inventory','Im Inventar ansehen')} →</a>`:''}</p>`:''}
      ${!account?`<section class="store-notice visitor-login"><div><p>${t('Sign in to buy, review or attempt theft.','Melde dich an, um zu kaufen, zu bewerten oder einen Diebstahl zu versuchen.')}</p></div><a href="/login" data-page class="primary-button">${t('Sign in','Anmelden')} →</a></section>`:''}
      ${eligible&&!store.own?heatMarkup(store.heat):''}<section class="store-shelves"><div class="visitor-section-heading"><div><h2 id="store-stock-title" tabindex="-1">${t('On the shelves','In den Regalen')}</h2></div><span>${number(store.stock.length)} ${t(store.stock.length===1?'item':'items',store.stock.length===1?'Artikel':'Artikel')}</span></div>${eligible&&(active||cooling||account.justice?.fineDue)?`<div class="visitor-theft-status" role="status">${visitorIcon('cards')}<span>${active?(store.heist.outcome==='police'?t('Police wheel pending.','Polizeirad ausstehend.'):t('Blackjack in progress.','Blackjack läuft.')):account.justice?.fineDue?t('Settle your outstanding fine before another theft attempt.','Begleiche dein offenes Bußgeld vor einem weiteren Diebstahlversuch.'):t('Finish your current theft attempt first.','Beende zuerst deinen laufenden Diebstahlversuch.')}</span>${active?`<button type="button" class="secondary-button" data-store="resume">${t('Resume attempt','Versuch fortsetzen')} →</button>`:''}</div>`:''}<div class="store-shelf-grid">${groups.length?groups.map(entry=>shelfCard(entry,store)).join(''):`<div class="visitor-empty">${window.townArtwork.icon(store.type)}<h3>${t('No stock.','Keine Waren.')}</h3><a class="secondary-button" href="/stores" data-page>${t('Other stores','Andere Läden')} →</a></div>`}</div></section>
      ${visitorReactions(store)}<section class="shop-tip"><strong>${t('Leave a tip','Trinkgeld geben')}</strong>${[5,10,25].map(amount=>`<button class="secondary-button" data-store="tip" data-amount="${amount}" ${!account||busy||account.tokens<amount?'disabled':''}>${justizEuro(amount)}</button>`).join('')}</section><section class="store-reviews visitor-reviews" id="store-reviews"><div class="visitor-section-heading"><div class="section-title-row"><h2>${t('Customer reviews','Kundenbewertungen')}</h2>${!store.canReview?infoTip(t('Buy an item here to leave a verified review.','Kaufe hier einen Artikel, um eine verifizierte Bewertung zu schreiben.'),t('Review requirements','Bewertungsanforderungen')):''}</div><span>${number(store.reviewCount)}</span></div>${store.canReview?`<details class="visitor-review-compose"><summary>${visitorIcon('star')}${store.myReview?t('Edit your review','Deine Bewertung bearbeiten'):t('Write a review','Bewertung schreiben')} →</summary>${reviewForm(store.myReview)}</details>`:''}${window.storeReputationUi?.histogram(store)||''}${reviewList(store)}</section></div>`;
  }
  function render() {
    if (currentAccountPage !== '/stores' || !data) return;
    const old=accountContent.querySelector('.visitor-storefront'),oldForm=old?.querySelector('.store-review-form');
    const draft=oldForm&&old.dataset.visitorShop===data.store?.id&&old.dataset.visitorAccount===(account?.id||'')?{open:oldForm.closest('details').open,comment:oldForm.elements.comment.value,stars:oldForm.elements.stars.value}:null;
    accountContent.innerHTML = data.disabled ? pageHeading(t('Stores are unavailable.', 'Läden sind nicht verfügbar.')) : data.store ? detail(data.store) : `<div class="stores-workspace">${directory()}</div>`;
    const form=accountContent.querySelector('.visitor-review-compose .store-review-form');
    if(draft&&form){form.closest('details').open=draft.open;form.elements.comment.value=draft.comment;const star=form.querySelector(`input[name="stars"][value="${draft.stars}"]`);if(star)star.checked=true;}
    showEvents();
  }
  function navigateOwnerTab(destination, push = true) {
    const store = data?.store;
    if (currentAccountPage !== '/stores' || !pageLoaded || destination.pathname !== '/stores' ||
        !account || account.mustChangePassword || account.justice?.jailed || !store?.own ||
        store.ownerId !== account.id || destination.searchParams.get('shop') !== store.id ||
        !window.businessUi.ownedShop(store.id)) return false;
    const tab = destination.searchParams.get('tab') || 'overview';
    if (!['overview','stock','reviews','settings'].includes(tab)) return false;
    const href = destination.pathname + destination.search;
    if (push && location.pathname + location.search !== href) history.pushState({}, '', href);
    render();
    accountContent.querySelector('.shop-tabs [aria-current="page"]')?.focus({preventScroll:true});
    return true;
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
  function closeButton() { const outcome=game?.attempt?.outcome,stage=!outcome?0:outcome==='active'?1:outcome==='police'?2:3;return `<nav class="shop-game-stages" aria-label="${t('Theft progress','Diebstahlfortschritt')}">${[[t('Target','Ziel')],[t('Blackjack','Blackjack')],[t('Police','Polizei')],[t('Result','Ergebnis')]].map(([label],i)=>`<span ${i===stage?'aria-current="step"':''}>${i+1} ${label}</span>`).join('')}</nav><button type="button" class="dialog-close" data-store="close-heist" ${game?.spinning?'disabled':''} aria-label="${t('Close', 'Schließen')}">×</button>`; }
  function securityMarkup(security) {
    const required=security?.requiredWins??1,completed=security?.completedWins??0;
    if(required<2)return '';
    return `<div class="blackjack-security"><strong>${t('Security stages','Sicherheitsstufen')}</strong><span>${completed} / ${required} ${t('wins','Siege')}</span><ol aria-label="${t('Security progress','Sicherheitsfortschritt')}">${Array.from({length:required},(_,i)=>`<li class="${i<completed?'is-cleared':''}" ${i===completed?'aria-current="step"':''}><span aria-hidden="true">${i<completed?'✓':i+1}</span><span class="sr-only">${t('Stage','Stufe')} ${i+1}${i<completed?t(' cleared',' geschafft'):''}</span></li>`).join('')}</ol></div>`;
  }
  function heistIntro(entry) {
    heistDialog.innerHTML=`<div class="store-heist-content blackjack-content blackjack-intro">${closeButton()}<h2 id="store-heist-title">${t('Store theft','Ladendiebstahl')}</h2><div class="blackjack-target">${entry.item.image?`<img src="${esc(entry.item.image)}" alt="">`:`<span aria-hidden="true">♠</span>`}<div><small>${t('Your target','Dein Ziel')}</small><h3>${esc(entry.item.title)}</h3></div></div>${securityMarkup(entry.theft)}<p class="blackjack-intro-copy">${t(`${(entry.theft.requiredWins??1)>1?`Win ${entry.theft.requiredWins} hands to steal this item.`:'Beat the dealer to steal it directly.'} Lose and spin the police wheel: ${100-entry.theft.policeCatchPercent}% escape, ${entry.theft.policeCatchPercent}% caught. A tie means no loot and no fine.`,`${(entry.theft.requiredWins??1)>1?`Gewinne ${entry.theft.requiredWins} Blätter, um diesen Artikel zu stehlen.`:'Schlage den Dealer, um den Artikel direkt zu stehlen.'} Bei einer Niederlage dreht sich das Polizeirad: ${100-entry.theft.policeCatchPercent}% Flucht, ${entry.theft.policeCatchPercent}% erwischt. Bei Gleichstand gibt es weder Beute noch Bußgeld.`)}</p>${heatMarkup(data.store.heat)}<p class="store-hint">${t('Attempt: +½ star · if stolen:', 'Versuch: +½ Stern · bei Erfolg:')} +${number(entry.theft.successHeatStars)} ${t('extra stars','weitere Sterne')}</p>${estimatedFine(entry.theft.fine)}<button class="primary-button blackjack-start" data-store="start-heist">${t('Deal cards · free','Karten geben · kostenlos')}</button><p class="store-hint blackjack-commitment">${t('Finish within 10 minutes. Leaving does not cancel the attempt.','Beende den Versuch innerhalb von 10 Minuten. Verlassen bricht ihn nicht ab.')}</p><details class="blackjack-details"><summary>${t('Rules & consequences','Regeln & Folgen')}</summary><div><p>${t('Get closer to 21 than the dealer without going over. Aces count as 1 or 11, face cards as 10. The dealer stands on all 17s. A two-card blackjack beats any other 21. A fresh fair 52-card deck per hand; no splits or doubles. Expensive targets require more wins. Only the final win awards the item; a loss or tie ends the whole attempt.','Komme näher an 21 als der Dealer, ohne sie zu überschreiten. Asse zählen 1 oder 11, Bildkarten 10. Der Dealer hält bei jeder 17. Blackjack mit zwei Karten schlägt jede andere 21. Ein frischer fairer Stapel mit 52 Karten pro Blatt; kein Teilen oder Verdoppeln. Teure Ziele erfordern mehr Siege. Erst der letzte Sieg bringt den Artikel; eine Niederlage oder ein Gleichstand beendet den gesamten Versuch.')}</p><p>${t('Fines are collected from your balance first, then your belongings. If nothing remains, unpaid debt leads to jail; repeat offences mean longer sentences.','Bußgeld wird zuerst vom Guthaben eingezogen, danach werden deine Sachen gepfändet. Bleibt nichts übrig, führt die offene Schuld zu Haft; wiederholte Vergehen verlängern die Haft.')}</p><p>${t('An unfinished attempt becomes a loss after 10 minutes. The police wheel resolves automatically after another 2 minutes if you do not spin it. Escaping gives no loot and no fine. No player or store cooldown. Finish your current attempt before starting another. Each start adds half a Heat star. Stolen items add more Heat based on their number and value. Half a star fades every 30 minutes, including offline.','Ein unvollendeter Versuch zählt nach 10 Minuten als Niederlage. Ohne Drehung wird das Polizeirad nach weiteren 2 Minuten automatisch aufgelöst. Bei Flucht gibt es weder Beute noch Bußgeld. Keine Wartezeit pro Spieler oder Laden. Beende deinen laufenden Versuch, bevor du einen neuen startest. Jeder Start erhöht Heat um einen halben Stern. Gestohlene Artikel erhöhen Heat zusätzlich nach Anzahl und Wert. Alle 30 Minuten sinkt Heat um einen halben Stern, auch offline.')}</p></div></details><p class="account-error" role="alert"></p></div>`;
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
  const outcomes={escaped:['You escaped the police. No loot and no fine.','Du bist der Polizei entkommen. Keine Beute und kein Bußgeld.'],stolen:['You beat the dealer. The stolen item is in your inventory.','Du hast den Dealer geschlagen. Der gestohlene Artikel liegt in deinem Inventar.'],caught:['Caught! The fine is being enforced.','Erwischt! Das Bußgeld wird vollstreckt.'],push:['A tie. You leave empty-handed, without a fine.','Gleichstand. Du gehst ohne Beute und ohne Bußgeld.'],gone:['You won, but the item already left the shelf. No fine.','Du hast gewonnen, aber der Artikel hat das Regal bereits verlassen. Kein Bußgeld.'],expired:['This older paid attempt expired.','Dieser ältere bezahlte Versuch ist abgelaufen.'],fumbled:['This older attempt failed.','Dieser ältere Versuch ist gescheitert.']};
  function policeConsequence(attempt) { const fine=attempt.consequence; return fine?`<div class="blackjack-consequence"><h3>${t('Gerichtsvollzieher · bailiff','Gerichtsvollzieher')}</h3><p>${t('Fine','Bußgeld')}: ${justizEuro(attempt.fine)} · ${t('Cash collected','Guthaben eingezogen')}: ${justizEuro(fine.paidCash)}</p><p>${t('The fine is paid to the store owner.','Das Bußgeld erhält der Ladenbesitzer.')}</p>${fine.paidStoreCash?`<p>${t('Store cash collected','Ladenkassen eingezogen')}: ${justizEuro(fine.paidStoreCash)}</p>`:''}${fine.seized.length?`<ul>${fine.seized.map(item=>`<li>${esc(item.title)} · ${justizEuro(item.value)}</li>`).join('')}</ul>`:`<p>${t('No inventory seized.','Kein Inventar gepfändet.')}</p>`}${fine.remainingFine?`<p>${t('Remaining fine','Offenes Bußgeld')}: ${justizEuro(fine.remainingFine)}. ${t('Collected when assets become available. New theft attempts are blocked until paid.','Wird bei verfügbarem Vermögen eingezogen. Neue Diebstahlversuche sind bis zur Zahlung gesperrt.')}</p>`:''}</div>`:''; }
  function paintBlackjack() {
    const attempt=game?.attempt;if(!attempt)return;
    if(attempt.policeWheel){paintPoliceWheel(attempt);return;}
    const hand=attempt.blackjack,active=attempt.outcome==='active',next=active&&attempt.security?.awaitingNextHand;
    heistDialog.innerHTML=`<div class="store-heist-content blackjack-content">${active?closeButton():''}<h2 id="store-heist-title">${t('Blackjack','Blackjack')}</h2>${securityMarkup(attempt.security)}${hand?`<div class="blackjack-table"><section><h3>${t('Dealer','Dealer')} <span>${hand.dealerTotal??'?'}</span></h3><div class="blackjack-hand">${hand.dealer.map(cardMarkup).join('')}</div></section><section><h3>${t('Your hand','Dein Blatt')} <span>${hand.playerTotal}</span></h3><div class="blackjack-hand">${hand.player.map(cardMarkup).join('')}</div></section></div>`:''}<p class="blackjack-status" role="status">${next?t('Stage cleared. Win the remaining hands to get the item.','Stufe geschafft. Gewinne die restlichen Blätter für den Artikel.'):active?t('Get closer to 21 than the dealer without going over.','Komme näher an 21 als der Dealer, ohne sie zu überschreiten.'):t(...(outcomes[attempt.outcome]||outcomes.expired))}</p>${active&&hand?`${estimatedFine(attempt.fine)}<p class="store-hint">${t('Finish before','Beende den Versuch vor')} ${new Date(attempt.expiresAt).toLocaleTimeString(uiLocale())}. ${t('Leaving does not cancel the attempt.','Verlassen bricht den Versuch nicht ab.')}</p><div class="blackjack-actions">${next?`<button class="primary-button" data-store="continue" ${busy?'disabled':''}>${t('Next hand','Nächstes Blatt')}</button>`:`<button class="primary-button" data-store="hit" ${busy?'disabled':''}>${t('Hit · take a card','Ziehen · eine Karte')}</button><button class="secondary-button" data-store="stand" ${busy?'disabled':''}>${t('Stand · hold your hand','Halten · Blatt behalten')}</button>`}</div>`:active?`<p>${t('Resume this older paid attempt.','Setze diesen älteren bezahlten Versuch fort.')}</p><button class="primary-button" data-store="retry-finish">${t('Finish attempt','Versuch abschließen')}</button>`:''}${policeConsequence(attempt)}<p class="account-error" role="alert"></p>${!active?`<div class="store-action-row"><button class="primary-button" data-store="close-heist">${t('Continue','Weiter')}</button></div>`:''}</div>`;
  }
  const heatMarkup = heat => window.theftHeatUi.markup(heat);
  function policeArtwork(wheel) {
    const boundary=wheel.catchPercent*3.6;
    const points=[...new Set([0,36,72,108,144,180,216,252,288,324,360,boundary])].sort((a,b)=>a-b);
    const paths=points.slice(0,-1).map((angle,index)=>{
      const endAngle=points[index+1],start=angle*Math.PI/180,end=endAngle*Math.PI/180,middle=(start+end)/2;
      const caught=angle<boundary;
      return `<path d="M120 120 L${120+116*Math.sin(start)} ${120-116*Math.cos(start)} A116 116 0 0 1 ${120+116*Math.sin(end)} ${120-116*Math.cos(end)} Z" class="${caught?'is-caught':'is-escape'}"/>${endAngle-angle>=12?`<text x="${120+82*Math.sin(middle)}" y="${120-82*Math.cos(middle)}" text-anchor="middle" dominant-baseline="central">${caught?'!':'✓'}</text>`:''}`;
    }).join('');
    const angle=wheel.spun&&!game.spinning?360-(wheel.stopAngle??(wheel.sector*36+18)):0;
    return `<div class="police-wheel-wrap" aria-hidden="true"><span class="police-wheel-pointer"></span><svg class="police-wheel" viewBox="0 0 240 240" style="transform:rotate(${angle}deg)">${paths}</svg><span class="police-wheel-hub">${wheel.spun&&!game.spinning?(wheel.outcome==='escaped'?'✓':'!'):'?'}</span></div>`;
  }
  function paintPoliceWheel(attempt) {
    const wheel=attempt.policeWheel,done=wheel.spun&&!game.spinning;
    heistDialog.innerHTML=`<div class="store-heist-content blackjack-content police-wheel-content">${done?'':closeButton()}<h2 id="store-heist-title">${t('Police wheel','Polizeirad')}</h2>${policeArtwork(wheel)}<div class="police-wheel-odds" role="group" aria-label="${t('Wheel odds','Rad-Chancen')}"><span class="is-escape">✓ ${wheel.escapePercent}% ${t('Escape','Flucht')}</span><span class="is-caught">! ${wheel.catchPercent}% ${t('Caught','Erwischt')}</span></div><p class="blackjack-status" role="status" aria-live="polite">${game.spinning?t('Spinning…','Das Rad dreht sich …'):done?t(...outcomes[attempt.outcome]):t('Escaping means no loot and no fine.','Bei Flucht gibt es weder Beute noch Bußgeld.')}</p>${done?`${wheel.autoSpun?`<p class="store-hint">${t('Automatically resolved when the timer expired.','Nach Ablauf der Zeit automatisch aufgelöst.')}</p>`:''}${policeConsequence(attempt)}<button class="primary-button police-wheel-action" data-store="close-heist">${t('Continue','Weiter')}</button>`:`${estimatedFine(attempt.fine)}<p class="store-hint">${t('Spin before','Drehe das Rad vor')} ${new Date(attempt.expiresAt).toLocaleTimeString(uiLocale())}. ${t('Leaving does not cancel the result.','Verlassen bricht das Ergebnis nicht ab.')}</p><button class="primary-button police-wheel-action" data-store="spin-police" ${busy?'disabled':''}>${t('Spin the wheel','Rad drehen')}</button>`}<p class="account-error" role="alert"></p></div>`;
  }
  async function spinPoliceWheel() {
    if(busy||!game?.attempt?.policeWheel||game.attempt.policeWheel.spun)return;
    const attempt=game.attempt,visit=accountVisit,owner=account.id,version=gameVersion;
    const current=()=>visit===accountVisit&&owner===account?.id&&version===gameVersion&&heistDialog.open;
    busy=true;game.spinning=true;paintBlackjack();
    try {
      const result=await mutate('stores/heist/spin',{heistId:attempt.id},true);
      if(!current()){if(account?.id===owner)updateAccount(result.user);return;}
      pendingPoliceUser=result.user;game.attempt=result.heist;paintBlackjack();
      const wheel=heistDialog.querySelector('.police-wheel'),angle=1800+360-(result.heist.policeWheel.stopAngle??(result.heist.policeWheel.sector*36+18));
      const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:2600;
      wheelAnimation=wheel.animate([{transform:'rotate(0deg)'},{transform:`rotate(${angle}deg)`}],{duration,easing:'cubic-bezier(.12,.65,.12,1)',fill:'forwards'});
      await wheelAnimation.finished;
      if(!current())return;
      wheelAnimation=null;game.spinning=false;busy=false;paintBlackjack();applyPoliceUser();
      if(account?.justice?.jailed)return;
      await refresh(visit);heistDialog.querySelector('[data-store="close-heist"]')?.focus({preventScroll:true});
    } catch(error) {
      if(current()){game.spinning=false;busy=false;applyPoliceUser();if(heistDialog.open){paintBlackjack();heistDialog.querySelector('.account-error').textContent=error.message;}}
    } finally {if(current()){busy=false;render();}}
  }
  function focusHeistAction(preferred) { (preferred&&heistDialog.querySelector(`[data-store="${preferred}"]`)||heistDialog.querySelector('[data-store="spin-police"]')||heistDialog.querySelector('[data-store="continue"]')||heistDialog.querySelector('[data-store="hit"]')||heistDialog.querySelector('[data-store="close-heist"]'))?.focus({preventScroll:true}); }
  function playHeist(attempt) {clearGameTimers();game={attempt};paintBlackjack();if(!heistDialog.open)heistDialog.showModal();focusHeistAction();}
  async function moveBlackjack(action) {
    if(!game?.attempt||busy)return;
    const visit=accountVisit,owner=account.id,attempt=game.attempt;busy=true;paintBlackjack();
    try {
      const result=await mutate('stores/heist/action',{heistId:attempt.id,action,turn:attempt.blackjack.turn},true);
      if(visit!==accountVisit||owner!==account?.id)return;
      game.attempt=result.heist;updateAccount(result.user);
      if(account.justice?.jailed)return;
      busy=false;paintBlackjack();await refresh(visit);focusHeistAction(result.heist.outcome==='active'?(result.heist.security?.awaitingNextHand?'continue':action==='continue'?'hit':action):result.heist.outcome==='police'?'spin-police':'close-heist');
    }catch(error){if(visit===accountVisit&&heistDialog.open){busy=false;paintBlackjack();heistDialog.querySelector('.account-error').textContent=error.message;if(error.code==='blackjack_turn_changed'){await refresh(visit);if(data.store.heist)playHeist(data.store.heist);}}}
    finally{if(visit===accountVisit){busy=false;if(!account?.justice?.jailed)render();}}
  }
  async function finishHeist() {
    if(!game?.attempt||busy)return;busy=true;
    try{const result=await accountApi('stores/heist/finish',{heistId:game.attempt.id});updateAccount(result.user);game.attempt=result.heist;paintBlackjack();await refresh(accountVisit);}
    catch(error){if(heistDialog.open)heistDialog.querySelector('.account-error').textContent=error.message;}
    finally{busy=false;}
  }
  heistDialog.addEventListener('cancel', event => { if(game?.spinning)event.preventDefault(); });
  heistDialog.addEventListener('close', () => {
    clearGameTimers(); game = null; applyPoliceUser();
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
    if (action === 'close-heist') { if(!game?.spinning)heistDialog.close(); return; }
    if (action === 'spin-police') { await spinPoliceWheel(); return; }
    if (['hit','stand','continue'].includes(action)) {await moveBlackjack(action);return;}
    if (action === 'retry-finish') { await finishHeist(); return; }
    if (busy || !account || !data?.store) return;
    const store = data.store, visit = accountVisit, owner = account.id;
    if (action === 'heist') { const entry = store.stock.find(entry => entry.id === button.dataset.item); if (entry) openHeist(entry, button); return; }
    if (action === 'resume') { if (['active','police'].includes(store.heist?.outcome)) { returnFocus = button; playHeist(store.heist); } return; }
    busy = true; button.disabled = true;
    try {
      let result;
      if (action === 'start-heist') {
        const entry = game?.entry; if (!entry) return;
        result = await mutate('stores/heist/start', { shopId: store.id, inventoryId: entry.id, expectedPrice: entry.price, expectedFine:entry.theft.fine, expectedPoliceCatchPercent:entry.theft.policeCatchPercent, expectedRequiredWins:entry.theft.requiredWins??1 }, true);
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
      lastAction={shopId:store.id,buy:action==='buy',text:action==='buy'?t('Purchased. Added to your inventory.','Gekauft. Zu deinem Inventar hinzugefügt.'):action==='tip'?t('Tip sent.','Trinkgeld gesendet.'):t('Reaction sent.','Reaktion gesendet.')};
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
  document.addEventListener('change',event=>{if(currentAccountPage==='/stores'&&event.target.matches('.marketplace-controls select,.marketplace-controls input[type="checkbox"]'))event.target.form.requestSubmit();});
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
      const result = profile ? await mutate('businesses/profile', { shopId: form.dataset.shop, name: form.elements.storeName.value, motto: form.elements.motto.value, securityGuard: form.elements.securityGuard.checked }, true)
        : await mutate('stores/review', { shopId: data.store.id, stars: Number(form.elements.stars.value), comment: form.elements.comment.value });
      if (visit !== accountVisit || owner !== account?.id) return;
      if (result.user) updateAccount(result.user);
      if (profile) { await window.businessUi.refresh(visit, false); window.businessUi.render(); }
      else await refresh(visit);
      saved=true;showToast(t('Saved.', 'Gespeichert.'));
    } catch (error) { if (visit === accountVisit) form.querySelector('.account-error').textContent = error.message; }
    finally { if (visit === accountVisit) { busy = false; if (button.isConnected) button.disabled = false; if(review&&saved){render();accountContent.querySelector('.store-review-form button[type="submit"]')?.focus({preventScroll:true});} } }
  });
  document.addEventListener('jg:language', () => { if(heistDialog.open&&!game?.spinning){if(game?.attempt)paintBlackjack();else if(game?.entry)heistIntro(game.entry);} if (currentAccountPage === '/stores') render(); if (eventDialog.open) showEvents(true); });
  return { load, stop, render, navigateOwnerTab, loadEvents, showEvents, reviews:store=>`<section class="store-reviews">${window.storeReputationUi?.histogram(store)||''}${reviewList(store)}</section>` };
})();
