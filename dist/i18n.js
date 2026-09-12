let language = 'en';
try { if (localStorage.getItem('justizguessr:language') === 'de') language = 'de'; } catch {}
function t(en, de) { return language === 'de' ? de : en; }
function uiLocale() { return language === 'de' ? 'de-DE' : 'en-GB'; }
function number(value, digits) {
  return Number(value).toLocaleString(uiLocale(), digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function dayLabel(count) { return t(`${count} day${count === 1 ? '' : 's'}`, `${count} Tag${count === 1 ? '' : 'e'}`); }
function listingLabel(value = '') {
  const labels = {
    'Werkzeug': 'Tools', 'Werkzeuge': 'Tools', 'Elektronik': 'Electronics', 'Fahrrad': 'Bicycles', 'Fahrräder': 'Bicycles',
    'Fahrzeuge': 'Vehicles', 'Kosmetik': 'Beauty', 'Getränke': 'Drinks', 'Mode': 'Fashion', 'Sonstiges': 'Other',
    'Bücher & Medien': 'Books & media', 'Schmuck & Uhren': 'Jewellery & watches', 'Möbel & Wohnen': 'Furniture & home',
    'Haushalt & Garten': 'Home & garden', 'Sport & Freizeit': 'Sport & leisure', 'Sammlerstücke': 'Collectibles',
    'Gebraucht': 'Used', 'Neu': 'New', 'Neuwertig': 'Like new', 'Unbekannt': 'Unknown', 'Ungeprüft': 'Untested',
    'Defekt': 'Faulty', 'Versand': 'Shipping', 'Abholung': 'Collection', 'Keine Angabe': 'Not specified', 'Siehe Auktion': 'See auction'
  };
  return language === 'de' ? value : labels[value] || value;
}
function renderStaticUi() {
  document.documentElement.lang = language;
  document.title = t('JUSTIZGUESSR — The daily auction game', 'JUSTIZGUESSR — Das tägliche Auktionsspiel');
  document.querySelector('meta[name="description"]').content = t('Five real auctions. Guess the price, collect the surprises.', 'Fünf echte Auktionen. Schätze den Preis und sammle Fundstücke.');
  document.querySelector('#language-select').value = language;
  document.querySelector('#language-select').setAttribute('aria-label', t('Language', 'Sprache'));
  document.querySelector('.wordmark').setAttribute('aria-label', t('Home', 'Zur Startseite'));
  document.querySelector('.daily-reset').setAttribute('aria-label', t('Time until the next daily game', 'Zeit bis zum nächsten Tagesspiel'));
  document.querySelector('.daily-reset > span').textContent = t('NEXT DAILY IN', 'NEUES DAILY IN');
  document.querySelector('[data-action="help"]').setAttribute('aria-label', t('Game rules', 'Spielregeln'));
  document.querySelector('#help-dialog').innerHTML = `<form method="dialog">
    <button class="dialog-close" aria-label="${t('Close', 'Schließen')}">×</button>
    <p class="eyebrow">${t('HOW TO PLAY', "SO FUNKTIONIERT’S")}</p><h2>${t('Trust your sense of value.', 'Vertraue deinem Preisgefühl.')}</h2>
    <div class="rules-grid"><div><span>01</span><p>${t('Explore five real, publicly listed auctions.', 'Entdecke fünf echte, öffentlich gelistete Auktionen.')}</p></div>
    <div><span>02</span><p>${t('Guess the bid. Condition and time remaining can help.', 'Schätze das Gebot. Zustand und Restzeit helfen dir.')}</p></div>
    <div><span>03</span><p>${t('The closer your guess, the more points you earn. Small price differences on cheaper items are scored generously.', 'Je näher dein Tipp, desto mehr Punkte. Kleine Preisunterschiede bei günstigen Losen werden großzügig bewertet.')}</p></div></div>
    <p>${t('Everyone gets the same Daily set and fixed prices. Guest progress stays on this device; signed-in games can be resumed across devices.', 'Alle spielen dasselbe Daily mit festgeschriebenen Preisen. Gastfortschritt bleibt auf diesem Gerät; angemeldete Spiele kannst du geräteübergreifend fortsetzen.')}</p>
    <h2>Higher or Lower</h2><p>${t('Compare the final bids of ended auctions. Each correct guess extends your streak. Ties count either way; a miss ends the run.', 'Vergleiche die Endgebote beendeter Auktionen. Jeder richtige Tipp verlängert den Lauf. Bei Gleichstand zählen beide Tipps; ein Fehler beendet den Lauf.')}</p>
    <h2>${t('Tokens & collectibles', 'Tokens & Sammelobjekte')}</h2><p>${t('Sign in before playing. One rewarded run per UTC day: complete Daily for 100 tokens, or earn 20 per correct Higher or Lower comparison with a final streak of at least 3 (maximum 200). Your first answer reserves that day’s run. Spend tokens in the shop and sell collectibles from your inventory.', 'Melde dich vor dem Spielen an. Ein Token-Lauf pro UTC-Tag: 100 Tokens für ein abgeschlossenes Daily oder 20 je richtigem Higher-or-Lower-Vergleich ab einem Endlauf von 3 Treffern (maximal 200). Der erste Tipp reserviert den Lauf. Nutze Tokens im Shop und verkaufe Sammelobjekte im Inventar.')}</p>
    <p class="fine-print">${t('Auction titles and descriptions are shown in their original source language. Collectibles are digital; no real money or ownership of auction goods is involved.', 'Auktionstitel und Beschreibungen erscheinen in der Originalsprache. Sammelobjekte sind digital; es geht weder um echtes Geld noch um Eigentum an Auktionswaren.')}</p>
  </form>`;
}
document.addEventListener('change', event => {
  if (event.target.id !== 'language-select') return;
  language = event.target.value === 'de' ? 'de' : 'en';
  try { localStorage.setItem('justizguessr:language', language); } catch {}
  renderStaticUi();
  document.dispatchEvent(new Event('jg:language'));
});
renderStaticUi();
