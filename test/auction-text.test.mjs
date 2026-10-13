import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import named from '../src/html-entities.json' with { type: 'json' };
import { decodeHtmlEntities, repairLegacyAuctionText } from '../src/html-text.mjs';
import { parseAuctionPage, extractListingUrls } from '../src/collector.mjs';
import { Accounts } from '../src/accounts.mjs';
import { closeDataStore, readArchive, upsertAuctions, saveDailyGame, readDailyGames, DATABASE_FILENAME, transaction } from '../src/database.mjs';
import { repairSavedAuctionText } from '../src/auction-text-migration.mjs';
import path from 'node:path';

const url='https://www.justiz-auktion.de/Item-300001';
const page=(title,description,heading=true)=>`<title>${title} &lpar;#300001&rpar; | Justiz-Auktion</title>${heading ? `<h2 class="auktionstitel">${title}</h2>` : ''}<p>Auktion ID 300001</p><p>Startgebot: 5,00 €</p><h3>Artikelbeschreibung</h3><p>${description}</p><h3>Details</h3>`;

test('all 2231 standard HTML named references decode, including names with digits and multiple code points',()=>{
  assert.equal(Object.keys(named).length,2231);
  for(const [name,characters] of Object.entries(named)) assert.equal(decodeHtmlEntities('&'+name),characters,name);
  assert.equal(decodeHtmlEntities('&lpar;A&rpar; &lsqb;x&rsqb; &lcub;y&rcub; &plus; &equals; &num; &percnt; &commat; &bsol;'),'(A) [x] {y} + = # % @ \\');
  assert.equal(decodeHtmlEntities('&auml; &Auml; &ouml; &Ouml; &euro; &trade; &frac12; &NotEqualTilde; &Ascr;'),'ä Ä ö Ö € ™ ½ ≂̸ 𝒜');
});

test('numeric references cover Unicode scalars, standard C1 replacements and malformed values without throwing',()=>{
  assert.equal(decodeHtmlEntities('&#40;&#x29; &#x1F600; &#128; &#x2014;'), '() 😀 € —');
  assert.equal(decodeHtmlEntities('&#0; &#xD800; &#xDFFF; &#x110000; &#9999999999999999999999999999999999999;'), '� � � � �');
  for(const point of [1,0x7f,0xa0,0x100,0xd7ff,0xe000,0xffff,0x10000,0x10ffff]) assert.equal(decodeHtmlEntities(`&#${point};`),String.fromCodePoint(point));
  assert.equal(decodeHtmlEntities('&#; &#x; &#xnope; &DefinitelyUnknown;'),'&#; &#x; &#xnope; &DefinitelyUnknown;');
  assert.equal(decodeHtmlEntities('文字 (Ä) 😀 \\ / [x] {y} | @ # % + = < 3 > 1'), '文字 (Ä) 😀 \\ / [x] {y} | @ # % + = < 3 > 1');
});

test('character references decode once and use correct case and attribute boundaries',()=>{
  assert.equal(decodeHtmlEntities('&amp;lpar; &amp;lt; &amp;amp;'), '&lpar; &lt; &amp;');
  assert.equal(decodeHtmlEntities('&notin; &notit; &copy &#40 &#x29'),'∉ ¬it; © ( )');
  assert.equal(decodeHtmlEntities('&AuMl; &EURO;'), '&AuMl; &EURO;');
  assert.equal(decodeHtmlEntities('?a=1&copy=2&notit=3&copy;=4',{attribute:true}), '?a=1&copy=2&notit=3©=4');
  assert.equal(extractListingUrls('<a href="/Item-300001?a=1&copy=2&amp;b=3">Item</a>')[0],url+'?a=1&copy=2&b=3');
});

test('collector preserves punctuation, Unicode and encoded angle-bracket text while removing real HTML',()=>{
  const title='Werkzeug &lpar;Serie #123&rpar; &plus; &frac12; &lt;Modell&gt; &quot;Ä&quot; &#x1F600;';
  const description='&lsqb;Test&rsqb; &lcub;OK&rcub; 2 &lt; 3 &amp; 5 &gt; 4. &lt;script&gt;literal&lt;/script&gt; <strong>Zubehör</strong> <script>bad()</script><style>bad{}</style>文字 👩🏽‍🔧';
  const auction=parseAuctionPage(page(title,description),url);
  assert.equal(auction.title,'Werkzeug (Serie #123) + ½ <Modell> "Ä" 😀');
  assert.equal(auction.description,'[Test] {OK} 2 < 3 & 5 > 4. <script>literal</script> Zubehör 文字 👩🏽‍🔧');
  assert.equal(parseAuctionPage(page('Model (#123) (Edition)','Good',false),url).title,'Model (#123) (Edition)');
  assert.equal(parseAuctionPage(page('&amp;lpar; &amp;lt;','&amp;amp;',false),url).title,'&lpar; &lt;');
  assert.equal(parseAuctionPage(page('A','Compare 2 < 3 > 1'),url).description,'Compare 2 < 3 > 1');
});

test('description length limits never split a Unicode surrogate pair',()=>{
  const auction=parseAuctionPage(page('Item','x'.repeat(1799)+'😀tail'),url);
  assert.equal(auction.description,'x'.repeat(1799)+'😀');
  assert.equal([...auction.description].length,1800);
});

test('legacy repair preserves already-decoded literal references and changes only previously unsupported names',()=>{
  assert.equal(repairLegacyAuctionText('&copy &#40 &#x1F600 &ampnext'), '© ( 😀 &next');
  assert.equal(repairLegacyAuctionText('&lpar;A&rpar; &frac12; &NotEqualTilde; &amp; &lt; &#40; &unknown;'), '(A) ½ ≂̸ &amp; &lt; &#40; &unknown;');
});

test('startup repairs saved auction titles and descriptions across archive, Daily, inventory and frozen rewards exactly once',async t=>{
  const dir=await mkdtemp('/tmp/jg-auction-text-');
  t.after(async()=>{closeDataStore(dir);await rm(dir,{recursive:true,force:true});});
  const accounts=new Accounts(dir);
  const item={auctionId:300001,title:'Drill &lpar;Pro&rpar; &plus; &frac12;',description:'&lsqb;OK&rsqb; &NotEqualTilde; &amp;',price:125,id:'owned',image:'https://example.test/image?a=1&lpar;=2'};
  const auction={...item,id:300001,correctPrice:125,currentBid:125};
  upsertAuctions(dir,[auction]);saveDailyGame(dir,{date:'2026-10-13',gameNumber:286,generatedAt:'2026-10-13T00:00:00Z',auctions:[auction]});
  const nested={items:[{item,inventoryIds:['literal&lpar;id'],quantity:7}],price:125,requestId:'request&lpar;',username:'user&lpar;'};
  accounts.db(db=>{
    db.prepare("INSERT INTO users(id,username,password_hash,tokens,created_at) VALUES('player','user&lpar;','disabled',100,1)").run();
    db.prepare('INSERT INTO inventory(id,user_id,item,created_at) VALUES(?,?,?,?)').run('owned','player',JSON.stringify(item),1);
    db.prepare('INSERT INTO account_games(id,user_id,date,mode,payload) VALUES(?,?,?,?,?)').run('run','player','2026-10-13','daily',JSON.stringify({auctions:[auction],answers:[{score:1000,actualBid:125}]}));
    db.prepare('INSERT INTO case_openings(user_id,request_id,case_id,item) VALUES(?,?,?,?)').run('player','request','box',JSON.stringify(item));
    db.exec('CREATE TABLE IF NOT EXISTS sealed_cases(inventory_id TEXT PRIMARY KEY,reward TEXT NOT NULL,opened_at INTEGER) STRICT');
    db.prepare('INSERT INTO sealed_cases VALUES(?,?,NULL)').run('owned',JSON.stringify(item));
    db.exec('CREATE TABLE IF NOT EXISTS stock_palette_editions(date TEXT PRIMARY KEY,payload TEXT NOT NULL) STRICT');
    db.prepare('INSERT INTO stock_palette_editions VALUES(?,?)').run('2026-10-13',JSON.stringify(nested));
    db.prepare("DELETE FROM app_state WHERE key='auction_text_entities_v1'").run();
  });
  closeDataStore(dir);
  const saved=readArchive(dir).auctions[0];
  assert.equal(saved.title,'Drill (Pro) + ½');assert.equal(saved.description,'[OK] ≂̸ &amp;');assert.equal(saved.correctPrice,125);assert.equal(saved.image,item.image);
  assert.equal(readDailyGames(dir).games['2026-10-13'].auctions[0].title,saved.title);
  accounts.db(db=>{
    assert.equal(db.prepare('SELECT title FROM auctions WHERE id=300001').get().title,saved.title);
    assert.equal(db.prepare("SELECT tokens,username FROM users WHERE id='player'").get().tokens,100);
    assert.equal(db.prepare("SELECT username FROM users WHERE id='player'").get().username,'user&lpar;');
    for(const [table,column] of [['inventory','item'],['sealed_cases','reward'],['case_openings','item']]) assert.equal(JSON.parse(db.prepare(`SELECT ${column} AS json FROM ${table}`).get().json).title,saved.title);
    const run=JSON.parse(db.prepare('SELECT payload FROM account_games').get().payload);assert.equal(run.auctions[0].title,saved.title);assert.equal(run.answers[0].score,1000);
    const pool=JSON.parse(db.prepare('SELECT payload FROM stock_palette_editions').get().payload);
    assert.equal(pool.items[0].item.title,saved.title);assert.equal(pool.items[0].quantity,7);assert.equal(pool.items[0].inventoryIds[0],'literal&lpar;id');assert.equal(pool.requestId,nested.requestId);
    assert.ok(JSON.parse(db.prepare("SELECT value_json FROM app_state WHERE key='auction_text_entities_v1'").get().value_json).updated>=6);
  });
  const fresh=parseAuctionPage(page('&amp;lpar;','&amp;lt;code&amp;gt;'),url);
  upsertAuctions(dir,[{...fresh,id:300002}]);closeDataStore(dir);
  assert.equal(readArchive(dir).auctions.find(row=>row.id===300002).title,'&lpar;');
  assert.equal(readArchive(dir).auctions.find(row=>row.id===300002).description,'&lt;code&gt;');
});

test('saved text repair is atomic when a table rejects an update',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE auctions(id INTEGER PRIMARY KEY,title TEXT,payload_json TEXT); CREATE TABLE inventory(id TEXT,item TEXT);');
    db.prepare('INSERT INTO auctions VALUES(?,?,?)').run(1,'A &lpar;x&rpar;',JSON.stringify({title:'A &lpar;x&rpar;'}));
    db.prepare('INSERT INTO inventory VALUES(?,?)').run('i',JSON.stringify({title:'B &lpar;y&rpar;'}));
    db.exec("CREATE TRIGGER block_fix BEFORE UPDATE ON inventory BEGIN SELECT RAISE(ABORT,'blocked'); END");
    assert.throws(()=>transaction(db,()=>repairSavedAuctionText(db)),/blocked/);
    assert.equal(db.prepare('SELECT title FROM auctions').get().title,'A &lpar;x&rpar;');
  } finally {db.close();}
});
