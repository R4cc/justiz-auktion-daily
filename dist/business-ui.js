window.businessUi = (() => {
  const esc = accountEscape;
  let dashboard = null, auctions = [], timer = null, request = 0, mode = 'shops', busy = false;
  const names = { wine: ['Wine store', 'Weinhandlung'], toys: ['Toy store', 'Spielwarenladen'],
    electronics: ['Electronics store', 'Elektronikladen'], cars: ['Car dealership', 'Autohaus'] };
  const sizeNames = { popup: ['Street pop-up', 'Strassenstand'], tiny: ['Tiny shop', 'Kleiner Laden'],
    medium: ['Medium shop', 'Mittlerer Laden'], large: ['Large shop', 'Grosser Laden'] };
  const typeName = id => names[id] ? t(...names[id]) : id;
  const sizeName = id => sizeNames[id] ? t(...sizeNames[id]) : id;
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
    if (repaint && !busy) render();
  }
  function stop() { clearInterval(timer); timer = null; request++; dashboard = null; auctions = []; }
  async function load(visit) {
    await refresh(visit, false);
    if (visit !== accountVisit) return;
    timer = setInterval(() => { if (!document.hidden && !busy) refresh(visit).catch(() => {}); }, 30_000);
  }
  function shopCard(shop) {
    const available = dashboard.inventory.filter(item => item.type === shop.type);
    const space = shop.capacity - shop.stock.length;
    return `<article class="business-shop"><header><div><span>${esc(typeName(shop.type))} / ${esc(sizeName(shop.size))}</span><h2>${esc(typeName(shop.type))}</h2></div><strong>${shop.stock.length}/${shop.capacity}</strong></header>
      <dl class="business-stats"><div><dt>${t('Visitors', 'Besucher')}</dt><dd>${number(shop.visitors)}</dd></div><div><dt>${t('Popularity', 'Beliebtheit')}</dt><dd>${number(Math.round(shop.popularity * 100))}%</dd></div><div><dt>${t('Variety', 'Vielfalt')}</dt><dd>${number(shop.variety)}</dd></div><div><dt>${t('Avg. value', 'Durchschnittswert')}</dt><dd>${justizEuro(shop.value)}</dd></div><div><dt>${t('Sales', 'Verkaeufe')}</dt><dd>${number(shop.sales)}</dd></div><div><dt>${t('Revenue', 'Umsatz')}</dt><dd>${justizEuro(shop.revenue)}</dd></div></dl>
      ${shop.stock.length ? `<div class="business-stock"><h3>${t('On shelves', 'Im Regal')}</h3><ul>${shop.stock.map(entry => `<li><span>${esc(entry.item.title)}</span><strong>${justizEuro(entry.askingPrice)}</strong><button type="button" data-business="unstock" data-shop="${esc(shop.id)}" data-item="${esc(entry.id)}" aria-label="${esc(t('Remove from store', 'Aus Geschaeft nehmen'))}: ${esc(entry.item.title)}">×</button></li>`).join('')}</ul></div>` : `<p class="business-empty">${t('Shelves are empty.', 'Die Regale sind leer.')}</p>`}
      ${space && available.length ? `<form class="business-stock-form" data-shop="${esc(shop.id)}"><fieldset><legend>${t('Stock from inventory', 'Aus Inventar einraeumen')}</legend><div class="business-stock-choices">${available.map(item => `<label><input type="checkbox" name="inventoryId" value="${esc(item.id)}"><span>${esc(item.title)}</span><small>${justizEuro(Math.round(item.price))}</small></label>`).join('')}</div></fieldset><button class="secondary-button" type="submit">${t('Stock selected', 'Auswahl einraeumen')}</button><small>${space} ${t('spaces free', 'Plaetze frei')}</small><p class="account-error" role="alert"></p></form>` : space ? `<p class="business-empty">${t('Win stock auctions or collect matching items to fill this shop.', 'Gewinne Warenauktionen oder sammle passende Artikel.')}</p>` : ''}</article>`;
  }
  function shopsView() {
    if (!account) return `<section class="collection-empty"><h2>${t('Sign in to open a business.', 'Melde dich an, um ein Geschaeft zu eroeffnen.')}</h2><a class="primary-button" href="/login" data-page>${t('Log in', 'Anmelden')}</a></section>`;
    const types = dashboard?.types || [], sizes = dashboard?.sizes || [];
    return `${economyOverviewMarkup()}<section class="business-purchase"><div><h2>${t('Open a business', 'Geschaeft eroeffnen')}</h2><p>${t('Buy a location, then stock it with matching items. Customers arrive each hour, including while you are away.', 'Kaufe einen Standort und bestuecke ihn mit passenden Artikeln. Kunden kommen stuendlich, auch wenn du offline bist.')}</p></div><form id="business-buy-form"><label>${t('Store type', 'Geschaeftsart')}<select name="type">${types.map(type => `<option value="${type.id}">${esc(typeName(type.id))}</option>`).join('')}</select></label><label>${t('Size', 'Groesse')}<select name="size">${sizes.map(size => `<option value="${size.id}">${esc(sizeName(size.id))} · ${size.capacity} ${t('slots', 'Plaetze')}</option>`).join('')}</select></label><div class="business-price"><span>${t('Purchase price', 'Kaufpreis')}</span><strong data-business-price></strong></div><button class="primary-button" type="submit">${t('Buy store', 'Geschaeft kaufen')}</button><p class="account-error" role="alert"></p></form></section>
      <section class="business-owned"><h2>${t('Your stores', 'Deine Geschaefte')}</h2>${dashboard?.shops.length ? `<div class="business-shop-grid">${dashboard.shops.map(shopCard).join('')}</div>` : `<p class="collection-empty">${t('No stores yet.', 'Noch keine Geschaefte.')}</p>`}</section>`;
  }
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
    updatePrice();
  }
  function updatePrice() {
    const form = accountContent.querySelector('#business-buy-form'); if (!form || !dashboard) return;
    const type = dashboard.types.find(type => type.id === form.elements.type.value);
    const size = dashboard.sizes.find(size => size.id === form.elements.size.value);
    const cost = Math.round(size.cost * type.costFactor);
    form.querySelector('[data-business-price]').textContent = justizEuro(cost);
    form.querySelector('button[type="submit"]').disabled = account.tokens < cost;
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-business]'); if (!button || currentAccountPage !== '/businesses') return;
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
  document.addEventListener('change', event => { if (event.target.closest('#business-buy-form')) updatePrice(); });
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (currentAccountPage !== '/businesses' || !['business-buy-form', 'business-stock-form', 'business-bid-form'].some(name => form.classList.contains(name) || form.id === name)) return;
    event.preventDefault(); if (busy) return; busy = true;
    const visit = accountVisit, owner = account?.id, button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    let completed = false;
    try {
      let result;
      if (form.id === 'business-buy-form') result = await accountApi('businesses/buy', { type: form.elements.type.value, size: form.elements.size.value });
      else if (form.classList.contains('business-stock-form')) result = await accountApi('businesses/stock', { shopId: form.dataset.shop, inventoryIds: [...form.querySelectorAll('input:checked')].map(input => input.value) });
      else result = await accountApi('wholesale/bid', { id: form.dataset.lot, amount: Number(form.elements.amount.value) });
      if (account?.id !== owner || visit !== accountVisit) return;
      if (result.user) updateAccount(result.user);
      await refresh(visit);
      completed = true;
      showToast(t('Done.', 'Erledigt.'));
    } catch (error) { if (visit === accountVisit) form.querySelector('.account-error').textContent = error.message; }
    finally { busy = false; if (button.isConnected) button.disabled = false; if (completed && visit === accountVisit) render(); }
  });
  document.addEventListener('jg:language', () => { if (currentAccountPage === '/businesses') render(); });
  return { load, stop, render };
})();
