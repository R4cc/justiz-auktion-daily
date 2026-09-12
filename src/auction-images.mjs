// Keep source URLs as identities: positions can change when a listing is updated.
export function cachedAuctionImages(auction = {}) {
  const cache = Object.fromEntries(Object.entries(auction.imageCache || {})
    .filter(([, image]) => typeof image === 'string' && image.startsWith('/auction-images/')));
  const cover = auction.sourceImages?.[0];
  // Records created by the old collector only cached the cover.
  if (!auction.imageCache && cover && auction.image?.startsWith('/auction-images/')) {
    cache[cover] = auction.image;
  }
  return cache;
}

export function auctionGallery(auction) {
  const sources = [...new Set((auction.sourceImages || []).filter(Boolean))];
  const cache = cachedAuctionImages(auction);
  if (sources.length) {
    return [...new Set(sources.map((source, index) => cache[source] ||
      (index === 0 && !auction.imageCache ? auction.image : null) || source))];
  }
  return [...new Set([auction.image, ...(auction.images || [])].filter(Boolean))];
}
