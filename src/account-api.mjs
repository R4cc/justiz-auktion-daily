import { Accounts, AccountError } from './accounts.mjs';
import { caseCatalog, publicCaseCatalog } from './cases.mjs';
import { readArchive } from './database.mjs';
import { higherLowerDeck } from './higher-lower.mjs';

async function body(request) {
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

export async function createAccountApi({ dataDir, dailyPayload, json, env = process.env }) {
  const accounts = new Accounts(dataDir);
  await accounts.bootstrap(env.ADMIN_USERNAME, env.ADMIN_PASSWORD);
  const secure = env.COOKIE_SECURE !== 'false' && (env.COOKIE_SECURE === 'true' || env.NODE_ENV === 'production');
  const cookie = token => `jg_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? 2592000 : 0}${secure ? '; Secure' : ''}`;
  let catalog, catalogStamp;
  function getCatalog() {
    const archive = readArchive(dataDir);
    if (!catalog || catalogStamp !== archive.updatedAt) {
      catalog = caseCatalog(archive.auctions);
      catalogStamp = archive.updatedAt;
    }
    return catalog;
  }
  return async (request, response, url) => {
    if (!url.pathname.startsWith('/api/account/')) return false;
    try {
      const token = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('jg_session='))?.slice(11);
      const user = accounts.user(token);
      const route = url.pathname.slice('/api/account/'.length);
      if (request.method === 'GET') {
        if (route === 'me') json(response, 200, { user: user ? accounts.profile(user) : null });
        else if (route === 'cases') json(response, 200, publicCaseCatalog(getCatalog()));
        else {
          if (!user) throw new AccountError('login_required', 401);
          if (route === 'inventory') json(response, 200, { items: accounts.inventory(user) });
          else if (route === 'friends') json(response, 200, accounts.friends(user));
          else if (route === 'codes') json(response, 200, { codes: accounts.listCodes(user) });
          else if (route === 'admin') json(response, 200, accounts.adminOverview(user));
          else throw new AccountError('not_found', 404);
        }
        return true;
      }
      if (request.method !== 'POST') throw new AccountError('method_not_allowed', 405);
      // Cross-site forms cannot set this header; CORS is deliberately not enabled.
      if (request.headers['x-requested-with'] !== 'JUSTIZGUESSR' || request.headers['sec-fetch-site'] === 'cross-site') throw new AccountError('forbidden', 403);
      if (['login', 'register'].includes(route)) accounts.throttle(`auth:${request.socket.remoteAddress}`, 60);
      else if (user) accounts.throttle(`mutate:${user.id}`, 500);
      const payload = await body(request);
      if (route === 'login' || route === 'register') {
        const nextToken = await accounts[route](payload);
        if (token) accounts.logout(token);
        response.setHeader('set-cookie', cookie(nextToken));
        json(response, 200, { user: accounts.profile(accounts.user(nextToken)) });
        return true;
      }
      if (!user) throw new AccountError('login_required', 401);
      let result;
      if (route === 'logout') {
        accounts.logout(token);
        response.setHeader('set-cookie', cookie(''));
        result = { user: null };
      } else if (route === 'codes') result = { codes: accounts.codes(user, payload.count) };
      else if (route === 'admin/grant-tokens') result = { grant: accounts.grantTokens(user, payload.amount, payload.requestId), user: accounts.profile(user) };
      else if (route === 'friends/request') {
        accounts.throttle(`friend-request:${user.id}`, 20);
        accounts.requestFriend(user, payload.username); result = accounts.friends(user);
      } else if (route === 'friends/accept') { accounts.acceptFriend(user, payload.id); result = accounts.friends(user); }
      else if (route === 'friends/remove') { accounts.removeFriend(user, payload.id); result = accounts.friends(user); }
      else if (route === 'codes/revoke') { accounts.revokeCode(user, payload.id); result = { ok: true }; }
      else if (route === 'cases/open') {
        if (typeof payload.revision !== 'string') throw new AccountError('catalog_changed', 409);
        result = { item: accounts.openCase(user, getCatalog(), payload.caseId, payload.requestId, payload.revision), user: accounts.profile(user) };
      }
      else if (route === 'inventory/sell') result = { ...accounts.sell(user, payload.id), user: accounts.profile(user) };
      else if (route === 'games/start') {
        const auctions = payload.mode === 'daily' ? (await dailyPayload()).auctions : null;
        result = { run: accounts.startGame(user, payload.mode, () => auctions || higherLowerDeck(readArchive(dataDir).auctions).auctions), user: accounts.profile(user) };
      } else if (route === 'games/answer') result = { run: accounts.answer(user, payload.id, payload.position, payload.answer), user: accounts.profile(user) };
      else throw new AccountError('not_found', 404);
      json(response, 200, result);
    } catch (error) {
      if (error instanceof AccountError) json(response, error.status, { error: error.message });
      else if (error.code === 'insufficient_variety') json(response, 503, { error: 'insufficient_variety' });
      else {
        console.error('Account API failed');
        json(response, 500, { error: 'internal_error' });
      }
    }
    return true;
  };
}
