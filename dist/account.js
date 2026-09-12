let account = null, accountCatalog = null, accountItems = [], accountCodes = [], freshCodes = [];
let accountFriends = { friends: [], date: '' }, accountAdmin = { playerCount: 0, grants: [] };
let accountBusy = false, accountDailyRun = null, accountResult = null;
let accountSelectedCase = 'fundkiste', accountInventoryPage = 0, accountFilter = 'all';
let currentAccountPage = null, accountVisit = 0, pageLoaded = false;
const accountPaths = ['/shop', '/inventory', '/profile', '/login', '/register', '/admin'];
const accountPage = document.querySelector('#account-page');
const accountContent = document.querySelector('#account-content');
const accountEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function accountError(code) {
  const errors = {
    invalid_username: t('Use 3–32 letters, numbers, underscores or hyphens.', 'Nutze 3–32 Buchstaben, Zahlen, Unterstriche oder Bindestriche.'),
    invalid_password: t('Passwords must contain 12–128 characters.', 'Das Passwort muss 12–128 Zeichen lang sein.'),
    invalid_login: t('Incorrect username or password.', 'Benutzername oder Passwort ist falsch.'),
    invalid_code: t('This code is invalid or already used.', 'Dieser Code ist ungültig oder bereits verwendet.'),
    username_taken: t('That username is already taken.', 'Dieser Benutzername ist bereits vergeben.'),
    login_required: t('Please sign in again.', 'Bitte melde dich erneut an.'),
    insufficient_tokens: t('You do not have enough tokens yet.', 'Du hast noch nicht genug Tokens.'),
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
    invalid_grant_amount: t('Enter a whole number from 1 to 1,000,000 tokens.', 'Gib eine ganze Zahl von 1 bis 1.000.000 Tokens ein.'),
    request_conflict: t('This request was already used with different values.', 'Diese Anfrage wurde bereits mit anderen Werten verwendet.')
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
  const labels = { '/': t('Play', 'Spielen'), '/shop': 'Shop', '/inventory': t('Inventory', 'Inventar'), '/profile': t('Profile', 'Profil'), '/admin': 'Admin' };
  for (const link of document.querySelectorAll('.site-nav a')) {
    link.textContent = labels[link.getAttribute('href')];
    if (link.pathname === location.pathname) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    if (link.pathname === '/admin') link.hidden = !account?.admin;
  }
  const auth = document.querySelector('#header-auth');
  auth.href = account ? '/profile' : '/login';
  auth.textContent = account ? `${account.username} · ${number(account.tokens)} ${t('tokens', 'Tokens')}` : t('Log in / Register', 'Anmelden / Registrieren');
  document.querySelector('.site-nav').setAttribute('aria-label', t('Main navigation', 'Hauptnavigation'));
}
function updateAccount(user) { account = user; updateNavigation(); }
const accountReady = accountApi('me').then(result => {
  updateAccount(result.user);
  if (typeof renderStart === 'function' && state.view === 'start' && location.pathname === '/') renderStart();
}).catch(() => {});
function showGamePage() {
  currentAccountPage = null; accountVisit++; pageLoaded = false;
  accountPage.hidden = true; document.querySelector('#app').hidden = false;
  if (location.pathname !== '/') history.pushState({}, '', '/');
  updateNavigation();
}
async function navigateAccountPage(path, push = true) {
  if (!accountPaths.includes(path)) { renderStart(); return; }
  if (push && location.pathname !== path) history.pushState({}, '', path);
  const visit = ++accountVisit;
  currentAccountPage = path; pageLoaded = false;
  higherLowerRequest++; clearInterval(countdownTimer); state.view = 'account';
  document.querySelector('#app').hidden = true; accountPage.hidden = false; updateNavigation();
  accountContent.innerHTML = `<p class="collection-loading">${t('Loading…', 'Wird geladen …')}</p>`;
  window.scrollTo({ top: 0, behavior: 'instant' });
  try {
    await accountReady;
    const session = await accountApi('me');
    if (visit !== accountVisit) return;
    updateAccount(session.user);
    const owner = account?.id;
    if (path === '/shop' || (path === '/inventory' && account)) {
      const catalog = await accountApi('cases'); if (visit !== accountVisit) return; accountCatalog = catalog;
    }
    if (path === '/inventory' && account) {
      const result = await accountApi('inventory'); if (visit !== accountVisit || account?.id !== owner) return; accountItems = result.items;
    }
    if (path === '/profile' && account) {
      const result = await accountApi('friends'); if (visit !== accountVisit || account?.id !== owner) return; accountFriends = result;
    }
    if (path === '/admin' && account?.admin) {
      const [codes, admin] = await Promise.all([accountApi('codes'), accountApi('admin')]);
      if (visit !== accountVisit || account?.id !== owner) return;
      accountCodes = codes.codes; accountAdmin = admin;
    }
    if (visit !== accountVisit) return;
    pageLoaded = true; renderAccountPage(); accountContent.querySelector('h1')?.focus({ preventScroll: true });
  } catch (error) {
    if (visit !== accountVisit) return;
    accountContent.innerHTML = `<section class="collection-empty"><h1 tabindex="-1">${t('Unable to load this page', 'Seite konnte nicht geladen werden')}</h1><p role="alert">${accountEscape(error.message)}</p><button data-account="refresh">${t('Try again', 'Erneut versuchen')}</button></section>`;
  }
}
function pageHeading(title, text) {
  return `<header class="collection-heading"><p class="eyebrow">JUSTIZGUESSR</p><h1 tabindex="-1">${title}</h1><p>${text}</p></header>`;
}
function loginNotice(subject) {
  return `<section class="collection-empty"><span aria-hidden="true">◇</span><h2>${t(`Log in to view your ${subject}.`, subject === 'inventory' ? 'Melde dich an, um dein Inventar zu sehen.' : 'Melde dich an, um dein Profil zu sehen.')}</h2><p>${t('Your collection and friends will be waiting here.', 'Deine Sammlung und Freunde warten hier auf dich.')}</p><a class="primary-button" href="/login" data-page>${t('Log in', 'Anmelden')}</a></section>`;
}
function accountValueMarkup() {
  return `<div class="account-value"><span>${t('TOTAL ACCOUNT VALUE', 'GESAMTER KONTOWERT')}<strong>${euro(account.accountValueEur)}</strong></span><p>${t(`Auction values of your collection (${account.itemCount} item${account.itemCount === 1 ? "" : "s"}). Tokens are not included in the euro value.`, `Auktionswerte deiner Sammlung (${account.itemCount} Lose). Tokens zählen nicht zum Eurowert.`)}</p></div>`;
}
function renderAccountPage() {
  if (!pageLoaded || !currentAccountPage) return;
  if (currentAccountPage === '/shop') renderShop();
  else if (currentAccountPage === '/inventory') renderInventory();
  else if (currentAccountPage === '/profile') renderProfile();
  else if (currentAccountPage === '/admin') renderAdmin();
  else renderAuth();
}
function renderAuth() {
  const register = currentAccountPage === '/register';
  accountContent.innerHTML = pageHeading(register ? t('Create an account.', 'Konto erstellen.') : t('Welcome back.', 'Willkommen zurück.'), t('A username. A password. Your collection.', 'Ein Benutzername. Ein Passwort. Deine Sammlung.')) +
    (account ? `<p>${t('You are already logged in.', 'Du bist bereits angemeldet.')}</p><a class="secondary-button" href="/profile" data-page>${t('Go to profile', 'Zum Profil')}</a>` :
    `<form id="account-form" class="account-form"><label>${t('Username', 'Benutzername')}<input name="username" autocomplete="username" required pattern="[a-zA-Z0-9_-]{3,32}" minlength="3" maxlength="32"></label>
    <label>${t('Password', 'Passwort')}<input name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" required minlength="12" maxlength="128"></label>
    ${register ? `<label>${t('Registration code', 'Registrierungscode')}<input name="code" autocomplete="off" required minlength="32" maxlength="32" spellcheck="false"></label><p>${t('Ask an admin for a single-use registration code. Passwords need at least 12 characters.', 'Du erhältst einen einmal verwendbaren Code vom Admin. Passwörter benötigen mindestens 12 Zeichen.')}</p>` : ''}
    <p class="account-error" role="alert"></p><button class="primary-button" type="submit">${register ? t('Register', 'Registrieren') : t('Log in', 'Anmelden')}</button>
    <a class="text-button" href="${register ? '/login' : '/register'}" data-page>${register ? t('Already registered? Log in', 'Schon registriert? Anmelden') : t('Have a code? Create an account', 'Du hast einen Code? Konto erstellen')}</a></form>`);
}
function rarityLabel(id) {
  return ({ common: t('Common', 'Gewöhnlich'), uncommon: t('Uncommon', 'Ungewöhnlich'), rare: t('Rare', 'Selten'), epic: t('Epic', 'Episch'), legendary: t('Legendary', 'Legendär') })[id] || id;
}
function itemCard(item, controls = true) {
  return `<article class="collection-item rarity-${accountEscape(item.rarity)}"><span class="rarity-label">${rarityLabel(item.rarity)}</span>
    <img src="${accountEscape(item.image)}" alt="" loading="lazy"><h3>${accountEscape(item.title)}</h3><p>${t('Auction value', 'Auktionswert')} ${euro(item.price)}</p>
    ${controls ? `<button class="secondary-button" data-account="sell" data-id="${accountEscape(item.id)}">${t('Sell', 'Verkaufen')} · ${number(item.sellValue)} ${t('tokens', 'Tokens')}</button>` : `<span class="item-value">${number(item.sellValue)} ${t('tokens', 'Tokens')}</span>`}</article>`;
}
function renderInventory() {
  accountContent.innerHTML = pageHeading(t('Your inventory.', 'Dein Inventar.'), t('Every find has a story. Keep yours or trade it for tokens.', 'Jeder Fund hat eine Geschichte. Behalte ihn oder tausche ihn gegen Tokens.'));
  if (!account) { accountContent.innerHTML += loginNotice('inventory'); return; }
  const filtered = accountItems.filter(item => accountFilter === 'all' || item.rarity === accountFilter);
  accountInventoryPage = Math.min(accountInventoryPage, Math.max(0, Math.ceil(filtered.length / 24) - 1));
  accountContent.innerHTML += accountValueMarkup() + `<div class="inventory-heading"><h2>${t('Collection', 'Sammlung')} <small>${accountItems.length} ${accountItems.length === 1 ? t('item', 'Los') : t('items', 'Lose')}</small></h2><label>${t('Rarity', 'Seltenheit')} <select id="rarity-filter"><option value="all">${t('All', 'Alle')}</option>${accountCatalog.rarities.map(rarity => `<option value="${rarity.id}" ${accountFilter === rarity.id ? 'selected' : ''}>${rarityLabel(rarity.id)}</option>`).join('')}</select></label></div>
    ${filtered.length ? `<div class="inventory-grid">${filtered.slice(accountInventoryPage * 24, (accountInventoryPage + 1) * 24).map(item => itemCard(item)).join('')}</div><div class="inventory-pages"><button data-account="page" data-step="-1" ${accountInventoryPage ? '' : 'disabled'}>← ${t('Previous', 'Zurück')}</button><span>${accountInventoryPage + 1} / ${Math.ceil(filtered.length / 24)}</span><button data-account="page" data-step="1" ${(accountInventoryPage + 1) * 24 >= filtered.length ? 'disabled' : ''}>${t('Next', 'Weiter')} →</button></div>` : `<div class="collection-empty"><h2>${t('Your next find belongs here.', 'Hier wartet dein nächster Fund.')}</h2><p>${t('Open a case to start your collection, or try another rarity filter.', 'Öffne eine Kiste für deine Sammlung oder wähle einen anderen Seltenheitsfilter.')}</p><a class="primary-button" href="/shop" data-page>${t('Visit the shop', 'Zum Shop')} →</a></div>`}`;
}
function dailyFriendLabel(daily) {
  if (daily.status === 'completed') return `${number(daily.score)} / ${number(5000)} ${t('pts', 'Pkt')}`;
  return daily.status === 'in_progress' ? t(`In progress · ${daily.completedRounds} / 5 lots`, `In Arbeit · ${daily.completedRounds} / 5 Lose`) : t('Not played yet', 'Noch nicht gespielt');
}
function rewardNote() {
  if (!account) return t('Log in before playing to earn tokens.', 'Melde dich vor dem Spielen an, um Tokens zu verdienen.');
  if (!account.reward) return t('Your daily reward run is available. Finish Daily for 100 tokens, or earn up to 200 in Higher or Lower.', 'Dein täglicher Token-Lauf ist verfügbar. Schließe das Daily für 100 Tokens ab oder verdiene bis zu 200 in Higher or Lower.');
  return account.reward.complete ? t(`You earned ${account.reward.earned} tokens today. Your next reward run unlocks at 00:00 UTC.`, `Du hast heute ${account.reward.earned} Tokens verdient. Dein nächster Token-Lauf startet um 00:00 UTC.`) : t(`Resume your ${account.reward.mode === 'daily' ? 'Daily' : 'Higher or Lower'} run to earn today’s tokens.`, `Setze deinen ${account.reward.mode === 'daily' ? 'Daily' : 'Higher-or-Lower'}-Lauf für die heutigen Tokens fort.`);
}
function rewardBanner() { return `<p class="reward-note">${accountEscape(rewardNote())}</p>`; }
function renderProfile() {
  accountContent.innerHTML = pageHeading(account ? accountEscape(account.username) : t('Your profile.', 'Dein Profil.'), t('Your collection, your progress, your friends.', 'Deine Sammlung, dein Fortschritt, deine Freunde.'));
  if (!account) { accountContent.innerHTML += loginNotice('profile'); return; }
  accountContent.innerHTML += accountValueMarkup() + `<div class="profile-stats"><div><span>TOKENS</span><strong>${number(account.tokens)}</strong></div><div><span>${t('TODAY’S DAILY', 'HEUTIGES DAILY')}</span><strong>${dailyFriendLabel(account.daily)}</strong></div><button class="secondary-button" data-account="logout">${t('Log out', 'Abmelden')}</button></div>${rewardBanner()}
    <section class="profile-friends"><div class="friends-heading"><div><h2>${t('Friends', 'Freunde')}</h2><p>${t('Daily for', 'Daily vom')} ${accountFriends.date} · ${t('Resets at 00:00 UTC', 'Reset um 00:00 UTC')}</p></div><button data-account="refresh">${t('Refresh', 'Aktualisieren')}</button></div>${friendsMarkup()}</section>`;
}
function friendsMarkup() {
  const accepted = accountFriends.friends.filter(friend => friend.status === 'accepted');
  const incoming = accountFriends.friends.filter(friend => friend.status === 'incoming');
  const outgoing = accountFriends.friends.filter(friend => friend.status === 'outgoing');
  const requests = (friends, incoming) => friends.map(friend => `<div class="friend-request"><strong>${accountEscape(friend.username)}</strong><span>${incoming ? t('Wants to be your friend', 'Möchte mit dir befreundet sein') : t('Waiting for a reply', 'Wartet auf Antwort')}</span><div>${incoming ? `<button data-account="friend-accept" data-id="${friend.id}">${t('Accept', 'Annehmen')}</button>` : ''}<button data-account="friend-remove" data-id="${friend.id}">${incoming ? t('Decline', 'Ablehnen') : t('Cancel request', 'Zurückziehen')}</button></div></div>`).join('');
  return `<form id="friend-form" class="friend-form"><label>${t('Username', 'Benutzername')}<input name="username" required minlength="3" maxlength="32" pattern="[a-zA-Z0-9_-]{3,32}" autocomplete="off" placeholder="${t('Your friend’s username', 'Benutzername eines Freundes')}"></label><button class="secondary-button" type="submit">${t('Send request', 'Anfrage senden')}</button><p class="account-error" role="alert"></p></form>
    <p class="earning-detail">${t('Once accepted, you can see each other’s inventory value and today’s Daily progress.', 'Nach dem Annehmen seht ihr gegenseitig euren Inventarwert und den heutigen Daily-Spielstand.')}</p>
    ${incoming.length ? `<h3>${t('Incoming requests', 'Anfragen an dich')} · ${incoming.length}</h3><div class="friend-requests">${requests(incoming, true)}</div>` : ''}
    ${outgoing.length ? `<h3>${t('Sent requests', 'Gesendete Anfragen')} · ${outgoing.length}</h3><div class="friend-requests">${requests(outgoing, false)}</div>` : ''}
    <h3>${t('Your friends', 'Deine Freunde')} · ${accepted.length}</h3>
    ${accepted.length ? `<div class="friend-grid">${accepted.map(friend => `<article class="friend-card"><h4>${accountEscape(friend.username)}</h4><dl><div><dt>${t('TODAY’S DAILY', 'HEUTIGES DAILY')}</dt><dd>${dailyFriendLabel(friend.daily)}</dd></div><div><dt>${t('INVENTORY VALUE', 'INVENTARWERT')}</dt><dd>${euro(friend.inventoryValueEur)}</dd></div><div><dt>${t('COLLECTED ITEMS', 'GESAMMELTE LOSE')}</dt><dd>${friend.itemCount}</dd></div></dl><button data-account="friend-remove" data-id="${friend.id}">${t('Remove friend', 'Freund entfernen')}</button></article>`).join('')}</div>` : `<p class="collection-empty">${t('No friends yet. Send a request using their username.', 'Noch keine Freunde. Sende eine Anfrage über den Benutzernamen.')}</p>`}`;
}
function renderAdmin() {
  accountContent.innerHTML = pageHeading(t('Admin desk.', 'Adminbereich.'), t('Invite players and give your community a token boost.', 'Lade Spieler ein und schenke deiner Community Tokens.'));
  if (!account?.admin) { accountContent.innerHTML += `<p class="collection-empty">${t('Log in with an admin account to access this page.', 'Melde dich mit einem Adminkonto an, um diese Seite zu nutzen.')}</p>`; return; }
  accountContent.innerHTML += `<section class="admin-section"><h2>${t('Give players tokens', 'Spielern Tokens geben')}</h2><p>${t(`Give a custom amount to every existing account, including admins (${accountAdmin.playerCount} currently). Accounts registered afterwards will not receive this grant.`, `Gib jedem bestehenden Konto inklusive Admins einen Betrag deiner Wahl (aktuell ${accountAdmin.playerCount}). Später registrierte Konten erhalten diese Gutschrift nicht.`)}</p>
    <form id="grant-form" class="grant-form"><label>${t('Tokens per player', 'Tokens pro Spieler')}<input name="amount" type="number" min="1" max="1000000" step="1" value="100" required></label><button class="primary-button" type="submit">${t('Give tokens to all current players', 'Tokens an alle aktuellen Spieler geben')}</button><p class="account-error" role="alert"></p></form>
    <div class="grant-history">${accountAdmin.grants.map(grant => `<p>${new Date(grant.createdAt).toLocaleString(uiLocale())} · ${number(grant.amount)} ${t('tokens each', 'Tokens je Spieler')} · ${grant.recipients} ${t('players', 'Spieler')}</p>`).join('')}</div></section>
    <section class="admin-section"><h2>${t('Registration codes', 'Registrierungscodes')}</h2><p>${t('Each code allows one registration. Full codes are shown only just after creation.', 'Jeder Code erlaubt eine Registrierung. Vollständige Codes werden nur direkt nach dem Erstellen angezeigt.')}</p>
    <form id="code-form" class="code-form"><label>${t('Number of codes', 'Anzahl der Codes')}<input name="count" type="number" min="1" max="50" value="5" required></label><button class="primary-button" type="submit">${t('Create codes', 'Codes erstellen')}</button><p class="account-error" role="alert"></p></form>
    ${freshCodes.length ? `<label class="fresh-codes">${t('New codes — copy and save them now', 'Neue Codes — jetzt kopieren und aufbewahren')}<textarea readonly rows="${Math.min(10, freshCodes.length + 1)}">${freshCodes.join('\n')}</textarea></label>` : ''}
    <div class="code-list">${accountCodes.map(code => `<div><code>…${accountEscape(code.label)}</code><span>${code.used_at !== null ? t('Used', 'Verwendet') : code.revoked ? t('Revoked', 'Widerrufen') : t('Available', 'Verfügbar')}</span>${code.used_at === null && !code.revoked ? `<button data-account="revoke" data-id="${code.id}">${t('Revoke', 'Widerrufen')}</button>` : ''}</div>`).join('') || `<p>${t('No codes created yet.', 'Noch keine Codes erstellt.')}</p>`}</div></section>`;
}
function renderShop() {
  const box = accountCatalog.cases.find(box => box.id === accountSelectedCase) || accountCatalog.cases[0];
  accountContent.innerHTML = pageHeading('Shop', t('Sealed cases. Unexpected finds.', 'Versiegelte Kisten. Unerwartete Fundstücke.')) +
    `<div class="shop-balance">${account ? `${number(account.tokens)} ${t('tokens available', 'Tokens verfügbar')}` : `${t('Browse the cases. Log in to earn tokens and open one.', 'Entdecke die Kisten. Melde dich an, um Tokens zu verdienen und eine zu öffnen.')} <a href="/login" data-page>${t('Log in', 'Anmelden')} →</a>`}</div>
    <div class="case-options">${accountCatalog.cases.map(option => `<button class="case-option ${box.id === option.id ? 'is-selected' : ''}" data-account="select-case" data-id="${option.id}" aria-pressed="${box.id === option.id}"><span class="case-art" aria-hidden="true">▱<b>JG.</b></span><span><strong>${option.name}</strong><small>${number(option.cost)} ${t('tokens', 'Tokens')}</small></span></button>`).join('')}</div>
    <section class="case-stage" aria-label="${t('Case opening', 'Kistenöffnung')}"><div class="case-stage-heading"><span>${box.name.toUpperCase()}</span><span>${t('YOUR NEXT FIND', 'DEIN NÄCHSTER FUND')}</span></div>
    <div class="case-window" aria-hidden="true"><div class="case-marker"></div><div class="case-reel">${accountCatalog.items.slice(0, 10).map(item => itemCard(item, false)).join('')}</div></div>
    <div class="case-result" role="status">${accountResult ? resultMarkup() : `<h2>${t('What’s inside?', 'Was steckt drin?')}</h2><p>${t('One digital auction collectible in every case.', 'Ein digitales Auktionslos in jeder Kiste.')}</p>`}</div>
    <button class="primary-button case-open" data-account="pull" ${!account || account.tokens < box.cost || !box.available || accountBusy ? 'disabled' : ''}>${account ? `${accountResult ? t('Open another case', 'Weitere Kiste öffnen') : t('Open case', 'Kiste öffnen')} · ${number(box.cost)} ${t('tokens', 'Tokens')}` : t('Log in to open cases', 'Zum Öffnen anmelden')}</button></section>
    <p class="data-note">${t('Digital collectibles. No ownership of the real auction item. Tokens have no cash value.', 'Digitale Sammelobjekte. Kein Eigentum am echten Auktionsgegenstand. Tokens haben keinen Geldwert.')}</p>`;
}
function resultMarkup() {
  return `<p class="rarity-label rarity-${accountResult.rarity}">${rarityLabel(accountResult.rarity)}</p><h2>${accountEscape(accountResult.title)}</h2><p>${accountResult.sold ? t('Sold. Tokens added to your balance.', 'Verkauft. Tokens gutgeschrieben.') : t('Your find is safe in your inventory.', 'Dein Fund liegt sicher im Inventar.')}</p>
    ${accountResult.sold ? '' : `<button class="secondary-button" data-account="sell-result" data-id="${accountResult.id}">${t('Sell now', 'Sofort verkaufen')} · ${number(accountResult.sellValue)} ${t('tokens', 'Tokens')}</button>`}`;
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
  if (result.run.complete && result.run.earned) showToast(t(`+${result.run.earned} tokens! Your next case is waiting.`, `+${result.run.earned} Tokens! Deine nächste Kiste wartet.`));
  return result.run;
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
  updateAccount(result.user); accountResult = result.item;
  if (visit !== accountVisit) return;
  renderAccountPage();
  const reel = accountContent.querySelector('.case-reel'), viewport = accountContent.querySelector('.case-window'), resultNode = accountContent.querySelector('.case-result');
  resultNode.innerHTML = `<h2>${t('The hammer is spinning…', 'Der Hammer kreist …')}</h2><p>${t('Revealing your find.', 'Dein Fund wird aufgedeckt.')}</p>`;
  const winnerIndex = 34;
  const cards = Array.from({ length: 42 }, (_, index) => index === winnerIndex ? result.item : accountCatalog.items[Math.floor(Math.random() * accountCatalog.items.length)]);
  reel.innerHTML = cards.map(item => itemCard(item, false)).join(''); reel.querySelectorAll('img').forEach(img => img.loading = 'eager');
  let imageTimer;
  await Promise.race([reel.children[winnerIndex].querySelector('img').decode().catch(() => {}), new Promise(resolve => { imageTimer = setTimeout(resolve, 1800); })]); clearTimeout(imageTimer);
  if (visit !== accountVisit || !reel.isConnected) return;
  const width = reel.children[0].getBoundingClientRect().width, landing = winnerIndex * (width + 12) + width / 2 - viewport.clientWidth / 2;
  const animation = reel.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-landing}px)` }], { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 5200, easing: 'cubic-bezier(.12,.72,.12,1)', fill: 'forwards' });
  await animation.finished;
  if (visit !== accountVisit || !reel.isConnected) return;
  reel.children[winnerIndex].classList.add('is-pulled'); resultNode.innerHTML = resultMarkup();
  resultNode.querySelector('button')?.focus({ preventScroll: true });
}
document.addEventListener('click', event => {
  const link = event.target.closest('a[data-page]');
  if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); if (link.pathname === '/') renderStart(); else navigateAccountPage(link.pathname);
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
    if (action === 'pull') await pullCase(visit);
    if (action === 'sell' || action === 'sell-result') {
      const owner = account.id, result = await accountApi('inventory/sell', { id: button.dataset.id });
      if (account?.id !== owner) return;
      updateAccount(result.user); if (accountResult?.id === button.dataset.id) accountResult.sold = true;
      accountItems = accountItems.filter(item => item.id !== button.dataset.id);
      if (visit === accountVisit) { renderAccountPage(); showToast(t(`${result.value} tokens added.`, `${result.value} Tokens gutgeschrieben.`)); }
    }
    if (action === 'revoke') { await accountApi('codes/revoke', { id: button.dataset.id }); if (visit === accountVisit) await navigateAccountPage('/admin', false); }
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
  if (!event.target.matches('#account-form, #code-form, #friend-form, #grant-form')) return;
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
      if (visit === accountVisit) { await navigateAccountPage('/admin', false); showToast(t(`Gave ${number(result.grant.amount)} tokens each to ${result.grant.recipients} existing players.`, `${result.grant.recipients} bestehende Spieler haben je ${number(result.grant.amount)} Tokens erhalten.`)); }
    } else {
      const result = await accountApi('codes', { count: Number(data.count) });
      if (visit === accountVisit) { freshCodes = result.codes; await navigateAccountPage('/admin', false); }
    }
  } catch (error) {
    if (visit === accountVisit) { const node = form.querySelector('.account-error'); if (node) node.textContent = error.message; else showToast(error.message); }
  } finally { accountBusy = false; if (button.isConnected) button.disabled = false; }
});
document.addEventListener('change', event => { if (event.target.id === 'rarity-filter') { accountFilter = event.target.value; accountInventoryPage = 0; renderAccountPage(); } });
document.addEventListener('jg:language', () => {
  updateNavigation();
  if (currentAccountPage && pageLoaded) {
    const inputs = [...accountContent.querySelectorAll('input')].map(input => ({ name: input.name, value: input.value }));
    renderAccountPage();
    for (const { name, value } of inputs) { const input = [...accountContent.querySelectorAll('input')].find(input => input.name === name); if (input) input.value = value; }
  }
});
updateNavigation();
