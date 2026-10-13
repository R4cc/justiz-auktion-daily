window.storeReputationUi = (() => {
  const esc = value => accountEscape(value);
  function meter(store) {
    const value = Math.max(0, Math.min(100, Number(store.popularityPercent) || 0));
    return `<div class="store-popularity"><div class="store-popularity-label"><span>${t('Popularity', 'Beliebtheit')}</span><strong>${number(value)}%</strong></div><div class="store-popularity-track" role="meter" aria-label="${esc(t('Store popularity', 'Beliebtheit des Ladens'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"><span style="width:${value}%"></span></div></div>`;
  }
  function histogram(store) {
    const rows = store.reviewDistribution || [1,2,3,4,5].map(stars => ({ stars, count: 0 }));
    const maximum = Math.max(1, ...rows.map(row => row.count));
    return `<div class="store-rating-chart" role="group" aria-label="${esc(t('Reviews by star rating', 'Bewertungen nach Sternen'))}">${[...rows].reverse().map(row => `<div class="store-rating-row" aria-label="${row.stars} ${t('stars', 'Sterne')}: ${number(row.count)} ${t('reviews', 'Bewertungen')}"><span>${row.stars} <b aria-hidden="true">★</b></span><span class="store-rating-track" aria-hidden="true"><i style="width:${row.count / maximum * 100}%"></i></span><strong>${number(row.count)}</strong></div>`).join('')}</div>${store.purchasedReviewCount ? `<p class="store-rating-note">${number(store.purchasedReviewCount)} ${t('purchased reviews · reduced influence', 'gekaufte Bewertungen · verringerter Einfluss')}</p>` : ''}`;
  }
  const packArt = item => `<div class="review-pack-art" aria-hidden="true"><span>1–5 ★</span><strong>${number(item.reviewCount)}</strong></div>`;
  function packCard(item) {
    const copies = item.copies || [item], available = copies.filter(copy => !copy.listed && !copy.storeId);
    const focus = new URLSearchParams(location.search).get('focus');
    const chosen = available.find(copy => copy.id === focus) || available[0] || item;
    return `<article class="collection-item review-pack-card" data-review-pack="${esc(chosen.id)}"><span class="rarity-label">${t('Review pack', 'Bewertungspaket')}</span>${packArt(item)}<h3>${esc(t(`${item.reviewCount} configurable reviews`, `${item.reviewCount} frei wählbare Bewertungen`))}</h3>${copies.length > 1 ? `<p>×${number(copies.length)} ${t('packs', 'Pakete')}</p>` : ''}<p>${t('Choose 1–5 stars for your store or another player’s store. Reviews have limited influence and no written comments.', 'Wähle 1–5 Sterne für deinen Laden oder den eines anderen Spielers. Bewertungen haben begrenzten Einfluss und keinen Text.')}</p>${available.length ? `<button class="primary-button" type="button" data-review-pack-action="choose" data-id="${esc(chosen.id)}" ${!economyFlags.businesses ? 'disabled' : ''}>${t('Redeem reviews', 'Bewertungen einlösen')}</button>${economyFlags.resales ? `<button class="secondary-button" data-economy="list" data-id="${esc(chosen.id)}">${t('List for auction', 'Zur Auktion anbieten')}</button>` : ''}` : `<p class="item-state">${t('Listed for auction', 'Zur Auktion angeboten')}</p>`}</article>`;
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'economy-dialog review-pack-dialog'; dialog.setAttribute('aria-labelledby', 'review-pack-title');
  document.body.append(dialog);
  let sequence = 0, busy = false, pending = null, returnId = null;
  function stop() { sequence++; pending = null; dialog.close(); }
  const storeName = shop => shop.name || traderStoreLabel(shop.type);
  const allShops = () => [...pending.own, ...pending.other.stores];
  function choices(shops, own) {
    return shops.map(shop => `<button class="secondary-button review-store-choice${pending.selected?.id === shop.id ? ' selected' : ''}" type="button" data-review-pack-action="select" data-shop="${esc(shop.id)}" aria-pressed="${pending.selected?.id === shop.id}" ${busy ? 'disabled' : ''}><span class="review-store-owner">${own ? t('Your store', 'Dein Laden') : t('Other player', 'Anderer Spieler') + ' · ' + esc(shop.owner)}</span><strong>${esc(storeName(shop))}</strong><span class="review-store-rating">${shop.rating === null ? t('No ratings yet', 'Noch keine Bewertungen') : `★ ${number(shop.rating)} / 5`} · ${number(shop.reviewCount)} ${t('reviews', 'Bewertungen')}</span>${meter(shop)}${shop.purchasedReviewInfluenceCapped ? `<small class="review-cap-note">${t('Purchased review influence is capped', 'Der Einfluss gekaufter Bewertungen ist begrenzt')}</small>` : ''}</button>`).join('');
  }
  function paint() {
    if (!pending) return;
    const { item, own, other, stars, selected, query } = pending;
    const direction = stars < 3 ? t('Negative', 'Negativ') : stars > 3 ? t('Positive', 'Positiv') : t('Neutral', 'Neutral');
    dialog.innerHTML = `<div class="economy-dialog-content"><button class="dialog-close" data-review-pack-action="close" aria-label="${t('Close','Schließen')}">×</button><h2 id="review-pack-title">${t('Configure your reviews', 'Bewertungen konfigurieren')}</h2><p>${number(item.reviewCount)} ${t('reviews · this pack can be used once.', 'Bewertungen · dieses Paket kann einmal eingelöst werden.')}</p><label class="review-stars-label" for="review-pack-stars">${t('Stars to apply', 'Sterne vergeben')}</label><select id="review-pack-stars" ${busy ? 'disabled' : ''}>${[5,4,3,2,1].map(value => `<option value="${value}" ${value === stars ? 'selected' : ''}>${value} ★ · ${value < 3 ? t('Negative','Negativ') : value > 3 ? t('Positive','Positiv') : t('Neutral','Neutral')}</option>`).join('')}</select><p class="review-campaign-note">${t('Boost your business or lower a competitor’s rating. Bought reviews have limited influence.', 'Stärke deinen Laden oder senke die Bewertung eines Konkurrenten. Gekaufte Bewertungen haben begrenzten Einfluss.')}</p><div class="review-targets"><section class="review-target-group review-target-own" aria-labelledby="review-own-title"><h3 id="review-own-title">${t('Your stores', 'Deine Läden')}</h3><div class="review-store-choices">${choices(own, true) || `<p>${t('You do not own a store yet. You can still select another player’s store.', 'Du besitzt noch keinen Laden. Du kannst trotzdem den Laden eines anderen Spielers auswählen.')}</p>`}</div></section><section class="review-target-group review-target-other" aria-labelledby="review-other-title"><h3 id="review-other-title">${t('Other players’ stores', 'Läden anderer Spieler')}</h3><form class="review-store-search"><label for="review-store-query">${t('Find a store or player', 'Laden oder Spieler suchen')}</label><div><input id="review-store-query" name="query" maxlength="80" value="${esc(query)}" ${busy ? 'disabled' : ''}><button class="secondary-button" type="submit" ${busy ? 'disabled' : ''}>${t('Search','Suchen')}</button></div></form><div class="review-store-choices">${choices(other.stores, false) || `<p>${t('No matching stores from other players.', 'Keine passenden Läden anderer Spieler.')}</p>`}</div>${other.total > other.limit ? `<div class="review-target-pages"><button class="secondary-button" data-review-pack-action="page" data-offset="${Math.max(0, other.offset - other.limit)}" ${busy || !other.offset ? 'disabled' : ''}>${t('Previous','Zurück')}</button><span>${number(other.offset + 1)}–${number(other.offset + other.stores.length)} / ${number(other.total)}</span><button class="secondary-button" data-review-pack-action="page" data-offset="${other.offset + other.limit}" ${busy || other.offset + other.stores.length >= other.total ? 'disabled' : ''}>${t('Next','Weiter')}</button></div>` : ''}</section></div><div class="review-apply-summary"><p aria-live="polite">${selected ? `${direction} · ${number(item.reviewCount)} × ${stars} ★ → <strong>${esc(storeName(selected))}</strong><br>${selected.ownerId === account?.id ? t('Your store','Dein Laden') : t('Other player','Anderer Spieler') + ' · ' + esc(selected.owner)}` : t('Select a store to continue.', 'Wähle einen Laden aus.')}</p><button class="primary-button" type="button" data-review-pack-action="redeem" ${busy || !selected ? 'disabled' : ''}>${t(`Apply ${item.reviewCount} reviews with ${stars} stars`, `${item.reviewCount} Bewertungen mit ${stars} Sternen anwenden`)}</button></div><p class="account-error" role="alert"></p></div>`;
  }
  dialog.addEventListener('close', () => {
    if (currentAccountPage === '/inventory') accountContent.querySelector(`[data-review-pack-action="choose"][data-id="${CSS.escape(returnId || '')}"]`)?.focus({preventScroll:true});
  });
  dialog.addEventListener('cancel', stop);
  dialog.addEventListener('change', event => {
    if (event.target.id !== 'review-pack-stars' || !pending || busy) return;
    pending.stars = Number(event.target.value); paint(); dialog.querySelector('#review-pack-stars').focus({preventScroll:true});
  });
  async function search(query, offset) {
    if (!pending || busy) return;
    const request = ++sequence, active = pending; busy = true; paint();
    try {
      const result = await accountApi(`inventory/reviews/targets?query=${encodeURIComponent(query)}&offset=${offset}`);
      if (request !== sequence || pending !== active) return;
      pending.other = result.other; pending.own = result.own; pending.query = query; pending.selected = null;
      busy = false; paint(); dialog.querySelector('#review-store-query').focus({preventScroll:true});
    } catch (error) {
      if (request === sequence && pending === active) { busy = false; paint(); dialog.querySelector('.account-error').textContent = error.message; }
    } finally { busy = false; }
  }
  dialog.addEventListener('submit', event => {
    if (!event.target.matches('.review-store-search')) return;
    event.preventDefault(); search(new FormData(event.target).get('query'), 0);
  });
  document.addEventListener('jg:language', () => { if (dialog.open && !busy) paint(); });
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-review-pack-action]');
    if (!button) return;
    const action = button.dataset.reviewPackAction;
    if (action === 'close') { stop(); return; }
    if (!account || busy || currentAccountPage !== '/inventory') return;
    if (action === 'select' && pending) {
      pending.selected = allShops().find(shop => shop.id === button.dataset.shop) || null;
      paint(); dialog.querySelector('[data-review-pack-action="redeem"]').focus(); return;
    }
    if (action === 'page' && pending) { search(pending.query, Number(button.dataset.offset)); return; }
    const item = accountItems.find(entry => entry.id === (action === 'choose' ? button.dataset.id : pending?.item.id));
    if (!item || item.kind !== 'review-pack' || item.listed || item.storeId || (action === 'redeem' && !pending?.selected)) return;
    const owner = account.id, visit = accountVisit, request = ++sequence;
    const current = () => request === sequence && account?.id === owner && accountVisit === visit && currentAccountPage === '/inventory';
    busy = true; button.disabled = true;
    try {
      if (action === 'choose') {
        const result = await accountApi('inventory/reviews/targets');
        if (!current()) return;
        returnId = item.id; pending = { item, ...result, stars: 5, selected: null, query: '' };
        busy = false; paint(); dialog.showModal();
        dialog.scrollTop = 0; dialog.querySelector('.economy-dialog-content').scrollTop = 0;
        dialog.querySelector('#review-pack-stars').focus({preventScroll:true});
      } else if (action === 'redeem') {
        const payload = { inventoryId: item.id, shopId: pending.selected.id, stars: pending.stars };
        paint();
        const result = await accountApi('inventory/reviews/redeem', payload);
        if (!current()) return;
        updateAccount(result.user); dialog.close(); pending = null;
        await navigateAccountPage('/inventory', false);
        showToast(t(`${result.receipt.reviewCount} reviews with ${result.receipt.stars} stars applied.`, `${result.receipt.reviewCount} Bewertungen mit ${result.receipt.stars} Sternen hinzugefügt.`));
      }
    } catch (error) {
      if (current()) { if (dialog.open) { busy = false; paint(); dialog.querySelector('.account-error').textContent = error.message; } else showToast(error.message); }
    } finally { busy = false; if (button.isConnected) button.disabled = false; }
  });
  return { meter, histogram, packArt, packCard, stop };
})();
