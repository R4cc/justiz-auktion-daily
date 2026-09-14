// Data access for the flag-gated auction-economy systems (news, market,
// palettes, resale auctions). This is infrastructure only — no UI ships yet.
// Disabled systems return 404 from the server; the helpers resolve to null so
// future pages can render empty states instead of errors.
async function economyGet(url) {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    return response.json();
  } catch { return null; }
}
window.justizEconomy = {
  news: (limit = 20) => economyGet(`/api/news?limit=${Number(limit) || 20}`),
  market: () => economyGet('/api/market'),
  palettes: () => economyGet('/api/palettes'),
  resales: (limit = 50) => economyGet(`/api/resales?limit=${Number(limit) || 50}`),
  resale: id => economyGet(`/api/resales/${encodeURIComponent(id)}`)
};
