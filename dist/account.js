let account = null;
let accountTab = 'cases';
let accountCatalog = null;
let accountItems = [];
let accountCodes = [];
let freshCodes = [];
let accountBusy = false;
let accountDailyRun = null;
let accountResult = null;
let accountSelectedCase = 'fundkiste';
let accountInventoryPage = 0;
let accountFilter = 'all';
const accountDialog = document.querySelector('#account-dialog');
const accountContent = document.querySelector('#account-content');
const accountErrors = {
  invalid_username: 'Benutzername: 3–32 Zeichen, nur Buchstaben, Zahlen, _ und -.',
  invalid_password: 'Das Passwort muss 12–128 Zeichen lang sein.',
  invalid_login: 'Benutzername oder Passwort ist falsch.', invalid_code: 'Dieser Registrierungscode ist ungültig oder bereits verwendet.',
  username_taken: 'Dieser Benutzername ist bereits vergeben.', login_required: 'Bitte melde dich erneut an.',
  insufficient_tokens: 'Du hast noch nicht genug Tokens.', try_later: 'Zu viele Versuche. Bitte versuche es später erneut.',
  forbidden: 'Diese Aktion ist nicht erlaubt.', daily_reset: 'Ein neues Daily ist da. Bitte lade die Seite neu.',
  insufficient_variety: 'Noch nicht genug unterschiedliche Auktionen verfügbar.',
  answer_conflict: 'Dieser Tipp wurde bereits in einem anderen Tab abgegeben. Starte das Spiel erneut, um fortzusetzen.',
  empty_catalog: 'Aktuell sind keine Kisteninhalte verfügbar.'
};
const accountEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
async function accountApi(route, payload) {
  const response = await fetch(`/api/account/${route}`, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { accept: 'application/json', ...(payload === undefined ? {} : { 'content-type': 'application/json', 'x-requested-with': 'JUSTIZGUESSR' }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(accountErrors[result.error] || 'Das hat nicht geklappt. Bitte versuche es erneut.');
    error.code = result.error;
    throw error;
  }
  return result;
}
function updateAccount(user) {
  account = user;
  document.querySelector('[data-account="open"]').textContent = user ? `${user.username} · ${user.tokens} ◈` : 'Anmelden / Kisten';
}
const accountReady = accountApi('me').then(result => {
  updateAccount(result.user);
  if (typeof renderStart === 'function' && state.view === 'start') renderStart();
}).catch(() => {});

function rewardNote() {
  if (!account) return 'Melde dich vor dem Spielen an, um Tokens zu verdienen.';
  if (!account.reward) return 'Ein Token-Lauf pro UTC-Tag: Daily abschließen = 100 ◈. Higher or Lower: ab 3 richtigen Tipps je 20 ◈, maximal 200 ◈.';
  return account.reward.complete
    ? `Heute ${account.reward.earned} ◈ verdient. Weitere Spiele sind Übungsrunden. Neue Tokens ab 00:00 UTC.`
    : `Dein heutiger Token-Lauf: ${account.reward.mode === 'daily' ? 'Daily' : 'Higher or Lower'}. Setze ihn fort. Andere Runden sind Übung.`;
}
function rewardBanner() { return `<p class="reward-note">◈ ${accountEscape(rewardNote())}</p>`; }
async function accountGameStart(mode) {
  await accountReady;
  if (!account) return null;
  const owner = account.id;
  const result = await accountApi('games/start', { mode });
  if (account?.id !== owner) throw new Error('Das Konto wurde gewechselt. Bitte starte erneut.');
  updateAccount(result.user);
  return result.run;
}
async function accountGameAnswer(run, position, answer) {
  const owner = account?.id;
  const result = await accountApi('games/answer', { id: run.id, position, answer });
  if (account?.id !== owner) throw new Error('Das Konto wurde gewechselt. Bitte starte erneut.');
  updateAccount(result.user);
  if (result.run.complete && result.run.earned) showToast(`+${result.run.earned} Tokens! Deine nächste Kiste wartet.`);
  return result.run;
}
function rarityLabel(id) { return accountCatalog?.rarities.find(rarity => rarity.id === id)?.name || id; }
function itemCard(item, controls = true) {
  return `<article class="collection-item rarity-${accountEscape(item.rarity)}">
    <span class="rarity-label">${accountEscape(rarityLabel(item.rarity))}</span>
    <img src="${accountEscape(item.image)}" alt="" loading="lazy">
    <h3>${accountEscape(item.title)}</h3><p>Auktionswert ${euro(item.price)}</p>
    ${controls ? `<button class="secondary-button" data-account="sell" data-id="${accountEscape(item.id)}">Verkaufen · ${item.sellValue} ◈</button>` : `<span class="item-value">${item.sellValue} ◈</span>`}
  </article>`;
}
function accountShell() {
  accountContent.innerHTML = `<div class="collection-heading"><p class="eyebrow">DEIN AUKTIONSDEPOT</p><h2>${account ? `Hallo, ${accountEscape(account.username)}.` : 'Vom Tipp zum Fundstück.'}</h2>
    <p>Spielen. Tokens verdienen. Echte Auktionsmotive sammeln.</p></div>
    <nav class="collection-tabs" aria-label="Auktionsdepot">
      <button data-account="tab" data-tab="cases" ${accountTab === 'cases' ? 'aria-current="page"' : ''}>Kisten</button>
      <button data-account="tab" data-tab="inventory" ${accountTab === 'inventory' ? 'aria-current="page"' : ''}>Inventar</button>
      ${account?.admin ? `<button data-account="tab" data-tab="admin" ${accountTab === 'admin' ? 'aria-current="page"' : ''}>Registrierungscodes</button>` : ''}
      <button data-account="${account ? 'logout' : 'tab'}" data-tab="login">${account ? 'Abmelden' : 'Anmelden'}</button>
      ${account ? `<strong class="token-balance">${account.tokens} ◈</strong>` : ''}
    </nav><div id="collection-pane"></div>`;
  const pane = accountContent.querySelector('#collection-pane');
  if (accountTab === 'login' || accountTab === 'register' || (!account && accountTab === 'inventory')) {
    const register = accountTab === 'register';
    pane.innerHTML = `<form id="account-form" class="account-form"><h3>${register ? 'Konto erstellen' : 'Willkommen zurück'}</h3>
      <label>Benutzername<input name="username" autocomplete="username" required pattern="[a-zA-Z0-9_-]{3,32}" minlength="3" maxlength="32"></label>
      <label>Passwort<input name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" required minlength="12" maxlength="128"></label>
      ${register ? '<label>Registrierungscode<input name="code" autocomplete="off" required minlength="32" maxlength="32" spellcheck="false"></label><p>Du erhältst einen einmal verwendbaren Code vom Admin. Passwort: mindestens 12 Zeichen.</p>' : ''}
      <p class="account-error" role="alert"></p><button class="primary-button" type="submit">${register ? 'Registrieren' : 'Anmelden'}</button>
      <button class="text-button" type="button" data-account="tab" data-tab="${register ? 'login' : 'register'}">${register ? 'Schon registriert? Anmelden' : 'Du hast einen Code? Konto erstellen'}</button></form>`;
  } else if (accountTab === 'admin' && account?.admin) {
    pane.innerHTML = `<h3>Platz für neue Mitspieler.</h3><p>Jeder Code erlaubt genau eine Registrierung. Vollständige Codes werden nur direkt nach dem Erstellen angezeigt.</p>
      <form id="code-form" class="code-form"><label>Anzahl<input name="count" type="number" min="1" max="50" value="5" required></label><button class="primary-button">Codes erstellen</button></form>
      ${freshCodes.length ? `<label class="fresh-codes">Neue Codes — jetzt kopieren und sicher aufbewahren<textarea readonly rows="${Math.min(10, freshCodes.length + 1)}">${freshCodes.join('\n')}</textarea></label>` : ''}
      <div class="code-list">${accountCodes.map(code => `<div><code>…${accountEscape(code.label)}</code><span>${code.used_at !== null ? 'Verwendet' : code.revoked ? 'Widerrufen' : 'Verfügbar'}</span>${code.used_at === null && !code.revoked ? `<button data-account="revoke" data-id="${code.id}">Widerrufen</button>` : ''}</div>`).join('') || '<p>Noch keine Codes erstellt.</p>'}</div>`;
  } else if (accountTab === 'inventory') {
    const filtered = accountItems.filter(item => accountFilter === 'all' || item.rarity === accountFilter);
    accountInventoryPage = Math.min(accountInventoryPage, Math.max(0, Math.ceil(filtered.length / 24) - 1));
    pane.innerHTML = `<div class="inventory-heading"><h3>Deine Sammlung <span>${accountItems.length} ${accountItems.length === 1 ? 'Los' : 'Lose'}</span></h3>
      <label>Seltenheit <select id="rarity-filter"><option value="all">Alle</option>${accountCatalog.rarities.map(rarity => `<option value="${rarity.id}" ${accountFilter === rarity.id ? 'selected' : ''}>${rarity.name}</option>`).join('')}</select></label></div>
      ${filtered.length ? `<div class="inventory-grid">${filtered.slice(accountInventoryPage * 24, (accountInventoryPage + 1) * 24).map(item => itemCard(item)).join('')}</div>
      <div class="inventory-pages"><button data-account="page" data-step="-1" ${accountInventoryPage ? '' : 'disabled'}>← Zurück</button><span>${accountInventoryPage + 1} / ${Math.ceil(filtered.length / 24)}</span><button data-account="page" data-step="1" ${(accountInventoryPage + 1) * 24 >= filtered.length ? 'disabled' : ''}>Weiter →</button></div>` : '<div class="collection-empty"><span>◇</span><h3>Hier wartet dein nächster Fund.</h3><p>Öffne eine Kiste und sammle Auktionslose in deinem Inventar.</p><button class="primary-button" data-account="tab" data-tab="cases">Zu den Kisten →</button></div>'}`;
  } else renderCases(pane);
}
function renderCases(pane) {
  const box = accountCatalog.cases.find(box => box.id === accountSelectedCase) || accountCatalog.cases[0];
  pane.innerHTML = `${rewardBanner()}<p class="earning-detail">Der erste abgegebene Tipp reserviert deinen Token-Lauf. Auszahlung am Spielende; ein Higher-or-Lower-Lauf unter 3 Treffern bringt 0 Tokens.</p>
    <div class="case-options">${accountCatalog.cases.map(option => `<button class="case-option ${box.id === option.id ? 'is-selected' : ''}" data-account="select-case" data-id="${option.id}" aria-pressed="${box.id === option.id}"><span class="case-art" aria-hidden="true">▱<b>JG.</b></span><span><strong>${option.name}</strong><small>${option.cost} Tokens</small></span></button>`).join('')}</div>
    <section class="case-stage" aria-label="Kistenöffnung"><div class="case-stage-heading"><span>${box.name.toUpperCase()}</span><span>DEIN NÄCHSTER GLÜCKSGRIFF</span></div>
      <div class="case-window" aria-hidden="true"><div class="case-marker"></div><div class="case-reel">${accountCatalog.items.slice(0, 10).map(item => itemCard(item, false)).join('')}</div></div>
      <div class="case-result" role="status">${accountResult ? resultMarkup() : '<h3>Was kommt unter den Hammer?</h3><p>Jede Kiste enthält ein digitales Auktionslos.</p>'}</div>
      <button class="primary-button case-open" data-account="pull" ${account && (account.tokens < box.cost || !box.weights.some(Boolean)) ? 'disabled' : ''}>${account ? `${accountResult ? 'Weitere Kiste öffnen' : 'Kiste öffnen'} · ${box.cost} ◈` : 'Anmelden & Tokens verdienen'}</button>
    </section><div class="case-odds"><h3>Deine Chancen</h3><div>${box.odds.map(rarity => `<span class="rarity-${rarity.id}"><b>${rarity.name}</b><strong>${rarity.chance.toLocaleString('de-DE', { maximumFractionDigits: 2 })} %</strong><small>Verkauf: ${rarity.sell} ◈</small></span>`).join('')}</div></div>
    <details class="rarity-explainer"><summary>So werden Seltenheit und Inhalte bestimmt</summary><p>80 % Preis und 20 % Einzigartigkeit: Höhere Auktionswerte und weniger ähnliche Lose erhöhen die Seltenheit. Ähnliche Angebote werden zu einer Produktfamilie zusammengefasst. Jede Familie hat innerhalb ihrer Seltenheit dieselbe Chance. Nicht verfügbare Seltenheiten haben 0 %; die übrigen Chancen werden entsprechend angepasst. Dein Fund behält Seltenheit und Verkaufswert beim Ziehen.</p></details>
    <p class="data-note">Digitale Sammelobjekte · Kein Eigentum am echten Auktionsgegenstand · Tokens sind ausschließlich Spielwährung, ohne Kauf oder Auszahlung in echtem Geld.</p>`;
}
function resultMarkup() {
  return `<p class="rarity-label rarity-${accountResult.rarity}">${rarityLabel(accountResult.rarity)}</p><h3>${accountEscape(accountResult.title)}</h3><p>${accountResult.sold ? 'Verkauft. Tokens gutgeschrieben.' : 'Dein Fund liegt sicher im Inventar.'}</p>
    ${accountResult.sold ? '' : `<button class="secondary-button" data-account="sell-result" data-id="${accountResult.id}">Sofort verkaufen · ${accountResult.sellValue} ◈</button>`}`;
}
async function loadAccountTab(tab) {
  accountTab = tab;
  const owner = account?.id;
  if (!accountCatalog) accountCatalog = await accountApi('cases');
  if (tab === 'inventory' && account) accountItems = (await accountApi('inventory')).items;
  if (tab === 'admin' && account?.admin) accountCodes = (await accountApi('codes')).codes;
  if (account?.id === owner) accountShell();
}
async function openAccount() {
  await accountReady;
  if (!accountDialog.open) accountDialog.showModal();
  accountContent.innerHTML = '<p class="collection-loading">Dein Depot wird geladen …</p>';
  try {
    updateAccount((await accountApi('me')).user);
    accountCatalog = await accountApi('cases');
    await loadAccountTab(accountTab);
  } catch (error) { accountContent.innerHTML = `<p role="alert">${accountEscape(error.message)}</p><button data-account="open">Erneut versuchen</button>`; }
}
async function pullCase() {
  if (!account) { await loadAccountTab('login'); return; }
  const box = accountCatalog.cases.find(box => box.id === accountSelectedCase);
  // Keep the same key after an uncertain response, including a reload.
  const storageKey = `justizguessr:pending-case:${account.id}:${box.id}`;
  let requestId;
  try { requestId = localStorage.getItem(storageKey); } catch {}
  requestId ||= crypto.randomUUID();
  try { localStorage.setItem(storageKey, requestId); } catch {}
  let result;
  try { result = await accountApi('cases/open', { caseId: box.id, requestId, revision: accountCatalog.revision }); }
  catch (error) {
    if (error.code === 'catalog_changed') {
      accountCatalog = await accountApi('cases');
      accountShell();
      throw new Error('Die Kisteninhalte wurden aktualisiert. Prüfe die neuen Chancen und öffne dann erneut.');
    }
    throw error;
  }
  try { localStorage.removeItem(storageKey); } catch {}
  updateAccount(result.user);
  accountResult = result.item;
  accountShell();
  const reel = accountContent.querySelector('.case-reel');
  const viewport = accountContent.querySelector('.case-window');
  const resultNode = accountContent.querySelector('.case-result');
  const openButton = accountContent.querySelector('[data-account="pull"]');
  resultNode.innerHTML = '<h3>Der Hammer kreist …</h3><p>Dein Fund wird aufgedeckt.</p>';
  openButton.disabled = true;
  const winnerIndex = 34;
  const cards = Array.from({ length: 42 }, (_, index) => index === winnerIndex ? result.item : accountCatalog.items[Math.floor(Math.random() * accountCatalog.items.length)]);
  reel.innerHTML = cards.map(item => itemCard(item, false)).join('');
  reel.querySelectorAll('img').forEach(img => img.loading = 'eager');
  // Give the winning image time to decode before the reel accelerates.
  const winnerImage = reel.children[winnerIndex].querySelector('img');
  let imageTimer;
  await Promise.race([winnerImage.decode().catch(() => {}), new Promise(resolve => { imageTimer = setTimeout(resolve, 1800); })]);
  clearTimeout(imageTimer);
  if (!reel.isConnected) return;
  const width = reel.children[0].getBoundingClientRect().width;
  const step = width + 12;
  const landing = winnerIndex * step + width / 2 - viewport.clientWidth / 2;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animation = reel.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-landing}px)` }], {
    duration: reduced ? 0 : 5200, easing: 'cubic-bezier(.12,.72,.12,1)', fill: 'forwards'
  });
  await animation.finished;
  if (!reel.isConnected) return;
  reel.children[winnerIndex].classList.add('is-pulled');
  resultNode.innerHTML = resultMarkup();
  openButton.textContent = `Weitere Kiste öffnen · ${box.cost} ◈`;
  openButton.disabled = account.tokens < box.cost;
  accountContent.querySelector('.token-balance').textContent = `${account.tokens} ◈`;
  resultNode.querySelector('button')?.focus({ preventScroll: true });
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-account]');
  if (!button) return;
  const action = button.dataset.account;
  if (action === 'close') { accountDialog.close(); return; }
  if (accountBusy) return;
  accountBusy = true;
  button.disabled = true;
  try {
    if (action === 'open') await openAccount();
    if (action === 'tab') await loadAccountTab(button.dataset.tab);
    if (action === 'logout') {
      await accountApi('logout', {});
      updateAccount(null); accountDailyRun = null; higherLowerRequest++; higherLowerRun = null;
      accountResult = null; freshCodes = []; accountItems = []; accountCodes = [];
      renderStart(); await loadAccountTab('login');
    }
    if (action === 'select-case') { accountSelectedCase = button.dataset.id; accountResult = null; accountShell(); }
    if (action === 'pull') await pullCase();
    if (action === 'sell' || action === 'sell-result') {
      const result = await accountApi('inventory/sell', { id: button.dataset.id });
      updateAccount(result.user);
      if (accountResult?.id === button.dataset.id) accountResult.sold = true;
      accountItems = accountItems.filter(item => item.id !== button.dataset.id);
      accountShell(); showToast(`${result.value} Tokens gutgeschrieben.`);
    }
    if (action === 'revoke') { await accountApi('codes/revoke', { id: button.dataset.id }); await loadAccountTab('admin'); }
    if (action === 'page') { accountInventoryPage += Number(button.dataset.step); accountShell(); }
  } catch (error) { showToast(error.message); }
  finally { accountBusy = false; if (button.isConnected) button.disabled = false; }
});
document.addEventListener('submit', async event => {
  if (!event.target.matches('#account-form, #code-form')) return;
  event.preventDefault();
  if (accountBusy) return;
  accountBusy = true;
  const form = event.target;
  const button = form.querySelector('button[type="submit"], button');
  button.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(form));
    if (form.id === 'account-form') {
      const result = await accountApi(accountTab === 'register' ? 'register' : 'login', data);
      updateAccount(result.user); accountDailyRun = null; higherLowerRequest++; higherLowerRun = null;
      accountResult = null; freshCodes = []; renderStart(); await loadAccountTab('cases');
    } else {
      freshCodes = (await accountApi('codes', { count: Number(data.count) })).codes;
      await loadAccountTab('admin');
    }
  } catch (error) {
    const node = form.querySelector('.account-error');
    if (node) node.textContent = error.message; else showToast(error.message);
  } finally { accountBusy = false; button.disabled = false; }
});
document.addEventListener('change', event => {
  if (event.target.id === 'rarity-filter') { accountFilter = event.target.value; accountInventoryPage = 0; accountShell(); }
});
