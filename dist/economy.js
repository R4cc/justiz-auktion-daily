// Data access for the flag-gated auction-economy systems (news, market,
// palettes, resale auctions, primary palette auctions). This is
// infrastructure only — no UI ships yet. Disabled systems return 404 from
// the server; the GET helpers resolve to null so future pages can render
// empty states instead of errors.
async function economyGet(url) {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    return response.json();
  } catch { return null; }
}
// Authenticated primary-auction calls delegate to account.js's accountApi so
// the CSRF header, cookie handling and the AccountError contract (Error with
// a .code) stay in exactly one place. economy.js loads before account.js but
// these helpers only ever run after both scripts have executed.
const accountCall = (route, payload) => {
  if (typeof window.accountApi !== 'function') return Promise.reject(new Error('account_api_unavailable'));
  return window.accountApi(route, payload);
};
window.justizEconomy = {
  news: (limit = 20) => economyGet(`/api/news?limit=${Number(limit) || 20}`),
  market: () => economyGet('/api/market'),
  marketHistory: (category, limit = 168) =>
    economyGet(`/api/market/${encodeURIComponent(category)}/history?limit=${Number(limit) || 168}`),
  palettes: () => economyGet('/api/palettes'),
  paletteAuctions: (limit = 50, offset = 0) =>
    economyGet(`/api/palette-auctions?limit=${Number(limit) || 50}&offset=${Number(offset) || 0}`),
  paletteAuction: id => economyGet(`/api/palette-auctions/${encodeURIComponent(id)}`),
  paletteAuctionBid: (id, amount) => accountCall('palette-auctions/bid', { id, amount }),
  paletteAuctionRewards: id => accountCall(`palette-auctions/${encodeURIComponent(id)}/rewards`),
  adminCreatePaletteAuction: (editionId, requestId) => accountCall('admin/palette-auctions', { editionId, requestId }),
  resales: (limit = 50) => economyGet(`/api/resales?limit=${Number(limit) || 50}`),
  resale: id => economyGet(`/api/resales/${encodeURIComponent(id)}`)
};
