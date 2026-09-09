const FALLBACK_AUCTIONS = [
  {
    id: 210631,
    title: '1 Akku der Marke „HILTI“',
    category: 'Werkzeug',
    image: 'assets/hilti.jpg',
    description: 'Gebrauchter HILTI Akku, Modell B 22 / 5,2 Ah. Deutliche Gebrauchsspuren; Versand per DPD möglich.',
    condition: 'Gebraucht',
    fulfillment: 'Versand',
    startBid: 10,
    actualBid: 22,
    bids: 8,
    endAt: '2026-09-10T11:00:00Z',
    url: 'https://www.justiz-auktion.de/1-Akku-der-Marke-quotHILTIquot-210631'
  },
  {
    id: 210635,
    title: 'Bohrhammer Makita HR2470',
    category: 'Werkzeug',
    image: 'assets/makita.jpg',
    description: 'Augenscheinlich unbenutzter Bohrhammer im Koffer. Ein Funktionstest wurde nicht durchgeführt.',
    condition: 'Neuwertig',
    fulfillment: 'Versand',
    startBid: 20,
    actualBid: 110,
    bids: 14,
    endAt: '2026-09-10T11:00:00Z',
    url: 'https://www.justiz-auktion.de/1-Bohrhammer-der-Marke-quotMakitaquot-210635'
  },
  {
    id: 211520,
    title: 'Parfum-Set: Jil Sander, Boss & Elizabeth Arden',
    category: 'Kosmetik',
    image: 'assets/perfume.jpg',
    description: 'Vier originalverpackte Düfte: Jil Sander Eve und Evergreen, Boss The Scent Elixir und Elizabeth Arden Red Door.',
    condition: 'Neu',
    fulfillment: 'Versand',
    startBid: 40,
    actualBid: 60,
    bids: 6,
    endAt: '2026-09-16T18:09:00Z',
    url: 'https://www.justiz-auktion.de/1-Eau-de-Toilette-Jil-Sander-Eve-Natural-Spray-uperiodaperiod-211520'
  },
  {
    id: 210640,
    title: 'Giant Mountainbike, 26 Zoll',
    category: 'Fahrrad',
    image: 'assets/bike.jpg',
    description: 'Gebrauchtes schwarzes Giant Mountainbike mit 3×9-Gangschaltung. Technisch nicht geprüft, nur Selbstabholung.',
    condition: 'Gebraucht',
    fulfillment: 'Abholung',
    startBid: 5,
    actualBid: 350,
    bids: 22,
    endAt: '2026-09-10T11:00:00Z',
    url: 'https://www.justiz-auktion.de/1-Fahrrad-quotGiantquot-210640'
  },
  {
    id: 212441,
    title: 'Philips Fernseher, 60 Zoll',
    category: 'Elektronik',
    image: 'assets/tv.jpg',
    description: 'Gebrauchter Philips 60PFL6008K/12 ohne Fernbedienung und Anschlusskabel. Funktion nicht geprüft.',
    condition: 'Gebraucht',
    fulfillment: 'Abholung',
    startBid: 10,
    actualBid: 12,
    bids: 3,
    endAt: '2026-09-15T12:00:00Z',
    url: 'https://www.justiz-auktion.de/1-Fernseher-der-Marke-quotPhilipsquot-212441'
  }
];

let DAILY_AUCTIONS = FALLBACK_AUCTIONS;
let AUCTIONS = DAILY_AUCTIONS;
let dailyMeta = null;
let gameMode = 'daily';

const app = document.querySelector('#app');
const helpDialog = document.querySelector('#help-dialog');
const toast = document.querySelector('#toast');
const GAME_EPOCH = Date.UTC(2026, 0, 1);
const initialUtcDate = new Date().toISOString().slice(0, 10);
let countdownTimer;
let state = { view: 'start', round: 0, answers: [] };
let dailyLoadPromise = Promise.resolve();

function updateDailyReset() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const seconds = Math.max(0, Math.ceil((next - now.getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const node = document.querySelector('[data-daily-reset]');
  if (node) node.textContent = [hours, minutes, remainder].map(value => String(value).padStart(2, '0')).join(':');
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
    if (!Array.isArray(payload.auctions) || payload.auctions.length !== 5) return;
    DAILY_AUCTIONS = payload.auctions.map(item => ({
      ...item,
      image: item.image || item.images?.[0] || 'assets/tv.jpg',
      actualBid: Number(item.actualBid ?? item.correctPrice),
      startBid: Number(item.startBid || 0)
    }));
    if (gameMode === 'daily') AUCTIONS = DAILY_AUCTIONS;
    dailyMeta = { date: payload.date, gameNumber: payload.gameNumber, generatedAt: payload.generatedAt };
    if (state.view === 'start') renderStart();
  } catch {
    // The bundled seed keeps the game playable during a temporary collector outage.
  }
}

async function startRandomGame() {
  const button = document.querySelector('[data-action="random"]');
  if (button) {
    button.disabled = true;
    button.textContent = 'Zufallsrunde wird geladen …';
  }
  try {
    const response = await fetch('/api/random', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('random_game_unavailable');
    const payload = await response.json();
    if (!Array.isArray(payload.auctions) || payload.auctions.length !== 5) throw new Error('invalid_random_game');
    gameMode = 'random';
    AUCTIONS = payload.auctions.map(item => ({
      ...item,
      image: item.image || item.images?.[0] || 'assets/tv.jpg',
      actualBid: Number(item.actualBid ?? item.correctPrice),
      startBid: Number(item.startBid || 0)
    }));
    state = { view: 'game', round: 0, answers: [] };
    renderRound();
  } catch {
    showToast('Die Zufallsrunde konnte gerade nicht geladen werden.');
    if (button) {
      button.disabled = false;
      button.textContent = 'Freies Spiel starten';
    }
  }
}

function todayStorageKey() {
  return `justizguessr:${utcDateKey()}`;
}

function getHistory() {
  try { return JSON.parse(localStorage.getItem('justizguessr:history') || '[]'); }
  catch { return []; }
}

function getTodayRecord() {
  try { return JSON.parse(localStorage.getItem(todayStorageKey()) || 'null'); }
  catch { return null; }
}

function saveProgress() {
  if (gameMode !== 'daily') return;
  localStorage.setItem(todayStorageKey(), JSON.stringify({ ...state, date: utcDateKey(), game: gameNumber() }));
}

function euro(value) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: value % 1 ? 2 : 0 }).format(value);
}

function timeRemaining(endAt) {
  const distance = new Date(endAt).getTime() - Date.now();
  if (distance <= 0) return 'Auktion beendet';
  const minutes = Math.floor(distance / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return `Endet in ${days}T ${hours}Std ${mins}Min`;
  if (hours) return `Endet in ${hours}Std ${mins}Min`;
  return `Endet in ${Math.max(1, mins)}Min`;
}

function scoreGuess(guess, actual) {
  const error = Math.abs(guess - actual) / Math.max(actual, 0.01);
  return Math.round(1000 * Math.exp(-2.5 * error));
}

function accuracy(score) {
  if (score === 1000) return { label: 'Perfekt!', message: 'Genau ins Schwarze getroffen.', icon: '★', className: 'green', emoji: '🟩' };
  if (score >= 850) return { label: 'Sehr nah dran!', message: 'Dein Preisgefühl sitzt.', icon: '◎', className: 'green', emoji: '🟩' };
  if (score >= 650) return { label: 'Gut geschätzt!', message: 'Du warst ziemlich dicht dran.', icon: '★', className: 'yellow', emoji: '🟨' };
  if (score >= 400) return { label: 'Nicht schlecht', message: 'Die Richtung hat gestimmt.', icon: '◆', className: 'orange', emoji: '🟧' };
  return { label: 'Daneben', message: '', icon: '↗', className: 'red', emoji: '🟥' };
}

function stats() {
  const history = getHistory();
  const scores = history.map(entry => entry.total);
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

function startGame() {
  gameMode = 'daily';
  AUCTIONS = DAILY_AUCTIONS;
  const saved = getTodayRecord();
  if (saved?.view === 'results') {
    state = saved;
    renderResults();
    return;
  }
  state = saved?.answers ? saved : { view: 'game', round: 0, answers: [] };
  state.view = 'game';
  renderRound();
}

function renderStart() {
  clearInterval(countdownTimer);
  state.view = 'start';
  const saved = getTodayRecord();
  const playerStats = stats();
  const buttonText = saved?.view === 'results' ? 'Ergebnis ansehen' : saved?.answers?.length ? 'Spiel fortsetzen' : 'Heutiges Spiel starten';
  app.innerHTML = `
    <section class="start-screen">
      <div class="start-main">
        <p class="eyebrow game-number">TAGESAUKTION · #${gameNumber()}</p>
        <h1 class="hero-title">JUSTIZ<br>GUESSR<span>.</span></h1>
        <p class="hero-copy"><strong>5 echte Justiz-Auktionen.</strong></p>
        <div class="start-actions">
          <button class="primary-button" type="button" data-action="play">${buttonText}<span class="button-arrow">→</span></button>
          <button class="secondary-button random-button" type="button" data-action="random">Freies Spiel starten <span aria-hidden="true">↻</span></button>
        </div>
      </div>
      <aside class="start-side" aria-label="Tagesstatistik">
        <div class="ticket">
          <div class="ticket-top">
            <p class="ticket-label">HEUTE ZU HOLEN</p>
            <p class="ticket-number">5.000 PKT</p>
          </div>
          <div class="ticket-stats">
            <div class="ticket-stat"><span>STREAK</span><strong>${playerStats.streak ? `🔥 ${playerStats.streak} Tage` : '—'}</strong></div>
            <div class="ticket-stat"><span>BESTWERT</span><strong>${playerStats.best ? playerStats.best.toLocaleString('de-DE') : '—'}</strong></div>
          </div>
        </div>
        <div class="score-explainer">
          <div class="indicator-key"><span>🟩 EXAKT</span><span>🟨 NAH DRAN</span><span>🟧 FAIR</span><span>🟥 DANEBEN</span></div>
        </div>
      </aside>
    </section>`;
}

function renderRound() {
  clearInterval(countdownTimer);
  const auction = AUCTIONS[state.round];
  const answer = state.answers[state.round];
  const ended = !auction.endAt || Date.parse(auction.endAt) <= Date.now();
  const runningScore = state.answers.reduce((sum, item) => sum + item.score, 0);
  app.innerHTML = `
    <section class="game-shell">
      <div class="game-topline">
        <span class="round-count">${state.round + 1} / 5<small>${gameMode === 'random' ? 'FREIES SPIEL' : 'DAILY'}</small></span>
        <div class="progress-track" aria-label="Spielfortschritt"><div class="progress-fill" style="width:${((state.round + (answer ? 1 : 0)) / 5) * 100}%"></div></div>
        <span class="running-score">${runningScore.toLocaleString('de-DE')} PKT</span>
      </div>
      <div class="auction-layout${answer ? ' auction-layout--result' : ''}">
        <div class="auction-image-wrap">
          <img class="auction-image-backdrop" src="${auction.image}" alt="" aria-hidden="true" />
          <img class="auction-image" src="${auction.image}" alt="${auction.title}" />
          <span class="category-tag">${auction.category.toUpperCase()}</span>
          <span class="time-tag${ended ? ' time-tag--ended' : ''}"><span class="clock-icon" aria-hidden="true"></span><span data-countdown>${timeRemaining(auction.endAt)}</span></span>
        </div>
        <div class="auction-panel${answer ? ' auction-panel--result' : ''}">
          <p class="auction-id">JUSTIZ-AUKTION #${auction.id}</p>
          <h1 class="auction-title">${auction.title}</h1>
          ${answer ? revealMarkup(auction, answer) : `
            <p class="auction-description">${auction.description}</p>
            <div class="fact-list">
              <div class="fact"><span>ZUSTAND</span><strong>${auction.condition}</strong></div>
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
  setTimeout(() => document.querySelector(answer ? '[data-action="next"]' : '#price-input')?.focus(), 50);
}

function guessMarkup(ended = false) {
  return `
    <form class="guess-form" id="guess-form">
      <label for="price-input">${ended ? 'Was war das Endgebot?' : 'Was ist das aktuelle Gebot?'}</label>
      <div class="guess-control">
        <div class="input-wrap"><span class="currency">€</span><input id="price-input" class="price-input" inputmode="decimal" autocomplete="off" placeholder="0" /></div>
        <button class="submit-guess" type="submit">Tipp abgeben</button>
      </div>
    </form>`;
}

function revealMarkup(auction, answer) {
  const level = accuracy(answer.score);
  const difference = auction.actualBid - answer.guess;
  const sign = difference > 0 ? '+' : difference < 0 ? '−' : '';
  const arrow = difference > 0 ? '↗' : difference < 0 ? '↘' : '●';
  const relationship = difference > 0 ? 'höher' : difference < 0 ? 'niedriger' : 'genau gleich';
  return `
    <div class="reveal-panel reveal-${level.className}">
      <div class="result-feedback">
        <span class="feedback-icon" aria-hidden="true">${level.icon}</span>
        <span><strong>${level.label}</strong>${level.message ? `<small>${level.message}</small>` : ''}</span>
      </div>
      <div class="bid-comparison">
        <div class="bid-value">
          <span>DEIN TIPP</span>
          <strong>${euro(answer.guess)}</strong>
        </div>
        <div class="difference-indicator ${level.className}" aria-label="Das echte Gebot ist ${relationship}; Abweichung ${answer.error.toFixed(1).replace('.', ',')} Prozent">
          <strong>${sign}${answer.error.toFixed(1).replace('.', ',')} %</strong>
          <span aria-hidden="true">${arrow}</span>
        </div>
        <div class="bid-value bid-value--actual">
          <span>ECHTES GEBOT</span>
          <strong>${euro(auction.actualBid)}</strong>
        </div>
      </div>
      <p class="start-bid">Startgebot <strong>${euro(auction.startBid)}</strong></p>
      <div class="round-reward">
        <span class="reward-star" aria-hidden="true">★</span>
        <div class="reward-copy"><span>DEINE PUNKTE</span><strong>${answer.score.toLocaleString('de-DE')} <small>PKT</small></strong></div>
      </div>
      <div class="next-row">
        <button class="primary-button" type="button" data-action="next">${state.round === 4 ? 'Ergebnis ansehen' : 'Nächste Auktion'}<span class="button-arrow">→</span></button>
        <a class="auction-link" href="${auction.url}" target="_blank" rel="noreferrer">Original ansehen ↗</a>
      </div>
    </div>`;
}

function submitGuess(form) {
  const raw = form.querySelector('#price-input').value.trim().replace(/\s/g, '').replace(',', '.');
  const guess = Number(raw);
  if (!Number.isFinite(guess) || guess < 0) {
    showToast('Bitte gib einen gültigen Eurobetrag ein.');
    return;
  }
  const actual = AUCTIONS[state.round].actualBid;
  const score = scoreGuess(guess, actual);
  const isExact = Math.round(guess * 100) === Math.round(actual * 100);
  state.answers[state.round] = { guess, score, error: Math.abs(guess - actual) / actual * 100 };
  saveProgress();
  renderRound();
  if (isExact) requestAnimationFrame(launchConfetti);
}

function nextRound() {
  if (state.round < 4) {
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
    history.push({ date: utcDateKey(), game: gameNumber(), total });
    localStorage.setItem('justizguessr:history', JSON.stringify(history.slice(-400)));
  }
  renderResults();
}

function renderResults() {
  clearInterval(countdownTimer);
  const total = state.answers.reduce((sum, item) => sum + item.score, 0);
  const averageError = state.answers.reduce((sum, item) => sum + item.error, 0) / state.answers.length;
  const bestIndex = state.answers.reduce((best, item, index, items) => item.score > items[best].score ? index : best, 0);
  const playerStats = stats();
  const completedAuctions = AUCTIONS.filter(auction => !auction.endAt || Date.parse(auction.endAt) <= Date.now()).length;
  app.innerHTML = `
    <section class="results-screen">
      <div class="results-header">
        <div><p class="eyebrow">${gameMode === 'random' ? 'FREIES SPIEL' : `TAGESAUKTION #${gameNumber()}`} · GESCHAFFT</p><h1>DEIN<br>ERGEBNIS<span style="color:var(--red)">.</span></h1></div>
        <div class="results-score"><strong>${total.toLocaleString('de-DE')} / 5.000</strong><span>GESAMTPUNKTE</span></div>
      </div>
      <div class="result-stats">
        <div class="result-stat"><span>BESTE RUNDE</span><strong>${state.answers[bestIndex].score} Pkt</strong></div>
        <div class="result-stat"><span>Ø ABWEICHUNG</span><strong>${averageError.toFixed(1).replace('.', ',')} %</strong></div>
        ${gameMode === 'random'
          ? `<div class="result-stat"><span>BEENDETE AUKTIONEN</span><strong>${completedAuctions} / 5</strong></div>`
          : `<div class="result-stat"><span>AKTUELLER STREAK</span><strong>${playerStats.streak ? `🔥 ${playerStats.streak} Tag${playerStats.streak === 1 ? '' : 'e'}` : '—'}</strong></div>`}
      </div>
      <div class="results-list">
        ${AUCTIONS.map((auction, index) => resultRow(auction, state.answers[index], index)).join('')}
      </div>
      <div class="results-actions">
        ${gameMode === 'random' ? '<button class="primary-button" type="button" data-action="random">Neue Zufallsrunde <span class="button-arrow">↻</span></button>' : ''}
        <button class="${gameMode === 'random' ? 'secondary' : 'primary'}-button" type="button" data-action="share">Ergebnis teilen <span class="button-arrow">↗</span></button>
        <button class="secondary-button" type="button" data-action="copy">Text kopieren</button>
        <button class="secondary-button" type="button" data-action="home">Zur Startseite</button>
      </div>
      <p class="data-note">${gameMode === 'random' ? 'Diese Runde stammt aus dem dauerhaft gespeicherten Auktionsarchiv. Beendete Auktionen werden mit ihrem letzten erfassten Endgebot gespielt.' : 'Gebotsstände wurden für dieses Tagesspiel festgeschrieben. Die Originalauktion kann sich danach weiter verändern.'}</p>
    </section>`;
}

function resultRow(auction, answer, index) {
  const level = accuracy(answer.score);
  return `
    <div class="result-row">
      <img class="result-thumb" src="${auction.image}" alt="" />
      <a class="result-name result-auction-link" href="${auction.url}" target="_blank" rel="noreferrer"><strong>${index + 1}. ${auction.title}</strong><span>AUKTION #${auction.id} ÖFFNEN ↗</span></a>
      <div class="result-cell"><strong>${euro(answer.guess)}</strong><span>DEIN TIPP</span></div>
      <div class="result-cell"><strong>${euro(auction.actualBid)}</strong><span>GEBOT</span></div>
      <div class="result-cell"><strong>${answer.error.toFixed(1).replace('.', ',')} %</strong><span>ABWEICHUNG</span></div>
      <div class="result-points"><span class="accuracy-square ${level.className}"></span><strong>${answer.score}</strong></div>
    </div>`;
}

function shareText() {
  const total = state.answers.reduce((sum, item) => sum + item.score, 0);
  const streak = stats().streak;
  return [
    gameMode === 'random' ? 'JUSTIZGUESSR · FREIES SPIEL' : `JUSTIZGUESSR #${gameNumber()}`,
    '',
    ...state.answers.map(item => `${accuracy(item.score).emoji} ${item.score}`),
    '',
    `${total.toLocaleString('de-DE')} / 5.000`,
    gameMode === 'daily' && streak ? `🔥 ${streak} Tag${streak === 1 ? '' : 'e'} Streak` : ''
  ].filter((line, index, all) => line || all[index - 1] !== '').join('\n');
}

async function shareResult() {
  const text = shareText();
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (error) { if (error.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); showToast('Ergebnis kopiert — spoilerfrei.'); }
  catch { showToast('Teilen ist in diesem Browser nicht verfügbar.'); }
}

async function copyResult() {
  const text = shareText();
  try {
    await navigator.clipboard.writeText(text);
    showToast('Ergebnistext kopiert — spoilerfrei.');
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
    showToast(copied ? 'Ergebnistext kopiert — spoilerfrei.' : 'Kopieren ist in diesem Browser nicht verfügbar.');
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
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2400);
}

document.addEventListener('submit', event => {
  if (event.target.matches('#guess-form')) {
    event.preventDefault();
    submitGuess(event.target);
  }
});

document.addEventListener('click', event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'play') dailyLoadPromise.finally(startGame);
  if (action === 'random') startRandomGame();
  if (action === 'next') nextRound();
  if (action === 'share') shareResult();
  if (action === 'copy') copyResult();
  if (action === 'home') renderStart();
  if (action === 'help') helpDialog.showModal();
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (state.view !== 'game' || !state.answers[state.round]) return;
  if (event.target.closest('a, button, input, textarea, select')) return;
  event.preventDefault();
  nextRound();
});

renderStart();
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
    title: 'Tagesspiel-Status lesen',
    description: 'Liest Spielnummer, Fortschritt und bisherigen Punktestand, ohne das Spiel zu verändern.',
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
    title: 'Tagesspiel öffnen',
    description: 'Startet das heutige Spiel, setzt es fort oder öffnet ein bereits abgeschlossenes Ergebnis.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute() {
      await dailyLoadPromise;
      startGame();
      return { gameNumber: gameNumber(), view: state.view, currentRound: state.round + 1 };
    }
  });

  register({
    name: 'start_random_game',
    title: 'Zufallsrunde öffnen',
    description: 'Startet ein freies Spiel mit fünf zufälligen Auktionen aus dem gespeicherten Archiv.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute() {
      await startRandomGame();
      return { mode: gameMode, view: state.view, currentRound: state.round + 1 };
    }
  });
}

registerWebMcpTools();
