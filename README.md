# JUSTIZGUESSR

A price-guessing and trading game based on public listings from [Justiz-Auktion](https://www.justiz-auktion.de/).

## Features

- **Daily:** Guess five auction prices and earn J€ and a sealed reward case.
- **Auction text:** Full HTML named-character and Unicode numeric-reference support preserves punctuation, symbols and encoded angle-bracket text. Existing encoded auction and item text is repaired automatically at startup.
- **Free play and Higher or Lower:** Practice your guesses or build a streak.
- **Auction House:** Bid on player listings and cases, or auction your own finds.
- **Mystery palettes:** Bid on category stock palettes in the Auction House, with price-based rarity and quantity odds. Items and amounts are drawn at opening with your current Luck. Reveal three item and quantity rolls, then restock your stores from inventory.
- **Cases and inventory:** Open mystery cases, collect items, auction them or stock a compatible store.
- **Stores and Town:** Open a shop, set prices and sell to players and simulated customers. Blackjack wins steal an item directly; losses get an 80% escape / 20% caught police wheel. Catches enforce fines, inventory seizure and escalating jail if the fine cannot be covered.
- **Market Trends:** Follow changing item values and NPC demand to guide your trades.
- **Visitor storefronts:** Shop crests and town artwork, rarity cards with grouped stock quantities, one-item buying and blackjack theft. Verified reviews, Influence likes and daily shop reactions sit below the shelves.
- **Store popularity and review auctions:** Every store has a popularity meter and a five-star rating breakdown. An NPC offers packs of 5–30 reviews once or twice daily in 12-hour auctions. Winners choose 1–5 stars and apply the pack to their store or another player’s store; bought reviews add counts without written comments and have capped, reduced influence.
- **Store reviews:** Verified player reviews stay above NPC feedback. Influence gives a small community-support bonus to likes; other players and NPC shoppers can add one like each. NPCs review completed purchases against the price paid and their price sensitivity. Editing a review clears its earned likes.
- **Skill tree:** One point per account level, including existing levels. Unlock luck, store security and review influence; future branches are coming soon.
- **Criminal record:** Your profile lists caught theft attempts, when they were recorded, and each exact fine. Older offenses remain accessible through “Show older offenses”.
- **Weekly Market frenzy:** A randomly timed hour of rapid pumps and crashes moves every category between up to 3× and as low as ¼ of its normal quote. The Market page shows a live countdown, and charts retain the event after normal trading returns.
- **Collect store cash:** Each store on Your stores has its own Collect cash button with a coin animation. Customer sales, tips and positive events accumulate in that store's till; earnings enter your spendable wallet only when collected.
- **Player hub:** A personal level crest, XP progress and earned trading milestones guide your next step. Daily, collection and skills are close at hand; friends and the criminal record have separate profile tabs.
- **Progress and friends:** Earn XP, level up, track trading profit and compare Daily scores and collections.
- **English and German:** Play on desktop or mobile. Guests can start guessing immediately; accounts unlock rewards and trading.

J€ is in-game currency. Digital items do not grant ownership of real auction lots.

## Run with Docker Compose

You need Docker with Compose and a Cloudflare Tunnel. The included setup serves the game through your tunnel.

1. Clone or download this repository and open its folder.
2. Copy `.env.example` to `.env` and fill in:
   - `DOCKERHUB_USERNAME`: the Docker Hub account publishing the JUSTIZGUESSR image.
   - `CLOUDFLARE_TUNNEL_TOKEN`: your tunnel token.
   - `ADMIN_USERNAME` and `ADMIN_PASSWORD`: your admin login, with a password of 12–128 characters.
3. In Cloudflare, point your tunnel's public hostname to `http://justizguessr:3000`.
4. Start the game:

   ```bash
   docker compose up -d
   ```

5. Open your public hostname. Sign in as admin to create registration codes for players.

Game data stays in a Docker volume across updates and restarts.

To update:

```bash
docker compose pull
docker compose up -d
```

To stop:

```bash
docker compose down
```
