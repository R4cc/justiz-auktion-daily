const AUCTIONS = [
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

const app = document.querySelector('#app');
const helpDialog = document.querySelector('#help-dialog');
const toast = document.querySelector('#toast');
const GAME_EPOCH = Date.UTC(2026, 0, 1);
let countdownTimer;
let state = { view: 'start', round: 0, answers: [] };

function utcDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function gameNumber() {
  const utcToday = new Date(`${utcDateKey()}T00:00:00Z`).getTime();
  return Math.floor((utcToday - GAME_EPOCH) / 86400000) + 1;
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
  if (score >= 850) return { label: 'Ausgezeichnet', className: 'green', emoji: '🟩' };
  if (score >= 650) return { label: 'Gut geschätzt', className: 'yellow', emoji: '🟨' };
  if (score >= 400) return { label: 'Gar nicht schlecht', className: 'orange', emoji: '🟧' };
  return { label: 'Weit daneben', className: 'red', emoji: '🟥' };
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
        <p class="hero-copy"><strong>5 echte Justiz-Auktionen.</strong><br>Was sind sie gerade wert?</p>
        <button class="primary-button" type="button" data-action="play">${buttonText}<span class="button-arrow">→</span></button>
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
          <p>Einmal pro Tag. Je kleiner dein prozentualer Abstand zum echten Gebot, desto mehr Punkte bekommst du.</p>
        </div>
      </aside>
    </section>`;
}

function renderRound() {
  clearInterval(countdownTimer);
  const auction = AUCTIONS[state.round];
  const answer = state.answers[state.round];
  const runningScore = state.answers.reduce((sum, item) => sum + item.score, 0);
  app.innerHTML = `
    <section class="game-shell">
      <div class="game-topline">
        <span class="round-count">${state.round + 1} / 5</span>
        <div class="progress-track" aria-label="Spielfortschritt"><div class="progress-fill" style="width:${((state.round + (answer ? 1 : 0)) / 5) * 100}%"></div></div>
        <span class="running-score">${runningScore.toLocaleString('de-DE')} PKT</span>
      </div>
      <div class="auction-layout">
        <div class="auction-image-wrap">
          <img class="auction-image" src="${auction.image}" alt="${auction.title}" />
          <span class="category-tag">${auction.category.toUpperCase()}</span>
          <span class="time-tag"><span class="clock-icon" aria-hidden="true"></span><span data-countdown>${timeRemaining(auction.endAt)}</span></span>
        </div>
        <div class="auction-panel">
          <p class="auction-id">JUSTIZ-AUKTION #${auction.id}</p>
          <h1 class="auction-title">${auction.title}</h1>
          <p class="auction-description">${auction.description}</p>
          <div class="fact-list">
            <div class="fact"><span>ZUSTAND</span><strong>${auction.condition}</strong></div>
            <div class="fact"><span>ÜBERGABE</span><strong>${auction.fulfillment}</strong></div>
          </div>
          ${answer ? revealMarkup(auction, answer) : guessMarkup()}
        </div>
      </div>
    </section>`;
  countdownTimer = setInterval(() => {
    const node = document.querySelector('[data-countdown]');
    if (node) node.textContent = timeRemaining(auction.endAt);
  }, 30000);
  if (!answer) setTimeout(() => document.querySelector('#price-input')?.focus(), 50);
}

function guessMarkup() {
  return `
    <form class="guess-form" id="guess-form">
      <label for="price-input">Was ist das aktuelle Gebot?</label>
      <div class="guess-control">
        <div class="input-wrap"><span class="currency">€</span><input id="price-input" class="price-input" inputmode="decimal" autocomplete="off" placeholder="0" aria-describedby="guess-hint" /></div>
        <button class="submit-guess" type="submit">Tipp abgeben</button>
      </div>
      <p class="guess-hint" id="guess-hint">Ein Tipp, keine zweite Chance. Punkt oder Komma ist okay.</p>
    </form>`;
}

function revealMarkup(auction, answer) {
  const level = accuracy(answer.score);
  return `
    <div class="reveal-panel">
      <p class="reveal-verdict"><span class="verdict-dot ${level.className}"></span>${level.label}</p>
      <div class="reveal-prices">
        <div class="price-card"><span>DEIN TIPP</span><strong>${euro(answer.guess)}</strong></div>
        <div class="price-card"><span>ECHTES GEBOT</span><strong>${euro(auction.actualBid)}</strong></div>
      </div>
      <div class="reveal-metrics">
        <div class="metric"><span>STARTGEBOT</span><strong>${euro(auction.startBid)}</strong></div>
        <div class="metric"><span>ABWEICHUNG</span><strong>${answer.error.toFixed(1).replace('.', ',')} %</strong></div>
        <div class="metric"><span>PUNKTE</span><strong class="round-score">${answer.score}</strong></div>
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
  state.answers[state.round] = { guess, score, error: Math.abs(guess - actual) / actual * 100 };
  saveProgress();
  renderRound();
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
  const history = getHistory().filter(item => item.date !== utcDateKey());
  history.push({ date: utcDateKey(), game: gameNumber(), total });
  localStorage.setItem('justizguessr:history', JSON.stringify(history.slice(-400)));
  renderResults();
}

function renderResults() {
  clearInterval(countdownTimer);
  const total = state.answers.reduce((sum, item) => sum + item.score, 0);
  const averageError = state.answers.reduce((sum, item) => sum + item.error, 0) / state.answers.length;
  const bestIndex = state.answers.reduce((best, item, index, items) => item.score > items[best].score ? index : best, 0);
  const playerStats = stats();
  app.innerHTML = `
    <section class="results-screen">
      <div class="results-header">
        <div><p class="eyebrow">TAGESAUKTION #${gameNumber()} · GESCHAFFT</p><h1>DEIN<br>ERGEBNIS<span style="color:var(--red)">.</span></h1></div>
        <div class="results-score"><strong>${total.toLocaleString('de-DE')} / 5.000</strong><span>GESAMTPUNKTE</span></div>
      </div>
      <div class="result-stats">
        <div class="result-stat"><span>BESTE RUNDE</span><strong>${state.answers[bestIndex].score} Pkt</strong></div>
        <div class="result-stat"><span>Ø ABWEICHUNG</span><strong>${averageError.toFixed(1).replace('.', ',')} %</strong></div>
        <div class="result-stat"><span>AKTUELLER STREAK</span><strong>${playerStats.streak ? `🔥 ${playerStats.streak} Tag${playerStats.streak === 1 ? '' : 'e'}` : '—'}</strong></div>
      </div>
      <div class="results-list">
        ${AUCTIONS.map((auction, index) => resultRow(auction, state.answers[index], index)).join('')}
      </div>
      <div class="results-actions">
        <button class="primary-button" type="button" data-action="share">Ergebnis teilen <span class="button-arrow">↗</span></button>
        <button class="secondary-button" type="button" data-action="home">Zur Startseite</button>
      </div>
      <p class="data-note">Gebotsstände wurden für dieses Tagesspiel festgeschrieben. Die Originalauktion kann sich danach weiter verändern.</p>
    </section>`;
}

function resultRow(auction, answer, index) {
  const level = accuracy(answer.score);
  return `
    <div class="result-row">
      <img class="result-thumb" src="${auction.image}" alt="" />
      <div class="result-name"><strong>${index + 1}. ${auction.title}</strong><span>AUKTION #${auction.id}</span></div>
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
    `JUSTIZGUESSR #${gameNumber()}`,
    '',
    ...state.answers.map(item => `${accuracy(item.score).emoji} ${item.score}`),
    '',
    `${total.toLocaleString('de-DE')} / 5.000`,
    streak ? `🔥 ${streak} Tag${streak === 1 ? '' : 'e'} Streak` : ''
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
  if (action === 'play') startGame();
  if (action === 'next') nextRound();
  if (action === 'share') shareResult();
  if (action === 'home') renderStart();
  if (action === 'help') helpDialog.showModal();
});

renderStart();

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
    execute() {
      startGame();
      return { gameNumber: gameNumber(), view: state.view, currentRound: state.round + 1 };
    }
  });
}

registerWebMcpTools();
