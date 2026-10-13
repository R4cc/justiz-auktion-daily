import { writeFile } from 'node:fs/promises';

// The complete HTML named-character table, including legacy semicolonless names.
// This is a development-time update; production reads the bundled data offline.
const response = await fetch('https://html.spec.whatwg.org/entities.json');
if (!response.ok) throw new Error(`Entity table download failed: ${response.status}`);
const source = await response.json();
const entries = Object.entries(source).sort(([a], [b]) => a.localeCompare(b, 'en'));
if (entries.length < 2200 || source['&lpar;']?.characters !== '(') throw new Error('Invalid HTML entity table');
const table = Object.fromEntries(entries.map(([name, value]) => [name.slice(1), value.characters]));
await writeFile(new URL('../src/html-entities.json', import.meta.url), JSON.stringify(table) + '\n');
console.log(`Generated ${entries.length} HTML character references.`);
