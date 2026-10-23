import { AccountError } from './errors.mjs';

export const STORE_COLORS = { forest: '#285b45', ocean: '#2563a6', plum: '#79469a', berry: '#b13b62', amber: '#a96516', slate: '#475569' };
const defaults = { wine: 'berry', toys: 'plum', electronics: 'ocean', cars: 'slate', jeweler: 'amber', hardware: 'forest' };
export function storeBranding(shop) {
  return { color: shop.store_color || defaults[shop.type] || 'forest', bannerUrl: shop.store_banner_url || '', iconUrl: shop.store_icon_url || '' };
}
// Accept single Imgur image links only. Never fetch user-supplied URLs on the server.
export function imgurImage(value) {
  if (typeof value !== 'string' || value.length > 300) throw new AccountError('invalid_store_image', 400);
  if (!value.trim()) return '';
  let url;
  try { url = new URL(value.trim()); } catch { throw new AccountError('invalid_store_image', 400); }
  if (url.protocol !== 'https:' || !['imgur.com', 'www.imgur.com', 'i.imgur.com'].includes(url.hostname) || url.username || url.password || url.port || url.search || url.hash || !/^\/[a-zA-Z0-9]{5,12}(?:\.(?:png|jpe?g|gif|webp))?$/.test(url.pathname)) throw new AccountError('invalid_store_image', 400);
  const filename = url.pathname.slice(1);
  return `https://i.imgur.com/${filename.includes('.') ? filename : filename + '.png'}`;
}
export function brandingUpdate(payload, shop) {
  const current = storeBranding(shop);
  if (payload.color !== undefined && !Object.hasOwn(STORE_COLORS, payload.color)) throw new AccountError('invalid_store_color', 400);
  return { color: payload.color ?? current.color, bannerUrl: payload.bannerUrl === undefined ? current.bannerUrl : imgurImage(payload.bannerUrl), iconUrl: payload.iconUrl === undefined ? current.iconUrl : imgurImage(payload.iconUrl) };
}
