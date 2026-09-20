let language = 'en';
try { if (localStorage.getItem('justizguessr:language') === 'de') language = 'de'; } catch {}
function t(en, de) { return language === 'de' ? de : en; }
let infoTipSequence = 0;
function uiEscape(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function infoTip(text, label = t('More information', 'Mehr Informationen')) {
  const id = `info-tip-${++infoTipSequence}`;
  return `<span class="info-tip"><button type="button" aria-label="${uiEscape(label)}" aria-describedby="${id}">?</button><span id="${id}" role="tooltip">${uiEscape(text)}</span></span>`;
}
function paletteName(id) {
  const names = { 'electronics-smuggling': ['Smuggled Electronics', 'Geschmuggelte Elektronik'],
    'dealer-seizure': ['Dealer Seizure', 'Händlerbeschlagnahme'], 'wine-tax-seizure': ['Wine Tax Seizure', 'Weinsteuerbeschlagnahme'] };
  return names[id] ? t(...names[id]) : id;
}
// Translations of the definition stories. Frozen backend editions retain
// their original English text and economic snapshots.
function paletteStoryDe(id) {
  return ({
    fundkiste: 'In Bauthaven räumt der Hafenzoll ein Lager mit nicht abgeholten Waren. Eine Beschlagnahme, viele unterschiedliche Funde.',
    schatzkiste: 'Ein Bankschließfach in Altstadt-Kolding wird nach Ablauf des Mietvertrags geleert. Wertvolle Einzelstücke füllen diese Palette.',
    cars: 'Der Verwahrplatz von Nordhafen versteigert komplette Personenwagen aus einer Räumung — keine Teile und keine Motorräder.',
    wine: 'Der Keller eines Weinguts wird nach der Auswanderung seines Besitzers geräumt. Weinflaschen, keine Spirituosen.',
    electronics: 'Eine Spedition verkauft zurückgesandte Unterhaltungselektronik aus einem Lager in Grayfield.',
    tools: 'Der Werkzeugbauer Brackwald & Söhne schließt seine Werkstatt. Die gesamte Werkzeugwand wird zur Palette.',
    jewellery: 'Das Hinterzimmer eines Pfandhauses in Silberbruch wird inventarisiert. Uhren und Schmuck aus einer Beschlagnahme.',
    collectibles: 'Ein Dachboden in Kirschau birgt eine lebenslange Sammlung aus Figuren, Münzen und Modellen.',
    'electronics-smuggling': 'In Grayfield öffnet der Zoll einen falsch deklarierten Container. Statt Maschinenteilen enthält er Unterhaltungselektronik für diese Ereignispalette.',
    'dealer-seizure': 'Das Autohaus Kanalley & Co. bricht zusammen. Ermittler sichern Autos, Elektronik, Uhren und Luxuswaren für diese Palette.',
    'wine-tax-seizure': 'In Weißbrunn decken Steuerermittler einen unversteuerten Weinimport auf. Wein und Sammlerstücke aus dem Keller bilden diese Palette.'
  })[id] || 'Eine Geschichte aus der JUSTIZGUESSR-Welt.';
}
// Older frozen editions and published news retain their original snapshots.
// Normalize their display copy so the single site disclaimer carries the
// fiction notice instead of repeating it inside every story.
function immersiveCopy(value = '') {
  return String(value)
    .replace(/^\s*(?:Fiction|Fiktion):\s*/i, '')
    .replace(/\binto the game world\b/gi, 'onto the market')
    .replace(/\bgame-world\s+/gi, '')
    .replace(/\bin die Spielwelt\b/gi, 'auf den Markt')
    .replace(/\bin der Spielwelt\b/gi, '')
    .replace(/\bIm fiktiven (?=[A-ZÄÖÜ])/g, 'In ')
    .replace(/\bDas fiktive (?=[A-ZÄÖÜ])/g, '')
    .replace(/\ban (?:invented|imaginary|imagined) ([a-z])/gi, (match, letter) => `${/^[A-Z]/.test(match) ? 'A' : 'a'}${/[aeiou]/i.test(letter) ? 'n' : ''} ${letter}`)
    .replace(/\bfictional\s+|\binvented\s+|\bimaginary\s+|\bimagined\s+/gi, '')
    .replace(/\bfiktiv(?:e|en|er|es)?\s+|\berfunden(?:e|en|er|es)?\s+/gi, '')
    .replace(/\s+([,.;])/g, '$1').replace(/\s{2,}/g, ' ').trim()
    .replace(/^./, letter => letter.toUpperCase());
}
function uiLocale() { return language === 'de' ? 'de-DE' : 'en-GB'; }
function number(value, digits) {
  return Number(value).toLocaleString(uiLocale(), digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function justizEuro(value) { return `J€ ${number(value)}`; }
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
  const rewards = window.justizRewards || { daily: 100, higherLowerPerCorrect: 20, higherLowerMax: 200, minimumStreak: 3 };
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
    <h2>${t('Game rules', 'Spielregeln')}</h2>
    <div class="rules-grid"><div><span>01</span><p>${t('Explore five real, publicly listed auctions.', 'Entdecke fünf echte, öffentlich gelistete Auktionen.')}</p></div>
    <div><span>02</span><p>${t('Guess the bid. Condition and time remaining can help.', 'Schätze das Gebot. Zustand und Restzeit helfen dir.')}</p></div>
    <div><span>03</span><p>${t('The closer your guess, the more points you earn. Small price differences on cheaper items are scored generously.', 'Je näher dein Tipp, desto mehr Punkte. Kleine Preisunterschiede bei günstigen Losen werden großzügig bewertet.')}</p></div></div>
    <p>${t('Everyone gets the same Daily set and fixed prices. Guest progress stays on this device; signed-in games can be resumed across devices.', 'Alle spielen dasselbe Daily mit festgeschriebenen Preisen. Gastfortschritt bleibt auf diesem Gerät; angemeldete Spiele kannst du geräteübergreifend fortsetzen.')}</p>
    <h2>Higher or Lower</h2><p>${t('Compare the final bids of ended auctions. Each correct guess extends your streak. Ties count either way; a miss ends the run.', 'Vergleiche die Endgebote beendeter Auktionen. Jeder richtige Tipp verlängert den Lauf. Bei Gleichstand zählen beide Tipps; ein Fehler beendet den Lauf.')}</p>
    <h2>${t('Justiz€ & collectibles', 'Justiz€ & Sammelobjekte')}</h2>${typeof economyFlags !== 'undefined' && economyFlags.paletteAuctions ? `<p>${t('Complete Daily to earn 150 XP. Your first Daily or Higher or Lower run of the UTC day can also earn J€. Bid on sealed Mystery Palettes, reveal three finds, and collect them in your inventory. Successful marketplace sales earn 10–200 XP.', 'Schließe Daily für 150 XP ab. Dein erster Daily- oder Higher-or-Lower-Lauf pro UTC-Tag kann auch J€ verdienen. Biete auf versiegelte Mystery-Paletten, entdecke drei Funde und sammle sie im Inventar. Erfolgreiche Marktplatzverkäufe bringen 10–200 XP.')}</p>` : `<p>${t(`Sign in before playing. One rewarded run per UTC day: complete Daily for ${justizEuro(rewards.daily)}, or earn ${justizEuro(rewards.higherLowerPerCorrect)} per correct Higher or Lower comparison with a final streak of at least ${rewards.minimumStreak} (maximum ${justizEuro(rewards.higherLowerMax)}). Rewards follow today’s cheapest case price. Your first answer reserves that day’s run. Spend J€ in the shop and sell collectibles from your inventory.`, `Melde dich vor dem Spielen an. Ein J€-Lauf pro UTC-Tag: ${justizEuro(rewards.daily)} für ein abgeschlossenes Daily oder ${justizEuro(rewards.higherLowerPerCorrect)} je richtigem Higher-or-Lower-Vergleich ab einem Endlauf von ${rewards.minimumStreak} Treffern (maximal ${justizEuro(rewards.higherLowerMax)}). Die Belohnungen richten sich nach dem heutigen günstigsten Kistenpreis. Der erste Tipp reserviert den Lauf. Nutze J€ im Shop und verkaufe Sammelobjekte im Inventar.`)}</p>`}
    <p class="fine-print">${t('Auction titles and descriptions are shown in their original source language.', 'Auktionstitel und Beschreibungen erscheinen in der Originalsprache.')}</p>
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
