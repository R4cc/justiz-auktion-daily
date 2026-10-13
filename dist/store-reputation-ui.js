window.storeReputationUi = (() => {
  const esc = value => accountEscape(value);
  function meter(store) {
    const value = Math.max(0, Math.min(100, Number(store.popularityPercent) || 0));
    return `<div class="store-popularity"><div class="store-popularity-label"><span>${t('Popularity', 'Beliebtheit')}</span><strong>${number(value)}%</strong></div><div class="store-popularity-track" role="meter" aria-label="${esc(t('Store popularity', 'Beliebtheit des Ladens'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"><span style="width:${value}%"></span></div></div>`;
  }
  function histogram(store) {
    const rows = store.reviewDistribution || [1,2,3,4,5].map(stars => ({ stars, count: 0 }));
    const maximum = Math.max(1, ...rows.map(row => row.count));
    return `<div class="store-rating-chart" role="group" aria-label="${esc(t('Reviews by star rating', 'Bewertungen nach Sternen'))}">${[...rows].reverse().map(row => `<div class="store-rating-row" aria-label="${row.stars} ${t('stars', 'Sterne')}: ${number(row.count)} ${t('reviews', 'Bewertungen')}"><span>${row.stars} <b aria-hidden="true">★</b></span><span class="store-rating-track" aria-hidden="true"><i style="width:${row.count / maximum * 100}%"></i></span><strong>${number(row.count)}</strong></div>`).join('')}</div>${store.purchasedReviewCount ? `<p class="store-rating-note">${number(store.purchasedReviewCount)} ${t('purchased five-star reviews · reduced influence', 'gekaufte Fünf-Sterne-Bewertungen · verringerter Einfluss')}</p>` : ''}`;
  }
  const packArt = item => `<div class="review-pack-art" aria-hidden="true"><span>★★★★★</span><strong>${number(item.reviewCount)}</strong></div>`;
  function packCard(item) {
    const copies = item.copies || [item], available = copies.filter(copy => !copy.listed && !copy.storeId);
    const focus = new URLSearchParams(location.search).get('focus');
    const chosen = available.find(copy => copy.id === focus) || available[0] || item;
    return `<article class="collection-item review-pack-card" data-review-pack="${esc(chosen.id)}"><span class="rarity-label">${t('Review pack', 'Bewertungspaket')}</span>${packArt(item)}<h3>${esc(t(item.title, item.titleDe || item.title))}</h3>${copies.length > 1 ? `<p>×${number(copies.length)} ${t('packs', 'Pakete')}</p>` : ''}<p>${t('Apply to a store you own. Five-star totals only, with a limited popularity boost.', 'Für einen eigenen Laden einlösen. Fünf-Sterne-Bewertungen ohne Text, mit begrenztem Beliebtheitsbonus.')}</p>${available.length ? `<button class="primary-button" type="button" data-review-pack-action="choose" data-id="${esc(chosen.id)}" ${!economyFlags.businesses ? 'disabled' : ''}>${t('Redeem reviews', 'Bewertungen einlösen')}</button>${economyFlags.resales ? `<button class="secondary-button" data-economy="list" data-id="${esc(chosen.id)}">${t('List for auction', 'Zur Auktion anbieten')}</button>` : ''}` : `<p class="item-state">${t('Listed for auction', 'Zur Auktion angeboten')}</p>`}</article>`;
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'economy-dialog review-pack-dialog'; dialog.setAttribute('aria-labelledby', 'review-pack-title');
  document.body.append(dialog);
  let sequence = 0, busy = false, pending = null, returnId = null;
  function stop() { sequence++; pending = null; dialog.close(); }
  function paint() {
    if (!pending) return;
    const { item, shops } = pending;
    dialog.innerHTML = `<div class="economy-dialog-content"><button class="dialog-close" data-review-pack-action="close" aria-label="${t('Close','Schließen')}">×</button><h2 id="review-pack-title">${t('Choose a store', 'Laden auswählen')}</h2>${packArt(item)}<p>${number(item.reviewCount)} ${t('five-star reviews. Redeeming uses this pack once.', 'Fünf-Sterne-Bewertungen. Dieses Paket kann einmal eingelöst werden.')}</p><div class="review-store-choices">${shops.map(shop => `<button class="secondary-button" data-review-pack-action="redeem" data-id="${esc(item.id)}" data-shop="${esc(shop.id)}" ${busy ? 'disabled' : ''}>${esc(shop.name || traderStoreLabel(shop.type))}${meter(shop)}${shop.purchasedReviewInfluenceCapped ? `<small class="review-cap-note">${t('Review bonus capped · adds rating counts only', 'Bewertungsbonus erreicht · erhöht nur die Bewertungsanzahl')}</small>` : ''}</button>`).join('') || `<p>${t('Open a store before redeeming these reviews.', 'Eröffne einen Laden, bevor du diese Bewertungen einlöst.')}</p><a class="primary-button" href="/businesses" data-page>${t('Your stores','Deine Läden')} →</a>`}</div><p class="account-error" role="alert"></p></div>`;
  }
  dialog.addEventListener('close', () => {
    if (currentAccountPage === '/inventory') accountContent.querySelector(`[data-review-pack-action="choose"][data-id="${CSS.escape(returnId || '')}"]`)?.focus({preventScroll:true});
  });
  document.addEventListener('jg:language', () => { if (dialog.open && !busy) paint(); });
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-review-pack-action]');
    if (!button) return;
    if (button.dataset.reviewPackAction === 'close') { stop(); return; }
    if (!account || busy || currentAccountPage !== '/inventory') return;
    const item = accountItems.find(entry => entry.id === button.dataset.id);
    if (!item || item.kind !== 'review-pack' || item.listed || item.storeId) return;
    const owner = account.id, visit = accountVisit, request = ++sequence;
    const current = () => request === sequence && account?.id === owner && accountVisit === visit && currentAccountPage === '/inventory';
    busy = true; button.disabled = true;
    try {
      if (button.dataset.reviewPackAction === 'choose') {
        const result = await accountApi('businesses');
        if (!current()) return;
        returnId = item.id; pending = { item, shops: result.shops };
        busy = false; paint(); dialog.showModal();
        (dialog.querySelector('[data-review-pack-action="redeem"]') || dialog.querySelector('.dialog-close')).focus({preventScroll:true});
      } else {
        const result = await accountApi('inventory/reviews/redeem', { inventoryId: item.id, shopId: button.dataset.shop });
        if (!current()) return;
        updateAccount(result.user); dialog.close(); pending = null;
        await navigateAccountPage('/inventory', false);
        showToast(t(`${result.receipt.reviewCount} five-star reviews applied.`, `${result.receipt.reviewCount} Fünf-Sterne-Bewertungen hinzugefügt.`));
      }
    } catch (error) {
      if (current()) { if (dialog.open) dialog.querySelector('.account-error').textContent = error.message; else showToast(error.message); }
    } finally { busy = false; if (button.isConnected) button.disabled = false; }
  });
  return { meter, histogram, packArt, packCard, stop };
})();
