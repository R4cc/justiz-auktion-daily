window.businessUi = (() => {
  const esc = accountEscape;
  let dashboard = null, timer = null, request = 0, busy = false;
  let selectedOffer = null, purchaseReturnFocus = null, restockReturnFocus = null, restockShopId = null, restockGroups = [], restockSignature = null;
  const purchaseDialog = document.createElement('dialog');
  purchaseDialog.className = 'business-buy-dialog';
  purchaseDialog.setAttribute('aria-labelledby', 'business-buy-title');
  document.body.append(purchaseDialog);
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
  const offerCost = (type, size) => Math.round(size.cost * type.costFactor);
  const offerCapacity = (type, size) => type.id === 'cars' ? size.carCapacity : size.capacity;
  async function refresh(visit, repaint = true) {
    const current = ++request, owner = account?.id;
    const shops = owner ? await accountApi('businesses') : null;
    if (current !== request || visit !== accountVisit || account?.id !== owner) return;
    dashboard = shops;
    if (owner) { const session = await accountApi('me'); if (current !== request || visit !== accountVisit || account?.id !== owner) return; updateAccount(session.user); }
    if (purchaseDialog.open) updatePurchaseSelection();
    if (restockDialog.open) {
      if (stockManagerSignature() !== restockSignature) syncRestockDialog();
      else updateRestockSelection();
    }
    if (repaint && !busy && !restockDialog.open && !document.activeElement?.closest('[data-business-margin-form]')) render();
  }
  function stop() {
    clearInterval(timer); timer = null; request++; dashboard = null;
    purchaseReturnFocus = null; if (purchaseDialog.open) purchaseDialog.close();
    restockReturnFocus = null; restockShopId = null; restockSignature = null; if (restockDialog.open) restockDialog.close();
  }
  async function load(visit) {
    await refresh(visit, false);
    if (visit !== accountVisit) return;
    timer = setInterval(() => { if (!document.hidden && !busy) refresh(visit).catch(() => {}); }, 30_000);
  }
  function shopCard(shop) {
    const available = dashboard.inventory.filter(item => item.type === shop.type).length;
    return `<article class="business-shop"><header><div class="business-owned-title"><span class="business-owned-icon business-type-${esc(shop.type)}">${typeIcon(shop.type)}<span class="business-owned-size">${sizeIcon(shop.size)}</span></span><div><span>${esc(sizeName(shop.size))}</span><h2>${esc(typeName(shop.type))}</h2></div></div></header>
      <dl class="business-stats"><div><dt>${t('Visitors', 'Besucher')}</dt><dd>${number(shop.visitors)}</dd></div><div><dt>${t('Popularity', 'Beliebtheit')}</dt><dd>${number(Math.round(shop.popularity * 100))}%</dd></div><div><dt>${t('Total sales', 'Verkäufe gesamt')}</dt><dd>${number(shop.sales)}</dd></div><div><dt>${t('Sales today', 'Verkäufe heute')}</dt><dd>${number(shop.salesToday)}</dd></div><div><dt>${t('Total revenue', 'Umsatz gesamt')}</dt><dd>${justizEuro(shop.revenue)}</dd></div><div><dt>${t('Revenue today', 'Umsatz heute')}</dt><dd>${justizEuro(shop.revenueToday)}</dd></div><div><dt>${t('Margin', 'Gewinnspanne')}</dt><dd>${number(shop.profitMargin)}%</dd></div><div><dt>${t('Stock', 'Warenbestand')}</dt><dd>${number(shop.stock.length)} / ${number(shop.capacity)}</dd></div></dl>
      <form class="business-margin" data-business-margin-form data-shop="${esc(shop.id)}"><label>${t('Set margin over market value', 'Gewinnspanne auf Marktwert festlegen')}<span><input name="profitMargin" type="number" min="0" max="100" step="1" value="${shop.profitMargin}" inputmode="numeric" required> %</span></label><button class="secondary-button" type="submit">${t('Save margin', 'Gewinnspanne speichern')}</button><p>${t('Estimated buying rate per visitor', 'Geschätzte Kaufrate pro Besucher')}: <strong>${number(shop.buyChancePercent, 1)}%</strong>. ${t('Higher margins reduce buying, while visitor traffic stays the same.', 'Höhere Gewinnspannen senken die Kaufrate; die Besucherzahl bleibt gleich.')}</p><p class="account-error" role="alert"></p></form>
      <div class="business-stock-actions"><div><strong>${t('Inventory', 'Inventar')}</strong><small>${available} ${t('available to add', 'zum Einräumen verfügbar')} · ${Math.max(0, shop.capacity - shop.stock.length)} ${t('spaces free', 'Plätze frei')}</small></div><button class="secondary-button" type="button" data-business="open-restock" data-shop="${esc(shop.id)}">${t('Manage stock', 'Warenbestand verwalten')}</button></div></article>`;
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
    restockDialog.innerHTML = `<form id="business-restock-form"><header class="business-dialog-header"><div><p class="eyebrow">${t('INVENTORY', 'INVENTAR')}</p><h2 id="business-restock-title">${t('Manage stock', 'Warenbestand verwalten')} · ${esc(typeName(shop.type))}</h2><small>${shop.stock.length} / ${shop.capacity} ${t('on shelves', 'im Regal')}</small></div><button class="dialog-close" type="button" data-business="close-restock" aria-label="${t('Close', 'Schließen')}">×</button></header>
      <div class="business-dialog-options business-stock-manager"><section class="business-stock-panel" aria-labelledby="business-available-title"><div class="business-stock-panel-heading"><div><p class="eyebrow">${t('FROM YOUR INVENTORY', 'AUS DEINEM INVENTAR')}</p><h3 id="business-available-title">${t('Available to add', 'Zum Einräumen verfügbar')}</h3><small>${restockGroups.reduce((sum, group) => sum + group.items.length, 0)} ${t('items', 'Artikel')} · ${space} ${t('spaces free', 'Plätze frei')}</small></div><button class="secondary-button" type="button" data-business="auto-restock" ${space && restockGroups.length ? '' : 'disabled'}>${t('Auto fill', 'Automatisch füllen')}</button></div>
        ${restockGroups.length ? `<div class="business-restock-list">${restockGroups.map((group, index) => `<label class="business-restock-row"><span><strong>${esc(group.title)}</strong><small>${group.items.length} ${t('available', 'verfügbar')} · ${justizEuro(Math.round(group.price))} ${t('each', 'pro Stück')}</small></span><input type="number" name="quantity" data-index="${index}" min="0" max="${Math.min(space, group.items.length)}" step="1" value="${quantities[index] || 0}" inputmode="numeric" aria-label="${esc(group.title)} ${t('quantity to add', 'Anzahl zum Einräumen')}"></label>`).join('')}</div>` : `<p class="business-panel-empty">${t('No matching inventory is available.', 'Keine passenden Artikel im Inventar verfügbar.')} <a href="/marketplace" data-page>${t('Browse marketplace', 'Marktplatz ansehen')}</a></p>`}</section>
        <section class="business-stock-panel" aria-labelledby="business-shelves-title"><div class="business-stock-panel-heading"><div><p class="eyebrow">${t('IN THIS STORE', 'IN DIESEM GESCHÄFT')}</p><h3 id="business-shelves-title">${t('On shelves', 'Im Regal')}</h3><small>${shop.stock.length} / ${shop.capacity} ${t('stocked', 'eingeräumt')}</small></div></div>
        ${shop.stock.length ? `<ul class="business-shelf-list">${shop.stock.map(entry => `<li><span><strong>${esc(entry.item.title)}</strong><small>${t('Market', 'Markt')} ${justizEuro(entry.referencePrice)} · ${t('Shelf', 'Regal')} ${justizEuro(entry.askingPrice)}</small></span><button class="secondary-button" type="button" data-business="unstock" data-shop="${esc(shop.id)}" data-item="${esc(entry.id)}" aria-label="${esc(t('Remove from store', 'Aus Geschäft nehmen'))}: ${esc(entry.item.title)}">${t('Remove', 'Entfernen')}</button></li>`).join('')}</ul>` : `<p class="business-panel-empty">${t('The shelves are empty. Add items from your inventory.', 'Die Regale sind leer. Räume Artikel aus deinem Inventar ein.')}</p>`}</section></div>
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
    if (shopId && currentAccountPage === '/businesses') render();
    const focus = shopId ? accountContent.querySelector(`[data-business="open-restock"][data-shop="${CSS.escape(shopId)}"]`) : null;
    if (focus || restockReturnFocus?.isConnected) (focus || restockReturnFocus).focus({ preventScroll: true });
    restockReturnFocus = null;
  });
  restockDialog.addEventListener('click', event => { if (event.target === restockDialog) restockDialog.close(); });
  function render() {
    if (currentAccountPage !== '/businesses') return;
    accountContent.innerHTML = pageHeading(t('Businesses', 'Geschaefte')) + shopsView();
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-business]'); if (!button || currentAccountPage !== '/businesses') return;
    if (button.dataset.business === 'open-buy') { openPurchaseDialog(button); return; }
    if (button.dataset.business === 'close-buy') { purchaseDialog.close(); return; }
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
  document.addEventListener('change', event => { if (event.target.matches('input[name="business-option"]')) updatePurchaseSelection(); });
  document.addEventListener('input', event => {
    if (restockDialog.open && event.target.matches('input[name="quantity"]')) updateRestockSelection(event.target);
  });
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (currentAccountPage === '/businesses' && form.matches('[data-business-margin-form]')) {
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
        if (visit === accountVisit) showToast(t('Margin saved.', 'Gewinnspanne gespeichert.'));
      } catch (error) { if (visit === accountVisit) form.querySelector('.account-error').textContent = error.message; }
      finally { busy = false; if (visit === accountVisit) render(); }
      return;
    }
    if (currentAccountPage !== '/businesses' || !['business-buy-form', 'business-restock-form'].includes(form.id)) return;
    event.preventDefault();
    if (busy || (form.id === 'business-buy-form' && !selectedOffer)) return;
    const quantities = form.id === 'business-restock-form'
      ? [...form.querySelectorAll('input[name="quantity"]')].map(input => Number(input.value)) : [];
    const shop = dashboard?.shops.find(entry => entry.id === restockShopId);
    const space = shop ? shop.capacity - shop.stock.length : 0;
    if (form.id === 'business-restock-form' && (!shop || quantities.some((value, index) =>
      !Number.isSafeInteger(value) || value < 0 || value > restockGroups[index].items.length)
      || quantities.reduce((sum, value) => sum + value, 0) < 1
      || quantities.reduce((sum, value) => sum + value, 0) > space)) return;
    busy = true;
    const visit = accountVisit, owner = account?.id, button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    let completed = false;
    try {
      let result;
      if (form.id === 'business-buy-form') {
        const [type, size] = selectedOffer.split(':');
        result = await accountApi('businesses/buy', { type, size });
      }
      else result = await accountApi('businesses/stock', { shopId: restockShopId,
        inventoryIds: restockGroups.flatMap((group, index) => group.items.slice(0, quantities[index]).map(item => item.id)) });
      if (account?.id !== owner || visit !== accountVisit) return;
      if (result.user) updateAccount(result.user);
      await refresh(visit);
      completed = true;
      if (form.id === 'business-buy-form' && purchaseDialog.open) purchaseDialog.close();
      if (form.id === 'business-restock-form' && restockDialog.open) restockDialog.close();
      showToast(t('Done.', 'Erledigt.'));
    } catch (error) { if (visit === accountVisit) form.querySelector('.account-error').textContent = error.message; }
    finally {
      busy = false;
      if (form.id === 'business-buy-form' && purchaseDialog.open) updatePurchaseSelection();
      else if (form.id === 'business-restock-form' && restockDialog.open) updateRestockSelection();
      else if (button.isConnected) button.disabled = false;
      if (completed && visit === accountVisit) render();
    }
  });
  document.addEventListener('jg:language', () => {
    if (currentAccountPage === '/businesses') render();
    if (purchaseDialog.open) renderPurchaseDialog();
    if (restockDialog.open) {
      const quantities = [...restockDialog.querySelectorAll('input[name="quantity"]')].map(input => Number(input.value));
      renderRestockDialog(quantities);
    }
  });
  return { load, stop, render };
})();
