import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, writeFile, stat, rm } from 'node:fs/promises';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { sendStaticFile } from '../src/static-files.mjs';

async function fixture(t) {
  const dir = await mkdtemp('/tmp/jg-static-response-'), filename = dir+'/asset.js';
  const body = 'const example = "A public static asset with repeated content";\n'.repeat(1000);
  await writeFile(filename, body);
  const server = createServer(async (req,res) => {
    try { await sendStaticFile(req,res,filename,await stat(filename),{
      'content-type':req.url==='/font'?'font/woff2':'application/javascript',
      'cache-control':'public, max-age=31536000, immutable','x-content-type-options':'nosniff'
    }); } catch {res.writeHead(500);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const get = (headers={},method='GET',path='/') => new Promise((resolve,reject) => {
    const req=request({hostname:'127.0.0.1',port:server.address().port,path,method,headers},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
    }); req.on('error',reject);req.end();
  });
  return {body,filename,get};
}

test('static Brotli and gzip responses decode exactly and honor encoding preferences',async t=>{
  const f=await fixture(t);
  for(const [accept,encoding,decode] of [['br, gzip','br',brotliDecompressSync],['br;q=.2, gzip;q=.8','gzip',gunzipSync]]){
    const response=await f.get({'accept-encoding':accept});
    assert.equal(response.status,200);assert.equal(response.headers['content-encoding'],encoding);
    assert.equal(response.headers.vary,'Accept-Encoding');assert.equal(decode(response.body).toString(),f.body);
    assert.equal(Number(response.headers['content-length']),response.body.length);assert.ok(response.body.length<f.body.length/5);
    assert.equal(response.headers['x-content-type-options'],'nosniff');
  }
  for(const accept of ['', 'br;q=0, gzip;q=0']){
    const response=await f.get({'accept-encoding':accept});assert.equal(response.headers['content-encoding'],undefined);assert.equal(response.body.toString(),f.body);
  }
});

test('HEAD and conditional requests preserve cache/security headers without response bodies',async t=>{
  const f=await fixture(t),get=await f.get({'accept-encoding':'br'}),head=await f.get({'accept-encoding':'br'},'HEAD');
  assert.equal(head.status,200);assert.equal(head.body.length,0);assert.equal(head.headers['content-length'],get.headers['content-length']);
  assert.equal(head.headers.etag,get.headers.etag);
  const notModified=await f.get({'accept-encoding':'br','if-none-match':get.headers.etag});
  assert.equal(notModified.status,304);assert.equal(notModified.body.length,0);
  assert.equal(notModified.headers['cache-control'],get.headers['cache-control']);assert.equal(notModified.headers.vary,'Accept-Encoding');
  const otherEncoding=await f.get({'accept-encoding':'gzip','if-none-match':get.headers.etag});assert.equal(otherEncoding.status,304);
});

test('file changes invalidate cached compressed bodies and validators',async t=>{
  const f=await fixture(t),before=await f.get({'accept-encoding':'br'}),updated=f.body+'console.log("updated");';
  await writeFile(f.filename,updated);
  const after=await f.get({'accept-encoding':'br','if-none-match':before.headers.etag});
  assert.equal(after.status,200);assert.notEqual(after.headers.etag,before.headers.etag);assert.equal(brotliDecompressSync(after.body).toString(),updated);
});

test('already compressed font responses are streamed without extra content encoding',async t=>{
  const f=await fixture(t),response=await f.get({'accept-encoding':'br,gzip'},'GET','/font');
  assert.equal(response.headers['content-encoding'],undefined);assert.equal(response.body.toString(),f.body);
});
