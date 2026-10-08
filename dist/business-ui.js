window.businessUi = (() => {
  const esc = accountEscape;
  let dashboard = null, timer = null, request = 0, busy = false;
  let selectedOffer = null, purchaseReturnFocus = null, restockReturnFocus = null, restockShopId = null, restockGroups = [], restockSignature = null;
  let editorShopId = null, editorReturnFocus = null;
  const editorDialog = document.createElement('dialog');
  editorDialog.className = 'business-editor-dialog'; editorDialog.setAttribute('aria-labelledby', 'business-editor-title'); document.body.append(editorDialog);
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
    if (editorDialog.open) syncEditor();
    if (purchaseDialog.open) updatePurchaseSelection();
    if (restockDialog.open) {
      if (stockManagerSignature() !== restockSignature) syncRestockDialog();
      else updateRestockSelection();
    }
    if (repaint && !busy && !restockDialog.open && !document.activeElement?.closest('[data-business-margin-form], [data-store-profile]')) render();
  }
  function stop() {
    clearInterval(timer); timer = null; request++; dashboard = null;
    editorShopId = null; editorReturnFocus = null; editorDialog.close();
    purchaseReturnFocus = null; if (purchaseDialog.open) purchaseDialog.close();
    restockReturnFocus = null; restockShopId = null; restockSignature = null; if (restockDialog.open) restockDialog.close();
  }
  async function load(visit) {
    if (account) await window.storeUi.loadEvents(visit);
    if (visit !== accountVisit) return;
    await refresh(visit, false);
    if (visit !== accountVisit) return;
    timer = setInterval(() => { if (!document.hidden && !busy) refresh(visit).catch(() => {}); }, 30_000);
  }
  const editIcon = () => icon('<path d="m8 32 23-23 8 8-23 23-11 3 3-11Z M27 13l8 8 M7 43h34"/>', 'business-action-icon');
  function storefrontArt(type) {
    return `<svg class="business-card-scene" viewBox="0 0 280 160" fill="none" aria-hidden="true"><circle cx="228" cy="30" r="15" fill="var(--choice-accent)" opacity=".12"/><path d="M14 144h252" stroke="var(--choice-accent)" opacity=".25"/><rect x="40" y="49" width="200" height="95" rx="3" fill="#fffaf0" stroke="var(--choice-accent)" stroke-width="2"/><rect x="48" y="27" width="184" height="27" rx="3" fill="var(--choice-accent)"/><text x="140" y="45" text-anchor="middle" fill="#fffaf0" font-size="10" font-family="Manrope, sans-serif" font-weight="700" letter-spacing="1">${esc(typeName(type).toUpperCase())}</text><path d="M36 54h208l-10 26H46L36 54Z" fill="var(--choice-accent)"/>${[0,1,2,3,4,5,6].map(n => `<path d="M${36+n*30} 54h15l${n < 3 ? 3 : -3} 26h-15Z" fill="#fffaf0" opacity=".85"/>`).join('')}<rect x="57" y="91" width="91" height="41" rx="2" fill="var(--choice-tint)" stroke="var(--choice-accent)" stroke-width="1.5"/><svg x="82" y="93" width="38" height="38" viewBox="0 0 48 48" stroke="var(--choice-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${typeIcons[type]}</svg><rect x="174" y="91" width="45" height="53" rx="2" fill="var(--choice-tint)" stroke="var(--choice-accent)" stroke-width="1.5"/><path d="M180 97h33v22h-33Z" fill="#fffaf0"/><circle cx="209" cy="130" r="2" fill="var(--choice-accent)"/><path d="M25 143v-15m-7 3 7-13 7 13" stroke="var(--choice-accent)" stroke-width="2" stroke-linecap="round"/><rect x="250" y="127" width="9" height="17" rx="1" fill="var(--choice-accent)" opacity=".45"/></svg>`;
  }
  function shopCard(shop) {
    const filled = Math.min(100, Math.round(shop.stock.length / shop.capacity * 100));
    return `<article class="business-shop business-type-${esc(shop.type)}"><div class="business-card-art"><div class="business-card-badges"><span>${esc(sizeName(shop.size))}</span><span class="business-card-state${!shop.stock.length ? ' is-empty' : ''}"><i aria-hidden="true"></i>${shop.stock.length ? t('Open for business', 'Laden geöffnet') : t('Needs stock', 'Waren fehlen')}</span></div>${storefrontArt(shop.type)}</div><div class="business-card-body"><p class="business-card-category">${esc(typeName(shop.type))}</p><h2>${esc(shop.name || typeName(shop.type))}</h2><p class="business-card-motto">${esc(shop.motto || t('A little shop. A lot of possibilities.', 'Ein kleiner Laden. Große Möglichkeiten.'))}</p><dl class="business-card-stats"><div><dt>${t('Revenue today', 'Umsatz heute')}</dt><dd>${justizEuro(shop.revenueToday)}</dd></div><div><dt>${t('Sales today', 'Verkäufe heute')}</dt><dd>${number(shop.salesToday)}</dd></div></dl><div class="business-card-stock"><div><span>${t('On the shelves', 'In den Regalen')}</span><strong>${number(shop.stock.length)} <span>/ ${number(shop.capacity)}</span></strong></div><progress value="${shop.stock.length}" max="${shop.capacity}" aria-label="${esc(t('Shelf capacity used', 'Belegte Regalplätze'))}">${filled}%</progress></div><div class="business-card-details"><span>${number(shop.profitMargin)}% ${t('margin', 'Gewinnspanne')}</span>${shop.gooseGuard ? `<span>${t('Goose protected', 'Wachgans im Dienst')}</span>` : `<span>${number(shop.visitors)} ${t('visitors', 'Besucher')}</span>`}</div><div class="business-card-actions"><button class="business-edit-button" type="button" data-business="open-edit" data-shop="${esc(shop.id)}" aria-label="${esc(t('Edit store', 'Laden bearbeiten'))}: ${esc(shop.name || typeName(shop.type))}">${editIcon()}${t('Edit store', 'Laden bearbeiten')}</button><a href="/stores?shop=${encodeURIComponent(shop.id)}" data-page>${t('Visit', 'Besuchen')} <span aria-hidden="true">↗</span></a></div></div></article>`;
  }
  function shopsView() {
    if (!account) return `<section class="business-guest"><p class="eyebrow">${t('YOUR NEXT CHAPTER', 'DEIN NÄCHSTES KAPITEL')}</p><h1 tabindex="-1">${t('A shop of your own.', 'Dein eigener Laden.')}</h1><p>${t('Turn your finds into a storefront worth visiting.', 'Mach aus deinen Fundstücken einen Laden, den man gerne besucht.')}</p><a class="primary-button" href="/login" data-page>${t('Log in to get started', 'Anmelden und loslegen')}</a></section>`;
    const shops = dashboard?.shops || [], max = dashboard?.maxStores || 3, canBuy = shops.length < max;
    const total = key => shops.reduce((sum, shop) => sum + shop[key], 0);
    return `<div class="business-portfolio"><header class="business-hero"><div><p class="eyebrow">${t('YOUR BUSINESSES', 'DEINE LÄDEN')}</p><h1 tabindex="-1">${t('Your little empire.', 'Dein kleines Imperium.')}</h1><p>${t('Good finds. Full shelves. Big possibilities.', 'Gute Fundstücke. Volle Regale. Große Möglichkeiten.')}</p><a href="/stores" data-page>${t('Explore the neighbourhood', 'Entdecke die Nachbarschaft')} <span aria-hidden="true">↗</span></a></div><div class="business-hero-account"><span class="business-location-count">${shops.length} / ${max} ${t('locations', 'Standorte')}</span><div class="business-location-dots" aria-hidden="true">${Array.from({length:max},(_,n)=>`<span class="${n < shops.length ? 'is-owned' : ''}">${String(n+1).padStart(2,'0')}</span>`).join('')}</div><small>${t('Available to invest', 'Zum Investieren verfügbar')}</small><strong>${justizEuro(account.tokens)}</strong></div></header><dl class="business-portfolio-stats"><div><dt>${t('Revenue today', 'Umsatz heute')}</dt><dd>${justizEuro(total('revenueToday'))}</dd></div><div><dt>${t('Items on shelves', 'Artikel im Regal')}</dt><dd>${number(shops.reduce((sum, shop) => sum + shop.stock.length, 0))}</dd></div><div><dt>${t('Sales today', 'Verkäufe heute')}</dt><dd>${number(total('salesToday'))}</dd></div></dl><section class="business-owned"><div class="business-portfolio-heading"><div><p class="eyebrow">${t('THE PORTFOLIO', 'DEIN PORTFOLIO')}</p><h2>${t('Your storefronts', 'Deine Schaufenster')}</h2></div><button class="business-new-button" type="button" data-business="open-buy" ${canBuy ? '' : 'disabled'}><span aria-hidden="true">＋</span>${canBuy ? t('Open a store', 'Laden eröffnen') : t('All locations filled', 'Alle Standorte belegt')}</button></div><div class="business-shop-grid">${shops.map(shopCard).join('')}${canBuy ? `<button class="business-add-card" type="button" data-business="open-buy"><span class="business-add-icon" aria-hidden="true">＋</span><strong>${shops.length ? t('Room for something new.', 'Platz für etwas Neues.') : t('Every empire starts somewhere.', 'Jedes Imperium fängt klein an.')}</strong><span>${t('Wine, toys, tech or cars. Make the next shop yours.', 'Wein, Spielzeug, Technik oder Autos. Mach den nächsten Laden zu deinem.')}</span><b>${t('Choose your next store', 'Wähle deinen nächsten Laden')} <span aria-hidden="true">→</span></b></button>` : ''}</div></section><aside class="business-events-note"><span aria-hidden="true">✦</span><div><strong>${t('A little chaos comes with the keys.', 'Ein bisschen Chaos gehört dazu.')}</strong><p>${t('After the first day, each stocked store has a 25% event chance every 24 hours. Expect lucky buyouts, surprise losses and the occasional goose. You can always restock.', 'Nach dem ersten Tag hat jeder gefüllte Laden alle 24 Stunden eine Ereignischance von 25%. Freu dich auf glückliche Ausverkäufe, überraschende Verluste und gelegentliche Gänse. Du kannst immer wieder auffüllen.')}</p></div></aside></div>`;
  }
  function renderEditor(draft = null) {
    const shop = dashboard?.shops.find(entry => entry.id === editorShopId); if (!shop) return;
    editorDialog.innerHTML = `<header class="business-editor-header"><span class="business-editor-icon business-type-${esc(shop.type)}">${typeIcon(shop.type)}</span><div><p class="eyebrow">${esc(typeName(shop.type))} · ${esc(sizeName(shop.size))}</p><h2 id="business-editor-title" data-editor-title>${esc(shop.name || typeName(shop.type))}</h2></div><button class="dialog-close" type="button" data-business="close-edit" aria-label="${t('Close', 'Schließen')}">×</button></header><div class="business-editor-content"><div><section class="business-editor-section"><h3>${t('Make it yours', 'Mach ihn zu deinem Laden')}</h3><p>${t('The name above the door. The attitude inside.', 'Der Name über der Tür. Der Charakter dahinter.')}</p><form class="store-profile-form" data-store-profile data-shop="${esc(shop.id)}"><label>${t('Store name', 'Ladenname')}<input name="storeName" maxlength="60" value="${esc(draft?.name ?? shop.name ?? '')}" placeholder="${esc(typeName(shop.type))}"></label><label>${t('Tagline', 'Ladenspruch')}<input name="motto" maxlength="140" value="${esc(draft?.motto ?? shop.motto ?? '')}"></label><label class="store-guard-choice"><input name="gooseGuard" type="checkbox" ${shop.gooseGuard || draft?.guard ? 'checked' : ''} ${shop.gooseGuard ? 'disabled' : ''}><span data-editor-guard>${shop.gooseGuard ? t('Goose guard on duty · HONK!', 'Wachgans im Dienst · HUP!') : t('Hire a goose guard · J€250 once · halves theft chance', 'Wachgans einstellen · einmalig J€250 · halbiert Diebstahlchance')}</span></label><button type="submit" class="business-edit-button">${t('Save storefront', 'Ladenauftritt speichern')}</button><p class="account-error" role="alert"></p></form></section><section class="business-editor-section"><h3>${t('Price it right', 'Der richtige Preis')}</h3><form class="business-margin" data-business-margin-form data-shop="${esc(shop.id)}"><label>${t('Margin over market value', 'Gewinnspanne auf Marktwert')}<span><input name="profitMargin" type="number" min="0" max="100" step="1" value="${draft?.margin ?? shop.profitMargin}" inputmode="numeric" required> %</span></label><button class="secondary-button" type="submit">${t('Save margin', 'Gewinnspanne speichern')}</button><p>${t('Higher margins and expensive items reduce sales per visitor.', 'Höhere Gewinnspannen und teure Artikel senken die Verkäufe pro Besucher.')}</p><p class="account-error" role="alert"></p></form></section></div><div><section class="business-editor-section business-editor-shelves"><span class="business-editor-shelf-art business-type-${esc(shop.type)}">${storefrontArt(shop.type)}</span><h3>${t('Keep the shelves full', 'Halte die Regale voll')}</h3><p data-editor-stock></p><button class="business-edit-button" type="button" data-business="open-restock" data-shop="${esc(shop.id)}">${t('Manage stock', 'Warenbestand verwalten')} <span aria-hidden="true">→</span></button><a href="/marketplace" data-page>${t('Find new stock on the marketplace', 'Neue Waren auf dem Marktplatz finden')} ↗</a></section><section class="business-editor-section"><h3>${t('Behind the counter', 'Hinter der Ladentheke')}</h3><dl class="business-editor-stats" data-editor-stats></dl><a class="business-editor-visit" href="/stores?shop=${encodeURIComponent(shop.id)}" data-page>${t('Visit your storefront', 'Deinen Laden besuchen')} <span aria-hidden="true">↗</span></a></section></div></div>`;
    syncEditor();
  }
  function syncEditor() {
    const shop = dashboard?.shops.find(entry => entry.id === editorShopId);
    if (!shop) { if (editorDialog.open) editorDialog.close(); return; }
    editorDialog.querySelector('[data-editor-title]').textContent = shop.name || typeName(shop.type);
    const available = dashboard.inventory.filter(item => item.type === shop.type).length;
    editorDialog.querySelector('[data-editor-stock]').textContent = `${shop.stock.length} / ${shop.capacity} ${t('on shelves', 'im Regal')} · ${available} ${t('ready to add', 'zum Einräumen bereit')}`;
    const metrics = [[t('Total revenue','Umsatz gesamt'),justizEuro(shop.revenue)],[t('Total sales','Verkäufe gesamt'),number(shop.sales)],[t('Visitors','Besucher'),number(shop.visitors)],[t('Popularity','Beliebtheit'),`${number(Math.round(shop.popularity*100))}%`],[t('Buying rate','Kaufrate'),`${number(shop.buyChancePercent,1)}%`],[t('Margin','Gewinnspanne'),`${shop.profitMargin}%`]];
    editorDialog.querySelector('[data-editor-stats]').innerHTML = metrics.map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
    if (shop.gooseGuard) {
      const guard = editorDialog.querySelector('[name="gooseGuard"]'); guard.checked = true; guard.disabled = true;
      editorDialog.querySelector('[data-editor-guard]').textContent = t('Goose guard on duty · HONK!', 'Wachgans im Dienst · HUP!');
    }
  }
  function openEditor(button) {
    if (!dashboard?.shops.some(shop => shop.id === button.dataset.shop)) return;
    editorShopId = button.dataset.shop; editorReturnFocus = button; renderEditor(); editorDialog.showModal();
    editorDialog.querySelector('.dialog-close').focus({preventScroll:true});
  }
  editorDialog.addEventListener('close', () => {
    const id = editorShopId; editorShopId = null;
    const replacement = id ? accountContent.querySelector(`[data-business="open-edit"][data-shop="${CSS.escape(id)}"]`) : null;
    (replacement || (editorReturnFocus?.isConnected ? editorReturnFocus : null))?.focus({preventScroll:true}); editorReturnFocus = null;
  });
  editorDialog.addEventListener('click', event => { if (event.target === editorDialog) editorDialog.close(); });
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
    buy.disabled = account.tokens < cost || busy || dashboard.shops.length >= dashboard.maxStores;
    purchaseDialog.querySelectorAll('.business-choice').forEach(card => card.classList.toggle('is-selected', card.querySelector('input').checked));
  }
  function openPurchaseDialog(button) {
    if (!account || !dashboard || dashboard.shops.length >= dashboard.maxStores) return;
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
    accountContent.innerHTML = shopsView();
    if (editorDialog.open) syncEditor();
    window.storeUi.showEvents();
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-business]'); if (!button || currentAccountPage !== '/businesses') return;
    if (button.dataset.business === 'open-edit') { openEditor(button); return; }
    if (button.dataset.business === 'close-edit') { editorDialog.close(); return; }
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
      finally { busy = false; if (button.isConnected) button.disabled = false; if (visit === accountVisit) render(); }
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
    if (editorDialog.open && !editorDialog.querySelector('button[type="submit"]:disabled')) {
      const form = editorDialog.querySelector('[data-store-profile]');
      renderEditor({name:form.elements.storeName.value,motto:form.elements.motto.value,guard:form.elements.gooseGuard.checked,margin:editorDialog.querySelector('[name="profitMargin"]').value});
    }
    if (purchaseDialog.open) renderPurchaseDialog();
    if (restockDialog.open) {
      const quantities = [...restockDialog.querySelectorAll('input[name="quantity"]')].map(input => Number(input.value));
      renderRestockDialog(quantities);
    }
  });
  return { load, stop, render, refresh };
})();
