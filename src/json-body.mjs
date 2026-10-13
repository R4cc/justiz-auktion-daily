import { AccountError } from './errors.mjs';

export async function jsonBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new AccountError('json_required', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new AccountError('body_too_large', 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new AccountError('invalid_json'); }
}
