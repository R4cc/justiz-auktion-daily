// Keep authored classic scripts compatible while introducing built ES modules.
import { cp, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'web-build');
if(path.dirname(output)!==root||path.basename(output)!=='web-build')throw new Error('Invalid build directory');
await rm(output,{recursive:true,force:true});
await cp(path.join(root,'dist'),output,{recursive:true});
await build({configFile:false,root,publicDir:false,build:{outDir:output,emptyOutDir:false,manifest:true,
  lib:{entry:path.join(root,'dist/modules/page-assets.js'),formats:['es'],fileName:'loader-[hash]'}}});
const manifest=JSON.parse(await readFile(path.join(output,'.vite/manifest.json'),'utf8'));
const entry=Object.values(manifest).find(entry=>entry.isEntry);
let html=await readFile(path.join(output,'index.html'),'utf8');
// Generate cache versions from content for legacy scripts and styles as well.
const urls=[...new Set([...html.matchAll(/(?:src|href|data-src|data-href)="(\/[^"?]+\.(?:js|css))\?v=[^"]+"/g)].map(match=>match[1]))];
for(const url of urls){
  const hash=createHash('sha256').update(await readFile(path.join(output,url.slice(1)))).digest('hex').slice(0,12);
  html=html.replaceAll(new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\?v=[^" ]+','g'),url+'?v='+hash);
}
html=html.replace(/(<script src="\/page-assets.js[^">]+")/,`$1 data-module="/${entry.file}"`);
await writeFile(path.join(output,'index.html'),html);
console.log('Built browser assets in web-build/');
