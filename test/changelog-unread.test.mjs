import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../dist/changelog-ui.js',import.meta.url),'utf8');
function page({code=source,storage=new Map(),blocked=false,failRender=false}={}){
  let refreshes=0;const events=new Map(),window={updateNavigation(){refreshes++;},addEventListener(name,fn){events.set(name,fn);}};
  const content={innerHTML:''};
  vm.runInNewContext(code,{window,accountContent:content,accountEscape:value=>{if(failRender)throw new Error('render_failed');return String(value);},t:en=>en,
    localStorage:{getItem:key=>{if(blocked)throw new Error('blocked');return storage.get(key)??null;},setItem:(key,value)=>{if(blocked)throw new Error('blocked');storage.set(key,value);}}});
  return {ui:window.changelogUi,content,storage,refreshes:()=>refreshes,storageChanged:()=>events.get('storage')({key:'jg:changelog-seen'})};
}
test('new entries stay unread until rendered and remain read across reloads',()=>{
  const first=page();assert.equal(first.ui.hasUnread(),true);assert.equal(first.refreshes(),1);
  first.ui.render();assert.match(first.content.innerHTML,/Store Upgrades/);assert.equal(first.ui.hasUnread(),false);
  assert.equal(first.storage.size,1);assert.equal(page({storage:first.storage}).ui.hasUnread(),false);
});
test('an added entry on the same day restores NEW and replaces the saved revision',()=>{
  const first=page();first.ui.render();
  const entry={date:'2026-10-20',title:'Another update today',en:'Example',de:'Beispiel'};
  const code=source.replace('const entries = [',`const entries = [${JSON.stringify(entry)},`);
  const update=page({code,storage:first.storage});assert.equal(update.ui.hasUnread(),true);
  update.ui.render();assert.equal(update.ui.hasUnread(),false);assert.equal(update.storage.size,1);
  assert.equal(page({code,storage:update.storage}).ui.hasUnread(),false);
});
test('storage restrictions preserve session dismissal and failed rendering does not mark entries read',()=>{
  const restricted=page({blocked:true});assert.equal(restricted.ui.hasUnread(),true);restricted.ui.render();assert.equal(restricted.ui.hasUnread(),false);
  const failed=page({failRender:true});assert.throws(()=>failed.ui.render(),/render_failed/);assert.equal(failed.ui.hasUnread(),true);
});
test('reading in another tab refreshes navigation and acknowledges its matching revision',()=>{
  const storage=new Map(),first=page({storage}),other=page({storage});other.ui.render();
  first.storageChanged();assert.equal(first.refreshes(),2);assert.equal(first.ui.hasUnread(),false);
});
