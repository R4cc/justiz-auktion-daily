// Player-facing views share account routing, translation, cards and the case reel.
function progressionMarkup(p) {
  if (!p) return '';
  return `<section class="progression"><div><div class="section-title-row"><h2>${t('Level', 'Level')} ${p.level}</h2>${infoTip(t('Daily awards 150 XP. Successful marketplace sales award 10–200 XP.', 'Daily bringt 150 XP. Erfolgreiche Marktplatzverkäufe bringen 10–200 XP.'), t('How to earn XP', 'So verdienst du XP'))}</div><span>${number(p.xp)} XP</span></div>
    <progress max="1" value="${p.progress}" aria-label="${t('Level progress', 'Levelfortschritt')}"></progress>
    <p>${p.nextLevelXp === null ? t('Level 20 reached', 'Level 20 erreicht') : t(`${number(p.nextLevelXp - p.xp)} XP to next level`, `${number(p.nextLevelXp - p.xp)} XP bis zum nächsten Level`)}</p></section>`;
}

window.economyUi = (() => {
  const api = window.justizEconomy, esc = accountEscape;
  const routes = { '/auctions': 'paletteAuctions', '/marketplace': 'resales', '/market': 'market' };
  const dialog = document.createElement('dialog');
  dialog.className = 'economy-dialog'; dialog.setAttribute('aria-labelledby', 'economy-dialog-title');
  document.body.append(dialog);
  let data = {}, tab = 'public', timer, clockTimer, sequence = 0, dialogSequence = 0, busy = false, archiveOpen = false;
  let category = null, history = [], historySequence = 0, reveal = null, revealPosition = 0, detailId = null, returnFocus;
  const name = lot => t(lot.name, lot.nameDe || lot.name);
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
  const bidHistory = bids => [...(bids || [])].sort((a, b) => a.createdAt - b.createdAt || String(a.id).localeCompare(String(b.id)))
    .map(bid => {
      const mine = account?.id === bid.bidderId;
      return `<li class="auction-chat-message${mine ? ' is-mine' : ''}"><div class="auction-chat-bubble"><span>${mine ? t('You', 'Du') : esc(bid.bidderUsername)}</span><strong>${justizEuro(bid.amount)}</strong><time>${date(bid.createdAt)}</time></div></li>`;
    }).join('') || `<li class="auction-chat-empty">${t('No bids yet. Be the first to raise the paddle.', 'Noch keine Gebote. Hebe als Erste:r die Bieterkelle.')}</li>`;
  const story = lot => ({ title: immersiveCopy(t(lot.story?.title || name(lot), lot.story?.titleDe || name(lot))),
    body: immersiveCopy(t(lot.story?.body || '', lot.story?.bodyDe || paletteStoryDe(lot.paletteId))) });
  function stop() {
    clearInterval(timer); clearInterval(clockTimer); sequence++; historySequence++; dialogSequence++;
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
    tab = path === '/auctions' ? 'public' : query.get('view') === 'mine' ? 'mine' : 'public';
    data = {}; history = []; category = query.get('category'); archiveOpen = false;
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
      if (!data.categories.some(c => c.category === category)) category = data.categories[0]?.category;
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
      if (lot?.bids && historyNode) {
        const followLatest = historyNode.scrollHeight - historyNode.scrollTop - historyNode.clientHeight < 40;
        historyNode.innerHTML = bidHistory(lot.bids);
        if (followLatest) historyNode.scrollTop = historyNode.scrollHeight;
      }
      const bidInput = dialog.querySelector('input[name="amount"]');
      if (lot && bidInput) {
        bidInput.min = String(lot.currentBid === null ? lot.reserve ?? lot.startPrice
          : lot.currentBid + (path === '/auctions' ? lot.bidIncrement ?? 1 : 1));
        if (document.activeElement !== bidInput && Number(bidInput.value) < Number(bidInput.min)) bidInput.value = bidInput.min;
        if (lot.status !== 'active' || lot.endsAt <= Date.now()) {
          const form = bidInput.closest('form');
          form.querySelector('button[type="submit"]').disabled = true;
          form.querySelector('.account-error').textContent = t('This auction has ended. Check your auction history.', 'Diese Auktion ist beendet. Sieh in deinem Auktionsverlauf nach.');
        }
      }
    }
  }
  function bidFacts(lot, primary) {
    return `<div class="economy-bid"><strong>${justizEuro(lot.currentBid ?? (primary ? lot.reserve : lot.startPrice))}</strong><span>${lot.currentBid === null ? t('Starting bid', 'Startgebot') : t('Current bid', 'Aktuelles Gebot')}</span></div>
      <p>${lot.bidCount} ${t('bids', 'Gebote')} · ${countdown(lot.endsAt)}</p>`;
  }
  function lotCard(lot, primary, view = '') {
    const image = primary ? null : lot.item.image;
    const participation = primary ? (data.mine || []).find(entry => entry.id === lot.id)
      : view === 'bid' ? lot : null;
    // Palettes raise in value-tiered steps (lot.bidIncrement); resale keeps J€ 1.
    const minimum = lot.currentBid === null ? lot.reserve : lot.currentBid + (primary ? lot.bidIncrement ?? 1 : 1);
    const eligible = account && (account.progression?.level || 1) >= lot.requiredLevel
      && account.tokens + (participation?.leading ? lot.currentBid : 0) >= minimum;
    const mine = view === 'mine-live' || view === 'mine-done';
    // Green border while the player leads (or has won), red while overbid.
    const borderState = primary && participation
      ? participation.leading || (participation.won && lot.status !== 'active') ? ' is-leading'
        : lot.status === 'active' ? ' is-outbid' : ''
      : !primary && view === 'bid' ? lot.leading ? ' is-leading' : ' is-outbid'
        : !primary && view === 'bid-done' ? lot.status === 'cancelled' ? ' is-ended' : lot.won ? ' is-leading' : ' is-outbid'
          : !primary && view === 'mine-live' ? ' is-owned' : !primary && view === 'mine-done' ? ' is-ended' : '';
    const resaleState = !primary ? view === 'mine-live' ? t('YOUR LISTING', 'DEIN ANGEBOT')
      : view === 'bid' ? lot.leading ? t('LEADING', 'DU FÜHRST') : t('OUTBID', 'ÜBERBOTEN')
        : view === 'bid-done' ? lot.status === 'cancelled' ? t('CANCELLED', 'STORNIERT')
          : lot.won ? t('WON', 'GEWONNEN') : t('LOST', 'VERLOREN')
        : view === 'mine-done' ? lot.status === 'cancelled' ? t('CANCELLED', 'STORNIERT')
          : lot.winnerId ? t('SOLD', 'VERKAUFT') : t('UNSOLD', 'NICHT VERKAUFT')
          : t('LIVE', 'LIVE') : '';
    const displayTitle = primary ? name(lot) : `${lot.quantity > 1 ? `${lot.quantity}× ` : ''}${lot.item.title}`;
    const compactOwned = !primary && view === 'mine-live';
    return `<article class="economy-lot${compactOwned ? ' economy-lot--compact-owned' : ''}${borderState}"><div class="economy-lot-image">${primary ? paletteArtwork(lot) : image ? `<img src="${esc(image)}" alt="" loading="lazy">` : '<span aria-hidden="true">◇</span>'}
      ${primary ? '' : `<span class="economy-badge">${esc(categoryName(lot.item.marketCategory))}</span><span class="auction-state-badge">${resaleState}</span>`}</div>
      <div class="economy-lot-body"><h2>${esc(displayTitle)}</h2>
      ${primary ? `<div class="palette-seal" aria-hidden="true"><span>01 ◇</span><span>02 ◇</span><span>03 ◇</span></div>`
        : compactOwned ? '' : `<p>${t('Seller', 'Verkäufer')}: ${esc(lot.sellerUsername)}</p><p>${t('Estimated market value', 'Geschätzter Marktwert')}: ${justizEuro(lot.estimatedValueTokens)}</p>`}
      ${bidFacts(lot, primary)}
      ${mine || view === 'bid' || view === 'bid-done' || (primary && participation) ? `<p class="economy-outcome">${primary ? lot.status === 'active' ? lot.leading ? t('You lead', 'Du führst') : t('Outbid', 'Überboten') : lot.won ? t('Won!', 'Gewonnen!') : t('Lost', 'Verloren') : view === 'bid' ? lot.leading ? t('You lead', 'Du führst') : t('You were outbid', 'Du wurdest überboten') : view === 'bid-done' ? lot.status === 'cancelled' ? t('Cancelled', 'Storniert') : lot.won ? t('You won', 'Du hast gewonnen') : t('You lost', 'Du hast verloren') : status(lot)}${primary ? ` · ${t('Your highest bid', 'Dein Höchstgebot')}: ${justizEuro(lot.highestBid)}` : view === 'bid' ? ` · ${t('Your highest bid', 'Dein Höchstgebot')}: ${justizEuro(lot.highestBid)}` : view === 'bid-done' ? ` · ${t('Your highest bid', 'Dein Höchstgebot')}: ${justizEuro(lot.highestBid)}${lot.winnerId ? ` · ${t('Final sale', 'Verkaufspreis')}: ${justizEuro(lot.currentBid)}` : ''}` : lot.winnerId ? ` · ${t('Final sale', 'Verkaufspreis')}: ${justizEuro(lot.currentBid)}` : ''}</p>` : ''}
      <button class="${primary && lot.revealAvailable ? 'primary-button' : 'secondary-button'}" data-economy="${primary ? 'primary' : 'resale'}" data-id="${esc(lot.id)}">${primary && lot.revealAvailable ? t('View winning palette', 'Gewonnene Palette ansehen') : primary && !eligible ? t('Explore palette', 'Palette ansehen') : t('View auction', 'Auktion ansehen')} →</button>
      ${!primary && view === 'mine-live' && lot.status === 'active' && !lot.bidCount ? `<button class="text-button" data-economy="cancel" data-id="${esc(lot.id)}">${t('Cancel listing', 'Angebot stornieren')}</button>` : ''}</div></article>`;
  }
  function marketplaceSection(title, eyebrow, lots, view, emptyText) {
    return `<section class="marketplace-section marketplace-section--${view}"><div class="auction-section-heading"><div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2></div><strong>${lots.length}</strong></div>
      ${lots.length ? `<div class="economy-grid">${lots.map(lot => lotCard(lot, false, view)).join('')}</div>` : `<p class="marketplace-empty">${emptyText}</p>`}</section>`;
  }
  // Small disclosure shared by both auction pages: finished lots (won, lost,
  // expired) leave the live sections and stay reachable here.
  const archiveToggle = count => `<button class="text-button archive-toggle" type="button" data-economy="archive" aria-expanded="${archiveOpen}">${archiveOpen ? t('Hide archived auctions', 'Archivierte Auktionen ausblenden') : t('Archived auctions', 'Archivierte Auktionen')} (${count})</button>`;
  function render() {
    const path = currentAccountPage;
    if (!economyFlags[routes[path]]) {
      accountContent.innerHTML = pageHeading(t('Unavailable', 'Nicht verfügbar')) + `<a href="/shop" data-page>${t('Visit the shop', 'Zum Shop')}</a>`;
      return;
    }
    if (path === '/market') { renderMarket(); return; }
    const primary = path === '/auctions';
    accountContent.innerHTML = pageHeading(primary ? t('Mystery Palette auctions', 'Mystery-Palette-Auktionen') : t('Marketplace', 'Marktplatz'),
      primary ? t('Bid on a sealed Mystery Palette. Win it, then reveal three finds. Play Daily and sell items to unlock more.', 'Biete auf eine versiegelte Mystery-Palette. Gewinne und entdecke drei Funde. Spiele Daily und verkaufe Lose für höhere Level.')
        : t('Sell matching items together in one auction — up to 5 active listings.', 'Verkaufe passende Gegenstände gemeinsam in einer Auktion — höchstens 5 aktive Angebote.')) + economyOverviewMarkup();
    if (primary) {
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
        accountContent.innerHTML += `<section class="my-bids-board"><div class="auction-section-heading"><div><p class="eyebrow">${t('YOUR AUCTIONS', 'DEINE AUKTIONEN')}</p><h2>${t('My bids', 'Meine Gebote')}</h2></div><strong>${myBoard.length}</strong></div>
          ${myBoard.length ? `<div class="economy-grid">${myBoard.map(lot => lotCard(lot, true)).join('')}</div>` : `<p class="my-bids-empty">${t('You have not placed a bid yet.', 'Du hast noch kein Gebot abgegeben.')}</p>`}
          ${myArchived.length ? archiveToggle(myArchived.length) : ''}
          ${myArchived.length && archiveOpen ? `<div class="auction-section-heading archive-heading"><div><p class="eyebrow">${t('ARCHIVE', 'ARCHIV')}</p><h2>${t('Archived auctions', 'Archivierte Auktionen')}</h2></div><strong>${myArchived.length}</strong></div>
          <div class="economy-grid">${myArchived.map(lot => lotCard(lot, true)).join('')}</div>` : ''}</section>`;
      }
      if (paletteFilter) accountContent.innerHTML += `<p>${t('Related to your story', 'Passend zu deiner Geschichte')}: <strong>${esc(paletteName(paletteFilter))}</strong> <a href="/auctions" data-page>${t('Show all auctions', 'Alle Auktionen anzeigen')} →</a></p>`;
      accountContent.innerHTML += `<div class="auction-section-heading live-auctions-heading"><div><p class="eyebrow">${t('AUCTION FLOOR', 'AUKTIONSHALLE')}</p><h2>${t('Live auctions', 'Laufende Auktionen')}</h2></div><strong>${liveLots.length}</strong></div>`;
      accountContent.innerHTML += liveLots.length
        ? `<div class="economy-grid">${liveLots.map(lot => lotCard(lot, true)).join('')}</div>`
        : empty(t('No other auctions right now.', 'Aktuell keine weiteren Auktionen.'));
      return;
    }
    const own = data.mine || [], bidLots = data.bids || [];
    const myLive = own.filter(lot => lot.status === 'active');
    const myDone = own.filter(lot => lot.status !== 'active');
    const separatedIds = new Set([...myLive, ...bidLots].map(lot => lot.id));
    const otherLive = (data.lots || []).filter(lot => lot.sellerId !== account?.id && !separatedIds.has(lot.id));
    if (account) accountContent.innerHTML += marketplaceSection(t('My live auctions', 'Meine laufenden Auktionen'), t('SELLING', 'VERKAUF'), myLive, 'mine-live', t('You have no live listings.', 'Du hast keine laufenden Angebote.'));
    accountContent.innerHTML += marketplaceSection(t("Other players' live auctions", 'Laufende Auktionen anderer'), t('BROWSE', 'ENTDECKEN'), otherLive, 'other', t('No other live auctions right now.', 'Aktuell keine weiteren laufenden Auktionen.'));
    if (account) {
      accountContent.innerHTML += marketplaceSection(t('My current bids', 'Meine aktuellen Gebote'), t('BUYING', 'KAUF'), bidLots, 'bid', t('You have no active marketplace bids.', 'Du hast keine aktiven Marktplatzgebote.'));
      const archivedBids = data.archivedBids || [];
      const archiveCount = archivedBids.length + myDone.length;
      if (archiveCount) {
        accountContent.innerHTML += archiveToggle(archiveCount);
        if (archiveOpen) {
          accountContent.innerHTML += `<div class="marketplace-archive">${archivedBids.length ? marketplaceSection(t('Archived bids', 'Archivierte Gebote'), t('BUYING HISTORY', 'KAUFVERLAUF'), archivedBids, 'bid-done', t('Nothing archived yet.', 'Noch nichts archiviert.')) : ''}
            ${myDone.length ? marketplaceSection(t('My completed auctions', 'Meine beendeten Auktionen'), t('SELLING HISTORY', 'VERKAUFSVERLAUF'), myDone, 'mine-done', t('Completed listings will appear here.', 'Beendete Angebote erscheinen hier.')) : ''}</div>`;
        }
      }
    }
  }
  function bidForm(lot, primary) {
    if (!account) return `<a href="/login" data-page>${t('Log in to bid', 'Zum Bieten anmelden')}</a>`;
    if (lot.status !== 'active' || lot.endsAt <= Date.now()) return `<p>${status(lot)}</p>`;
    if (!primary && lot.sellerId === account.id) return `<p>${t('This is your listing.', 'Dies ist dein Angebot.')}</p>`;
    if (primary && account.progression.level < lot.requiredLevel) return `<p>${accountError('level_required')}</p>`;
    const min = lot.currentBid === null ? primary ? lot.reserve : lot.startPrice
      : lot.currentBid + (primary ? lot.bidIncrement ?? 1 : 1);
    const hasBid = lot.currentBid !== null;
    return `<form data-economy-form="${primary ? 'primary' : 'resale'}" data-id="${esc(lot.id)}" class="economy-form auction-bid-form"><label>${t('Your bid in J€', 'Dein Gebot in J€')}
      <span class="auction-bid-entry"><input name="amount" type="number" inputmode="numeric" min="${min}" step="1" value="${min}" required><button class="primary-button" type="submit">${hasBid ? t('Raise bid', 'Gebot erhöhen') : t('Place bid', 'Gebot abgeben')}</button></span></label><p>${t('Available wallet balance', 'Verfügbares Guthaben')}: <strong>${justizEuro(account.tokens)}</strong> ${infoTip(t('Your bid is held until you are outbid or the auction settles.', 'Dein Gebot wird bis zum Überbieten oder zur Abrechnung hinterlegt.'), t('How bidding affects your balance', 'Auswirkung auf dein Guthaben'))}</p>
      <p class="account-error" role="alert"></p></form>`;
  }
  function paletteArtwork(lot) {
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
    if (primary) return `${paletteArtwork(lot)}<p class="palette-mystery-caption">${t('Sealed until your winning reveal.', 'Versiegelt bis zur Aufdeckung deines Gewinns.')}</p>`;
    const items = [lot.item];
    const images = items.filter(item => item?.image);
    if (!images.length) return `<div class="auction-room-placeholder" aria-hidden="true">◇</div>`;
    const first = images[0];
    return `<figure class="auction-room-main-image"><img data-auction-main-image src="${esc(first.image)}" alt="${esc(first.title || '')}"><figcaption data-auction-caption>${esc(first.title || '')}</figcaption></figure>
      ${images.length > 1 ? `<div class="auction-room-thumbs" role="group" aria-label="${primary ? t('Sealed palette illustration', 'Illustration der versiegelten Palette') : t('Auction pictures', 'Auktionsbilder')}">${images.map((item, index) => `<button type="button" data-economy="gallery" data-src="${esc(item.image)}" data-alt="${esc(item.title || '')}" aria-pressed="${index === 0}" aria-label="${esc(item.title || t('Auction picture', 'Auktionsbild'))}"><img src="${esc(item.image)}" alt=""></button>`).join('')}</div>` : ''}`;
  }
  function auctionContents(lot) {
    return `<div class="auction-room-contents">${infoTip(t('The palette contains three mystery finds, revealed one by one after winning. Duplicates are possible.', 'Die Palette enthält drei geheime Funde, die nach dem Gewinn einzeln aufgedeckt werden. Doppelte Funde sind möglich.'), t('What is inside?', 'Was ist enthalten?'))}</div>`;
  }
  async function showLot(id, primary) {
    const request = ++dialogSequence, visit = accountVisit;
    const result = primary ? await api.paletteAuction(id) : await api.resale(id);
    if (request !== dialogSequence || visit !== accountVisit) return;
    const lot = primary ? result?.auction : result?.listing;
    if (!lot) throw new Error(accountError('auction_not_found'));
    const participation = primary ? (data.mine || []).find(entry => entry.id === lot.id) : null;
    if (participation) Object.assign(lot, { won: participation.won, leading: participation.leading,
      highestBid: participation.highestBid, revealAvailable: participation.revealAvailable });
    detailId = id;
    const title = primary ? name(lot) : `${lot.quantity > 1 ? `${lot.quantity}× ` : ''}${lot.item.title}`;
    const winAction = primary && lot.revealAvailable ? `<div class="auction-win-panel"><h3>${t('Won palette', 'Gewonnene Palette')}</h3><div class="palette-seal" aria-hidden="true"><span>01 ◇</span><span>02 ◇</span><span>03 ◇</span></div><button class="primary-button" data-economy="reveal" data-id="${esc(lot.id)}">${t('Reveal three finds', 'Drei Funde aufdecken')} →</button></div>` : bidForm(lot, primary);
    openDialog(`<div class="auction-room"><section class="auction-room-media" aria-label="${primary ? t('Sealed palette illustration', 'Illustration der versiegelten Palette') : t('Auction pictures', 'Auktionsbilder')}">${auctionMedia(lot, primary)}</section>
      <section class="auction-room-story"><p class="eyebrow">${primary ? t('SEALED · THREE FINDS', 'VERSIEGELT · DREI FUNDE') : t('PLAYER MARKETPLACE', 'SPIELERMARKTPLATZ')}</p><h2 id="economy-dialog-title" tabindex="-1">${esc(title)}</h2>
      ${primary ? `<h3>${esc(story(lot).title)}</h3><p>${esc(story(lot).body)}</p><p class="auction-room-meta">${t('Required level', 'Benötigtes Level')} <strong>${lot.requiredLevel}</strong><br>${esc((lot.allowedMarketCategories || []).map(categoryName).join(' · ') || categoryName(null))}</p>${auctionContents(lot)}` : `<p class="auction-room-meta">${t('Seller', 'Verkäufer')}: <strong>${esc(lot.sellerUsername)}</strong><br>${t('Quantity', 'Anzahl')}: <strong>${lot.quantity}</strong><br>${t('Auction value', 'Auktionswert')}: <strong>${euro(lot.item.price * lot.quantity)}</strong><br>${t('Estimated market value', 'Geschätzter Marktwert')}: <strong>${justizEuro(lot.estimatedValueTokens)}</strong></p>`}
      </section><aside class="auction-room-bidding"><header><p class="eyebrow">${t('LIVE AUCTION', 'LIVE-AUKTION')}</p><h3>${t('Bid room', 'Bietraum')}</h3></header><div data-live-facts>${bidFacts(lot, primary)}</div>
      <ol class="auction-chat" data-live-history role="log" aria-label="${t('Bid history', 'Gebotsverlauf')}">${bidHistory(lot.bids)}</ol><div class="auction-bid-dock">${winAction}</div></aside></div>`);
    const historyNode = dialog.querySelector('[data-live-history]');
    if (historyNode) historyNode.scrollTop = historyNode.scrollHeight;
  }
  function listingDialog(id) {
    const group = groupedInventory(accountItems).find(entry => entry.copies.some(copy => copy.id === id));
    const available = group?.copies.filter(copy => !copy.listed) || [];
    const item = available.find(copy => copy.id === id) || available[0];
    if (!item || !economyFlags.resales) return;
    const quantity = available.length;
    openDialog(`<h2 id="economy-dialog-title" tabindex="-1">${t('List for auction', 'Zur Auktion anbieten')}</h2><p>${esc(item.title)}</p><p>${t('Estimated market value', 'Geschätzter Marktwert')}: ${justizEuro(item.estimatedValueTokens * quantity)}</p>
      <form data-economy-form="list" data-id="${esc(item.id)}" class="economy-form"><label>${t('Quantity', 'Anzahl')} · ${quantity} ${t('available', 'verfügbar')}<input name="quantity" type="number" inputmode="numeric" min="1" max="${quantity}" step="1" value="${quantity}" required></label><label>${t('Starting price in J€', 'Startpreis in J€')}<input name="amount" type="number" inputmode="numeric" min="1" step="1" value="${Math.max(1, Math.round(item.estimatedValueTokens * quantity * .7))}" required></label>
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
    openDialog(`<h2 id="economy-dialog-title" tabindex="-1">${t('Find', 'Fund')} ${revealPosition + 1} / 3</h2><div class="reveal-steps" aria-hidden="true">${[0, 1, 2].map(i => `<span class="${i <= revealPosition ? "is-current" : ""}">${i < revealPosition ? "✓" : i + 1}</span>`).join("")}</div><div class="case-window" aria-hidden="true"><div class="case-marker"></div><div class="case-reel"></div></div><div class="palette-result" role="status">${t('Revealing…', 'Wird aufgedeckt …')}</div>`);
    const valid = () => request === dialogSequence && visit === accountVisit && dialog.open && reveal === fixed;
    await spinCaseReel(dialog.querySelector('.case-reel'), dialog.querySelector('.case-window'), reward, fixed.pool, valid);
    if (!valid()) return;
    revealPosition++;
    dialog.querySelector('.palette-result').innerHTML = `<div class="palette-find rarity-${esc(reward.rarity)}"><img src="${esc(reward.image || '')}" alt=""><p class="rarity-label">${rarityLabel(reward.rarity)}</p><h3>${esc(reward.title)}</h3><p>${t('Auction value', 'Auktionswert')}: ${euro(reward.price)}</p></div><button class="primary-button" data-economy="next-reward">${revealPosition === 3 ? t('View summary', 'Zusammenfassung') : t('Reveal next find', 'Nächsten Fund aufdecken')} →</button>`;
    dialog.querySelector('[data-economy="next-reward"]').focus({ preventScroll: true });
  }
  function revealSummary(fixed) {
    const entries = fixed.rewards.map(r => ({ title: r.item.title, value: Math.max(1, Math.round(r.item.price)) }));
    const totalValue = entries.reduce((sum, entry) => sum + entry.value, 0);
    const value = fixed.rewards.reduce((sum, r) => sum + r.item.price, 0);
    const difference = totalValue - fixed.bundleCostTokens;
    const verdict = difference > 0 ? { label: t('Profit', 'Gewinn'), className: 'is-profit' }
      : difference < 0 ? { label: t('Loss', 'Verlust'), className: 'is-loss' }
      : { label: t('Break-even', 'Ausgeglichen'), className: 'is-even' };
    openDialog(`<h2 id="economy-dialog-title" tabindex="-1">${t('Three finds. Yours.', 'Drei Funde. Deine.')}</h2><div class="inventory-grid">${fixed.rewards.map(r => itemCard({ ...r.item, sellValue: Math.max(1, Math.round(r.item.price)) }, false)).join('')}</div>
      <div class="palette-ledger"><p class="eyebrow">${t('The tally', 'Die Abrechnung')}</p>
      ${entries.map(entry => `<div class="palette-ledger-row"><span>${esc(entry.title)}</span><b>+${justizEuro(entry.value)}</b></div>`).join('')}
      <div class="palette-ledger-row is-total"><span>${t('Total finds value', 'Gesamtwert der Funde')} <small>(${euro(value)})</small></span><b>${justizEuro(totalValue)}</b></div>
      <div class="palette-ledger-row"><span>${t('Winning bid', 'Gewinngebot')}</span><b>−${justizEuro(fixed.bundleCostTokens)}</b></div>
      <div class="palette-ledger-verdict ${verdict.className}"><span>${verdict.label}</span><strong>${difference > 0 ? '+' : difference < 0 ? '−' : ''}${justizEuro(Math.abs(difference))}</strong></div>
      <div class="palette-ledger-note">${infoTip(t('Historical values are not guaranteed sale prices. Your finds are already in your inventory.', 'Historische Werte sind keine garantierten Verkaufspreise. Deine Funde liegen bereits im Inventar.'), t('About this estimate', 'Über diese Schätzung'))}</div></div>
      <a class="primary-button" href="/inventory" data-page>${t('Go to inventory', 'Zum Inventar')} →</a>`);
  }
  async function loadHistory(id, visit = accountVisit, repaint = true) {
    if (!id) return;
    const request = ++historySequence;
    const result = await api.marketHistory(id);
    if (request !== historySequence || visit !== accountVisit || category !== id) return;
    if (!result) throw new Error(t('History could not be loaded. Try selecting the category again.', 'Der Verlauf konnte nicht geladen werden. Wähle die Kategorie erneut.'));
    history = result.history || [];
    if (repaint) renderMarket();
  }
  function renderMarket() {
    const categories = data.categories || [], selected = categories.find(c => c.category === category);
    accountContent.innerHTML = pageHeading(t('Market', 'Markt'), t('100 is neutral. Above 100 means stronger demand; below 100 means weaker demand. Market movement changes buyer valuations.', '100 ist neutral. Darüber ist die Nachfrage stärker, darunter schwächer. Marktbewegungen verändern Käuferbewertungen.')) + economyOverviewMarkup() +
      `<section class="market-guidance"><div class="section-title-row"><h2>${t("Sell now or hold?", "Jetzt verkaufen oder behalten?")}</h2>${infoTip(t("Above-normal markets support higher estimates. Below normal, waiting may help, but recovery is never guaranteed. Bids decide the final price.", "Über Normalwert steigen die Schätzwerte. Darunter kann Warten helfen, eine Erholung ist aber nie garantiert. Gebote bestimmen den Verkaufspreis."), t('How to use the market', 'So nutzt du den Markt'))}</div><a href="/inventory" data-page>${t("Inventory", "Inventar")} →</a></section><div class="market-categories">${categories.map(c => `<button data-economy="category" data-id="${c.category}" aria-pressed="${category === c.category}"><span>${esc(t(c.name, c.nameDe))}</span><strong>${number(c.currentIndex, 2)} ${c.currentIndex > 100 ? '↑' : c.currentIndex < 100 ? '↓' : '→'}</strong><small>${c.currentIndex >= 100 ? '+' : ''}${number(c.currentIndex - 100, 2)}% ${c.currentIndex > 100 ? t('above normal', 'über Normalwert') : c.currentIndex < 100 ? t('below normal', 'unter Normalwert') : t('normal value', 'Normalwert')}</small><time>${date(c.updatedAt)}</time></button>`).join('')}</div>
      <section class="market-chart"><div class="section-title-row"><h2>${esc(selected ? t(selected.name, selected.nameDe) : '')}</h2>${infoTip(t('Hourly history uses index points from 70–130. The dashed line is neutral 100.', 'Der stündliche Verlauf nutzt Indexpunkte von 70–130. Die gestrichelte Linie ist der neutrale Wert 100.'), t('About this chart', 'Über dieses Diagramm'))}</div>${selected ? `<p><strong>${number(selected.currentIndex, 2)}</strong> · ${number(Math.abs(selected.currentIndex - 100), 2)}% ${selected.currentIndex > 100 ? t('above normal', 'über Normalwert') : selected.currentIndex < 100 ? t('below normal', 'unter Normalwert') : t('from normal', 'vom Normalwert')}</p>` : ''}${chart(history)}</section>`;
    const chartSection = accountContent.querySelector('.market-chart');
    const categoryGrid = accountContent.querySelector('.market-categories');
    if (chartSection && categoryGrid) accountContent.insertBefore(chartSection, categoryGrid);
  }
  function chart(points) {
    if (!points.length) return empty(t('History will appear as the market starts collecting data.', 'Der Verlauf erscheint, sobald der Markt Daten sammelt.'));
    const sorted = [...points].reverse(), start = Date.parse(sorted[0].capturedAt), end = Date.parse(sorted.at(-1).capturedAt);
    const line = sorted.map(p => `${35 + 630 * (Date.parse(p.capturedAt) - start) / Math.max(1, end - start)},${220 - (p.indexValue - 70) / 60 * 200}`).join(' ');
    return `<svg viewBox="0 0 700 260" role="img" aria-label="${t('Market index over time', 'Marktindex im Zeitverlauf')}"><text x="0" y="24">130</text><text x="0" y="124">100</text><text x="8" y="224">70</text><path d="M35 120H670" stroke="currentColor" stroke-dasharray="5 5" opacity=".35"/><polyline points="${line}" fill="none" stroke="currentColor" stroke-width="3"/>${sorted.map(p => `<circle cx="${35 + 630 * (Date.parse(p.capturedAt) - start) / Math.max(1, end - start)}" cy="${220 - (p.indexValue - 70) / 60 * 200}" r="3" fill="currentColor"/>`).join("")}<text x="35" y="250">${esc(new Date(start).toLocaleDateString(uiLocale()))}</text><text x="665" y="250" text-anchor="end">${esc(new Date(end).toLocaleDateString(uiLocale()))}</text></svg><details><summary>${t("Read history as a table", "Verlauf als Tabelle lesen")}</summary><div class="market-history-table"><table><thead><tr><th>${t("Time", "Zeit")}</th><th>Index</th></tr></thead><tbody>${sorted.map(p => `<tr><td>${date(p.capturedAt)}</td><td>${number(p.indexValue, 2)}</td></tr>`).join("")}</tbody></table></div></details>`;
  }
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
    const visit = accountVisit;
    try {
      if (action === 'tab') { tab = id; const query = new URLSearchParams(location.search); query.set('view', id); window.history.replaceState({}, '', currentAccountPage + '?' + query); render(); accountContent.querySelector(`[data-id="${id}"]`)?.focus(); }
      if (action === 'archive') { archiveOpen = !archiveOpen; render(); accountContent.querySelector('[data-economy="archive"]')?.focus({ preventScroll: true }); }
      if (action === 'category') { category = id; window.history.replaceState({}, '', '/market?category=' + encodeURIComponent(id)); await loadHistory(id); accountContent.querySelector(`[data-id="${id}"]`)?.focus({ preventScroll: true }); }
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
      const result = type === 'list' ? await api.listItem({ inventoryId: id, quantity: Number(fields.get('quantity')), startPrice: amount, endsAt: new Date(Date.now() + Number(fields.get('duration'))).toISOString() })
        : type === 'primary' ? await api.paletteAuctionBid(id, amount) : await api.resaleBid(id, amount);
      if (visit !== accountVisit || account?.id !== owner) return;
      updateAccount(result.user); busy = false;
      if (type === 'list') { dialog.close(); await navigateAccountPage('/marketplace'); }
      else {
        await refresh(currentAccountPage, visit, true);
        if (visit !== accountVisit || owner !== account?.id) return;
        if (request === dialogSequence && dialog.open) await showLot(id, type === 'primary');
        showToast(t('Bid placed. Your J€ are held in escrow.', 'Gebot abgegeben. Deine J€ sind hinterlegt.'));
      }
    } catch (error) { if (visit === accountVisit) form.querySelector('.account-error').textContent = error.message; }
    finally { if (visit === accountVisit) busy = false; if (button.isConnected) button.disabled = false; }
  });
  return { isRoute: path => Boolean(routes[path]), load, render, stop };
})();
