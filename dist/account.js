let accountAdminMarket = { categories: [], presets: [], history: [] };
let accountStore = null;
let account = null, accountCatalog = null, accountItems = [], accountCodes = [], freshCodes = [], freshPasswordReset = null;
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
const accountPaths = ['/auctions', '/marketplace', '/market', '/businesses', '/stores', '/town', '/shop', '/inventory', '/profile', '/login', '/register', '/admin', '/leaderboard'];
const accountPage = document.querySelector('#account-page');
const accountContent = document.querySelector('#account-content');
const notificationButton = document.querySelector('#notification-button');
const notificationPanel = document.querySelector('#notification-panel');
const notificationList = notificationPanel.querySelector('.notification-list');
const notificationToasts = document.querySelector('#notification-toasts');
const accountEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function accountError(code) {
  const errors = {
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
    market_adjustment_limit: t('This would exceed the manual adjustment range. Reset this category first.', 'Damit wird der Bereich für manuelle Änderungen überschritten. Setze diese Kategorie zuerst zurück.'),
    invalid_market_adjustment: t('Choose a valid percentage change.', 'Wähle eine gültige prozentuale Änderung.'),
    own_store: t('Choose another player’s store for this action.', 'Wähle für diese Aktion den Laden eines anderen Spielers.'),
    store_price_changed: t('The shelf price changed. Refresh the store and try again.', 'Der Regalpreis hat sich geändert. Lade den Laden neu und versuche es erneut.'),
    store_risk_changed: t('The theft fee or odds changed. Check the updated offer before starting.', 'Die Diebstahlgebühr oder Chance hat sich geändert. Prüfe das aktualisierte Angebot vor dem Start.'),
    stock_not_found: t('This item has left the shelf. Refresh the store.', 'Dieser Artikel ist nicht mehr im Regal. Lade den Laden neu.'),
    purchase_required: t('Buy something here before leaving a review.', 'Kaufe hier etwas, bevor du eine Bewertung abgibst.'),
    invalid_store_review: t('Choose 1–5 stars and keep your review under 240 characters.', 'Wähle 1–5 Sterne und schreibe höchstens 240 Zeichen.'),
    invalid_store_profile: t('Use up to 60 characters for the name and 140 for the tagline.', 'Nutze höchstens 60 Zeichen für den Namen und 140 für den Spruch.'),
    heist_cooldown: t('The coast isn’t clear yet. Wait for the cooldown.', 'Die Luft ist noch nicht rein. Warte die Abklingzeit ab.'),
    heist_not_ready: t('Watch the whole sequence before making your move.', 'Sieh dir die ganze Folge an, bevor du loslegst.'),
    heist_not_found: t('This attempt is no longer available.', 'Dieser Versuch ist nicht mehr verfügbar.'),
    guard_permanent: t('Your goose guard is already hired permanently.', 'Deine Wachgans ist schon dauerhaft eingestellt.'),
    invalid_plot: t('Choose a valid plot on the town map.', 'Wähle ein gültiges Grundstück auf dem Stadtplan.'),
    plot_not_found: t('This plot does not exist.', 'Dieses Grundstück gibt es nicht.'),
    plot_occupied: t('Someone just took this plot. Choose another location.', 'Jemand hat dieses Grundstück gerade gekauft. Wähle einen anderen Standort.'),
    plot_size_mismatch: t('Store size is fixed by the plot.', 'Die Ladengröße wird vom Grundstück festgelegt.'),
    no_available_plot: t('No free plot of this size remains. Check the town map.', 'Kein freies Grundstück dieser Größe mehr verfügbar. Sieh auf dem Stadtplan nach.'),
    town_migration_capacity: t('There are more existing stores than town plots. An administrator needs to resolve the map capacity.', 'Es gibt mehr bestehende Läden als Grundstücke. Ein Administrator muss die Stadtkapazität klären.'),
    store_limit_reached: t('You can own at most 3 stores.', 'Du kannst höchstens 3 Läden besitzen.'),
    invalid_store_events: t('Could not dismiss store events. Try again.', 'Ladenereignisse konnten nicht geschlossen werden. Versuche es erneut.'),
    business_not_found: t('This store is no longer available.', 'Dieser Laden ist nicht mehr verfügbar.'),
    invalid_heist_moves: t('Repeat all six arrows before finishing.', 'Wiederhole alle sechs Pfeile, bevor du abschließt.'),
    insufficient_tokens: t('You do not have enough J€.', 'Du hast nicht genug J€.'),
    try_later: t('Too many attempts. Try again later.', 'Zu viele Versuche. Versuche es später erneut.'),
    forbidden: t('This action is not allowed.', 'Diese Aktion ist nicht erlaubt.'),
    daily_reset: t('A new Daily is here. Please reload.', 'Ein neues Daily ist da. Bitte lade neu.'),
    daily_case_not_found: t('This Daily case is not available. Reopen your Daily result.', 'Diese Daily-Kiste ist nicht verfügbar. Öffne dein Daily-Ergebnis erneut.'),
    daily_case_already_opened: t('This Daily reward was already opened.', 'Diese Daily-Belohnung wurde bereits geöffnet.'),
    case_not_found: t('This case is no longer in your inventory.', 'Diese Kiste ist nicht mehr in deinem Inventar.'),
    invalid_profit_margin: t('Choose a profit margin from 0% to 100%.', 'Wähle eine Gewinnspanne von 0 % bis 100 %.'),
    insufficient_variety: t('Not enough different auctions are available.', 'Noch nicht genug unterschiedliche Auktionen verfügbar.'),
    answer_conflict: t('This guess was already made in another tab. Reopen the game.', 'Dieser Tipp wurde in einem anderen Tab abgegeben. Öffne das Spiel erneut.'),
    empty_catalog: t('No case contents are available yet.', 'Aktuell sind keine Kisteninhalte verfügbar.'),
    catalog_changed: t('Case price or contents changed. Review the refreshed offer and try again.', 'Preis oder Inhalt der Kiste wurde aktualisiert. Prüfe das neue Angebot und versuche es erneut.'),
    user_not_found: t('That username was not found.', 'Dieser Benutzername wurde nicht gefunden.'),
    friend_self: t('You cannot add yourself.', 'Du kannst dich nicht selbst hinzufügen.'),
    friend_limit: t('The limit of 100 friends and pending requests has been reached.', 'Das Limit von 100 Freunden und offenen Anfragen wurde erreicht.'),
    friend_request_not_found: t('That request is no longer available. Refresh your profile.', 'Diese Anfrage ist nicht mehr verfügbar. Aktualisiere dein Profil.'),
    invalid_grant_amount: t('Enter a whole J€ amount from 1 to 1,000,000.', 'Gib einen ganzen J€-Betrag von 1 bis 1.000.000 ein.'),
    invalid_grant_user: t('Choose a user to receive the J€.', 'Wähle einen Benutzer aus, der die J€ erhalten soll.'),
    request_conflict: t('This request was already used with different values.', 'Diese Anfrage wurde bereits mit anderen Werten verwendet.'),
    invalid_reset_confirmation: t('Type RESET ECONOMY exactly to confirm.', 'Gib zur Bestätigung exakt RESET ECONOMY ein.'),
    password_change_required: t('Set a new password to continue.', 'Setze ein neues Passwort, um fortzufahren.'),
    temporary_password_used: t('The temporary password was already used for its one login. Ask an admin to reset your password again.', 'Das temporäre Passwort wurde bereits für seine eine Anmeldung verwendet. Lass dein Passwort vom Admin erneut zurücksetzen.'),
    no_password_change_pending: t('There is no password change pending.', 'Es steht keine Passwortänderung aus.'),
    wrong_password: t('That is not your current password.', 'Das ist nicht dein aktuelles Passwort.'),
    account_banned: t('This account has been banned.', 'Dieses Konto wurde gesperrt.'),
    item_listed: t('This item is listed in a resale auction.', 'Dieser Gegenstand ist in einer Verkaufsauktion gelistet.'),
    quantity_unavailable: t('That many matching items are no longer available.', 'So viele passende Gegenstände sind nicht mehr verfügbar.'),
    item_sold: t('This item has already been sold.', 'Dieser Gegenstand wurde bereits verkauft.'),
    invalid_listing: t('This listing is not valid. Check price and end time.', 'Diese Auktion ist ungültig. Prüfe Startpreis und Endzeit.'),
    auction_not_found: t('This auction is no longer available.', 'Diese Auktion ist nicht mehr verfügbar.'),
    auction_ended: t('This auction has ended.', 'Diese Auktion ist beendet.'),
    auction_has_bids: t('This auction already has bids and cannot be cancelled.', 'Diese Auktion hat bereits Gebote und kann nicht storniert werden.'),
    own_auction: t('You cannot bid on your own auction.', 'Du kannst nicht auf deine eigene Auktion bieten.'),
    bid_too_low: t('That bid is below the next minimum bid shown in the form.', 'Das Gebot liegt unter dem nächsten Mindestgebot aus dem Formular.'),
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
const seenSidebarEntries = new Set();
const sidebarSeenKey = entry => `jg:sidebar-seen:${entry}`;
function sidebarEntrySeen(entry) {
  if (seenSidebarEntries.has(entry)) return true;
  try { return localStorage.getItem(sidebarSeenKey(entry)) === '1'; } catch { return false; }
}
function markSidebarEntrySeen(link) {
  const entry = link.dataset.newEntry;
  if (!entry || sidebarEntrySeen(entry)) return;
  seenSidebarEntries.add(entry);
  try { localStorage.setItem(sidebarSeenKey(entry), '1'); } catch {}
  updateNavigation();
}
function updateNavigation() {
  const labels = { '/': 'Daily', '/shop': t('Case Store', 'Kisten-Shop'), '/auctions': t('Palette Auctions', 'Paletten-Auktionen'), '/marketplace': t('Marketplace', 'Marktplatz'), '/market': t('Stock Market', 'Aktienmarkt'), '/businesses': t('Businesses', 'Geschaefte'), '/stores': t('Visit stores', 'Läden besuchen'), '/town': t('Town map', 'Stadtplan'), '/inventory': t('Inventory', 'Inventar'), '/leaderboard': t('Leaderboard', 'Rangliste'), '/profile': t('Profile', 'Profil'), '/admin': 'Admin' };
  for (const link of document.querySelectorAll('.site-nav a')) {
    if (link.id !== 'header-auth') {
      link.textContent = labels[link.getAttribute('href')];
      const isNew = Boolean(link.dataset.newEntry && !sidebarEntrySeen(link.dataset.newEntry));
      link.classList.toggle('has-new-tag', isNew);
      if (isNew) {
        const tag = document.createElement('span');
        tag.className = 'nav-new-tag'; tag.textContent = t('NEW', 'NEU');
        link.append(tag);
      }
    }
    if (link.pathname === location.pathname) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    if (link.dataset.feature) link.hidden = !economyFlags[link.dataset.feature];
    if (link.pathname === '/admin') link.hidden = !account?.admin;
  }
  const auth = document.querySelector('#header-auth');
  auth.href = account ? '/profile' : '/login';
  auth.textContent = account ? account.username : t('Log in / Register', 'Anmelden / Registrieren');
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
    // The open inbox already shows fresh entries in the same top-right area;
    // avoid stacking transient notification toasts over the panel.
    if (showFresh && notificationPanel.hidden) for (const entry of result.fresh || []) showNotificationToast(entry);
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
  document.querySelector('.daily-case-dialog')?.close();
  window.economyUi?.stop();
  window.businessUi?.stop();
  window.storeUi?.stop();
  window.townUi?.stop();
  currentAccountPage = null; accountVisit++; pageLoaded = false;
  accountPage.hidden = true; document.querySelector('#app').hidden = false;
  if (location.pathname !== '/') history.pushState({}, '', '/');
  updateNavigation();
}
async function navigateAccountPage(path, push = true) {
  const destination = new URL(path, location.origin);
  path = destination.pathname;
  caseReveal.close(); auctionReveal.close();
  document.querySelector('.daily-case-dialog')?.close();
  window.economyUi?.stop();
  window.businessUi?.stop();
  window.storeUi?.stop();
  window.townUi?.stop();
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
    const session = await accountApi('me');
    if (visit !== accountVisit) return;
    updateAccount(session.user);
    // Skip every page loader while a temporary password still needs replacing.
    if (account?.mustChangePassword) {
      pageLoaded = true; renderAccountPage();
      accountContent.querySelector('h1')?.focus({ preventScroll: true });
      return;
    }
    const owner = account?.id;
    if (window.economyUi?.isRoute(path)) {
      await window.economyUi.load(path, visit);
      if (visit !== accountVisit) return;
    }
    if (path === '/businesses') {
      await window.businessUi.load(visit);
      if (visit !== accountVisit) return;
    }
    if (path === '/town') { await window.townUi.load(visit); if (visit !== accountVisit) return; }
    if (path === '/stores') { await window.storeUi.load(visit); if (visit !== accountVisit) return; }
    if (path === '/shop') {
      const store = await accountApi('case-store'); if (visit !== accountVisit) return; accountStore = store;
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
      const [codes, admin, auctionPage, market] = await Promise.all([accountApi('codes'), accountApi('admin'), accountApi(auctionQuery), accountApi('admin/market')]);
      if (visit !== accountVisit || account?.id !== owner) return;
      accountCodes = codes.codes; accountAdmin = admin; accountAdminMarket = market; accountAuctions = { query: accountAuctions.query || '', ...auctionPage };
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
function economyOverviewMarkup() {
  if (!account) return '';
  return `<section class="economy-overview" aria-label="${t('Economy overview', 'Wirtschaftsübersicht')}">
    <div class="economy-overview-primary"><span>${t('AVAILABLE J€', 'VERFÜGBARE J€')}</span><strong>${justizEuro(account.tokens)}</strong></div>
    <div><span>${t('ACTIVE BIDS', 'AKTIVE GEBOTE')}</span><strong>${number(account.activeBids || 0)}</strong></div>
    <div><span>${t('INVENTORY VALUE', 'INVENTARWERT')}</span><strong>${justizEuro(account.inventoryMarketValue || 0)}</strong></div>
  </section>`;
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
  // A temporary password from an admin reset allows exactly one thing next.
  if (account?.mustChangePassword) { renderPasswordChange(); return; }
  if (window.economyUi?.isRoute(currentAccountPage)) window.economyUi.render();
  else if (currentAccountPage === '/businesses') window.businessUi.render();
  else if (currentAccountPage === '/town') window.townUi.render();
  else if (currentAccountPage === '/stores') window.storeUi.render();
  else if (currentAccountPage === '/shop') renderShop();
  else if (currentAccountPage === '/inventory') renderInventory();
  else if (currentAccountPage === '/profile') renderProfile();
  else if (currentAccountPage === '/admin') renderAdmin();
  else if (currentAccountPage === '/leaderboard') renderLeaderboard();
  else renderAuth();
}
// Forced one-time view after signing in with an admin-issued temporary
// password: the session cannot do anything else until a real password is set.
function renderPasswordChange() {
  accountContent.innerHTML = pageHeading(t('Set a new password', 'Neues Passwort setzen')) +
    `<form id="password-change-form" class="account-form"><p role="status">${t('You signed in with a temporary password from an administrator. It worked for this one login only — set a new password now to keep using your account.', 'Du hast dich mit einem temporären Passwort eines Admins angemeldet. Es galt nur für diese eine Anmeldung — setze jetzt ein neues Passwort, um dein Konto weiterzuverwenden.')}</p>
    <label>${t('Temporary password', 'Temporäres Passwort')}<input name="currentPassword" type="password" autocomplete="current-password" required minlength="12" maxlength="128"></label>
    <label>${t('New password', 'Neues Passwort')}<input name="newPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128"></label>
    <p>${t('Passwords need at least 12 characters.', 'Passwörter benötigen mindestens 12 Zeichen.')}</p>
    <p class="account-error" role="alert"></p><button class="primary-button" type="submit">${t('Save new password', 'Neues Passwort speichern')}</button>
    <button class="text-button" type="button" data-account="logout">${t('Log out', 'Abmelden')}</button></form>`;
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
  const availableCount = copies.filter(copy => !copy.listed).length;
  if (item.kind === 'case') {
    const caseStyle = item.caseType ? `case-design-${accountEscape(item.caseType)}` : `rarity-${accountEscape(item.caseTier)}`;
    const caseLabel = item.caseType ? t('Sealed case', 'Versiegelte Kiste') : `${rarityLabel(item.caseTier)} ${t('case', 'Kiste')}`;
    const chosen = available || item;
    const listId = accountEscape(chosen.id);
    const price = Math.max(1, Math.round((chosen.estimatedValueTokens || item.price) * .7));
    return `<article class="collection-item sealed-case-item ${caseStyle}"><span class="rarity-label">${caseLabel}</span>${copies.length > 1 ? `<span class="item-count" aria-label="${availableCount} ${t('available copies', 'verfügbare Exemplare')}">×${availableCount}</span>` : ''}
      <div class="sealed-case-art" aria-hidden="true"><span>◇</span><b>${item.caseType ? accountEscape(item.caseBadge || 'JG') : rarityLabel(item.caseTier)}</b></div><h3>${accountEscape(t(item.title, item.titleDe || item.title))}</h3><p>${t('One mystery item · any category', 'Ein geheimer Gegenstand · jede Kategorie')}</p><p>${t('Case value', 'Kistenwert')} · ${justizEuro(item.estimatedValueTokens || item.price)}</p>
      ${controls ? `<div class="item-actions"><button class="primary-button" data-account="open-inventory-case" data-id="${listId}" ${available ? '' : 'disabled'}>${t('Open case', 'Kiste öffnen')}</button>${economyFlags.resales ? `<button class="secondary-button" data-economy="list" data-id="${listId}" ${available ? '' : 'disabled'}>${t('List for auction', 'Zur Auktion anbieten')}</button><button class="secondary-button" data-economy="quick-list" data-id="${listId}" data-price="${price}" ${available ? '' : 'disabled'}>${t('Quick list', 'Schnell anbieten')}<small>@ ${justizEuro(price)}</small></button>` : ''}</div>` : ''}</article>`;
  }
  // Market-adjusted display value, capped at two decimals so a scaled index
  // never renders amounts like J€ 11.248.
  const marketValue = item.marketIndex == null ? null : Math.round(item.price * item.marketIndex) / 100;
  const marketDelta = marketValue == null ? null : Math.round(item.marketIndex) - 100;
  const marketDeltaBadge = marketDelta ? `<span class="market-delta ${marketDelta > 0 ? 'is-up' : 'is-down'}" title="${t('Market movement since the last update', 'Marktbewegung seit der letzten Aktualisierung')}">${marketDelta > 0 ? '↑ +' : '↓ −'}${Math.abs(marketDelta)}%</span>` : '';
  const valueLine = marketValue == null
    ? `${t('Auction value', 'Auktionswert')} ${euro(item.price)}`
    : `${t('Market value', 'Marktwert')} ${justizEuro(marketValue)} ${marketDeltaBadge}`;
  const listId = accountEscape(available?.id || item.id);
  // Same default the listing dialog pre-fills: 70% of the estimated market value.
  const quickPrice = Math.max(1, Math.round((available || item).estimatedValueTokens * .7 || 1));
  const resaleControls = `<div class="item-actions"><button class="primary-button" data-economy="list" data-id="${listId}" ${available ? '' : 'disabled'}>${available ? t('List for auction', 'Zur Auktion anbieten') : t('Already listed', 'Bereits angeboten')}</button><button class="secondary-button" data-economy="quick-list" data-id="${listId}" data-price="${quickPrice}" ${available ? '' : 'disabled'}>${t('Quick list', 'Schnell anbieten')}<small>@ ${justizEuro(quickPrice)}</small></button></div>`;
  return `<article class="collection-item rarity-${accountEscape(item.rarity)}"><span class="rarity-label">${rarityLabel(item.rarity)}</span>${copies.length > 1 ? `<span class="item-count" aria-label="${availableCount} ${t('available copies', 'verfügbare Exemplare')}">×${availableCount}</span>` : ''}
    ${item.image ? `<img src="${accountEscape(item.image)}" alt="" loading="lazy">` : `<div class="collection-item-placeholder stock-${accountEscape(item.businessCategory || 'other')}" aria-hidden="true"><span>${accountEscape(({ wine: 'VIN', toys: 'TOY', electronics: 'TECH', cars: 'AUTO' })[item.businessCategory] || 'JG')}</span></div>`}<h3>${accountEscape(item.title)}</h3><p>${valueLine}</p>${item.estimatedValueTokens == null ? '' : `<p>${t('Estimated market value', 'Geschätzter Marktwert')} · ${justizEuro(item.estimatedValueTokens)}</p>`}
    ${economyFlags.resales && controls ? resaleControls : controls ? copies.length > 1 ? `<div class="item-actions"><button class="secondary-button" data-account="sell" data-id="${accountEscape(copies[0].id)}">${t('Sell one', 'Eins verkaufen')}<small>+${justizEuro(item.sellValue)}</small></button><button class="secondary-button" data-account="sell-all" data-id="${accountEscape(copies[0].id)}">${t('Sell all', 'Alle verkaufen')}<small>+${justizEuro(item.sellValue * copies.length)}</small></button></div>` : `<button class="secondary-button" data-account="sell" data-id="${accountEscape(item.id)}">${t('Sell', 'Verkaufen')} · ${justizEuro(item.sellValue)}</button>` : `<span class="item-value">${justizEuro(item.sellValue)}</span>`}</article>`;
}
function groupedInventory(items) {
  const groups = new Map();
  for (const item of items) {
    const key = JSON.stringify([item.kind, item.caseType, item.caseTier, item.auctionId, item.title, item.image, item.price, item.rarity, item.sellValue]);
    if (!groups.has(key)) groups.set(key, { ...item, copies: [] });
    groups.get(key).copies.push(item);
  }
  return [...groups.values()];
}
function renderInventory() {
  accountContent.innerHTML = pageHeading(t('Inventory', 'Inventar'), t('List items on the marketplace or keep them in your collection.', 'Biete Gegenstände auf dem Marktplatz an oder behalte sie in deiner Sammlung.')) + economyOverviewMarkup();
  if (!account) { accountContent.innerHTML += loginNotice('inventory'); return; }
  const filtered = groupedInventory(accountItems.filter(item => accountFilter === 'all' || item.rarity === accountFilter));
  accountInventoryPage = Math.min(accountInventoryPage, Math.max(0, Math.ceil(filtered.length / 24) - 1));
  accountContent.innerHTML += accountValueMarkup() + `<div class="inventory-heading"><div class="section-title-row"><h2>${t('Collection', 'Sammlung')} <small>${accountItems.length} ${accountItems.length === 1 ? t('item', 'Los') : t('items', 'Lose')}</small></h2></div><label>${t('Rarity', 'Seltenheit')} <select id="rarity-filter"><option value="all">${t('All', 'Alle')}</option>${accountCatalog.rarities.map(rarity => `<option value="${rarity.id}" ${accountFilter === rarity.id ? 'selected' : ''}>${rarityLabel(rarity.id)}</option>`).join('')}</select></label></div>
    ${filtered.length ? `<div class="inventory-grid">${filtered.slice(accountInventoryPage * 24, (accountInventoryPage + 1) * 24).map(item => itemCard(item)).join('')}</div><div class="inventory-pages"><button data-account="page" data-step="-1" ${accountInventoryPage ? '' : 'disabled'}>← ${t('Previous', 'Zurück')}</button><span>${accountInventoryPage + 1} / ${Math.ceil(filtered.length / 24)}</span><button data-account="page" data-step="1" ${(accountInventoryPage + 1) * 24 >= filtered.length ? 'disabled' : ''}>${t('Next', 'Weiter')} →</button></div>` : `<div class="collection-empty"><h2>${t('Your next find belongs here.', 'Hier wartet dein nächster Fund.')}</h2><p>${economyFlags.paletteAuctions ? t('Buy a case or win a Mystery Palette to start your collection, or try another rarity filter.', 'Kaufe eine Kiste, gewinne eine Mystery-Palette oder wähle einen anderen Seltenheitsfilter.') : t('Open a case to start your collection, or try another rarity filter.', 'Öffne eine Kiste für deine Sammlung oder wähle einen anderen Seltenheitsfilter.')}</p><a class="primary-button" href="/shop" data-page>${t('Visit the case store', 'Zum Kisten-Shop')} →</a></div>`}`;
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
  const rewards = accountCatalog?.rewards || { daily: 200, dailyScoreBonus: 150, higherLowerMax: 250 };
  const daily = account.rewardsByMode?.daily?.earned || 0;
  const higherLower = account.rewardsByMode?.['higher-lower']?.earned || 0;
  return t(`Daily pays ${justizEuro(rewards.daily)}–${justizEuro(rewards.daily + (rewards.dailyScoreBonus || 0))} plus one case. Higher or Lower pays up to ${justizEuro(rewards.higherLowerMax)} separately; better streaks pay the difference. Earned today: ${justizEuro(daily + higherLower)}. Resets at 00:00 UTC.`,
    `Das Daily zahlt ${justizEuro(rewards.daily)}–${justizEuro(rewards.daily + (rewards.dailyScoreBonus || 0))} und eine Kiste. Higher or Lower zahlt separat bis zu ${justizEuro(rewards.higherLowerMax)}; bessere Serien zahlen die Differenz. Heute verdient: ${justizEuro(daily + higherLower)}. Reset um 00:00 UTC.`);
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
    <div class="user-row-actions">${user.admin ? '' : `<button data-account="ban-toggle" data-id="${accountEscape(user.id)}" data-banned="${user.banned ? 'true' : 'false'}">${user.banned ? t('Unban', 'Entsperren') : t('Ban', 'Sperren')}</button><button data-account="password-reset" data-id="${accountEscape(user.id)}">${t('Reset password', 'Passwort zurücksetzen')}</button>`}<button data-account="grant-user" data-id="${accountEscape(user.id)}">${t('Give J€', 'J€ geben')}</button></div>
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
function adminMarketMarkup() {
  return `<section class="admin-section admin-market" id="admin-market-section"><h2>${t('Market controls', 'Marktsteuerung')}</h2>
    <p>${t('Change current category prices by the selected percentage. Changes compound and persist while the market keeps moving. Reset removes the manual adjustment for that category.', 'Ändere aktuelle Kategoriepreise um den gewählten Prozentsatz. Änderungen wirken nacheinander und bleiben bestehen, während sich der Markt weiterbewegt. Zurücksetzen entfernt die manuelle Änderung für diese Kategorie.')}</p>
    <div class="admin-market-categories">${accountAdminMarket.categories.map(category => {
      const change = (category.multiplier - 1) * 100;
      return `<article class="admin-market-category" data-market-category="${accountEscape(category.id)}"><div><h3 tabindex="-1">${accountEscape(t(category.name, category.nameDe))}</h3>
      <p>${t('Current index', 'Aktueller Index')}: <strong>${number(category.currentIndex, 2)}</strong> · ${t('Manual adjustment', 'Manuelle Änderung')}: <strong>${change > 0 ? '+' : ''}${number(change, 2)}%</strong></p></div>
      <div class="admin-market-controls" role="group" aria-label="${accountEscape(t(category.name, category.nameDe))}">${accountAdminMarket.presets.map(percent => {
        const next = category.multiplier * (1 + percent / 100);
        return `<button type="button" class="${percent < 0 ? 'market-decrease' : 'market-increase'}" data-account="market-adjust" data-category="${accountEscape(category.id)}" data-percent="${percent}" ${accountBusy || next < .001 || next > 100 ? 'disabled' : ''} aria-label="${accountEscape(t(category.name, category.nameDe))} ${percent > 0 ? '+' : ''}${percent}%">${percent > 0 ? '+' : ''}${percent}%</button>`;
      }).join('')}<button type="button" data-account="market-reset" data-category="${accountEscape(category.id)}" ${accountBusy || category.multiplier === 1 ? 'disabled' : ''}>${t('Reset', 'Zurücksetzen')}</button></div></article>`;
    }).join('')}</div>
    <details class="admin-market-history"><summary>${t('Recent adjustments', 'Letzte Änderungen')}</summary>${accountAdminMarket.history.length ? accountAdminMarket.history.map(entry => {
      const category = accountAdminMarket.categories.find(category => category.id === entry.category);
      return `<p>${new Date(entry.createdAt).toLocaleString(uiLocale())} · ${accountEscape(entry.username || '')} · ${accountEscape(category ? t(category.name, category.nameDe) : entry.category)} · ${entry.action === 'reset' ? t('Reset', 'Zurücksetzen') : `${entry.percent > 0 ? '+' : ''}${number(entry.percent)}%`} · ${number(entry.beforeIndex, 2)} → ${number(entry.afterIndex, 2)}</p>`;
    }).join('') : `<p>${t('No manual adjustments yet.', 'Noch keine manuellen Änderungen.')}</p>`}</details></section>`;
}
async function applyAdminMarketChange(button, visit) {
  if (!account?.admin) return;
  const owner = account.id, category = button.dataset.category;
  const action = button.dataset.account === 'market-reset' ? 'reset' : 'adjust';
  const percent = action === 'adjust' ? Number(button.dataset.percent) : null;
  const key = `justizguessr:pending-market-adjustment:${owner}:${category}:${action}:${percent}`;
  let requestId; try { requestId = localStorage.getItem(key); } catch {}
  requestId ||= crypto.randomUUID(); try { localStorage.setItem(key, requestId); } catch {}
  for (const control of accountContent.querySelectorAll('.admin-market-controls button')) control.disabled = true;
  const result = await accountApi('admin/market/adjust', { category, action, percent, requestId });
  try { localStorage.removeItem(key); } catch {}
  if (account?.id !== owner) return;
  updateAccount(result.user);
  if (visit !== accountVisit) return;
  accountAdminMarket = result.market;
  showToast(t('Market adjustment applied.', 'Marktänderung angewendet.'));
}
function renderAdmin() {
  accountContent.innerHTML = pageHeading(t('Admin', 'Adminbereich'));
  if (!account?.admin) { accountContent.innerHTML += `<p class="collection-empty">${t('Log in with an admin account to access this page.', 'Melde dich mit einem Adminkonto an, um diese Seite zu nutzen.')}</p>`; return; }
  accountContent.innerHTML += adminMarketMarkup() + `<section class="admin-section"><div class="section-title-row"><h2>${t('Players', 'Spieler')}</h2>${infoTip(t(`Search all ${accountAdmin.playerCount} players to grant J€ or change access. Banned players are signed out immediately.`, `Durchsuche alle ${accountAdmin.playerCount} Spieler, um J€ zu vergeben oder den Zugang zu ändern. Gesperrte Spieler werden sofort abgemeldet.`))}</div>
    <div class="admin-toolbar"><label>${t('Search', 'Suche')}<input id="user-search" type="search" autocomplete="off" placeholder="${t('Username', 'Benutzername')}" value="${accountEscape(adminUserFilter)}"></label><label>${t('J€ per grant', 'J€ pro Gutschrift')}<input id="grant-amount" type="number" min="1" max="1000000" step="1" value="100"></label></div>
    <div id="user-list" class="user-list">${adminUserListMarkup()}</div>
    ${freshPasswordReset ? `<label class="fresh-codes">${t(`Temporary password for ${freshPasswordReset.username} — copy it now, it is shown only once and works for exactly one login`, `Temporäres Passwort für ${freshPasswordReset.username} — jetzt kopieren, es wird nur einmal angezeigt und gilt für genau eine Anmeldung`)}<textarea readonly rows="2">${freshPasswordReset.temporaryPassword}</textarea></label>` : ''}
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
  if (!accountStore) return;
  accountContent.innerHTML = pageHeading(t('Case Store', 'Kisten-Shop')) +
    `<div class="case-store-intro"><p>${t('Five mystery cases, always in stock. More expensive cases improve your chances of rarer finds. Buy with J€ and open from your inventory.', 'Fünf Überraschungskisten, immer auf Lager. Teurere Kisten erhöhen deine Chancen auf seltenere Funde. Kaufe mit J€ und öffne sie aus deinem Inventar.')}</p><a class="secondary-button" href="/inventory" data-page>${t('Go to inventory', 'Zum Inventar')} →</a></div>
    <div class="shop-balance">${account ? `${justizEuro(account.tokens)} ${t('available', 'verfügbar')}` : `<a href="/login" data-page>${t('Log in to buy cases', 'Zum Kistenkauf anmelden')} →</a>`}</div>
    <p class="shop-edition"><span>${t('DAILY CONTENTS', 'TAGESINHALTE')} · ${accountStore.rotationDate}</span>${infoTip(t('Contents refresh at 00:00 UTC. Prices follow the market. Purchased cases keep their sealed contents.', 'Inhalte wechseln um 00:00 UTC. Preise folgen dem Markt. Gekaufte Kisten behalten ihre versiegelten Inhalte.'))}</p>
    <div class="case-store-grid">${accountStore.cases.map(box => `<article class="case-store-card case-design-${accountEscape(box.id)}">
      <span class="case-store-art" aria-hidden="true">◇<b>${accountEscape(box.badge)}</b></span><span class="case-store-stock">${t('Always in stock', 'Immer auf Lager')}</span>
      <h2>${accountEscape(t(box.name, box.nameDe))}</h2><p>${t('One mystery item · every rarity possible', 'Ein geheimer Gegenstand · jede Seltenheit möglich')}</p>
      <strong class="case-store-price">${justizEuro(box.cost)}</strong>
      ${account ? `<button class="primary-button" data-account="buy-case" data-id="${accountEscape(box.id)}" ${accountBusy || account.tokens < box.cost ? 'disabled' : ''}>${t('Buy case', 'Kiste kaufen')}</button>${account.tokens < box.cost ? `<small class="case-store-shortfall">${t(`You need ${justizEuro(box.cost - account.tokens)} more`, `Dir fehlen ${justizEuro(box.cost - account.tokens)}`)}</small>` : ''}` : `<a class="primary-button" href="/login" data-page>${t('Log in to buy', 'Zum Kaufen anmelden')}</a>`}
      <dl class="case-store-chances" aria-label="${t('Drop chances', 'Fundchancen')}">${box.dropChances.map(chance => `<div><dt class="rarity-${accountEscape(chance.rarity)}">${rarityLabel(chance.rarity)}</dt><dd>${number(chance.percent, 2)}%</dd></div>`).join('')}</dl>
      <details class="case-store-contents"><summary>${t('Possible contents', 'Mögliche Inhalte')} · ${number(box.items.length)}</summary><ul>${box.items.map(item => `<li><span>${accountEscape(item.title)}</span><small class="rarity-${accountEscape(item.rarity)}">${rarityLabel(item.rarity)}</small></li>`).join('')}</ul></details>
    </article>`).join('')}</div>
    <p class="data-note">${t('Digital collectibles. J€ has no cash value. Each case contains one item; its value can be lower than the purchase price.', 'Digitale Sammelobjekte. J€ hat keinen Geldwert. Jede Kiste enthält einen Gegenstand; sein Wert kann unter dem Kaufpreis liegen.')}</p>`;
  if (!economyFlags.paletteAuctions) {
    const storeMarkup = accountContent.innerHTML;
    renderLegacyShop();
    accountContent.innerHTML = storeMarkup + `<section class="case-store-legacy">${accountContent.innerHTML}</section>`;
  }
}
async function buyStoreCase(caseId, visit) {
  if (!account) return;
  const owner = account.id, key = `justizguessr:pending-case-purchase:${owner}:${caseId}`;
  let requestId; try { requestId = localStorage.getItem(key); } catch {}
  requestId ||= crypto.randomUUID(); try { localStorage.setItem(key, requestId); } catch {}
  const result = await accountApi('cases/buy', { caseId, requestId, revision: accountStore.revision });
  try { localStorage.removeItem(key); } catch {}
  if (account?.id !== owner) return;
  updateAccount(result.user);
  if (visit !== accountVisit) return;
  renderAccountPage();
  showToast(t(`${t(result.item.title, result.item.titleDe)} added to inventory.`, `${t(result.item.title, result.item.titleDe)} zum Inventar hinzugefügt.`));
}
function renderLegacyShop() {
  const box = accountCatalog.cases.find(box => box.id === accountSelectedCase) || accountCatalog.cases[0];
  accountSelectedCase = box.id;
  const caseName = box => t(box.name, box.nameDe || box.name);
  const result = accountResult?.caseId === box.id ? accountResult : null;
  accountContent.innerHTML = pageHeading(t('Themed cases', 'Themen-Kisten')) +
    `<div class="shop-balance">${account ? `${justizEuro(account.tokens)} ${t('available', 'verfügbar')}` : `${t('Browse the cases. Log in to earn J€ and open one.', 'Entdecke die Kisten. Melde dich an, um J€ zu verdienen und eine zu öffnen.')} <a href="/login" data-page>${t('Log in', 'Anmelden')} →</a>`}</div>
    <p class="shop-edition"><span>${t('DAILY EDITION', 'TAGESAUSGABE')} · ${accountCatalog.rotationDate}</span>${infoTip(t('New finds at 00:00 UTC. Contents stay fixed; prices follow the market.', 'Neue Fundstücke um 00:00 UTC. Die Inhalte bleiben gleich; Preise folgen dem Markt.'), t('Edition timing', 'Ausgabenwechsel'))}</p>
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
  if (!link) return;
  markSidebarEntrySeen(link);
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  dismissNotificationToast(link.closest('.notification-toast'));
  closeNotificationPanel();
  if (typeof closeSidebar === 'function') closeSidebar();
  if (link.pathname === '/') renderStart(); else navigateAccountPage(link.pathname + link.search);
});
document.addEventListener('auxclick', event => {
  if (event.button === 1) {
    const link = event.target.closest('.site-nav a[data-new-entry]');
    if (link) markSidebarEntrySeen(link);
  }
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
      accountResult = null; freshCodes = []; freshPasswordReset = null; accountItems = []; accountCodes = []; accountFriends = { friends: [], date: '' };
      await navigateAccountPage('/login');
    }
    if (action === 'select-case') { accountSelectedCase = button.dataset.id; accountResult = null; renderAccountPage(); }
    if (action === 'close-reveal') caseReveal.close();
    if (action === 'market-adjust' || action === 'market-reset') await applyAdminMarketChange(button, visit);
    if (action === 'buy-case') await buyStoreCase(button.dataset.id, visit);
    if (action === 'pull') { caseReveal.close(); await pullCase(visit); }
    if (action === 'open-inventory-case') {
      const owner = account.id;
      const result = await accountApi('inventory/case/open', { id: button.dataset.id });
      if (account?.id !== owner) return;
      updateAccount(result.user);
      accountItems = (await accountApi('inventory')).items;
      if (visit !== accountVisit || account?.id !== owner) return;
      renderAccountPage();
      caseReveal.innerHTML = `<div class="case-reveal-content rarity-${accountEscape(result.item.rarity)}"><h2 id="case-reveal-title">${t('Opening case…', 'Kiste wird geöffnet …')}</h2><div class="case-window"><div class="case-marker"></div><div class="case-reel"></div></div></div>`;
      caseReveal.showModal();
      const pool = accountCatalog?.cases?.find(box => box.id === 'fundkiste')?.items || [result.item];
      try { await spinCaseReel(caseReveal.querySelector('.case-reel'), caseReveal.querySelector('.case-window'), result.item,
        pool.length ? pool : [result.item], () => caseReveal.open && visit === accountVisit && account?.id === owner); }
      catch { /* The awarded item is already in inventory; still show it. */ }
      if (visit !== accountVisit || account?.id !== owner || !caseReveal.open) return;
      caseReveal.innerHTML = `<div class="case-reveal-content rarity-${accountEscape(result.item.rarity)}"><h2 id="case-reveal-title">${accountEscape(result.item.title)}</h2>${result.item.image ? `<img src="${accountEscape(result.item.image)}" alt="">` : ''}<p class="rarity-label">${rarityLabel(result.item.rarity)}</p><p>${t('Auction value', 'Auktionswert')} ${euro(result.item.price)}</p><p>${t('Added to inventory.', 'Zum Inventar hinzugefügt.')}</p><div class="case-reveal-actions"><button class="primary-button" data-account="close-reveal">${t('Continue to inventory', 'Weiter zum Inventar')}</button></div></div>`;
      caseReveal.querySelector('[data-account="close-reveal"]').focus({ preventScroll: true });
    }
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
    if (action === 'password-reset') {
      // Replaces the account password with a one-time temporary one and signs
      // the player out everywhere; the plaintext is shown once, like codes.
      const result = await accountApi('admin/password-reset', { userId: button.dataset.id });
      freshPasswordReset = result.reset;
      if (visit === accountVisit) {
        await navigateAccountPage('/admin', false);
        showToast(t(`Temporary password for ${result.reset.username} created. The player must set a new password after their next login.`, `Temporäres Passwort für ${result.reset.username} erstellt. Der Spieler muss nach der nächsten Anmeldung ein neues Passwort setzen.`));
      }
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
    if ((action === 'market-adjust' || action === 'market-reset') && visit === accountVisit) {
      const section = accountContent.querySelector('#admin-market-section');
      if (section) {
        section.outerHTML = adminMarketMarkup();
        const row = accountContent.querySelector(`[data-market-category="${button.dataset.category}"]`);
        const replacement = row?.querySelector(`[data-account="${action}"]${action === 'market-adjust' ? `[data-percent="${button.dataset.percent}"]` : ''}`);
        (replacement && !replacement.disabled ? replacement : row?.querySelector('h3'))?.focus({ preventScroll: true });
      }
    }
    for (const buy of accountContent.querySelectorAll('[data-account="buy-case"]')) {
      const offer = accountStore?.cases.find(box => box.id === buy.dataset.id);
      buy.disabled = !account || !offer || account.tokens < offer.cost;
    }
    const pull = accountContent.querySelector('[data-account="pull"]');
    if (pull) { const box = accountCatalog.cases.find(box => box.id === accountSelectedCase); pull.disabled = !account || account.tokens < box.cost || !box.available; }
  }
});
document.addEventListener('submit', async event => {
  if (!event.target.matches('#account-form, #code-form, #friend-form, #grant-form, #reset-economy-form, #password-change-form')) return;
  event.preventDefault(); if (accountBusy) return; accountBusy = true;
  const visit = accountVisit, form = event.target, page = currentAccountPage, button = form.querySelector('button[type="submit"]'); button.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(form));
    if (form.id === 'account-form') {
      const result = await accountApi(page === '/register' ? 'register' : 'login', data);
      updateAccount(result.user); accountDailyRun = null; higherLowerRequest++; higherLowerRun = null; accountResult = null; freshCodes = [];
      if (visit === accountVisit) await navigateAccountPage('/profile');
    } else if (form.id === 'password-change-form') {
      const result = await accountApi('password/change', { currentPassword: data.currentPassword, newPassword: data.newPassword });
      updateAccount(result.user); accountDailyRun = null; higherLowerRequest++; higherLowerRun = null; accountResult = null; accountItems = [];
      if (visit === accountVisit) {
        await navigateAccountPage('/profile');
        showToast(t('New password saved. Your account is back to normal.', 'Neues Passwort gespeichert. Dein Konto ist wieder normal nutzbar.'));
      }
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
