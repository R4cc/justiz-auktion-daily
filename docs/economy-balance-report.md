# Economy balance audit

Source: --stress; 360 lots; 30 UTC rotations from 2026-10-01. Expected values are exact; palette outcomes use 2,000 seeded three-item openings per offer and market regime. These are reference-value scenarios, not live player telemetry.

| Market index | Offers examined | Paid case reference return | Palette reserve / live EV | Palette profit chance at reserve | Palette median return at reserve |
|---|---:|---:|---:|---:|---:|
| 50 | 240 | 41.0% | 70.0% | 69.7% | 129.9% |
| 100 | 240 | 82.0% | 70.0% | 69.8% | 130.1% |
| 150 | 240 | 82.0% | 70.0% | 69.8% | 130.3% |

| Daily score | Currency | Free case expected reference value | Legendary item probability (both draws combined) |
|---:|---:|---:|---:|
| 0 | 200 | 272.1 | 0.0316% |
| 2500 | 275 | 334.2 | 0.1573% |
| 5000 | 350 | 396.1 | 0.2730% |

| Market index | Ordinary NPC resale ceilings / live value | Collector ceiling / live value | Average interested share | Palette NPC ceilings / live EV |
|---|---:|---:|---:|---:|
| 50 | 60.0%–96.0% | 97.6% | 5.1% | 67.0%–82.2% |
| 100 | 60.0%–96.0% | 97.6% | 17.0% | 67.0%–83.7% |
| 150 | 60.0%–96.0% | 97.6% | 47.3% | 68.0%–83.2% |

| Store margin | Typical wine buying chance / visitor | Gross profit / unit at 85% wholesale cost | Expected profit / visitor (reference units) |
|---:|---:|---:|---:|
| 0% | 51.0% | 15.0% | 0.077 |
| 20% | 28.0% | 35.0% | 0.098 |
| 30% | 20.7% | 45.0% | 0.093 |
| 60% | 8.4% | 75.0% | 0.063 |
| 100% | 2.5% | 115.0% | 0.029 |

Currency flow: starting grant J€1,000; Daily J€200–350 plus one case; Higher or Lower best-streak top-ups capped at J€250 per UTC day. Paid cases and primary palette payments remove currency. Wholesale purchases remove player currency; NPC resale and store customers return currency only while consuming inventory. Player resale transfers currency and existing items. All supply schedules and escrow settlement remain bounded and idempotent.

