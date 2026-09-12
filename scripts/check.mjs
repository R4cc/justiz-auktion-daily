import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['server.mjs', 'src', 'scripts', 'dist/app.js', 'dist/higher-lower.js', 'dist/account.js', 'test'];
const files = [];
function visit(target) {
  const details = readdirSync(target, { withFileTypes: true });
  for (const entry of details) {
    const filename = path.join(target, entry.name);
    if (entry.isDirectory()) visit(filename);
    else if (/\.(?:m?js)$/.test(entry.name)) files.push(filename);
  }
}
for (const root of roots) {
  if (/\.m?js$/.test(root)) files.push(root);
  else visit(root);
}
for (const filename of files) {
  const result = spawnSync(process.execPath, ['--check', filename], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
JSON.parse(readFileSync('package.json', 'utf8'));
JSON.parse(readFileSync('seed/auctions.json', 'utf8'));
console.log(`Checked ${files.length} JavaScript files and project JSON.`);
