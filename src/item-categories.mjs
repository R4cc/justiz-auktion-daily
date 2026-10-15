import { decodeHtmlEntities } from './html-text.mjs';

// Product nouns outrank brand names, colors, model names and seller boilerplate.
// Vocabulary was audited against the 1,976-item archive supplied 2026-10-15.
export const CATEGORY_CLASSIFICATION_VERSION = 'item_categories_v1';
export const SELECTION_MARKET_CATEGORIES = Object.freeze({
  Elektronik:'electronics', Fahrzeuge:'vehicles', 'Getränke':'wine',
  Werkzeuge:'tools', Werkzeug:'tools', 'Schmuck & Uhren':'watches_jewelry',
  'Sammlerstücke':'collectibles', 'Möbel & Wohnen':'household', 'Haushalt & Garten':'household',
  'Fahrräder':'bicycles', 'Bücher & Medien':'books_media', Mode:'fashion',
  Kosmetik:'cosmetics', 'Sport & Freizeit':'sport_leisure', Sonstiges:'other'
});
export function normalizeSelectionText(value = '') {
  return decodeHtmlEntities(String(value)).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()
    .replace(/ß/g,'ss').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
export function productDescription(value = '') {
  return decodeHtmlEntities(String(value)).split(/\b(?:versand(?:hinweise|bedingungen)?|abholung|besichtigung|haftung|die sache wird|der gegenstand wird|die versteigerung erfolgt|naheres entnehmen|gewährleistung|gewaehrleistung|datenschutz|rechtliche hinweise|es gelten|rechtsgrundlage|versteigerung (?:gemäß|gemaess|nach)|foto und farbhinweis|öffnungszeiten|offnungszeiten|geschäftszeiten|geschaeftszeiten)\b/i)[0]
    .replace(/\b\d{1,2}(?::\d{2})?\s*uhr\b/gi,'').slice(0,1600);
}
const RULES = [
  // Explicit equipment/accessory nouns come before broad words like Tasche,
  // Auto, Sport, Uhr, Silber or the car/perfume/tool brands below.
  ['Sport & Freizeit', /\b(?:flugel|klavier|piano|e piano|gitarre|schlagzeug|saxophon|trompete|akkordeon|geige|violine|musikinstrument[a-z]*)\b|\bkeyboard\b.*\b(?:korg|yamaha|roland|casio)\b|\b(?:korg|roland)\b.*\bkeyboard\b/],
  ['Werkzeuge', /\b(?:[a-z]*(?:werkzeug(?:e|koffer|kasten|tasche|wagen|akku|akkus)?|bohr(?:maschine|hammer|schrauber|er)|schrauber|sage(?:maschine)?|schleif(?:er|maschine[n]?)|hobel(?:maschine|bank|banke)?|frase|schaber|zange(?:n)?|schlus(?:sel|selsatz))|[a-z]*kompressor|schweissgerat[a-z]*|schraubstock|dreischneider|werkstattwagen|[a-z]*maschinenkoffer|erdkabel|handwerkerbedarf|heissluftgeblase|thermodetektor|kreuzlinienlaser|kreuzlinien laser|laser entfernungsmesser|entfernungsmesser|gewindeschneider|steckschlussel[a-z]*|doppelmaulschlussel|maulschlussel[a-z]*|ratschen[a-z]*|bit set|bitset|bohrer[a-z]*|schrauben[a-z]*|dubel[a-z]*|be(?:i|ei)tel|spann(?:gurt|gurte)|abdruckset|heber|wagenheber|rangierwagenheber|hebebuhne|reifenmontiergerat|axt|axte|zwinge(?:n|nwagen)?|plattformleiter|maschinenkoffer|taschenmesser|multitool|multi tool|heissklebe[a-z]*|oberfrase|abricht dick[a-z]*|dickenhobel|handkreissage|bandsage|tischkreissage|handschleifer|exzenterschleifer)\b/],
  ['Haushalt & Garten', /\b(?:[a-z]*(?:kuhlschrank|kuhltruhe|kuhlinsel|kuhlzelle|kuhlbox|kalteaggregat|waschmaschine|geschirrspuler|spulmaschine|glaserspuler|staubsauger|kaffeemaschine|kaffeevollautomat|kuchenmaschine|rasenmaher|rasentrimmer|heckenschere|laubsauger|laubsauger blaser|leuchte(?:n)?|lampe(?:n)?|waage)|gartengerat[a-z]*|haushaltsgerat[a-z]*|thermomix|vorwerk|grill|gasgrill|kuche|pool(?:pflegeset)?|regnerschlitten|schlauchtrommel|hauswasserwerk|freischneider|motorsense|bodenfrase|heizlufter|heizkorperthermostat[a-z]*|turmventilator|luftreiniger|thermo isolier|hundebox|transportbox|stapelbox[a-z]*|transportkisten|abdeckplane|besteck[a-z]*|geschirr|glaser|weinglaser|somat|persil|waschmittel|vakuumier[a-z]*|feuerzeug[a-z]*|schreibmaschine|steckdosenleiste[a-z]*|shoe.*cleaner|leather conditioner|shoe refresher|renewbuck|boot kit)\b|\b(?:philips hue|led light bars)\b|\bstihl hs ?\d/],
  ['Elektronik', /\b(?:[a-z]*(?:notebook(?:s)?|laptop(?:s)?|computer|kamera|kopfhore(?:r|rn)|lautsprecher|headset(?:s)?|drucker|scanner|tastatur(?:en)?|mikrofon|projektor(?:s)?|fernseher|controller|netzteil|netzadapter|kartenleser|speichermedien)|pc|rechner|monitor(?:e|en|s)?|(?:ai|smart|vr) brille|ps [345]|tv|flat tv|mfp|erweiterungstastenmodul|kabel|smartphone|handy|iphone|ipad|ipod|imac|macbook|mac studio|tablet|camera|konsole|playstation|ps[345]|xbox|nintendo|festplatte[n]?|airpods|galaxy|lifebook|esprimo|redmi|grafikkarte|geforce|keyboard|toner|lasertoner|tintenpatrone[n]?|resttonerbehalter|papierkassette|transfereinheit|farbband|fax|laserjet|kaltgeratekabel|konverterkabel|usb|docking station|car charger|soundbox|musikbox|partybox|bluetooth|radio|speaker|pa system|starlink|datenband|ultrium|objektiv|stativ|dreibeinstativ|ekg|mikroskop|mikrowellentherapiegerat|pickup roller|dvd player|blu ray player|video ?spiel[a-z]*|computer ?spiel[a-z]*|konsolenspiel[a-z]*)\b/],
  ['Kosmetik', /\b(?:[a-z]*(?:parfum[a-z]*|aftershave|duschbad[a-z]*|zahnburste[n]?|rasierer|rasierapparat|rasierklinge[n]?|barttrimmer|bartschneider|haarschneider)|eau de toilette|eau de parfum|after shave|kosmetik[a-z]*|duft|dufte|hairstyler|glatteisen|ras(?:s)?ierer|silk epil|silk e pil|labello|oral b|haar und bart[a-z]*|folienrasierer|sauvage|savauge|pour homme|boss bottled|paco rabanne)\b/],
  ['Mode', /\b(?:[a-z]*(?:tasche[n]?|beutel|jacke[n]?|mantel|pullover|blazer|schuhe[n]?|stiefel|hose[n]?|shorts|hemd(?:en)?|shirt|bekleidung|geldborse|brille)|sneaker[s]?|kleidung|jeans[a-z]*|pyjama[a-z]*|espadrilles|loafers|boots|sandalen|rucksack|shopping bag|wallet|card holder|keyring|ray ban|fique a vontade|penny no back)\b/],
  ['Fahrzeuge', /\b(?:dachfahrrad[a-z]*trager|dachfahrradertrager|autoteil[a-z]*|fahrzeugteil[a-z]*|kfz|e scooter|iscooter|e roller|elektro(?:roller|scooter|auto[a-z]*)|kleinkraftrad|kraftrad|krad|motor(?:rad|roller)|mofa|moped|reifen[a-z]*|[a-z]*reifen|felgen|luftfilter|radkappen|stossstange|scheinwerfer|autotur|benzinkanister|car plastic ramp)\b/],
  ['Fahrräder', /\b(?:[a-z]*fahrrad[a-z]*|fahrrader[a-z]*|mountainbike|rennrad|ebike|e bike|fatbike|pedelec|bicycle|bike|fahrradrahmen|fahrradlampen|fahrradtasche[n]?|fahrradkoffer)\b/],
  ['Bücher & Medien', /\b(?:[a-z]*buch(?:er)?(?:sammlung)?|buchpaket|books?|roman[e]?|stgb|bgb|zpo|jgg|strafgesetzbuch|strafprozessordnung|zivilprozessordnung|jugendgerichtsgesetz|gesetzbuch|kommentar|lehrbuch|lexikon|auflage|zeitschrift[a-z]*|[a-z]*zeitung|dvd|bluray|schallplatte[n]?|vinyl|katalog|catalogue|catalog|bauanleitung|anleitung|manual)\b/],
  ['Schmuck & Uhren', /\b(?:[a-z]*schmuck[a-z]*|[a-z]*armbanduhr(?:en)?|armband(?:er)?|[a-z]*(?:goldring|silberring|herrenring|damenring|halskette[n]?|goldkette[n]?|silberkette[n]?|anhangerkette[n]?|damenkette[n]?)|ketten[a-z]*|kette|armreif|manschettenknopf[a-z]*|manschettenknopfe|frackknopfe|ohrstecker|ohrringe|creolen|diamant[a-z]*|brillant[a-z]*|brilliant[a-z]*|brillianten|goldbarren|herren(?:armband)?uhr|damen(?:armband)?uhr|uhrenbeweger|necklace|jewelry|jewellery|schmuckset)\b|\b(?:anhanger|ring)\b.*\b(?:gold|silber|punziert|750|585|333)\b/],
  ['Sammlerstücke', /\b(?:[a-z]*munze[n]?|[a-z]*medaille[n]?|briefmarke[n]?|antiquitat[a-z]*|figur(?:en)?|sammlung|olgemalde|oel(?:bild|gemalde)|gemalde[a-z]*|gemadedruck|leinwandbild|holzdruck|graphik|grafik|poster|karikatur[a-z]*|scherenschnitt|[a-z]*praparat[a-z]*|praparierte[nrsm]?|praparierter|wildtierfell|rentierfell|steirisches wappen)\b|\b(?:bild|bildern|druck)\b|\bsal[av]+ador dali\b/],
  ['Möbel & Wohnen', /\b(?:[a-z]*(?:schrank|schrankt(?:ur|uren)|tisch|stuhle?|stuhl|kommode|truhe|mobel|regal[e]?|teppich|spind[e]?|sessel|bett)|porzellan|sofa|spiegel|rattan|[a-z]*raumung[a-z]*|einrichtungsgegenstand[a-z]*|buntglasfenster|schwerlastregal[a-z]*|hangelampe[n]?)\b/],
  ['Sport & Freizeit', /\b(?:[a-z]*(?:hantel|ski|snowboard|zelt|schlafsack|golftasche|reitpad|reitdecke|sattel)|[a-z]*schutzenscheibe[n]?|fitness|tretroller|alu scooter|scooter aero|scooter crane|direktantriebtrainer|golf set|golfschlag[a-z]*|trolley|kajak|angel(?:rute|rolle|zubehor)?|tennis[a-z]*|boxsack|pferd|horseware|horse|reg(?:en)?mantel pferd|reit[a-z]*|helm)\b/],
  ['Getränke', /\b(?:wein|weine|rotwein|weisswein|rosewein|riesling|merlot|cabernet|sauvignon|chardonnay|chardonna|pinot|spatburgunder|burgunder|bordeaux|barolo|brunello|chianti|rioja|tempranillo|malbec|zinfandel|portwein|weingut|winery|primitivo|avignonesi|champagner|champagne|prosecco|sekt|whisky|whiskey|rum|cognac|brandy|vodka|wodka|likor|spirituosen|chablis|amarone|valpolicella|montepulciano|montalcino|sangiovese|sancerre|tignanello|sassicaia|ornellaia|bier|gin|tequila|kaffeebohnen|filterkaffee|kaffee|coffee|tea|tee)\b/]
];
const BRAND_RULES = [
  ['Schmuck & Uhren', /\b(?:rolex|tissot|glashutte|iwc|tag heuer|tagheuer|maurice lacroix|cartier|longines|hublot|breitling|wainer|jacques lemans|fossil|day date|konigskette|weissgold|gelbgold|rosegold|gold|silber|uhr|uhren|ring)\b/],
  ['Werkzeuge', /\b(?:makita|hilti|metabo|festool|proxxon|holzkraft|parkside|stihl)\b/],
  ['Fahrzeuge', /\b(?:pkw|lkw|auto|car|fahrzeug[a-z]*|bmw|mercedes|volkswagen|vw|audi|hyundai|opel|skoda|ford|cupra|chevrolet|seat|toyota|tesla|mazda|porsche|ferrari|mitsubishi|land ?rover|renault|peugeot|fiat|citroen|kia|volvo|honda|ducati|suzuki|piaggio|kymco|haozhan|passat|anhanger|mini one|mini cooper)\b/]
];
const CATEGORY_ALIASES = new Map([
  ...Object.keys(SELECTION_MARKET_CATEGORIES).map(category=>[normalizeSelectionText(category),category]),
  ['wine','Getränke'],['wein','Getränke'],['beverages','Getränke'],['books','Bücher & Medien'],['bucher','Bücher & Medien'],
  ['vehicles','Fahrzeuge'],['tools','Werkzeuge'],['jewelry','Schmuck & Uhren'],['jewellery','Schmuck & Uhren'],['watches jewelry','Schmuck & Uhren'],
  ['electronics','Elektronik'],['furniture','Möbel & Wohnen'],['household','Haushalt & Garten'],['fashion','Mode'],['cosmetics','Kosmetik'],
  ['bicycles','Fahrräder'],['books media','Bücher & Medien'],['sport leisure','Sport & Freizeit'],['collectibles','Sammlerstücke'],['other','Sonstiges']
]);

// Toy evidence is shared by live selection and legacy inventory/shop checks.
// Keep ambiguous words such as "game", "figure", "model" and car brands out
// of the standalone vocabulary: they also describe electronics, art and cars.
const TOY_WORDS = /\b((?:kinder|holz|baby)?spielzeug[a-z]*|toys?|brettspiele?|gesellschaftsspiele?|kartenspiele?|wuerfelspiele?|wurfelspiele?|lernspiele?|kinderspiele?|spielkarten|sammelkarten|trading cards?|board games?|card games?|(?:kinder|holz|3d)?puzz(?:le|el)s?|jigsaw|(?:holz|metall)?baukasten[a-z]*|(?:holz)?bauklotze|(?:holz)?bausteine|klemmbausteine|building sets?|building blocks?|puppen?[a-z]*|dolls?|dollhouses?|plusch[a-z]*|kuscheltiere?|stofftiere?|teddy(?:bar|baren)?|teddies|stuffed animals?|modellbausatze?|modellbausatz|modellautos?|modellfahrzeuge?|modelleisenbahn[a-z]*|modellbahn[a-z]*|modellflugzeuge?|modellschiffe?|model (?:cars?|trains?|aircraft|boats?)|actionfiguren?|action figures?|sammelfiguren?|funko pop|lego|duplo|playmobil|barbie|hot wheels|matchbox|schleich|steiff|brio|marklin|roco|fischertechnik|siku|ravensburger|hasbro|mattel|monopoly|scrabble)\b/;
const TOY_MEDIA = /\b(buch|bucher|book|books|katalog|catalogue|catalog|anleitung|bauanleitung|manual|dvd|bluray|videospiel|videospiele|video games?|computerspiel|computerspiele|konsolenspiel|konsolenspiele|playstation|xbox)\b/;
const TOY_CATEGORIES = /^(toys?|spielzeug(?: und sammlerstucke)?|spielwaren|spiele und spielzeug)$/;
function toyText(text, raw = text) {
  if (TOY_MEDIA.test(text)) return false;
  if (TOY_WORDS.test(text)) return true;
  if (/\b(?:rc|ferngesteuert[a-z]*) (?:autos?|cars?|fahrzeuge?|buggys?|trucks?|boote?|schiffe?|flugzeuge?|hubschrauber|helicopters?)\b/.test(text)) return true;
  if (/\b(?:slotcars?|rennbahn[a-z]*|autorennbahn[a-z]*)\b/.test(text)) return true;
  if (/\b(?:pokemon|yu gi oh|yugioh)\b/.test(text) && /\b(?:karten|cards|sammelkarten|trading cards)\b/.test(text)) return true;
  // Scale plus vehicle evidence catches "BMW M3 1:18" without reclassifying
  // a real car whose title merely includes its model name or registration year.
  return /\b1\s*[:/]\s*(?:12|18|24|32|43|50|64|72|87|160)\b/.test(raw) &&
    /\b(auto|car|pkw|lkw|bmw|mercedes|volkswagen|vw|audi|porsche|ferrari|ford|traktor|tractor)\b/.test(text);
}
export function isToyAuction(auction) {
  const title = normalizeSelectionText(auction.title);
  if (TOY_MEDIA.test(title)) return false;
  if (toyText(title, String(auction.title || ''))) return true;
  // A real product title takes precedence over incidental toy mentions in a
  // seller's description. Generic lots may identify their contents there.
  const titleCategory = titleCategoryFor(auction);
  if (titleCategory && titleCategory !== 'Sammlerstücke') return false;
  if (TOY_CATEGORIES.test(normalizeSelectionText(auction.category))) return true;
  const description = productDescription(auction.description);
  return toyText(normalizeSelectionText(description), description);
}


function titleCategoryFor(auction) {
  const raw = String(auction.title || ''), text = normalizeSelectionText(raw);
  if (toyText(text, raw)) return 'Sammlerstücke';
  if (/\bdachfahrrad[a-z]*trager\b/.test(text)) return 'Fahrzeuge';
  if (/\b(?:[a-z]*fahrrad[a-z]*|rahmenschloss[a-z]*|einsteckkette)\b/.test(text)) return 'Fahrräder';
  if (/\b(?:golf set|golftasche|pferd|horseware|reitpad|reitdecke)\b/.test(text)) return 'Sport & Freizeit';
  const product = RULES.find(([,pattern])=>pattern.test(text))?.[0];
  if (product) return product;
  const description = normalizeSelectionText(productDescription(auction.description));
  if (/\bflaschen?\b/.test(description) && /\b(?:alkoholgehalt|jahrgang|trinkbarkeit)\b/.test(description)) return 'Getränke';
  if (/\berstzulassung\b/.test(description) && /\b(?:hubraum|kilometerstand)\b/.test(description)) return 'Fahrzeuge';
  const brands = BRAND_RULES.filter(([,pattern])=>pattern.test(text));
  return brands.find(([category])=>category==='Fahrzeuge')?.[0] || brands[0]?.[0] || null;
}
export function auctionSelectionCategory(auction = {}) {
  const title = titleCategoryFor(auction);
  if (title) return title;
  const raw = productDescription(auction.description), text = normalizeSelectionText(raw);
  if (/\bflaschen?\b/.test(text) && /\b(?:alkoholgehalt|jahrgang|trinkbarkeit)\b/.test(text)) return 'Getränke';
  if (toyText(text,raw)) return 'Sammlerstücke';
  const description = RULES.find(([,pattern])=>pattern.test(text))?.[0] || BRAND_RULES.find(([,pattern])=>pattern.test(text))?.[0];
  if (description) return description;
  if (TOY_CATEGORIES.test(normalizeSelectionText(auction.sourceCategory || auction.category))) return 'Sammlerstücke';
  return CATEGORY_ALIASES.get(normalizeSelectionText(auction.sourceCategory || auction.category)) || 'Sonstiges';
}
const WINE_WORDS = /\b(?:wine|wines|wein|weine|rotwein|weisswein|rosewein|riesling|merlot|cabernet|sauvignon|chardonnay|chardonna|pinot|spatburgunder|burgunder|bordeaux|barolo|brunello|chianti|rioja|tempranillo|malbec|zinfandel|portwein|weingut|winery|primitivo|avignonesi|champagner|champagne|prosecco|sekt|chablis|amarone|valpolicella|montepulciano|montalcino|sangiovese|sancerre|tignanello|sassicaia|ornellaia)\b/;
const OTHER_DRINK_WORDS = /\b(?:whisky|whiskey|rum|cognac|brandy|vodka|wodka|likor|liqueur|spirituosen|spirits|schnaps|grappa|absinth|bier|beer|gin|tequila|wasser|saft|cola|limonade|kaffee[a-z]*|filterkaffee|coffee|tee|tea)\b/;
export function isWineAuction(auction) {
  if (auctionSelectionCategory(auction)!=='Getränke') return false;
  const title = normalizeSelectionText(auction.title);
  if (OTHER_DRINK_WORDS.test(title)) return false;
  if (WINE_WORDS.test(title) || /^(?:wine|wines|wein|weine)$/.test(normalizeSelectionText(auction.category))) return true;
  const description = normalizeSelectionText(productDescription(auction.description));
  if (OTHER_DRINK_WORDS.test(description)) return false;
  return WINE_WORDS.test(description) || /\bflaschen?\b/.test(description) && /\b(?:jahrgang|trinkbarkeit)\b/.test(description);
}
export function isCarAuction(auction) {
  if (auctionSelectionCategory(auction)!=='Fahrzeuge') return false;
  const title = normalizeSelectionText(auction.title);
  if (/\b(?:[a-z]*reifen|[a-z]*felgen|ersatzteil[a-z]*|fahrzeugteil[a-z]*|anhanger|motorrad|kraftrad|krad|motorroller|roller|scooter|moped|mofa|radkappen|motor|getriebe|scheinwerfer|stossstange|autotur|luftfilter|dachfahrrad[a-z]*trager|kindersitz|fussmatte[n]?|benzinkanister)\b/.test(title)) return false;
  return /\b(?:pkw|auto|autos|car|limousine|kombi|sedan|personenkraftwagen|bmw|mercedes|volkswagen|vw|audi|hyundai|opel|skoda|ford|cupra|chevrolet|seat|toyota|tesla|mazda|porsche|ferrari|mitsubishi|land ?rover|renault|peugeot|fiat|citroen|kia|volvo|passat|mini one|mini cooper)\b/.test(title);
}
export function classifiedBusinessType(item, category = auctionSelectionCategory(item)) {
  if (['case','review-pack'].includes(item.kind)) return null;
  if (isToyAuction(item)) return 'toys';
  if (category==='Fahrzeuge') return isCarAuction(item)?'cars':null;
  return ({'Getränke':'wine','Schmuck & Uhren':'jeweler',Werkzeuge:'hardware',Sonstiges:'hardware',Elektronik:'electronics'})[category] || null;
}
