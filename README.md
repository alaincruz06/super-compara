# SuperCompara 🛒

Compare Mercadona and Dia prices in one place: search, browse by category, switch between grid, list and a side-by-side store view, filter by price, deals and weight/volume, sort by price, €/kg, discount or size, and build a shopping list with per-store totals.

**Live site:** https://alaincruz06.github.io/super-compara/

## How it works

```
GitHub Actions (daily 06:17 Madrid)          GitHub Pages (static)
 scraper/build.mjs ──► site/data/*.json ──►  site/index.html + app.js
   ├─ mercadona.mjs  (public tienda.mercadona.es JSON API, by postal code)
   └─ dia.mjs        (imports dia.json from the dia-data branch, uploaded by dia-sync/)
```

- Everything is static and free: no server or database. The browser loads one JSON file (~1–2 MB, gzipped by Pages) and searches it locally, so results are instant.
- The `gh-pages` branch holds only the latest build. If a store fails to update, the previous day's prices for that store are kept and the site shows a notice.
- Price drops come from Mercadona's "previous price" field and from comparing with the previous day's snapshot.
- Unit prices are normalised to €/kg, €/L or €/unit so both stores can be compared.

## Settings

| What | Where | Default |
|---|---|---|
| Postal code (sets Mercadona's warehouse) | Repo → Settings → Secrets and variables → Actions → **Variables** → `POSTAL_CODE` | `30002` (Murcia → `alc1`) |
| Run now | Actions → "Update prices and deploy" → Run workflow | daily |

## Dia data

dia.es blocks automated requests from cloud servers, including GitHub Actions. Dia prices are collected on your own computer with [`dia-sync/`](dia-sync/README.md), which runs on a schedule or from your browser. The results go to the data-only `dia-data` branch, and the build merges them in. Dia prices older than a week are flagged on the site.

## Run locally

```bash
node scraper/build.mjs          # needs network access to tienda.mercadona.es
cd site && python3 -m http.server 8000
```

Independent project, not affiliated with Mercadona or Dia. Prices are for reference only.
