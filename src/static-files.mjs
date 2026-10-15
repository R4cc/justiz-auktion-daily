import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { brotliCompress, gzip, constants } from 'node:zlib';

const brotli = promisify(brotliCompress), gzipAsync = promisify(gzip);
const cache = new Map(), MAX_CACHE_BYTES = 8 * 1024 * 1024;
let cacheBytes = 0;
function encodingFor(header = '') {
  const accepted = new Map(String(header).toLowerCase().split(',').map(part => {
    const [name, ...parameters] = part.trim().split(';');
    const q = parameters.find(value => value.trim().startsWith('q='));
    return [name, q ? Math.max(0, Math.min(1, Number(q.trim().slice(2)) || 0)) : 1];
  }));
  const quality = name => accepted.get(name) ?? accepted.get('*') ?? 0;
  if (quality('br') > 0 && quality('br') >= quality('gzip')) return 'br';
  return quality('gzip') > 0 ? 'gzip' : null;
}
async function representation(filename, details, encoding) {
  const key = `${filename}:${details.mtimeMs}:${details.size}:${encoding || 'identity'}`;
  if (cache.has(key)) {
    const body = cache.get(key); cache.delete(key); cache.set(key, body); return body;
  }
  const raw = await readFile(filename);
  const body = encoding === 'br' ? await brotli(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
    : encoding === 'gzip' ? await gzipAsync(raw) : raw;
  if (!cache.has(key)) { cache.set(key, body); cacheBytes += body.length; }
  while (cacheBytes > MAX_CACHE_BYTES || cache.size > 128) {
    const oldest = cache.keys().next().value; cacheBytes -= cache.get(oldest).length; cache.delete(oldest);
  }
  return body;
}

// Only public static files use this helper. API/session responses retain their
// separate no-store path; compressed representations share no private data.
export async function sendStaticFile(request, response, filename, details, headers) {
  const compressible = /^(?:text\/|application\/(?:javascript|json)|image\/svg\+xml)/.test(headers['content-type']);
  const encoding = compressible && details.size >= 1024 && details.size <= 2 * 1024 * 1024
    ? encodingFor(request.headers['accept-encoding']) : null;
  const etag = `W/"${details.size.toString(16)}-${details.mtimeMs.toString(16)}"`;
  const outgoing = { ...headers, etag, 'last-modified': details.mtime.toUTCString(), ...(compressible ? { vary: 'Accept-Encoding' } : {}) };
  if (encoding) outgoing['content-encoding'] = encoding;
  const validators = String(request.headers['if-none-match'] || '').split(',').map(value => value.trim().replace(/^W\//, ''));
  if (validators.includes('*') || validators.includes(etag.replace(/^W\//, ''))) {
    response.writeHead(304, outgoing); response.end(); return;
  }
  if (encoding) {
    const body = await representation(filename, details, encoding);
    response.writeHead(200, { ...outgoing, 'content-length': body.length });
    response.end(request.method === 'HEAD' ? undefined : body);
  } else {
    response.writeHead(200, { ...outgoing, 'content-length': details.size });
    if (request.method === 'HEAD') response.end();
    else createReadStream(filename).on('error', error => response.destroy(error)).pipe(response);
  }
}
