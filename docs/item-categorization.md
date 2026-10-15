# Item categorization

`src/item-categories.mjs` supplies the shared title/description classifier used by collection, Daily selection, market sectors, case themes and store compatibility. Rules recognize product nouns and German compounds first, then product descriptions and narrower brand evidence. Collection, shipping, opening hours and legal boilerplate are excluded from description evidence. Existing source categories remain the fallback when product evidence is insufficient. No item IDs or prices are used to guess categories.

Specific product wording outranks incidental names: Tom Ford sunglasses are fashion, Francis Ford Coppola wine is a drink, Land Rover Sport is a vehicle, and a Bosch laser with a carrying bag is a tool. Toy/model vehicles remain toys; vehicle accessories and motorcycles stay outside car cases/stores. Coffee and spirits remain drinks but cannot enter wine cases or receive Daily wine eligibility rules. The existing 14 market sectors and store types are retained.

## Archive audit, 2026-10-15

The supplied `auction-archive.json` contains 1,976 items. Comparing stored archive categories to the revised classifier changes 646 items. Other falls from 601 to 3: two web domains and a timber lot. These remain Other because the current taxonomy has no more specific category. Lower Other coverage is not an accuracy score; the regression fixture contains 188 hand-reviewed examples covering all 14 listing categories, alongside negative cases for brands, accessories and boilerplate.

| Listing category | Stored archive | Revised |
| --- | ---: | ---: |
| Books & media | 45 | 33 |
| Vehicles | 99 | 118 |
| Cosmetics | 12 | 38 |
| Fashion | 62 | 102 |
| Tools | 35 | 114 |
| Bicycles | 76 | 86 |
| Other | 601 | 3 |
| Jewelry & watches | 75 | 97 |
| Sport & leisure | 7 | 23 |
| Electronics | 99 | 225 |
| Household & garden | 6 | 97 |
| Collectibles | 21 | 107 |
| Drinks | 826 | 852 |
| Furniture & living | 12 | 81 |

Reproduce the audit with Node 22:

```sh
node scripts/audit-item-categories.mjs /path/to/auction-archive.json
```

The original archive is an audit input, not a bundled production import. The rules generalize its product vocabulary; the focused test fixture retains only selected titles, descriptions and category expectations.

## Existing databases

On the first database opening, `item_categories_v1` runs inside a transaction and records its completion in `app_state`. It updates the indexed archive category, JSON category metadata, inventory market/shop categories, saved game items, case rewards and nested palette pools/rewards. Stripped reward descriptions are recovered from the source auction ID where available. Archive `sourceCategory` retains the previous label for future fallback/auditing.

The migration preserves IDs, quantities, prices, bids, owners, balances, scores, random draws, rarity, paid costs and pool membership. Corrected market categories select the appropriate market index going forward; base prices remain unchanged. Case/review-pack containers keep their special metadata. Items incompatible with their current store return to ordinary inventory without a sale or refund. Active theft and resale locks defer that shelf cleanup; subsequent business ticks retry only the recorded pending items. Sold shelf rows and other owners' items remain untouched.

For a controlled preview or manual application, pass an existing SQLite file directly. Preview is the default and opens read-only. Application creates a SQLite snapshot backup next to the database before making transactional updates and marking completion. Use the same Node 22 runtime as the app.

```sh
node scripts/migrate-item-categories.mjs /path/to/justizguessr.sqlite
node scripts/migrate-item-categories.mjs /path/to/justizguessr.sqlite --apply
```

Validation used an isolated database containing all 1,976 archive records, 1,976 owned item copies and a saved game with the full archive: 5,928 item objects across 3,953 JSON records. Preview and application agreed; all non-category fields, owners, balances and scores matched their originals, and a repeated migration wrote zero records. This validates the migration, not deployment to a live database.
