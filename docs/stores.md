# Stores marketplace

`/stores` is the global store directory, replacing Town Map in navigation. Plain `/town` links open the directory; explicit plot, district and view links still reach the physical location browser. Open a store uses `/town?view=open` and the existing plot purchase flow.

A store remains one business: its physical address, location effects, inventory, prices, cash register, reviews, upgrades and management are shared. Every existing business appears in the directory automatically. There is no online/offline stock split or extra store to manage.

The directory searches names, taglines, visible owner names, categories and addresses. It filters by category, district, stock availability and minimum rating, and sorts by newest, rating, stock, popularity or name. Filtering and sorting happen before pagination; URLs preserve the selections when returning from a store. Guest owner names remain masked, including during search.

Owners edit their name, color, banner and icon in the existing Settings tab. Six named colors are available. Banner and icon URLs accept only HTTPS single-image Imgur links (`imgur.com/ID` or `i.imgur.com/ID.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`). Album/gallery URLs, other domains, credentials, query strings and SVGs are rejected. Image links normalize to `https://i.imgur.com/...`; the application does not fetch or store remote image bytes. Its image CSP permits `https://i.imgur.com`. Images load without a referrer.

Blank image fields restore built-in artwork. Existing stores receive category colors and retain their current names and all trading data. The idempotent business schema migration adds `store_color`, `store_banner_url` and `store_icon_url`. Settings retain receipt replay and stale-draft protection; old clients that omit branding preserve it.

Verification: `npm test`, `npm run typecheck`, and optional `node scripts/store-marketplace-smoke.mjs` with `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` pointing to a local Playwright installation/browser. The browser script uses isolated temporary data and mocked Imgur images, and covers filtering, sorting, purchases, branding, navigation, locations, mobile sizes, German and guest access.
