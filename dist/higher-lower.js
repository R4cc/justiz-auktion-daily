let higherLowerRun = null;
let higherLowerRequest = 0;
function hlEscape(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function hlBest() {
  try { return Math.max(0, Number(localStorage.getItem(hlStorageKey())) || 0); }
  catch { return 0; }
}
function hlStorageKey() { return typeof account !== 'undefined' && account ? `justizguessr:higher-lower-best:${account.id}` : 'justizguessr:higher-lower-best'; }
async function startHigherLower() {
  const request = ++higherLowerRequest;
  clearInterval(countdownTimer);
  state.view = 'higher-lower-loading';
  app.innerHTML = '<section class="hl-screen"><p class="eyebrow">HIGHER OR LOWER</p><h1>Die Lose werden gemischt …</h1><button class="secondary-button" data-action="home">Zur Startseite</button></section>';
  try {
    const serverRun = await accountGameStart('higher-lower');
    let payload = serverRun;
    if (!payload) {
      const response = await fetch('/api/higher-lower', { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(response.status === 503 ? 'variety' : 'unavailable');
      payload = await response.json();
    }
    if (!Array.isArray(payload.auctions) || payload.auctions.length < 2 ||
        (!serverRun && payload.auctions.some(item => !Number.isFinite(item.actualBid) || item.actualBid <= 0))) throw new Error('invalid');
    if (request !== higherLowerRequest || state.view !== 'higher-lower-loading') return;
    higherLowerRun = { auctions: payload.auctions, index: Math.max(1, serverRun?.answers.length || 0),
      streak: serverRun?.streak || 0, revealed: Boolean(serverRun?.answers.length), correct: serverRun?.correct || false, images: [0, 0], server: serverRun };
    gameMode = 'higher-lower';
    state.view = 'higher-lower';
    window.scrollTo({ top: 0, behavior: 'instant' });
    renderHigherLower();
  } catch (error) {
    if (request !== higherLowerRequest || state.view !== 'higher-lower-loading') return;
    renderStart();
    showToast(error.message === 'variety' ? 'Noch nicht genug unterschiedliche Auktionen mit bestätigtem Endgebot. Versuche es später erneut.' : 'Die Lose konnten nicht geladen werden. Bitte versuche es erneut.');
  }
}
function renderHigherLower(focus = false) {
  const run = higherLowerRun;
  const finished = run.revealed && (!run.correct || run.index === run.auctions.length - 1);
  const tied = run.auctions[run.index].actualBid === run.auctions[run.index - 1].actualBid;
  const cards = [run.auctions[run.index - 1], run.auctions[run.index]].map((item, side) => {
    const images = auctionImages(item);
    const image = images[run.images[side]];
    return `<article class="hl-card ${side ? 'hl-challenger' : ''}">
      <p class="eyebrow">${side ? 'DAS NÄCHSTE LOS' : 'DIE MESSLATTE'} · ${hlEscape(item.category)}</p>
      <div class="hl-photo"><img src="${hlEscape(image)}" alt="${hlEscape(item.title)} – Bild ${run.images[side] + 1} von ${images.length}">
      ${images.length > 1 ? `<div class="hl-gallery"><button data-action="hl-image" data-side="${side}" data-direction="-1" aria-label="Vorheriges Bild: ${side ? 'nächstes Los' : 'Messlatte'}">←</button><span>${run.images[side] + 1} / ${images.length}</span><button data-action="hl-image" data-side="${side}" data-direction="1" aria-label="Nächstes Bild: ${side ? 'nächstes Los' : 'Messlatte'}">→</button></div>` : ''}</div>
      <h2>${hlEscape(item.title)}</h2>
      <div class="hl-price ${side && run.revealed ? 'hl-price-reveal' : ''}">${side && !run.revealed ? '<span aria-label="Preis noch verdeckt">?</span>' : euro(item.actualBid)}</div>
      <p class="hl-price-label">${side && !run.revealed ? 'Höher oder niedriger als die Messlatte?' : 'BESTÄTIGTES ENDGEBOT'}</p>
    </article>`;
  }).join('<span class="hl-versus" aria-hidden="true">VS</span>');
  app.innerHTML = `<section class="hl-screen">
    <div class="hl-heading"><div><p class="eyebrow">HIGHER OR LOWER</p><h1>Was bringt mehr?</h1></div><div class="hl-streak"><strong>${run.streak}</strong><span>IN FOLGE · BESTE ${hlBest()}</span></div></div>
    ${rewardBanner()}
    <div class="hl-board">${cards}</div>
    <div class="hl-controls">
    ${run.revealed ? `<div class="hl-verdict"><h2>${!run.correct ? 'Zum Dritten. Vorbei!' : finished ? 'Alle Lose abgeräumt!' : tied ? 'Gleichstand. Du bleibst drin!' : 'Richtig. Der Lauf geht weiter!'}</h2><p>${finished ? `${run.streak} ${run.streak === 1 ? 'richtiger Vergleich' : 'richtige Vergleiche'} in Folge. Noch eine Runde?` : 'Das aufgedeckte Los wird deine neue Messlatte.'}</p></div>
      <button class="primary-button" data-action="${finished ? 'higher-lower' : 'hl-next'}">${finished ? 'Noch einmal spielen ↻' : 'Nächstes Los →'}</button>` : `<div class="hl-choices"><button class="primary-button" data-action="hl-higher">↑ Höher</button><button class="secondary-button" data-action="hl-lower">↓ Niedriger</button></div><p>Gleicher Preis? Beide Tipps zählen. Ein Fehler beendet deinen Lauf.</p>`}
    <button class="hl-home" data-action="home">Zur Startseite</button>
    </div><p class="data-note">${run.index} / ${run.auctions.length - 1} Vergleiche · Echte Endgebote. Unterschiedliche Lose. Kein echtes Geld.</p>
  </section>`;
  if (focus) app.querySelector('.hl-controls button')?.focus({ preventScroll: true });
}
async function guessHigherLower(direction) {
  const run = higherLowerRun;
  if (state.view !== 'higher-lower' || !run || run.revealed || run.pending) return;
  if (run.server) {
    run.pending = true;
    app.querySelectorAll('.hl-choices button').forEach(button => button.disabled = true);
    try {
      const updated = await accountGameAnswer(run.server, run.index - 1, direction);
      if (higherLowerRun !== run || state.view !== 'higher-lower') return;
      run.server = updated;
      run.auctions = updated.auctions;
      run.correct = updated.correct;
      run.streak = updated.streak;
    } catch (error) {
      showToast(error.message);
      if (higherLowerRun === run && state.view === 'higher-lower') renderHigherLower();
      return;
    } finally { run.pending = false; }
  } else {
  const difference = run.auctions[run.index].actualBid - run.auctions[run.index - 1].actualBid;
  run.correct = difference === 0 || (direction === 'higher' ? difference > 0 : difference < 0);
  if (run.correct) run.streak++;
  }
  run.revealed = true;
  try { localStorage.setItem(hlStorageKey(), String(Math.max(hlBest(), run.streak))); } catch {}
  renderHigherLower(true);
}
function nextHigherLower() {
  const run = higherLowerRun;
  if (state.view !== 'higher-lower' || !run?.revealed || !run.correct || run.index >= run.auctions.length - 1) return;
  run.index++;
  run.revealed = false;
  run.images = [run.images[1], 0];
  renderHigherLower(true);
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function higherLowerImage(button) {
  if (state.view !== 'higher-lower') return;
  const side = Number(button.dataset.side);
  const images = auctionImages(higherLowerRun.auctions[higherLowerRun.index - 1 + side]);
  higherLowerRun.images[side] = (higherLowerRun.images[side] + Number(button.dataset.direction) + images.length) % images.length;
  renderHigherLower();
  app.querySelector(`[data-action="hl-image"][data-side="${side}"][data-direction="${button.dataset.direction}"]`)?.focus({ preventScroll: true });
}
