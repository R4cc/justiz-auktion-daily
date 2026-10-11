# JUSTIZGUESSR

A price-guessing and trading game based on public listings from [Justiz-Auktion](https://www.justiz-auktion.de/).

## Features

- **Daily:** Guess five auction prices and earn J€ and a sealed reward case.
- **Free play and Higher or Lower:** Practice your guesses or build a streak.
- **Auction House:** Bid on items, stock bundles and mystery pallets, or list your own finds.
- **Cases and inventory:** Open mystery cases, collect items, auction them or stock a compatible store.
- **Stores and Town:** Open a shop, set prices and sell to players and simulated customers.
- **Market Trends:** Follow changing item values and NPC demand to guide your trades.
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
