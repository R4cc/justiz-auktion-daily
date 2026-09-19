import { createHash } from 'node:crypto';

const CATEGORIES = ['electronics', 'vehicles', 'wine', 'watches_jewelry', 'tools', 'collectibles',
  'household', 'luxury_goods', 'bicycles', 'books_media', 'fashion', 'cosmetics',
  'sport_leisure', 'other'];
const GERMAN_FIRST_NAMES = [
  'Anna', 'Anton', 'Barbara', 'Benedikt', 'Carina', 'Christoph', 'Daniela', 'David', 'Elisabeth', 'Emilia',
  'Felix', 'Florian', 'Franz', 'Franziska', 'Georg', 'Hannah', 'Helena', 'Jakob', 'Johanna', 'Jonas',
  'Katharina', 'Klara', 'Konrad', 'Laura', 'Leon', 'Leopold', 'Lukas', 'Magdalena', 'Marie', 'Martin',
  'Matthias', 'Maximilian', 'Miriam', 'Moritz', 'Nina', 'Paul', 'Philipp', 'Sophie', 'Stefan', 'Theresa'
];
const GERMAN_SURNAMES = [
  'Aigner', 'Albrecht', 'Bachler', 'Bauer', 'Baumgartner', 'Berger', 'Binder', 'Brandner', 'Brunner', 'Eder',
  'Egger', 'Fink', 'Fischer', 'Forster', 'Frank', 'Friedrich', 'Fuchs', 'Graf', 'Gruber', 'Haas',
  'Haider', 'Hartmann', 'Hofer', 'Holzer', 'Huber', 'Jäger', 'Kaiser', 'Kern', 'Koller', 'König',
  'Kraus', 'Lechner', 'Lehner', 'Leitner', 'Maier', 'Maurer', 'Mayer', 'Moser', 'Müller', 'Neubauer',
  'Pichler', 'Reiter', 'Roth', 'Schmid', 'Schneider', 'Schuster', 'Schwarz', 'Seidl', 'Steiner', 'Wagner'
];
const EUROPEAN_FIRST_NAMES = [
  'Alessia', 'Amélie', 'Arthur', 'Beatriz', 'Camille', 'Chiara', 'Daan', 'Elena', 'Elliot', 'Freja',
  'George', 'Hugo', 'Isla', 'Jasper', 'Liam', 'Luca', 'Maja', 'Noah', 'Olivia', 'Sofia'
];
const EUROPEAN_SURNAMES = [
  'Andersen', 'Bennett', 'Bianchi', 'Costa', 'De Vries', 'Dubois', 'Eriksen', 'Fletcher', 'Garcia', 'Hughes',
  'Ivanov', 'Jansen', 'Kowalski', 'Laurent', 'Moretti', 'Novak', 'Petrov', 'Rossi', 'Svensson', 'Wilson'
];

const unit = key => createHash('sha256').update(key).digest().readUInt32BE(0) / 2 ** 32;
const rounded = value => Math.round(value * 1000) / 1000;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function profile({ id, username, region = 'at-de', categories, willingness, aggressiveness,
  cheapness, patience, collector = false, delaySeconds, flavor = '' }) {
  const stats = { aggressiveness: rounded(aggressiveness), cheapness: rounded(cheapness), patience: rounded(patience) };
  const delay = delaySeconds ?? Math.round(clamp(28 + stats.patience * 68 - stats.aggressiveness * 18, 20, 90));
  return Object.freeze({ id, username, region, categories: Object.freeze([...categories]),
    willingness: rounded(willingness), delaySeconds: delay, collector, flavor, ...stats });
}

const LEGACY_NPCS = [
  ['mira', 'Mira Fund', ['electronics', 'household'], 1.00, .55, .66, .38, 45],
  ['oskar', 'Oskar Werk', ['tools', 'bicycles'], .97, .72, .52, .44, 60],
  ['lena', 'Lena Keller', ['wine'], 1.06, .31, .84, .88, 90],
  ['bruno', 'Bruno Motor', ['vehicles'], 1.02, .81, .28, .42, 75],
  ['ida', 'Ida Silber', ['watches_jewelry', 'luxury_goods'], 1.04, .64, .37, .62, 60],
  ['theo', 'Theo Sammler', ['collectibles', 'books_media'], 1.12, .42, .74, .91, 90, true],
  ['nora', 'Nora Atelier', ['fashion', 'cosmetics'], .98, .58, .45, .52, 45],
  ['emil', 'Emil Garten', ['household', 'tools'], .95, .36, .88, .81, 75],
  ['alma', 'Alma Sport', ['sport_leisure', 'bicycles'], 1.02, .76, .32, .41, 60],
  ['finn', 'Finn Flohmarkt', ['other', 'books_media'], .92, .24, .94, .87, 90],
  ['rosa', 'Rosa Rarität', ['collectibles', 'wine'], 1.03, .49, .69, .77, 45],
  ['paul', 'Paul Fundus', ['electronics', 'vehicles'], .96, .68, .41, .48, 75]
].map(([id, username, categories, willingness, aggressiveness, cheapness, patience, delaySeconds, collector = false]) =>
  profile({ id: `npc-${id}`, username, categories, willingness, aggressiveness, cheapness, patience, delaySeconds, collector }));

// Public figures are playful game characters only. Their profiles describe
// auction tactics, not real conduct or personal facts.
export const SPECIAL_NPC_BUYERS = Object.freeze([
  profile({ id: 'npc-richard-lugner', username: 'Richard Lugner', categories: ['luxury_goods', 'watches_jewelry', 'vehicles'],
    willingness: 1.15, aggressiveness: .94, cheapness: .10, patience: .18, collector: true, delaySeconds: 24,
    flavor: 'Enters loudly and treats every lot like opening night.' }),
  profile({ id: 'npc-money-boy', username: 'Money Boy', categories: ['fashion', 'luxury_goods', 'electronics'],
    willingness: 1.13, aggressiveness: .91, cheapness: .04, patience: .12, delaySeconds: 20,
    flavor: 'Drops bids fast and prefers a noticeable jump.' }),
  profile({ id: 'npc-andreas-gabalier', username: 'Andreas Gabalier', categories: ['tools', 'wine', 'sport_leisure', 'collectibles'],
    willingness: 1.08, aggressiveness: .74, cheapness: .31, patience: .63, collector: true,
    flavor: 'Stays stubborn when a favourite category appears.' }),
  profile({ id: 'npc-sebastian-kurz', username: 'Sebastian Kurz', categories: ['electronics', 'books_media', 'watches_jewelry'],
    willingness: 1.02, aggressiveness: .46, cheapness: .91, patience: .89,
    flavor: 'Keeps increments kurz and waits for the right moment.' }),
  profile({ id: 'npc-hc-strache', username: 'HC Strache', categories: ['collectibles', 'luxury_goods', 'vehicles'],
    willingness: 1.10, aggressiveness: .93, cheapness: .16, patience: .22,
    flavor: 'Returns quickly after an outbid and dislikes a quiet room.' }),
  profile({ id: 'npc-herbert-kickl', username: 'Herbert Kickl', categories: ['vehicles', 'sport_leisure', 'tools'],
    willingness: 1.08, aggressiveness: .98, cheapness: .48, patience: .14, delaySeconds: 20,
    flavor: 'Charges into competitive lots and rarely waits.' }),
  profile({ id: 'npc-alexander-van-der-bellen', username: 'Alexander Van der Bellen', categories: ['books_media', 'collectibles', 'wine'],
    willingness: 1.03, aggressiveness: .14, cheapness: .96, patience: .98, collector: true, delaySeconds: 90,
    flavor: 'Observes calmly, then adds exactly one token.' }),
  profile({ id: 'npc-karl-nehammer', username: 'Karl Nehammer', categories: ['tools', 'household', 'books_media'],
    willingness: .99, aggressiveness: .51, cheapness: .73, patience: .71,
    flavor: 'Starts cautiously but keeps returning to practical lots.' }),
  profile({ id: 'npc-rene-benko', username: 'René Benko', categories: ['luxury_goods', 'watches_jewelry', 'vehicles', 'household'],
    willingness: 1.15, aggressiveness: .89, cheapness: .07, patience: .34, collector: true,
    flavor: 'Likes premium lots and makes ambitious jumps.' }),
  profile({ id: 'npc-friedrich-merz', username: 'Friedrich Merz', categories: ['vehicles', 'luxury_goods', 'watches_jewelry', 'electronics'],
    willingness: 1.13, aggressiveness: .83, cheapness: .11, patience: .43,
    flavor: 'Prefers high-end lots and decisive bids.' })
]);

const RESERVED_NAMES = new Set([...LEGACY_NPCS, ...SPECIAL_NPC_BUYERS].map(npc => npc.username.toLocaleLowerCase('de')));

function generatedNames(firstNames, surnames, count, seed) {
  return firstNames.flatMap(first => surnames.map(last => `${first} ${last}`))
    .filter(name => !RESERVED_NAMES.has(name.toLocaleLowerCase('de')))
    .sort((a, b) => unit(`${seed}:${a}`) - unit(`${seed}:${b}`) || a.localeCompare(b, 'de'))
    .slice(0, count);
}

function generatedProfile(username, index, region) {
  const key = `npc-profile:${region}:${username}`;
  const firstCategory = Math.floor(unit(`${key}:category:1`) * CATEGORIES.length);
  let secondCategory = Math.floor(unit(`${key}:category:2`) * CATEGORIES.length);
  if (secondCategory === firstCategory) secondCategory = (secondCategory + 5) % CATEGORIES.length;
  const categories = [CATEGORIES[firstCategory], CATEGORIES[secondCategory]];
  if (unit(`${key}:category:3`) < .18) {
    let third = Math.floor(unit(`${key}:category:4`) * CATEGORIES.length);
    while (categories.includes(CATEGORIES[third])) third = (third + 1) % CATEGORIES.length;
    categories.push(CATEGORIES[third]);
  }
  return profile({ id: `npc-generated-${String(index + 1).padStart(4, '0')}`, username, region, categories,
    willingness: .90 + unit(`${key}:willingness`) * .22,
    aggressiveness: .08 + unit(`${key}:aggressiveness`) * .90,
    cheapness: .04 + unit(`${key}:cheapness`) * .94,
    patience: .05 + unit(`${key}:patience`) * .93,
    collector: unit(`${key}:collector`) < .08,
    flavor: 'A generated bidder with a stable personality.' });
}

const germanNames = generatedNames(GERMAN_FIRST_NAMES, GERMAN_SURNAMES, 618, 'at-de');
const internationalNames = generatedNames(EUROPEAN_FIRST_NAMES, EUROPEAN_SURNAMES, 160, 'international');
const generated = [...germanNames.map(name => [name, 'at-de']), ...internationalNames.map(name => [name, 'international'])]
  .map(([name, region], index) => generatedProfile(name, index, region));

// Exactly 800 stable identities: 640 German/Austrian profiles (80%) and 160
// wider European/English profiles. Stable ids protect historical bid rows.
export const NPC_BUYERS = Object.freeze([...LEGACY_NPCS, ...SPECIAL_NPC_BUYERS, ...generated]);

if (NPC_BUYERS.length !== 800 || new Set(NPC_BUYERS.map(npc => npc.id)).size !== NPC_BUYERS.length
  || new Set(NPC_BUYERS.map(npc => npc.username.toLocaleLowerCase('de'))).size !== NPC_BUYERS.length
  || NPC_BUYERS.filter(npc => npc.region === 'at-de').length !== 640) {
  throw new Error('invalid_npc_roster');
}
