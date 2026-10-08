window.storeUi = (() => {
  const esc = accountEscape;
  const names = { wine: ['Wine store', 'Weinhandlung'], toys: ['Toy store', 'Spielwarenladen'], electronics: ['Electronics store', 'Elektronikladen'], cars: ['Car dealership', 'Autohaus'] };
  const symbols = { wine: 'VIN', toys: 'TOY', electronics: 'TECH', cars: 'AUTO' };
  const arrows = ['↑', '→', '↓', '←'];
  const directions = [['Up', 'Hoch'], ['Right', 'Rechts'], ['Down', 'Runter'], ['Left', 'Links']];
  const reactions = { applause: ['Applaud', 'Applaudieren'], joke: ['Tell a dad joke', 'Schlechten Witz erzählen'], bell: ['Ring the bell', 'Klingeln'] };
  const typeName = type => names[type] ? t(...names[type]) : type;
  let data = null, timer = null, generation = 0, busy = false, game = null, gameVersion = 0, timers = [], returnFocus = null;
  const heistDialog = document.createElement('dialog');
  heistDialog.className = 'store-heist-dialog'; heistDialog.setAttribute('aria-labelledby', 'store-heist-title'); document.body.append(heistDialog);
  const later = (fn, milliseconds) => { const handle = setTimeout(fn, milliseconds); timers.push(handle); };
  function clearGameTimers() { timers.forEach(clearTimeout); timers = []; gameVersion++; }
  function stop() { busy = false; clearInterval(timer); timer = null; generation++; clearGameTimers(); game = null; data = null; returnFocus = null; heistDialog.close(); }
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
    data = result;
    if (repaint) render();
  }
  async function load(visit) {
    await economyReady;
    if (!economyFlags.businesses) { data = { disabled: true }; return; }
    await refresh(visit, false);
    if (visit !== accountVisit) return;
    if (account && data?.store && !data.store.own) {
      await accountApi('stores/visit', { shopId: data.store.id });
      if (visit !== accountVisit) return;
      await refresh(visit, false);
    }
    timer = setInterval(() => {
      if (!document.hidden && !busy && !heistDialog.open && !document.activeElement?.closest('.store-review-form, .store-search')) refresh(visit).catch(() => {});
    }, 30000);
  }
  const storeTitle = store => store.name || `${store.owner} · ${typeName(store.type)}`;
  function rating(store) { return store.rating === null ? t('No reviews yet', 'Noch keine Bewertungen') : `★ ${number(store.rating, 1)} / 5 · ${number(store.reviewCount)} ${t('reviews', 'Bewertungen')}`; }
  function card(store) {
    return `<a class="store-card store-type-${esc(store.type)}" href="/stores?shop=${encodeURIComponent(store.id)}" data-page><div class="store-awning" aria-hidden="true"><span>${esc(symbols[store.type] || 'JG')}</span></div><div class="store-card-content"><small>${esc(typeName(store.type))} · ${esc(store.owner)}</small><h2>${esc(storeTitle(store))}</h2><p>${esc(store.motto || t('Come in. Find something unexpected.', 'Komm rein. Entdecke etwas Unerwartetes.'))}</p><p>${rating(store)}</p><strong>${number(store.stockCount)} ${t('items on shelves', 'Artikel im Regal')} · ${number(store.playerVisits)} ${t('player visits', 'Spielerbesuche')}</strong>${store.gooseGuard ? `<p class="store-goose">${t('Goose guard on duty · HONK!', 'Wachgans im Dienst · HUP!')}</p>` : ''}</div></a>`;
  }
  function directory() {
    const params = new URLSearchParams(location.search), query = params.get('query') || '', type = params.get('type') || '';
    const offset = data.offset || 0;
    const pageLink = start => { const next = new URLSearchParams(params); next.set('offset', start); return `/stores?${next}`; };
    return `${pageHeading(t('Visit stores', 'Läden besuchen'), t('Browse player shelves, find a bargain, or cause a little commotion.', 'Entdecke Spielerregale, finde ein Schnäppchen oder stifte etwas Unfug.'))}<div class="store-action-row"><a href="/businesses" class="secondary-button" data-page>${t('Manage your stores', 'Deine Läden verwalten')}</a></div><form class="store-search"><label>${t('Search stores or owners', 'Läden oder Besitzer suchen')}<input name="query" maxlength="80" value="${esc(query)}" type="search"></label><label>${t('Store type', 'Ladentyp')}<select name="type"><option value="">${t('All stores', 'Alle Läden')}</option>${Object.keys(names).map(id => `<option value="${id}" ${type === id ? 'selected' : ''}>${esc(typeName(id))}</option>`).join('')}</select></label><button class="primary-button" type="submit">${t('Explore', 'Entdecken')}</button></form><p>${number(data.total || 0)} ${t('stores to explore', 'Läden zum Entdecken')}</p><div class="store-directory">${data.stores?.length ? data.stores.map(card).join('') : `<p class="collection-empty">${t('No stores found. Open one and start the neighbourhood!', 'Keine Läden gefunden. Eröffne einen und belebe die Nachbarschaft!')}</p>`}</div><nav class="store-action-row" aria-label="${t('Store pages', 'Ladenseiten')}">${offset > 0 ? `<a href="${esc(pageLink(Math.max(0, offset - data.limit)))}" class="secondary-button" data-page>← ${t('Previous', 'Zurück')}</a>` : ''}${offset + data.limit < data.total ? `<a href="${esc(pageLink(offset + data.limit))}" class="secondary-button" data-page>${t('Next', 'Weiter')} →</a>` : ''}</nav>`;
  }
  function shelfCard(entry, store) {
    const available = account && !store.own;
    const cooling = Date.now() < store.cooldownUntil;
    return `<article class="store-shelf-card">${entry.item.image ? `<img src="${esc(entry.item.image)}" alt="" loading="lazy">` : `<div class="store-item-placeholder" aria-hidden="true">${esc(symbols[store.type])}</div>`}<div class="store-shelf-info"><h3>${esc(entry.item.title)}</h3><p class="store-price">${justizEuro(entry.price)}</p><div class="store-action-row"><button class="primary-button" data-store="buy" data-item="${esc(entry.id)}" ${!available || busy || account.tokens < entry.price ? 'disabled' : ''}>${t('Buy', 'Kaufen')} · ${justizEuro(entry.price)}</button><button class="secondary-button" data-store="heist" data-item="${esc(entry.id)}" ${!available || busy || cooling || account.tokens < entry.theft.fee ? 'disabled' : ''}>${t('Try to steal', 'Diebstahl versuchen')}</button></div><small>${t('Mischief fee', 'Unfuggebühr')} ${justizEuro(entry.theft.fee)} · ${entry.theft.chancePercent}% ${t('chance after a perfect minigame', 'Chance nach einem perfekten Minispiel')}</small></div></article>`;
  }
  function detail(store) {
    const eligible = account && !store.own, review = store.myReview;
    return `<p><a href="/stores" data-page>← ${t('All stores', 'Alle Läden')}</a></p><header class="store-front store-type-${esc(store.type)}"><div class="store-awning" aria-hidden="true"><span>${esc(symbols[store.type])}</span></div><div><p class="eyebrow">${esc(typeName(store.type))} · ${esc(store.owner)}</p>${pageHeading(esc(storeTitle(store)))}<p>${esc(store.motto || t('Come in. Find something unexpected.', 'Komm rein. Entdecke etwas Unerwartetes.'))}</p><p>${rating(store)} · ${number(store.playerVisits)} ${t('player visits', 'Spielerbesuche')}</p>${store.gooseGuard ? `<p class="store-goose">${t('Guarded by a goose. Theft odds are halved. HONK!', 'Eine Gans bewacht den Laden. Diebstahlchance halbiert. HUP!')}</p>` : ''}${store.own ? `<a href="/businesses" data-page class="secondary-button">${t('Manage this store', 'Diesen Laden verwalten')}</a>` : ''}</div></header>
      ${!account ? `<p class="store-notice"><a href="/login" data-page>${t('Sign in', 'Anmelden')}</a> ${t('to buy, review or make mischief.', 'zum Kaufen, Bewerten oder Unfugmachen.')}</p>` : ''}
      ${eligible ? `<section class="store-social"><h2>${t('Make yourself at home', 'Fühl dich wie zuhause')}</h2><div class="store-action-row">${Object.entries(reactions).map(([id, labels]) => `<button class="secondary-button" data-store="react" data-reaction="${id}" ${busy || store.myReactions.includes(id) ? 'disabled' : ''}>${t(...labels)} · ${number(store.reactions.find(r => r.reaction === id)?.count || 0)}</button>`).join('')}</div><p class="store-hint">${t('Each reaction once per day. The owner gets a little note.', 'Jede Reaktion einmal pro Tag. Der Besitzer bekommt eine kleine Nachricht.')}</p><div class="store-action-row"><span>${t('Tip jar', 'Trinkgeldkasse')}</span>${[5,10,25].map(amount => `<button class="secondary-button" data-store="tip" data-amount="${amount}" ${busy || account.tokens < amount ? 'disabled' : ''}>${justizEuro(amount)}</button>`).join('')}</div></section>` : ''}
      <section class="store-shelves"><div class="section-title-row"><h2>${t('On the shelves', 'In den Regalen')}</h2><a href="/inventory" data-page>${t('Your inventory', 'Dein Inventar')}</a></div>${eligible && store.heist?.outcome === 'active' ? `<p><button class="secondary-button" data-store="resume">${t('Resume your mischief', 'Unfug fortsetzen')}</button></p>` : ''}${eligible && Date.now() < store.cooldownUntil ? `<p class="store-hint">${t('Next theft attempt available after', 'Nächster Diebstahlversuch ab')} ${new Date(store.cooldownUntil).toLocaleTimeString(uiLocale(),{hour:'2-digit',minute:'2-digit'})}. ${t('One attempt per player every 30 minutes; one per store every 5 minutes.', 'Ein Versuch pro Spieler alle 30 Minuten; pro Laden alle 5 Minuten.')}</p>` : ''}<div class="store-shelf-grid">${store.stock.length ? store.stock.map(entry => shelfCard(entry, store)).join('') : `<p class="collection-empty">${t('Empty shelves. The owner may be out hunting bargains.', 'Leere Regale. Vielleicht ist der Besitzer auf Schnäppchenjagd.')}</p>`}</div></section>
      <section class="store-reviews"><h2>${t('Customer reviews', 'Kundenbewertungen')}</h2><p class="store-hint">${t('Only customers who bought an item here can review. One editable review per customer.', 'Nur Käufer dieses Ladens können bewerten. Eine bearbeitbare Bewertung pro Kunde.')}</p>${store.canReview ? `<form class="store-review-form"><label>${t('Your rating', 'Deine Bewertung')}<select name="stars">${[5,4,3,2,1].map(stars => `<option value="${stars}" ${review?.stars === stars ? 'selected' : ''}>${'★'.repeat(stars)} · ${stars}/5</option>`).join('')}</select></label><label>${t('Your review', 'Deine Bewertung')}<textarea name="comment" maxlength="240" rows="3" placeholder="${t('How was your visit?', 'Wie war dein Besuch?')}">${esc(review?.comment || '')}</textarea></label><button class="primary-button" type="submit">${t('Save review', 'Bewertung speichern')}</button><p class="account-error" role="alert"></p></form>` : ''}<div class="store-review-list">${store.reviews.length ? store.reviews.map(review => `<article><header><strong>${esc(review.username)}</strong><span>${'★'.repeat(review.stars)} · ${t('Verified purchase', 'Bestätigter Kauf')}</span></header><p>${esc(review.comment)}</p><small>${new Date(review.updatedAt).toLocaleDateString(uiLocale())}</small></article>`).join('') : `<p>${t('Be the first customer to leave a review.', 'Sei der erste Käufer mit einer Bewertung.')}</p>`}</div></section>`;
  }
  function render() {
    if (currentAccountPage !== '/stores' || !data) return;
    accountContent.innerHTML = data.disabled ? pageHeading(t('Stores are unavailable.', 'Läden sind nicht verfügbar.')) : data.store ? detail(data.store) : directory();
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
  function openHeist(entry, button) {
    returnFocus = button; game = { entry }; clearGameTimers();
    heistDialog.innerHTML = `<div class="store-heist-content">${closeButton()}<p class="eyebrow">${t('A LITTLE MISCHIEF', 'EIN BISSCHEN UNFUG')}</p><h2 id="store-heist-title">${t('Sneak past the till', 'An der Kasse vorbeischleichen')}</h2><h3>${esc(entry.item.title)}</h3><p>${t('Watch six arrows, then repeat them from memory. A perfect sequence earns a chance to escape with this item.', 'Merke dir sechs Pfeile und wiederhole sie. Eine perfekte Folge gibt dir eine Chance, mit diesem Artikel zu entkommen.')}</p><p><strong>${entry.theft.chancePercent}% ${t('escape chance', 'Fluchtchance')}</strong> · ${t('Attempt fee', 'Versuchsgebühr')}: <strong>${justizEuro(entry.theft.fee)}</strong></p><p class="store-hint">${t('The owner keeps the fee whether you win, lose or leave. Stock may sell while you play. You have 65 seconds. After starting, wait 30 minutes before another attempt.', 'Der Besitzer behält die Gebühr bei Erfolg, Misserfolg oder Abbruch. Ware kann während des Spiels verkauft werden. Du hast 65 Sekunden. Nach dem Start musst du 30 Minuten auf den nächsten Versuch warten.')}</p><button class="primary-button" data-store="start-heist">${t('Pay fee & start', 'Gebühr zahlen & starten')} · ${justizEuro(entry.theft.fee)}</button><p class="account-error" role="alert"></p></div>`;
    heistDialog.showModal(); heistDialog.querySelector('[data-store="start-heist"]').focus();
  }
  function playHeist(attempt) {
    clearGameTimers(); game = { attempt, moves: [], phase: 'watch' }; const version = gameVersion;
    heistDialog.innerHTML = `<div class="store-heist-content">${closeButton()}<h2 id="store-heist-title">${t('Watch the route', 'Merke dir den Weg')}</h2><p data-heist-status role="status" aria-live="polite">${t('Watch carefully…', 'Schau genau hin …')}</p><div class="store-memory-arrow" data-heist-arrow aria-live="polite">…</div><p data-heist-progress>0 / 6</p><div class="store-direction-pad">${directions.map((labels,index) => `<button type="button" data-store="move" data-move="${index}" disabled aria-label="${t(...labels)}">${arrows[index]}<small>${t(...labels)}</small></button>`).join('')}</div><p class="store-hint">${t('Repeat using the buttons or arrow keys. The first completed sequence is final.', 'Wiederhole mit den Tasten oder Pfeiltasten. Die erste vollständige Folge zählt.')}</p><p data-heist-time></p><p class="account-error" role="alert"></p><button class="secondary-button" data-store="retry-finish" hidden>${t('Retry result', 'Ergebnis erneut laden')}</button></div>`;
    if (!heistDialog.open) heistDialog.showModal();
    const status = heistDialog.querySelector('[data-heist-status]'), arrow = heistDialog.querySelector('[data-heist-arrow]');
    attempt.sequence.forEach((move,index) => later(() => {
      if (version !== gameVersion) return;
      arrow.textContent = arrows[move]; status.textContent = `${t('Watch', 'Ansehen')} ${index+1} / 6 · ${t(...directions[move])}`;
    }, 250 + index * 750));
    later(() => {
      if (version !== gameVersion) return;
      arrow.textContent = '?'; game.phase = 'repeat'; status.textContent = t('Your turn. Repeat the six arrows.', 'Du bist dran. Wiederhole die sechs Pfeile.');
      heistDialog.querySelectorAll('[data-store="move"]').forEach(button => button.disabled = false);
      heistDialog.querySelector('[data-store="move"]').focus({preventScroll:true});
    }, Math.max(5000, attempt.readyAt - Date.now() + 100));
    const countdown = () => {
      if (version !== gameVersion) return;
      const left = Math.max(0, Math.ceil((attempt.expiresAt-Date.now())/1000));
      heistDialog.querySelector('[data-heist-time]').textContent = `${left}s ${t('left', 'übrig')}`;
      if (!left) { if (!busy) finishHeist(); else later(countdown, 500); }
      else later(countdown, 1000);
    }; countdown();
  }
  function addMove(move) {
    if (!game || game.phase !== 'repeat' || busy || game.moves.length >= 6) return;
    game.moves.push(move); heistDialog.querySelector('[data-heist-progress]').textContent = `${game.moves.length} / 6`;
    heistDialog.querySelector('[data-heist-arrow]').textContent = arrows[move];
    if (game.moves.length === 6) finishHeist();
  }
  const outcomes = {
    stolen: ['You slipped away with the item. It’s in your inventory!', 'Du bist mit dem Artikel entkommen. Er liegt in deinem Inventar!'],
    caught: ['Caught! The till coughed. The goose looked suspicious. No loot today.', 'Erwischt! Die Kasse hustete. Die Gans schaute misstrauisch. Heute keine Beute.'],
    fumbled: ['Wrong turn! You walked straight back to the counter.', 'Falsch abgebogen! Du bist direkt zurück zur Kasse gelaufen.'],
    gone: ['Too late — the item already left the shelf. An empty-handed getaway.', 'Zu spät — der Artikel ist schon weg. Flucht mit leeren Händen.'],
    expired: ['Time ran out. Your grand escape became an awkward stroll.', 'Zeit abgelaufen. Aus der großen Flucht wurde ein peinlicher Spaziergang.']
  };
  async function finishHeist() {
    if (!game?.attempt || busy) return;
    const visit = accountVisit, owner = account?.id, attempt = game.attempt, moves = [...game.moves], version = gameVersion;
    busy = true; game.phase = 'finish'; heistDialog.querySelectorAll('[data-store="move"]').forEach(button => button.disabled = true);
    try {
      const result = await accountApi('stores/heist/finish', { heistId: attempt.id, moves });
      if (owner !== account?.id || visit !== accountVisit) return;
      updateAccount(result.user); await refresh(visit);
      if (version !== gameVersion || !heistDialog.open) return;
      clearGameTimers(); game = null;
      heistDialog.innerHTML = `<div class="store-heist-content">${closeButton()}<h2 id="store-heist-title">${t('Mischief report', 'Unfugbericht')}</h2><p role="status">${t(...outcomes[result.heist.outcome])}</p><p class="store-hint">${t('The owner keeps your attempt fee.', 'Der Besitzer behält deine Versuchsgebühr.')} ${justizEuro(result.heist.fee)}</p><div class="store-action-row">${result.heist.outcome === 'stolen' ? `<a href="/inventory" class="primary-button" data-page>${t('View inventory', 'Inventar ansehen')}</a>` : ''}<button class="secondary-button" data-store="close-heist">${t('Back to the store', 'Zurück zum Laden')}</button></div></div>`;
      heistDialog.querySelector('[data-store="close-heist"]').focus();
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
  heistDialog.addEventListener('keydown', event => {
    const move = ['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'].indexOf(event.key);
    if (move !== -1 && game?.phase === 'repeat') { event.preventDefault(); addMove(move); }
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-store]'); if (!button || currentAccountPage !== '/stores') return;
    const action = button.dataset.store;
    if (action === 'close-heist') { heistDialog.close(); return; }
    if (action === 'move') { addMove(Number(button.dataset.move)); return; }
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
        result = await mutate('stores/heist/start', { shopId: store.id, inventoryId: entry.id, expectedPrice: entry.price, expectedFee: entry.theft.fee, expectedChance: entry.theft.chancePercent }, true);
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
    const profile = currentAccountPage === '/businesses' && form.matches('[data-store-profile]');
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
  document.addEventListener('jg:language', () => { if (currentAccountPage === '/stores') render(); });
  return { load, stop, render };
})();
