let DAILY_AUCTIONS = [];
let AUCTIONS = DAILY_AUCTIONS;
let dailyMeta = null;
let gameMode = 'daily';
let randomGameRun = null;

const app = document.querySelector('#app');
const dailyCaseDialog = document.createElement('dialog');
dailyCaseDialog.className = 'case-reveal daily-case-dialog';
dailyCaseDialog.setAttribute('aria-labelledby', 'daily-case-title');
document.body.append(dailyCaseDialog);
let dailyCasePromptedRun = null, dailyCaseBusy = false, dailyCaseClaim = null;
dailyCaseDialog.addEventListener('cancel', event => { if (dailyCaseBusy) event.preventDefault(); });
dailyCaseDialog.addEventListener('close', () => app.querySelector('.results-header h1')?.focus({ preventScroll: true }));
caseReveal.addEventListener('close', () => {
  if (currentAccountPage === null && state.view === 'results') app.querySelector('.results-header h1')?.focus({ preventScroll: true });
});
const helpDialog = document.querySelector('#help-dialog');
const toast = document.querySelector('#toast');
const sidebar = document.querySelector('.site-header');
const sidebarToggle = document.querySelector('.sidebar-toggle');
const sidebarBackdrop = document.querySelector('.sidebar-backdrop');
const GAME_EPOCH = Date.UTC(2026, 0, 1);
const SCORE_VERSION = 2;
const initialUtcDate = new Date().toISOString().slice(0, 10);
let countdownTimer;
let state = { view: 'start', round: 0, answers: [], scoreVersion: SCORE_VERSION };
let dailyLoadPromise = Promise.resolve();
let galleryAuction = null;
let galleryIndex = 0;
const GUESS_TIME_LIMIT = 25_000;

function auctionEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function originalAuctionUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://www.justiz-auktion.de' ? auctionEscape(url.href) : '#';
  } catch { return '#'; }
}

function setSidebar(open) {
  sidebar.classList.toggle('is-open', open);
  sidebarToggle.setAttribute('aria-expanded', String(open));
  sidebarToggle.setAttribute('aria-label', t(open ? 'Close navigation' : 'Open navigation', open ? 'Navigation schließen' : 'Navigation öffnen'));
  sidebarBackdrop.hidden = !open;
  document.body.classList.toggle('sidebar-open', open);
}
function closeSidebar() { setSidebar(false); }
let guessTimer = null;
let guessDeadline = 0;

function auctionImages(auction) {
  return [...new Set([auction.image, ...(Array.isArray(auction.images) ? auction.images : [])]
    .filter(image => typeof image === 'string' && image.trim()))];
}

function auctionTitleSizeClass(title) {
  const length = [...String(title || '')].length;
  if (length > 110) return ' auction-title--very-long';
  if (length > 70) return ' auction-title--long';
  return '';
}

function changeAuctionImage(direction) {
  const auction = AUCTIONS[state.round];
  const images = auctionImages(auction);
  const gallery = app.querySelector('.auction-image-wrap');
  if (!gallery || images.length < 2) return;
  galleryIndex = (galleryIndex + direction + images.length) % images.length;
  hideMagnifier();
  gallery.querySelector('.auction-image').src = images[galleryIndex];
  gallery.querySelector('.auction-image').alt = `${auction.title} – ${t('Image', 'Bild')} ${galleryIndex + 1} ${t('of', 'von')} ${images.length}`;
  gallery.querySelector('.auction-image-backdrop').src = images[galleryIndex];
  gallery.querySelector('[data-image-count]').textContent = `${galleryIndex + 1} / ${images.length}`;
}

function updateDailyReset() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const seconds = Math.max(0, Math.ceil((next - now.getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const node = document.querySelector('[data-daily-reset]');
  for(const output of [node,document.querySelector('[data-menu-reset]')]) if(output) output.textContent = [hours, minutes, remainder].map(value => String(value).padStart(2, '0')).join(':');
  if (initialUtcDate !== now.toISOString().slice(0, 10)) location.reload();
}

function utcDateKey() {
  return dailyMeta?.date || new Date().toISOString().slice(0, 10);
}

function gameNumber() {
  if (dailyMeta?.gameNumber) return dailyMeta.gameNumber;
  const utcToday = new Date(`${utcDateKey()}T00:00:00Z`).getTime();
  return Math.floor((utcToday - GAME_EPOCH) / 86400000) + 1;
}

async function loadDailyGame() {
  try {
    const response = await fetch('/api/daily', { headers: { accept: 'application/json' } });
    if (!response.ok) return;
    const payload = await response.json();
    if (payload.auctionCount !== 5) return;
    dailyMeta = { date: payload.date, gameNumber: payload.gameNumber, generatedAt: payload.generatedAt };
    if (state.view === 'start') renderStart();
  } catch {
    // Keep the start screen available; starting a round retries the server.
  }
}

async function startRandomGame() {
  showGamePage();
  const request = ++higherLowerRequest;
  state.view = 'random-loading';
  const button = document.querySelector('[data-action="random"]');
  if (button) {
    button.disabled = true;
    button.textContent = t("Loading a random round…", "Zufallsrunde wird geladen …");
  }
  try {
    const payload = await guestGameRequest('start', { mode: 'random' });
    if (request !== higherLowerRequest) return;
    if (!Array.isArray(payload.auctions) || payload.auctions.length !== 5) throw new Error('invalid_random_game');
    gameMode = 'random';
    randomGameRun = payload;
    AUCTIONS = payload.auctions.map(item => ({
      ...item,
      image: item.image || item.images?.[0] || 'assets/tv.jpg',
      startBid: Number(item.startBid || 0)
    }));
    state = { view: 'game', round: 0, answers: [], scoreVersion: SCORE_VERSION };
    renderRound();
  } catch (error) {
    if (request !== higherLowerRequest) return;
    renderStart();
    showToast(error.code === 'insufficient_variety' || error.message === 'insufficient_variety'
      ? t("Not enough different auctions yet. Please try again later.", "Noch nicht genug unterschiedliche Auktionen. Bitte versuche es später erneut.")
      : t("The random round could not be loaded.", "Die Zufallsrunde konnte gerade nicht geladen werden."));
    if (button) {
      button.disabled = false;
      button.textContent = t("Start a free game", "Freies Spiel starten");
    }
  }
}

function todayStorageKey() {
  return account ? `justizguessr:${account.id}:${utcDateKey()}` : `justizguessr:${utcDateKey()}`;
}

function historyStorageKey() { return account ? `justizguessr:history:${account.id}` : 'justizguessr:history'; }

function getHistory() {
  try { return JSON.parse(localStorage.getItem(historyStorageKey()) || '[]'); }
  catch { return []; }
}

function getTodayRecord() {
  try { return JSON.parse(localStorage.getItem(todayStorageKey()) || 'null'); }
  catch { return null; }
}

function saveProgress() {
  if (gameMode !== 'daily') return;
  try { localStorage.setItem(todayStorageKey(), JSON.stringify({ ...state, date: utcDateKey(), game: gameNumber() })); } catch {}
}

function euro(value) {
  return new Intl.NumberFormat(uiLocale(), { style: 'currency', currency: 'EUR', minimumFractionDigits: value % 1 ? 2 : 0 }).format(value);
}

function timeRemaining(endAt) {
  const distance = new Date(endAt).getTime() - Date.now();
  if (distance <= 0) return t("Auction ended", "Auktion beendet");
  const minutes = Math.floor(distance / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return t(`Ends in ${days}d ${hours}h ${mins}m`, `Endet in ${days}T ${hours}Std ${mins}Min`);
  if (hours) return t(`Ends in ${hours}h ${mins}m`, `Endet in ${hours}Std ${mins}Min`);
  return t(`Ends in ${Math.max(1, mins)}m`, `Endet in ${Math.max(1, mins)}Min`);
}

function scoreGuess(guess, actual) {
  if (!Number.isFinite(guess) || guess < 0 || !Number.isFinite(actual) || actual <= 0) return 0;
  const priceDistance = Math.abs(guess - actual) / (actual + 15);
  return Math.round(1000 / (1 + Math.pow(priceDistance / 0.5, 1.7)));
}

function censorCurrencyValues(value = '') {
  const amount = String.raw`(?:\d{1,3}(?:[.,'’\s\u00a0]\d{3})+|\d+)(?:[,.](?:\d{1,2}|-{1,2}))?(?:\s*(?:Tsd\.?|Mio\.?|k))?`;
  const currency = String.raw`(?:€|&euro;|&#8364;|&#x20ac;|EUR|Euro|CHF|Schweizer(?:ische)?\s+Franken|Franken|USD|US-Dollar|Dollar|GBP|Pfund|£|&pound;|&#163;|CAD|AUD|JPY|¥|US\$|\$)`;
  const currencyValue = new RegExp(String.raw`(?:${currency}\s*(?::|=)?\s*(?:ca\.?\s*)?${amount}|${amount}\s*${currency})`, 'giu');
  const priceLabel = String.raw`(?:aktuelles\s+Gebot|derzeitiges\s+Gebot|momentanes\s+Gebot|Höchstgebot|Gebotsstand|Startgebot|Mindestgebot|Endgebot|Gebot|Zuschlagspreis|Schätzwert|Verkehrswert|Wiederbeschaffungswert|Warenwert|Zeitwert|Neupreis|Listenpreis|Kaufpreis|Verkaufspreis|Startpreis|aktueller\s+Preis|Preis|Wert|UVP|VB|NP)`;
  const labeledValue = new RegExp(String.raw`\b(${priceLabel})\b\s*(?:(?:in\s+Höhe\s+)?von|beträgt|beläuft\s+sich\s+auf|lag\s+bei|liegt\s+bei|war|ist|:|=)?\s*(?:ca\.?\s*)?${amount}`, 'giu');
  return String(value || '')
    .replaceAll('[Preis ausgeblendet]', t('[price hidden]', '[Preis ausgeblendet]'))
    .replace(currencyValue, t('[price hidden]', '[Preis ausgeblendet]'))
    .replace(labeledValue, (_, label) => `${label}: ${t('[price hidden]', '[Preis ausgeblendet]')}`);
}

function currentError(guess, actual) {
  return Math.abs(guess - actual) / actual * 100;
}

function upgradeSavedState(saved) {
  if (!saved?.answers || saved.scoreVersion === SCORE_VERSION) return saved;
  const answers = saved.answers.map((answer, index) => {
    const actual = AUCTIONS[index]?.actualBid;
    if (!Number.isFinite(answer.guess) || !Number.isFinite(actual) || actual <= 0) return answer;
    return { ...answer, score: scoreGuess(answer.guess, actual), error: currentError(answer.guess, actual) };
  });
  const upgraded = { ...saved, answers, scoreVersion: SCORE_VERSION };
  localStorage.setItem(todayStorageKey(), JSON.stringify(upgraded));
  if (saved.view === 'results') {
    const total = answers.reduce((sum, answer) => sum + answer.score, 0);
    const history = getHistory().map(entry => entry.date === utcDateKey() ? { ...entry, total, scoreVersion: SCORE_VERSION } : entry);
    localStorage.setItem(historyStorageKey(), JSON.stringify(history));
  }
  return upgraded;
}

function accuracy(score) {
  if (score === 1000) return { label: t("Perfect!", "Perfekt!"), message: '', icon: '★', className: 'green', emoji: '🟩' };
  if (score >= 850) return { label: t("So close!", "Sehr nah dran!"), message: '', icon: '◎', className: 'green', emoji: '🟩' };
  if (score >= 650) return { label: t("Good guess!", "Gut geschätzt!"), message: '', icon: '★', className: 'yellow', emoji: '🟨' };
  if (score >= 400) return { label: t("Not bad", "Nicht schlecht"), message: '', icon: '◆', className: 'orange', emoji: '🟧' };
  return { label: t("Off the mark", "Daneben"), message: '', icon: '↗', className: 'red', emoji: '🟥' };
}

function stats() {
  const history = getHistory();
  const scores = history.filter(entry => entry.scoreVersion === SCORE_VERSION).map(entry => entry.total);
  let streak = 0;
  const completed = new Set(history.map(entry => entry.date));
  let cursor = new Date(`${utcDateKey()}T00:00:00Z`);
  if (!completed.has(utcDateKey())) cursor = new Date(cursor.getTime() - 86400000);
  while (completed.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return {
    streak,
    best: scores.length ? Math.max(...scores) : null,
    average: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
  };
}

let dailyStarting = false;
async function startGame() {
  if (dailyStarting) return;
  showGamePage();
  dailyStarting = true;
  const request = ++higherLowerRequest;
  state.view = 'daily-loading';
  try {
  const run = await accountGameStart('daily');
  if (request !== higherLowerRequest) return;
  accountDailyRun = run;
  gameMode = 'daily';
  AUCTIONS = DAILY_AUCTIONS;
  if (accountDailyRun) {
    AUCTIONS = accountDailyRun.auctions;
    const answers = accountDailyRun.answers.map((guess, index) => ({ guess,
      score: scoreGuess(guess, AUCTIONS[index].actualBid),
      error: guess === null ? null : currentError(guess, AUCTIONS[index].actualBid) }));
    state = { view: accountDailyRun.complete ? 'results' : 'game',
      round: accountDailyRun.roundDeadlineAt ? answers.length : Math.max(0, answers.length - 1), answers, scoreVersion: SCORE_VERSION };
    if (accountDailyRun.complete) finishGame(); else renderRound();
    return;
  }
  throw new Error(t('The Daily could not be loaded. Please try again.', 'Das Daily konnte nicht geladen werden. Bitte versuche es erneut.'));
  } catch (error) { if (request === higherLowerRequest) { renderStart(); showToast(error.message); } }
  finally { dailyStarting = false; }
}

function renderStart() {
  showGamePage();
  higherLowerRequest++;
  window.scrollTo({ top: 0, behavior: 'instant' });
  clearInterval(countdownTimer);
  stopGuessTimer();
  state.view = 'start';
  const saved = getTodayRecord();
  const playerStats = stats();
  const localComplete=saved?.view==='results';
  const daily=account?.daily || {status:localComplete?'completed':saved?.answers?.length?'in_progress':'not_started',completedRounds:saved?.answers?.length||0,score:localComplete?(saved.answers||[]).reduce((sum,answer)=>sum+(answer.score||0),0):null};
  app.innerHTML=dailyMenuMarkup({status:daily.status,completedRounds:Math.max(0,Math.min(5,daily.completedRounds||0)),score:daily.score,playerStats,
    rewards:window.justizRewards||{daily:1000,dailyScoreBonus:0,higherLowerPerCorrect:30,higherLowerMax:300,minimumStreak:3},edition:gameNumber(),date:utcDateKey()});
  updateDailyReset();
}

function renderRound() {
  clearInterval(countdownTimer);
  stopGuessTimer();
  const auction = AUCTIONS[state.round];
  const images = auctionImages(auction);
  if (galleryAuction !== auction) {
    galleryAuction = auction;
    galleryIndex = 0;
  }
  const answer = state.answers[state.round];
  const ended = !auction.endAt || Date.parse(auction.endAt) <= Date.now();
  const runningScore = state.answers.reduce((sum, item) => sum + item.score, 0);
  app.innerHTML = `
    <section class="game-shell">
      ${answer ? '' : `<div class="guess-timer" data-guess-timer role="progressbar" aria-label="${t("Time left for your guess", "Restzeit für deinen Tipp")}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><span class="guess-timer-fill" data-guess-timer-fill></span></div>`}
      <div class="game-topline">
        <span class="round-count">${t("LOT", "LOS")} ${String(state.round + 1).padStart(2, '0')} / 05<small>${gameMode === 'random' ? t("FREE PLAY", "FREIES SPIEL") : t("DAILY AUCTION", "TAGESAUKTION")}</small></span>
        <div class="lot-progress" aria-label="${state.answers.length} ${t('of 5 auctions guessed', 'von 5 Auktionen geschätzt')}">${Array.from({ length: 5 }, (_, index) => `<span class="lot-step${state.answers[index] ? ' is-complete' : index === state.round ? ' is-current' : ''}" aria-hidden="true">${state.answers[index] ? '✓' : String(index + 1).padStart(2, '0')}</span>`).join('')}</div>
        <span class="running-score">${runningScore.toLocaleString(uiLocale())} ${t("PTS", "PKT")}</span>
      </div>
      <div class="auction-layout${answer ? ' auction-layout--result' : ''}">
        <div class="auction-image-wrap"${images.length > 1 ? ` role="region" aria-roledescription="${t('carousel', 'Karussell')}" aria-label="${t('Auction images', 'Auktionsbilder')}"` : ''}>
          <img class="auction-image-backdrop" referrerpolicy="no-referrer" src="${auctionEscape(images[galleryIndex])}" alt="" aria-hidden="true" />
          <img class="auction-image" referrerpolicy="no-referrer" src="${auctionEscape(images[galleryIndex])}" alt="${auctionEscape(auction.title)}${images.length > 1 ? ` – ${t('Image', 'Bild')} ${galleryIndex + 1} ${t('of', 'von')} ${images.length}` : ''}" />
          ${images.length > 1 ? `
            <button class="carousel-arrow carousel-arrow--previous" type="button" data-action="previous-image" aria-label="${t("Previous image", "Vorheriges Bild")}">‹</button>
            <button class="carousel-arrow carousel-arrow--next" type="button" data-action="next-image" aria-label="${t("Next image", "Nächstes Bild")}">›</button>
            <span class="image-count" data-image-count role="status" aria-live="polite" aria-atomic="true">${galleryIndex + 1} / ${images.length}</span>
          ` : ''}
          <span class="category-tag">${auctionEscape(listingLabel(auction.category).toUpperCase())}</span>
          <span class="time-tag${ended ? ' time-tag--ended' : ''}"><span class="clock-icon" aria-hidden="true"></span><span data-countdown>${timeRemaining(auction.endAt)}</span></span>
        </div>
        <div class="auction-panel${answer ? ' auction-panel--result' : ''}">
          <p class="auction-id">${answer ? t("REVEALED", "AUFGEDECKT") : t("AUCTION", "AUKTION")} · #${auctionEscape(auction.id)}</p>
          <h1 class="auction-title${auctionTitleSizeClass(auction.title)}">${auctionEscape(auction.title)}</h1>
          ${answer ? revealMarkup(auction, answer) : `
            <p class="auction-description" tabindex="0" role="region" aria-label="${t("Auction description", "Auktionsbeschreibung")}">${auctionEscape(censorCurrencyValues(auction.description))}</p>
            <div class="fact-list">
              <div class="fact"><span>${t("CONDITION", "ZUSTAND")}</span><strong>${auctionEscape(listingLabel(auction.condition))}</strong></div>
            </div>
            ${guessMarkup(ended)}
          `}
        </div>
      </div>
    </section>`;
  countdownTimer = setInterval(() => {
    const node = document.querySelector('[data-countdown]');
    if (node) {
      node.textContent = timeRemaining(auction.endAt);
      node.closest('.time-tag')?.classList.toggle('time-tag--ended', !auction.endAt || Date.parse(auction.endAt) <= Date.now());
    }
  }, 30000);
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (!answer) startGuessTimer();
  setTimeout(() => document.querySelector(answer ? '[data-action="next"]' : '#price-input')?.focus({ preventScroll: true }), 50);
}

function guessMarkup(ended = false) {
  return `
    <form class="guess-form" id="guess-form">
      <label for="price-input">${ended ? t("What was the final bid?", "Was war das Endgebot?") : t("What is the current bid?", "Was ist das aktuelle Gebot?")}</label>
      <div class="guess-control">
        <div class="input-wrap"><span class="currency">€</span><input id="price-input" class="price-input" inputmode="decimal" autocomplete="off" placeholder="0" /></div>
        <button class="submit-guess" type="submit">${t("Submit guess", "Tipp abgeben")} <span aria-hidden="true">↗</span></button>
      </div>
      <p class="input-hint">${t("One guess per 25 seconds", "Ein Tipp pro 25 Sekunden")} <span>Enter ↵</span></p>
    </form>`;
}

function revealMarkup(auction, answer) {
  const level = accuracy(answer.score);
  const timedOut = answer.guess === null;
  const difference = timedOut ? 0 : auction.actualBid - answer.guess;
  const sign = difference > 0 ? '+' : difference < 0 ? '−' : '';
  const arrow = difference > 0 ? '↗' : difference < 0 ? '↘' : '●';
  const relationship = difference > 0 ? t("higher", "höher") : difference < 0 ? t("lower", "niedriger") : t("exactly the same", "genau gleich");
  const differenceLabel = timedOut ? t('No guess in time', 'Kein Tipp rechtzeitig abgegeben') : `${t('The actual bid is', 'Das echte Gebot ist')} ${relationship}; ${t('difference', 'Abweichung')} ${number(answer.error, 1)} ${t('percent', 'Prozent')}`;
  const message = timedOut ? t("Time ran out before you entered a bid.", "Die Zeit lief ab, bevor du ein Gebot eingegeben hast.") : level.message;
  return `
    <div class="reveal-panel reveal-${level.className}">
      <div class="result-feedback">
        <span class="feedback-icon" aria-hidden="true">${level.icon}</span>
        <span><strong>${level.label}</strong>${message ? `<small>${message}</small>` : ''}</span>
      </div>
      <div class="bid-comparison">
        <div class="bid-value">
          <span>${t("YOUR GUESS", "DEIN TIPP")}</span>
          <strong>${timedOut ? '—' : euro(answer.guess)}</strong>
        </div>
        <div class="difference-indicator ${level.className}" aria-label="${differenceLabel}">
          <strong>${timedOut ? '—' : `${sign}${number(answer.error, 1)} %`}</strong>
          <span aria-hidden="true">${timedOut ? '' : arrow}</span>
        </div>
        <div class="bid-value bid-value--actual">
          <span>${t("ACTUAL BID", "ECHTES GEBOT")}</span>
          <strong>${euro(auction.actualBid)}</strong>
        </div>
      </div>
      <p class="start-bid">${t("Starting bid", "Startgebot")} <strong>${euro(auction.startBid)}</strong></p>
      <div class="round-reward">
        <span class="reward-star" aria-hidden="true">★</span>
        <div class="reward-copy"><span>${t("YOUR POINTS", "DEINE PUNKTE")}</span><strong>${answer.score.toLocaleString(uiLocale())} <small>${t("PTS", "PKT")}</small></strong></div>
      </div>
      <div class="next-row">
        <button class="primary-button" type="button" data-action="next">${state.round === 4 ? t("View results", "Ergebnis ansehen") : t("Next auction", "Nächste Auktion")}<span class="button-arrow">→</span></button>
        <a class="auction-link" href="${originalAuctionUrl(auction.url)}" target="_blank" rel="noreferrer">${t("View original", "Original ansehen")} ↗</a>
      </div>
    </div>`;
}

function stopGuessTimer() {
  if (guessTimer) { clearInterval(guessTimer); guessTimer = null; }
}

// The bar only drains visually — no seconds are shown. The deadline is
// absolute, so background-tab throttling cannot extend a round.
function startGuessTimer() {
  stopGuessTimer();
  const bar = document.querySelector('[data-guess-timer]');
  if (!bar) return;
  const fill = bar.querySelector('[data-guess-timer-fill]');
  const run = gameMode === 'daily' ? accountDailyRun : randomGameRun;
  guessDeadline = run ? run.clientDeadlineAt : Date.now() + GUESS_TIME_LIMIT;
  const tick = () => {
    if (state.view !== 'game' || state.answers[state.round] || !document.querySelector('#guess-form')) { stopGuessTimer(); return; }
    const fraction = Math.max(0, guessDeadline - Date.now()) / GUESS_TIME_LIMIT;
    fill.style.width = `${fraction * 100}%`;
    bar.classList.toggle('is-low', fraction <= 0.2);
    bar.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
    if (fraction <= 0) { stopGuessTimer(); expireGuess(); }
  };
  guessTimer = setInterval(tick, 200);
  tick();
}

function expireGuess() {
  if (dailySubmitting || state.answers[state.round] || state.view !== 'game') return;
  applyGuess(null);
}

let dailySubmitting = false;
async function applyGuess(guess) {
  if (dailySubmitting || state.answers[state.round]) return;
  const currentState = state;
  dailySubmitting = true;
  stopGuessTimer();
  const button = document.querySelector('#guess-form button[type="submit"]');
  if (button) button.disabled = true;
  try {
  const run = gameMode === 'daily' ? accountDailyRun : randomGameRun;
  if (run) {
    const updated = await accountGameAnswer(run, state.round, guess);
    if (state !== currentState || state.view !== 'game') return;
    if (gameMode === 'daily') accountDailyRun = updated; else randomGameRun = updated;
    // The server seals upcoming answers; the response reveals the round just
    // answered, so the local deck needs that refreshed price for the display.
    AUCTIONS = updated.auctions;
    guess = updated.answers[state.round];
  }
  if (state !== currentState || state.view !== 'game') return;
  const actual = AUCTIONS[state.round].actualBid;
  const score = scoreGuess(guess, actual);
  const isExact = guess !== null && Math.round(guess * 100) === Math.round(actual * 100);
  state.answers[state.round] = { guess, score, error: guess === null ? null : currentError(guess, actual) };
  saveProgress();
  renderRound();
  if (isExact) requestAnimationFrame(launchConfetti);
  } catch (error) { showToast(error.message); if (state === currentState && state.view === 'game' && !state.answers[state.round]) startGuessTimer(); }
  finally { dailySubmitting = false; if (button?.isConnected) button.disabled = false; }
}

async function submitGuess(form) {
  if (dailySubmitting || state.answers[state.round]) return;
  const raw = form.querySelector('#price-input').value.trim().replace(/\s/g, '').replace(',', '.');
  const guess = Number(raw);
  if (!raw || !Number.isFinite(guess) || guess < 0) {
    showToast(t("Please enter a valid euro amount.", "Bitte gib einen gültigen Eurobetrag ein."));
    return;
  }
  await applyGuess(guess);
}

let dailyAdvancing = false;
async function nextRound() {
  if (dailyAdvancing || dailySubmitting || !state.answers[state.round]) return;
  if (state.round < 4) {
    const activeRun = gameMode === 'daily' ? accountDailyRun : randomGameRun;
    if (activeRun) {
      const currentState = state, request = higherLowerRequest;
      dailyAdvancing = true;
      try {
        const run = await accountGameRoundStart(activeRun, state.round + 1);
        if (state !== currentState || request !== higherLowerRequest || state.view !== 'game') return;
        if (gameMode === 'daily') accountDailyRun = run; else randomGameRun = run;
        AUCTIONS = run.auctions;
      } catch (error) { showToast(error.message); return; }
      finally { dailyAdvancing = false; }
    }
    state.round += 1;
    saveProgress();
    renderRound();
  } else {
    finishGame();
  }
}

function finishGame() {
  state.view = 'results';
  saveProgress();
  const total = state.answers.reduce((sum, item) => sum + item.score, 0);
  if (gameMode === 'daily') {
    const history = getHistory().filter(item => item.date !== utcDateKey());
    history.push({ date: utcDateKey(), game: gameNumber(), total, scoreVersion: SCORE_VERSION });
    try { localStorage.setItem(historyStorageKey(), JSON.stringify(history.slice(-400))); } catch {}
  }
  renderResults();
}

function renderDailyCaseDialog() {
  const score = state.answers.reduce((total, answer) => total + answer.score, 0);
  dailyCaseDialog.innerHTML = `<div class="daily-case-prompt rarity-${auctionEscape(accountDailyRun?.dailyCase?.tier || 'common')}"><span class="daily-case-gift" aria-hidden="true">◇</span><p class="eyebrow">${t('DAILY COMPLETE', 'DAILY ABGESCHLOSSEN')}</p><h2 id="daily-case-title">${t('Daily case', 'Daily-Kiste')}</h2><p class="rarity-label">${rarityLabel(accountDailyRun?.dailyCase?.tier || 'common')}</p><strong>${number(score)} / ${number(5000)} ${t('points', 'Punkte')}</strong><div class="case-reveal-actions"><button class="primary-button" type="button" data-action="daily-case-claim" data-choice="open" ${dailyCaseBusy ? 'disabled' : ''}>${t('Open Now', 'Jetzt öffnen')}</button><button class="secondary-button" type="button" data-action="daily-case-claim" data-choice="keep" ${dailyCaseBusy ? 'disabled' : ''}>${t('Add to inventory', 'Zum Inventar hinzufügen')}</button></div></div>`;
  if (!dailyCaseDialog.open) dailyCaseDialog.showModal();
  dailyCaseDialog.querySelector('[data-action="daily-case-claim"]')?.focus({ preventScroll: true });
}

function promptDailyCase() {
  if (!account || gameMode !== 'daily' || state.view !== 'results' || accountDailyRun?.dailyCase?.status !== 'ready') return;
  if (dailyCasePromptedRun === accountDailyRun.id) return;
  dailyCasePromptedRun = accountDailyRun.id;
  renderDailyCaseDialog();
}

async function claimDailyCase(choice = 'keep') {
  if (dailyCaseBusy || !account || !accountDailyRun) return;
  const owner = account.id, runId = accountDailyRun.id, visit = accountVisit;
  const alreadyClaimed = dailyCaseClaim?.owner === owner && dailyCaseClaim?.runId === runId;
  if (accountDailyRun.dailyCase?.status !== 'ready' && !alreadyClaimed) return;
  dailyCaseBusy = true; renderDailyCaseDialog();
  const isCurrent = () => account?.id === owner && accountDailyRun?.id === runId && accountVisit === visit && state.view === 'results';
  try {
    if (!alreadyClaimed) {
      const result = await accountApi('games/daily-case/claim', { id: runId });
      if (account?.id !== owner || accountDailyRun?.id !== runId) return;
      updateAccount(result.user);
      dailyCaseClaim = { owner, runId, item: result.item };
      accountDailyRun = { ...accountDailyRun, dailyCase: { ...accountDailyRun.dailyCase, status: 'claimed' } };
    }
    if (!isCurrent()) return;
    if (choice === 'open') {
      const result = await accountApi('inventory/case/open', { id: dailyCaseClaim.item.id });
      if (!isCurrent()) return;
      updateAccount(result.user);
      dailyCaseDialog.close();
      renderResults();
      await showDailyCaseItem(result.item, isCurrent, dailyCaseClaim.item);
    } else {
      dailyCaseDialog.close();
      renderResults();
      showToast(t('Case added to inventory.', 'Kiste zum Inventar hinzugefügt.'));
    }
    dailyCaseClaim = null;
  } catch (error) {
    if (isCurrent()) showToast(error.message);
  } finally { dailyCaseBusy = false; if (dailyCaseDialog.open && isCurrent()) renderDailyCaseDialog(); }
}

async function showDailyCaseItem(item, isCurrent, sealedItem = {}) {
  caseRevealState=null;
  caseReveal.innerHTML = `<div class="case-reveal-content rarity-${auctionEscape(item.rarity)}"><h2 id="case-reveal-title">${t('Opening case…', 'Kiste wird geöffnet …')}</h2><div class="case-window"><div class="case-marker"></div><div class="case-reel"></div></div></div>`;
  caseReveal.showModal();
  const pool = accountCatalog?.cases?.find(box => box.id === 'fundkiste')?.items || [];
  try {
    await spinCaseReel(caseReveal.querySelector('.case-reel'), caseReveal.querySelector('.case-window'), item,
      pool.length ? pool : [item], () => caseReveal.open && isCurrent());
  } catch { /* The awarded item is already saved; still show the result. */ }
  const store = await accountApi('case-store').catch(() => null);
  if (!caseReveal.open || !isCurrent()) return;
  if (store) accountStore = store;
  renderCaseResult(item,sealedItem);
}

function renderResults() {
  window.scrollTo({ top: 0, behavior: 'instant' });
  clearInterval(countdownTimer);
  stopGuessTimer();
  const total = state.answers.reduce((sum, item) => sum + item.score, 0);
  const scoredErrors = state.answers.filter(item => Number.isFinite(item.error));
  const averageError = scoredErrors.length ? scoredErrors.reduce((sum, item) => sum + item.error, 0) / scoredErrors.length : null;
  const bestIndex = state.answers.reduce((best, item, index, items) => item.score > items[best].score ? index : best, 0);
  const playerStats = stats();
  const completedAuctions = AUCTIONS.filter(auction => !auction.endAt || Date.parse(auction.endAt) <= Date.now()).length;
  app.innerHTML = `
    <section class="results-screen">
      <div class="results-header">
        <div><p class="eyebrow">${gameMode === 'random' ? t("FREE PLAY", "FREIES SPIEL") : `${t('DAILY', 'DAILY')} #${gameNumber()}`}</p><h1 tabindex="-1">${gameMode === 'daily' ? t('Daily complete', 'Daily geschafft') : t('Results', 'Ergebnis')}</h1></div>
        <div class="results-score"><strong>${total.toLocaleString(uiLocale())} / ${number(5000)}</strong><span>${t("TOTAL POINTS", "GESAMTPUNKTE")}</span></div>
      </div>
      <div class="result-stats">
        <div class="result-stat"><span>${t("BEST ROUND", "BESTE RUNDE")}</span><strong>${state.answers[bestIndex].score} ${t("pts", "Pkt")}</strong></div>
        <div class="result-stat"><span>${t("AVG. DIFFERENCE", "Ø ABWEICHUNG")}</span><strong>${averageError === null ? '—' : `${number(averageError, 1)} %`}</strong></div>
        ${gameMode === 'random'
          ? `<div class="result-stat"><span>${t("ENDED AUCTIONS", "BEENDETE AUKTIONEN")}</span><strong>${completedAuctions} / 5</strong></div>`
          : `<div class="result-stat"><span>${t("CURRENT STREAK", "AKTUELLER STREAK")}</span><strong>${playerStats.streak ? `🔥 ${dayLabel(playerStats.streak)}` : '—'}</strong></div>`}
      </div>
      <h2 class="results-list-title">${t('Your five rounds', 'Deine fünf Runden')}</h2>
      <div class="results-list">
        ${AUCTIONS.map((auction, index) => resultRow(auction, state.answers[index], index)).join('')}
      </div>
      <div class="results-actions">
        <button class="primary-button" type="button" data-action="copy">${t("Copy Results", "Ergebnis kopieren")}</button>
        <button class="secondary-button" type="button" data-action="random">${t("Play the archive", "Archiv spielen")} <span class="button-arrow" aria-hidden="true">→</span></button>
      </div>
      <div class="data-note">${infoTip(gameMode === 'random' ? t("This round uses the auction archive. Ended auctions use their last recorded final bid.", "Diese Runde stammt aus dem Auktionsarchiv. Beendete Auktionen nutzen ihr zuletzt erfasstes Endgebot.") : t("Prices are fixed for this Daily. The original auction may continue to change.", "Gebotsstände sind für dieses Daily festgeschrieben. Die Originalauktion kann sich weiter verändern."), t('About these prices', 'Über diese Preise'))}</div>
    </section>`;
  promptDailyCase();
}

function resultRow(auction, answer, index) {
  const level = accuracy(answer.score);
  return `
    <div class="result-row">
      <img class="result-thumb" src="${auctionEscape(auction.image)}" alt="" />
      <a class="result-name result-auction-link" href="${originalAuctionUrl(auction.url)}" target="_blank" rel="noreferrer"><strong>${index + 1}. ${auctionEscape(auction.title)}</strong><span>${auctionEscape(t(`OPEN AUCTION #${auction.id}`, `AUKTION #${auction.id} ÖFFNEN`))} ↗</span></a>
      <div class="result-cell"><strong>${answer.guess === null ? '—' : euro(answer.guess)}</strong><span>${t("YOUR GUESS", "DEIN TIPP")}</span></div>
      <div class="result-cell"><strong>${euro(auction.actualBid)}</strong><span>${t("BID", "GEBOT")}</span></div>
      <div class="result-cell"><strong>${answer.error === null ? '—' : `${number(answer.error, 1)} %`}</strong><span>${t("DIFFERENCE", "ABWEICHUNG")}</span></div>
      <div class="result-points"><span class="accuracy-square ${level.className}"></span><strong>${answer.score}</strong></div>
    </div>`;
}

function shareText() {
  const total = state.answers.reduce((sum, item) => sum + item.score, 0);
  return [
    gameMode === 'random' ? t("JUSTIZGUESSR · FREE PLAY", "JUSTIZGUESSR · FREIES SPIEL") : `JUSTIZGUESSR #${gameNumber()}`,
    '',
    ...state.answers.map(item => `${accuracy(item.score).emoji} ${item.score}`),
    '',
    `${total.toLocaleString(uiLocale())} / ${number(5000)}`,
    new URL('/', window.location.origin).href
  ].filter((line, index, all) => line || all[index - 1] !== '').join('\n');
}

async function copyResult() {
  const text = shareText();
  try {
    await navigator.clipboard.writeText(text);
    showToast(t("Results copied — no spoilers.", "Ergebnistext kopiert — spoilerfrei."));
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    showToast(copied ? t("Results copied — no spoilers.", "Ergebnistext kopiert — spoilerfrei.") : t("Copying is unavailable in this browser.", "Kopieren ist in diesem Browser nicht verfügbar."));
  }
}

function launchConfetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelector('.confetti-layer')?.remove();
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  layer.setAttribute('aria-hidden', 'true');
  const colors = ['#e53935', '#ffcd38', '#1f9d65', '#14336b', '#f08a24', '#ffffff'];
  for (let index = 0; index < 90; index += 1) {
    const piece = document.createElement('i');
    piece.style.setProperty('--x', `${Math.random() * 100}vw`);
    piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 240}px`);
    piece.style.setProperty('--delay', `${Math.random() * 0.65}s`);
    piece.style.setProperty('--duration', `${2.5 + Math.random() * 1.8}s`);
    piece.style.setProperty('--spin', `${360 + Math.random() * 1080}deg`);
    piece.style.setProperty('--color', colors[index % colors.length]);
    piece.style.setProperty('--size', `${6 + Math.random() * 8}px`);
    layer.append(piece);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 5000);
}

function showToast(message) {
  const target = toast;
  target.textContent = message;
  target.classList.add('show');
  setTimeout(() => target.classList.remove('show'), 5000);
}

document.addEventListener('submit', event => {
  if (event.target.matches('#guess-form')) {
    event.preventDefault();
    submitGuess(event.target);
  }
});

document.addEventListener('click', event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'previous-image') changeAuctionImage(-1);
  if (action === 'next-image') changeAuctionImage(1);
  if (action === 'play') dailyLoadPromise.finally(startGame);
  if (action === 'random') startRandomGame();
  if (action === 'higher-lower') startHigherLower();
  if (action === 'hl-higher') guessHigherLower('higher');
  if (action === 'hl-lower') guessHigherLower('lower');
  if (action === 'hl-next') nextHigherLower();
  if (action === 'hl-image') higherLowerImage(event.target.closest('[data-action]'));
  if (action === 'next') nextRound();
  if (action === 'daily-case-claim') claimDailyCase(event.target.closest('[data-action]').dataset.choice);
  if (action === 'copy') copyResult();
  if (action === 'home') { closeSidebar(); renderStart(); }
  if (action === 'help') helpDialog.showModal();
  if (action === 'sidebar') setSidebar(!sidebar.classList.contains('is-open'));
  if (action === 'sidebar-close') closeSidebar();
});

// Backdrop dismissal follows the same cancellation rules as Escape, including
// mandatory police choices and in-progress actions which cannot be dismissed.
document.addEventListener('click', event => {
  if (event.target instanceof HTMLDialogElement && event.target.open) {
    if (event.target === dailyCaseDialog && dailyCaseBusy) return;
    if (event.target.dispatchEvent(new Event('cancel', {cancelable:true})) && event.target.open) event.target.close();
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !notificationPanel.hidden) { closeNotificationPanel(); notificationButton.focus(); return; }
  if (event.key === 'Escape' && sidebar.classList.contains('is-open')) { closeSidebar(); sidebarToggle.focus(); return; }
  if (event.target.closest('dialog')) return;
  if (event.target.closest('.auction-image-wrap') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    changeAuctionImage(event.key === 'ArrowLeft' ? -1 : 1);
    return;
  }
  if (event.key !== 'Enter' || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (state.view !== 'game' || !state.answers[state.round]) return;
  if (event.target.closest('a, button, input, textarea, select')) return;
  event.preventDefault();
  nextRound();
});

// Magnifying glass: while the mouse rests on the round photo, a circular lens
// follows the cursor and shows the hovered detail at higher magnification.
const MAGNIFIER_ZOOM = 2.5;
let magnifierLens = null;

function hideMagnifier() {
  magnifierLens?.remove();
  magnifierLens = null;
}

document.addEventListener('pointermove', event => {
  if (event.pointerType !== 'mouse' || !(event.target instanceof Element)) { hideMagnifier(); return; }
  const wrap = event.target.closest('.auction-image-wrap');
  // The lens tracks the photo itself, not the controls floating above it.
  if (!wrap || event.target.closest('.carousel-arrow, .image-count, .category-tag, .time-tag')) { hideMagnifier(); return; }
  const image = wrap.querySelector('.auction-image');
  if (!image || !image.complete || !image.naturalWidth) { hideMagnifier(); return; }

  // object-fit: contain letterboxes the photo, so map the cursor onto the
  // actually drawn pixels before zooming.
  const wrapRect = wrap.getBoundingClientRect();
  const rect = image.getBoundingClientRect();
  const fitScale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
  const drawnWidth = image.naturalWidth * fitScale;
  const drawnHeight = image.naturalHeight * fitScale;
  const relativeX = (event.clientX - rect.left - (rect.width - drawnWidth) / 2) / drawnWidth;
  const relativeY = (event.clientY - rect.top - (rect.height - drawnHeight) / 2) / drawnHeight;
  if (relativeX < 0 || relativeX > 1 || relativeY < 0 || relativeY > 1) { hideMagnifier(); return; }

  if (!magnifierLens?.isConnected || magnifierLens.parentElement !== wrap) {
    magnifierLens = document.createElement('div');
    magnifierLens.className = 'auction-image-lens';
    magnifierLens.setAttribute('aria-hidden', 'true');
    wrap.appendChild(magnifierLens);
    magnifierLens.dataset.size = String(magnifierLens.offsetWidth || 180);
  }
  const src = image.currentSrc || image.src;
  if (magnifierLens.dataset.src !== src) {
    magnifierLens.dataset.src = src;
    magnifierLens.style.backgroundImage = `url("${src}")`;
  }

  const lensSize = Number(magnifierLens.dataset.size);
  const zoomWidth = drawnWidth * MAGNIFIER_ZOOM;
  const zoomHeight = drawnHeight * MAGNIFIER_ZOOM;
  magnifierLens.style.backgroundSize = `${zoomWidth}px ${zoomHeight}px`;
  magnifierLens.style.backgroundPosition = `${lensSize / 2 - relativeX * zoomWidth}px ${lensSize / 2 - relativeY * zoomHeight}px`;
  magnifierLens.style.left = `${event.clientX - wrapRect.left}px`;
  magnifierLens.style.top = `${event.clientY - wrapRect.top}px`;
});
document.addEventListener('pointerout', event => { if (!event.relatedTarget) hideMagnifier(); });
window.addEventListener('blur', hideMagnifier);
window.addEventListener('resize', hideMagnifier);
// Native image dragging would interrupt the lens tracking mid-hover.
document.addEventListener('dragstart', event => {
  if (event.target instanceof Element && event.target.closest('.auction-image')) event.preventDefault();
});

if (accountPaths.includes(location.pathname)) navigateAccountPage(location.pathname, false); else renderStart();
dailyLoadPromise = loadDailyGame();
updateDailyReset();
setInterval(updateDailyReset, 1000);

function registerWebMcpTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  const register = tool => Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {});

  register({
    name: 'get_daily_game_status',
    title: t("Read daily game status", "Tagesspiel-Status lesen"),
    description: t("Read the game number, progress and score.", "Liest Spielnummer, Fortschritt und bisherigen Punktestand, ohne das Spiel zu verändern."),
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute() {
      const saved = getTodayRecord();
      return {
        gameNumber: gameNumber(),
        status: saved?.view === 'results' ? 'completed' : saved?.answers?.length ? 'in_progress' : 'not_started',
        completedRounds: saved?.answers?.length || 0,
        score: saved?.answers?.reduce((sum, answer) => sum + answer.score, 0) || 0
      };
    }
  });

  register({
    name: 'start_daily_game',
    title: t("Open daily game", "Tagesspiel öffnen"),
    description: t("Start or resume today’s game, or view its completed result.", "Startet das heutige Spiel, setzt es fort oder öffnet ein bereits abgeschlossenes Ergebnis."),
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute() {
      await dailyLoadPromise;
      await startGame();
      return { gameNumber: gameNumber(), view: state.view, currentRound: state.round + 1 };
    }
  });

  register({
    name: 'start_random_game',
    title: t("Open random round", "Zufallsrunde öffnen"),
    description: t("Start a free game with five random auctions from the archive.", "Startet ein freies Spiel mit fünf zufälligen Auktionen aus dem gespeicherten Archiv."),
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute() {
      await startRandomGame();
      return { mode: gameMode, view: state.view, currentRound: state.round + 1 };
    }
  });
}

registerWebMcpTools();

// Preserve unfinished guesses when changing the interface language.
document.addEventListener('jg:language', () => {
  const guess = document.querySelector('#price-input')?.value;
  if (state.view === 'start') renderStart();
  else if (state.view === 'game') { renderRound(); if (guess !== undefined) document.querySelector('#price-input').value = guess; }
  else if (state.view === 'results') renderResults();
  else if (state.view === 'higher-lower') renderHigherLower();
  if (dailyCaseDialog.open && !dailyCaseBusy) renderDailyCaseDialog();
});
