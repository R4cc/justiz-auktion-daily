window.businessUi = (() => {
  const esc = accountEscape;
  let dashboard = null, auctions = [], timer = null, request = 0, mode = 'shops', busy = false;
  let selectedOffer = null, purchaseReturnFocus = null;
  const purchaseDialog = document.createElement('dialog');
  purchaseDialog.className = 'business-buy-dialog';
  purchaseDialog.setAttribute('aria-labelledby', 'business-buy-title');
  document.body.append(purchaseDialog);
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
  const offerCost = (type, size) => Math.round(size.cost * type.costFactor);
  const offerCapacity = (type, size) => type.id === 'cars' ? size.carCapacity : size.capacity;
  const hourText = value => {
    const minutes = Math.max(0, Math.ceil((value - Date.now()) / 60000));
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  };
  async function refresh(visit, repaint = true) {
    const current = ++request, owner = account?.id;
    const [lots, shops] = await Promise.all([fetch('/api/wholesale').then(r => r.ok ? r.json() : null), owner ? accountApi('businesses') : null]);
    if (current !== request || visit !== accountVisit || account?.id !== owner) return;
    if (!lots) throw new Error(t('Stock auctions are unavailable.', 'Warenauktionen sind nicht verfuegbar.'));
    auctions = lots.auctions; dashboard = shops;
    if (owner) { const session = await accountApi('me'); if (current !== request || visit !== accountVisit || account?.id !== owner) return; updateAccount(session.user); }
    if (purchaseDialog.open) updatePurchaseSelection();
    if (repaint && !busy) render();
  }
  function stop() {
    clearInterval(timer); timer = null; request++; dashboard = null; auctions = [];
    purchaseReturnFocus = null; if (purchaseDialog.open) purchaseDialog.close();
  }
  async function load(visit) {
    await refresh(visit, false);
    if (visit !== accountVisit) return;
    timer = setInterval(() => { if (!document.hidden && !busy) refresh(visit).catch(() => {}); }, 30_000);
  }
  function shopCard(shop) {
    const available = dashboard.inventory.filter(item => item.type === shop.type);
    const space = shop.capacity - shop.stock.length;
    return `<article class="business-shop"><header><div class="business-owned-title"><span class="business-owned-icon business-type-${esc(shop.type)}">${typeIcon(shop.type)}<span class="business-owned-size">${sizeIcon(shop.size)}</span></span><div><span>${esc(typeName(shop.type))} / ${esc(sizeName(shop.size))}</span><h2>${esc(typeName(shop.type))}</h2></div></div><strong>${shop.stock.length}/${shop.capacity}</strong></header>
      <dl class="business-stats"><div><dt>${t('Visitors', 'Besucher')}</dt><dd>${number(shop.visitors)}</dd></div><div><dt>${t('Popularity', 'Beliebtheit')}</dt><dd>${number(Math.round(shop.popularity * 100))}%</dd></div><div><dt>${t('Variety', 'Vielfalt')}</dt><dd>${number(shop.variety)}</dd></div><div><dt>${t('Avg. value', 'Durchschnittswert')}</dt><dd>${justizEuro(shop.value)}</dd></div><div><dt>${t('Sales', 'Verkaeufe')}</dt><dd>${number(shop.sales)}</dd></div><div><dt>${t('Revenue', 'Umsatz')}</dt><dd>${justizEuro(shop.revenue)}</dd></div></dl>
      ${shop.stock.length ? `<div class="business-stock"><h3>${t('On shelves', 'Im Regal')}</h3><ul>${shop.stock.map(entry => `<li><span>${esc(entry.item.title)}</span><strong>${justizEuro(entry.askingPrice)}</strong><button type="button" data-business="unstock" data-shop="${esc(shop.id)}" data-item="${esc(entry.id)}" aria-label="${esc(t('Remove from store', 'Aus Geschaeft nehmen'))}: ${esc(entry.item.title)}">×</button></li>`).join('')}</ul></div>` : `<p class="business-empty">${t('Shelves are empty.', 'Die Regale sind leer.')}</p>`}
      ${space && available.length ? `<form class="business-stock-form" data-shop="${esc(shop.id)}"><fieldset><legend>${t('Stock from inventory', 'Aus Inventar einraeumen')}</legend><div class="business-stock-choices">${available.map(item => `<label><input type="checkbox" name="inventoryId" value="${esc(item.id)}"><span>${esc(item.title)}</span><small>${justizEuro(Math.round(item.price))}</small></label>`).join('')}</div></fieldset><button class="secondary-button" type="submit">${t('Stock selected', 'Auswahl einraeumen')}</button><small>${space} ${t('spaces free', 'Plaetze frei')}</small><p class="account-error" role="alert"></p></form>` : space ? `<p class="business-empty">${t('Win stock auctions or collect matching items to fill this shop.', 'Gewinne Warenauktionen oder sammle passende Artikel.')}</p>` : ''}</article>`;
  }
  function shopsView() {
    if (!account) return `<section class="collection-empty"><h2>${t('Sign in to open a business.', 'Melde dich an, um ein Geschaeft zu eroeffnen.')}</h2><a class="primary-button" href="/login" data-page>${t('Log in', 'Anmelden')}</a></section>`;
    return `${economyOverviewMarkup()}<section class="business-purchase"><h2>${t('Your stores', 'Deine Geschaefte')}</h2><button class="primary-button" type="button" data-business="open-buy">${t('Buy store', 'Geschaeft kaufen')}</button></section>
      <section class="business-owned">${dashboard?.shops.length ? `<div class="business-shop-grid">${dashboard.shops.map(shopCard).join('')}</div>` : `<p class="collection-empty">${t('No stores yet.', 'Noch keine Geschaefte.')}</p>`}</section>`;
  }
  function renderPurchaseDialog() {
    if (!dashboard) return;
    purchaseDialog.innerHTML = `<form id="business-buy-form"><header class="business-dialog-header"><div><p class="eyebrow">${t('LOCATIONS', 'STANDORTE')}</p><h2 id="business-buy-title">${t('Choose a store', 'Geschaeft waehlen')}</h2></div><button class="dialog-close" type="button" data-business="close-buy" aria-label="${t('Close', 'Schliessen')}">×</button></header>
      <div class="business-dialog-options">${dashboard.sizes.map(size => `<section class="business-size-section"><header class="business-size-heading"><span>${sizeIcon(size.id)}</span><h3>${esc(sizeName(size.id))}</h3><small>${size.visitorsPerHour} ${t('visitors/hour', 'Besucher/Stunde')}</small></header><div class="business-choice-grid" role="group" aria-label="${esc(sizeName(size.id))}">${dashboard.types.map(type => {
        const value = `${type.id}:${size.id}`, checked = selectedOffer === value;
        return `<label class="business-choice business-type-${esc(type.id)}${checked ? ' is-selected' : ''}"><input type="radio" name="business-option" value="${value}" ${checked ? 'checked' : ''} required><span class="business-choice-art">${typeIcon(type.id)}<span>${sizeIcon(size.id)}</span></span><strong>${esc(typeName(type.id))}</strong><span class="business-choice-capacity">${t('Storage', 'Lager')} <b>${offerCapacity(type, size)}</b></span><span class="business-choice-price">${justizEuro(offerCost(type, size))}</span></label>`;
      }).join('')}</div></section>`).join('')}</div><footer class="business-dialog-footer"><div><strong data-business-summary>${t('Select a store', 'Geschaeft auswaehlen')}</strong><p class="account-error" role="alert"></p></div><button class="primary-button" type="submit" disabled>${t('Buy store', 'Geschaeft kaufen')}</button></footer></form>`;
    updatePurchaseSelection();
  }
  function updatePurchaseSelection() {
    const input = purchaseDialog.querySelector('input[name="business-option"]:checked');
    const summary = purchaseDialog.querySelector('[data-business-summary]');
    const buy = purchaseDialog.querySelector('button[type="submit"]');
    if (!input || !dashboard || !account) { if (buy) buy.disabled = true; return; }
    selectedOffer = input.value;
    const [typeId, sizeId] = selectedOffer.split(':');
    const type = dashboard.types.find(entry => entry.id === typeId);
    const size = dashboard.sizes.find(entry => entry.id === sizeId);
    const cost = offerCost(type, size);
    summary.textContent = `${typeName(typeId)} · ${sizeName(sizeId)} · ${offerCapacity(type, size)} ${t('spaces', 'Plaetze')}`;
    buy.textContent = account.tokens >= cost ? `${t('Buy store', 'Geschaeft kaufen')} · ${justizEuro(cost)}` : t('Not enough J€', 'Nicht genug J€');
    buy.disabled = account.tokens < cost || busy;
    purchaseDialog.querySelectorAll('.business-choice').forEach(card => card.classList.toggle('is-selected', card.querySelector('input').checked));
  }
  function openPurchaseDialog(button) {
    if (!account || !dashboard) return;
    selectedOffer = null; purchaseReturnFocus = button;
    renderPurchaseDialog(); purchaseDialog.showModal();
    purchaseDialog.querySelector('.dialog-close')?.focus({ preventScroll: true });
  }
  purchaseDialog.addEventListener('close', () => {
    selectedOffer = null;
    if (purchaseReturnFocus?.isConnected) purchaseReturnFocus.focus({ preventScroll: true });
    purchaseReturnFocus = null;
  });
  purchaseDialog.addEventListener('click', event => { if (event.target === purchaseDialog) purchaseDialog.close(); });
  function auctionsView() {
    const bids = dashboard?.bids || [];
    return `<section class="business-auctions"><div class="business-intro"><h2>${t('NPC direct auctions', 'NPC-Direktauktionen')}</h2><p>${t('Each winning bid buys the complete batch. Units arrive separately in your inventory when the auction ends.', 'Jedes Gewinnergebot kauft das gesamte Los. Nach Auktionsende landen die Stuecke einzeln im Inventar.')}</p></div>${bids.length ? `<div class="business-bid-history"><h3>${t('Your bids', 'Deine Gebote')}</h3><ul>${bids.map(lot => `<li><span>${lot.quantity} × ${esc(lot.title)}</span><strong>${lot.status === 'active' ? lot.leading ? t('Leading', 'Du fuehrst') : t('Outbid', 'Ueberboten') : lot.won ? t('Won', 'Gewonnen') : t('Lost', 'Verloren')}</strong><small>${justizEuro(lot.highestBid)}</small></li>`).join('')}</ul></div>` : ''}<div class="business-lot-grid">${auctions.map(lot => {
      const next = lot.currentBid === null ? lot.reserve : lot.currentBid + lot.bidIncrement;
      return `<article class="business-lot"><span class="business-lot-category">${esc(typeName(lot.type))}</span><h3>${lot.quantity} × ${esc(lot.title)}</h3><p>${t('Market value', 'Marktwert')} ${justizEuro(lot.unitValue)} ${t('each', 'pro Stueck')} · ${hourText(lot.endsAt)}</p><div class="business-lot-bid"><strong>${justizEuro(lot.currentBid ?? lot.reserve)}</strong><span>${lot.currentBid === null ? t('Reserve', 'Startpreis') : t('Current bid', 'Aktuelles Gebot')}</span></div>${account ? `<form class="business-bid-form" data-lot="${esc(lot.id)}"><label>${t('Your bid', 'Dein Gebot')}<input name="amount" type="number" min="${next}" step="1" value="${next}" required></label><button class="secondary-button" type="submit">${t('Bid', 'Bieten')}</button><p class="account-error" role="alert"></p></form>` : `<a class="secondary-button" href="/login" data-page>${t('Log in to bid', 'Zum Bieten anmelden')}</a>`}</article>`;
    }).join('')}</div></section>`;
  }
  function render() {
    if (currentAccountPage !== '/businesses') return;
    accountContent.innerHTML = pageHeading(t('Businesses', 'Geschaefte')) + `<div class="business-tabs" role="tablist" aria-label="${t('Business views', 'Geschaeftsansichten')}"><button type="button" role="tab" aria-selected="${mode === 'shops'}" data-business="shops">${t('My stores', 'Meine Geschaefte')}</button><button type="button" role="tab" aria-selected="${mode === 'auctions'}" data-business="auctions">${t('Stock auctions', 'Warenauktionen')}</button></div>${mode === 'shops' ? shopsView() : auctionsView()}`;
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-business]'); if (!button || currentAccountPage !== '/businesses') return;
    if (button.dataset.business === 'open-buy') { openPurchaseDialog(button); return; }
    if (button.dataset.business === 'close-buy') { purchaseDialog.close(); return; }
    if (button.dataset.business === 'unstock') {
      if (busy) return; busy = true; button.disabled = true;
      const visit = accountVisit, owner = account?.id;
      try {
        await accountApi('businesses/unstock', { shopId: button.dataset.shop, inventoryId: button.dataset.item });
        if (visit === accountVisit && account?.id === owner) await refresh(visit);
      } catch (error) { if (visit === accountVisit) showToast(error.message); }
      finally { busy = false; if (visit === accountVisit) render(); }
      return;
    }
    mode = button.dataset.business; render();
  });
  document.addEventListener('change', event => { if (event.target.matches('input[name="business-option"]')) updatePurchaseSelection(); });
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (currentAccountPage !== '/businesses' || !['business-buy-form', 'business-stock-form', 'business-bid-form'].some(name => form.classList.contains(name) || form.id === name)) return;
    event.preventDefault(); if (busy || (form.id === 'business-buy-form' && !selectedOffer)) return; busy = true;
    const visit = accountVisit, owner = account?.id, button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    let completed = false;
    try {
      let result;
      if (form.id === 'business-buy-form') {
        const [type, size] = selectedOffer.split(':');
        result = await accountApi('businesses/buy', { type, size });
      }
      else if (form.classList.contains('business-stock-form')) result = await accountApi('businesses/stock', { shopId: form.dataset.shop, inventoryIds: [...form.querySelectorAll('input:checked')].map(input => input.value) });
      else result = await accountApi('wholesale/bid', { id: form.dataset.lot, amount: Number(form.elements.amount.value) });
      if (account?.id !== owner || visit !== accountVisit) return;
      if (result.user) updateAccount(result.user);
      await refresh(visit);
      completed = true;
      if (form.id === 'business-buy-form' && purchaseDialog.open) purchaseDialog.close();
      showToast(t('Done.', 'Erledigt.'));
    } catch (error) { if (visit === accountVisit) form.querySelector('.account-error').textContent = error.message; }
    finally {
      busy = false;
      if (form.id === 'business-buy-form' && purchaseDialog.open) updatePurchaseSelection();
      else if (button.isConnected) button.disabled = false;
      if (completed && visit === accountVisit) render();
    }
  });
  document.addEventListener('jg:language', () => {
    if (currentAccountPage === '/businesses') render();
    if (purchaseDialog.open) renderPurchaseDialog();
  });
  return { load, stop, render };
})();
