// Selection categories intentionally differ from the source site's very broad buckets.
const CATEGORY_RULES = [
  ['Getränke', /\b(wein|weine|rotwein|weisswein|rosewein|riesling|merlot|cabernet|sauvignon|chardonnay|pinot|spatburgunder|burgunder|bordeaux|barolo|brunello|chianti|rioja|tempranillo|malbec|zinfandel|portwein|weingut|primitivo|avignonesi|champagner|champagne|prosecco|sekt|whisky|whiskey|rum|cognac|brandy|vodka|wodka|likor|spirituosen|chablis|amarone|valpolicella|montepulciano|montalcino|sangiovese|sancerre|tignanello|sassicaia|ornellaia|bier|gin|tequila)\b/],
  ['Bücher & Medien', /\b(buch|bucher|buchpaket|roman|romane|stgb|bgb|strafgesetzbuch|gesetzbuch|kommentar|lehrbuch|lexikon|auflage|dvd|bluray|schallplatte|vinyl)\b/],
  ['Fahrräder', /\b(fahrrad|fahrrader|mountainbike|rennrad|ebike|e bike|pedelec|bicycle|bike)\b/],
  ['Fahrzeuge', /\b(pkw|lkw|auto|fahrzeug|fahrzeuge|bmw|mercedes|volkswagen|vw|audi|hyundai|opel|skoda|ford|seat|motorrad|motorroller|anhanger|reifen)\b/],
  ['Elektronik', /\b(notebook|laptop|computer|pc|monitor|fernseher|smartphone|handy|iphone|ipad|tablet|kamera|camera|konsole|playstation|xbox|nintendo|drucker|festplatte|airpods|macbook)\b/],
  ['Werkzeuge', /\b(werkzeug|werkzeuge|werkzeugkoffer|bohrhammer|bohrmaschine|akkuschrauber|makita|hilti|sage|kreissage|schleifer|schweissgerat|kompressor)\b/],
  ['Schmuck & Uhren', /\b(schmuck|modeschmuck|herrenring|damenring|diamanten|halskette|damenkette|armbanduhr|ring|kette|armreif|armband|gold|silber|uhr|rolex)\b/],
  ['Kosmetik', /\b(parfum|parfums|parfumset|eau de toilette|eau de parfum|duft|dufte|kosmetik)\b/],
  ['Mode', /\b(sneaker|schuhe|jacke|winterjacke|sommerjacke|shirt|kleidung|herrenbekleidung|damenbekleidung|jeanshosen|hemden|poloshirt|sonnenbrille|umhangetasche|jeans|handtasche|tasche|stiefel)\b/],
  ['Möbel & Wohnen', /\b(mobel|schrank|tisch|esstisch|schreibtisch|stuhl|sofa|lampe|porzellan|teppich|sessel|bett)\b/],
  ['Haushalt & Garten', /\b(waschmaschine|kuhlschrank|spulmaschine|staubsauger|kaffeemaschine|kuche|rasenmaher|grill|gartengerat|kuchenmaschine|thermomix)\b/],
  ['Sport & Freizeit', /\b(sport|hantel|fitness|ski|snowboard|zelt|angel|kajak|gitarre|klavier|musikinstrument)\b/],
  ['Sammlerstücke', /\b(munze|munzen|sammlung|figur|lego|modellauto|antiquitat|briefmarke|briefmarken|spielzeug)\b/]
];
const CATEGORY_ALIASES = new Map([
  ['wine', 'Getränke'], ['wein', 'Getränke'], ['getranke', 'Getränke'], ['beverages', 'Getränke'],
  ['books', 'Bücher & Medien'], ['bucher', 'Bücher & Medien'], ['vehicles', 'Fahrzeuge'],
  ['tools', 'Werkzeuge'], ['werkzeug', 'Werkzeuge'], ['jewelry', 'Schmuck & Uhren'],
  ['electronics', 'Elektronik'], ['furniture', 'Möbel & Wohnen'], ['fashion', 'Mode'],
  ...CATEGORY_RULES.map(([category]) => [normalizeSelectionText(category), category])
]);

export function normalizeSelectionText(value = '') {
  return String(value).replace(/&(?:lpar|rpar|plus|amp|quot|apos|period|lowbar);/gi, ' ').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function auctionSelectionCategory(auction) {
  const title = normalizeSelectionText(auction.title);
  const fromTitle = CATEGORY_RULES.find(([, pattern]) => pattern.test(title));
  if (fromTitle) return fromTitle[0];
  // Alcohol metadata catches producer-only wine titles without calling perfume a drink.
  const description = normalizeSelectionText(String(auction.description || '').split(/versand|foto und farbhinweis|offnungszeiten|geschäftszeiten/i)[0]
    .replace(/\d{1,2}(?::\d{2})?\s*uhr/gi, '').slice(0, 600));
  if (/\bflaschen?\b/.test(description) && /\b(alkoholgehalt|jahrgang|trinkbarkeit)\b/.test(description)) return 'Getränke';
  const fromDescription = CATEGORY_RULES.find(([, pattern]) => pattern.test(description));
  if (fromDescription) return fromDescription[0];
  return CATEGORY_ALIASES.get(normalizeSelectionText(auction.category)) || 'Sonstiges';
}

const STOP_WORDS = new Set(('der die das den dem des ein eine einer eines einem einen und oder mit ohne von vom zum zur fur im in aus am an auf ca circa marke modell typ koffer transportkoffer zustand gebraucht gebrauchte gebrauchter neu neuwertig original verpackt ovp ungepruft defekt stuck stk st flasche flaschen set paket konvolut auktion angebot artikel verkauf siehe beschreibung auflage aufl kommentar').split(' '));
function productText(value) {
  return normalizeSelectionText(String(value || '')
    .replace(/\b(?:los|lot|position|pos|nr|nummer|auktion\s*id|artikelnummer)\s*[:#.-]?\s*\d+\b/gi, ' ')
    .replace(/^\s*\d+\s*(?:x\s*|st[uü]ck\s*|flaschen?\s*)?/i, '')
    .replace(/\(\s*\d+\s*(?:von|\/)\s*\d+\s*\)/gi, ' '))
    .replace(/\bstrafgesetzbuch\b/g, 'stgb')
    .replace(/\b([a-z]{1,3})\s+(\d{3,})\b/g, '$1$2')
    .split(' ').filter(word => word && !STOP_WORDS.has(word)).join(' ');
}
function grams(value) {
  const text = value.replace(/\s/g, '');
  return new Set(Array.from({ length: Math.max(0, text.length - 2) }, (_, i) => text.slice(i, i + 3)));
}
function overlap(a, b) {
  let common = 0;
  for (const value of a) if (b.has(value)) common++;
  return common;
}
function profile(auction) {
  const text = productText(auction.title);
  const tokens = new Set(text.split(' ').filter(Boolean));
  const numbers = new Set(text.match(/\d+/g) || []);
  const description = new Set(productText(String(auction.description || '').split(/versand|haftung|foto und farbhinweis|füllmenge|der verkauf|aufgrund|bitte beachten/i)[0].slice(0, 300)).split(' ').filter(Boolean));
  const source = auction.sourceImages?.[0];
  let image = null;
  if (source && !/placeholder|no[-_]?image|kein[-_]?bild|default/i.test(source)) {
    try { const url = new URL(source, 'https://www.justiz-auktion.de'); image = url.origin + url.pathname; } catch {}
  }
  return { auction, text, tokens, numbers, description, image, grams: grams(text) };
}
function similar(a, b) {
  if (a.auction.id === b.auction.id || (a.image && a.image === b.image)) return true;
  if (!a.text || !b.text) return false;
  if (a.text === b.text) return true;
  // Different model numbers, years or capacities are not evidence of a duplicate.
  if (a.numbers.size && b.numbers.size && (a.numbers.size !== b.numbers.size || overlap(a.numbers, b.numbers) !== a.numbers.size)) return false;
  const common = overlap(a.tokens, b.tokens);
  const small = Math.min(a.tokens.size, b.tokens.size);
  const large = Math.max(a.tokens.size, b.tokens.size);
  const gramDice = 2 * overlap(a.grams, b.grams) / (a.grams.size + b.grams.size || 1);
  // Containment tolerates added words; substitutions require strong spelling similarity.
  // Shared winery regions or seller boilerplate must not merge different producers.
  const containment = common === small;
  if (common >= 2 && common / small >= .8 && common / large >= .65 && (containment || gramDice >= .9)) return true;
  if (common >= 1 && small >= 2 && gramDice >= .9) return true;
  const descriptionCommon = overlap(a.description, b.description);
  return common >= 2 && containment && common / large >= .6 && descriptionCommon >= 7 &&
    descriptionCommon / Math.max(a.description.size, b.description.size) >= .8;
}

// Union related records before picking representatives, so batch size cannot increase
// an item's selection odds. An inverted index avoids comparing unrelated products.
export function buildAuctionFamilies(auctions) {
  const profiles = auctions.map(profile).sort((a, b) => Number(a.auction.id) - Number(b.auction.id) || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  const modelSignatures = profiles.map(item => [...item.numbers].sort().join('|'));
  const parent = profiles.map((_, index) => index);
  function root(index) {
    while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; }
    return index;
  }
  const index = new Map();
  profiles.forEach((item, position) => {
    const keys = [`id:${item.auction.id}`];
    // Word keys include numeric identifiers so reordered titles share candidates.
    keys.push(...[...item.tokens].map(token => `word:${token}`));
    if (item.image) keys.push(`image:${item.image}`);
    const candidates = new Set(keys.flatMap(key => index.get(key) || []));
    for (const candidate of candidates) {
      if (!similar(item, profiles[candidate])) continue;
      const left = root(position), right = root(candidate);
      if (left === right) continue;
      const strongMatch = item.auction.id === profiles[candidate].auction.id ||
        (item.image && item.image === profiles[candidate].image);
      // A generic title must not bridge two incompatible model families transitively.
      if (!strongMatch && modelSignatures[left] && modelSignatures[right] && modelSignatures[left] !== modelSignatures[right]) continue;
      parent[left] = right;
      modelSignatures[right] ||= modelSignatures[left];
    }
    for (const key of keys) {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(position);
    }
  });
  const groups = new Map();
  profiles.forEach((item, position) => {
    const key = root(position);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item.auction);
  });
  return [...groups.values()];
}

export function chooseVariedAuctions(candidates, count, rank) {
  const selected = [];
  const categories = new Map();
  const remaining = [...candidates];
  const minimumCategories = Math.min(4, count);
  while (selected.length < count) {
    const eligible = remaining.filter(item => {
      const category = auctionSelectionCategory(item);
      return (categories.get(category) || 0) < (category === 'Getränke' ? 1 : 2);
    });
    // Prefer a new category before allowing any second lot in a category.
    eligible.sort((a, b) => Number(categories.has(auctionSelectionCategory(a))) - Number(categories.has(auctionSelectionCategory(b))) || rank(b, selected) - rank(a, selected) || Number(a.id) - Number(b.id));
    const choice = eligible[0];
    if (!choice) break;
    selected.push(choice);
    const category = auctionSelectionCategory(choice);
    categories.set(category, (categories.get(category) || 0) + 1);
    remaining.splice(remaining.indexOf(choice), 1);
  }
  if (selected.length < count || categories.size < minimumCategories) {
    const error = new Error(`Not enough varied auctions: ${count} unique lots across at least ${minimumCategories} categories required (maximum two per category and one drinks lot)`);
    error.code = 'insufficient_variety';
    throw error;
  }
  return selected;
}
