import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

test('production module build hashes its loader and legacy assets without editing authored files',async()=>{
  const source=await readFile('dist/index.html','utf8');
  const result=spawnSync(process.execPath,['scripts/build-web.mjs'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(await readFile('dist/index.html','utf8'),source);
  const html=await readFile('web-build/index.html','utf8');
  const loader=html.match(/data-module="\/(loader-[\w-]+\.js)"/);
  assert.ok(loader,'built HTML references the hashed ES module');
  const code=await readFile('web-build/'+loader[1],'utf8');assert.match(code,/createPageAssets/);
  for(const match of html.matchAll(/(?:src|href|data-src|data-href)="(\/[^"?]+\.(?:js|css))\?v=([a-f0-9]+)"/g)){
    const body=await readFile('web-build'+match[1]);
    assert.equal(match[2],createHash('sha256').update(body).digest('hex').slice(0,12),match[1]);
  }
});
