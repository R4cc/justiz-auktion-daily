// Player-facing views share account routing, translation, cards and the case reel.
function progressionMarkup(p) {
  if (!p) return '';
  return `<section class="progression"><div><h2>${t('Level', 'Level')} ${p.level}</h2><span>${number(p.xp)} XP</span></div>
    <progress max="1" value="${p.progress}" aria-label="${t('Level progress', 'Levelfortschritt')}"></progress>
    <p>${p.nextLevelXp === null ? t('Level 20 reached', 'Level 20 erreicht') : t(`${number(p.nextLevelXp - p.xp)} XP to next level`, `${number(p.nextLevelXp - p.xp)} XP bis zum nächsten Level`)}</p>
    <small>${t('Daily: 150 XP · Successful sales: 10–200 XP', 'Daily: 150 XP · Erfolgreiche Verkäufe: 10–200 XP')}</small></section>`;
}

window.economyUi = (() => {
  const api = window.justizEconomy, esc = accountEscape;
  const routes = { '/auctions': 'paletteAuctions', '/marketplace': 'resales', '/market': 'market', '/news': 'news' };
  const dialog = document.createElement('dialog');
  dialog.className = 'economy-dialog'; dialog.setAttribute('aria-labelledby', 'economy-dialog-title');
  document.body.append(dialog);
  let data = {}, tab = 'public', timer, clockTimer, sequence = 0, dialogSequence = 0, busy = false;
  let category = null, history = [], historySequence = 0, reveal = null, revealPosition = 0, detailId = null, returnFocus;
  const name = lot => t(lot.name, lot.nameDe || lot.name);
  const tokens = value => `${number(value)} ${t('tokens', 'Tokens')}`;
  const date = value => new Date(value).toLocaleString(uiLocale());
  const categoryNames = {
    electronics: ['Electronics', 'Elektronik'], vehicles: ['Vehicles', 'Fahrzeuge'], wine: ['Wine', 'Wein'],
    watches_jewelry: ['Watches & jewellery', 'Uhren & Schmuck'], tools: ['Tools', 'Werkzeuge'],
    collectibles: ['Collectibles', 'Sammlerstücke'], household: ['Home & garden', 'Haus & Garten'],
    luxury_goods: ['Luxury', 'Luxus'], bicycles: ['Bicycles', 'Fahrräder'], books_media: ['Books & media', 'Bücher & Medien'],
    fashion: ['Fashion', 'Mode'], cosmetics: ['Beauty', 'Kosmetik'], sport_leisure: ['Sport & leisure', 'Sport & Freizeit'],
    other: ['Other', 'Sonstiges']
  };
  const categoryName = id => categoryNames[id] ? t(...categoryNames[id]) : t('Mixed finds', 'Gemischte Fundstücke');
  const remaining = end => {
    const seconds = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    return seconds ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : t('Ended', 'Beendet');
  };
  const countdown = end => `<time class="economy-countdown" data-economy-end="${end}" datetime="${new Date(end).toISOString()}" aria-live="off">${remaining(end)}</time>`;
  const empty = text => `<p class="collection-empty">${text}</p>`;
  const status = lot => lot.status === 'cancelled' ? t('Cancelled', 'Storniert') : lot.status === 'active' ? t('Active', 'Aktiv') : lot.winnerId ? t('Sold', 'Verkauft') : t('Unsold', 'Nicht verkauft');
  const bidHistory = bids => bids.map(bid => `<li><strong>${esc(bid.bidderUsername)}</strong> ${tokens(bid.amount)} <time>${date(bid.createdAt)}</time></li>`).join('') || `<li>${t('No bids yet', 'Noch keine Gebote')}</li>`;
  const story = lot => ({ title: t(lot.story?.title || name(lot), lot.story?.titleDe || name(lot)),
    body: t(lot.story?.body || '', lot.story?.bodyDe || paletteStoryDe(lot.paletteId)) });
  function stop() {
    clearInterval(timer); clearInterval(clockTimer); sequence++; historySequence++; dialogSequence++;
    detailId = null; reveal = null; dialog.close(); busy = false;
  }
  function openDialog(markup) {
    if (!dialog.open) returnFocus = document.activeElement;
    dialog.innerHTML = `<div class="economy-dialog-content"><button class="dialog-close" data-economy="close" aria-label="${t('Close', 'Schließen')}">×</button>${markup}</div>`;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('h2')?.focus({ preventScroll: true });
  }
  dialog.addEventListener('close', () => {
    dialogSequence++; detailId = null; reveal = null;
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    else accountContent.querySelector('h1')?.focus({ preventScroll: true });
  });
  async function load(path, visit) {
    tab = 'public'; data = {}; history = []; category = null;
    if (!economyFlags[routes[path]]) return;
    await refresh(path, visit, false);
    if (visit !== accountVisit) return;
    timer = setInterval(() => { if (!document.hidden) refresh(path, visit, true).catch(() => showToast(t('Could not refresh auctions. Try again.', 'Auktionen konnten nicht aktualisiert werden. Versuche es erneut.'))); }, 12_000);
    clockTimer = setInterval(() => {
      if (document.hidden) return;
      document.querySelectorAll('[data-economy-end]').forEach(node => { node.textContent = remaining(Number(node.dataset.economyEnd)); });
    }, 1000);
  }
  async function refresh(path, visit, repaint) {
    const request = ++sequence, owner = account?.id;
    let next;
    if (path === '/auctions') {
      const [lots, mine] = await Promise.all([api.paletteAuctions(), owner ? api.myPaletteAuctions(100) : null]);
      if (!lots) throw new Error(t('Auctions are unavailable. Please retry.', 'Auktionen sind nicht verfügbar. Bitte erneut versuchen.'));
      next = { lots: lots.auctions, mine: mine?.auctions || [] };
    } else if (path === '/marketplace') {
      const [lots, mine] = await Promise.all([api.resales(200), owner ? api.myListings() : null]);
      if (!lots) throw new Error(t('Marketplace is unavailable. Please retry.', 'Marktplatz ist nicht verfügbar. Bitte erneut versuchen.'));
      next = { lots: lots.listings, mine: mine?.listings || [] };
    } else if (path === '/market') {
      next = await api.market();
      if (!next) throw new Error(t('Market is unavailable.', 'Markt ist nicht verfügbar.'));
    } else {
      next = await api.news();
      if (!next) throw new Error(t('News is unavailable.', 'Nachrichten sind nicht verfügbar.'));
    }
    const detailRequest = dialogSequence, currentDetail = detailId;
    const detail = currentDetail && dialog.open
      ? path === '/auctions' ? (await api.paletteAuction(currentDetail))?.auction : (await api.resale(currentDetail))?.listing : null;
    const session = owner ? await accountApi('me') : null;
    if (request !== sequence || visit !== accountVisit || account?.id !== owner) return;
    if (session && session.user?.id !== owner) {
      updateAccount(session.user); data = {};
      await navigateAccountPage(path, false);
      return;
    }
    if (session) updateAccount(session.user);
    data = next;
    if (path === '/market') {
      category ||= data.categories[0]?.category;
      await loadHistory(category, visit, false);
      if (request !== sequence || visit !== accountVisit) return;
    }
    if (repaint && !busy) {
      const focus = document.activeElement;
      const focusKey = focus?.dataset?.id, focusAction = focus?.dataset?.economy;
      render();
      if (!dialog.open && focusAction) [...accountContent.querySelectorAll('[data-economy]')]
        .find(el => el.dataset.economy === focusAction && el.dataset.id === focusKey)?.focus({ preventScroll: true });
      // Refresh visible bid facts without destroying an in-progress bid input.
      const lot = detailRequest === dialogSequence && detailId === currentDetail ? detail : null;
      const facts = dialog.querySelector('[data-live-facts]');
      if (lot && facts) facts.innerHTML = bidFacts(lot, path === '/auctions');
      const historyNode = dialog.querySelector('[data-live-history]');
      if (lot?.bids && historyNode) historyNode.innerHTML = bidHistory(lot.bids);
      const bidInput = dialog.querySelector('input[name="amount"]');
      if (lot && bidInput) {
        bidInput.min = String(lot.currentBid === null ? lot.reserve ?? lot.startPrice : lot.currentBid + 1);
        if (lot.status !== 'active' || lot.endsAt <= Date.now()) {
          const form = bidInput.closest('form');
          form.querySelector('button[type="submit"]').disabled = true;
          form.querySelector('.account-error').textContent = t('This auction has ended. Check your auction history.', 'Diese Auktion ist beendet. Sieh in deinem Auktionsverlauf nach.');
        }
      }
    }
  }
  function tabs(primary) {
    return `<div class="economy-tabs" role="group" aria-label="${t('Auction view', 'Auktionsansicht')}">
      <button data-economy="tab" data-id="public" aria-pressed="${tab === 'public'}">${t('Live auctions', 'Laufende Auktionen')}</button>
      <button data-economy="tab" data-id="mine" aria-pressed="${tab === 'mine'}">${primary ? t('My bids', 'Meine Gebote') : t('My listings', 'Meine Angebote')}</button></div>`;
  }
  function bidFacts(lot, primary) {
    return `<div class="economy-bid"><strong>${tokens(lot.currentBid ?? (primary ? lot.reserve : lot.startPrice))}</strong><span>${lot.currentBid === null ? t('Starting bid', 'Startgebot') : t('Current bid', 'Aktuelles Gebot')}</span></div>
      <p>${lot.bidCount} ${t('bids', 'Gebote')} · ${countdown(lot.endsAt)}</p>`;
  }
  function lotCard(lot, primary) {
    const image = primary ? lot.items[0]?.image : lot.item.image;
    const participation = (data.mine || []).find(entry => entry.id === lot.id);
    const minimum = lot.currentBid === null ? lot.reserve : lot.currentBid + 1;
    const eligible = account && (account.progression?.level || 1) >= lot.requiredLevel
      && account.tokens + (participation?.leading ? lot.currentBid : 0) >= minimum;
    const mine = tab === 'mine';
    return `<article class="economy-lot"><div class="economy-lot-image">${image ? `<img src="${esc(image)}" alt="" loading="lazy">` : '<span aria-hidden="true">◇</span>'}
      <span class="economy-badge">${primary ? lot.kind === 'event' ? t('Limited event', 'Zeitlich begrenzt') : t('Mystery Palette', 'Mystery-Palette') : esc(categoryName(lot.item.marketCategory))}</span></div>
      <div class="economy-lot-body"><h2>${esc(primary ? name(lot) : lot.item.title)}</h2>
      ${primary ? `<p class="economy-story">${esc(story(lot).body)}</p><p>${esc((lot.allowedMarketCategories || []).map(categoryName).join(' · ') || categoryName(null))}</p>
        <p class="economy-level">${t('Required level', 'Benötigtes Level')} ${lot.requiredLevel} · ${account ? t('Your level', 'Dein Level') + ' ' + account.progression.level : t('Log in to bid', 'Zum Bieten anmelden')}</p>
        ${account && lot.status === 'active' ? `<p>${eligible ? t('Ready to bid', 'Bereit zum Bieten') : account.progression.level < lot.requiredLevel ? t('Earn more XP to unlock', 'Mit mehr XP freischalten') : t('Earn more tokens to bid', 'Mehr Tokens zum Bieten verdienen')}</p>` : ''}`
        : `<p>${t('Seller', 'Verkäufer')}: ${esc(lot.sellerUsername)}</p><p>${t('Estimated market value', 'Geschätzter Marktwert')}: ${tokens(lot.estimatedValueTokens)}</p>`}
      ${bidFacts(lot, primary)}
      ${mine ? `<p class="economy-outcome">${primary ? lot.status === 'active' ? lot.leading ? t('You lead', 'Du führst') : t('Outbid', 'Überboten') : lot.won ? t('Won!', 'Gewonnen!') : t('Lost', 'Verloren') : status(lot)}${primary ? ` · ${t('Your highest bid', 'Dein Höchstgebot')}: ${tokens(lot.highestBid)}` : lot.winnerId ? ` · ${t('Final sale', 'Verkaufspreis')}: ${tokens(lot.currentBid)}` : ''}</p>` : ''}
      <button class="${primary && lot.revealAvailable ? 'primary-button' : 'secondary-button'}" data-economy="${primary && lot.revealAvailable ? 'reveal' : primary ? 'primary' : 'resale'}" data-id="${esc(lot.id)}">${primary && lot.revealAvailable ? t('Reveal three finds', 'Drei Funde aufdecken') : primary && !eligible ? t('Explore palette', 'Palette ansehen') : t('View auction', 'Auktion ansehen')} →</button>
      ${!primary && mine && lot.status === 'active' && !lot.bidCount ? `<button class="text-button" data-economy="cancel" data-id="${esc(lot.id)}">${t('Cancel listing', 'Angebot stornieren')}</button>` : ''}</div></article>`;
  }
  function render() {
    const path = currentAccountPage;
    if (!economyFlags[routes[path]]) {
      accountContent.innerHTML = pageHeading(t('Coming later.', 'Kommt später.'), t('This part of the world is not open yet.', 'Dieser Teil der Spielwelt ist noch nicht geöffnet.')) + `<a href="/shop" data-page>${t('Visit the shop', 'Zum Shop')}</a>`;
      return;
    }
    if (path === '/market') { renderMarket(); return; }
    if (path === '/news') { renderNews(); return; }
    const primary = path === '/auctions';
    accountContent.innerHTML = pageHeading(primary ? t('A story. Three surprises.', 'Eine Geschichte. Drei Überraschungen.') : t('Every find finds a buyer.', 'Jeder Fund findet Käufer.'),
      primary ? t('Bid on a sealed Mystery Palette. Win it, then reveal three finds. Play Daily and sell items to unlock more.', 'Biete auf eine versiegelte Mystery-Palette. Gewinne und entdecke drei Funde. Spiele Daily und verkaufe Lose für höhere Level.')
        : t('Real finds, live bids. Sell one item at a time — up to 5 active listings.', 'Echte Funde, laufende Gebote. Verkaufe einzelne Lose — höchstens 5 aktive Angebote.'));
    accountContent.innerHTML += `<div class="economy-wallet">${account ? `${tokens(account.tokens)} · ${t('Level', 'Level')} ${account.progression.level}` : `<a href="/login" data-page>${t('Log in to join the bidding', 'Zum Mitbieten anmelden')}</a>`}
      ${primary ? `<a href="/" data-page>${t('Play Daily → earn tokens + 150 XP', 'Daily spielen → Tokens + 150 XP')}</a>` : `<a href="/inventory" data-page>${t('List an item from inventory', 'Los aus dem Inventar anbieten')} →</a>`}</div>${tabs(primary)}`;
    if (tab === 'mine' && !account) { accountContent.innerHTML += loginNotice('profile'); return; }
    const lots = data[tab === 'mine' ? 'mine' : 'lots'] || [];
    accountContent.innerHTML += lots.length ? `<div class="economy-grid">${lots.map(lot => lotCard(lot, primary)).join('')}</div>` : empty(tab === 'mine' ? t('Your auction history will appear here after your first bid or listing.', 'Nach deinem ersten Gebot oder Angebot erscheint hier dein Verlauf.') : t('No auctions right now. New lots appear as editions become available.', 'Aktuell keine Auktionen. Neue Lose erscheinen, sobald Ausgaben verfügbar sind.'));
    if (tab === 'mine') accountContent.innerHTML += `<p class="earning-detail">${t('Showing up to 100 recent auctions, with active auctions first.', 'Bis zu 100 aktuelle Auktionen, laufende Auktionen zuerst.')}</p>`;
  }
  function bidForm(lot, primary) {
    if (!account) return `<a href="/login" data-page>${t('Log in to bid', 'Zum Bieten anmelden')}</a>`;
    if (lot.status !== 'active' || lot.endsAt <= Date.now()) return `<p>${status(lot)}</p>`;
    if (!primary && lot.sellerId === account.id) return `<p>${t('This is your listing.', 'Dies ist dein Angebot.')}</p>`;
    if (primary && account.progression.level < lot.requiredLevel) return `<p>${accountError('level_required')}</p>`;
    const min = lot.currentBid === null ? primary ? lot.reserve : lot.startPrice : lot.currentBid + 1;
    return `<form data-economy-form="${primary ? 'primary' : 'resale'}" data-id="${esc(lot.id)}" class="economy-form"><label>${t('Your bid in tokens', 'Dein Gebot in Tokens')}
      <input name="amount" type="number" inputmode="numeric" min="${min}" step="1" value="${min}" required></label><p>${t('Your bid is held until you are outbid or the auction settles.', 'Dein Gebot wird bis zum Überbieten oder zur Abrechnung hinterlegt.')}</p>
      <p class="account-error" role="alert"></p><button class="primary-button" type="submit">${t('Place bid', 'Gebot abgeben')}</button></form>`;
  }
  async function showLot(id, primary) {
    const request = ++dialogSequence, visit = accountVisit;
    const result = primary ? await api.paletteAuction(id) : await api.resale(id);
    if (request !== dialogSequence || visit !== accountVisit) return;
    const lot = primary ? result?.auction : result?.listing;
    if (!lot) throw new Error(accountError('auction_not_found'));
    detailId = id;
    openDialog(`<p class="eyebrow">${primary ? t('SEALED · THREE FINDS', 'VERSIEGELT · DREI FUNDE') : t('PLAYER MARKETPLACE', 'SPIELERMARKTPLATZ')}</p><h2 id="economy-dialog-title" tabindex="-1">${esc(primary ? name(lot) : lot.item.title)}</h2>
      ${primary ? `<h3>${esc(story(lot).title)}</h3><p>${esc(story(lot).body)}</p><p>${t('Fictional JUSTIZGUESSR story', 'Fiktive JUSTIZGUESSR-Geschichte')} · ${t('Required level', 'Benötigtes Level')} ${lot.requiredLevel}</p>` : `<img class="auction-detail-cover" src="${esc(lot.item.image || '')}" alt=""><p>${t('Seller', 'Verkäufer')}: ${esc(lot.sellerUsername)}</p><p>${t('Auction value', 'Auktionswert')}: ${euro(lot.item.price)} · ${t('Estimated market value', 'Geschätzter Marktwert')}: ${tokens(lot.estimatedValueTokens)}</p>`}
      <div data-live-facts>${bidFacts(lot, primary)}</div>${bidForm(lot, primary)}
      ${primary ? `<details><summary>${t('Possible contents · rarities from common to legendary', 'Mögliche Inhalte · gewöhnlich bis legendär')}</summary><p>${t('Three items are already sealed inside. Duplicates are possible. The pool below is not your result.', 'Drei Gegenstände sind bereits versiegelt. Doppelte Funde sind möglich. Dieser Pool zeigt nicht deinen Gewinn.')}</p><div class="inventory-grid">${lot.items.map(item => itemCard({ ...item, sellValue: Math.max(1, Math.round(item.price)) }, false)).join('')}</div></details>`
      : `<h3>${t('Bid history', 'Gebotsverlauf')}</h3><ol class="economy-history" data-live-history>${bidHistory(lot.bids)}</ol>`}`);
  }
  function listingDialog(id) {
    const item = accountItems.find(entry => entry.id === id);
    if (!item || !economyFlags.resales) return;
    openDialog(`<h2 id="economy-dialog-title" tabindex="-1">${t('List for auction', 'Zur Auktion anbieten')}</h2><p>${esc(item.title)}</p><p>${t('Estimated market value', 'Geschätzter Marktwert')}: ${tokens(item.estimatedValueTokens)}</p>
      <form data-economy-form="list" data-id="${esc(id)}" class="economy-form"><label>${t('Starting price in tokens', 'Startpreis in Tokens')}<input name="amount" type="number" inputmode="numeric" min="1" step="1" value="${Math.max(1, Math.round(item.estimatedValueTokens * .7))}" required></label>
      <label>${t('Duration', 'Dauer')}<select name="duration"><option value="300000">${t('5 minutes', '5 Minuten')}</option><option value="900000" selected>${t('15 minutes', '15 Minuten')}</option><option value="3600000">${t('1 hour', '1 Stunde')}</option></select></label>
      <p>${t('Maximum 5 active listings. A listing with bids cannot be cancelled.', 'Höchstens 5 aktive Angebote. Angebote mit Geboten können nicht storniert werden.')}</p><p class="account-error" role="alert"></p><button class="primary-button" type="submit">${t('Start auction', 'Auktion starten')}</button></form>`);
  }
  async function startReveal(id) {
    const visit = accountVisit, owner = account?.id, request = ++dialogSequence;
    const [result, lot] = await Promise.all([api.paletteAuctionRewards(id), api.paletteAuction(id)]);
    if (visit !== accountVisit || owner !== account?.id || request !== dialogSequence) return;
    reveal = { ...result.reveal, pool: lot?.auction?.items || result.reveal.rewards.map(r => r.item) }; revealPosition = 0;
    await revealNext();
  }
  async function revealNext() {
    if (!reveal) return;
    const fixed = reveal, request = ++dialogSequence, visit = accountVisit;
    if (revealPosition >= fixed.rewards.length) { revealSummary(fixed); return; }
    const reward = fixed.rewards[revealPosition].item;
    openDialog(`<p class="eyebrow">${t('YOUR SEALED PALETTE', 'DEINE VERSIEGELTE PALETTE')}</p><h2 id="economy-dialog-title" tabindex="-1">${t('Find', 'Fund')} ${revealPosition + 1} / 3</h2><div class="case-window" aria-hidden="true"><div class="case-marker"></div><div class="case-reel"></div></div><div class="palette-result" role="status">${t('The hammer is spinning…', 'Der Hammer kreist …')}</div>`);
    const valid = () => request === dialogSequence && visit === accountVisit && dialog.open && reveal === fixed;
    await spinCaseReel(dialog.querySelector('.case-reel'), dialog.querySelector('.case-window'), reward, fixed.pool, valid);
    if (!valid()) return;
    revealPosition++;
    dialog.querySelector('.palette-result').innerHTML = `<div class="palette-find rarity-${esc(reward.rarity)}"><img src="${esc(reward.image || '')}" alt=""><p class="rarity-label">${rarityLabel(reward.rarity)}</p><h3>${esc(reward.title)}</h3><p>${t('Auction value', 'Auktionswert')}: ${euro(reward.price)}</p></div><button class="primary-button" data-economy="next-reward">${revealPosition === 3 ? t('View summary', 'Zusammenfassung') : t('Reveal next find', 'Nächsten Fund aufdecken')} →</button>`;
    dialog.querySelector('[data-economy="next-reward"]').focus({ preventScroll: true });
  }
  function revealSummary(fixed) {
    const value = fixed.rewards.reduce((sum, r) => sum + r.item.price, 0);
    const staticTokens = fixed.rewards.reduce((sum, r) => sum + Math.max(1, Math.round(r.item.price)), 0);
    const difference = staticTokens - fixed.bundleCostTokens;
    openDialog(`<h2 id="economy-dialog-title" tabindex="-1">${t('Three finds. Yours.', 'Drei Funde. Deine.')}</h2><div class="inventory-grid">${fixed.rewards.map(r => itemCard({ ...r.item, sellValue: Math.max(1, Math.round(r.item.price)) }, false)).join('')}</div>
      <dl class="auction-facts"><div><dt>${t('Total auction value', 'Gesamter Auktionswert')}</dt><dd>${euro(value)}</dd></div><div><dt>${t('Winning bid', 'Gewinngebot')}</dt><dd>${tokens(fixed.bundleCostTokens)}</dd></div><div><dt>${t('Rough difference vs. frozen values', 'Grobe Differenz zu eingefrorenen Werten')}</dt><dd>${difference >= 0 ? '+' : ''}${tokens(difference)}</dd></div></dl><p>${t('Historical values are not guaranteed sale prices. Your finds are already in your inventory.', 'Historische Werte sind keine garantierten Verkaufspreise. Deine Funde liegen bereits im Inventar.')}</p><a class="primary-button" href="/inventory" data-page>${t('Go to inventory', 'Zum Inventar')} →</a>`);
  }
  async function loadHistory(id, visit = accountVisit, repaint = true) {
    if (!id) return;
    const request = ++historySequence;
    const result = await api.marketHistory(id);
    if (request !== historySequence || visit !== accountVisit || category !== id) return;
    history = result?.history || [];
    if (repaint) renderMarket();
  }
  function renderMarket() {
    const categories = data.categories || [], selected = categories.find(c => c.category === category);
    accountContent.innerHTML = pageHeading(t('Read the market.', 'Lies den Markt.'), t('100 is neutral. Above 100 means stronger demand; below 100 means weaker demand. News moves the market and buyer valuations.', '100 ist neutral. Darüber ist die Nachfrage stärker, darunter schwächer. Nachrichten beeinflussen Markt und Käuferbewertungen.')) +
      `<div class="market-categories">${categories.map(c => `<button data-economy="category" data-id="${c.category}" aria-pressed="${category === c.category}"><span>${esc(t(c.name, c.nameDe))}</span><strong>${number(c.currentIndex, 2)} ${c.currentIndex > 100 ? '↑' : c.currentIndex < 100 ? '↓' : '→'}</strong><small>${c.currentIndex >= 100 ? '+' : ''}${number(c.currentIndex - 100, 2)}% ${t('from neutral', 'zum Neutralwert')}</small><time>${date(c.updatedAt)}</time></button>`).join('')}</div>
      <section class="market-chart"><h2>${esc(selected ? t(selected.name, selected.nameDe) : '')}</h2>${chart(history)}<p>${t('Hourly history · index points (70–130) · dashed line = neutral 100', 'Stündlicher Verlauf · Indexpunkte (70–130) · gestrichelte Linie = neutral 100')}</p></section>`;
  }
  function chart(points) {
    if (!points.length) return empty(t('History will appear as the simulated economy starts.', 'Der Verlauf erscheint mit dem Start der simulierten Wirtschaft.'));
    const sorted = [...points].reverse(), start = Date.parse(sorted[0].capturedAt), end = Date.parse(sorted.at(-1).capturedAt);
    const line = sorted.map(p => `${35 + 630 * (Date.parse(p.capturedAt) - start) / Math.max(1, end - start)},${220 - (p.indexValue - 70) / 60 * 200}`).join(' ');
    return `<svg viewBox="0 0 700 260" role="img" aria-label="${t('Market index over time', 'Marktindex im Zeitverlauf')}"><text x="0" y="24">130</text><text x="0" y="124">100</text><text x="8" y="224">70</text><path d="M35 120H670" stroke="currentColor" stroke-dasharray="5 5" opacity=".35"/><polyline points="${line}" fill="none" stroke="currentColor" stroke-width="3"/><text x="35" y="250">${esc(new Date(start).toLocaleDateString(uiLocale()))}</text><text x="665" y="250" text-anchor="end">${esc(new Date(end).toLocaleDateString(uiLocale()))}</text></svg>`;
  }
  function renderNews() {
    accountContent.innerHTML = pageHeading(t('Dispatches from our world.', 'Nachrichten aus unserer Welt.'), t('Fictional stories from the JUSTIZGUESSR simulated economy. These are not real current events.', 'Fiktive Geschichten aus der simulierten JUSTIZGUESSR-Wirtschaft. Dies sind keine realen aktuellen Nachrichten.')) +
      `<div class="economy-news">${(data.news || []).map(n => `<article><time>${date(n.publishedAt)}</time><h2>${esc(t(n.title, n.metadata?.titleDe || n.title))}</h2><p>${esc(t(n.body, n.metadata?.bodyDe || n.body))}</p><div class="economy-effects">${n.marketEffects.map(e => `<span>${categoryName(e.category)} ${e.direction === 'up' ? '↑ +' : '↓ −'}${number(e.magnitude)} ${t('points', 'Punkte')}</span>`).join('')}</div>
      ${n.paletteIds.length && economyFlags.paletteAuctions ? `<p>${t('Associated palettes', 'Zugehörige Paletten')}: ${n.paletteIds.map(id => esc(paletteName(id))).join(', ')}</p><a href="/auctions" data-page>${t('Explore palette auctions', 'Palettenauktionen ansehen')} →</a>` : ''}</article>`).join('') || empty(t('The next world story is on its way.', 'Die nächste Geschichte aus der Spielwelt ist unterwegs.'))}</div>`;
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-economy]');
    if (!button) return;
    const action = button.dataset.economy, id = button.dataset.id;
    if (action === 'close') { dialog.close(); return; }
    if (busy) return;
    const visit = accountVisit;
    try {
      if (action === 'tab') { tab = id; render(); accountContent.querySelector(`[data-id="${id}"]`)?.focus(); }
      if (action === 'category') { category = id; await loadHistory(id); accountContent.querySelector(`[data-id="${id}"]`)?.focus(); }
      if (action === 'list') listingDialog(id);
      if (action === 'primary' || action === 'resale') await showLot(id, action === 'primary');
      if (action === 'reveal') { busy = true; await startReveal(id); }
      if (action === 'next-reward') { busy = true; await revealNext(); }
      if (action === 'cancel') {
        busy = true; button.disabled = true;
        const result = await api.cancelListing(id);
        if (visit !== accountVisit) return;
        updateAccount(result.user); busy = false; await refresh(currentAccountPage, visit, true);
      }
    } catch (error) { if (visit === accountVisit) showToast(error.message); }
    finally { if (visit === accountVisit) busy = false; if (button.isConnected) button.disabled = false; }
  });
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.matches('[data-economy-form]')) return;
    event.preventDefault(); if (busy) return;
    busy = true;
    const visit = accountVisit, owner = account?.id, request = dialogSequence;
    const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      const fields = new FormData(form), amount = Number(fields.get('amount')), id = form.dataset.id, type = form.dataset.economyForm;
      const result = type === 'list' ? await api.listItem({ inventoryId: id, startPrice: amount, endsAt: new Date(Date.now() + Number(fields.get('duration'))).toISOString() })
        : type === 'primary' ? await api.paletteAuctionBid(id, amount) : await api.resaleBid(id, amount);
      if (visit !== accountVisit || account?.id !== owner) return;
      updateAccount(result.user); busy = false;
      if (type === 'list') { dialog.close(); await navigateAccountPage('/marketplace'); }
      else {
        await refresh(currentAccountPage, visit, true);
        if (visit !== accountVisit || owner !== account?.id) return;
        if (request === dialogSequence && dialog.open) await showLot(id, type === 'primary');
        showToast(t('Bid placed. Your tokens are held in escrow.', 'Gebot abgegeben. Deine Tokens sind hinterlegt.'));
      }
    } catch (error) { if (visit === accountVisit) form.querySelector('.account-error').textContent = error.message; }
    finally { if (visit === accountVisit) busy = false; if (button.isConnected) button.disabled = false; }
  });
  return { isRoute: path => Boolean(routes[path]), load, render, stop };
})();
