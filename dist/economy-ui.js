// Player-facing views share account routing, translation, cards and the case reel.
function progressionMarkup(p) {
  if (!p) return '';
  return `<section class="progression"><div><div class="section-title-row"><h2>${t('Level', 'Level')} ${p.level}</h2>${infoTip(t('Daily awards 150 XP. Successful marketplace sales award 10–200 XP.', 'Daily bringt 150 XP. Erfolgreiche Marktplatzverkäufe bringen 10–200 XP.'), t('How to earn XP', 'So verdienst du XP'))}</div><span>${number(p.xp)} XP</span></div>
    <progress max="1" value="${p.progress}" aria-label="${t('Level progress', 'Levelfortschritt')}"></progress>
    <p>${p.nextLevelXp === null ? t('Level 20 reached', 'Level 20 erreicht') : t(`${number(p.nextLevelXp - p.xp)} XP to next level`, `${number(p.nextLevelXp - p.xp)} XP bis zum nächsten Level`)}</p></section>`;
}

window.economyUi = (() => {
  const api = window.justizEconomy, esc = accountEscape;
  const routes = { '/auction-house': 'house', '/auctions': 'paletteAuctions', '/marketplace': 'resales', '/market': 'market' };
  const dialog = document.createElement('dialog');
  dialog.className = 'economy-dialog'; dialog.setAttribute('aria-labelledby', 'economy-dialog-title');
  document.body.append(dialog);
  let data = {}, tab = 'public', timer, clockTimer, sequence = 0, dialogSequence = 0, busy = false, archiveOpen = false;
  let detailPrimary = false;
  let category = null, history = [], historySequence = 0, reveal = null, revealPosition = 0, detailId = null, returnFocus;
  let chartSelectionTime = null, chartPointer = null, marketRange = '1d', historyLoading = false;
  const marketRanges = [['1h', '1h', '1h'], ['1d', '1d', '1T'], ['1w', '1 week', '1 Woche'], ['1m', '1 month', '1 Monat']];
  const name = lot => t(lot.name, lot.nameDe || lot.name);
  const date = value => new Date(value).toLocaleString(uiLocale());
  // Kept in sync with the market category names the server exposes.
  const categoryNames = {
    electronics: ['Electronics', 'Elektronik'], vehicles: ['Vehicles', 'Fahrzeuge'], wine: ['Wine & drinks', 'Wein & Getränke'],
    watches_jewelry: ['Watches & jewelry', 'Schmuck & Uhren'], tools: ['Tools', 'Werkzeuge'],
    collectibles: ['Collectibles', 'Sammlerstücke'], household: ['Household & home', 'Haushalt & Wohnen'],
    luxury_goods: ['Luxury goods', 'Luxusgüter'], bicycles: ['Bicycles', 'Fahrräder'], books_media: ['Books & media', 'Bücher & Medien'],
    fashion: ['Fashion', 'Mode'], cosmetics: ['Cosmetics', 'Kosmetik'], sport_leisure: ['Sport & leisure', 'Sport & Freizeit'],
    other: ['Other', 'Sonstiges']
  };
  const categoryName = id => categoryNames[id] ? t(...categoryNames[id]) : t('Mixed finds', 'Gemischte Fundstücke');
  const npcDemandLabel = level => ({ steady:t('Steady','Normal'), limited:t('Limited','Begrenzt'), low:t('Low','Gering') })[level] || '';
  const stockSymbols = {
    wine: '<path d="M31 9h18v13l5 9v36a7 7 0 0 1-7 7H33a7 7 0 0 1-7-7V31l5-9V9Zm-5 31h28M35 9v13h10V9M64 34h18v10c0 8-4 12-9 12s-9-4-9-12V34Zm9 22v15m-8 3h16"/>',
    toys: '<rect x="14" y="43" width="28" height="28" rx="3"/><rect x="44" y="43" width="28" height="28" rx="3"/><rect x="29" y="13" width="28" height="28" rx="3"/><path d="M20 43v-7h7v7m9 0v-7h7m7 7v-7h7v7m9 0v-7h7v7M14 58h28m2 0h28M29 27h28"/>',
    electronics: '<path d="M17 50V39a31 31 0 0 1 62 0v11M17 48h10a5 5 0 0 1 5 5v17a5 5 0 0 1-5 5H22a8 8 0 0 1-8-8V56a8 8 0 0 1 8-8Zm62 0H69a5 5 0 0 0-5 5v17a5 5 0 0 0 5 5h5a8 8 0 0 0 8-8V56a8 8 0 0 0-8-8ZM18 39a31 31 0 0 1 62 0"/>',
    jeweler:'<path d="m10 30 16-20h44l16 20-38 53-38-53Zm0 0h76M26 10l22 73 22-73M32 30l16-20 16 20"/>',
    hardware:'<path d="m18 82 37-37a23 23 0 0 0 29-29L70 30 57 17 71 3a23 23 0 0 0-29 29L5 69l13 13Z"/><circle cx="18" cy="69" r="4"/>',
    cars: '<path d="m14 53 8-23a8 8 0 0 1 7-5h39a8 8 0 0 1 7 5l8 23M13 53h70a6 6 0 0 1 6 6v15H7V59a6 6 0 0 1 6-6Zm8 21v7h12v-7m30 0v7h12v-7M21 61h13m28 0h13M26 36h44"/>'
  };
  function stockLotArtwork(lot) {
    if (lot.item?.kind === 'case') {
      return `<div class="sealed-case-art" aria-hidden="true">${caseArtwork(lot.item)}</div>`;
    }
    const type = lot.item?.businessCategory, symbol = stockSymbols[type];
    return symbol ? `<div class="stock-lot-art stock-lot-art-${type}" aria-hidden="true"><svg viewBox="0 0 96 96" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${symbol}</svg></div>` : null;
  }
  const remaining = end => {
    const seconds = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    if (!seconds) return t('Ended', 'Beendet');
    // Multi-day lot auctions read better as "2d 14h" than a 60-hour clock.
    if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)}d ${Math.floor(seconds % 86_400 / 3_600)}h`;
    return `${Math.floor(seconds / 3_600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const countdown = end => `<time class="economy-countdown" data-economy-end="${end}" datetime="${new Date(end).toISOString()}" aria-live="off">${remaining(end)}</time>`;
  const bidMinimum = (lot, primary) => {
    if (lot.bidding) return lot.bidding.minimumBid;
    const increment = lot.bidIncrement ?? 1;
    return lot.currentBid === null ? primary ? lot.reserve : lot.startPrice
      : lot.leading && Number.isSafeInteger(lot.highestBid) ? lot.highestBid + increment : lot.currentBid + increment;
  };
  const bidReserved = lot => lot.bidding?.reservedMaximum
    ?? (lot.leading && Number.isSafeInteger(lot.highestBid) ? lot.highestBid : 0);
  const bidMaximum = lot => lot.bidding?.maximumBid
    ?? Math.min(Number.MAX_SAFE_INTEGER, account.tokens + bidReserved(lot));
  const empty = text => `<p class="collection-empty">${text}</p>`;
  const status = lot => lot.status === 'cancelled' ? t('Cancelled', 'Storniert') : lot.status === 'active' ? t('Active', 'Aktiv') : lot.winnerId ? t('Sold', 'Verkauft') : t('Unsold', 'Nicht verkauft');
  const bidHistory = bids => [...(bids || [])].sort((a, b) => a.createdAt - b.createdAt || String(a.id).localeCompare(String(b.id)))
    .map(bid => {
      const mine = account?.id === bid.bidderId;
      return `<li class="auction-chat-message${mine ? ' is-mine' : ''}"><div class="auction-chat-bubble"><span>${mine ? t('You', 'Du') : esc(bid.bidderUsername)}</span><strong>${justizEuro(bid.amount)}</strong><time>${date(bid.createdAt)}</time></div></li>`;
    }).join('') || `<li class="auction-chat-empty">${t('No bids yet.', 'Noch keine Gebote.')}</li>`;
  function stop() {
    clearInterval(timer); clearInterval(clockTimer); sequence++; historySequence++; dialogSequence++;
    chartSelectionTime = null; chartPointer = null;
    detailId = null; reveal = null; dialog.close(); busy = false; archiveOpen = false;
  }
  function openDialog(markup) {
    if (!dialog.open) returnFocus = document.activeElement;
    dialog.classList.toggle('economy-dialog--auction', markup.includes('class="auction-room"'));
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
    const query = new URLSearchParams(location.search);
    tab = ({ mine: 'mine', bids: 'bids' })[query.get('view')] || 'browse';
    data = {}; history = []; category = query.get('category'); archiveOpen = false;
    marketRange = marketRanges.some(([id]) => id === query.get('range')) ? query.get('range') : '1d';
    chartSelectionTime = null; chartPointer = null;
    if (path !== '/auction-house' && !economyFlags[routes[path]]) return;
    await refresh(path, visit, false);
    if (visit !== accountVisit) return;
    let lastRefresh = Date.now(), polling = false;
    timer = setInterval(() => {
      if (document.hidden || busy || polling) return;
      const lots = [...(data.lots || []), ...(data.mine || []), ...(data.bids || []), ...(data.palettes || []), ...(data.paletteMine || [])];
      const detailEnd = dialog.querySelector('[data-economy-end]')?.dataset.economyEnd;
      if (detailEnd) lots.push({ status: 'active', endsAt: Number(detailEnd) });
      if (Date.now() - lastRefresh < (path === '/market' ? 15_000 : auctionPollInterval(lots, Date.now()))) return;
      lastRefresh = Date.now(); polling = true;
      refresh(path, visit, true).catch(() => showToast(path === '/market' ? t('Could not refresh the market. Try again.', 'Der Markt konnte nicht aktualisiert werden. Versuche es erneut.') : t('Could not refresh auctions. Try again.', 'Auktionen konnten nicht aktualisiert werden. Versuche es erneut.')))
        .finally(() => { polling = false; });
    }, 1000);
    clockTimer = setInterval(() => {
      if (document.hidden) return;
      document.querySelectorAll('[data-economy-end]').forEach(node => { node.textContent = remaining(Number(node.dataset.economyEnd)); });
    }, 1000);
  }
  async function refresh(path, visit, repaint) {
    const request = ++sequence, owner = account?.id;
    let next;
    if (path === '/auction-house') {
      const [lots, mine, bids, archived, palettes, paletteMine, unopened] = await Promise.all([
        economyFlags.resales ? api.resales(200) : null,
        owner && economyFlags.resales ? api.myListings() : null,
        owner && economyFlags.resales ? api.myResaleBids() : null,
        owner && economyFlags.resales ? api.myArchivedResaleBids() : null,
        economyFlags.paletteAuctions ? api.paletteAuctions(100) : null,
        owner && economyFlags.paletteAuctions ? api.myPaletteAuctions(100) : null,
        owner ? accountApi('auction-winnings') : null,
        window.marketTrendUi?.load(visit)
      ]);
      if ((economyFlags.resales && !lots) || (economyFlags.paletteAuctions && !palettes)) throw new Error(t('Auctions could not be loaded. Please retry.', 'Auktionen konnten nicht geladen werden. Bitte erneut versuchen.'));
      next = { lots: lots?.listings || [], mine: mine?.listings || [], bids: bids?.listings || [],
        archivedBids: archived?.listings || [], palettes: palettes?.auctions || [], paletteMine: paletteMine?.auctions || [], unopenedOwner:owner, unopened:unopened?.rewards||[] };
    } else if (path === '/auctions') {
      const [lots, mine] = await Promise.all([api.paletteAuctions(), owner ? api.myPaletteAuctions(100) : null]);
      if (!lots) throw new Error(t('Auctions are unavailable. Please retry.', 'Auktionen sind nicht verfügbar. Bitte erneut versuchen.'));
      next = { lots: lots.auctions, mine: mine?.auctions || [] };
    } else if (path === '/marketplace') {
      const [lots, mine, bids, archived] = await Promise.all([api.resales(200), owner ? api.myListings() : null,
        owner ? api.myResaleBids() : null, owner ? api.myArchivedResaleBids() : null]);
      if (!lots) throw new Error(t('Marketplace is unavailable. Please retry.', 'Marktplatz ist nicht verfügbar. Bitte erneut versuchen.'));
      next = { lots: lots.listings, mine: mine?.listings || [], bids: bids?.listings || [],
        archivedBids: archived?.listings || [] };
    } else if (path === '/market') {
      next = await api.market();
      if (!next) throw new Error(t('Market is unavailable.', 'Markt ist nicht verfügbar.'));
    } else return;
    const detailRequest = dialogSequence, currentDetail = detailId;
    const detail = currentDetail && dialog.open
      ? detailPrimary ? (await api.paletteAuction(currentDetail))?.auction : (await api.resale(currentDetail))?.listing : null;
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
      if (!data.categories.some(c => c.category === category)) category = data.categories[0]?.category;
      await loadHistory(category, visit, false);
      if (request !== sequence || visit !== accountVisit) return;
    }
    if (repaint && !busy) {
      const focus = document.activeElement;
      const focusKey = focus?.dataset?.id, focusAction = focus?.dataset?.economy;
      const houseFilter = focus?.dataset?.houseFilter, caret = houseFilter === 'search' ? focus.selectionStart : null;
      render();
      if (!dialog.open && houseFilter) {
        const control = accountContent.querySelector(`[data-house-filter="${houseFilter}"]`);
        control?.focus({ preventScroll: true });
        if (caret !== null) control?.setSelectionRange(caret, caret);
      }
      if (!dialog.open && focusAction) [...accountContent.querySelectorAll('[data-economy]')]
        .find(el => el.dataset.economy === focusAction && el.dataset.id === focusKey)?.focus({ preventScroll: true });
      // Refresh visible bid facts without destroying an in-progress bid input.
      const lot = detailRequest === dialogSequence && detailId === currentDetail ? detail : null;
      const participation = lot && (detailPrimary ? next.paletteMine || next.mine : next.bids)?.find(entry => entry.id === lot.id);
      if (lot && participation) Object.assign(lot, { leading: participation.leading, highestBid: participation.highestBid });
      const facts = dialog.querySelector('[data-live-facts]');
      if (lot && facts) facts.innerHTML = bidFacts(lot, detailPrimary);
      const historyNode = dialog.querySelector('[data-live-history]');
      if (lot?.bids && historyNode) {
        const followLatest = historyNode.scrollHeight - historyNode.scrollTop - historyNode.clientHeight < 40;
        historyNode.innerHTML = bidHistory(lot.bids);
        if (followLatest) historyNode.scrollTop = historyNode.scrollHeight;
      }
      const bidInput = dialog.querySelector('input[name="amount"]');
      if (lot && bidInput) {
        updateBidForm(lot, detailPrimary, bidInput.closest('form'));
      }
    }
  }
  function auctionPollInterval(lots, now) {
    return lots.some(lot => lot.status === 'active' && lot.endsAt <= now + 15_000 && lot.endsAt >= now - 12_000) ? 1000 : 12_000;
  }
  function bidFacts(lot, primary) {
    return `<div class="economy-bid"><strong>${justizEuro(lot.currentBid ?? (primary ? lot.reserve : lot.startPrice))}</strong><span>${lot.currentBid === null ? t('Starting bid', 'Startgebot') : lot.status === 'active' ? t('Current bid', 'Aktuelles Gebot') : t('Final bid', 'Letztes Gebot')}</span></div>
      <p>${lot.bidCount} ${lot.bidCount === 1 ? t('bid', 'Gebot') : t('bids', 'Gebote')} · ${countdown(lot.endsAt)}</p>`;
  }
  function lotMarketCategory(lot,primary) {
    if(!primary)return ['case','review-pack'].includes(lot.item.kind)?null:lot.item.marketCategory;
    const categories=lot.allowedMarketCategories||[];
    return categories.length===1?categories[0]:null;
  }
  function lotCard(lot, primary, view = '') {
    const image = primary ? null : lot.item.image;
    const participation = primary ? (data.paletteMine || data.mine || []).find(entry => entry.id === lot.id)
      : view === 'bid' ? lot : null;
    // Both auction types expose their domain-owned minimum raise.
    const minimum = bidMinimum(participation ? { ...lot, ...participation } : lot, primary);
    const eligible = account && (account.progression?.level || 1) >= lot.requiredLevel
      && account.tokens + (participation?.leading ? participation.highestBid : 0) >= minimum;
    const ownListing = view === 'mine-live' || view === 'mine-done';
    // Green border while the player leads (or has won), red while overbid.
    const borderState = primary && participation
      ? participation.leading || (participation.won && lot.status !== 'active') ? ' is-leading'
        : lot.status === 'active' ? ' is-outbid' : ''
      : !primary && view === 'bid' ? lot.leading ? ' is-leading' : ' is-outbid'
        : !primary && view === 'bid-done' ? lot.status === 'cancelled' ? ' is-ended' : lot.won ? ' is-leading' : ' is-outbid'
          : !primary && view === 'mine-live' ? ' is-owned' : !primary && view === 'mine-done' ? ' is-ended' : '';
    const resaleState = !primary ? view === 'mine-live' ? t('LIVE', 'LIVE')
      : view === 'bid' ? lot.leading ? t('LEADING', 'DU FÜHRST') : t('OUTBID', 'ÜBERBOTEN')
        : view === 'bid-done' ? lot.status === 'cancelled' ? t('CANCELLED', 'STORNIERT')
          : lot.won ? t('WON', 'GEWONNEN') : t('LOST', 'VERLOREN')
        : view === 'mine-done' ? lot.status === 'cancelled' ? t('CANCELLED', 'STORNIERT')
          : lot.winnerId ? t('SOLD', 'VERKAUFT') : t('UNSOLD', 'NICHT VERKAUFT')
          : t('LIVE', 'LIVE') : '';
    const displayTitle = primary ? name(lot) : `${lot.quantity > 1 ? `${lot.quantity}× ` : ''}${t(lot.item.title, lot.item.titleDe || lot.item.title)}`;
    // The card itself is the button: one label describes the whole action.
    const cardAction = primary && lot.revealAvailable ? t('View winning palette', 'Gewonnene Palette ansehen') : primary && !eligible ? t('View palette', 'Palette ansehen') : t('View auction', 'Auktion ansehen');
    const outcome = primary && participation
      ? `${lot.status === 'active' ? lot.leading ? t('You lead', 'Du führst') : t('Outbid', 'Überboten')
        : lot.won ? t('Won!', 'Gewonnen!') : t('Lost', 'Verloren')} · ${t('Your highest bid', 'Dein Höchstgebot')}: ${justizEuro(lot.highestBid)}`
      : view === 'bid' || view === 'bid-done'
        ? `${view === 'bid' ? lot.leading ? t('You lead', 'Du führst') : t('You were outbid', 'Du wurdest überboten')
          : lot.status === 'cancelled' ? t('Cancelled', 'Storniert') : lot.won ? t('You won', 'Du hast gewonnen') : t('You lost', 'Du hast verloren')}
          · ${t('Your bid', 'Dein Gebot')}: ${justizEuro(lot.highestBid)}${view === 'bid-done' && lot.winnerId ? ` · ${t('Final sale', 'Verkaufspreis')}: ${justizEuro(lot.currentBid)}` : ''}`
        : view === 'mine-done' && lot.winnerId ? `${t('Final sale', 'Verkaufspreis')}: ${justizEuro(lot.currentBid)}` : '';
    // A listing with bids cannot be cancelled; the rule lives in the backend.
    const cancellable = view === 'mine-live' && lot.status === 'active' && !lot.bidCount;
    return `<article class="economy-lot${borderState}" data-economy="${primary ? 'primary' : 'resale'}" data-id="${esc(lot.id)}" role="button" tabindex="0" aria-label="${esc(`${cardAction}: ${displayTitle}`)}"><div class="economy-lot-image">${primary ? paletteArtwork(lot) : lot.item.kind === 'review-pack' ? window.storeReputationUi.packArt(lot.item) : image ? `<img src="${esc(image)}" alt="" loading="lazy">` : stockLotArtwork(lot) || '<span aria-hidden="true">◇</span>'}
      ${primary ? '' : `<span class="economy-badge">${lot.item.kind === 'review-pack' ? t('Review packs','Bewertungspakete') : lot.item.kind === 'case' ? t('Sealed case', 'Versiegelte Kiste') : esc(categoryName(lot.item.marketCategory))}</span><span class="auction-state-badge">${resaleState}</span>`}</div>
      <div class="economy-lot-body"><h2>${esc(displayTitle)}</h2>${window.marketTrendUi?.markup(lotMarketCategory(lot,primary))||''}
      ${primary ? `<div class="palette-seal" aria-hidden="true"><span>01 ◇</span><span>02 ◇</span><span>03 ◇</span></div>`
        : `${ownListing ? '' : `<p>${t('Seller', 'Verkäufer')}: ${esc(lot.sellerUsername)}</p>`}<p>${t('Market estimate', 'Marktschätzung')}: ${justizEuro(lot.estimatedValueTokens)}</p>`}
      ${!primary && lot.item.kind === 'review-pack' ? `<p>${t('Choose 1–5 stars for your store or another player’s store when redeeming.','Beim Einlösen 1–5 Sterne für deinen Laden oder den eines anderen Spielers wählen.')}</p>` : ''}
      ${bidFacts(lot, primary)}
      ${!primary && lot.npcDemand ? `<p class="npc-demand">${t('NPC demand','NPC-Nachfrage')}: ${npcDemandLabel(lot.npcDemand)}</p>` : ''}
      ${outcome ? `<p class="economy-outcome">${outcome}</p>` : ''}
      ${primary ? '' : `<div class="economy-lot-foot"><span class="economy-lot-action" aria-hidden="true">${t('View auction', 'Auktion ansehen')} →</span>${cancellable ? `<button class="text-button" type="button" data-economy="cancel" data-id="${esc(lot.id)}">${t('Cancel listing', 'Angebot stornieren')}</button>` : ''}</div>`}</div></article>`;
  }
  // Disclosure for the palette auction page: finished lots (lost, expired,
  // already revealed) leave the live board and stay reachable here.
  const archiveToggle = count => `<button class="text-button archive-toggle" type="button" data-economy="archive" aria-expanded="${archiveOpen}">${archiveOpen ? t('Hide archived auctions', 'Archivierte Auktionen ausblenden') : t('Archived auctions', 'Archivierte Auktionen')} (${count})</button>`;
  function houseType(lot, primary) {
    return primary ? lot.stockOffer ? 'stock' : 'mystery'
      : lot.item?.kind === 'review-pack' ? 'reviews' : lot.item?.kind === 'case' ? 'cases'
        : lot.quantity > 1 ? 'stock' : 'items';
  }
  function houseTypeLabel(type) {
    return ({ items: t('Items', 'Artikel'), stock: t('Stock bundles', 'Warenpakete'),
      mystery: t('Mystery palettes', 'Mystery-Paletten'), cases: t('Sealed cases', 'Versiegelte Kisten'),
      reviews: t('Review packs', 'Bewertungspakete') })[type] || type;
  }
  function housePrice({ lot, primary }) {
    return lot.currentBid ?? (primary ? lot.reserve : lot.startPrice) ?? 0;
  }
  function individualMarketValue(lot, primary = false) {
    if (primary || lot.quantity !== 1 || ['case', 'review-pack'].includes(lot.item?.kind)
      || !Number.isFinite(lot.estimatedValueTokens) || lot.estimatedValueTokens <= 0) return '';
    const value = lot.estimatedValueTokens, price = housePrice({ lot, primary: false });
    const percent = Math.round((value - price) / value * 1000) / 10;
    const unlocked = (account?.skills?.ranks?.['market-intelligence'] || 0) >= 1;
    return `<div class="listing-market-value"><span>${t('Market value', 'Marktwert')}: <strong>${justizEuro(value)}</strong></span>${unlocked
      ? `<span class="listing-market-comparison ${percent > 0 ? 'is-below' : percent < 0 ? 'is-above' : 'is-equal'}">${percent === 0 ? t('At market value', 'Zum Marktwert') : `${number(Math.abs(percent), 1)}% ${percent > 0 ? t('below market', 'unter Marktwert') : t('above market', 'über Marktwert')}`}</span>` : ''}</div>`;
  }
  function sortHouseEntries(entries, sort) {
    return [...entries].sort((a, b) => {
      let order = 0;
      if (sort === 'price-asc' || sort === 'price-desc')
        order = (housePrice(a) - housePrice(b)) * (sort === 'price-desc' ? -1 : 1);
      else if (sort === 'type-asc' || sort === 'type-desc')
        order = houseTypeLabel(houseType(a.lot, a.primary)).localeCompare(houseTypeLabel(houseType(b.lot, b.primary))) * (sort === 'type-desc' ? -1 : 1);
      const endOrder = a.lot.status === 'active' && b.lot.status === 'active'
        ? a.lot.endsAt - b.lot.endsAt : a.lot.status !== b.lot.status
          ? a.lot.status === 'active' ? -1 : b.lot.status === 'active' ? 1 : b.lot.endsAt - a.lot.endsAt
          : b.lot.endsAt - a.lot.endsAt;
      return order || endOrder || `${a.primary ? 'primary' : 'resale'}:${a.lot.id}`.localeCompare(`${b.primary ? 'primary' : 'resale'}:${b.lot.id}`);
    });
  }
  function houseCard({ lot, primary, view }) {
    const type = houseType(lot, primary), price = housePrice({ lot, primary });
    const title = primary ? name(lot) : `${lot.quantity > 1 ? `${number(lot.quantity)}× ` : ''}${t(lot.item.title, lot.item.titleDe || lot.item.title)}`;
    const active = lot.status === 'active' && lot.endsAt > Date.now(), mine = view === 'mine-live' || view === 'mine-done';
    const participated = view === 'bid' || view === 'bid-done';
    const state = active && participated ? lot.leading ? t('Winning', 'Du führst') : t('Outbid', 'Überboten')
      : !active ? lot.status === 'cancelled' ? t('Cancelled', 'Storniert')
        : participated ? lot.won ? t('Won', 'Gewonnen') : t('Lost', 'Verloren')
          : lot.winnerId ? t('Sold', 'Verkauft') : t('Unsold', 'Nicht verkauft')
        : mine ? t('Your listing', 'Dein Angebot') : lot.requiredLevel > 1 ? t(`Level ${lot.requiredLevel}`, `Level ${lot.requiredLevel}`) : '';
    const stateClass = active && participated ? lot.leading ? ' is-leading' : ' is-outbid' : !active ? ' is-ended' : mine ? ' is-owned' : '';
    const art = primary ? paletteArtwork(lot) : lot.item.kind === 'review-pack' ? window.storeReputationUi.packArt(lot.item)
      : lot.item.kind === 'case' ? stockLotArtwork(lot) : lot.item.image ? `<img src="${esc(lot.item.image)}" alt="" loading="lazy">` : stockLotArtwork(lot) || '<span aria-hidden="true">◇</span>';
    const cancellable = mine && active && !lot.bidCount;
    return `<article class="house-lot${stateClass}" data-economy="${primary ? 'primary' : 'resale'}" data-id="${esc(lot.id)}" data-house-price="${price}" data-house-type="${type}" role="button" tabindex="0" aria-label="${esc(`${t('View auction', 'Auktion ansehen')}: ${title}${state ? ` · ${state}` : ''}`)}">
      <div class="house-lot-media">${art}<span class="house-lot-type">${houseTypeLabel(type)}</span>${state ? `<span class="house-lot-state">${state}</span>` : ''}</div>
      <div class="house-lot-body"><h3>${esc(title)}</h3>${window.marketTrendUi?.markup(lotMarketCategory(lot,primary))||''}<div class="house-lot-price"><strong>${justizEuro(price)}</strong><span>${lot.currentBid == null ? t('Starting bid', 'Startgebot') : !active ? t('Final bid', 'Letztes Gebot') : t('Current bid', 'Aktuelles Gebot')}</span></div>
      ${individualMarketValue(lot, primary)}
      <div class="house-lot-meta">${active ? countdown(lot.endsAt) : `<time datetime="${new Date(lot.endsAt).toISOString()}">${new Date(lot.endsAt).toLocaleDateString(uiLocale())}</time>`}<span>${number(lot.bidCount)} ${lot.bidCount === 1 ? t('bid', 'Gebot') : t('bids', 'Gebote')}</span></div>
      ${participated ? `<div class="house-lot-maximum"><span>${active && lot.leading ? t('Your reserved maximum', 'Dein hinterlegtes Höchstgebot') : t('Your last maximum', 'Dein letztes Höchstgebot')}</span><strong>${justizEuro(lot.highestBid)}</strong></div>` : ''}
      <div class="house-lot-footer">${cancellable ? `<button class="text-button" type="button" data-economy="cancel" data-id="${esc(lot.id)}">${t('Cancel listing', 'Angebot stornieren')}</button>` : ''}<span aria-hidden="true">↗</span></div></div></article>`;
  }
  function renderHouse() {
    const query = new URLSearchParams(location.search);
    const types = ['all', 'items', 'stock', 'mystery', 'cases', 'reviews'];
    const sorts = ['ends', 'price-asc', 'price-desc', 'type-asc', 'type-desc'];
    const type = types.includes(query.get('type')) ? query.get('type') : 'all';
    const sort = sorts.includes(query.get('sort')) ? query.get('sort') : 'ends';
    const seller = ['players', 'npc'].includes(query.get('seller')) ? query.get('seller') : 'all';
    const search = (query.get('search') || '').slice(0, 100), stock = query.get('stock'), palette = query.get('palette');
    const view = ['mine', 'bids'].includes(tab) ? tab : 'browse';
    const unopened = account && data.unopenedOwner === account.id ? data.unopened || [] : [];
    const key = entry => `${entry.primary ? 'primary' : 'resale'}:${entry.lot.id}`;
    const entries = (rows, primary, view) => (rows || []).map(lot => ({ lot, primary, view }));
    const deduplicate = rows => [...new Map(rows.map(entry => [key(entry), entry])).values()];
    const live = lot => lot.status === 'active' && lot.endsAt > Date.now();
    const pinned = account ? sortHouseEntries(deduplicate([
      ...entries((data.paletteMine || []).filter(live), true, 'bid'),
      ...entries((data.bids || []).filter(live), false, 'bid')
    ]), sort) : [];
    const pinnedKeys = new Set(pinned.map(key));
    let rows = view === 'mine' ? entries(data.mine, false, 'mine')
      : view === 'bids' ? [
        ...entries((data.paletteMine || []).filter(lot => !live(lot) && !unopened.some(reward => reward.kind === 'palette' && reward.id === lot.id)), true, 'bid-done'),
        ...entries((data.archivedBids || []).filter(lot => !unopened.some(reward => reward.kind === 'case' && reward.auctionId === lot.id)), false, 'bid-done')
      ] : [
        ...entries((data.lots || []).filter(lot => live(lot) && lot.sellerId !== account?.id), false, 'other'),
        ...entries((data.palettes || []).filter(live), true, 'other')
      ];
    if (view === 'mine') rows = rows.map(entry => ({ ...entry, view: live(entry.lot) ? 'mine-live' : 'mine-done' }));
    rows = sortHouseEntries(deduplicate(rows).filter(entry => {
      const lot = entry.lot;
      if (pinnedKeys.has(key(entry))) return false;
      if (type !== 'all' && houseType(lot, entry.primary) !== type) return false;
      if (view === 'browse' && seller !== 'all' && (entry.primary ? seller === 'players' : lot.sellerType !== (seller === 'players' ? 'player' : 'npc'))) return false;
      if (stock && (entry.primary ? !(({jeweler:['jewellery'],hardware:['tools','other']})[stock] || [stock]).includes(lot.stockOffer?.category) : lot.item.businessType !== stock && lot.item.businessCategory !== stock)) return false;
      if (palette && (!entry.primary || lot.paletteId !== palette)) return false;
      const title = entry.primary ? name(lot) : t(lot.item.title, lot.item.titleDe || lot.item.title);
      return !search.trim() || title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    }), sort);
    const grid = rows => `<div class="house-grid">${rows.map(houseCard).join('')}</div>`;
    const options = (items, selected) => items.map(([id, label]) => `<option value="${id}" ${selected === id ? 'selected' : ''}>${label}</option>`).join('');
    const filtered = type !== 'all' || seller !== 'all' || search || stock || palette || sort !== 'ends';
    accountContent.innerHTML = (window.shopUi?.handoff()||'') + `<div class="auction-house"><section class="house-header" aria-labelledby="house-title"><div class="house-heading"><div><h1 id="house-title" tabindex="-1">${t('Auction House', 'Auktionshaus')}</h1><a class="house-inventory-link" href="/inventory" data-page>${t('Inventory', 'Inventar')} ↗</a></div></div>
      <nav class="auction-house-shortcuts${economyFlags.market ? '' : ' is-single'}" aria-label="${t('Explore trading', 'Handel entdecken')}">
        <a class="house-launch-card house-case-store-card" href="/shop" data-page>
          <span class="house-card-copy"><strong>${t('Case Shop', 'Kisten-Shop')}</strong><span class="house-card-action" aria-hidden="true">→</span></span>
          <span class="house-card-art house-case-art" aria-hidden="true"><span class="house-spark house-spark-one">✦</span><span class="house-spark house-spark-two">✧</span>${caseArtwork({ caseType: 'collectors-cache', caseBadge: '?' })}<span class="house-rarity-dots"><i></i><i></i><i></i><i></i><i></i></span></span>
        </a>
        ${economyFlags.market ? `<a class="house-launch-card house-market-card" href="/market" data-page>
          <span class="house-card-copy"><strong>${t('Stock Market', 'Aktienmarkt')}</strong><span class="house-card-action" aria-hidden="true">↗</span></span>
          <span class="house-card-art house-market-art" aria-hidden="true"><span class="house-market-badge">J€</span><svg viewBox="0 0 200 160" fill="none"><path class="house-chart-grid" d="M16 34h170M16 66h170M16 98h170M16 130h170M36 24v116m48-116v116m48-116v116m48-116v116"/><path class="house-chart-area" d="M16 118 48 97 76 108 106 69 136 80 180 32v108H16Z"/><path class="house-chart-line" d="m16 118 32-21 28 11 30-39 30 11 44-48m-26 0h26v26"/><circle class="house-chart-point" cx="106" cy="69" r="5"/></svg></span>
        </a>` : ''}
      </nav>
      ${pinned.length ? `<section class="house-active-bids" aria-labelledby="house-active-title"><div class="house-section-heading"><h2 id="house-active-title">${t('Active bids', 'Aktive Gebote')}</h2><span>${number(pinned.length)}</span></div>${grid(pinned)}</section>` : ''}
      ${window.auctionWinningsUi?.markup(unopened) || ''}
      </section>
      <form class="house-filters" role="search" aria-label="${t('Auction filters', 'Auktionsfilter')}">
        <label>${t('View', 'Ansicht')}<select data-house-filter="view">${options([['browse', t('Live auctions', 'Laufende Auktionen')], ['mine', t('My listings', 'Meine Angebote')], ['bids', t('Bid history', 'Gebotsverlauf')]], view)}</select></label>
        <label>${t('Type', 'Art')}<select data-house-filter="type">${options(types.map(id => [id, id === 'all' ? t('All types', 'Alle Arten') : houseTypeLabel(id)]), type)}</select></label>
        <label>${t('Seller', 'Anbieter')}<select data-house-filter="seller" ${view !== 'browse' ? 'disabled' : ''}>${options([['all', t('All sellers', 'Alle Anbieter')], ['players', t('Players', 'Spieler')], ['npc', t('NPCs', 'NPCs')]], seller)}</select></label>
        <label>${t('Sort', 'Sortieren')}<select data-house-filter="sort">${options([['ends', view === 'bids' ? t('Recently ended', 'Zuletzt beendet') : t('Ending soon', 'Endet zuerst')], ['price-asc', t('Price: low to high', 'Preis: aufsteigend')], ['price-desc', t('Price: high to low', 'Preis: absteigend')], ['type-asc', t('Type: A–Z', 'Art: A–Z')], ['type-desc', t('Type: Z–A', 'Art: Z–A')]], sort)}</select></label>
        <label>${t('Search', 'Suchen')}<input type="search" data-house-filter="search" maxlength="100" value="${esc(search)}"></label>
        ${filtered ? `<button class="house-clear" type="button" data-house-clear>${t('Clear filters', 'Filter entfernen')}</button>` : ''}</form>
      ${stock || palette ? `<div class="house-filter-context">${stock ? `${t('Stock for', 'Waren für')}: ${esc(['jeweler','hardware'].includes(stock)?traderStoreLabel(stock):categoryName(({ cars: 'vehicles', toys: 'collectibles' })[stock] || stock))}` : esc(paletteName(palette))}</div>` : ''}
      <section class="house-results" aria-labelledby="house-results-title"><div class="house-section-heading"><h2 id="house-results-title">${view === 'mine' ? t('My listings', 'Meine Angebote') : view === 'bids' ? t('Bid history', 'Gebotsverlauf') : t('Live auctions', 'Laufende Auktionen')}</h2><span>${number(rows.length)}</span></div>${view !== 'browse' && !account ? loginNotice(t('auctions', 'Auktionen')) : rows.length ? grid(rows) : `<p class="house-empty">${t('No matching auctions.', 'Keine passenden Auktionen.')}</p>`}</section></div>`;
  }

  function render() {
    const path = currentAccountPage;
    if (path === '/auction-house') { renderHouse(); return; }
    if (!economyFlags[routes[path]]) {
      accountContent.innerHTML = pageHeading(t('Unavailable', 'Nicht verfügbar')) + `<a href="/shop" data-page>${t('Case Shop', 'Kisten-Shop')}</a>`;
      return;
    }
    if (path === '/market') { renderMarket(); return; }
    const primary = path === '/auctions';
    if (primary) {
      accountContent.innerHTML = pageHeading(t('Mystery Palette auctions', 'Mystery-Palette-Auktionen')) + economyOverviewMarkup();
      const paletteFilter = new URLSearchParams(location.search).get('palette');
      const myLots = data.mine || [];
      // Won lots stay on the board until the winner reveals them; every other
      // finished lot (lost, expired, already revealed) waits in the archive.
      const onBoard = lot => (lot.status === 'active' && lot.endsAt > Date.now()) || (lot.won && lot.revealAvailable);
      const myBoard = myLots.filter(onBoard);
      const myArchived = myLots.filter(lot => !onBoard(lot));
      const myIds = new Set(myLots.map(lot => lot.id));
      const liveLots = (data.lots || []).filter(lot => !myIds.has(lot.id) && (!paletteFilter || lot.paletteId === paletteFilter));
      if (account) {
        // An empty board collapses to a slim note; the box only earns its
        // border once there is something in it.
        accountContent.innerHTML += `<section class="my-bids-board${myBoard.length ? '' : ' is-empty'}"><div class="auction-section-heading"><div><h2>${t('My bids', 'Meine Gebote')}</h2></div>${myBoard.length ? `<strong>${myBoard.length}</strong>` : ''}</div>
          ${myBoard.length ? `<div class="economy-grid">${myBoard.map(lot => lotCard(lot, true)).join('')}</div>` : `<p class="my-bids-empty">${t('No bids yet.', 'Noch keine Gebote.')}</p>`}
          ${myArchived.length ? archiveToggle(myArchived.length) : ''}
          ${myArchived.length && archiveOpen ? `<div class="auction-section-heading archive-heading"><div><h2>${t('Archived auctions', 'Archivierte Auktionen')}</h2></div><strong>${myArchived.length}</strong></div>
          <div class="economy-grid">${myArchived.map(lot => lotCard(lot, true)).join('')}</div>` : ''}</section>`;
      }
      if (paletteFilter) accountContent.innerHTML += `<p>${t('Palette', 'Palette')}: <strong>${esc(paletteName(paletteFilter))}</strong> <a href="/auctions" data-page>${t('Show all auctions', 'Alle Auktionen anzeigen')} →</a></p>`;
      accountContent.innerHTML += `<div class="auction-section-heading live-auctions-heading"><div><h2>${t('Live auctions', 'Laufende Auktionen')}</h2></div><strong>${liveLots.length}</strong></div>`;
      accountContent.innerHTML += liveLots.length
        ? `<div class="economy-grid">${liveLots.map(lot => lotCard(lot, true)).join('')}</div>`
        : empty(t('No other auctions right now.', 'Aktuell keine weiteren Auktionen.'));
      return;
    }
    // Marketplace: one-line wallet summary, then a single context at a time
    // behind Browse / My auctions / My bids tabs.
    accountContent.innerHTML = `<header class="collection-heading"><div class="collection-heading-line"><h1 tabindex="-1">${t('Marketplace', 'Marktplatz')}</h1></div></header>
      `;
    const own = data.mine || [], bidLots = data.bids || [], archivedBids = data.archivedBids || [];
    const myLive = own.filter(lot => lot.status === 'active');
    const myDone = own.filter(lot => lot.status !== 'active');
    const separatedIds = new Set([...myLive, ...bidLots].map(lot => lot.id));
    const otherLive = (data.lots || []).filter(lot => lot.sellerId !== account?.id && !separatedIds.has(lot.id));
    const sellAction = label => `<a class="primary-button" href="/inventory" data-page>${label}</a>`;
    const grid = lots => `<div class="economy-grid">${lots.join('')}</div>`;
    const group = (label, show) => show ? `<h3 class="marketplace-group">${label}</h3>` : '';
    const browse = `<section><div class="marketplace-toolbar"><h2>${t('Browse auctions', 'Auktionen entdecken')}</h2>${account ? sellAction(t('Sell an item', 'Gegenstand anbieten')) : ''}</div>
      ${otherLive.length ? grid(otherLive.map(lot => lotCard(lot, false, 'other')))
        : `<p class="marketplace-blank">${t('No auctions are live right now.', 'Aktuell laufen keine Auktionen.')}</p>`}</section>`;
    if (!account) { accountContent.innerHTML += browse; return; }
    const tabs = [['browse', t('Browse', 'Entdecken')], ['mine', t('My auctions', 'Meine Auktionen')], ['bids', t('My bids', 'Meine Gebote')]];
    const bidCount = account.activeBids || 0;
    accountContent.innerHTML += `<p class="marketplace-summary">${number(bidCount)} ${bidCount === 1 ? t('active bid', 'aktives Gebot') : t('active bids', 'aktive Gebote')} · <strong>${number(myLive.length)}</strong> ${myLive.length === 1 ? t('active listing', 'aktives Angebot') : t('active listings', 'aktive Angebote')}</p>
      <nav class="economy-tabs marketplace-tabs" aria-label="${t('Marketplace sections', 'Marktplatz-Bereiche')}">${tabs.map(([id, label]) => `<button type="button" data-economy="tab" data-id="${id}" aria-pressed="${tab === id}">${label}</button>`).join('')}</nav>`;
    if (tab === 'mine') {
      // Ended listings belong to this tab, not to a separate archive section.
      const grouped = Boolean(myLive.length && myDone.length);
      accountContent.innerHTML += `<section><div class="marketplace-toolbar"><h2>${t('My auctions', 'Meine Auktionen')}</h2>${own.length ? `<span class="marketplace-count">${number(myLive.length)} ${t('active', 'aktiv')}</span>${sellAction(t('Sell an item', 'Gegenstand anbieten'))}` : ''}</div>
        ${group(t('LIVE', 'LIVE'), grouped)}${myLive.length ? grid(myLive.map(lot => lotCard(lot, false, 'mine-live'))) : ''}
        ${group(t('ENDED', 'BEENDET'), grouped)}${myDone.length ? grid(myDone.map(lot => lotCard(lot, false, 'mine-done'))) : ''}
        ${own.length ? '' : `<div class="marketplace-blank"><p>${t('No listings yet.', 'Noch keine Angebote.')}</p>${sellAction(t('Choose an inventory item', 'Inventargegenstand wählen'))}</div>`}</section>`;
    } else if (tab === 'bids') {
      const grouped = Boolean(bidLots.length && archivedBids.length);
      accountContent.innerHTML += `<section><div class="marketplace-toolbar"><h2>${t('My bids', 'Meine Gebote')}</h2></div>
        ${group(t('ACTIVE', 'AKTIV'), grouped)}${bidLots.length ? grid(bidLots.map(lot => lotCard(lot, false, 'bid'))) : ''}
        ${group(t('ENDED', 'BEENDET'), grouped)}${archivedBids.length ? grid(archivedBids.map(lot => lotCard(lot, false, 'bid-done'))) : ''}
        ${bidLots.length || archivedBids.length ? '' : `<div class="marketplace-blank"><p>${t('No bids yet.', 'Noch keine Gebote.')}</p><button class="secondary-button" type="button" data-economy="tab" data-id="browse">${t('Browse auctions', 'Auktionen entdecken')}</button></div>`}</section>`;
    } else accountContent.innerHTML += browse;
  }
  function bidForm(lot, primary) {
    if (!account) return `<a href="/login" data-page>${t('Log in to bid', 'Zum Bieten anmelden')}</a>`;
    if (lot.status !== 'active' || lot.endsAt <= Date.now()) return `<p>${status(lot)}</p>`;
    if (!primary && lot.sellerId === account.id) return `<p>${t('This is your listing.', 'Dies ist dein Angebot.')}</p>`;
    if (primary && account.progression.level < lot.requiredLevel) return `<p>${accountError('level_required')}</p>`;
    const min = bidMinimum(lot, primary), max = bidMaximum(lot), affordable = max >= min, reserved = bidReserved(lot);
    return `<form data-economy-form="${primary ? 'primary' : 'resale'}" data-id="${esc(lot.id)}" data-bid-reserved="${reserved}" data-ends-at="${lot.endsAt}" class="economy-form auction-bid-form" novalidate>
      <div class="auction-bid-balances"><p data-reserved-maximum${reserved ? '' : ' hidden'}>${t('Your reserved maximum', 'Dein hinterlegtes Höchstgebot')}: <strong>${justizEuro(reserved)}</strong><span class="auction-leading-badge">${t('You lead', 'Du führst')}</span></p><p>${t('Available for this auction', 'Für diese Auktion verfügbar')}: <strong data-bid-budget>${justizEuro(max)}</strong> ${infoTip(t('Your maximum is private and held in escrow. It can exceed the visible bid. Raising it reserves only the difference from your wallet. Unused J€ return when you are outbid or the auction settles.', 'Dein Höchstgebot ist privat und wird hinterlegt. Es kann über dem sichtbaren Gebot liegen. Beim Erhöhen wird nur die Differenz aus deinem Guthaben hinterlegt. Übrige J€ erhältst du beim Überbieten oder nach der Abrechnung zurück.'), t('How maximum bids work', 'So funktionieren Höchstgebote'))}</p></div>
      <label for="auction-bid-amount">${t('Your maximum bid in J€', 'Dein Höchstgebot in J€')}</label><div class="auction-bid-entry"><input id="auction-bid-amount" name="amount" type="number" inputmode="numeric" min="${min}" max="${max}" step="1" value="${affordable ? min : ''}" required aria-describedby="auction-bid-guidance auction-bid-error"${affordable ? '' : ' disabled'}><button class="primary-button" type="submit"${affordable ? '' : ' disabled'}>${reserved ? t('Raise maximum', 'Höchstgebot erhöhen') : t('Place bid', 'Gebot abgeben')}</button></div>
      <div class="auction-bid-guidance" id="auction-bid-guidance"><span>${t('Minimum', 'Mindestgebot')}: <strong data-bid-minimum-value>${justizEuro(min)}</strong></span><button type="button" class="text-button" data-bid-minimum${affordable ? '' : ' disabled'}>${t('Use minimum', 'Minimum einsetzen')}</button></div>
      <p class="account-error" id="auction-bid-error" role="alert" aria-live="polite"${affordable ? '' : ' data-bid-unavailable="1"'}>${affordable ? '' : bidFundsError(min, max)}</p>
      <dl class="auction-bid-preview" data-bid-preview${affordable ? '' : ' hidden'}><div><dt data-bid-charge-label>${reserved ? t('Additional reserve', 'Zusätzlich hinterlegen') : t('Reserve if leading', 'Bei Führung hinterlegen')}</dt><dd data-bid-charge>${justizEuro(min - reserved)}</dd></div><div><dt data-bid-wallet-label>${reserved ? t('Wallet after', 'Guthaben danach') : t('Wallet if leading', 'Guthaben bei Führung')}</dt><dd data-bid-wallet>${justizEuro(max - min)}</dd></div></dl>
      <p class="auction-end-rule">${t('Bids in the final 10 seconds reset the countdown to 10 seconds.', 'Gebote in den letzten 10 Sekunden setzen den Countdown auf 10 Sekunden zurück.')}</p></form>`;
  }
  function validateBidForm(form, focus = false) {
    const input = form.querySelector('input[name="amount"]'), error = form.querySelector('.account-error');
    if (Number(form.dataset.endsAt) <= Date.now()) {
      input.disabled = true;
      form.querySelector('button[type="submit"]').disabled = true;
      form.querySelector('[data-bid-minimum]').disabled = true;
      error.textContent = t('This auction has ended. Check your auction history.', 'Diese Auktion ist beendet. Sieh in deinem Auktionsverlauf nach.');
    }
    const message = input.disabled ? error.textContent : bidEntryError(input.value, Number(input.min), Number(input.max));
    input.setCustomValidity(message);
    input.setAttribute('aria-invalid', String(Boolean(message)));
    if (!input.disabled) { error.textContent = message; delete error.dataset.bidUnavailable; }
    const preview = form.querySelector('[data-bid-preview]');
    if (preview) preview.hidden = Boolean(message) || input.disabled;
    if (!message && !input.disabled) {
      const reserved = Number(form.dataset.bidReserved);
      form.querySelector('[data-bid-charge-label]').textContent = reserved ? t('Additional reserve', 'Zusätzlich hinterlegen') : t('Reserve if leading', 'Bei Führung hinterlegen');
      form.querySelector('[data-bid-wallet-label]').textContent = reserved ? t('Wallet after', 'Guthaben danach') : t('Wallet if leading', 'Guthaben bei Führung');
      form.querySelector('[data-bid-charge]').textContent = justizEuro(Number(input.value) - Number(form.dataset.bidReserved));
      form.querySelector('[data-bid-wallet]').textContent = justizEuro(Number(input.max) - Number(input.value));
    }
    if (message && focus) input.focus();
    return !message && !input.disabled;
  }
  function updateBidForm(lot, primary, form) {
    const input = form.querySelector('input[name="amount"]'), error = form.querySelector('.account-error');
    const min = bidMinimum(lot, primary), max = bidMaximum(lot), affordable = max >= min;
    const ended = lot.status !== 'active' || lot.endsAt <= Date.now();
    input.min = String(min); input.max = String(max);
    form.dataset.bidReserved = String(bidReserved(lot)); form.dataset.endsAt = String(lot.endsAt);
    input.disabled = ended || !affordable;
    form.querySelector('button[type="submit"]').disabled = ended || !affordable || busy;
    form.querySelector('[data-bid-minimum]').disabled = ended || !affordable || busy;
    form.querySelector('[data-bid-minimum-value]').textContent = justizEuro(min);
    const reserved = form.querySelector('[data-reserved-maximum]');
    reserved.hidden = !bidReserved(lot);
    reserved.querySelector('strong').textContent = justizEuro(bidReserved(lot));
    form.querySelector('button[type="submit"]').textContent = busy ? t('Saving…', 'Wird gespeichert…')
      : bidReserved(lot) ? t('Raise maximum', 'Höchstgebot erhöhen') : t('Place bid', 'Gebot abgeben');
    form.querySelector('[data-bid-budget]').textContent = justizEuro(max);
    if (ended || !affordable) {
      error.textContent = ended
        ? t('This auction has ended. Check your auction history.', 'Diese Auktion ist beendet. Sieh in deinem Auktionsverlauf nach.')
        : bidFundsError(min, max);
      error.dataset.bidUnavailable = '1';
    }
    // Keep the draft unchanged when live prices move; show the new minimum.
    validateBidForm(form);
  }
  function bidFundsError(min, max) {
    return t(`You need ${justizEuro(min - max)} more for the minimum bid.`, `Dir fehlen ${justizEuro(min - max)} für das Mindestgebot.`);
  }
  function bidEntryError(value, min, max) {
    const amount = Number(value);
    if (!String(value).trim() || !Number.isSafeInteger(amount)) return t('Enter a whole J€ amount.', 'Gib einen ganzen J€-Betrag ein.');
    if (amount < min) return t(`Enter at least ${justizEuro(min)}.`, `Gib mindestens ${justizEuro(min)} ein.`);
    if (amount > max) return t(`You can bid up to ${justizEuro(max)} on this auction.`, `Du kannst bei dieser Auktion bis zu ${justizEuro(max)} bieten.`);
    return '';
  }
  function paletteArtwork(lot) {
    if(lot.stockOffer&&window.paletteUi)return `<div class="palette-artwork palette-auction-art is-${esc(lot.stockOffer.tier)}">${window.paletteUi.art(lot.stockOffer)}</div>`;
    const themes = {
      cars: 'vehicles', 'electronics-smuggling': 'electronics', 'wine-tax-seizure': 'wine',
      schatzkiste: 'luxury', 'dealer-seizure': 'luxury', jewellery: 'luxury'
    };
    const theme = themes[lot.paletteId] || lot.paletteId || lot.type;
    const symbols = {
      vehicles: '<path d="m-27 7 5-20h44l5 20v15h-54zM-22-13l6-12h32l6 12M-27 7h54M-18 15h5m26 0h5"/><circle cx="-18" cy="26" r="4"/><circle cx="18" cy="26" r="4"/>',
      electronics: '<rect x="-17" y="-29" width="34" height="58" rx="5"/><path d="M-6-21H6M-5 21H5m-8-31-6 13h12L3 14"/>',
      wine: '<path d="M-7-29H7v17l9 11v28h-32V-1l9-11zM-7-21H7M-16 6h32M-16 18h32"/>',
      tools: '<path d="m-22 27 29-29a17 17 0 0 0 21-21L17-12 7-22 18-33A17 17 0 0 0-3-12l-29 29z"/><circle cx="-22" cy="17" r="3"/>',
      luxury: '<path d="m-29-10 12-15h34l12 15L0 29zM-29-10h58M-17-25l7 15L0 29l10-39 7-15M-10-10 0-25l10 15"/>',
      collectibles: '<path d="m0-30 9 19 21 3-15 15 4 22L0 19l-19 10 4-22-15-15 21-3z"/>',
      mixed: '<path d="M-23-13v-9h46v9M-30-13h60v39h-60zM-30-1h60M-7-5H7v10H-7z"/>'
    };
    const symbol = symbols[theme] || symbols.mixed;
    return `<div class="palette-artwork"><svg viewBox="0 0 320 260" role="img" aria-label="${esc(t('Sealed mystery palette — theme illustration', 'Versiegelte Mystery-Palette — Themenillustration'))}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="160" cy="126" r="104" fill="currentColor" opacity=".06"/>
      <g fill="none" stroke="currentColor" stroke-width="2" opacity=".3"><path d="M34 61h14m-7-7v14M269 190h14m-7-7v14M267 54l5 5-5 5-5-5z"/></g>
      <path d="m62 87 98-43 98 43v123H62z" fill="var(--paper)" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
      <path d="M62 87h196M144 51v159h32V51M62 185h196" fill="none" stroke="currentColor" stroke-width="2" opacity=".3"/>
      <path d="M51 214h218v12H51zM65 226v9m95-9v9m95-9v9" fill="var(--paper)" stroke="currentColor" stroke-width="3"/>
      <rect x="112" y="99" width="96" height="83" rx="12" fill="var(--ink)"/>
      <g transform="translate(160 140) scale(.85)" fill="none" stroke="var(--paper)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${symbol}</g>
      <circle cx="247" cy="194" r="23" fill="#b94c25"/><path d="M239 190v-5a8 8 0 0 1 16 0v5m-18 0h20v15h-20z" fill="none" stroke="#fffdf7" stroke-width="2.5" stroke-linejoin="round"/>
    </svg></div>`;
  }
  function auctionMedia(lot, primary) {
    if (!primary && lot.item.kind === 'review-pack') return window.storeReputationUi.packArt(lot.item);
    if (primary) return paletteArtwork(lot);
    const items = [lot.item];
    const images = items.filter(item => item?.image);
    if (!images.length) return stockLotArtwork(lot) || `<div class="auction-room-placeholder" aria-hidden="true">◇</div>`;
    const first = images[0];
    return `<figure class="auction-room-main-image"><img data-auction-main-image src="${esc(first.image)}" alt="${esc(first.title || '')}"><figcaption data-auction-caption>${esc(first.title || '')}</figcaption></figure>
      ${images.length > 1 ? `<div class="auction-room-thumbs" role="group" aria-label="${primary ? t('Sealed palette illustration', 'Illustration der versiegelten Palette') : t('Auction pictures', 'Auktionsbilder')}">${images.map((item, index) => `<button type="button" data-economy="gallery" data-src="${esc(item.image)}" data-alt="${esc(item.title || '')}" aria-pressed="${index === 0}" aria-label="${esc(item.title || t('Auction picture', 'Auktionsbild'))}"><img src="${esc(item.image)}" alt=""></button>`).join('')}</div>` : ''}`;
  }
  function auctionContents(lot) {
    if(lot.stockOffer)return `<div class="auction-room-contents"><p>${lot.stockOffer.openingMode?t('Three drops; items and quantities unknown.','Drei Drops; Artikel und Mengen unbekannt.'):lot.stockOffer.quantity+'× '+esc(t(lot.stockOffer.name,lot.stockOffer.nameDe))+' · '+t('Three item and quantity rolls after winning','Drei Artikel- und Mengen-Auslosungen nach dem Gewinn')}</p>${window.paletteUi.odds(lot.stockOffer,{luckPreview:lot.status==='active'})}</div>`;
    return `<div class="auction-room-contents">${infoTip(t('The palette contains three mystery finds, revealed one by one after winning. Duplicates are possible.', 'Die Palette enthält drei geheime Funde, die nach dem Gewinn einzeln aufgedeckt werden. Doppelte Funde sind möglich.'), t('What is inside?', 'Was ist enthalten?'))}</div>`;
  }
  async function showLot(id, primary) {
    const request = ++dialogSequence, visit = accountVisit;
    const result = primary ? await api.paletteAuction(id) : await api.resale(id);
    if (request !== dialogSequence || visit !== accountVisit) return;
    const lot = primary ? result?.auction : result?.listing;
    if (!lot) throw new Error(accountError('auction_not_found'));
    const participation = (primary ? data.paletteMine || data.mine || [] : [...(data.bids || []), ...(data.archivedBids || [])]).find(entry => entry.id === lot.id);
    if (participation) Object.assign(lot, { won: participation.won, leading: participation.leading,
      highestBid: participation.highestBid, revealAvailable: participation.revealAvailable });
    detailId = id;
    detailPrimary = primary;
    const title = primary ? name(lot) : `${lot.quantity > 1 ? `${lot.quantity}× ` : ''}${t(lot.item.title, lot.item.titleDe || lot.item.title)}`;
    const finished=lot.status!=='active'||lot.endsAt<=Date.now();
    const winAction = primary && lot.revealAvailable ? `<div class="auction-win-panel"><h3>${t('Won palette', 'Gewonnene Palette')}</h3><div class="palette-seal" aria-hidden="true"><span>01 ◇</span><span>02 ◇</span><span>03 ◇</span></div><button class="primary-button" data-economy="reveal" data-id="${esc(lot.id)}">${lot.stockOffer?t('Reveal stock','Stock aufdecken'):t('Reveal three finds', 'Drei Funde aufdecken')} →</button></div>` : finished ? `<button class="primary-button" data-economy="close">${t('Continue','Weiter')}</button>` : bidForm(lot, primary);
    openDialog(`<div class="auction-room"><section class="auction-room-media" aria-label="${primary ? t('Sealed palette illustration', 'Illustration der versiegelten Palette') : t('Auction pictures', 'Auktionsbilder')}">${auctionMedia(lot, primary)}</section>
      <section class="auction-room-story"><h2 id="economy-dialog-title" tabindex="-1">${esc(title)}</h2>${window.marketTrendUi?.markup(lotMarketCategory(lot,primary))||''}
      ${primary ? `<p class="auction-room-meta">${t('Required level', 'Benötigtes Level')} <strong>${lot.requiredLevel}</strong><br>${esc((lot.allowedMarketCategories || []).map(categoryName).join(' · ') || categoryName(null))}</p>${auctionContents(lot)}` : `<p class="auction-room-meta">${t('Seller', 'Verkäufer')}: <strong>${esc(lot.sellerUsername)}</strong><br>${t('Quantity', 'Anzahl')}: <strong>${lot.quantity}</strong><br>${lot.item.kind === 'review-pack' ? `${lot.item.reviewCount} ${t('Botted Reviews · choose 1–5 stars and a store in inventory','Bot-Bewertungen · 1–5 Sterne und einen Laden im Inventar wählen')}` : lot.item.kind === 'case' ? t('Sealed case · one item from any category', 'Versiegelte Kiste · ein Gegenstand aus jeder Kategorie') : `${t('Historical real-auction value', 'Historischer Wert der echten Auktion')}: <strong>${euro(lot.item.price * lot.quantity)}</strong>`}<br>${t('Estimated market value', 'Geschätzter Marktwert')}: <strong>${justizEuro(lot.estimatedValueTokens)}</strong>${lot.npcDemand?`<br>${t('NPC demand','NPC-Nachfrage')}: <strong>${npcDemandLabel(lot.npcDemand)}</strong>`:''}${economyFlags.market&&lot.item.marketCategory?`<br><a href="/market?category=${encodeURIComponent(lot.item.marketCategory)}" data-page>${t('Market Trends','Markttrends')} ↗</a>`:''}</p>`}
      </section><aside class="auction-room-bidding"><header><h3>${lot.status==='active'?t('Bidding','Gebote'):t('Auction outcome','Auktionsergebnis')}</h3></header><div data-live-facts>${bidFacts(lot, primary)}</div>
      <ol class="auction-chat" data-live-history role="log" aria-label="${t('Bid history', 'Gebotsverlauf')}">${bidHistory(lot.bids)}</ol><div class="auction-bid-dock">${winAction}</div></aside></div>`);
    const historyNode = dialog.querySelector('[data-live-history]');
    if (historyNode) historyNode.scrollTop = historyNode.scrollHeight;
  }
  function listingDialog(id) {
    const group = groupedInventory(accountItems).find(entry => entry.copies.some(copy => copy.id === id));
    const available = group?.copies.filter(copy => !copy.listed && !copy.storeId) || [];
    const item = available.find(copy => copy.id === id) || available[0];
    if (!item || !economyFlags.resales) return;
    const quantity = available.length;
    openDialog(`<h2 id="economy-dialog-title" tabindex="-1">${t('List for auction', 'Zur Auktion anbieten')}</h2><p>${esc(item.title)}</p><p>${t('Estimated market value', 'Geschätzter Marktwert')}: ${justizEuro(item.estimatedValueTokens * quantity)}</p>
      <p class="fine-print">${t('Market estimates are not guaranteed sale prices. Recent NPC purchases and bids reduce demand; relisting does not refresh buyers.', 'Marktschätzungen sind keine garantierten Verkaufspreise. Kürzliche NPC-Käufe und Gebote senken die Nachfrage; erneutes Anbieten erzeugt keine neuen Käufer.')}</p><form data-economy-form="list" data-id="${esc(item.id)}" class="economy-form"><label>${t('Quantity', 'Anzahl')} · ${quantity} ${t('available', 'verfügbar')}<input name="quantity" type="number" inputmode="numeric" min="1" max="${quantity}" step="1" value="${quantity}" required></label><label>${t('Starting price in J€', 'Startpreis in J€')}<input name="amount" type="number" inputmode="numeric" min="1" step="1" value="${Math.max(1, Math.round(item.estimatedValueTokens * quantity * .7))}" required></label>
      <label>${t('Duration', 'Dauer')}<select name="duration"><option value="300000">${t('5 minutes', '5 Minuten')}</option><option value="900000" selected>${t('15 minutes', '15 Minuten')}</option><option value="3600000">${t('1 hour', '1 Stunde')}</option></select></label>
      <p>${t('A listing with bids cannot be cancelled.', 'Angebote mit Geboten können nicht storniert werden.')}</p><p class="account-error" role="alert"></p><button class="primary-button" type="submit">${t('Start auction', 'Auktion starten')}</button></form>`);
  }
  async function startReveal(id) {
    if(window.paletteUi){await navigateAccountPage('/auction-house?reveal='+encodeURIComponent(id));return;}
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
    openDialog(`<h2 id="economy-dialog-title" tabindex="-1">${t('Find', 'Fund')} ${revealPosition + 1} / 3</h2><div class="reveal-steps" aria-hidden="true">${[0, 1, 2].map(i => `<span class="${i <= revealPosition ? "is-current" : ""}">${i < revealPosition ? "✓" : i + 1}</span>`).join("")}</div><div class="case-window" aria-hidden="true"><div class="case-marker"></div><div class="case-reel"></div></div><div class="palette-result" role="status">${t('Revealing…', 'Wird aufgedeckt …')}</div>`);
    const valid = () => request === dialogSequence && visit === accountVisit && dialog.open && reveal === fixed;
    await spinCaseReel(dialog.querySelector('.case-reel'), dialog.querySelector('.case-window'), reward, fixed.pool, valid);
    if (!valid()) return;
    revealPosition++;
    dialog.querySelector('.palette-result').innerHTML = `<div class="palette-find rarity-${esc(reward.rarity)}"><img src="${esc(reward.image || '')}" alt=""><p class="rarity-label">${rarityLabel(reward.rarity)}</p><h3>${esc(reward.title)}</h3><p>${t('Historical real-auction value', 'Historischer Wert der echten Auktion')}: ${euro(reward.price)}</p></div><button class="primary-button" data-economy="next-reward">${revealPosition === 3 ? t('View summary', 'Zusammenfassung') : t('Reveal next find', 'Nächsten Fund aufdecken')} →</button>`;
    dialog.querySelector('[data-economy="next-reward"]').focus({ preventScroll: true });
  }
  function revealSummary(fixed) {
    const entries = fixed.rewards.map(r => ({ title: r.item.title, value: Math.max(1, Math.round(r.item.price)) }));
    const totalValue = entries.reduce((sum, entry) => sum + entry.value, 0);
    const value = fixed.rewards.reduce((sum, r) => sum + r.item.price, 0);
    const difference = totalValue - fixed.bundleCostTokens;
    const verdict = difference > 0 ? { label: t('Estimated upside', 'Geschätzter Mehrwert'), className: 'is-profit' }
      : difference < 0 ? { label: t('Estimated shortfall', 'Geschätztes Minus'), className: 'is-loss' }
      : { label: t('Estimate equals cost', 'Schätzung entspricht Kosten'), className: 'is-even' };
    openDialog(`<h2 id="economy-dialog-title" tabindex="-1">${t('Palette contents', 'Paletteninhalt')}</h2><div class="inventory-grid">${fixed.rewards.map(r => itemCard({ ...r.item, sellValue: Math.max(1, Math.round(r.item.price)) }, false)).join('')}</div>
      <div class="palette-ledger">
      ${entries.map(entry => `<div class="palette-ledger-row"><span>${esc(entry.title)}</span><b>+${justizEuro(entry.value)}</b></div>`).join('')}
      <div class="palette-ledger-row is-total"><span>${t('Total finds value', 'Gesamtwert der Funde')} <small>(${euro(value)})</small></span><b>${justizEuro(totalValue)}</b></div>
      <div class="palette-ledger-row"><span>${t('Winning bid', 'Gewinngebot')}</span><b>−${justizEuro(fixed.bundleCostTokens)}</b></div>
      <div class="palette-ledger-verdict ${verdict.className}"><span>${verdict.label}</span><strong>${difference > 0 ? '+' : difference < 0 ? '−' : ''}${justizEuro(Math.abs(difference))}</strong></div>
      <div class="palette-ledger-note">${infoTip(t('Historical values are not guaranteed sale prices. Your finds are already in your inventory.', 'Historische Werte sind keine garantierten Verkaufspreise. Deine Funde liegen bereits im Inventar.'), t('About this estimate', 'Über diese Schätzung'))}</div></div>
      <button class="primary-button" data-economy="close">${t('Continue','Weiter')}</button>`);
  }
  async function loadHistory(id, visit = accountVisit, repaint = true) {
    if (!id) return;
    const request = ++historySequence, range = marketRange;
    historyLoading = true;
    const result = await api.marketHistory(id, 720, range);
    if (request !== historySequence || visit !== accountVisit || category !== id || range !== marketRange) return;
    historyLoading = false;
    if (!result) { if (repaint) renderMarket(); throw new Error(t('History could not be loaded. Try selecting the category again.', 'Der Verlauf konnte nicht geladen werden. Wähle die Kategorie erneut.')); }
    history = result.history || [];
    if (repaint) renderMarket();
  }
  function marketChaosMarkup(event) {
    if (!event) return '';
    return `<section class="market-chaos-banner" role="status"><div><h2>${t('Market frenzy','Marktrausch')}</h2><p>${t('Quotes can fall to a quarter or rise to three times their normal value.','Kurse können auf ein Viertel fallen oder auf das Dreifache ihres normalen Werts steigen.')}</p></div><div class="market-chaos-clock"><span>${t('Normal trading returns in','Normaler Handel wieder in')}</span>${countdown(event.endsAt)}</div></section>`;
  }
  function renderMarket() {
    const categories = data.categories || [], selected = categories.find(c => c.category === category);
    const chartFocused = accountContent.querySelector('[data-market-plot]') === document.activeElement;
    const rangeFocus = document.activeElement?.dataset?.economy === 'market-range' ? document.activeElement.dataset.id : null;
    accountContent.innerHTML = pageHeading(t('Market Trends', 'Markttrends'), t('100 is neutral. Above 100 means stronger demand; below 100 means weaker demand. Market movement changes buyer valuations. A random one-hour market frenzy hits once a week.', '100 ist neutral. Darüber ist die Nachfrage stärker, darunter schwächer. Marktbewegungen verändern Käuferbewertungen. Ein zufälliger einstündiger Marktrausch trifft den Markt einmal pro Woche.')) + marketChaosMarkup(data.chaosEvent) + economyOverviewMarkup() +
      `<div class="market-categories">${categories.map(c => `<button data-economy="category" data-id="${c.category}" aria-pressed="${category === c.category}"><span>${esc(t(c.name, c.nameDe))}</span><strong>${number(c.currentIndex, 2)} ${(c.change1h || 0) > 0 ? '↑' : (c.change1h || 0) < 0 ? '↓' : '→'}</strong><span class="market-card-change ${(c.change1h || 0) > 0 ? 'is-up' : (c.change1h || 0) < 0 ? 'is-down' : 'is-flat'}">${(c.changePercent1h || 0) > 0 ? '+' : ''}${number(c.changePercent1h || 0, 2)}% · 1h</span><small>${c.currentIndex >= 100 ? '+' : ''}${number(c.currentIndex - 100, 2)}% ${c.currentIndex > 100 ? t('above normal', 'über Normalwert') : c.currentIndex < 100 ? t('below normal', 'unter Normalwert') : t('normal value', 'Normalwert')}</small><time>${date(c.updatedAt)}</time></button>`).join('')}</div>
      <section class="market-chart"><div class="market-chart-toolbar"><div class="section-title-row"><h2>${esc(selected ? t(selected.name, selected.nameDe) : '')}</h2>${infoTip(t('Quotes move every minute. The chart scales to the selected period; the dotted line marks its opening quote. High and low reflect the chart samples. Hover, touch, or use arrow keys to inspect values.', 'Kurse bewegen sich jede Minute. Die Skala folgt dem gewählten Zeitraum; die gepunktete Linie markiert den Startkurs. Hoch und Tief beziehen sich auf die Diagrammwerte. Prüfe Werte mit Maus, Berührung oder Pfeiltasten.'), t('About this chart', 'Über dieses Diagramm'))}</div><div class="market-time-filters" role="group" aria-label="${t('Chart time range', 'Diagrammzeitraum')}">${marketRanges.map(([id, en, de]) => `<button type="button" data-economy="market-range" data-id="${id}" aria-pressed="${marketRange === id}">${t(en, de)}</button>`).join('')}</div></div>${marketSummary(history, selected)}${historyLoading && !history.length ? `<p role="status">${t('Loading history…', 'Verlauf wird geladen …')}</p>` : chart(history)}</section>`;
    const chartSection = accountContent.querySelector('.market-chart');
    const categoryGrid = accountContent.querySelector('.market-categories');
    if (chartSection && categoryGrid) accountContent.insertBefore(chartSection, categoryGrid);
    wireMarketChart(chartSection, chartFocused);
    if (rangeFocus) accountContent.querySelector(`[data-economy="market-range"][data-id="${rangeFocus}"]`)?.focus({ preventScroll: true });
  }
  function marketSummary(points, selected) {
    const latest = points[0]?.indexValue ?? selected?.currentIndex;
    if (!Number.isFinite(latest)) return '';
    const opening = points.at(-1)?.indexValue ?? latest, change = latest - opening;
    const percent = opening > 0 ? change / opening * 100 : 0;
    const values = points.map(p => p.indexValue);
    const sign = change > 0 ? '+' : '', direction = change > 0 ? 'is-up' : change < 0 ? 'is-down' : 'is-flat';
    return `<div class="market-quote-summary"><div><span class="market-live-label">${t('LIVE INDEX · 1 MIN QUOTES', 'LIVE-INDEX · MINUTENKURSE')}</span><strong class="market-current-quote">${number(latest, 2)}</strong><span class="market-period-change ${direction}">${change > 0 ? '↑' : change < 0 ? '↓' : '→'} ${sign}${number(change, 2)} (${sign}${number(percent, 2)}%) <small>${t('in selected period', 'im gewählten Zeitraum')}</small></span></div><dl><div><dt>${t('Open', 'Start')}</dt><dd>${number(opening, 2)}</dd></div><div><dt>${t('High', 'Hoch')}</dt><dd>${number(values.length ? Math.max(...values) : latest, 2)}</dd></div><div><dt>${t('Low', 'Tief')}</dt><dd>${number(values.length ? Math.min(...values) : latest, 2)}</dd></div></dl></div>`;
  }
  function chart(points) {
    if (!points.length) return empty(t('No history yet.', 'Noch kein Verlauf.'));
    const sorted = [...points].reverse(), start = Date.parse(sorted[0].capturedAt), end = Date.parse(sorted.at(-1).capturedAt);
    const { width, left, right, top, bottom } = marketPlotGeometry();
    const x = p => start === end ? (left + right) / 2
      : left + (right - left) * (Date.parse(p.capturedAt) - start) / (end - start);
    const range = marketChartRange(sorted);
    const y = p => bottom - (p.indexValue - range.min) / (range.max - range.min) * (bottom - top);
    const line = sorted.map(p => `${x(p)},${y(p)}`).join(' ');
    const dateLabel = time => esc(new Date(time).toLocaleString(uiLocale(), end - start < 2 * 86_400_000
      ? { hour: '2-digit', minute: '2-digit', ...(end - start > 3600_000 ? { day: 'numeric', month: 'short' } : {}) }
      : { day: 'numeric', month: 'short' }));
    const ticks = Array.from({ length: 5 }, (_, index) => range.min + (range.max - range.min) * index / 4);
    if (range.min <= 100 && range.max >= 100 && !ticks.some(value => Math.abs(value - 100) < .01)) ticks.push(100);
    const yTicks = ticks.map(value => {
      const at = bottom - (value - range.min) / (range.max - range.min) * (bottom - top);
      return `<line x1="${left}" x2="${right}" y1="${at}" y2="${at}" class="market-chart-grid${value === 100 ? ' is-neutral' : ''}"/><text x="48" y="${at + 4}" text-anchor="end">${number(value, 2)}</text>`;
    }).join('');
    const xTicks = (start === end ? [.5] : width < 500 ? [0, 1] : [0, 1 / 3, 2 / 3, 1]).map((fraction, index) => {
      const at = left + fraction * (right - left);
      return `<line x1="${at}" x2="${at}" y1="${top}" y2="${bottom}" class="market-chart-grid"/><text x="${at}" y="251" text-anchor="${start === end ? 'middle' : index === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}">${dateLabel(start + fraction * (end - start))}</text>`;
    }).join('');
    const latest = sorted.at(-1), opening = sorted[0];
    const direction = latest.indexValue > opening.indexValue ? 'is-up' : latest.indexValue < opening.indexValue ? 'is-down' : 'is-flat';
    return `<div class="market-plot-scroll"><div class="market-plot-wrap"><svg viewBox="0 0 ${width} 288" class="${direction}" data-market-plot tabindex="0" role="group" aria-label="${t('Market index over time. Use left and right arrow keys to inspect recorded values.', 'Marktindex im Zeitverlauf. Mit den Pfeiltasten links und rechts Messwerte ansehen.')}"><title>${t('Market index over time', 'Marktindex im Zeitverlauf')}</title>${yTicks}${xTicks}<path d="M${left} ${top}V${bottom}H${right}" class="market-chart-axis"/><text x="14" y="127" transform="rotate(-90 14 127)" text-anchor="middle" class="market-chart-axis-label">Index</text><text x="${(left + right) / 2}" y="281" text-anchor="middle" class="market-chart-axis-label">${t('Date', 'Datum')}</text><line x1="${left}" x2="${right}" y1="${y(opening)}" y2="${y(opening)}" class="market-chart-opening"/><polygon points="${left},${bottom} ${line} ${right},${bottom}" class="market-chart-area"/><polyline points="${line}" class="market-chart-line"/><circle cx="${x(latest)}" cy="${y(latest)}" r="4" class="market-chart-latest"/><line data-market-crosshair x1="0" x2="0" y1="${top}" y2="${bottom}" class="market-chart-crosshair" visibility="hidden"/><circle data-market-marker cx="0" cy="0" r="6" class="market-chart-marker" visibility="hidden"/></svg><div class="market-chart-tooltip" data-market-tooltip role="status" aria-live="polite" hidden></div></div></div><details><summary>${t("History table", "Verlaufstabelle")}</summary><div class="market-history-table"><table><thead><tr><th>${t("Time", "Zeit")}</th><th>Index</th></tr></thead><tbody>${sorted.map(p => `<tr><td>${date(p.capturedAt)}</td><td>${number(p.indexValue, 2)}</td></tr>`).join("")}</tbody></table></div></details>`;
  }
  function marketPlotGeometry() {
    const compact = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 600px)').matches;
    return { width: compact ? 360 : 760, left: 58, right: compact ? 340 : 730, top: 20, bottom: 226 };
  }
  function marketChartRange(points) {
    const values = points.map(point => point.indexValue), low = Math.min(...values), high = Math.max(...values);
    const padding = Math.max(.3, (high - low) * .12);
    return { min: low - padding, max: high + padding };
  }
  function wireMarketChart(section, restoreFocus = false) {
    const plot = section?.querySelector('[data-market-plot]');
    if (!plot || !history.length) return;
    const series = [...history].reverse().map(point => ({ ...point, time: Date.parse(point.capturedAt) }));
    const start = series[0].time, end = series.at(-1).time;
    const range = marketChartRange(series);
    const { width, left, right, top, bottom } = marketPlotGeometry();
    const tooltip = section.querySelector('[data-market-tooltip]');
    const crosshair = plot.querySelector('[data-market-crosshair]');
    const marker = plot.querySelector('[data-market-marker]');
    let selected = chartSelectionTime === null ? series.length - 1 : series.reduce((closest, point, index) =>
      Math.abs(point.time - chartSelectionTime) < Math.abs(series[closest].time - chartSelectionTime) ? index : closest, 0);
    function show(index) {
      selected = Math.max(0, Math.min(series.length - 1, index));
      const point = series[selected];
      chartSelectionTime = point.time;
      const x = start === end ? (left + right) / 2 : left + (right - left) * (point.time - start) / (end - start);
      const y = bottom - (point.indexValue - range.min) / (range.max - range.min) * (bottom - top);
      crosshair.setAttribute('x1', x); crosshair.setAttribute('x2', x);
      marker.setAttribute('cx', x); marker.setAttribute('cy', y);
      crosshair.setAttribute('visibility', 'visible'); marker.setAttribute('visibility', 'visible');
      tooltip.hidden = false;
      tooltip.textContent = `${date(point.capturedAt)} · ${t('Index', 'Index')} ${number(point.indexValue, 2)} (${point.indexValue >= 100 ? '+' : ''}${number(point.indexValue - 100, 2)}%)`;
      tooltip.style.left = `${Math.max(104, Math.min(plot.clientWidth - 104, x / width * plot.clientWidth))}px`;
      tooltip.style.top = `${y / 288 * plot.clientHeight}px`;
      tooltip.classList.toggle('is-below', y < 85);
    }
    function hide() {
      if (document.activeElement === plot) return;
      crosshair.setAttribute('visibility', 'hidden'); marker.setAttribute('visibility', 'hidden');
      tooltip.hidden = true;
    }
    function showNear(clientX) {
      const x = (clientX - plot.getBoundingClientRect().left) / plot.clientWidth * width;
      const time = start + (Math.max(left, Math.min(right, x)) - left) / (right - left) * (end - start);
      let closest = 0;
      for (let index = 1; index < series.length; index++) {
        if (Math.abs(series[index].time - time) < Math.abs(series[closest].time - time)) closest = index;
      }
      show(closest);
    }
    plot.addEventListener('pointerdown', event => showNear(event.clientX));
    plot.addEventListener('pointermove', event => {
      chartPointer = { x: event.clientX, y: event.clientY };
      showNear(event.clientX);
    });
    plot.addEventListener('pointerleave', () => { chartPointer = null; hide(); });
    plot.addEventListener('focus', () => show(selected));
    plot.addEventListener('blur', hide);
    plot.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      show(event.key === 'Home' ? 0 : event.key === 'End' ? series.length - 1
        : selected + (event.key === 'ArrowRight' ? 1 : -1));
    });
    if (restoreFocus) plot.focus({ preventScroll: true });
    else if (chartPointer && document.elementFromPoint(chartPointer.x, chartPointer.y)?.closest('[data-market-plot]') === plot) {
      showNear(chartPointer.x);
    }
  }
  function updateHouseFilter(control) {
    if (currentAccountPage !== '/auction-house') return;
    const filter = control.dataset.houseFilter, value = control.value;
    if (!['view', 'type', 'seller', 'sort', 'search'].includes(filter)) return;
    const query = new URLSearchParams(location.search);
    const defaults = { view: 'browse', type: 'all', seller: 'all', sort: 'ends', search: '' };
    if (value === defaults[filter]) query.delete(filter); else query.set(filter, value);
    if (filter === 'view') tab = value;
    const caret = filter === 'search' ? control.selectionStart : null;
    const url = '/auction-house' + (query.size ? '?' + query : '');
    window.history[filter === 'search' ? 'replaceState' : 'pushState']({}, '', url);
    renderHouse();
    const replacement = accountContent.querySelector(`[data-house-filter="${filter}"]`);
    replacement?.focus({ preventScroll: true });
    if (caret !== null) replacement?.setSelectionRange(caret, caret);
  }
  document.addEventListener('change', event => {
    if (event.target.matches('select[data-house-filter]')) updateHouseFilter(event.target);
  });
  document.addEventListener('input', event => {
    if (event.target.matches('[data-house-filter="search"]')) updateHouseFilter(event.target);
  });
  document.addEventListener('submit', event => {
    if (event.target.matches('.house-filters')) event.preventDefault();
  });
  document.addEventListener('click', event => {
    if (currentAccountPage !== '/auction-house' || !event.target.closest('[data-house-clear]')) return;
    const query = new URLSearchParams(location.search);
    for (const filter of ['type', 'seller', 'sort', 'search', 'stock', 'palette']) query.delete(filter);
    window.history.pushState({}, '', '/auction-house' + (query.size ? '?' + query : ''));
    renderHouse();
    accountContent.querySelector('[data-house-filter="type"]')?.focus({ preventScroll: true });
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-economy]');
    if (!button) return;
    const action = button.dataset.economy, id = button.dataset.id;
    if (action === 'close') { dialog.close(); return; }
    if (action === 'gallery') {
      const image = dialog.querySelector('[data-auction-main-image]'), caption = dialog.querySelector('[data-auction-caption]');
      if (image) { image.src = button.dataset.src; image.alt = button.dataset.alt; }
      if (caption) caption.textContent = button.dataset.alt;
      dialog.querySelectorAll('[data-economy="gallery"]').forEach(entry => entry.setAttribute('aria-pressed', String(entry === button)));
      return;
    }
    if (busy) return;
    const visit = accountVisit,viewerId=account?.id;
    try {
      if (action === 'tab') { tab = id; const query = new URLSearchParams(location.search); query.set('view', id); window.history.replaceState({}, '', currentAccountPage + '?' + query); render(); accountContent.querySelector(`.marketplace-tabs [data-id="${id}"]`)?.focus(); }
      if (action === 'lot-type') { const query = new URLSearchParams(location.search); query.set('type',id); window.history.replaceState({},'',currentAccountPage+'?'+query); render(); accountContent.querySelector(`[data-economy="lot-type"][data-id="${id}"]`)?.focus(); }
      if (action === 'lot-seller') { const query = new URLSearchParams(location.search); query.set('seller',id); window.history.replaceState({},'',currentAccountPage+'?'+query); render(); accountContent.querySelector(`[data-economy="lot-seller"][data-id="${id}"]`)?.focus(); }
      if (action === 'archive') { archiveOpen = !archiveOpen; render(); accountContent.querySelector('[data-economy="archive"]')?.focus({ preventScroll: true }); }
      if (action === 'category' || action === 'market-range') {
        if (action === 'market-range') {
          if (!marketRanges.some(([range]) => range === id)) return;
          marketRange = id;
        } else category = id;
        chartSelectionTime = null; chartPointer = null; history = []; historyLoading = true;
        window.history.replaceState({}, '', `/market?category=${encodeURIComponent(category)}&range=${marketRange}`);
        renderMarket(); await loadHistory(category);
        accountContent.querySelector(`[data-economy="${action}"][data-id="${id}"]`)?.focus({ preventScroll: true });
      }
      if (action === 'list') { caseReveal.close(); window.inventoryItemUi?.stop(); listingDialog(id); }
      if (action === 'quick-list') {
        // One-click listing at the inventory card's default start price, one
        // item, same 15-minute duration the listing dialog pre-selects.
        const owner=account?.id,item=accountItems.find(entry=>entry.id===id);
        if(!owner||!economyFlags.resales||currentAccountPage!=='/inventory'||!item||item.listed||item.storeId)return;
        busy = true; button.disabled = true;
        const result = await api.listItem({ inventoryId: id, quantity: 1,
          startPrice: Math.max(1,Math.round((item.estimatedValueTokens??item.sellValue??item.price??0)*.7)),
          endsAt: new Date(Date.now() + 900_000).toISOString() });
        if (visit !== accountVisit||owner!==account?.id) return;
        updateAccount(result.user);
        const inventory = await accountApi('inventory');
        if (visit !== accountVisit||owner!==account?.id) return;
        accountItems = inventory.items;
        renderAccountPage();
        if(!document.querySelector('.inventory-item-dialog[open]'))window.inventoryItemUi?.focus(id);
        showToast(t(`Auction started at ${justizEuro(result.listing.startPrice)}.`, `Auktion bei ${justizEuro(result.listing.startPrice)} gestartet.`));
      }
      if (action === 'primary' || action === 'resale') await showLot(id, action === 'primary');
      if (action === 'reveal') { busy = true; await startReveal(id); }
      if (action === 'next-reward') { busy = true; await revealNext(); }
      if (action === 'cancel') {
        busy = true; button.disabled = true;
        const result = await api.cancelListing(id);
        if (visit !== accountVisit) return;
        updateAccount(result.user); busy = false; await refresh(currentAccountPage, visit, true);
      }
    } catch (error) { if(visit===accountVisit&&viewerId===account?.id){
      if(action==='quick-list'){try{const inventory=await accountApi('inventory');if(visit===accountVisit&&viewerId===account?.id){accountItems=inventory.items;renderAccountPage();}}catch{}}
      if(visit===accountVisit&&viewerId===account?.id)showToast(error.message);
    } }
    finally { if (visit === accountVisit) busy = false; if (button.isConnected) button.disabled = false; }
  });
  // Lot cards are role="button" articles; Enter and Space activate them like
  // the view buttons they replaced. Real controls inside keep their own keys.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('button, a, input, select, textarea')) return;
    const card = event.target.closest('.economy-lot[data-economy], .house-lot[data-economy]');
    if (!card) return;
    event.preventDefault();
    card.click();
  });
  document.addEventListener('input', event => {
    const form = event.target.closest('.auction-bid-form');
    if (form && event.target.name === 'amount') validateBidForm(form);
  });
  document.addEventListener('click', event => {
    const minimum = event.target.closest('[data-bid-minimum]');
    if (!minimum || minimum.disabled || busy) return;
    const form = minimum.closest('form'), input = form.querySelector('input[name="amount"]');
    input.value = input.min; validateBidForm(form); input.focus();
  });
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.matches('[data-economy-form]')) return;
    event.preventDefault(); if (busy) return;
    const bidding = form.matches('.auction-bid-form');
    if (bidding && !validateBidForm(form, true)) return;
    busy = true;
    const visit = accountVisit, owner = account?.id, request = dialogSequence;
    const button = form.querySelector('button[type="submit"]'), buttonLabel = button.textContent; button.disabled = true;
    if (bidding) {
      button.textContent = t('Saving…', 'Wird gespeichert…'); form.setAttribute('aria-busy', 'true');
      form.querySelector('input[name="amount"]').readOnly = true;
      form.querySelector('[data-bid-minimum]').disabled = true;
    }
    try {
      const fields = new FormData(form), amount = Number(fields.get('amount')), id = form.dataset.id, type = form.dataset.economyForm;
      const result = type === 'list' ? await api.listItem({ inventoryId: id, quantity: Number(fields.get('quantity')), startPrice: amount, endsAt: new Date(Date.now() + Number(fields.get('duration'))).toISOString() })
        : type === 'primary' ? await api.paletteAuctionBid(id, amount) : await api.resaleBid(id, amount);
      if (visit !== accountVisit || account?.id !== owner) return;
      updateAccount(result.user); busy = false;
      if (type === 'list') {
        dialog.close();
        const inventory=await accountApi('inventory');
        if(visit!==accountVisit||owner!==account?.id)return;
        accountItems=inventory.items;renderAccountPage();window.inventoryItemUi?.focus(id);
        showToast(t('Listed for auction.','Zur Auktion angeboten.'));
      }
      else {
        await refresh(currentAccountPage, visit, true);
        if (visit !== accountVisit || owner !== account?.id) return;
        if (request === dialogSequence && dialog.open) await showLot(id, type === 'primary');
        showToast((type === 'primary' ? result.auction.bidding.leading : result.listing.currentBidderId === owner)
          ? t(`Maximum saved: ${justizEuro(amount)}.`, `Höchstgebot gespeichert: ${justizEuro(amount)}.`)
          : t('An existing maximum beat your offer. No J€ reserved.', 'Ein bestehendes Höchstgebot hat dein Gebot überboten. Keine J€ hinterlegt.'));
      }
    } catch (error) {
      if (visit === accountVisit && owner === account?.id && request === dialogSequence) {
        // A competing bid can change limits after validation. Refresh the
        // bounds, preserve the draft, and let the player explicitly retry.
        if (bidding && ['bid_too_low', 'insufficient_tokens', 'auction_ended', 'palette_auction_ended'].includes(error.code)) {
          try {
            const current = form.dataset.economyForm === 'primary' ? await api.paletteAuction(form.dataset.id) : await api.resale(form.dataset.id);
            if (visit !== accountVisit || owner !== account?.id || request !== dialogSequence) return;
            const lot = current?.auction || current?.listing;
            if (lot) {
              updateBidForm(lot, form.dataset.economyForm === 'primary', form);
              const facts = dialog.querySelector('[data-live-facts]');
              if (facts) facts.innerHTML = bidFacts(lot, form.dataset.economyForm === 'primary');
            }
          } catch { /* Preserve the original submission error if refresh fails. */ }
        }
        if (!bidding || validateBidForm(form, true)) form.querySelector('.account-error').textContent = error.message;
      }
    } finally {
      if (visit === accountVisit) busy = false;
      if (button.isConnected) {
        button.textContent = bidding ? Number(form.dataset.bidReserved) ? t('Raise maximum', 'Höchstgebot erhöhen') : t('Place bid', 'Gebot abgeben') : buttonLabel;
        form.removeAttribute('aria-busy');
        button.disabled = bidding ? form.querySelector('input[name="amount"]').disabled : false;
        if (bidding) {
          form.querySelector('input[name="amount"]').readOnly = false;
          form.querySelector('[data-bid-minimum]').disabled = button.disabled;
        }
      }
    }
  });
  return { isRoute: path => Boolean(routes[path]), load, render, stop };
})();
