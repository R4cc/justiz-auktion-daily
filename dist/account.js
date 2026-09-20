let account = null, accountCatalog = null, accountItems = [], accountCodes = [], freshCodes = [];
let accountFriends = { friends: [], date: '' }, accountAdmin = { playerCount: 0, users: [], grants: [], lastReset: null };
let accountLeaderboard = { date: '', leaders: [] }, adminUserFilter = '';
let accountNotifications = [], notificationUnreadCount = 0, notificationOwner = null, notificationTimer = null, notificationBusy = false, notificationRequest = 0;
let accountAuctions = { query: '', page: 1, pages: 1, total: 0, auctions: [] }, auctionSearchTimer = null;
const auctionReveal = document.createElement('dialog');
auctionReveal.className = 'auction-reveal';
auctionReveal.setAttribute('aria-labelledby', 'auction-detail-title');
document.body.append(auctionReveal);
let accountBusy = false, accountDailyRun = null, accountResult = null;
let caseOpening = null;
const caseReveal = document.createElement('dialog');
caseReveal.className = 'case-reveal';
caseReveal.setAttribute('aria-labelledby', 'case-reveal-title');
document.body.append(caseReveal);
caseReveal.addEventListener('close', () => {
  if (currentAccountPage === '/shop') accountContent.querySelector('[data-account="pull"]')?.focus({ preventScroll: true });
});
let accountSelectedCase = 'fundkiste', accountInventoryPage = 0, accountFilter = 'all';
let currentAccountPage = null, accountVisit = 0, pageLoaded = false;
const accountPaths = ['/auctions', '/marketplace', '/market', '/shop', '/inventory', '/profile', '/login', '/register', '/admin', '/leaderboard'];
const accountPage = document.querySelector('#account-page');
const accountContent = document.querySelector('#account-content');
const notificationButton = document.querySelector('#notification-button');
const notificationPanel = document.querySelector('#notification-panel');
const notificationList = notificationPanel.querySelector('.notification-list');
const notificationToasts = document.querySelector('#notification-toasts');
const accountEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function accountError(code) {
  const errors = {
    listing_limit: t('You can have at most 5 active listings. Wait for one to end or cancel an unbid listing.', 'Du kannst höchstens 5 aktive Angebote haben. Warte auf ein Ende oder storniere ein Angebot ohne Gebote.'),
    instant_sell_disabled: t('List this item on the marketplace to sell it.', 'Biete diesen Gegenstand auf dem Marktplatz an.'),
    level_required: t('Your level is too low for this palette. Complete Daily games and sell items to earn XP.', 'Dein Level ist für diese Palette zu niedrig. Spiele Daily und verkaufe Gegenstände für XP.'),
    palette_auction_ended: t('This auction has ended. Check My bids.', 'Diese Auktion ist beendet. Sieh unter Meine Gebote nach.'),
    rewards_unavailable: t('Rewards become available after settlement.', 'Gewinne werden nach der Abrechnung verfügbar.'),
    palette_rewards_not_found: t('Only the winner can reveal this palette.', 'Nur der Gewinner kann diese Palette aufdecken.'),
    invalid_username: t('Use 3–32 letters, numbers, underscores or hyphens.', 'Nutze 3–32 Buchstaben, Zahlen, Unterstriche oder Bindestriche.'),
    invalid_password: t('Passwords must contain 12–128 characters.', 'Das Passwort muss 12–128 Zeichen lang sein.'),
    invalid_login: t('Incorrect username or password.', 'Benutzername oder Passwort ist falsch.'),
    invalid_code: t('This code is invalid or already used.', 'Dieser Code ist ungültig oder bereits verwendet.'),
    username_taken: t('That username is already taken.', 'Dieser Benutzername ist bereits vergeben.'),
    login_required: t('Please sign in again.', 'Bitte melde dich erneut an.'),
    insufficient_tokens: t('You do not have enough J€.', 'Du hast nicht genug J€.'),
    try_later: t('Too many attempts. Try again later.', 'Zu viele Versuche. Versuche es später erneut.'),
    forbidden: t('This action is not allowed.', 'Diese Aktion ist nicht erlaubt.'),
    daily_reset: t('A new Daily is here. Please reload.', 'Ein neues Daily ist da. Bitte lade neu.'),
    insufficient_variety: t('Not enough different auctions are available.', 'Noch nicht genug unterschiedliche Auktionen verfügbar.'),
    answer_conflict: t('This guess was already made in another tab. Reopen the game.', 'Dieser Tipp wurde in einem anderen Tab abgegeben. Öffne das Spiel erneut.'),
    empty_catalog: t('No case contents are available yet.', 'Aktuell sind keine Kisteninhalte verfügbar.'),
    catalog_changed: t('Case contents have changed. Please try again.', 'Die Kisteninhalte wurden aktualisiert. Bitte versuche es erneut.'),
    user_not_found: t('That username was not found.', 'Dieser Benutzername wurde nicht gefunden.'),
    friend_self: t('You cannot add yourself.', 'Du kannst dich nicht selbst hinzufügen.'),
    friend_limit: t('The limit of 100 friends and pending requests has been reached.', 'Das Limit von 100 Freunden und offenen Anfragen wurde erreicht.'),
    friend_request_not_found: t('That request is no longer available. Refresh your profile.', 'Diese Anfrage ist nicht mehr verfügbar. Aktualisiere dein Profil.'),
    invalid_grant_amount: t('Enter a whole J€ amount from 1 to 1,000,000.', 'Gib einen ganzen J€-Betrag von 1 bis 1.000.000 ein.'),
    invalid_grant_user: t('Choose a user to receive the J€.', 'Wähle einen Benutzer aus, der die J€ erhalten soll.'),
    request_conflict: t('This request was already used with different values.', 'Diese Anfrage wurde bereits mit anderen Werten verwendet.'),
    invalid_reset_confirmation: t('Type RESET ECONOMY exactly to confirm.', 'Gib zur Bestätigung exakt RESET ECONOMY ein.'),
    account_banned: t('This account has been banned.', 'Dieses Konto wurde gesperrt.'),
    item_listed: t('This item is listed in a resale auction.', 'Dieser Gegenstand ist in einer Verkaufsauktion gelistet.'),
    item_sold: t('This item has already been sold.', 'Dieser Gegenstand wurde bereits verkauft.'),
    invalid_listing: t('This listing is not valid. Check price and end time.', 'Diese Auktion ist ungültig. Prüfe Startpreis und Endzeit.'),
    auction_not_found: t('This auction is no longer available.', 'Diese Auktion ist nicht mehr verfügbar.'),
    auction_ended: t('This auction has ended.', 'Diese Auktion ist beendet.'),
    auction_has_bids: t('This auction already has bids and cannot be cancelled.', 'Diese Auktion hat bereits Gebote und kann nicht storniert werden.'),
    own_auction: t('You cannot bid on your own auction.', 'Du kannst nicht auf deine eigene Auktion bieten.'),
    bid_too_low: t('Your bid must beat the current highest bid.', 'Dein Gebot muss höher als das aktuelle Höchstgebot sein.'),
    invalid_bid: t('Enter a whole J€ amount.', 'Gib einen ganzen J€-Betrag ein.'),
    invalid_market_effects: t('The market effect is not valid.', 'Der Markteffekt ist ungültig.'),
    invalid_palette: t('The referenced palette is not valid.', 'Die referenzierte Palette ist ungültig.'),
    invalid_status: t('The status is not valid.', 'Der Status ist ungültig.'),
    invalid_title: t('Enter a title of 1–200 characters.', 'Gib einen Titel mit 1–200 Zeichen ein.'),
    invalid_body: t('Enter a text of 1–4,000 characters.', 'Gib einen Text mit 1–4.000 Zeichen ein.')
  };
  return errors[code] || t('Something went wrong. Please try again.', 'Das hat nicht geklappt. Bitte versuche es erneut.');
}
async function accountApi(route, payload) {
  const response = await fetch(`/api/account/${route}`, { method: payload === undefined ? 'GET' : 'POST',
    headers: { accept: 'application/json', ...(payload === undefined ? {} : { 'content-type': 'application/json', 'x-requested-with': 'JUSTIZGUESSR' }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(accountError(result.error)); error.code = result.error; throw error; }
  return result;
}
function updateNavigation() {
  const labels = { '/': 'Daily', '/shop': 'Shop', '/auctions': t('Auctions', 'Auktionen'), '/marketplace': t('Marketplace', 'Marktplatz'), '/market': t('Market', 'Markt'), '/inventory': t('Inventory', 'Inventar'), '/leaderboard': t('Leaderboard', 'Rangliste'), '/profile': t('Profile', 'Profil'), '/admin': 'Admin' };
  for (const link of document.querySelectorAll('.site-nav a')) {
    if (link.id !== 'header-auth') link.textContent = labels[link.getAttribute('href')];
    if (link.pathname === location.pathname) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    if (link.dataset.feature) link.hidden = !economyFlags[link.dataset.feature];
    if (link.pathname === '/shop') link.hidden = Boolean(economyFlags.paletteAuctions);
    if (link.pathname === '/admin') link.hidden = !account?.admin;
  }
  const auth = document.querySelector('#header-auth');
  auth.href = account ? '/profile' : '/login';
  auth.textContent = account ? `${account.username} · ${justizEuro(account.tokens)}` : t('Log in / Register', 'Anmelden / Registrieren');
  if (auth.pathname === location.pathname) auth.setAttribute('aria-current', 'page'); else auth.removeAttribute('aria-current');
  document.querySelector('[data-nav-label="play"]').textContent = t('Play', 'Spielen');
  document.querySelector('[data-nav-label="account"]').textContent = t('Account', 'Konto');
  document.querySelector('.site-nav').setAttribute('aria-label', t('Main navigation', 'Hauptnavigation'));
  notificationButton.hidden = !account;
}

const notificationCopy = entry => ({ title: t(entry.titleEn, entry.titleDe), body: t(entry.bodyEn, entry.bodyDe) });
function updateNotificationBadge() {
  const badge = notificationButton.querySelector('.notification-badge');
  badge.textContent = notificationUnreadCount > 99 ? '99+' : String(notificationUnreadCount);
  badge.hidden = notificationUnreadCount < 1;
  notificationButton.setAttribute('aria-label', notificationUnreadCount
    ? t(`Notifications, ${notificationUnreadCount} unread`, `Benachrichtigungen, ${notificationUnreadCount} ungelesen`)
    : t('Notifications', 'Benachrichtigungen'));
}
function renderNotificationPanel() {
  notificationPanel.querySelector('.eyebrow').textContent = t('INBOX', 'POSTEINGANG');
  notificationPanel.querySelector('h2').textContent = t('Notifications', 'Benachrichtigungen');
  notificationPanel.querySelector('[data-notification="close"]').setAttribute('aria-label', t('Close', 'Schließen'));
  notificationList.innerHTML = accountNotifications.length ? accountNotifications.map(entry => {
    const copy = notificationCopy(entry), tag = entry.href ? 'a' : 'article';
    const link = entry.href ? ` href="${accountEscape(entry.href)}" data-page` : '';
    return `<${tag} class="notification-entry${entry.readAt ? '' : ' is-unread'}"${link}><span class="notification-entry-dot" aria-hidden="true"></span><span><strong>${accountEscape(copy.title)}</strong><p>${accountEscape(copy.body)}</p><time datetime="${new Date(entry.createdAt).toISOString()}">${new Date(entry.createdAt).toLocaleString(uiLocale())}</time></span></${tag}>`;
  }).join('') : `<p class="notification-empty">${t('Nothing new yet.', 'Noch nichts Neues.')}</p>`;
  updateNotificationBadge();
}
function dismissNotificationToast(node) {
  if (!node?.isConnected) return;
  node.classList.add('is-leaving');
  setTimeout(() => node.remove(), 220);
}
function showNotificationToast(entry) {
  const copy = notificationCopy(entry);
  const node = document.createElement('article');
  node.className = 'notification-toast';
  node.innerHTML = `${entry.href ? `<a href="${accountEscape(entry.href)}" data-page aria-label="${accountEscape(copy.title)}"></a>` : ''}<strong>${accountEscape(copy.title)}</strong><p>${accountEscape(copy.body)}</p><button type="button" data-notification="dismiss" aria-label="${t('Dismiss', 'Ausblenden')}">×</button>`;
  notificationToasts.append(node);
  setTimeout(() => dismissNotificationToast(node), 7000);
}
function closeNotificationPanel() {
  notificationPanel.hidden = true;
  notificationButton.setAttribute('aria-expanded', 'false');
}
async function loadNotifications(showFresh = true) {
  const owner = account?.id;
  if (!owner || notificationBusy) return;
  const request = ++notificationRequest;
  notificationBusy = true;
  try {
    const result = await accountApi('notifications');
    if (request !== notificationRequest || account?.id !== owner) return;
    accountNotifications = result.notifications || [];
    notificationUnreadCount = result.unreadCount || 0;
    renderNotificationPanel();
    if (showFresh) for (const entry of result.fresh || []) showNotificationToast(entry);
  } catch { /* Session refresh handles authentication failures elsewhere. */ }
  finally { if (request === notificationRequest) notificationBusy = false; }
}
function startNotifications(user) {
  if (!user) {
    notificationRequest++; notificationBusy = false;
    notificationOwner = null; accountNotifications = []; notificationUnreadCount = 0;
    clearInterval(notificationTimer); notificationTimer = null; closeNotificationPanel(); updateNotificationBadge();
    return;
  }
  if (notificationOwner === user.id) return;
  notificationRequest++; notificationBusy = false;
  notificationOwner = user.id;
  clearInterval(notificationTimer);
  loadNotifications(true);
  notificationTimer = setInterval(() => { if (!document.hidden) loadNotifications(true); }, 30_000);
}
function giftToast(gifts) {
  const total = gifts.reduce((sum, gift) => sum + gift.amount, 0);
  return gifts.length === 1
    ? t(`You were given ${justizEuro(total)}.`, `Du hast ${justizEuro(total)} geschenkt bekommen.`)
    : t(`You were given ${justizEuro(total)} across ${gifts.length} gifts.`, `Du hast ${justizEuro(total)} aus ${gifts.length} Geschenken erhalten.`);
}
function updateAccount(user) {
  account = user;
  if (user?.gifts?.length) showToast(giftToast(user.gifts));
  updateNavigation();
  startNotifications(user);
}
function updateAccountCatalog(catalog) {
  accountCatalog = catalog;
  window.justizRewards = catalog.rewards;
  renderStaticUi();
}
const catalogReady = accountApi('cases').then(updateAccountCatalog).catch(() => {});
const accountReady = Promise.all([accountApi('me'), catalogReady, economyReady]).then(([result]) => {
  updateAccount(result.user);
  renderStaticUi();
  if (typeof renderStart === 'function' && state.view === 'start' && location.pathname === '/') renderStart();
}).catch(() => {});
function showGamePage() {
  caseReveal.close(); auctionReveal.close();
  window.economyUi?.stop();
  currentAccountPage = null; accountVisit++; pageLoaded = false;
  accountPage.hidden = true; document.querySelector('#app').hidden = false;
  if (location.pathname !== '/') history.pushState({}, '', '/');
  updateNavigation();
}
async function navigateAccountPage(path, push = true) {
  const destination = new URL(path, location.origin);
  path = destination.pathname;
  caseReveal.close(); auctionReveal.close();
  window.economyUi?.stop();
  if (!accountPaths.includes(path)) { renderStart(); return; }
  if (push && location.pathname + location.search !== destination.pathname + destination.search) history.pushState({}, '', destination.pathname + destination.search);
  const visit = ++accountVisit;
  currentAccountPage = path; pageLoaded = false;
  higherLowerRequest++; clearInterval(countdownTimer); state.view = 'account';
  document.querySelector('#app').hidden = true; accountPage.hidden = false; updateNavigation();
  accountContent.innerHTML = `<p class="collection-loading">${t('Loading…', 'Wird geladen …')}</p>`;
  window.scrollTo({ top: 0, behavior: 'instant' });
  try {
    await accountReady;
    if (visit !== accountVisit) return;
    if (path === '/shop' && economyFlags.paletteAuctions) {
      history.replaceState({}, '', '/auctions');
      await navigateAccountPage('/auctions', false);
      return;
    }
    const session = await accountApi('me');
    if (visit !== accountVisit) return;
    updateAccount(session.user);
    const owner = account?.id;
    if (window.economyUi?.isRoute(path)) {
      await window.economyUi.load(path, visit);
      if (visit !== accountVisit) return;
    }
    if (path === '/shop' || (path === '/inventory' && account)) {
      const catalog = await accountApi('cases'); if (visit !== accountVisit) return; updateAccountCatalog(catalog);
    }
    if (path === '/inventory' && account) {
      const result = await accountApi('inventory'); if (visit !== accountVisit || account?.id !== owner) return; accountItems = result.items;
    }
    if (path === '/leaderboard') {
      const result = await accountApi('leaderboard'); if (visit !== accountVisit) return; accountLeaderboard = result;
    }
    if (path === '/profile' && account) {
      const result = await accountApi('friends'); if (visit !== accountVisit || account?.id !== owner) return; accountFriends = result;
    }
    if (path === '/admin' && account?.admin) {
      const auctionQuery = `admin/auctions?query=${encodeURIComponent(accountAuctions.query || '')}&page=${accountAuctions.page}`;
      const [codes, admin, auctionPage] = await Promise.all([accountApi('codes'), accountApi('admin'), accountApi(auctionQuery)]);
      if (visit !== accountVisit || account?.id !== owner) return;
      accountCodes = codes.codes; accountAdmin = admin; accountAuctions = { query: accountAuctions.query || '', ...auctionPage };
    }
    if (visit !== accountVisit) return;
    pageLoaded = true; renderAccountPage(); accountContent.querySelector('h1')?.focus({ preventScroll: true });
  } catch (error) {
    if (visit !== accountVisit) return;
    accountContent.innerHTML = `<section class="collection-empty"><h1 tabindex="-1">${t('Unable to load this page', 'Seite konnte nicht geladen werden')}</h1><p role="alert">${accountEscape(error.message)}</p><button data-account="refresh">${t('Try again', 'Erneut versuchen')}</button></section>`;
  }
}
function pageHeading(title, text) {
  return `<header class="collection-heading"><div class="collection-heading-line"><h1 tabindex="-1">${title}</h1>${text ? infoTip(text) : ''}</div></header>`;
}
function loginNotice(subject) {
  return `<section class="collection-empty"><span aria-hidden="true">◇</span><h2>${t(`Log in to view your ${subject}.`, subject === 'inventory' ? 'Melde dich an, um dein Inventar zu sehen.' : 'Melde dich an, um dein Profil zu sehen.')}</h2><a class="primary-button" href="/login" data-page>${t('Log in', 'Anmelden')}</a></section>`;
}
function accountValueMarkup() {
  return `<div class="account-value"><span>${t('TOTAL ACCOUNT VALUE', 'GESAMTER KONTOWERT')}<strong>${euro(account.accountValueEur)}</strong></span>${infoTip(t(`Auction values of your collection (${account.itemCount} item${account.itemCount === 1 ? "" : "s"}). Justiz€ is not included in the euro value.`, `Auktionswerte deiner Sammlung (${account.itemCount} Lose). Justiz€ zählt nicht zum Eurowert.`), t('How account value is calculated', 'Berechnung des Kontowerts'))}</div>`;
}
function renderAccountPage() {
  if (!pageLoaded || !currentAccountPage) return;
  if (caseOpening === accountVisit && currentAccountPage === '/shop') return;
  if (window.economyUi?.isRoute(currentAccountPage)) window.economyUi.render();
  else if (currentAccountPage === '/shop') renderShop();
  else if (currentAccountPage === '/inventory') renderInventory();
  else if (currentAccountPage === '/profile') renderProfile();
  else if (currentAccountPage === '/admin') renderAdmin();
  else if (currentAccountPage === '/leaderboard') renderLeaderboard();
  else renderAuth();
}
function renderAuth() {
  const register = currentAccountPage === '/register';
  accountContent.innerHTML = pageHeading(register ? t('Create account', 'Konto erstellen') : t('Log in', 'Anmelden')) +
    (account ? `<p>${t('You are already logged in.', 'Du bist bereits angemeldet.')}</p><a class="secondary-button" href="/profile" data-page>${t('Go to profile', 'Zum Profil')}</a>` :
    `<form id="account-form" class="account-form"><label>${t('Username', 'Benutzername')}<input name="username" autocomplete="username" required pattern="[a-zA-Z0-9_-]{3,32}" minlength="3" maxlength="32"></label>
    <label>${t('Password', 'Passwort')}<input name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" required minlength="12" maxlength="128"></label>
    ${register ? `<label>${t('Registration code', 'Registrierungscode')}<input name="code" autocomplete="off" required minlength="32" maxlength="32" spellcheck="false"></label>${infoTip(t('Ask an admin for a single-use registration code. Passwords need at least 12 characters.', 'Du erhältst einen einmal verwendbaren Code vom Admin. Passwörter benötigen mindestens 12 Zeichen.'), t('Account requirements', 'Kontoanforderungen'))}` : ''}
    <p class="account-error" role="alert"></p><button class="primary-button" type="submit">${register ? t('Register', 'Registrieren') : t('Log in', 'Anmelden')}</button>
    <a class="text-button" href="${register ? '/login' : '/register'}" data-page>${register ? t('Already registered? Log in', 'Schon registriert? Anmelden') : t('Have a code? Create an account', 'Du hast einen Code? Konto erstellen')}</a></form>`);
}
function rarityLabel(id) {
  return ({ common: t('Common', 'Gewöhnlich'), uncommon: t('Uncommon', 'Ungewöhnlich'), rare: t('Rare', 'Selten'), epic: t('Epic', 'Episch'), legendary: t('Legendary', 'Legendär') })[id] || id;
}
function itemCard(item, controls = true) {
  const copies = item.copies || [item];
  const available = copies.find(copy => !copy.listed);
  const marketValue = item.marketIndex == null ? null : item.price * item.marketIndex / 100;
  const marketDelta = marketValue == null ? null : Math.round(item.marketIndex) - 100;
  const marketDeltaBadge = marketDelta ? `<span class="market-delta ${marketDelta > 0 ? 'is-up' : 'is-down'}" title="${t('Market movement since the last update', 'Marktbewegung seit der letzten Aktualisierung')}">${marketDelta > 0 ? '↑ +' : '↓ −'}${Math.abs(marketDelta)}%</span>` : '';
  const valueLine = marketValue == null
    ? `${t('Auction value', 'Auktionswert')} ${euro(item.price)}`
    : `${t('Market value', 'Marktwert')} ${justizEuro(marketValue)} ${marketDeltaBadge}`;
  const resaleControls = `<button class="primary-button" data-economy="list" data-id="${accountEscape(available?.id || item.id)}" ${available ? '' : 'disabled'}>${available ? t('List for auction', 'Zur Auktion anbieten') : t('Already listed', 'Bereits angeboten')}</button>${economyFlags.market && item.marketCategory ? `<a href="/market?category=${encodeURIComponent(item.marketCategory)}" data-page>${t('Check market before selling', 'Markt vor dem Verkauf prüfen')} →</a>` : ''}<a href="/marketplace?view=mine" data-page>${t('Manage my listings', 'Meine Angebote verwalten')}</a>`;
  return `<article class="collection-item rarity-${accountEscape(item.rarity)}"><span class="rarity-label">${rarityLabel(item.rarity)}</span>${copies.length > 1 ? `<span class="item-count" aria-label="${copies.length} ${t('copies', 'Exemplare')}">×${copies.length}</span>` : ''}
    <img src="${accountEscape(item.image)}" alt="" loading="lazy"><h3>${accountEscape(item.title)}</h3><p>${valueLine}</p>${item.estimatedValueTokens == null ? '' : `<p>${t('Estimated market value', 'Geschätzter Marktwert')} · ${justizEuro(item.estimatedValueTokens)}</p>`}
    ${economyFlags.resales && controls ? resaleControls : controls ? copies.length > 1 ? `<div class="item-actions"><button class="secondary-button" data-account="sell" data-id="${accountEscape(copies[0].id)}">${t('Sell one', 'Eins verkaufen')}<small>+${justizEuro(item.sellValue)}</small></button><button class="secondary-button" data-account="sell-all" data-id="${accountEscape(copies[0].id)}">${t('Sell all', 'Alle verkaufen')}<small>+${justizEuro(item.sellValue * copies.length)}</small></button></div>` : `<button class="secondary-button" data-account="sell" data-id="${accountEscape(item.id)}">${t('Sell', 'Verkaufen')} · ${justizEuro(item.sellValue)}</button>` : `<span class="item-value">${justizEuro(item.sellValue)}</span>`}</article>`;
}
function groupedInventory(items) {
  const groups = new Map();
  for (const item of items) {
    const key = JSON.stringify([item.auctionId, item.title, item.image, item.price, item.rarity, item.sellValue]);
    if (!groups.has(key)) groups.set(key, { ...item, copies: [] });
    groups.get(key).copies.push(item);
  }
  return [...groups.values()];
}
function renderInventory() {
  accountContent.innerHTML = pageHeading(t('Inventory', 'Inventar'), t('List items on the marketplace or keep them in your collection.', 'Biete Gegenstände auf dem Marktplatz an oder behalte sie in deiner Sammlung.'));
  if (!account) { accountContent.innerHTML += loginNotice('inventory'); return; }
  const filtered = groupedInventory(accountItems.filter(item => accountFilter === 'all' || item.rarity === accountFilter));
  accountInventoryPage = Math.min(accountInventoryPage, Math.max(0, Math.ceil(filtered.length / 24) - 1));
  accountContent.innerHTML += accountValueMarkup() + `<div class="inventory-heading"><div class="section-title-row"><h2>${t('Collection', 'Sammlung')} <small>${accountItems.length} ${accountItems.length === 1 ? t('item', 'Los') : t('items', 'Lose')}</small></h2>${economyFlags.resales ? infoTip(t('Sell through the marketplace. Maximum 5 active listings.', 'Verkaufe auf dem Marktplatz. Höchstens 5 aktive Angebote.'), t('Selling limits', 'Verkaufslimits')) : ''}</div><label>${t('Rarity', 'Seltenheit')} <select id="rarity-filter"><option value="all">${t('All', 'Alle')}</option>${accountCatalog.rarities.map(rarity => `<option value="${rarity.id}" ${accountFilter === rarity.id ? 'selected' : ''}>${rarityLabel(rarity.id)}</option>`).join('')}</select></label></div>
    ${filtered.length ? `<div class="inventory-grid">${filtered.slice(accountInventoryPage * 24, (accountInventoryPage + 1) * 24).map(item => itemCard(item)).join('')}</div><div class="inventory-pages"><button data-account="page" data-step="-1" ${accountInventoryPage ? '' : 'disabled'}>← ${t('Previous', 'Zurück')}</button><span>${accountInventoryPage + 1} / ${Math.ceil(filtered.length / 24)}</span><button data-account="page" data-step="1" ${(accountInventoryPage + 1) * 24 >= filtered.length ? 'disabled' : ''}>${t('Next', 'Weiter')} →</button></div>` : `<div class="collection-empty"><h2>${t('Your next find belongs here.', 'Hier wartet dein nächster Fund.')}</h2><p>${economyFlags.paletteAuctions ? t('Win a Mystery Palette to start your collection, or try another rarity filter.', 'Gewinne eine Mystery-Palette oder wähle einen anderen Seltenheitsfilter.') : t('Open a case to start your collection, or try another rarity filter.', 'Öffne eine Kiste für deine Sammlung oder wähle einen anderen Seltenheitsfilter.')}</p><a class="primary-button" href="/shop" data-page>${economyFlags.paletteAuctions ? t('Browse auctions', 'Auktionen ansehen') : t('Visit the shop', 'Zum Shop')} →</a></div>`}`;
}
function dailyFriendLabel(daily) {
  if (daily.status === 'completed') return `${number(daily.score)} / ${number(5000)} ${t('pts', 'Pkt')}`;
  return daily.status === 'in_progress' ? t(`In progress · ${daily.completedRounds} / 5 lots`, `In Arbeit · ${daily.completedRounds} / 5 Lose`) : t('Not played yet', 'Noch nicht gespielt');
}
function renderLeaderboard() {
  accountContent.innerHTML = pageHeading(t('Leaderboard', 'Rangliste'), t('Top 100 players by collection auction value.', 'Top 100 nach Auktionswert der Sammlung.'));
  const rows = accountLeaderboard.leaders.map(leader => `<tr${account?.id === leader.id ? ' class="is-me"' : ''}><td class="leaderboard-rank">${leader.rank}</td><td class="leaderboard-name">${accountEscape(leader.username)}</td>
    <td>${leader.score === null ? t('Not played yet', 'Noch nicht gespielt') : `${number(leader.score)} / ${number(5000)} ${t('pts', 'Pkt')}`}</td><td>${euro(leader.inventoryValueEur)}</td></tr>`).join('');
  accountContent.innerHTML += `<div class="friends-heading"><div><h2>${t('Top 100', 'Top 100')}</h2><p>${t('Daily for', 'Daily vom')} ${accountLeaderboard.date} · ${t('Resets at 00:00 UTC', 'Reset um 00:00 UTC')}</p></div><button data-account="refresh">${t('Refresh', 'Aktualisieren')}</button></div>
    ${rows ? `<div class="leaderboard-wrap"><table class="leaderboard-table"><thead><tr><th scope="col">#</th><th scope="col">${t('Player', 'Spieler')}</th><th scope="col">${t('TODAY’S DAILY', 'HEUTIGES DAILY')}</th><th scope="col">${t('INVENTORY VALUE', 'INVENTARWERT')}</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="collection-empty">${t('No players yet. Register to claim the first rank.', 'Noch keine Spieler. Registriere dich für den ersten Platz.')}</p>`}`;
}
function rewardNote() {
  if (!account) return t('Log in before playing to earn J€.', 'Melde dich vor dem Spielen an, um J€ zu verdienen.');
  const rewards = accountCatalog?.rewards || { daily: 100, higherLowerMax: 200 };
  if (!account.reward) return t(`Your daily reward run is available. Finish Daily for ${justizEuro(rewards.daily)}, or earn up to ${justizEuro(rewards.higherLowerMax)} in Higher or Lower.`, `Dein täglicher J€-Lauf ist verfügbar. Schließe das Daily für ${justizEuro(rewards.daily)} ab oder verdiene bis zu ${justizEuro(rewards.higherLowerMax)} in Higher or Lower.`);
  return account.reward.complete ? t(`You earned ${justizEuro(account.reward.earned)} today. Your next reward run unlocks at 00:00 UTC.`, `Du hast heute ${justizEuro(account.reward.earned)} verdient. Dein nächster J€-Lauf startet um 00:00 UTC.`) : t(`Resume your ${account.reward.mode === 'daily' ? 'Daily' : 'Higher or Lower'} run to earn today’s J€.`, `Setze deinen ${account.reward.mode === 'daily' ? 'Daily' : 'Higher-or-Lower'}-Lauf für die heutigen J€ fort.`);
}
function rewardBanner() { return `<p class="reward-note">${accountEscape(rewardNote())}</p>`; }
function renderProfile() {
  accountContent.innerHTML = pageHeading(account ? accountEscape(account.username) : t('Profile', 'Profil'));
  if (!account) { accountContent.innerHTML += loginNotice('profile'); return; }
  accountContent.innerHTML += accountValueMarkup() + progressionMarkup(account.progression) + `<div class="profile-stats"><div><span>JUSTIZ€</span><strong>${justizEuro(account.tokens)}</strong></div><div><span>${t('TODAY’S DAILY', 'HEUTIGES DAILY')}</span><strong>${dailyFriendLabel(account.daily)}</strong></div><button class="secondary-button" data-account="logout">${t('Log out', 'Abmelden')}</button></div>${rewardBanner()}
    <section class="profile-friends"><div class="friends-heading"><div><h2>${t('Friends', 'Freunde')}</h2><p>${t('Daily for', 'Daily vom')} ${accountFriends.date} · ${t('Resets at 00:00 UTC', 'Reset um 00:00 UTC')}</p></div><button data-account="refresh">${t('Refresh', 'Aktualisieren')}</button></div>${friendsMarkup()}</section>`;
}
function friendsMarkup() {
  const accepted = accountFriends.friends.filter(friend => friend.status === 'accepted');
  const incoming = accountFriends.friends.filter(friend => friend.status === 'incoming');
  const outgoing = accountFriends.friends.filter(friend => friend.status === 'outgoing');
  const requests = (friends, incoming) => friends.map(friend => `<div class="friend-request"><strong>${accountEscape(friend.username)}</strong><span>${incoming ? t('Wants to be your friend', 'Möchte mit dir befreundet sein') : t('Waiting for a reply', 'Wartet auf Antwort')}</span><div>${incoming ? `<button data-account="friend-accept" data-id="${friend.id}">${t('Accept', 'Annehmen')}</button>` : ''}<button data-account="friend-remove" data-id="${friend.id}">${incoming ? t('Decline', 'Ablehnen') : t('Cancel request', 'Zurückziehen')}</button></div></div>`).join('');
  return `<form id="friend-form" class="friend-form"><label>${t('Username', 'Benutzername')}<input name="username" required minlength="3" maxlength="32" pattern="[a-zA-Z0-9_-]{3,32}" autocomplete="off" placeholder="${t('Your friend’s username', 'Benutzername eines Freundes')}"></label><button class="secondary-button" type="submit">${t('Send request', 'Anfrage senden')}</button><p class="account-error" role="alert"></p></form>
    ${infoTip(t('Accepted friends can see each other’s inventory value and today’s Daily progress.', 'Angenommene Freunde sehen gegenseitig ihren Inventarwert und den heutigen Daily-Spielstand.'), t('What friends can see', 'Was Freunde sehen'))}
    ${incoming.length ? `<h3>${t('Incoming requests', 'Anfragen an dich')} · ${incoming.length}</h3><div class="friend-requests">${requests(incoming, true)}</div>` : ''}
    ${outgoing.length ? `<h3>${t('Sent requests', 'Gesendete Anfragen')} · ${outgoing.length}</h3><div class="friend-requests">${requests(outgoing, false)}</div>` : ''}
    <h3>${t('Your friends', 'Deine Freunde')} · ${accepted.length}</h3>
    ${accepted.length ? `<div class="friend-grid">${accepted.map(friend => `<article class="friend-card"><h4>${accountEscape(friend.username)}</h4><dl><div><dt>${t('TODAY’S DAILY', 'HEUTIGES DAILY')}</dt><dd>${dailyFriendLabel(friend.daily)}</dd></div><div><dt>${t('INVENTORY VALUE', 'INVENTARWERT')}</dt><dd>${euro(friend.inventoryValueEur)}</dd></div><div><dt>${t('COLLECTED ITEMS', 'GESAMMELTE LOSE')}</dt><dd>${friend.itemCount}</dd></div></dl><button data-account="friend-remove" data-id="${friend.id}">${t('Remove friend', 'Freund entfernen')}</button></article>`).join('')}</div>` : `<p class="collection-empty">${t('No friends yet. Send a request using their username.', 'Noch keine Freunde. Sende eine Anfrage über den Benutzernamen.')}</p>`}`;
}
function adminUserListMarkup() {
  const query = adminUserFilter.trim().toLowerCase();
  const filtered = accountAdmin.users.filter(user => user.username.toLowerCase().includes(query));
  const rows = filtered.slice(0, 100).map(user => `<div class="user-row${user.banned ? ' is-banned' : ''}">
    <div class="user-row-main"><strong>${accountEscape(user.username)}</strong><span>${justizEuro(user.tokens)}${user.admin ? ` · ${t('Admin', 'Admin')}` : ''}${user.banned ? ` · ${t('Banned', 'Gesperrt')}` : ''}</span></div>
    <div class="user-row-actions">${user.admin ? '' : `<button data-account="ban-toggle" data-id="${accountEscape(user.id)}" data-banned="${user.banned ? 'true' : 'false'}">${user.banned ? t('Unban', 'Entsperren') : t('Ban', 'Sperren')}</button>`}<button data-account="grant-user" data-id="${accountEscape(user.id)}">${t('Give J€', 'J€ geben')}</button></div>
  </div>`).join('');
  const note = filtered.length > 100 ? t(`Showing 100 of ${filtered.length} players. Refine your search.`, `Zeige 100 von ${filtered.length} Spielern. Grenze die Suche weiter ein.`) :
    filtered.length ? '' : t('No players match this search.', 'Keine Spieler gefunden.');
  return rows + (note ? `<p class="admin-count">${note}</p>` : '');
}
function auctionResultsMarkup() {
  const rows = accountAuctions.auctions.map(auction => `<tr><td class="auction-cover">${auction.image ? `<img src="${accountEscape(auction.image)}" alt="" loading="lazy">` : ''}</td>
    <td class="auction-title-cell"><strong>${accountEscape(auction.title)}</strong><span>${accountEscape(auction.category || '')} · #${accountEscape(auction.id)}</span></td>
    <td>${auction.finalPrice != null ? euro(auction.finalPrice) : euro(auction.currentBid)}</td>
    <td>${auction.endAt ? new Date(auction.endAt).toLocaleDateString(uiLocale()) : '—'}</td>
    <td><button data-account="auction-detail" data-id="${accountEscape(auction.id)}">${t('Details', 'Details')}</button></td></tr>`).join('');
  return `<p class="admin-count">${number(accountAuctions.total)} ${t('auctions', 'Auktionen')} · ${t('Page', 'Seite')} ${number(accountAuctions.page)} / ${number(accountAuctions.pages)}</p>
    ${rows ? `<div class="auction-table-wrap"><table class="auction-table"><thead><tr><th scope="col" aria-label="${t('Image', 'Bild')}"></th><th scope="col">${t('Auction', 'Auktion')}</th><th scope="col">${t('Price', 'Preis')}</th><th scope="col">${t('Ends', 'Ende')}</th><th scope="col" aria-label="${t('Actions', 'Aktionen')}"></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="admin-count">${t('No auctions match this search.', 'Keine Auktionen gefunden.')}</p>`}
    <div class="inventory-pages"><button data-account="auction-page" data-step="-1" ${accountAuctions.page <= 1 ? 'disabled' : ''}>← ${t('Previous', 'Zurück')}</button><span>${number(accountAuctions.page)} / ${number(accountAuctions.pages)}</span><button data-account="auction-page" data-step="1" ${accountAuctions.page >= accountAuctions.pages ? 'disabled' : ''}>${t('Next', 'Weiter')} →</button></div>`;
}
async function loadAuctionBrowser(visit) {
  const result = await accountApi(`admin/auctions?query=${encodeURIComponent(accountAuctions.query || '')}&page=${accountAuctions.page}`);
  if (visit !== accountVisit) return;
  accountAuctions = { query: accountAuctions.query || '', ...result };
  const node = accountContent.querySelector('#auction-results');
  if (node) node.innerHTML = auctionResultsMarkup();
}
function renderAuctionDetail(auction) {
  const facts = [
    [t('Category', 'Kategorie'), auction.category],
    [t('Start bid', 'Startgebot'), euro(auction.startBid)],
    [t('Current bid', 'Aktuelles Gebot'), euro(auction.currentBid)],
    [t('Final price', 'Endpreis'), auction.finalPrice != null ? euro(auction.finalPrice) : t('Still running', 'Läuft noch')],
    [t('Bids', 'Gebote'), number(auction.bidCount)],
    [t('Condition', 'Zustand'), auction.condition],
    [t('Fulfillment', 'Versand'), auction.fulfillment],
    [t('Location', 'Standort'), auction.location],
    [t('Ends', 'Ende'), auction.endAt ? new Date(auction.endAt).toLocaleString(uiLocale()) : null],
    [t('Captured', 'Erfasst'), auction.capturedAt ? new Date(auction.capturedAt).toLocaleString(uiLocale()) : null],
    [t('Auction ID', 'Auktions-ID'), `#${auction.id}`]];
  auctionReveal.innerHTML = `<div class="auction-reveal-content"><form method="dialog"><button class="dialog-close" aria-label="${t('Close', 'Schließen')}">×</button></form>
    <p class="eyebrow">${t('AUCTION', 'AUKTION')}</p><h2 id="auction-detail-title">${accountEscape(auction.title)}</h2>
    ${auction.image ? `<img class="auction-detail-cover" src="${accountEscape(auction.image)}" alt="">` : ''}
    <dl class="auction-facts">${facts.filter(([, value]) => value !== null && value !== undefined && value !== '').map(([label, value]) => `<div><dt>${label}</dt><dd>${accountEscape(value)}</dd></div>`).join('')}</dl>
    ${auction.description ? `<p class="auction-description">${accountEscape(auction.description)}</p>` : ''}
    <div class="auction-reveal-actions">${auction.url ? `<a class="secondary-button" href="${accountEscape(auction.url)}" target="_blank" rel="noopener">${t('Open listing', 'Angebot öffnen')}</a>` : ''}<button class="text-button" data-account="close-auction" autofocus>${t('Close', 'Schließen')}</button></div></div>`;
  auctionReveal.querySelector('[data-account="close-auction"]').focus({ preventScroll: true });
}
function renderAdmin() {
  accountContent.innerHTML = pageHeading(t('Admin', 'Adminbereich'));
  if (!account?.admin) { accountContent.innerHTML += `<p class="collection-empty">${t('Log in with an admin account to access this page.', 'Melde dich mit einem Adminkonto an, um diese Seite zu nutzen.')}</p>`; return; }
  accountContent.innerHTML += `<section class="admin-section"><div class="section-title-row"><h2>${t('Players', 'Spieler')}</h2>${infoTip(t(`Search all ${accountAdmin.playerCount} players to grant J€ or change access. Banned players are signed out immediately.`, `Durchsuche alle ${accountAdmin.playerCount} Spieler, um J€ zu vergeben oder den Zugang zu ändern. Gesperrte Spieler werden sofort abgemeldet.`))}</div>
    <div class="admin-toolbar"><label>${t('Search', 'Suche')}<input id="user-search" type="search" autocomplete="off" placeholder="${t('Username', 'Benutzername')}" value="${accountEscape(adminUserFilter)}"></label><label>${t('J€ per grant', 'J€ pro Gutschrift')}<input id="grant-amount" type="number" min="1" max="1000000" step="1" value="100"></label></div>
    <div id="user-list" class="user-list">${adminUserListMarkup()}</div>
    <div class="section-title-row"><h3>${t('Give all players J€', 'Allen Spielern J€ geben')}</h3>${infoTip(t(`Applies to every existing account, including admins (${accountAdmin.playerCount} currently). Later registrations do not receive it.`, `Gilt für alle bestehenden Konten inklusive Admins (aktuell ${accountAdmin.playerCount}). Spätere Registrierungen erhalten nichts.`))}</div>
    <form id="grant-form" class="grant-form"><label>${t('J€ per player', 'J€ pro Spieler')}<input name="amount" type="number" min="1" max="1000000" step="1" value="100" required></label><button class="primary-button" type="submit">${t('Give J€ to all current players', 'J€ an alle aktuellen Spieler geben')}</button><p class="account-error" role="alert"></p></form>
    <div class="grant-history">${accountAdmin.grants.map(grant => `<p>${new Date(grant.createdAt).toLocaleString(uiLocale())} · ${justizEuro(grant.amount)} ${t('each', 'je Spieler')} · ${grant.recipients} ${t('players', 'Spieler')}</p>`).join('')}</div></section>
    <section class="admin-section"><div class="section-title-row"><h2>${t('Auctions', 'Auktionen')}</h2>${infoTip(t('Search the archive by title, description, category or ID.', 'Durchsuche das Archiv nach Titel, Beschreibung, Kategorie oder ID.'))}</div>
    <div class="admin-toolbar"><label>${t('Search', 'Suche')}<input id="auction-search" type="search" autocomplete="off" placeholder="${t('Title, description, category or ID', 'Titel, Beschreibung, Kategorie oder ID')}" value="${accountEscape(accountAuctions.query)}"></label></div>
    <div id="auction-results">${auctionResultsMarkup()}</div></section>
    <section class="admin-section"><div class="section-title-row"><h2>${t('Registration codes', 'Registrierungscodes')}</h2>${infoTip(t('Each code allows one registration. Full codes are shown only immediately after creation.', 'Jeder Code erlaubt eine Registrierung. Vollständige Codes werden nur direkt nach dem Erstellen angezeigt.'))}</div>
    <form id="code-form" class="code-form"><label>${t('Number of codes', 'Anzahl der Codes')}<input name="count" type="number" min="1" max="50" value="5" required></label><button class="primary-button" type="submit">${t('Create codes', 'Codes erstellen')}</button><p class="account-error" role="alert"></p></form>
    ${freshCodes.length ? `<label class="fresh-codes">${t('New codes — copy and save them now', 'Neue Codes — jetzt kopieren und aufbewahren')}<textarea readonly rows="${Math.min(10, freshCodes.length + 1)}">${freshCodes.join('\n')}</textarea></label>` : ''}
    <div class="code-list">${accountCodes.map(code => `<div><code>…${accountEscape(code.label)}</code><span>${code.used_at !== null ? t('Used', 'Verwendet') : code.revoked ? t('Revoked', 'Widerrufen') : t('Available', 'Verfügbar')}</span>${code.used_at === null && !code.revoked ? `<button data-account="revoke" data-id="${code.id}">${t('Revoke', 'Widerrufen')}</button>` : ''}</div>`).join('') || `<p>${t('No codes created yet.', 'Noch keine Codes erstellt.')}</p>`}</div></section>
    <section class="admin-section economy-reset"><p class="eyebrow">${t('DANGER ZONE', 'GEFAHRENBEREICH')}</p><h2>${t('Reset the player economy', 'Spielerwirtschaft zurücksetzen')}</h2>
    <p>${t('Every human account returns to J€ 1,000 and 0 XP. Inventories, game progress, rewards, grants, bids and both auction histories are deleted. Usernames, passwords, active login sessions, registration codes, bans, admin roles and friendships stay intact.', 'Jedes menschliche Konto wird auf J€ 1.000 und 0 XP gesetzt. Inventare, Spielfortschritt, Belohnungen, Gutschriften, Gebote und beide Auktionsverläufe werden gelöscht. Benutzernamen, Passwörter, aktive Anmeldungen, Registrierungscodes, Sperren, Adminrollen und Freundschaften bleiben erhalten.')}</p>
    ${accountAdmin.lastReset ? `<p class="reset-history">${t('Last reset', 'Letzter Reset')}: ${new Date(accountAdmin.lastReset.createdAt).toLocaleString(uiLocale())} · ${number(accountAdmin.lastReset.playerCount)} ${t('accounts', 'Konten')} · ${number(accountAdmin.lastReset.inventoryCount)} ${t('items removed', 'Gegenstände entfernt')}</p>` : ''}
    <form id="reset-economy-form" class="reset-economy-form"><label>${t('Type RESET ECONOMY to confirm', 'Zur Bestätigung RESET ECONOMY eingeben')}<input name="confirmation" required autocomplete="off" spellcheck="false" pattern="RESET ECONOMY"></label><button class="danger-button" type="submit">${t('Reset economy for every player', 'Wirtschaft für alle Spieler zurücksetzen')}</button><p class="account-error" role="alert"></p></form></section>`;
}
function renderShop() {
  const box = accountCatalog.cases.find(box => box.id === accountSelectedCase) || accountCatalog.cases[0];
  accountSelectedCase = box.id;
  const caseName = box => t(box.name, box.nameDe || box.name);
  const result = accountResult?.caseId === box.id ? accountResult : null;
  accountContent.innerHTML = pageHeading('Shop') +
    `<div class="shop-balance">${account ? `${justizEuro(account.tokens)} ${t('available', 'verfügbar')}` : `${t('Browse the cases. Log in to earn J€ and open one.', 'Entdecke die Kisten. Melde dich an, um J€ zu verdienen und eine zu öffnen.')} <a href="/login" data-page>${t('Log in', 'Anmelden')} →</a>`}</div>
    <p class="shop-edition"><span>${t('DAILY EDITION', 'TAGESAUSGABE')} · ${accountCatalog.rotationDate}</span>${infoTip(t('New prices and finds at 00:00 UTC. Today’s offers stay fixed until then.', 'Neue Preise und Fundstücke um 00:00 UTC. Bis dahin gelten die heutigen Angebote.'), t('Edition timing', 'Ausgabenwechsel'))}</p>
    <div class="case-options">${accountCatalog.cases.map(option => `<button class="case-option case-theme-${option.category} ${box.id === option.id ? 'is-selected' : ''} ${option.available ? '' : 'is-restocking'}" data-account="select-case" data-id="${option.id}" aria-pressed="${box.id === option.id}"><span class="case-art" aria-hidden="true"><b>${option.badge}</b></span><span><strong>${caseName(option)}</strong><small>${option.available ? justizEuro(option.cost) : t('Restocking', 'Wird aufgefüllt')}</small></span></button>`).join('')}</div>
    <section class="case-stage" aria-label="${t('Case opening', 'Kistenöffnung')}"><div class="case-stage-heading"><span>${caseName(box).toUpperCase()}</span><span>${box.available ? `${box.items.length} ${t('FINDS IN THIS EDITION', 'FUNDE IN DIESER AUSGABE')}` : t('MORE FINDS ON THE WAY', 'NEUE FUNDE UNTERWEGS')}</span></div>
    ${box.available ? `<div class="case-window" aria-hidden="true"><div class="case-marker"></div><div class="case-reel">${box.items.slice(0, 10).map(item => tierCard(item.rarity)).join('')}</div></div>` : ''}
    <div class="case-result" role="status">${result ? resultMarkup() : `<h2>${box.available ? t('Open for one item', 'Für einen Gegenstand öffnen') : t('Unavailable', 'Nicht verfügbar')}</h2>${box.available ? '' : infoTip(t('This category needs more distinct items. Stock is checked with each Daily edition.', 'Diese Kategorie benötigt mehr unterschiedliche Lose. Der Bestand wird mit jeder Tagesausgabe geprüft.'))}`}</div>
    <button class="primary-button case-open" data-account="pull" ${!account || account.tokens < box.cost || !box.available || accountBusy ? 'disabled' : ''}>${!box.available ? t('Currently unavailable', 'Derzeit nicht verfügbar') : account ? `${result ? t('Open another case', 'Weitere Kiste öffnen') : t('Open case', 'Kiste öffnen')} · ${justizEuro(box.cost)}` : t('Log in to open cases', 'Zum Öffnen anmelden')}</button></section>
    ${box.available ? `<details class="case-contents"><summary>${t('Edition contents', 'Inhalt der Ausgabe')} · ${box.items.length}</summary><div class="case-contents-note">${infoTip(t('Rarity and J€ resale values are fixed for this edition. Collected items keep them after rotation.', 'Seltenheit und J€-Verkaufswerte sind für diese Ausgabe fest. Gesammelte Lose behalten sie nach dem Wechsel.'))}</div><div class="inventory-grid">${box.items.map(item => itemCard(item, false)).join('')}</div></details>` : ''}
    <p class="data-note">${t('Digital collectibles. No ownership of the real auction item. J€ has no cash value.', 'Digitale Sammelobjekte. Kein Eigentum am echten Auktionsgegenstand. J€ hat keinen Geldwert.')}</p>`;
}
function resultMarkup() {
  return `<p class="rarity-label rarity-${accountResult.rarity}">${rarityLabel(accountResult.rarity)}</p><h2>${accountEscape(accountResult.title)}</h2>${accountResult.sold ? `<p>${t('Sold. J€ added.', 'Verkauft. J€ gutgeschrieben.')}</p>` : ''}
    ${accountResult.sold || economyFlags.resales ? '' : `<button class="secondary-button" data-account="sell-result" data-id="${accountResult.id}">${t('Sell now', 'Sofort verkaufen')} · ${justizEuro(accountResult.sellValue)}</button>`}`;
}
function tierCard(rarity) {
  return `<div class="case-tier rarity-${accountEscape(rarity)}"><span class="case-tier-symbol" aria-hidden="true">◇</span><span class="rarity-label">${rarityLabel(rarity)}</span></div>`;
}
function revealCaseItem() {
  const box = accountCatalog.cases.find(box => box.id === accountResult.caseId);
  caseReveal.innerHTML = `<div class="case-reveal-content rarity-${accountEscape(accountResult.rarity)}"><h2 id="case-reveal-title">${accountEscape(accountResult.title)}</h2><img src="${accountEscape(accountResult.image)}" alt=""><p class="rarity-label">${rarityLabel(accountResult.rarity)}</p><p>${t('Auction value', 'Auktionswert')} ${euro(accountResult.price)}</p><p role="status">${accountResult.sold ? t('Sold. J€ added.', 'Verkauft. J€ gutgeschrieben.') : t('Added to inventory.', 'Zum Inventar hinzugefügt.')}</p><div class="case-reveal-actions">${accountResult.sold || economyFlags.resales ? '' : `<button class="secondary-button" data-account="sell-result" data-id="${accountEscape(accountResult.id)}">${t('Sell now', 'Sofort verkaufen')} · ${justizEuro(accountResult.sellValue)}</button>`}<button class="primary-button" data-account="pull" ${!account || account.tokens < box.cost || !box.available ? 'disabled' : ''}>${t('Open another case', 'Weitere Kiste öffnen')} · ${justizEuro(box.cost)}</button><button class="text-button" data-account="close-reveal" autofocus>${accountResult.sold ? t('Close', 'Schließen') : t('Keep item', 'Behalten')}</button></div></div>`;
  if (!caseReveal.open) caseReveal.showModal();
  caseReveal.querySelector('[data-account="close-reveal"]').focus({ preventScroll: true });
}
async function accountGameStart(mode) {
  await accountReady; if (!account) return null;
  const owner = account.id, result = await accountApi('games/start', { mode });
  if (account?.id !== owner) throw new Error(t('Your account changed. Please start again.', 'Das Konto wurde gewechselt. Bitte starte erneut.'));
  updateAccount(result.user); return result.run;
}
async function accountGameAnswer(run, position, answer) {
  const owner = account?.id, result = await accountApi('games/answer', { id: run.id, position, answer });
  if (account?.id !== owner) throw new Error(t('Your account changed. Please start again.', 'Das Konto wurde gewechselt. Bitte starte erneut.'));
  updateAccount(result.user);
  if (result.run.complete && result.run.earned) showToast(economyFlags.paletteAuctions
    ? t(`+${justizEuro(result.run.earned)}! Explore the auctions.`, `+${justizEuro(result.run.earned)}! Entdecke die Auktionen.`)
    : t(`+${justizEuro(result.run.earned)}! Your next case is waiting.`, `+${justizEuro(result.run.earned)}! Deine nächste Kiste wartet.`));
  return result.run;
}
async function spinCaseReel(reel, viewport, item, pool, isCurrent) {
  const winnerIndex = 28 + Math.floor(Math.random() * 12);
  const cards = Array.from({ length: 42 }, (_, index) => index === winnerIndex ? item : pool[Math.floor(Math.random() * pool.length)]);
  reel.innerHTML = cards.map(item => tierCard(item.rarity)).join('');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const width = reel.children[0].getBoundingClientRect().width;
  const landingBias = width * (0.25 + Math.random() * 0.5);
  const landingAt = index => index * (width + 12) + landingBias - viewport.clientWidth / 2;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // Jump the full reel between centered stops, simulating a wheel without interpolation.
    const tierDelays = [80, 90, 110, 140, 180, 240, 320, 420, 540, 680, 820, 1000];
    for (let step = 0; step < tierDelays.length; step++) {
      if (!isCurrent() || !reel.isConnected) return;
      reel.style.transform = `translateX(${-landingAt(Math.round(winnerIndex * (step + 1) / tierDelays.length))}px)`;
      await pause(tierDelays[step]);
    }
    reel.style.transform = `translateX(${-landingAt(winnerIndex)}px)`;
  } else {
  const animation = reel.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-landingAt(winnerIndex)}px)` }], { duration: 4600 + Math.round(Math.random() * 900), easing: 'cubic-bezier(.12,.72,.12,1)', fill: 'forwards' });
  await animation.finished;
  }
  if (!isCurrent() || !reel.isConnected) return;
  (reel.children[winnerIndex] || reel.children[0]).classList.add('is-pulled');
}
async function pullCase(visit) {
  if (!account) return;
  const owner = account.id, box = accountCatalog.cases.find(box => box.id === accountSelectedCase);
  const storageKey = `justizguessr:pending-case:${owner}:${box.id}`;
  let requestId; try { requestId = localStorage.getItem(storageKey); } catch {}
  requestId ||= crypto.randomUUID(); try { localStorage.setItem(storageKey, requestId); } catch {}
  const result = await accountApi('cases/open', { caseId: box.id, requestId, revision: accountCatalog.revision });
  try { localStorage.removeItem(storageKey); } catch {}
  if (account?.id !== owner) return;
  updateAccount(result.user); accountResult = null;
  if (visit !== accountVisit) return;
  renderAccountPage();
  caseOpening = visit;
  try {
  const reel = accountContent.querySelector('.case-reel'), viewport = accountContent.querySelector('.case-window'), resultNode = accountContent.querySelector('.case-result');
  resultNode.innerHTML = `<h2>${t('Revealing…', 'Wird aufgedeckt …')}</h2>`;
  await spinCaseReel(reel, viewport, result.item, box.items, () => visit === accountVisit && account?.id === owner);
  if (visit !== accountVisit || !reel.isConnected) return;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  resultNode.innerHTML = `<h2>${rarityLabel(result.item.rarity)}</h2><p>${t('Opening your find…', 'Dein Fund wird enthüllt …')}</p>`;
  await pause(750);
  if (visit !== accountVisit || !reel.isConnected || account?.id !== owner) return;
  accountResult = result.item;
  resultNode.innerHTML = resultMarkup();
  revealCaseItem();
  } finally { caseOpening = null; }
}
document.addEventListener('click', event => {
  const link = event.target.closest('a[data-page]');
  if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  dismissNotificationToast(link.closest('.notification-toast'));
  closeNotificationPanel();
  if (typeof closeSidebar === 'function') closeSidebar();
  if (link.pathname === '/') renderStart(); else navigateAccountPage(link.pathname + link.search);
});
document.addEventListener('click', async event => {
  const control = event.target.closest('[data-notification]');
  if (!control) return;
  const action = control.dataset.notification;
  if (action === 'dismiss') { dismissNotificationToast(control.closest('.notification-toast')); return; }
  if (action === 'close') { closeNotificationPanel(); notificationButton.focus({ preventScroll: true }); return; }
  if (action !== 'toggle' || !account) return;
  if (!notificationPanel.hidden) { closeNotificationPanel(); return; }
  await loadNotifications(false);
  notificationToasts.replaceChildren();
  notificationPanel.hidden = false;
  notificationButton.setAttribute('aria-expanded', 'true');
  notificationPanel.querySelector('[data-notification="close"]').focus({ preventScroll: true });
  if (notificationUnreadCount) {
    try {
      await accountApi('notifications/read', { ids: 'all' });
      const readAt = Date.now();
      accountNotifications = accountNotifications.map(entry => entry.readAt ? entry : { ...entry, readAt });
      notificationUnreadCount = 0; renderNotificationPanel();
    } catch { /* Keep the unread state so the action can be retried. */ }
  }
});
window.addEventListener('popstate', () => { if (accountPaths.includes(location.pathname)) navigateAccountPage(location.pathname, false); else renderStart(); });
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-account]'); if (!button || accountBusy) return;
  const action = button.dataset.account, visit = accountVisit;
  if (action === 'refresh') { await navigateAccountPage(currentAccountPage, false); return; }
  accountBusy = true; button.disabled = true;
  try {
    if (action === 'logout') {
      await accountApi('logout', {}); updateAccount(null); accountDailyRun = null; higherLowerRequest++; higherLowerRun = null;
      accountResult = null; freshCodes = []; accountItems = []; accountCodes = []; accountFriends = { friends: [], date: '' };
      await navigateAccountPage('/login');
    }
    if (action === 'select-case') { accountSelectedCase = button.dataset.id; accountResult = null; renderAccountPage(); }
    if (action === 'close-reveal') caseReveal.close();
    if (action === 'pull') { caseReveal.close(); await pullCase(visit); }
    if (action === 'sell' || action === 'sell-all' || action === 'sell-result') {
      const owner = account.id, result = await accountApi(action === 'sell-all' ? 'inventory/sell-all' : 'inventory/sell', { id: button.dataset.id });
      if (account?.id !== owner) return;
      updateAccount(result.user); if (accountResult?.id === button.dataset.id) accountResult.sold = true;
      const soldIds = new Set(Array.isArray(result.sold) ? result.sold : [result.sold]);
      accountItems = accountItems.filter(item => !soldIds.has(item.id));
      if (visit === accountVisit) { renderAccountPage(); if (caseReveal.open) revealCaseItem(); showToast(t(`${justizEuro(result.value)} added.`, `${justizEuro(result.value)} gutgeschrieben.`)); }
    }
    if (action === 'revoke') { await accountApi('codes/revoke', { id: button.dataset.id }); if (visit === accountVisit) await navigateAccountPage('/admin', false); }
    if (action === 'grant-user') {
      const owner = account.id, amount = Number(accountContent.querySelector('#grant-amount')?.value);
      const key = `justizguessr:pending-user-grant:${owner}:${button.dataset.id}:${amount}`;
      let requestId; try { requestId = localStorage.getItem(key); } catch {}
      requestId ||= crypto.randomUUID(); try { localStorage.setItem(key, requestId); } catch {}
      const result = await accountApi('admin/grant-user-tokens', { userId: button.dataset.id, amount, requestId });
      try { localStorage.removeItem(key); } catch {}
      if (account?.id !== owner) return;
      updateAccount(result.user);
      if (visit === accountVisit) { await navigateAccountPage('/admin', false); showToast(t(`Gave ${justizEuro(result.grant.amount)} to ${result.grant.username}.`, `${result.grant.username} hat ${justizEuro(result.grant.amount)} erhalten.`)); }
    }
    if (action === 'auction-detail') {
      const result = await accountApi(`admin/auctions/${button.dataset.id}`);
      if (visit === accountVisit) { renderAuctionDetail(result.auction); if (!auctionReveal.open) auctionReveal.showModal(); }
    }
    if (action === 'auction-page') { accountAuctions.page += Number(button.dataset.step); await loadAuctionBrowser(visit); }
    if (action === 'close-auction') auctionReveal.close();
    if (action === 'ban-toggle') {
      const banned = button.dataset.banned !== 'true';
      const result = await accountApi('admin/ban', { userId: button.dataset.id, banned });
      if (visit === accountVisit) { await navigateAccountPage('/admin', false); showToast(banned ? t(`${result.ban.username} has been banned.`, `${result.ban.username} wurde gesperrt.`) : t(`${result.ban.username} can log in again.`, `${result.ban.username} kann sich wieder anmelden.`)); }
    }
    if (action === 'friend-accept' || action === 'friend-remove') {
      const result = await accountApi(action === 'friend-accept' ? 'friends/accept' : 'friends/remove', { id: button.dataset.id });
      if (visit === accountVisit) { accountFriends = result; renderAccountPage(); }
    }
    if (action === 'page') { accountInventoryPage += Number(button.dataset.step); renderAccountPage(); }
  } catch (error) {
    if (visit === accountVisit) { if (error.code === 'catalog_changed') await navigateAccountPage('/shop', false); showToast(error.message); }
  } finally {
    accountBusy = false; if (button.isConnected) button.disabled = false;
    const pull = accountContent.querySelector('[data-account="pull"]');
    if (pull) { const box = accountCatalog.cases.find(box => box.id === accountSelectedCase); pull.disabled = !account || account.tokens < box.cost || !box.available; }
  }
});
document.addEventListener('submit', async event => {
  if (!event.target.matches('#account-form, #code-form, #friend-form, #grant-form, #reset-economy-form')) return;
  event.preventDefault(); if (accountBusy) return; accountBusy = true;
  const visit = accountVisit, form = event.target, page = currentAccountPage, button = form.querySelector('button[type="submit"]'); button.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(form));
    if (form.id === 'account-form') {
      const result = await accountApi(page === '/register' ? 'register' : 'login', data);
      updateAccount(result.user); accountDailyRun = null; higherLowerRequest++; higherLowerRun = null; accountResult = null; freshCodes = [];
      if (visit === accountVisit) await navigateAccountPage('/profile');
    } else if (form.id === 'friend-form') {
      const result = await accountApi('friends/request', { username: data.username.trim() });
      if (visit === accountVisit) { accountFriends = result; renderAccountPage(); }
    } else if (form.id === 'grant-form') {
      const amount = Number(data.amount), key = `justizguessr:pending-grant:${account.id}:${amount}`;
      let requestId; try { requestId = localStorage.getItem(key); } catch {}
      requestId ||= crypto.randomUUID(); try { localStorage.setItem(key, requestId); } catch {}
      const result = await accountApi('admin/grant-tokens', { amount, requestId });
      try { localStorage.removeItem(key); } catch {}
      updateAccount(result.user);
      if (visit === accountVisit) { await navigateAccountPage('/admin', false); showToast(t(`Gave ${justizEuro(result.grant.amount)} each to ${result.grant.recipients} existing players.`, `${result.grant.recipients} bestehende Spieler haben je ${justizEuro(result.grant.amount)} erhalten.`)); }
    } else if (form.id === 'reset-economy-form') {
      const result = await accountApi('admin/reset-economy', { confirmation: data.confirmation });
      updateAccount(result.user); accountDailyRun = null; higherLowerRequest++; higherLowerRun = null;
      accountResult = null; accountItems = [];
      if (visit === accountVisit) {
        await navigateAccountPage('/admin', false);
        showToast(t(`Economy reset for ${number(result.reset.playerCount)} accounts. Logins are unchanged.`, `Wirtschaft für ${number(result.reset.playerCount)} Konten zurückgesetzt. Anmeldungen bleiben unverändert.`));
      }
    } else {
      const result = await accountApi('codes', { count: Number(data.count) });
      if (visit === accountVisit) { freshCodes = result.codes; await navigateAccountPage('/admin', false); }
    }
  } catch (error) {
    if (visit === accountVisit) { const node = form.querySelector('.account-error'); if (node) node.textContent = error.message; else showToast(error.message); }
  } finally { accountBusy = false; if (button.isConnected) button.disabled = false; }
});
document.addEventListener('change', event => { if (event.target.id === 'rarity-filter') { accountFilter = event.target.value; accountInventoryPage = 0; renderAccountPage(); } });
document.addEventListener('input', event => {
  if (event.target.id === 'user-search') {
    adminUserFilter = event.target.value;
    const list = document.querySelector('#user-list');
    if (list) list.innerHTML = adminUserListMarkup();
  }
  if (event.target.id === 'auction-search') {
    accountAuctions.query = event.target.value; accountAuctions.page = 1;
    clearTimeout(auctionSearchTimer);
    auctionSearchTimer = setTimeout(() => loadAuctionBrowser(accountVisit), 300);
  }
});
document.addEventListener('jg:language', () => {
  updateNavigation();
  renderNotificationPanel();
  if (currentAccountPage && pageLoaded) {
    const inputs = [...accountContent.querySelectorAll('input')].map(input => ({ name: input.name, value: input.value }));
    renderAccountPage();
    for (const { name, value } of inputs) { const input = [...accountContent.querySelectorAll('input')].find(input => input.name === name); if (input) input.value = value; }
  }
});
updateNavigation();
