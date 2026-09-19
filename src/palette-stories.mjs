import { createHash } from 'node:crypto';

// Auction stories are selected when a lot is created and then frozen in its
// public snapshot. The names below belong only to invented places and
// organisations. Real-person bidder cameos deliberately never enter this
// module, so a cameo cannot be connected to a seizure or alleged offence.
const THEMES = Object.freeze({
  mixed: {
    label: 'Mixed Evidence Lot', labelDe: 'Gemischtes Asservatenlos',
    contents: 'unclaimed parcels, household finds and oddly labelled boxes',
    contentsDe: 'herrenlose Pakete, Haushaltsfunde und seltsam beschriftete Kisten'
  },
  premium: {
    label: 'High-Value Clearance', labelDe: 'Hochwertige Räumung',
    contents: 'watches, electronics and conspicuously expensive accessories',
    contentsDe: 'Uhren, Elektronik und auffällig teure Accessoires'
  },
  vehicles: {
    label: 'Impounded Motor Pool', labelDe: 'Beschlagnahmter Fuhrpark',
    contents: 'complete cars with keys, paperwork and stories left in the gloveboxes',
    contentsDe: 'vollständige Autos mit Schlüsseln, Papieren und Geschichten im Handschuhfach'
  },
  wine: {
    label: 'Cellar Release', labelDe: 'Kellerfreigabe',
    contents: 'sealed wine bottles, cellar crates and dusty collector pieces',
    contentsDe: 'versiegelte Weinflaschen, Kellerkisten und staubige Sammlerstücke'
  },
  electronics: {
    label: 'Electronics Seizure', labelDe: 'Elektronikbeschlagnahme',
    contents: 'phones, laptops and consumer electronics in every possible state of charge',
    contentsDe: 'Handys, Laptops und Unterhaltungselektronik in jedem denkbaren Ladezustand'
  },
  tools: {
    label: 'Workshop Clearance', labelDe: 'Werkstatträumung',
    contents: 'power tools, hand tools and cases whose missing labels raise questions',
    contentsDe: 'Elektrowerkzeuge, Handwerkzeug und Koffer mit verdächtig fehlenden Etiketten'
  },
  jewellery: {
    label: 'Jewellery Evidence Lot', labelDe: 'Schmuck-Asservatenlos',
    contents: 'watches, jewellery and velvet boxes gathered into one sealed lot',
    contentsDe: 'Uhren, Schmuck und Samtschachteln in einem versiegelten Los'
  },
  collectibles: {
    label: 'Collector Cache', labelDe: 'Sammlerversteck',
    contents: 'coins, models, figurines and memorabilia from an obsessive collection',
    contentsDe: 'Münzen, Modelle, Figuren und Erinnerungsstücke aus einer obsessiven Sammlung'
  },
  sport: {
    label: 'Sporting Goods Case', labelDe: 'Sportwaren-Fall',
    contents: 'training gear, bicycles and equipment from a very ambitious storeroom',
    contentsDe: 'Trainingsgeräte, Fahrräder und Ausrüstung aus einem sehr ehrgeizigen Lagerraum'
  },
  home: {
    label: 'Estate Contents', labelDe: 'Inventarauflösung',
    contents: 'furniture, appliances and decorative pieces with more character than provenance',
    contentsDe: 'Möbel, Geräte und Dekostücke mit mehr Charakter als Herkunftsnachweisen'
  }
});

const SCENES = Object.freeze([
  {
    id: 'greifenau-customs', title: 'The Greifenau Customs Annex', titleDe: 'Die Zollstelle Greifenau',
    short: 'Customs annex clearance', shortDe: 'Räumung einer Zollstelle',
    lead: 'A misrouted delivery spent six months in the Greifenau customs annex before the evidence room finally ran out of shelf space.',
    leadDe: 'Eine fehlgeleitete Lieferung lag sechs Monate in der Zollstelle Greifenau, bis dem Asservatenraum endgültig die Regale ausgingen.'
  },
  {
    id: 'nordhafen-locker', title: 'Nordhafen Night-Train Locker', titleDe: 'Nachtzug-Schließfach Nordhafen',
    short: 'Abandoned station locker', shortDe: 'Herrenloses Bahnhofsschließfach',
    lead: 'A locker beside the last night train at Nordhafen stayed paid up long after its owner stopped returning.',
    leadDe: 'Ein Schließfach neben dem letzten Nachtzug in Nordhafen blieb lange bezahlt, nachdem sein Besitzer nicht mehr zurückkam.'
  },
  {
    id: 'kirschau-canal', title: 'The Kirschau Canal Warehouse', titleDe: 'Das Kanallager Kirschau',
    short: 'Canal warehouse inspection', shortDe: 'Kontrolle im Kanallager',
    lead: 'Inspectors opened the wrong blue door at a canal warehouse in Kirschau and found a room absent from every floor plan.',
    leadDe: 'Kontrolleure öffneten in einem Kanallager in Kirschau die falsche blaue Tür und fanden einen Raum, der auf keinem Plan stand.'
  },
  {
    id: 'sonnenbruck-hotel', title: 'The Sonnenbruck Service Lift', titleDe: 'Der Lastenaufzug von Sonnenbruck',
    short: 'Hotel service-floor find', shortDe: 'Fund im Hotel-Servicetrakt',
    lead: 'During the Sonnenbruck Hotel renovation, a service lift stopped at a floor missing from the guest directory.',
    leadDe: 'Bei der Renovierung des Hotels Sonnenbruck hielt ein Lastenaufzug in einem Stockwerk, das im Gästeverzeichnis fehlte.'
  },
  {
    id: 'tannbach-ferry', title: 'Tannbach Ferry Terminal Hold', titleDe: 'Fund im Fährterminal Tannbach',
    short: 'Unclaimed ferry freight', shortDe: 'Nicht abgeholte Fährfracht',
    lead: 'A freight cage at Tannbach ferry terminal crossed the water eleven times because neither shore would admit ordering it.',
    leadDe: 'Ein Frachtkäfig im Fährterminal Tannbach überquerte elfmal das Wasser, weil keine Seite zugeben wollte, ihn bestellt zu haben.'
  },
  {
    id: 'rosenfeld-depot', title: 'The Rosenfeld Railway Depot', titleDe: 'Das Bahndepot Rosenfeld',
    short: 'Rail depot recovery', shortDe: 'Fund im Bahndepot',
    lead: 'Workers clearing a disused platform at Rosenfeld depot discovered a freight section hidden behind advertising boards.',
    leadDe: 'Bei der Räumung eines stillgelegten Bahnsteigs im Depot Rosenfeld entdeckten Arbeiter hinter Werbetafeln einen verborgenen Frachtbereich.'
  },
  {
    id: 'bauthaven-cinema', title: 'Bauthaven Cinema Store Room', titleDe: 'Kinolager Bauthaven',
    short: 'Cinema basement clearance', shortDe: 'Räumung eines Kinokellers',
    lead: 'The old Bauthaven cinema had one basement room too many and a caretaker with no key for it.',
    leadDe: 'Das alte Kino in Bauthaven hatte einen Kellerraum zu viel und einen Hausmeister ohne passenden Schlüssel.'
  },
  {
    id: 'silberbruch-workshop', title: 'The Silberbruch Riverside Workshop', titleDe: 'Die Uferwerkstatt Silberbruch',
    short: 'Riverside workshop case', shortDe: 'Fall aus der Uferwerkstatt',
    lead: 'A riverside workshop in Silberbruch closed overnight, leaving its radio on and a meticulously packed storeroom behind.',
    leadDe: 'Eine Uferwerkstatt in Silberbruch schloss über Nacht und hinterließ ein laufendes Radio sowie ein penibel gepacktes Lager.'
  },
  {
    id: 'grayfield-freight', title: 'Grayfield Lost-Freight Hall', titleDe: 'Fundfrachthalle Grayfield',
    short: 'Lost-freight inventory', shortDe: 'Inventur der Fundfracht',
    lead: 'Grayfield freight staff inventoried a row of crates whose tracking numbers all led back to one nonexistent loading bay.',
    leadDe: 'Das Frachtteam in Grayfield inventarisierte eine Reihe Kisten, deren Sendungsnummern alle zu derselben nicht vorhandenen Laderampe führten.'
  }
]);

const generatedStories = Object.entries(THEMES).flatMap(([theme, copy]) => SCENES.map(scene => ({
  id: `generated:${theme}:${scene.id}`,
  theme,
  title: `${scene.title}: ${copy.label}`,
  titleDe: `${scene.titleDe}: ${copy.labelDe}`,
  body: `${scene.lead} The sealed auction palette contains ${copy.contents}.`,
  bodyDe: `${scene.leadDe} Die versiegelte Auktionspalette enthält ${copy.contentsDe}.`,
  shortDescription: scene.short,
  shortDescriptionDe: scene.shortDe,
  fictional: true,
  parody: false
})));

// One conspicuously Austrian parody per theme. These are satirical settings,
// never allegations about a named person. With nine general stories alongside
// each one, parody stories make up exactly ten percent of every theme and of
// the complete pool.
const parodyStories = [
  {
    id: 'parody:mixed:balkanroute', theme: 'mixed',
    title: 'Balkanroute Electronics Palette', titleDe: 'Balkanroute-Elektronikpalette',
    body: 'A border scanner flags one crate of adapters, novelty sunglasses and three mystery remotes. The paperwork simply says “definitely kitchenware”.',
    bodyDe: 'Ein Grenzscanner markiert eine Kiste mit Adaptern, Spaßsonnenbrillen und drei rätselhaften Fernbedienungen. Auf den Papieren steht nur „ganz sicher Küchenware“.',
    shortDescription: 'Border-control parody', shortDescriptionDe: 'Grenzkontroll-Parodie'
  },
  {
    id: 'parody:premium:ibiza', theme: 'premium',
    title: 'Ibiza Estate Clearance', titleDe: 'Ibiza-Nachlassräumung',
    body: 'A suspiciously photogenic villa is cleared after its karaoke room changes the locks. Designer accessories and recording gear go under the hammer.',
    bodyDe: 'Eine verdächtig fotogene Villa wird geräumt, nachdem der Karaokeraum die Schlösser tauscht. Designer-Accessoires und Aufnahmegeräte kommen unter den Hammer.',
    shortDescription: 'Villa-clearance parody', shortDescriptionDe: 'Villenräumungs-Parodie'
  },
  {
    id: 'parody:vehicles:alpine', theme: 'vehicles',
    title: 'Alpine Tunnel Motor Pool', titleDe: 'Alpiner Tunnelfuhrpark',
    body: 'An alpine committee buys twelve official cars for a tunnel opening and remembers to invite only one driver. The surplus fleet is now sealed for auction.',
    bodyDe: 'Ein alpines Komitee kauft zwölf Dienstwagen für eine Tunneleröffnung und lädt nur einen Fahrer ein. Der überschüssige Fuhrpark wird nun versiegelt versteigert.',
    shortDescription: 'Infrastructure parody', shortDescriptionDe: 'Infrastruktur-Parodie'
  },
  {
    id: 'parody:wine:heuriger', theme: 'wine',
    title: 'The Heuriger Back-Room Inventory', titleDe: 'Die Heurigen-Hinterzimmer-Inventur',
    body: 'A village tasting committee counts the cellar twice and gets a different result each time. The disputed bottles are moved to a sealed palette.',
    bodyDe: 'Ein dörfliches Verkostungskomitee zählt den Keller zweimal und erhält jedes Mal ein anderes Ergebnis. Die strittigen Flaschen wandern in eine versiegelte Palette.',
    shortDescription: 'Wine-cellar parody', shortDescriptionDe: 'Weinkeller-Parodie'
  },
  {
    id: 'parody:electronics:chatlog', theme: 'electronics',
    title: 'Chatprotokoll-Leak: 47 iPhones Seized', titleDe: 'Chatprotokoll-Leak: 47 iPhones beschlagnahmt',
    body: 'A fictional committee orders one phone for every group chat, plus backups for the chats about the other chats. All 47 devices arrive with notifications muted.',
    bodyDe: 'Ein erfundenes Komitee bestellt ein Handy für jeden Gruppenchat sowie Reservegeräte für die Chats über die anderen Chats. Alle 47 Geräte kommen stummgeschaltet an.',
    shortDescription: 'Group-chat parody', shortDescriptionDe: 'Gruppenchat-Parodie'
  },
  {
    id: 'parody:tools:ballhausplatz', theme: 'tools',
    title: 'The Ballhausplatz Office Liquidation', titleDe: 'Die Ballhausplatz-Büroauflösung',
    body: 'A fictional ministry replaces every screwdriver with a consultancy report. The abandoned tool cupboards are bundled into one remarkably practical lot.',
    bodyDe: 'Ein erfundenes Ministerium ersetzt jeden Schraubenzieher durch ein Beratungspapier. Die verlassenen Werkzeugschränke werden zu einem erstaunlich praktischen Los gebündelt.',
    shortDescription: 'Ministry-office parody', shortDescriptionDe: 'Ministeriumsbüro-Parodie'
  },
  {
    id: 'parody:jewellery:opera', theme: 'jewellery',
    title: 'Vienna Opera Cloakroom Confiscation', titleDe: 'Wiener Operngarderoben-Beschlagnahme',
    body: 'After a fictional gala, the cloakroom contains more cufflinks than coats and one tiara ticket numbered 404. The unclaimed valuables form this sealed lot.',
    bodyDe: 'Nach einer erfundenen Gala liegen in der Garderobe mehr Manschettenknöpfe als Mäntel und ein Diademschein mit der Nummer 404. Die Fundsachen bilden dieses versiegelte Los.',
    shortDescription: 'Opera-night parody', shortDescriptionDe: 'Opernabend-Parodie'
  },
  {
    id: 'parody:collectibles:schnitzel', theme: 'collectibles',
    title: 'The Schnitzel Cartel Evidence Room', titleDe: 'Die Asservatenkammer des Schnitzelkartells',
    body: 'A completely imaginary breading syndicate hoards commemorative plates, tiny golden cutlets and one extremely rare gravy stamp.',
    bodyDe: 'Ein vollkommen erfundenes Panier-Syndikat hortet Sammelteller, winzige goldene Schnitzel und eine äußerst seltene Saftl-Briefmarke.',
    shortDescription: 'Culinary-cartel parody', shortDescriptionDe: 'Küchenkartell-Parodie'
  },
  {
    id: 'parody:sport:skiwax', theme: 'sport',
    title: 'Alpine Ski-Wax Task Force', titleDe: 'Alpine Skiwachs-Sonderkommission',
    body: 'A fictional task force raids the wrong wax cabin and discovers racing skis, exercise bikes and enough goggles for a small parliament.',
    bodyDe: 'Eine erfundene Sonderkommission durchsucht die falsche Wachshütte und entdeckt Rennski, Ergometer und genug Skibrillen für ein kleines Parlament.',
    shortDescription: 'Winter-sport parody', shortDescriptionDe: 'Wintersport-Parodie'
  },
  {
    id: 'parody:home:signa', theme: 'home',
    title: 'Signa Office Clearance', titleDe: 'Signa-Büroauflösung',
    body: 'An extravagant office clearance offers marble side tables, twelve presentation screens and a model tower that is somehow still waiting for a permit.',
    bodyDe: 'Eine extravagante Büroauflösung bietet Marmortische, zwölf Präsentationsbildschirme und einen Modellturm, der irgendwie noch immer auf seine Genehmigung wartet.',
    shortDescription: 'Property-office parody', shortDescriptionDe: 'Immobilienbüro-Parodie'
  }
].map(entry => ({ ...entry, fictional: true, parody: true }));

const rawPool = [...generatedStories, ...parodyStories];
const requiredText = ['title', 'titleDe', 'body', 'bodyDe', 'shortDescription', 'shortDescriptionDe'];
if (rawPool.length !== 100 || rawPool.filter(story => story.parody).length !== 10
  || new Set(rawPool.map(story => story.id)).size !== rawPool.length
  || rawPool.some(story => story.fictional !== true || !THEMES[story.theme]
    || requiredText.some(field => typeof story[field] !== 'string' || !story[field].trim()))) {
  throw new Error('invalid_palette_story_pool');
}

export const PALETTE_STORY_POOL = Object.freeze(rawPool.map(story => Object.freeze(story)));
export const PALETTE_STORY_THEMES = Object.freeze(Object.keys(THEMES));

const THEME_BY_PALETTE = Object.freeze({
  fundkiste: 'mixed', schatzkiste: 'premium', cars: 'vehicles', wine: 'wine',
  electronics: 'electronics', tools: 'tools', jewellery: 'jewellery', collectibles: 'collectibles',
  'electronics-smuggling': 'electronics', 'dealer-seizure': 'premium', 'wine-tax-seizure': 'wine'
});

export function paletteStoryTheme(payload) {
  return THEME_BY_PALETTE[payload?.paletteId]
    || ({ cars: 'vehicles', mixed: 'mixed', premium: 'premium', wine: 'wine', electronics: 'electronics',
      tools: 'tools', jewellery: 'jewellery', collectibles: 'collectibles' })[payload?.legacyTheme]
    || 'mixed';
}

export function paletteStoryForAuction(payload, requestId) {
  const theme = paletteStoryTheme(payload);
  const candidates = PALETTE_STORY_POOL.filter(story => story.theme === theme);
  const digest = createHash('sha256')
    .update(JSON.stringify([String(requestId), payload?.paletteId || null, payload?.definitionVersion || null]))
    .digest('hex');
  const selected = candidates[parseInt(digest.slice(0, 8), 16) % candidates.length];
  const { title, titleDe, body, bodyDe, shortDescription, shortDescriptionDe, fictional, parody } = selected;
  return Object.freeze({ title, titleDe, body, bodyDe, shortDescription, shortDescriptionDe, fictional, parody });
}
