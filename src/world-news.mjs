import { getState, setState, withDatabase } from './database.mjs';
import { getNewsEvent, saveNewsEvent } from './news.mjs';
import { AccountError } from './errors.mjs';

export const WORLD_NEWS_PERIOD_MS = 12 * 3600_000;
export const WORLD_SCENARIOS = [
  ['electronics-smuggling', 'electronics', 'down', 7, 'electronics-smuggling',
    'A container full of surprises', 'Ein Container voller Überraschungen',
    'In fictional Grayfield, customs seize a misdeclared electronics shipment. Extra supply puts pressure on electronics prices.',
    'Im fiktiven Grayfield beschlagnahmt der Zoll eine falsch deklarierte Elektroniklieferung. Das zusätzliche Angebot drückt die Preise.'],
  ['dealer-seizure', 'vehicles', 'down', 8, 'dealer-seizure',
    'The Kanalley yard opens', 'Der Kanalley-Hof öffnet',
    'The invented Kanalley dealership liquidation brings more vehicles into the game world. Buyers have more choice.',
    'Die fiktive Auflösung des erfundenen Autohauses Kanalley bringt mehr Fahrzeuge in die Spielwelt. Käufer haben mehr Auswahl.'],
  ['wine-tax', 'wine', 'down', 6, 'wine-tax-seizure',
    'The untaxed cellars', 'Die unversteuerten Keller',
    'In fictional Weißbrunn, an invented tax case releases a cellar of wine. Local game-world wine prices soften.',
    'Im fiktiven Weißbrunn gibt ein erfundener Steuerfall einen Weinkeller frei. Die Weinpreise in der Spielwelt geben nach.'],
  ['chip-shortage', 'electronics', 'up', 7, null,
    'A slow week at the chip works', 'Eine langsame Woche im Chipwerk',
    'The imaginary Tannbach chip works pauses production. Electronics buyers compete for fewer devices.',
    'Das erfundene Tannbacher Chipwerk pausiert die Produktion. Elektronikkäufer konkurrieren um weniger Geräte.'],
  ['poor-harvest', 'wine', 'up', 8, null,
    'A smaller harvest in Rosenau', 'Kleinere Ernte in Rosenau',
    'Fictional Rosenau reports a small grape harvest. Wine collectors become more eager to buy.',
    'Das fiktive Rosenau meldet eine kleine Traubenernte. Weinsammler werden kauffreudiger.'],
  ['collector-trend', 'collectibles', 'up', 6, null,
    'Attic treasures take the stage', 'Dachbodenschätze im Rampenlicht',
    'A fictional collecting fair in Kirschau sparks fresh interest in models and keepsakes.',
    'Eine fiktive Sammlermesse in Kirschau weckt neues Interesse an Modellen und Erinnerungsstücken.'],
  ['workshop', 'tools', 'down', 9, null,
    'The Brackwald workshop clearance', 'Die Brackwalder Werkstatträumung',
    'An invented workshop releases its remaining tools. The game-world tool market gets a little more crowded.',
    'Eine erfundene Werkstatt gibt ihre verbliebenen Werkzeuge frei. Das Werkzeugangebot in der Spielwelt wächst.'],
  ['cycling', 'bicycles', 'up', 5, null,
    'Nordhafen takes to two wheels', 'Nordhafen steigt aufs Rad',
    'A fictional cycling festival makes bicycles the most discussed finds in Nordhafen this week.',
    'Ein fiktives Radfestival macht Fahrräder diese Woche zu gefragten Funden in Nordhafen.'],
  ['jewellery', 'watches_jewelry', 'down', 6, null,
    'Silberbruch clears its display cases', 'Silberbruch räumt die Vitrinen',
    'An imaginary exhibition sale puts more watches and jewellery on the market.',
    'Ein erfundener Ausstellungsverkauf bringt mehr Uhren und Schmuck auf den Markt.'],
  ['reading', 'books_media', 'up', 5, null,
    'The long reading weekend', 'Das lange Lesewochenende',
    'A fictional book festival in Bauthaven brings new buyers to books and media.',
    'Ein fiktives Buchfestival in Bauthaven bringt neue Käufer für Bücher und Medien.']
].map(([id, category, direction, magnitude, paletteId, title, titleDe, body, bodyDe]) =>
  ({ id, title, titleDe, body, bodyDe, paletteId, marketEffects: [{ category, direction, magnitude }] }));

export function tickWorldNews(dataDir, { now = Date.now() } = {}) {
  const bucket = Math.floor(now / WORLD_NEWS_PERIOD_MS), id = `world-news-${bucket}`, key = `world-news-bucket:${bucket}`;
  const existing = getNewsEvent(dataDir, id);
  if (existing) return { id: existing.id, status: 'published' };
  if (withDatabase(dataDir, db => getState(db, key, null))) return { status: 'skipped' };
  // Current bucket only; downtime never produces a news backfill. Try every
  // scenario once in deterministic order without weakening publication budget.
  for (let offset = 0; offset < WORLD_SCENARIOS.length; offset++) {
    const scenario = WORLD_SCENARIOS[(bucket + offset) % WORLD_SCENARIOS.length];
    try {
      saveNewsEvent(dataDir, { id, title: scenario.title, body: scenario.body, status: 'published',
        marketEffects: scenario.marketEffects, paletteIds: scenario.paletteId ? [scenario.paletteId] : [],
        paletteWindows: scenario.paletteId ? [{ paletteId: scenario.paletteId, startOffsetHours: 0, durationHours: 48 }] : [],
        metadata: { fictional: true, automatic: true, scenarioId: scenario.id, titleDe: scenario.titleDe, bodyDe: scenario.bodyDe }
      }, { now });
      return { id, status: 'published' };
    } catch (error) {
      // Another process may have published this bucket since our read. Its
      // publication receipt is authoritative even if its fallback differs.
      if (error instanceof AccountError && error.message === 'news_already_published') return { id, status: 'published' };
      if (!(error instanceof AccountError) || error.message !== 'market_effect_budget') throw error;
    }
  }
  withDatabase(dataDir, db => setState(db, key, { skippedAt: now }, new Date(now).toISOString()));
  return { status: 'skipped' };
}
