let accountAdminMarket = { categories: [], presets: [], history: [] };
let accountRevision = 0;
let accountStore = null;
let caseStockRequest = 0;
let accountSelectedStoreCase = 'lost-property';
let account = null, accountCatalog = null, accountItems = [], accountCodes = [], freshCodes = [], freshPasswordReset = null;
let accountStatistics = null;
let accountCriminalRecord = { records:[],total:0,totalPenalties:0,hasMore:false };
let accountFriends = { friends: [], date: '' }, accountAdmin = { playerCount: 0, users: [], grants: [], lastReset: null };
let accountLeaderboard = { date: '', leaders: [] }, adminUserFilter = '';
let adminActiveTab = 'market', adminMarketFilter = '';
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
  for (const animation of caseReveal.querySelector('.case-reel')?.getAnimations() || []) animation.cancel();
  if (currentAccountPage === '/shop') (accountContent.querySelector('[data-account="buy-case"]') || accountContent.querySelector('[data-account="pull"]'))?.focus({ preventScroll: true });
  else if (currentAccountPage === '/inventory') accountContent.querySelector('h1')?.focus({ preventScroll: true });
});
let accountSelectedCase = 'fundkiste', accountInventoryPage = 0, accountFilter = 'all';
let currentAccountPage = null, accountVisit = 0, pageLoaded = false;
const accountPaths = ['/auction-house', '/auctions', '/marketplace', '/market', '/businesses', '/stores', '/town', '/shop', '/palettes', '/skills', '/inventory', '/profile', '/login', '/register', '/admin', '/leaderboard', '/changelog'];
const accountPage = document.querySelector('#account-page');
const accountContent = document.querySelector('#account-content');
const notificationButton = document.querySelector('#notification-button');
const notificationPanel = document.querySelector('#notification-panel');
const notificationList = notificationPanel.querySelector('.notification-list');
const notificationToasts = document.querySelector('#notification-toasts');
const accountEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function accountError(code) {
  const errors = {
    invalid_review_stars: t('Choose a star rating from 1 to 5.', 'Wähle eine Bewertung von 1 bis 5 Sternen.'),
    invalid_review_pack: t('Choose a review pack and a store.', 'Wähle ein Bewertungspaket und einen Laden.'),
    review_pack_not_found: t('This review pack is not available.', 'Dieses Bewertungspaket ist nicht verfügbar.'),
    review_pack_used: t('This review pack was already redeemed.', 'Dieses Bewertungspaket wurde bereits eingelöst.'),
    review_pack_redeem_only: t('Redeem these reviews for a store or list the pack for auction.', 'Löse diese Bewertungen für einen Laden ein oder versteigere das Paket.'),
    insufficient_skill_points:t('You need more skill points to unlock this rank.','Du brauchst mehr Skillpunkte, um diesen Rang freizuschalten.'),
    skill_rank_changed:t('This skill changed in another tab. Your tree has been refreshed.','Dieser Skill wurde in einem anderen Tab geändert. Dein Baum wurde aktualisiert.'),
    skill_coming_soon:t('This skill is coming soon.','Dieser Skill kommt bald.'),
    instant_sell_disabled: t('List this item in the Auction House to sell it.', 'Biete diesen Gegenstand im Auktionshaus an.'),
    mischief_disabled: t('This owner has disabled player mischief. You can buy the item instead.', 'Dieser Laden erlaubt keinen Spielerunfug. Du kannst den Gegenstand kaufen.'),
    level_required: t('Your level is too low for this palette. Complete Daily games and sell items to earn XP.', 'Dein Level ist für diese Palette zu niedrig. Spiele Daily und verkaufe Gegenstände für XP.'),
    store_level_required: t('Your level is too low for this store size. Choose a smaller store or earn XP through Daily and trading.', 'Dein Level ist für diese Ladengröße zu niedrig. Wähle einen kleineren Laden oder verdiene XP mit Daily und Handel.'),
    palette_auction_ended: t('This auction has ended. Check My bids.', 'Diese Auktion ist beendet. Sieh unter Meine Gebote nach.'),
    rewards_unavailable: t('Rewards become available after settlement.', 'Gewinne werden nach der Abrechnung verfügbar.'),
    palette_rewards_not_found: t('Only the winner can reveal this palette.', 'Nur der Gewinner kann diese Palette aufdecken.'),
    invalid_username: t('Use 3–32 letters, numbers, underscores or hyphens.', 'Nutze 3–32 Buchstaben, Zahlen, Unterstriche oder Bindestriche.'),
    invalid_password: t('Passwords must contain 12–128 characters.', 'Das Passwort muss 12–128 Zeichen lang sein.'),
    invalid_login: t('Incorrect username or password.', 'Benutzername oder Passwort ist falsch.'),
    invalid_code: t('This code is invalid or already used.', 'Dieser Code ist ungültig oder bereits verwendet.'),
    username_taken: t('That username is already taken.', 'Dieser Benutzername ist bereits vergeben.'),
    login_required: t('Please sign in again.', 'Bitte melde dich erneut an.'),
    own_review: t('You cannot like your own review.', 'Du kannst deine eigene Bewertung nicht liken.'),
    review_not_found: t('This review is no longer available. Refresh the store.', 'Diese Bewertung ist nicht mehr verfügbar. Lade den Laden neu.'),
    invalid_store_reaction: t('Choose a valid reaction.', 'Wähle eine gültige Reaktion.'),
    own_store: t('Choose another player’s store for this action.', 'Wähle für diese Aktion den Laden eines anderen Spielers.'),
    store_price_changed: t('The shelf price changed. Refresh the store and try again.', 'Der Regalpreis hat sich geändert. Lade den Laden neu und versuche es erneut.'),
    store_risk_changed: t('The theft fine changed. Check the updated amount before starting.', 'Das Diebstahlbußgeld hat sich geändert. Prüfe den aktualisierten Betrag vor dem Start.'),
    stock_not_found: t('This item has left the shelf. Refresh the store.', 'Dieser Artikel ist nicht mehr im Regal. Lade den Laden neu.'),
    purchase_required: t('Buy something here before leaving a review.', 'Kaufe hier etwas, bevor du eine Bewertung abgibst.'),
    invalid_store_review: t('Choose 1–5 stars and keep your review under 240 characters.', 'Wähle 1–5 Sterne und schreibe höchstens 240 Zeichen.'),
    store_settings_changed: t('Settings changed elsewhere. Reload the saved settings before applying your changes.', 'Einstellungen wurden anderswo geändert. Lade die gespeicherten Einstellungen neu.'),
    prestige_level_required: t('Reach level 10 before Prestiging.','Erreiche vor Prestige Level 10.'),
    prestige_changed: t('Your Prestige state changed. Refresh your profile.','Dein Prestige-Status hat sich geändert. Aktualisiere dein Profil.'),
    prestige_buff_owned: t('You already own this permanent buff.','Du besitzt diesen dauerhaften Bonus bereits.'),
    prestige_auction_pending: t('Finish auctions with committed bids before Prestiging.','Schließe Auktionen mit verbindlichen Geboten vor Prestige ab.'),
    prestige_heist_pending: t('Finish active theft attempts before Prestiging.','Schließe aktive Diebstahlversuche vor Prestige ab.'),
    prestige_justice_pending: t('Settle fines and finish your sentence before Prestiging.','Begleiche Bußgelder und verbüße deine Haftstrafe vor Prestige.'),
    invalid_prestige: t('Choose an available Prestige buff.','Wähle einen verfügbaren Prestige-Bonus.'),
    invalid_prestige_confirmation: t('Confirm the account reset.','Bestätige den Konto-Reset.'),
    invalid_store_profile: t('Use up to 60 characters for the name and 140 for the tagline.', 'Nutze höchstens 60 Zeichen für den Namen und 140 für den Spruch.'),
    heist_cooldown: t('The coast isn’t clear yet. Wait for the cooldown.', 'Die Luft ist noch nicht rein. Warte die Abklingzeit ab.'),
    heist_not_ready: t('This paid attempt is not ready yet. Resume it in a moment.', 'Dieser bezahlte Versuch ist noch nicht bereit. Setze ihn gleich fort.'),
    police_spin_not_ready: t('The police wheel is available after a blackjack loss.', 'Das Polizeirad ist nach einer Blackjack-Niederlage verfügbar.'),
    heist_not_found: t('This attempt is no longer available.', 'Dieser Versuch ist nicht mehr verfügbar.'),
    invalid_plot: t('Choose a valid plot on the town map.', 'Wähle ein gültiges Grundstück auf dem Stadtplan.'),
    plot_not_found: t('This plot does not exist.', 'Dieses Grundstück gibt es nicht.'),
    plot_occupied: t('Someone just took this plot. Choose another location.', 'Jemand hat dieses Grundstück gerade gekauft. Wähle einen anderen Standort.'),
    plot_size_mismatch: t('Store size is fixed by the plot.', 'Die Ladengröße wird vom Grundstück festgelegt.'),
    no_available_plot: t('No free plot of this size remains. Check the town map.', 'Kein freies Grundstück dieser Größe mehr verfügbar. Sieh auf dem Stadtplan nach.'),
    town_migration_capacity: t('There are more existing stores than town plots. An administrator needs to resolve the map capacity.', 'Es gibt mehr bestehende Läden als Grundstücke. Ein Administrator muss die Stadtkapazität klären.'),
    store_limit_reached: t('You can own at most 3 stores.', 'Du kannst höchstens 3 Läden besitzen.'),
    invalid_store_events: t('Could not dismiss store events. Try again.', 'Ladenereignisse konnten nicht geschlossen werden. Versuche es erneut.'),
    business_not_found: t('This store is no longer available.', 'Dieser Laden ist nicht mehr verfügbar.'),
    insufficient_tokens: t('You do not have enough J€.', 'Du hast nicht genug J€.'),
    case_out_of_stock: t('This case is sold out globally. Check the next refill time.', 'Diese Kiste ist weltweit ausverkauft. Prüfe den nächsten Auffülltermin.'),
    try_later: t('Too many attempts. Try again later.', 'Zu viele Versuche. Versuche es später erneut.'),
    forbidden: t('This action is not allowed.', 'Diese Aktion ist nicht erlaubt.'),
    daily_reset: t('A new Daily is here. Please reload.', 'Ein neues Daily ist da. Bitte lade neu.'),
    daily_case_not_found: t('This Daily case is not available. Reopen your Daily result.', 'Diese Daily-Kiste ist nicht verfügbar. Öffne dein Daily-Ergebnis erneut.'),
    daily_case_already_opened: t('This Daily reward was already opened.', 'Diese Daily-Belohnung wurde bereits geöffnet.'),
    case_not_found: t('This case is no longer in your inventory.', 'Diese Kiste ist nicht mehr in deinem Inventar.'),
    invalid_profit_margin: t('Choose a markup over market estimate from 0% to 100%.', 'Wähle einen Aufschlag auf die Marktschätzung von 0 % bis 100 %.'),
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
    invalid_blackjack_action:t('Choose Hit or Stand.','Wähle Ziehen oder Halten.'),
    blackjack_turn_changed:t('Your hand changed in another tab. Reloading it.','Dein Blatt wurde in einem anderen Tab geändert. Es wird neu geladen.'),
    player_jailed:t('Your account is locked until your jail sentence ends.','Dein Konto ist bis zum Ende der Haftstrafe gesperrt.'),
    unpaid_fine:t('Pay your outstanding fine before attempting another theft.','Begleiche dein offenes Bußgeld vor einem weiteren Diebstahl.'),
    heist_active:t('Finish your current theft attempt first.','Beende zuerst deinen laufenden Diebstahlversuch.'),
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
  if (!response.ok) { const error = new Error(accountError(result.error)); error.code = result.error; if(result.justice&&account){account.justice=result.justice;window.justiceUi?.sync(account);} throw error; }
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
function sidebarLinkMarkup(route, label) {
  const icons = {
    '/': '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 5 2 2 4-4"/>',
    '/leaderboard': '<path d="M8 3h8v7a4 4 0 0 1-8 0V3Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v5m-4 2h8m-10 0h12"/>',
    '/marketplace': '<path d="M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4"/>',
    '/auction-house': '<path d="m13 3 8 8-4 4-8-8 4-4Zm-4 4L5 11l4 4 4-4m-2 2-8 8M15 21h7m-6-4h5v4"/>',
    '/auctions': '<path d="m13 3 8 8-4 4-8-8 4-4Zm-4 4L5 11l4 4 4-4m-2 2-8 8M15 21h7m-6-4h5v4"/>',
    '/skills': '<path d="M12 21V10m0 6L5 9m7 7 7-7M5 9V4m14 5V4m-7 6V3"/><circle cx="5" cy="3" r="2"/><circle cx="19" cy="3" r="2"/><circle cx="12" cy="3" r="2"/>',
    '/palettes': '<path d="m3 8 9-4 9 4v10l-9 3-9-3V8Zm0 0 9 4 9-4m-9 4v9M7 6l9 4v10M2 21h20"/>',
    '/shop': '<path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4m-9 4v10M7.5 5 17 9"/>',
    '/market': '<path d="M3 3v18h18M7 15l4-5 4 3 6-8m-5 0h5v5"/>',
    '/inventory': '<path d="M9 5V3h6v2m-8 0h10a3 3 0 0 1 3 3v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a3 3 0 0 1 3-3Z"/><rect x="7" y="12" width="10" height="6" rx="1"/><path d="M8 8h8m-4 4v2"/>',
    '/town': '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16"/>',
    '/businesses': '<path d="M3 10V5h18v5m-18 0 2-6m2 6 1-6m4 6V4m5 6-1-6m5 6-2-6M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 13v8h14v-8m-9 8v-6h4v6"/>',
    '/stores': '<path d="M3 11V5h14v6M3 5l-1 6a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 6 0l-1-6M4 14v7h7m-3-4v4m6-4h8m-3-3 3 3-3 3"/>',
    '/skills': '<circle cx="12" cy="4" r="2"/><circle cx="5" cy="20" r="2"/><circle cx="19" cy="20" r="2"/><circle cx="12" cy="20" r="2"/><path d="M12 6v12m-7 0v-6h14v6"/>',
    '/profile': '<circle cx="12" cy="8" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3"/>',
    '/login': '<path d="M14 3h6v18h-6M3 12h12m-4-4 4 4-4 4"/>',
    '/changelog': '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8m-8 5h8m-8 5h5"/>',
    '/admin': '<path d="M5 3v4m0 4v10m7-18v10m0 4v4m7-18v4m0 4v10"/><circle cx="5" cy="9" r="2"/><circle cx="12" cy="15" r="2"/><circle cx="19" cy="9" r="2"/>'
  };
  return `<svg class="nav-icon" data-nav-icon="${accountEscape(route)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[route] || icons['/profile']}</svg><span class="nav-link-label">${accountEscape(label)}</span>`;
}
function renderPersistentWallet(user) {
  const wallet = document.getElementById('persistent-wallet');
  if (!wallet) return;
  wallet.hidden = !user;
  document.body.classList.toggle('has-wallet', Boolean(user));
  const amount = wallet.querySelector('#wallet-amount'), value = user ? justizEuro(user.tokens) : '';
  // Avoid repeated announcements; keep bid-dialog balances live without replacing input drafts.
  for (const node of [amount, ...document.querySelectorAll('[data-available-balance]')]) {
    if (node.textContent !== value) node.textContent = value;
  }
  if (!user) { wallet.removeAttribute('title'); wallet.removeAttribute('aria-label'); return; }
  wallet.querySelector('.wallet-label').textContent = t('Available', 'Verfügbar');
  wallet.setAttribute('aria-label', t('Available balance', 'Verfügbares Guthaben'));
  wallet.title = t(`${value} available to spend. Held bids and store registers are separate.`, `${value} zum Ausgeben verfügbar. Hinterlegte Gebote und Ladenkassen sind separat.`);
  wallet.classList.toggle('is-long', value.length > 17);
}
function updateNavigation() {
  renderPersistentProgression(account);
  renderPersistentWallet(account);
  const labels = { '/': 'Daily', '/shop': t('Case Store', 'Kisten-Shop'), '/palettes': t('Mystery palettes', 'Mystery-Paletten'), '/skills': t('Skill tree', 'Skillbaum'), '/auctions': t('Palette Auctions', 'Paletten-Auktionen'), '/auction-house': t('Auction House', 'Auktionshaus'), '/marketplace': t('Auction House', 'Auktionshaus'), '/market': t('Stock Market', 'Aktienmarkt'), '/businesses': t('Your stores', 'Deine Läden'), '/stores': t('Visit stores', 'Läden besuchen'), '/town': t('Town map', 'Stadtplan'), '/inventory': t('Inventory', 'Inventar'), '/leaderboard': t('Leaderboard', 'Rangliste'), '/profile': t('Profile', 'Profil'), '/admin': 'Admin', '/changelog': 'Changelog' };
  for (const link of document.querySelectorAll('.site-nav a')) {
    if (link.id !== 'header-auth') {
      link.innerHTML = sidebarLinkMarkup(link.getAttribute('href'), labels[link.getAttribute('href')] || link.textContent);
      if(link.pathname==='/skills' && account?.skills?.available){ const badge=document.createElement('span');badge.className='skill-nav-points';badge.textContent=account.skills.available;badge.setAttribute('aria-label',t(`${account.skills.available} skill points available`,`${account.skills.available} Skillpunkte verfügbar`));link.append(badge); }
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
  auth.innerHTML = sidebarLinkMarkup(auth.getAttribute('href'), account ? account.username : t('Log in / Register', 'Anmelden / Registrieren'));
  if (auth.pathname === location.pathname) auth.setAttribute('aria-current', 'page'); else auth.removeAttribute('aria-current');
  document.querySelector('[data-nav-label="play"]').textContent = t('Play', 'Spielen');
  document.querySelector('[data-nav-label="trading"]').textContent = t('Trading', 'Handel');
  document.querySelector('[data-nav-label="town"]').textContent = t('Town & stores', 'Stadt & Läden');
  document.querySelector('[data-nav-label="account"]').textContent = t('Account', 'Konto');
  for (const group of document.querySelectorAll('.nav-group')) group.hidden = ![...group.querySelectorAll('a')].some(link => !link.hidden);
  document.querySelector('.site-nav').setAttribute('aria-label', t('Main navigation', 'Hauptnavigation'));
  notificationButton.hidden = !account;
}

const notificationCopy = entry => entry.type === 'daily'
  ? { title: t('New Daily', 'Neues Daily'), body: '' }
  : { title: t(entry.titleEn, entry.titleDe), body: t(entry.bodyEn, entry.bodyDe) };
function updateNotificationBadge() {
  const badge = notificationButton.querySelector('.notification-badge');
  badge.textContent = notificationUnreadCount > 99 ? '99+' : String(notificationUnreadCount);
  badge.hidden = notificationUnreadCount < 1;
  notificationButton.setAttribute('aria-label', notificationUnreadCount
    ? t(`Notifications, ${notificationUnreadCount} unread`, `Benachrichtigungen, ${notificationUnreadCount} ungelesen`)
    : t('Notifications', 'Benachrichtigungen'));
}
function renderNotificationPanel() {
  notificationPanel.querySelector('h2').textContent = t('Notifications', 'Benachrichtigungen');
  notificationPanel.querySelector('[data-notification="close"]').setAttribute('aria-label', t('Close', 'Schließen'));
  notificationList.innerHTML = accountNotifications.length ? accountNotifications.map(entry => {
    const copy = notificationCopy(entry), tag = entry.href ? 'a' : 'article';
    const link = entry.href ? ` href="${accountEscape(entry.href)}" data-page` : '';
    return `<${tag} class="notification-entry${entry.readAt ? '' : ' is-unread'}"${link}><span class="notification-entry-dot" aria-hidden="true"></span><span><strong>${accountEscape(copy.title)}</strong>${copy.body ? `<p>${accountEscape(copy.body)}</p>` : ''}<time datetime="${new Date(entry.createdAt).toISOString()}">${new Date(entry.createdAt).toLocaleString(uiLocale())}</time></span></${tag}>`;
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
  node.innerHTML = `${entry.href ? `<a href="${accountEscape(entry.href)}" data-page aria-label="${accountEscape(copy.title)}"></a>` : ''}<strong>${accountEscape(copy.title)}</strong>${copy.body ? `<p>${accountEscape(copy.body)}</p>` : ''}<button type="button" data-notification="dismiss" aria-label="${t('Dismiss', 'Ausblenden')}">×</button>`;
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
    // Sales and refunds can settle on any page. Refresh money and XP together.
    if (showFresh && !document.hidden) {
      const revision = accountRevision, session = await accountApi('me');
      if (request === notificationRequest && account?.id === owner && revision === accountRevision) updateAccount(session.user);
    }
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
window.addEventListener('focus', () => loadNotifications(true));
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadNotifications(true); });
function giftToast(gifts) {
  const total = gifts.reduce((sum, gift) => sum + gift.amount, 0);
  return gifts.length === 1
    ? t(`You were given ${justizEuro(total)}.`, `Du hast ${justizEuro(total)} geschenkt bekommen.`)
    : t(`You were given ${justizEuro(total)} across ${gifts.length} gifts.`, `Du hast ${justizEuro(total)} aus ${gifts.length} Geschenken erhalten.`);
}
function updateAccount(user, progressionOptions) {
  // A delayed payment reply from before Prestige cannot restore old progress.
  if(user?.id===account?.id && (user?.prestige?.count||0)<(account?.prestige?.count||0)) return;
  if (account?.id !== user?.id || progressionOptions?.reset) accountStatistics=null;
  if (account?.id !== user?.id || progressionOptions?.reset) accountCriminalRecord = {records:[],total:0,totalPenalties:0,hasMore:false};
  account = user; accountRevision++;
  window.inventoryItemUi?.accountChanged(user);
  window.justiceUi?.sync(user);
  window.netWorthUi?.accountChanged();
  updatePersistentProgression(user, progressionOptions);
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
  window.storeReputationUi?.stop();
  if(account?.justice?.jailed){window.justiceUi?.sync(account);return;}
  caseReveal.close(); auctionReveal.close();
  if (typeof traderStockDialog !== 'undefined') traderStockDialog.close();
  document.querySelector('.daily-case-dialog')?.close();
  window.inventoryItemUi?.stop();
  window.netWorthUi?.stop();
  window.economyUi?.stop();
  window.paletteUi?.stop();
  window.skillsUi?.stop();
  window.businessUi?.stop();
  window.storeUi?.stop();
  window.townUi?.stop();
  currentAccountPage = null; accountVisit++; pageLoaded = false;
  accountPage.hidden = true; document.querySelector('#app').hidden = false;
  if (location.pathname !== '/') history.pushState({}, '', '/');
  updateNavigation();
}
async function navigateAccountPage(path, push = true) {
  window.storeReputationUi?.stop();
  const destination = new URL(path, location.origin);
  if(!push&&!path.includes('?')&&destination.pathname===location.pathname)destination.search=location.search;
  if(destination.pathname==='/palettes'){
    if(destination.searchParams.has('open'))destination.searchParams.set('open-palette',destination.searchParams.get('open'));
    if(destination.searchParams.has('auction'))destination.searchParams.set('reveal',destination.searchParams.get('auction'));
    if(destination.searchParams.has('category'))destination.searchParams.set('stock',destination.searchParams.get('category'));
    destination.searchParams.delete('open');destination.searchParams.delete('auction');destination.searchParams.delete('category');
    destination.pathname='/auction-house';destination.searchParams.set('type','mystery');
    if(!push)history.replaceState({},'',destination.pathname+destination.search);
  }
  if (destination.pathname === '/auctions' || destination.pathname === '/marketplace') {
    if (destination.pathname === '/auctions' && !destination.searchParams.has('type')) destination.searchParams.set('type', 'mystery');
    destination.pathname = '/auction-house';
    if (!push) history.replaceState({}, '', destination.pathname + destination.search);
  }
  path = destination.pathname;
  caseReveal.close(); auctionReveal.close();
  if (typeof traderStockDialog !== 'undefined') traderStockDialog.close();
  document.querySelector('.daily-case-dialog')?.close();
  window.inventoryItemUi?.stop();
  window.netWorthUi?.stop();
  window.economyUi?.stop();
  window.paletteUi?.stop();
  window.skillsUi?.stop();
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
    if (account?.justice?.jailed) {pageLoaded=true;window.justiceUi?.sync(account);return;}
    if (account?.mustChangePassword) {
      pageLoaded = true; renderAccountPage();
      accountContent.querySelector('h1')?.focus({ preventScroll: true });
      return;
    }
    const owner = account?.id;
    const opening=path==='/auction-house'&&(new URLSearchParams(location.search).has('reveal')||new URLSearchParams(location.search).has('open-palette'));
    if(opening){await window.paletteUi.load(visit);if(visit!==accountVisit)return;}
    if (!opening && window.economyUi?.isRoute(path)) {
      await window.economyUi.load(path, visit);
      if (visit !== accountVisit) return;
    }
    if (path === '/businesses') {
      await window.businessUi.load(visit);
      if (visit !== accountVisit) return;
    }
    if (path === '/town') { await window.townUi.load(visit); if (visit !== accountVisit) return; }
    if (path === '/stores') { await window.storeUi.load(visit); if (visit !== accountVisit) return; }
    if(path === '/skills') { await window.skillsUi.load(visit); if(visit!==accountVisit)return; }
    if (path === '/shop') {
      const store = await accountApi('case-store'); if (visit !== accountVisit) return; accountStore = store;
    }
    if (path === '/shop' || (path === '/inventory' && account)) {
      const catalog = await accountApi('cases'); if (visit !== accountVisit) return; updateAccountCatalog(catalog);
    }
    if (path === '/inventory' && account) {
      const [result, stores] = await Promise.all([accountApi('inventory?includeStores=1'), economyFlags.businesses ? accountApi('businesses') : null, window.marketTrendUi?.load(visit)]); if (visit !== accountVisit || account?.id !== owner) return; accountItems = result.items; traderStores = stores?.shops || [];
      await window.netWorthUi?.load(visit); if (visit !== accountVisit || account?.id !== owner) return;
      const focus = new URLSearchParams(location.search).get('focus');
      if (focus) { const query = new URLSearchParams(location.search); for (const key of ['state','category','rarity']) query.delete(key); history.replaceState({},'', '/inventory?'+query); accountInventoryPage = Math.max(0,Math.floor(groupedInventory(accountItems).findIndex(group=>group.copies.some(item=>item.id===focus))/24)); }
    }
    if (path === '/leaderboard') {
      const result = await accountApi('leaderboard?view=' + (new URLSearchParams(location.search).get('view') === 'collection' ? 'collection' : 'daily')); if (visit !== accountVisit) return; accountLeaderboard = result;
    }
    if (path === '/profile' && account) {
      const [friends, record, statistics] = await Promise.all([accountApi('friends'),accountApi('criminal-record'),accountApi('statistics')]);
      if (visit !== accountVisit || account?.id !== owner) return; accountFriends = friends; accountCriminalRecord = record; accountStatistics = statistics;
    }
    if (path === '/admin' && account?.admin) {
      const auctionQuery = `admin/auctions?query=${encodeURIComponent(accountAuctions.query || '')}&page=${accountAuctions.page}`;
      const [codes, admin, auctionPage, market] = await Promise.all([accountApi('codes'), accountApi('admin'), accountApi(auctionQuery), accountApi('admin/market')]);
      if (visit !== accountVisit || account?.id !== owner) return;
      accountCodes = codes.codes; accountAdmin = admin; accountAdminMarket = market; accountAuctions = { query: accountAuctions.query || '', ...auctionPage };
    }
    if (visit !== accountVisit) return;
    pageLoaded = true; renderAccountPage(); accountContent.querySelector('h1')?.focus({ preventScroll: true });
    if (path === '/inventory') {
      const query = new URLSearchParams(location.search), action = query.get('action'), id = query.get('focus');
      if (action && id) {
        query.delete('action'); history.replaceState({}, '', '/inventory?' + query);
        const selector = action === 'open' ? '[data-account="open-inventory-case"]' : action === 'list' ? '[data-economy="list"]' : '[data-trader="stock"]';
        if(action!=='open')window.inventoryItemUi?.open(id);
        const root=action==='open'?accountContent:document.querySelector('.inventory-item-dialog[open]')||accountContent;
        const button = [...root.querySelectorAll(selector)].find(entry => entry.dataset.id === id);
        if (button && !button.disabled) button.click();
      }
    }
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
    <div><span>${t('J€ HELD IN BIDS', 'J€ IN GEBOTEN')}</span><strong>${justizEuro(account.heldInBids || 0)}</strong></div>
    <div><span>${t('ESTIMATED STOCK VALUE', 'GESCHÄTZTER WARENWERT')}</span><strong>${justizEuro(account.inventoryMarketValue || 0)}</strong></div><div><span>${t('REALIZED TRADING PROFIT', 'REALISIERTER HANDELSGEWINN')}</span><strong>${justizEuro(account.realizedTradingProfit || 0)}</strong></div>
  </section><p class="data-note">${t('Reward proceeds', 'Belohnungserlöse')}: ${justizEuro(account.rewardProceeds || 0)} · ${t('Sales with unknown cost', 'Verkäufe mit unbekannten Kosten')}: ${number(account.unknownCostSales || 0)}. ${t('Profit covers tracked item sales; store investment and theft fines are separate. Estimates are not cash.', 'Gewinn umfasst erfasste Warenverkäufe; Ladeninvestitionen und Diebstahlbußgelder sind separat. Schätzwerte sind kein Guthaben.')}</p>`;
}
function loginNotice(subject) {
  return `<section class="collection-empty"><span aria-hidden="true">◇</span><h2>${t(`Log in to view your ${subject}.`, subject === 'inventory' ? 'Melde dich an, um dein Inventar zu sehen.' : 'Melde dich an, um dein Profil zu sehen.')}</h2><a class="primary-button" href="/login" data-page>${t('Log in', 'Anmelden')}</a></section>`;
}
function accountValueMarkup() {
  return `<div class="account-value"><span>${t('TOTAL ACCOUNT VALUE', 'GESAMTER KONTOWERT')}<strong>${euro(account.accountValueEur)}</strong></span>${infoTip(t(`Auction values of your collection (${account.itemCount} item${account.itemCount === 1 ? "" : "s"}). Justiz€ is not included in the euro value.`, `Auktionswerte deiner Sammlung (${account.itemCount} Lose). Justiz€ zählt nicht zum Eurowert.`), t('How account value is calculated', 'Berechnung des Kontowerts'))}</div>`;
}
function renderAccountPage() {
  if (account?.justice?.jailed){window.justiceUi?.sync(account);return;}
  if (!pageLoaded || !currentAccountPage) return;
  if (caseOpening === accountVisit && currentAccountPage === '/shop') return;
  // A temporary password from an admin reset allows exactly one thing next.
  if (account?.mustChangePassword) { renderPasswordChange(); return; }
  if(currentAccountPage==='/auction-house'&&window.paletteUi?.active())window.paletteUi.render();
  else if (window.economyUi?.isRoute(currentAccountPage)) window.economyUi.render();
  else if (currentAccountPage === '/businesses') window.businessUi.render();
  else if (currentAccountPage === '/town') window.townUi.render();
  else if (currentAccountPage === '/stores') window.storeUi.render();
  else if (currentAccountPage === '/skills') window.skillsUi.render();
  else if (currentAccountPage === '/shop') renderShop();
  else if (currentAccountPage === '/inventory') renderInventory();
  else if (currentAccountPage === '/profile') renderProfile();
  else if (currentAccountPage === '/admin') renderAdmin();
  else if (currentAccountPage === '/leaderboard') renderLeaderboard();
  else if (currentAccountPage === '/changelog') window.changelogUi.render();
  else renderAuth();
}
// Forced one-time view after signing in with an admin-issued temporary
// password: the session cannot do anything else until a real password is set.
function renderPasswordChange() {
  accountContent.innerHTML = pageHeading(t('Set a new password', 'Neues Passwort setzen')) +
    `<form id="password-change-form" class="account-form"><p role="status">${t('Your temporary password was valid for one login. Set a new password to continue.', 'Dein temporäres Passwort galt für eine Anmeldung. Setze ein neues Passwort, um fortzufahren.')}</p>
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
  if (controls && item.kind === 'review-pack' && window.storeReputationUi) return window.storeReputationUi.packCard(item);
  if(controls&&window.inventoryItemUi)return window.inventoryItemUi.card(item);
  const copies=item.copies||[item], available=copies.filter(copy=>!copy.listed&&!copy.storeId), chosen=available.find(copy=>copy.id===new URLSearchParams(location.search).get('focus'))||available[0]||item;
  const isCase=item.kind==='case', style=isCase&&item.caseType?'case-design-'+accountEscape(item.caseType):'rarity-'+accountEscape(item.rarity||item.caseTier||'common');
  const highlighted=new URLSearchParams(location.search).get('focus')===chosen.id;
  return `<article class="collection-item ${isCase?'sealed-case-item ':''}${style}${highlighted?' is-highlighted':''}"><span class="rarity-label">${isCase?t('Sealed case','Versiegelte Kiste'):rarityLabel(item.rarity)}</span>${copies.length>1?`<span class="item-count" aria-label="${available.length} ${t('available copies','verfügbare Exemplare')}">×${copies.length}</span>`:''}
    ${isCase?`<div class="sealed-case-art" aria-hidden="true">${caseArtwork(item)}</div>`:item.image?`<img src="${accountEscape(item.image)}" alt="" loading="lazy">`:'<div class="collection-item-placeholder" aria-hidden="true">◇</div>'}
    <h3>${accountEscape(t(item.title,item.titleDe||item.title))}</h3>${isCase?`<p>${t('One mystery item · any category','Ein geheimer Gegenstand · jede Kategorie')}</p>`:''}<p>${t('Estimated market value','Geschätzter Marktwert')} · ${justizEuro(item.estimatedValueTokens??item.price)}${item.marketIndex!=null?` · ${number(item.marketIndex-100,1)}% ${t('vs. normal','gegenüber normal')}</p>`:'</p>'}
    ${controls?traderItemFacts(chosen):''}${controls&&isCase?`<button class="primary-button" data-account="open-inventory-case" data-id="${accountEscape(chosen.id)}" ${available.length?'':'disabled'}>${t('Open case','Kiste öffnen')}</button>`:''}
    ${controls?traderItemActions(chosen,copies):''}${controls&&!economyFlags.resales&&available.length&&!isCase?`<button class="secondary-button" data-account="sell" data-id="${accountEscape(chosen.id)}">${t('Sell','Verkaufen')} · ${justizEuro(chosen.sellValue)}</button>`:''}</article>`;
}
function groupedInventory(items) {
  const groups = new Map();
  for (const item of items) {
    const key = JSON.stringify([item.storeId, item.listed, item.acquisitionCost, item.acquisitionSource, item.kind, item.caseType, item.caseTier, item.auctionId, item.title, item.image, item.price, item.rarity, item.sellValue]);
    if (!groups.has(key)) groups.set(key, { ...item, copies: [] });
    groups.get(key).copies.push(item);
  }
  return [...groups.values()];
}
function inventoryCategory(item) {
  return item.kind === 'review-pack' ? 'review-packs' : item.kind === 'case' ? 'cases' : item.marketCategory || 'other';
}
function inventoryCategoryLabel(id) {
  return id === 'review-packs' ? t('Review packs','Bewertungspakete') : id === 'all' ? t('All finds', 'Alle Funde') : id === 'cases' ? t('Sealed cases', 'Versiegelte Kisten') : traderCategoryLabel(id);
}
function inventoryCategorySummary(items, selected) {
  const counts = new Map();
  // Count raw inventory rows, before grouping copies or applying filters.
  for (const item of items) { const id = inventoryCategory(item); counts.set(id, (counts.get(id) || 0) + 1); }
  const icons = {
    all: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    wine: '<path d="M14 3h5v5l2 3v9h-9v-9l2-3V3ZM13 13h7M3 4h6v5a3 3 0 0 1-6 0V4Zm3 8v7m-3 2h6"/>',
    electronics: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4M7 8h5m-5 4h10"/>',
    vehicles: '<path d="m4 10 2-6h12l2 6M3 10h18v8H3v-8Zm2 8v3h3v-3m8 0v3h3v-3M6 14h3m6 0h3"/>',
    cases: '<path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4m-9 4v10M7 5l10 4v5"/>',
    collectibles: '<path d="m12 3 3 6 6 1-4 5 1 6-6-3-6 3 1-6-4-5 6-1 3-6Z"/>',
    watches_jewelry: '<circle cx="12" cy="12" r="6"/><path d="M9 6V2h6v4m-6 12v4h6v-4m-3-9v3l2 2"/>',
    tools: '<path d="m14 5 5 5M3 21l9-9M14 3a6 6 0 0 0-7 7l-4 4a3 3 0 0 0 7 7l4-4a6 6 0 0 0 7-7l-4 4-4-4 4-4Z"/>',
    household: '<path d="m3 11 9-8 9 8M5 9v12h14V9M9 21v-8h6v8"/>',
    luxury_goods: '<path d="m3 8 4-5h10l4 5-9 13L3 8Zm0 0h18M7 3l5 18 5-18"/>',
    bicycles: '<circle cx="5" cy="17" r="4"/><circle cx="19" cy="17" r="4"/><path d="m5 17 4-8 5 8H5m0-11h5m5-3h3l1 14M9 9h9"/>',
    books_media: '<path d="M3 4c4-1 7 0 9 2 2-2 5-3 9-2v16c-4-1-7 0-9 2-2-2-5-3-9-2V4Zm9 2v16"/>',
    fashion: '<path d="M10 6a2 2 0 1 1 4 0c0 2-2 2-2 4L3 17v3h18v-3l-9-7"/>',
    cosmetics: '<rect x="6" y="9" width="12" height="12" rx="2"/><path d="M9 9V5h6v4m-3-4V2h6m-8 12h4"/>',
    sport_leisure: '<path d="M8 12h8M3 8v8m3-10v12m12-12v12m3-10v8"/>',
    other: '<path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4"/>'
  };
  const categories = [['all', items.length], ...[...counts].sort(([a], [b]) => a.localeCompare(b))];
  return `<section class="inventory-summary" aria-labelledby="inventory-summary-title"><div class="inventory-summary-heading"><h2 id="inventory-summary-title">${t('Your finds by category', 'Deine Funde nach Kategorie')}</h2>${infoTip(t('Includes listed items and store stock.', 'Enthält angebotene Artikel und Ladenbestand.'), t('Category totals', 'Kategoriesummen'))}</div><div class="inventory-category-cards" role="group" aria-label="${t('Filter inventory by category', 'Inventar nach Kategorie filtern')}">${categories.map(([id, count]) => `<button class="inventory-category-card inventory-category-${accountEscape(id)}" type="button" data-inventory-category="${accountEscape(id)}" aria-pressed="${selected === id}" aria-label="${inventoryCategoryLabel(id)}: ${number(count)} ${count === 1 ? t('item', 'Artikel') : t('items', 'Artikel')}"><span class="inventory-category-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[id] || icons.other}</svg></span><span class="inventory-category-copy"><strong>${number(count)} <small>${count === 1 ? t('item', 'Artikel') : t('items', 'Artikel')}</small></strong><span>${inventoryCategoryLabel(id)}</span></span><span class="inventory-category-check" aria-hidden="true">✓</span></button>`).join('')}</div></section>`;
}
function renderInventory() {
  accountContent.innerHTML=(window.shopUi?.handoff()||'')+pageHeading(t('Inventory','Inventar'))+economyOverviewMarkup();
  if(!account){accountContent.innerHTML+=loginNotice('inventory');return;}
  const query=new URLSearchParams(location.search), status=query.get('state')||'all', category=query.get('category')||'all', rarity=query.get('rarity')||'all';
  const items=accountItems.filter(item=>(status==='all'||status==='cases'&&item.kind==='case'||status==='listed'&&item.listed||status==='stores'&&item.storeId||status==='available'&&!item.listed&&!item.storeId)&&(category==='all'||inventoryCategory(item)===category)&&(rarity==='all'||(item.rarity||item.caseTier)===rarity));
  const filtered=groupedInventory(items), categories=[...new Set(accountItems.map(inventoryCategory))].sort();
  accountInventoryPage=Math.min(accountInventoryPage,Math.max(0,Math.ceil(filtered.length/24)-1));
  accountContent.innerHTML+=(window.netWorthUi?.markup() || '')+inventoryCategorySummary(accountItems, category)+`<div class="inventory-filters"><label>${t('State','Status')}<select data-inventory-filter="state">${[['all',t('All finds','Alle Funde')],['available',t('Available','Verfügbar')],['cases',t('Cases','Kisten')],['listed',t('Listed','Angeboten')],['stores',t('In stores','In Läden')]].map(([id,label])=>`<option value="${id}" ${status===id?'selected':''}>${label}</option>`).join('')}</select></label><label>${t('Category','Kategorie')}<select data-inventory-filter="category"><option value="all">${t('All','Alle')}</option>${categories.map(id=>`<option value="${accountEscape(id)}" ${category===id?'selected':''}>${inventoryCategoryLabel(id)}</option>`).join('')}</select></label><label>${t('Rarity','Seltenheit')}<select data-inventory-filter="rarity"><option value="all">${t('All','Alle')}</option>${accountCatalog.rarities.map(entry=>`<option value="${entry.id}" ${rarity===entry.id?'selected':''}>${rarityLabel(entry.id)}</option>`).join('')}</select></label><a href="/auction-house" data-page>${t('Browse auctions','Auktionen ansehen')} →</a></div>
    ${filtered.length?`<div class="inventory-grid">${filtered.slice(accountInventoryPage*24,(accountInventoryPage+1)*24).map(item=>itemCard(item)).join('')}</div><div class="inventory-pages"><button data-account="page" data-step="-1" ${accountInventoryPage?'':'disabled'}>← ${t('Previous','Zurück')}</button><span>${accountInventoryPage+1}/${Math.ceil(filtered.length/24)}</span><button data-account="page" data-step="1" ${(accountInventoryPage+1)*24>=filtered.length?'disabled':''}>${t('Next','Weiter')} →</button></div>`:`<div class="collection-empty"><h2>${accountItems.length?t('No matching items','Keine passenden Artikel'):t('Inventory is empty','Inventar ist leer')}</h2><p>${accountItems.length?t('Try another filter.','Wähle einen anderen Filter.'):t('Complete Daily for trading money and a sealed case.','Schließe Daily ab, um Handelskapital und eine versiegelte Kiste zu erhalten.')}</p><a href="${accountItems.length?'/inventory':'/'}" data-page class="primary-button">${accountItems.length?t('Clear filters','Filter entfernen'):t('Play Daily','Daily spielen')} →</a></div>`}`;
  window.netWorthUi?.wire();
  window.inventoryItemUi?.refresh();
}
function dailyFriendLabel(daily) {
  if (daily.status === 'completed') return `${number(daily.score)} / ${number(5000)} ${t('pts', 'Pkt')}`;
  return daily.status === 'in_progress' ? t(`In progress · ${daily.completedRounds} / 5 lots`, `In Arbeit · ${daily.completedRounds} / 5 Lose`) : t('Not played yet', 'Noch nicht gespielt');
}
function renderLeaderboard() {
  const daily = accountLeaderboard.view === 'daily', leaders = accountLeaderboard.leaders;
  const me = account ? leaders.find(leader => leader.id === account.id) : null;
  const trophy = `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6h18v13a9 9 0 0 1-18 0V6Zm0 4H7v6a9 9 0 0 0 9 9m17-15h8v6a9 9 0 0 1-9 9m-8 3v9m-8 5h16m-13-5h10v5"/><path d="m24 10 2 4 4 .5-3 3 .8 4-3.8-2-3.8 2 .8-4-3-3 4-.5 2-4Z"/></svg>`;
  const avatar = leader => accountEscape(leader.username.slice(0, 2).toUpperCase());
  const metric = leader => daily ? number(leader.score) : euro(leader.inventoryValueEur);
  const metricLabel = daily ? t('DAILY SCORE', 'DAILY-PUNKTE') : t('COLLECTION VALUE', 'SAMMLUNGSWERT');
  const podium = leaders.slice(0, 3).map(leader => `<li class="podium-player podium-place-${leader.rank}${leader.id === account?.id ? ' is-me' : ''}" aria-label="${accountEscape(t(`Rank ${leader.rank}: ${leader.username}`, `Platz ${leader.rank}: ${leader.username}`))}">
    <div class="podium-player-card">${leader.rank === 1 ? `<span class="podium-crown" aria-hidden="true">${trophy}</span>` : ''}<div class="podium-avatar" aria-hidden="true">${avatar(leader)}<span>${leader.rank}</span></div><span class="podium-title">${leader.rank === 1 ? t('CHAMPION', 'CHAMPION') : leader.rank === 2 ? t('RUNNER-UP', 'ZWEITER PLATZ') : t('THIRD PLACE', 'DRITTER PLATZ')}</span><strong class="podium-name">${accountEscape(leader.username)}</strong>${leader.id === account?.id ? `<span class="leaderboard-you">${t('YOU', 'DU')}</span>` : ''}<strong class="podium-score">${metric(leader)}</strong><small>${daily ? t('out of 5,000 points', 'von 5.000 Punkten') : t('kept in collection', 'in der Sammlung')}</small></div><div class="podium-step" aria-hidden="true"><span>${String(leader.rank).padStart(2,'0')}</span><i>★</i></div></li>`).join('');
  const rows = leaders.map(leader => `<tr${account?.id === leader.id ? ' class="is-me"' : ''}><td class="leaderboard-rank"><span class="leaderboard-rank-badge${leader.rank <= 3 ? ` is-place-${leader.rank}` : ''}">${leader.rank}</span></td><th scope="row" class="leaderboard-name"><div class="leaderboard-player"><span class="leaderboard-avatar" aria-hidden="true">${avatar(leader)}</span><span>${accountEscape(leader.username)}${leader.id === account?.id ? `<small class="leaderboard-you">${t('YOU', 'DU')}</small>` : ''}</span></div></th><td class="leaderboard-primary-score"><strong>${metric(leader)}</strong>${daily ? `<progress max="5000" value="${leader.score}" aria-label="${accountEscape(t(`${leader.username}: ${leader.score} out of 5000 points`, `${leader.username}: ${leader.score} von 5000 Punkten`))}"></progress>` : ''}</td>${daily ? '' : `<td class="leaderboard-daily-score">${leader.score === null ? `<span>${t('Not played yet', 'Noch nicht gespielt')}</span>` : `${number(leader.score)} <small>/ ${number(5000)}</small>`}</td>`}</tr>`).join('');
  accountContent.innerHTML = `<div class="leaderboard-page"><header class="leaderboard-hero"><div><h1 tabindex="-1">${t('Leaderboard', 'Rangliste')}</h1></div><span class="leaderboard-hero-trophy" aria-hidden="true">${trophy}</span></header>
    <div class="leaderboard-controls"><nav class="leaderboard-modes" aria-label="${t('Ranking mode', 'Ranglistenmodus')}"><a class="leaderboard-mode" href="/leaderboard?view=collection" data-page ${!daily ? 'aria-current="page"' : ''}>${t('Collection prestige', 'Sammlungsrangliste')}</a><a class="leaderboard-mode" href="/leaderboard?view=daily" data-page ${daily ? 'aria-current="page"' : ''}>${t('Daily scores', 'Daily-Ergebnisse')}</a></nav><button class="leaderboard-refresh" type="button" data-account="refresh"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M18 18A8 8 0 0 1 5 16"/></svg>${t('Refresh', 'Aktualisieren')}</button></div>
    <section class="leaderboard-stage" aria-labelledby="leaderboard-podium-title"><div class="leaderboard-stage-heading"><div><h2 id="leaderboard-podium-title">${t('The podium', 'Das Podium')}</h2></div><span>${daily ? accountEscape(accountLeaderboard.date) : t('ALL-TIME COLLECTIONS', 'SAMMLUNGEN ALLER ZEITEN')}</span></div>${podium ? `<ol class="leaderboard-podium">${podium}</ol>` : `<div class="leaderboard-empty">${trophy}<h3>${t('No ranked players yet', 'Noch keine Spieler in der Rangliste')}</h3><a class="primary-button" href="${daily ? '/' : '/login'}" data-page>${daily ? t('Play Daily', 'Daily spielen') : t('Log in / Register', 'Anmelden / Registrieren')} <span aria-hidden="true">→</span></a></div>`}</section>
    <section class="leaderboard-personal" aria-label="${t('Your ranking', 'Deine Platzierung')}"><div class="leaderboard-personal-rank"><span>${t('YOUR RANK', 'DEIN RANG')}</span><strong>${me ? `#${me.rank}` : '—'}</strong></div><div class="leaderboard-personal-copy"><strong>${account ? accountEscape(account.username) : t('Log in to see your rank', 'Anmelden für deinen Rang')}</strong>${me ? `<p>${metric(me)} · ${daily ? t('Daily score', 'Daily-Punkte') : t('collection value', 'Sammlungswert')}</p>` : account ? `<p>${t('Outside the Top 100', 'Außerhalb der Top 100')}</p>` : ''}</div><a href="${account ? daily ? '/' : '/inventory' : '/login'}" data-page>${account ? daily ? t('Play Daily', 'Daily spielen') : t('Your collection', 'Deine Sammlung') : t('Log in / Register', 'Anmelden / Registrieren')} <span aria-hidden="true">→</span></a></section>
    <section class="leaderboard-rankings" aria-labelledby="leaderboard-rankings-title"><div class="leaderboard-list-heading"><div><h2 id="leaderboard-rankings-title">${t('Top 100', 'Top 100')}</h2><p>${daily ? t('Completed Daily scores · resets at 00:00 UTC', 'Abgeschlossene Daily-Ergebnisse · Reset um 00:00 UTC') : t('Ranked by the historical value of retained finds', 'Sortiert nach dem historischen Wert der behaltenen Funde')}</p></div><span>${number(leaders.length)} ${t('players', 'Spieler')}</span></div>${rows ? `<div class="leaderboard-wrap"><table class="leaderboard-table"><caption class="sr-only">${daily ? t('Daily score rankings', 'Daily-Punkterangliste') : t('Collection value rankings', 'Sammlungswertrangliste')}</caption><thead><tr><th scope="col">${t('Rank', 'Platz')}</th><th scope="col">${t('Player', 'Spieler')}</th><th scope="col">${metricLabel}</th>${daily ? '' : `<th scope="col">${t('TODAY’S DAILY', 'HEUTIGES DAILY')}</th>`}</tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="leaderboard-no-ranks">${t('No ranked players yet.', 'Noch keine Spieler in der Rangliste.')}</p>`}</section></div>`;
}
function rewardNote() {
  if (!account) return t('Log in before playing to earn J€.', 'Melde dich vor dem Spielen an, um J€ zu verdienen.');
  const rewards = accountCatalog?.rewards || { daily: 1000, dailyScoreBonus: 0, higherLowerMax: 250 };
  const daily = account.rewardsByMode?.daily?.earned || 0;
  const higherLower = account.rewardsByMode?.['higher-lower']?.earned || 0;
  return t(`Daily pays ${justizEuro(rewards.daily)} plus one case. Higher or Lower pays up to ${justizEuro(rewards.higherLowerMax)} separately; better streaks pay the difference. Earned today: ${justizEuro(daily + higherLower)}. Resets at 00:00 UTC.`,
    `Das Daily zahlt ${justizEuro(rewards.daily)} und eine Kiste. Higher or Lower zahlt separat bis zu ${justizEuro(rewards.higherLowerMax)}; bessere Serien zahlen die Differenz. Heute verdient: ${justizEuro(daily + higherLower)}. Reset um 00:00 UTC.`);
}
function rewardBanner() { return `<p class="reward-note">${accountEscape(rewardNote())}</p>`; }
function criminalRecordMarkup() {
  const record = accountCriminalRecord;
  const rows = record.records.map(entry => {
    const at = entry.recordedAt ?? entry.attemptedAt, date = new Date(at);
    return `<li class="criminal-record-entry" tabindex="-1" data-offense="${accountEscape(entry.id)}"><div><strong>${t('Attempted theft', 'Versuchter Diebstahl')}</strong><p><time datetime="${date.toISOString()}">${date.toLocaleString(uiLocale(),{dateStyle:'medium',timeStyle:'short'})}</time>${entry.recordedAt === null ? ` · ${t('Attempt date; recording time unavailable', 'Versuchsdatum; Erfassungszeit unbekannt')}` : ''}${entry.abandoned ? ` · ${t('Abandoned attempt', 'Abgebrochener Versuch')}` : ''}</p></div><div class="criminal-record-fine"><span>${entry.legacyFee ? t('Mischief fee', 'Unfuggebühr') : t('Fine', 'Bußgeld')}</span><strong>${justizEuro(entry.fine)}</strong></div></li>`;
  }).join('');
  return `<section class="profile-criminal-record" aria-labelledby="criminal-record-title"><header><h2 id="criminal-record-title">${t('Criminal record', 'Strafregister')}</h2>${record.total ? `<p>${number(record.total)} ${t('recorded offenses', 'erfasste Vergehen')} · ${t('Total penalties', 'Strafen gesamt')}: ${justizEuro(record.totalPenalties)}</p>` : ''}</header>${rows ? `<ol class="criminal-record-list">${rows}</ol>${record.hasMore ? `<button type="button" class="secondary-button" data-account="criminal-record-more">${t('Show older offenses', 'Ältere Vergehen anzeigen')}</button>` : ''}` : `<p class="criminal-record-clear">${t('No recorded offenses.', 'Keine erfassten Vergehen.')}</p>`}</section>`;
}
function renderProfile() { window.profileUi.render(); }
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
    ${accepted.length ? `<div class="friend-grid">${accepted.map(friend => `<article class="friend-card"><h4>${accountEscape(friend.username)}</h4><dl><div><dt>${t('TODAY’S DAILY', 'HEUTIGES DAILY')}</dt><dd>${dailyFriendLabel(friend.daily)}</dd></div><div><dt>${t('INVENTORY VALUE', 'INVENTARWERT')}</dt><dd>${euro(friend.inventoryValueEur)}</dd></div><div><dt>${t('COLLECTED ITEMS', 'GESAMMELTE LOSE')}</dt><dd>${friend.itemCount}</dd></div></dl><button data-account="friend-remove" data-id="${friend.id}">${t('Remove friend', 'Freund entfernen')}</button></article>`).join('')}</div>` : `<p class="collection-empty">${t('No friends yet.', 'Noch keine Freunde.')}</p>`}`;
}
function adminIcon(name) {
  const paths = {
    market: '<path d="m3 17 6-6 4 4 8-10M15 5h6v6"/>',
    players: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 20v-2a6 6 0 0 0-3-5"/>',
    auctions: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12h14V8M10 12h4"/>',
    access: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
    maintenance: '<path d="m14 6 4 4M3 21l7-7M14 3a6 6 0 0 0-7 7l-4 4a3 3 0 0 0 7 7l4-4a6 6 0 0 0 7-7l-4 4-4-4 4-4Z"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M18 18A8 8 0 0 1 5 16"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.market}</svg>`;
}
function adminUserListMarkup() {
  const query = adminUserFilter.trim().toLowerCase();
  const filtered = accountAdmin.users.filter(user => user.username.toLowerCase().includes(query));
  const rows = filtered.slice(0, 100).map(user => `<div class="user-row${user.banned ? ' is-banned' : ''}">
    <span class="admin-avatar" aria-hidden="true">${accountEscape(user.username.slice(0, 2).toUpperCase())}</span>
    <div class="user-row-main"><strong>${accountEscape(user.username)}</strong><span>${justizEuro(user.tokens)} <span class="admin-status${user.banned ? ' is-banned' : user.admin ? ' is-admin' : ''}">${user.banned ? t('Banned', 'Gesperrt') : user.admin ? 'Admin' : t('Player', 'Spieler')}</span></span></div>
    <div class="user-row-actions">${user.admin ? '' : `<button data-account="ban-toggle" data-id="${accountEscape(user.id)}" data-banned="${user.banned ? 'true' : 'false'}">${user.banned ? t('Unban', 'Entsperren') : t('Ban', 'Sperren')}</button><button data-account="password-reset" data-id="${accountEscape(user.id)}">${t('Reset password', 'Passwort zurücksetzen')}</button>`}<button class="admin-grant-button" data-account="grant-user" data-id="${accountEscape(user.id)}">${t('Give J€', 'J€ geben')}</button></div>
  </div>`).join('');
  const note = filtered.length > 100 ? t(`Showing 100 of ${filtered.length} players. Refine your search.`, `Zeige 100 von ${filtered.length} Spielern. Grenze die Suche weiter ein.`) :
    filtered.length ? t(`${filtered.length} players`, `${filtered.length} Spieler`) : t('No players match this search.', 'Keine Spieler gefunden.');
  return rows + `<p class="admin-count" role="status">${note}</p>`;
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
  return `<div class="admin-section admin-market" id="admin-market-section">
    <div class="admin-panel-heading"><div><h2>${t('Market overview', 'Marktübersicht')}</h2></div><span class="admin-tag">${number(accountAdminMarket.categories.length)} ${t('categories', 'Kategorien')}</span></div>
    <div class="admin-toolbar"><label class="admin-search">${t('Find a category', 'Kategorie finden')}<span>${adminIcon('search')}<input id="admin-market-search" name="market-search" type="search" autocomplete="off" placeholder="${t('Search categories…', 'Kategorien durchsuchen …')}" value="${accountEscape(adminMarketFilter)}"></span></label></div>
    <div class="admin-market-categories">${accountAdminMarket.categories.map(category => {
      const name = t(category.name, category.nameDe);
      const matches = `${category.name} ${category.nameDe}`.toLowerCase().includes(adminMarketFilter.trim().toLowerCase());
      return `<article class="admin-market-category" data-market-category="${accountEscape(category.id)}" data-market-name="${accountEscape(`${category.name} ${category.nameDe}`.toLowerCase())}" ${matches ? '' : 'hidden'}>
      <div class="admin-category-heading"><h3>${accountEscape(name)}</h3></div>
      <div class="admin-category-value"><strong>${number(category.currentIndex, 2)}</strong><span>${t('Current index', 'Aktueller Index')}</span></div></article>`;
    }).join('')}</div>
    <p class="admin-empty" id="admin-market-empty" role="status" ${accountAdminMarket.categories.some(category => `${category.name} ${category.nameDe}`.toLowerCase().includes(adminMarketFilter.trim().toLowerCase())) ? 'hidden' : ''}>${t('No categories match this search.', 'Keine Kategorien gefunden.')}</p></div>`;
}
function selectAdminTab(tab, focus = false) {
  const button = accountContent.querySelector(`[data-admin-tab="${tab}"]`);
  if (!button) return;
  adminActiveTab = tab;
  for (const control of accountContent.querySelectorAll('[data-admin-tab]')) {
    const selected = control.dataset.adminTab === tab;
    control.setAttribute('aria-selected', String(selected));
    control.tabIndex = selected ? 0 : -1;
  }
  for (const panel of accountContent.querySelectorAll('[data-admin-panel]')) panel.hidden = panel.dataset.adminPanel !== tab;
  if (focus) button.focus({ preventScroll: true });
}
function renderAdmin() {
  accountContent.innerHTML = pageHeading(t('Admin', 'Adminbereich'));
  if (!account?.admin) { accountContent.innerHTML += `<p class="collection-empty">${t('Log in with an admin account to access this page.', 'Melde dich mit einem Adminkonto an, um diese Seite zu nutzen.')}</p>`; return; }
  const tabs = [['market', t('Markets', 'Märkte')], ['players', t('Players', 'Spieler')], ['auctions', t('Archive', 'Archiv')], ['access', t('Access', 'Zugang')], ['maintenance', t('Maintenance', 'Wartung')]];
  const availableCodes = accountCodes.filter(code => code.used_at === null && !code.revoked).length;
  const banned = accountAdmin.users.filter(user => user.banned).length;
  const panel = (tab, content) => `<section id="admin-panel-${tab}" class="admin-panel" role="tabpanel" aria-labelledby="admin-tab-${tab}" data-admin-panel="${tab}" tabindex="0" ${adminActiveTab === tab ? '' : 'hidden'}>${content}</section>`;
  accountContent.innerHTML = `<div class="admin-dashboard">
    <header class="admin-hero"><div><h1 tabindex="-1">${t('Admin', 'Adminbereich')}</h1></div><button class="secondary-button admin-refresh" data-account="refresh">${adminIcon('refresh')}${t('Refresh data', 'Daten aktualisieren')}</button></header>
    <div class="admin-overview" aria-label="${t('Admin overview', 'Adminübersicht')}">
      <div class="admin-metric"><span class="admin-metric-icon">${adminIcon('players')}</span><div><span>${t('Player accounts', 'Spielerkonten')}</span><strong>${number(accountAdmin.playerCount)}</strong><small>${number(banned)} ${t('banned', 'gesperrt')}</small></div></div>
      <div class="admin-metric"><span class="admin-metric-icon">${adminIcon('market')}</span><div><span>${t('Market categories', 'Marktkategorien')}</span><strong>${number(accountAdminMarket.categories.length)}</strong></div></div>
      <div class="admin-metric"><span class="admin-metric-icon">${adminIcon('code')}</span><div><span>${t('Available invites', 'Verfügbare Einladungen')}</span><strong>${number(availableCodes)}</strong></div></div>
    </div>
    <div class="admin-tabs" role="tablist" aria-label="${t('Admin tools', 'Adminwerkzeuge')}">${tabs.map(([id, label]) => `<button type="button" role="tab" id="admin-tab-${id}" aria-controls="admin-panel-${id}" aria-selected="${adminActiveTab === id}" tabindex="${adminActiveTab === id ? 0 : -1}" data-admin-tab="${id}">${adminIcon(id)}<span>${label}</span></button>`).join('')}</div>
    ${panel('market', adminMarketMarkup())}
    ${panel('players', `<div class="admin-section"><div class="admin-panel-heading"><div><h2>${t('Player management', 'Spielerverwaltung')}</h2></div>${infoTip(t('Banned players are signed out immediately. The grant amount below applies to each Give J€ button.', 'Gesperrte Spieler werden sofort abgemeldet. Der folgende Betrag gilt für jede Schaltfläche J€ geben.'))}</div>
      <div class="admin-toolbar"><label class="admin-search">${t('Find a player', 'Spieler finden')}<span>${adminIcon('search')}<input id="user-search" name="user-search" type="search" autocomplete="off" placeholder="${t('Search usernames…', 'Benutzernamen durchsuchen …')}" value="${accountEscape(adminUserFilter)}"></span></label><label>${t('J€ per grant', 'J€ pro Gutschrift')}<input id="grant-amount" name="grant-amount" type="number" min="1" max="1000000" step="1" value="100"></label></div>
      ${freshPasswordReset ? `<label class="fresh-codes admin-notice">${t(`Temporary password for ${freshPasswordReset.username} — copy it now, it is shown only once and works for exactly one login`, `Temporäres Passwort für ${freshPasswordReset.username} — jetzt kopieren, es wird nur einmal angezeigt und gilt für genau eine Anmeldung`)}<textarea readonly rows="2">${accountEscape(freshPasswordReset.temporaryPassword)}</textarea></label>` : ''}
      <div id="user-list" class="user-list">${adminUserListMarkup()}</div>
      <div class="admin-subpanel"><div class="admin-panel-heading"><div><h3>${t('Grant J€ to all players', 'J€ an alle Spieler geben')}</h3><p>${t('Give the same J€ amount to every current player, including admins. Future accounts are excluded.', 'Vergib denselben J€-Betrag an alle aktuellen Spieler inklusive Admins. Künftige Konten sind ausgeschlossen.')}</p></div></div>
      <form id="grant-form" class="grant-form"><label>${t('J€ per player', 'J€ pro Spieler')}<input name="amount" type="number" min="1" max="1000000" step="1" value="100" required></label><button class="primary-button" type="submit">${t('Give J€ to all players', 'J€ an alle Spieler geben')}</button><p class="account-error" role="alert"></p></form>
      <details class="admin-history"><summary>${t('Recent grants', 'Letzte Gutschriften')} <span>${number(accountAdmin.grants.length)}</span></summary><div class="grant-history">${accountAdmin.grants.map(grant => `<div class="admin-history-row"><div><strong>${justizEuro(grant.amount)} ${t('per player', 'pro Spieler')}</strong><small>${new Date(grant.createdAt).toLocaleString(uiLocale())}</small></div><span>${number(grant.recipients)} ${t('players', 'Spieler')}</span></div>`).join('') || `<p class="admin-empty">${t('No grants yet.', 'Noch keine Gutschriften.')}</p>`}</div></details></div></div>`)}
    ${panel('auctions', `<div class="admin-section"><div class="admin-panel-heading"><div><h2>${t('Auction archive', 'Auktionsarchiv')}</h2></div></div>
      <div class="admin-toolbar"><label class="admin-search">${t('Search the archive', 'Archiv durchsuchen')}<span>${adminIcon('search')}<input id="auction-search" name="auction-search" type="search" autocomplete="off" placeholder="${t('Title, description, category or ID', 'Titel, Beschreibung, Kategorie oder ID')}" value="${accountEscape(accountAuctions.query)}"></span></label></div><div id="auction-results">${auctionResultsMarkup()}</div></div>`)}
    ${panel('access', `<div class="admin-section"><div class="admin-panel-heading"><div><h2>${t('Registration codes', 'Registrierungscodes')}</h2></div><span class="admin-tag">${number(availableCodes)} ${t('available', 'verfügbar')}</span></div>
      <div class="admin-subpanel admin-invite-form"><h3>${t('Create registration codes', 'Registrierungscodes erstellen')}</h3><p>${t('Full codes are shown only once after creation. Copy and save them before leaving.', 'Vollständige Codes werden nur einmal nach dem Erstellen angezeigt. Kopiere und speichere sie vor dem Verlassen.')}</p><form id="code-form" class="code-form"><label>${t('Number of codes', 'Anzahl der Codes')}<input name="count" type="number" min="1" max="50" value="5" required></label><button class="primary-button" type="submit">${adminIcon('code')}${t('Create codes', 'Codes erstellen')}</button><p class="account-error" role="alert"></p></form></div>
      ${freshCodes.length ? `<label class="fresh-codes admin-notice">${t('New codes — copy and save them now', 'Neue Codes — jetzt kopieren und aufbewahren')}<textarea readonly rows="${Math.min(10, freshCodes.length + 1)}">${accountEscape(freshCodes.join('\n'))}</textarea></label>` : ''}
      <h3 class="admin-list-heading">${t('Code history', 'Codeverlauf')}</h3><div class="code-list">${accountCodes.map(code => `<div><span class="admin-code-icon">${adminIcon('code')}</span><code>…${accountEscape(code.label)}</code><span class="admin-status${code.used_at !== null || code.revoked ? '' : ' is-up'}">${code.used_at !== null ? t('Used', 'Verwendet') : code.revoked ? t('Revoked', 'Widerrufen') : t('Available', 'Verfügbar')}</span>${code.used_at === null && !code.revoked ? `<button data-account="revoke" data-id="${accountEscape(code.id)}">${t('Revoke', 'Widerrufen')}</button>` : ''}</div>`).join('') || `<p class="admin-empty">${t('No codes created yet.', 'Noch keine Codes erstellt.')}</p>`}</div></div>`)}
    ${panel('maintenance', `<div class="admin-section"><div class="admin-panel-heading"><div><h2>${t('Economy reset', 'Wirtschaft zurücksetzen')}</h2></div></div>
      <div class="economy-reset"><p class="eyebrow">${t('DANGER ZONE', 'GEFAHRENBEREICH')}</p><h3>${t('Reset the player economy', 'Spielerwirtschaft zurücksetzen')}</h3><p>${t('Every human account returns to J€ 1,000 and 0 XP. Inventories, game progress, rewards, grants, bids and both auction histories are deleted. Usernames, passwords, active login sessions, registration codes, bans, admin roles and friendships stay intact.', 'Jedes menschliche Konto wird auf J€ 1.000 und 0 XP gesetzt. Inventare, Spielfortschritt, Belohnungen, Gutschriften, Gebote und beide Auktionsverläufe werden gelöscht. Benutzernamen, Passwörter, aktive Anmeldungen, Registrierungscodes, Sperren, Adminrollen und Freundschaften bleiben erhalten.')}</p>
      ${accountAdmin.lastReset ? `<p class="reset-history">${t('Last reset', 'Letzter Reset')}: ${new Date(accountAdmin.lastReset.createdAt).toLocaleString(uiLocale())} · ${number(accountAdmin.lastReset.playerCount)} ${t('accounts', 'Konten')} · ${number(accountAdmin.lastReset.inventoryCount)} ${t('items removed', 'Gegenstände entfernt')}</p>` : ''}
      <form id="reset-economy-form" class="reset-economy-form"><label>${t('Type RESET ECONOMY to confirm', 'Zur Bestätigung RESET ECONOMY eingeben')}<input name="confirmation" required autocomplete="off" spellcheck="false" pattern="RESET ECONOMY"></label><button class="danger-button" type="submit">${t('Reset economy for every player', 'Wirtschaft für alle Spieler zurücksetzen')}</button><p class="account-error" role="alert"></p></form></div></div>`)}
  </div>`;
}
function caseStockLabel(box) {
  const stock = box.stock;
  if (!stock) return '';
  const refill = new Date(stock.restocksAt).toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  return t(`${stock.remaining} / ${stock.limit} left globally · Refills at ${refill}`, `${stock.remaining} / ${stock.limit} weltweit übrig · Auffüllung um ${refill}`);
}
async function refreshCaseStock(visit) {
  const request = ++caseStockRequest;
  const quotes = await Promise.all([accountApi('case-store'), ...(!economyFlags.paletteAuctions ? [accountApi('cases')] : [])]);
  if (request !== caseStockRequest || accountBusy || visit !== accountVisit || currentAccountPage !== '/shop') return;
  if(quotes[0]?.luckPercent!==accountStore?.luckPercent){accountStore=quotes[0];renderShop();return;}
  for (const [index, quote] of quotes.entries()) {
    const catalog = index ? accountCatalog : accountStore;
    for (const box of catalog?.cases || []) box.stock = quote.cases.find(offer => offer.id === box.id)?.stock;
  }
  for (const element of accountContent.querySelectorAll('[data-case-stock]')) {
    const box = [...(accountStore?.cases || []), ...(accountCatalog?.cases || [])].find(box => box.id === element.dataset.caseStock);
    if (box) element.textContent = caseStockLabel(box);
  }
  for (const meter of accountContent.querySelectorAll('[data-case-stock-meter]')) {
    const box = accountStore?.cases.find(box => box.id === meter.dataset.caseStockMeter);
    if (box?.stock) { meter.max = box.stock.limit; meter.value = box.stock.remaining; }
  }
  for (const selector of accountContent.querySelectorAll('[data-account="select-store-case"]')) {
    const box = accountStore?.cases.find(box => box.id === selector.dataset.id);
    if (box) selector.classList?.toggle('is-sold-out', box.stock?.remaining === 0);
  }
  updateCasePurchaseButtons();
}
function updateCasePurchaseButtons() {
  for (const buy of accountContent.querySelectorAll('[data-account="buy-case"]')) {
    const offer = accountStore?.cases.find(box => box.id === buy.dataset.id);
    buy.disabled = accountBusy || !account || !offer || account.tokens < offer.cost || offer.stock?.remaining === 0;
    buy.textContent = offer?.stock?.remaining === 0 ? t('Sold out', 'Ausverkauft') : t('Buy case', 'Kiste kaufen');
  }
  const pull = accountContent.querySelector('[data-account="pull"]');
  if (pull) {
    const box = accountCatalog.cases.find(box => box.id === accountSelectedCase);
    pull.disabled = accountBusy || !account || account.tokens < box.cost || !box.available || box.stock?.remaining === 0;
    pull.textContent = box.stock?.remaining === 0 ? t('Sold out', 'Ausverkauft') : !box.available ? t('Currently unavailable', 'Derzeit nicht verfügbar') : account
      ? `${accountResult?.caseId === box.id ? t('Open another case', 'Weitere Kiste öffnen') : t('Open case', 'Kiste öffnen')} · ${justizEuro(box.cost)}`
      : t('Log in to open cases', 'Zum Öffnen anmelden');
  }
}
setInterval(() => {
  if (currentAccountPage === '/shop' && pageLoaded && !accountBusy) refreshCaseStock(accountVisit).catch(() => {});
}, 30_000);
function renderShop() {
  if (!accountStore) return;
  const selectionScroll = accountContent.querySelector('.case-selector-grid')?.scrollLeft || 0;
  const box = accountStore.cases.find(entry => entry.id === accountSelectedStoreCase) || accountStore.cases[0];
  if (!box) { accountContent.innerHTML = pageHeading(t('Case Store', 'Kisten-Shop')); return; }
  accountSelectedStoreCase = box.id;
  const soldOut = box.stock?.remaining === 0;
  accountContent.innerHTML = `<div class="case-boutique">
    <header class="case-boutique-header">${pageHeading(t('Case Store', 'Kisten-Shop'))}${!account ? `<a href="/login" data-page>${t('Log in to buy', 'Zum Kaufen anmelden')} →</a>` : ''}<a class="secondary-button" href="/inventory" data-page>${t('Inventory', 'Inventar')} ↗</a></header>
    ${accountStore.luckPercent?`<p class="skill-luck-notice"><strong>+${accountStore.luckPercent}% ${t('luck active','Glücksbonus aktiv')}</strong>${t('Your bonuses are included in the displayed odds.','Deine Boni sind in den angezeigten Chancen berücksichtigt.')}<a href="/skills" data-page>${t('Skill tree','Skillbaum')} →</a></p>`:''}
    <section class="case-showcase case-design-${accountEscape(box.id)}" aria-label="${t('Selected case', 'Ausgewählte Kiste')}">
      <div class="case-showroom"><span class="case-stage-seal">JG / ${accountEscape(box.badge)}</span><div class="case-orbit" aria-hidden="true"></div><div class="case-showroom-rays" aria-hidden="true"></div>${caseArtwork(box)}<div class="case-pedestal" aria-hidden="true"></div><span class="case-stage-caption">${t('SEALED', 'VERSIEGELT')} · ${t('ONE ITEM', 'EIN GEGENSTAND')}</span></div>
      <div class="case-showcase-info"><span class="case-edition-label">${t('CONTENTS', 'INHALTE')} / ${accountEscape(accountStore.rotationDate)}</span><h2>${accountEscape(t(box.name, box.nameDe))}</h2>
        <div class="case-stock-summary"><span data-case-stock="${accountEscape(box.id)}">${accountEscape(caseStockLabel(box))}</span><meter data-case-stock-meter="${accountEscape(box.id)}" min="0" max="${box.stock?.limit || 1}" value="${box.stock?.remaining || 0}" aria-label="${t('Global stock', 'Globaler Bestand')}"></meter></div>
        <div class="case-price-row"><strong>${justizEuro(box.cost)}</strong><span>${t('per case', 'pro Kiste')}</span></div>
        ${account ? `<button class="primary-button case-buy-button" data-account="buy-case" data-id="${accountEscape(box.id)}" ${accountBusy || account.tokens < box.cost || soldOut ? 'disabled' : ''}>${soldOut ? t('Sold out', 'Ausverkauft') : t('Buy case', 'Kiste kaufen')}</button>${account.tokens < box.cost ? `<p class="case-store-shortfall">${t(`You need ${justizEuro(box.cost - account.tokens)} more`, `Dir fehlen ${justizEuro(box.cost - account.tokens)}`)} · <a href="/" data-page>Daily →</a></p>` : ''}` : `<a class="primary-button case-buy-button" href="/login" data-page>${t('Log in to buy', 'Zum Kaufen anmelden')}</a>`}
        <div class="case-odds-heading"><h3>${t('Drop chances', 'Fundchancen')}</h3>${infoTip(t('Higher prices improve the odds of rarer finds. Any case can contain a common item, worth less than its price.', 'Höhere Preise verbessern die Chancen auf seltenere Funde. Jede Kiste kann einen gewöhnlichen Gegenstand enthalten, der weniger als ihr Preis wert ist.'), t('About drop chances', 'Über Fundchancen'))}</div>
        <div class="case-odds-track" aria-hidden="true">${box.dropChances.map(chance => `<i class="rarity-${accountEscape(chance.rarity)}" style="flex-grow:${Math.max(0, Number(chance.percent) || 0)}"></i>`).join('')}</div>
        <dl class="case-odds-list">${box.dropChances.map(chance => `<div><dt class="rarity-${accountEscape(chance.rarity)}">${rarityLabel(chance.rarity)}</dt><dd>${number(chance.percent, 2)}%</dd></div>`).join('')}</dl>
      </div>
    </section>
    <section class="case-selection" aria-label="${t('Case selection', 'Kistenauswahl')}"><div class="case-selection-heading"><h2>${t('Choose a case', 'Kiste auswählen')}</h2><span>${t('Global stock · refills every 4 hours', 'Globaler Bestand · alle 4 Stunden aufgefüllt')}</span></div><div class="case-selector-grid">${accountStore.cases.map((entry, index) => `<button class="case-selector case-design-${accountEscape(entry.id)} ${entry.id === box.id ? 'is-selected' : ''} ${entry.stock?.remaining === 0 ? 'is-sold-out' : ''}" type="button" data-account="select-store-case" data-id="${accountEscape(entry.id)}" aria-pressed="${entry.id === box.id}"><span class="case-selector-number" aria-hidden="true">0${index + 1}</span>${caseArtwork(entry)}<strong>${accountEscape(t(entry.name, entry.nameDe))}</strong><span class="case-selector-price">${justizEuro(entry.cost)}</span><span class="case-selector-stock" data-case-stock="${accountEscape(entry.id)}">${accountEscape(caseStockLabel(entry))}</span><span class="case-selector-check" aria-hidden="true">${entry.id === box.id ? '✓' : '+'}</span></button>`).join('')}</div></section>
    <details class="case-store-contents"><summary>${t('Possible contents', 'Mögliche Inhalte')} · ${accountEscape(t(box.name, box.nameDe))} · ${number(box.items.length)}</summary><ul>${box.items.map(item => `<li><span>${accountEscape(item.title)}</span><small class="rarity-${accountEscape(item.rarity)}">${rarityLabel(item.rarity)}</small></li>`).join('')}</ul></details>

  </div>`;
  if (!economyFlags.paletteAuctions) {
    const storeMarkup = accountContent.innerHTML;
    renderLegacyShop();
    accountContent.innerHTML = storeMarkup + `<section class="case-store-legacy">${accountContent.innerHTML}</section>`;
  }
  const selection = accountContent.querySelector('.case-selector-grid');
  if (selection) selection.scrollLeft = selectionScroll;
}
async function buyStoreCase(caseId, visit) {
  if (!account) return;
  caseStockRequest++;
  const owner = account.id, key = `justizguessr:pending-case-purchase:${owner}:${caseId}`;
  let requestId; try { requestId = localStorage.getItem(key); } catch {}
  requestId ||= crypto.randomUUID(); try { localStorage.setItem(key, requestId); } catch {}
  const result = await accountApi('cases/buy', { caseId, requestId, revision: accountStore.revision });
  try { localStorage.removeItem(key); } catch {}
  if (account?.id !== owner) return;
  updateAccount(result.user);
  if (visit !== accountVisit) return;
  accountStore = result.store;
  accountItems = [result.item, ...accountItems.filter(item => item.id !== result.item.id)];
  renderAccountPage();
  caseReveal.innerHTML = `<div class="case-purchase-content"><button class="dialog-close" data-account="close-reveal" aria-label="${t('Close', 'Schließen')}">×</button><div class="case-purchase-burst" aria-hidden="true">${Array.from({length: 12}, (_, i) => `<i style="--particle:${i}"></i>`).join('')}</div><p class="case-receipt-label">${t('ADDED TO INVENTORY', 'ZUM INVENTAR HINZUGEFÜGT')}</p>${caseArtwork(result.item)}<h2 id="case-reveal-title">${accountEscape(t(result.item.title, result.item.titleDe))}</h2><div class="case-reveal-actions"><button class="primary-button" data-account="open-inventory-case" data-id="${accountEscape(result.item.id)}">${t('Open case', 'Kiste öffnen')}</button><button class="secondary-button" data-account="close-reveal">${t('Keep sealed', 'Versiegelt behalten')}</button></div></div>`;
  if (!caseReveal.open) caseReveal.showModal();
  caseReveal.querySelector('[data-account="open-inventory-case"]').focus({preventScroll: true});
}
function renderLegacyShop() {
  const box = accountCatalog.cases.find(box => box.id === accountSelectedCase) || accountCatalog.cases[0];
  accountSelectedCase = box.id;
  const caseName = box => t(box.name, box.nameDe || box.name);
  const result = accountResult?.caseId === box.id ? accountResult : null;
  accountContent.innerHTML = pageHeading(t('Themed cases', 'Themen-Kisten')) +
    `${!account ? `<div class="shop-balance">${t('Browse the cases. Log in to earn J€ and open one.', 'Entdecke die Kisten. Melde dich an, um J€ zu verdienen und eine zu öffnen.')} <a href="/login" data-page>${t('Log in', 'Anmelden')} →</a></div>` : ''}
    <p class="shop-edition"><span>${t('DAILY EDITION', 'TAGESAUSGABE')} · ${accountCatalog.rotationDate}</span>${infoTip(t('New finds at 00:00 UTC. Contents stay fixed; prices follow the market.', 'Neue Fundstücke um 00:00 UTC. Die Inhalte bleiben gleich; Preise folgen dem Markt.'), t('Edition timing', 'Ausgabenwechsel'))}</p>
    <p class="case-store-stock" data-case-stock="${accountEscape(box.id)}">${accountEscape(caseStockLabel(box))}</p>
    <div class="case-options">${accountCatalog.cases.map(option => `<button class="case-option case-theme-${option.category} ${box.id === option.id ? 'is-selected' : ''} ${option.available ? '' : 'is-restocking'}" data-account="select-case" data-id="${option.id}" aria-pressed="${box.id === option.id}"><span class="case-art" aria-hidden="true"><b>${option.badge}</b></span><span><strong>${caseName(option)}</strong><small>${option.available ? justizEuro(option.cost) : t('Restocking', 'Wird aufgefüllt')}</small></span></button>`).join('')}</div>
    <section class="case-stage" aria-label="${t('Case opening', 'Kistenöffnung')}"><div class="case-stage-heading"><span>${caseName(box).toUpperCase()}</span><span>${box.available ? `${box.items.length} ${t('FINDS IN THIS EDITION', 'FUNDE IN DIESER AUSGABE')}` : t('MORE FINDS ON THE WAY', 'NEUE FUNDE UNTERWEGS')}</span></div>
    ${box.available ? `<div class="case-window" aria-hidden="true"><div class="case-marker"></div><div class="case-reel">${box.items.slice(0, 10).map(item => tierCard(item.rarity)).join('')}</div></div>` : ''}
    <div class="case-result" role="status">${result ? resultMarkup() : `<h2>${box.available ? t('Open for one item', 'Für einen Gegenstand öffnen') : t('Unavailable', 'Nicht verfügbar')}</h2>${box.available ? '' : infoTip(t('This category needs more distinct items. Stock is checked with each Daily edition.', 'Diese Kategorie benötigt mehr unterschiedliche Lose. Der Bestand wird mit jeder Tagesausgabe geprüft.'))}`}</div>
    <button class="primary-button case-open" data-account="pull" ${!account || account.tokens < box.cost || !box.available || accountBusy || box.stock?.remaining === 0 ? 'disabled' : ''}>${box.stock?.remaining === 0 ? t('Sold out', 'Ausverkauft') : !box.available ? t('Currently unavailable', 'Derzeit nicht verfügbar') : account ? `${result ? t('Open another case', 'Weitere Kiste öffnen') : t('Open case', 'Kiste öffnen')} · ${justizEuro(box.cost)}` : t('Log in to open cases', 'Zum Öffnen anmelden')}</button></section>
    ${box.available ? `<details class="case-contents"><summary>${t('Edition contents', 'Inhalt der Ausgabe')} · ${box.items.length}</summary><div class="case-contents-note">${infoTip(t('Rarity and J€ resale values are fixed for this edition. Collected items keep them after rotation.', 'Seltenheit und J€-Verkaufswerte sind für diese Ausgabe fest. Gesammelte Lose behalten sie nach dem Wechsel.'))}</div><div class="inventory-grid">${box.items.map(item => itemCard(item, false)).join('')}</div></details>` : ''}
    `;
}
function resultMarkup() {
  return `<p class="rarity-label rarity-${accountResult.rarity}">${rarityLabel(accountResult.rarity)}</p><h2>${accountEscape(accountResult.title)}</h2>${accountResult.sold ? `<p>${t('Sold. J€ added.', 'Verkauft. J€ gutgeschrieben.')}</p>` : ''}`;
}
function caseResultActions(item, sealedItem = {}, legacy = false) {
  const tiers = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  const cases = ['lost-property', 'evidence-locker', 'seizure', 'vault', 'collectors-cache'];
  const caseId = legacy ? item.caseId : sealedItem.caseType || cases[tiers.indexOf(sealedItem.caseTier)] || cases[0];
  const offer = (legacy ? accountCatalog : accountStore)?.cases?.find(box => box.id === caseId);
  const disabled = !account || !offer || offer.available === false || account.tokens < offer.cost || offer.stock?.remaining === 0;
  return `<button class="primary-button" data-account="${legacy ? 'pull' : 'buy-case'}" data-id="${accountEscape(caseId)}" ${disabled ? 'disabled' : ''}>${t('Buy another case', 'Weitere Kiste kaufen')} (${offer ? justizEuro(offer.cost) : '—'})</button><a class="secondary-button" href="/inventory?focus=${encodeURIComponent(item.id)}" data-page>${t('View in inventory', 'Im Inventar ansehen')}</a><button class="text-button" data-account="close-reveal">${t('Exit', 'Verlassen')}</button>`;
}
function tierCard(rarity) {
  return `<div class="case-tier rarity-${accountEscape(rarity)}"><span class="case-tier-symbol" aria-hidden="true">◇</span><span class="rarity-label">${rarityLabel(rarity)}</span></div>`;
}
function revealCaseItem() {
  caseReveal.innerHTML = `<div class="case-reveal-content case-unboxed rarity-${accountEscape(accountResult.rarity)}"><h2 id="case-reveal-title">${accountEscape(accountResult.title)}</h2><img src="${accountEscape(accountResult.image)}" alt=""><p class="rarity-label">${rarityLabel(accountResult.rarity)}</p><p>${t('Historical real-auction value', 'Historischer Wert der echten Auktion')} ${euro(accountResult.price)}</p><p role="status">${accountResult.sold ? t('Sold. J€ added.', 'Verkauft. J€ gutgeschrieben.') : t('Added to inventory.', 'Zum Inventar hinzugefügt.')}</p><div class="case-reveal-actions">${caseResultActions(accountResult, {}, true)}</div></div>`;
  if (!caseReveal.open) caseReveal.showModal();
  caseReveal.querySelector('[data-account="close-reveal"]').focus({ preventScroll: true });
}
async function accountGameStart(mode) {
  await accountReady;
  if (!account) return guestGameRequest('start', { mode });
  const owner = account.id, result = await accountApi('games/start', { mode });
  if (account?.id !== owner) throw new Error(t('Your account changed. Please start again.', 'Das Konto wurde gewechselt. Bitte starte erneut.'));
  updateAccount(result.user); return timedGameRun(result.run);
}
function timedGameRun(run) {
  return { ...run, clientDeadlineAt: run.roundDeadlineAt ? Date.now() + Math.max(0, run.roundDeadlineAt - run.serverNow) : null };
}
async function guestGameRequest(route, payload) {
  const owner = account?.id;
  const response = await fetch(`/api/games/${route}`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'JUSTIZGUESSR' }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(accountError(result.error)); error.code = result.error; throw error; }
  if (account?.id !== owner) throw new Error(t('Your account changed. Please start again.', 'Das Konto wurde gewechselt. Bitte starte erneut.'));
  return timedGameRun(result.run);
}
async function accountGameRoundStart(run, position) {
  if (run.guest) return guestGameRequest('round/start', { id: run.id, position });
  const owner = account?.id, result = await accountApi('games/round/start', { id: run.id, position });
  if (account?.id !== owner) throw new Error(t('Your account changed. Please start again.', 'Das Konto wurde gewechselt. Bitte starte erneut.'));
  updateAccount(result.user);
  return timedGameRun(result.run);
}
async function accountGameAnswer(run, position, answer) {
  if (run.guest) return guestGameRequest('answer', { id: run.id, position, answer });
  const owner = account?.id, result = await accountApi('games/answer', { id: run.id, position, answer });
  if (account?.id !== owner) throw new Error(t('Your account changed. Please start again.', 'Das Konto wurde gewechselt. Bitte starte erneut.'));
  updateAccount(result.user);
  if (result.run.complete && result.run.earned) showToast(economyFlags.paletteAuctions
    ? t(`+${justizEuro(result.run.earned)}! Explore the auctions.`, `+${justizEuro(result.run.earned)}! Entdecke die Auktionen.`)
    : t(`+${justizEuro(result.run.earned)}! Your next case is waiting.`, `+${justizEuro(result.run.earned)}! Deine nächste Kiste wartet.`));
  return timedGameRun(result.run);
}
async function spinCaseReel(reel, viewport, item, pool, isCurrent, cardMarkup = item => tierCard(item.rarity)) {
  const winnerIndex = 28 + Math.floor(Math.random() * 12);
  const cards = Array.from({ length: 42 }, (_, index) => index === winnerIndex ? item : pool[Math.floor(Math.random() * pool.length)]);
  reel.innerHTML = cards.map(cardMarkup).join('');
  const width = reel.children[0].getBoundingClientRect().width;
  const landingBias = width * (0.25 + Math.random() * 0.5);
  const landingAt = index => index * (width + 12) + landingBias - viewport.clientWidth / 2;
  // The opening reel always spins, including when reduced motion is enabled.
  const animation = reel.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-landingAt(winnerIndex)}px)` }], { duration: 4600 + Math.round(Math.random() * 900), easing: 'cubic-bezier(.12,.72,.12,1)', fill: 'forwards' });
  try { await animation.finished; }
  catch (error) { if (!isCurrent() || !reel.isConnected) return; throw error; }
  if (!isCurrent() || !reel.isConnected) return;
  (reel.children[winnerIndex] || reel.children[0]).classList.add('is-pulled');
}
async function pullCase(visit) {
  if (!account) return;
  caseStockRequest++;
  const owner = account.id, box = accountCatalog.cases.find(box => box.id === accountSelectedCase);
  const storageKey = `justizguessr:pending-case:${owner}:${box.id}`;
  let requestId; try { requestId = localStorage.getItem(storageKey); } catch {}
  requestId ||= crypto.randomUUID(); try { localStorage.setItem(storageKey, requestId); } catch {}
  const result = await accountApi('cases/open', { caseId: box.id, requestId, revision: accountCatalog.revision });
  box.stock = result.stock;
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
window.addEventListener('popstate', () => { if (accountPaths.includes(location.pathname)) navigateAccountPage(location.pathname + location.search, false); else renderStart(); });
document.addEventListener('click', event => {
  const tab = event.target.closest('[data-admin-tab]');
  if (tab && currentAccountPage === '/admin') selectAdminTab(tab.dataset.adminTab);
});
document.addEventListener('keydown', event => {
  const tab = event.target.closest('[data-admin-tab]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const tabs = [...accountContent.querySelectorAll('[data-admin-tab]')];
  const index = tabs.indexOf(tab);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  selectAdminTab(tabs[next].dataset.adminTab, true);
});
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-account]'); if (!button) return;
  const action = button.dataset.account, visit = accountVisit;
  if (action === 'close-reveal') { caseReveal.close(); return; }
  if (accountBusy) return;
  if (action === 'select-store-case') {
    accountSelectedStoreCase = button.dataset.id; renderShop();
    [...accountContent.querySelectorAll('[data-account="select-store-case"]')].find(entry => entry.dataset.id === accountSelectedStoreCase)?.focus({preventScroll: true});
    return;
  }
  if (action === 'refresh') { await navigateAccountPage(currentAccountPage, false); return; }
  accountBusy = true; button.disabled = true;
  try {
    if (action === 'criminal-record-more' && currentAccountPage === '/profile' && account) {
      const owner = account.id, previous = accountCriminalRecord.records.length;
      const result = await accountApi('criminal-record?offset='+previous);
      if (visit === accountVisit && account?.id === owner) {
        accountCriminalRecord = {...result,records:[...accountCriminalRecord.records,...result.records]};
        renderProfile(); accountContent.querySelectorAll('.criminal-record-entry')[previous]?.focus({preventScroll:true});
      }
    }
    if (action === 'logout') {
      await accountApi('logout', {}); updateAccount(null); accountDailyRun = null; higherLowerRequest++; higherLowerRun = null;
      accountResult = null; freshCodes = []; freshPasswordReset = null; accountItems = []; accountCodes = []; accountFriends = { friends: [], date: '' };
      await navigateAccountPage('/login');
    }
    if (action === 'select-case') { accountSelectedCase = button.dataset.id; accountResult = null; renderAccountPage(); }
    if (action === 'buy-case') await buyStoreCase(button.dataset.id, visit);
    if (action === 'pull') { caseReveal.close(); await pullCase(visit); }
    if (action === 'open-inventory-case') {
      const owner = account.id;
      const dialogWasOpen = caseReveal.open;
      const sealedItem = accountItems.find(item => item.id === button.dataset.id) || {caseType: accountSelectedStoreCase};
      const result = await accountApi('inventory/case/open', { id: button.dataset.id });
      if (account?.id !== owner) return;
      updateAccount(result.user);
      const [inventory, stores, store] = await Promise.all([accountApi('inventory?includeStores=1'), economyFlags.businesses ? accountApi('businesses') : null, accountApi('case-store').catch(() => null)]);
      if (visit !== accountVisit || account?.id !== owner) return;
      accountItems = inventory.items; traderStores = stores?.shops || [];
      if (store) accountStore = store;
      if (dialogWasOpen && !caseReveal.open) { renderAccountPage(); return; }
      renderAccountPage();
      caseReveal.innerHTML = `<div class="case-opening-content"><button class="dialog-close" data-account="close-reveal" aria-label="${t('Close', 'Schließen')}">×</button>${caseArtwork(sealedItem)}<h2 id="case-reveal-title">${t('Opening case…', 'Kiste wird geöffnet …')}</h2><div class="case-window" aria-hidden="true"><div class="case-marker"></div><div class="case-reel"></div></div><p>${t('Saved to inventory.', 'Im Inventar gespeichert.')}</p></div>`;
      if (!caseReveal.open) caseReveal.showModal();
      caseReveal.querySelector('[data-account="close-reveal"]').focus({preventScroll: true});
      const pool = accountCatalog?.cases?.find(box => box.id === 'fundkiste')?.items || accountStore?.cases?.[0]?.items || [result.item];
      try { await spinCaseReel(caseReveal.querySelector('.case-reel'), caseReveal.querySelector('.case-window'), result.item,
        pool.length ? pool : [result.item], () => caseReveal.open && visit === accountVisit && account?.id === owner); }
      catch { /* The awarded item is already in inventory; still show it. */ }
      if (visit !== accountVisit || account?.id !== owner || !caseReveal.open) return;
      caseReveal.innerHTML = `<div class="case-reveal-content case-unboxed rarity-${accountEscape(result.item.rarity)}"><p class="case-receipt-label">${t('CASE OPENED', 'KISTE GEÖFFNET')}</p><h2 id="case-reveal-title">${accountEscape(result.item.title)}</h2>${result.item.image ? `<img src="${accountEscape(result.item.image)}" alt="">` : ''}<p class="rarity-label">${rarityLabel(result.item.rarity)}</p><p>${t('Historical real-auction value', 'Historischer Wert der echten Auktion')} ${euro(result.item.price)}</p><p>${t('Added to inventory.', 'Zum Inventar hinzugefügt.')}</p><div class="case-reveal-actions">${caseResultActions(result.item, sealedItem)}</div></div>`;
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
    if (visit === accountVisit) { if (['catalog_changed', 'case_out_of_stock'].includes(error.code)) await navigateAccountPage('/shop', false); showToast(error.message); }
  } finally {
    accountBusy = false; if (button.isConnected) button.disabled = false;
    updateCasePurchaseButtons();
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
      updateAccount(result.user, { reset: true }); accountDailyRun = null; higherLowerRequest++; higherLowerRun = null;
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
  if (event.target.id === 'admin-market-search') {
    adminMarketFilter = event.target.value;
    const query = adminMarketFilter.trim().toLowerCase();
    const rows = [...accountContent.querySelectorAll('[data-market-category]')];
    for (const row of rows) row.hidden = !row.dataset.marketName.includes(query);
    const empty = accountContent.querySelector('#admin-market-empty');
    if (empty) empty.hidden = rows.some(row => !row.hidden);
  }
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
