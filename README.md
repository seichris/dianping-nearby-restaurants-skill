# Dianping Nearby Restaurant Discovery

Use your Codex or Claude to find Dianping restaurants nearby and their set meals (TaoCan / 套餐).

<img width="1858" height="788" alt="beijing_restaurants" src="https://github.com/user-attachments/assets/1a1ca8d8-379e-4f1c-b1e7-b181e6b75901" />

## 1. Get the Restaurant Data

Ask Codex to scan Dianping and save the restaurant data to JSON files.

Example prompts:

```text
Scan Dianping restaurants near my saved station and update the taocan data.
```

```text
Refresh the restaurant vouchers around my saved station and push the updated JSON to GitHub.
```

Codex will open Dianping through the extension-backed browser, get the current restaurant offers, write a timestamped snapshot, and save it to the data folder.

## 2. Ask About the Restaurants

Ask Codex questions about the saved restaurant data.

Example prompts:

```text
Which restaurants around me have good taocan right now?
```

```text
What new vouchers showed up near my saved station?
```

```text
Show me lunch deals under ¥100 from the saved Dianping data.
```

## Setup

This repo is both the Codex skill source and the JSON storage layer.

Fork this repo if you want Codex to push your own restaurant data to GitHub. Clone your fork into a Codex workspace and install the native skill:

```bash
./scripts/install-codex-skill.sh
```

If you only want to inspect or try the skill without saving scan history, point Codex at this repo or clone it read-only. If multiple people intentionally share one repo, they all need push access and should keep the city/station folder layout to avoid most conflicts.

## Files

- `SKILL.md`: Codex skill workflow.
- `agents/openai.yaml`: Codex UI metadata for the skill.
- `scripts/scan-dianping-taocan.mjs`: scanner module used from the Codex extension-backed browser.
- `scripts/enrich-restaurant-data.mjs`: adds pinyin, English schedule labels, and optional shared AMap geocodes to saved JSON.
- `scripts/view-dianping-taocan.mjs`: local viewer for saved data.
- `scripts/install-codex-skill.sh`: installs the native Codex skill payload.
- `data/restaurants/station.json`: active saved station/listing URL.
- `data/restaurants/<city>/<station>/station.json`: station copy used with scan output.
- `data/restaurants/<city>/<station>/<scan-timestamp>.json`: immutable scan snapshot.
- `data/restaurants/<city>/<station>/latest.json`: latest scan snapshot.

## Native Codex Install

Codex discovers native skills from `~/.codex/skills/<skill-name>/SKILL.md`. From this repo, install or update the skill with:

```bash
./scripts/install-codex-skill.sh
```

The installer copies only the native skill payload:

```text
~/.codex/skills/dianping-taocan-discovery/
├── SKILL.md
├── agents/openai.yaml
└── scripts/
```

It intentionally does not copy `README.md` or `data/`; scan history stays in the workspace unless you commit and push it.

## Station Setup

The skill accepts either an address or a subway station.

If given an address, Codex uses it only to find likely nearby Shanghai metro stations, asks the user to confirm the candidate, then opens Dianping and selects:

```text
地点 -> 地铁线 -> subway line -> station
```

After Dianping navigates to the station listing page, the skill saves that URL in `data/restaurants/station.json`. Future scans use the saved URL directly.

The raw address is not saved to `station.json`; only the confirmed station, city, line, and listing URL are stored.

## Scan

Run from a Codex Node REPL after creating the extension-backed `browser` object:

```js
const { runScan } = await import(`${nodeRepl.cwd}/scripts/scan-dianping-taocan.mjs`);

const result = await runScan({
  browser,
  cwd: nodeRepl.cwd,
  pages: 3,
});

await browser.tabs.finalize({ keep: [] });
result;
```

Options:

- `pages`: number of Dianping listing pages to scan, default `3`.
- `limit`: maximum restaurants to scan, useful for smoke tests.
- `baseUrl`: override the saved station listing URL.
- `outDir`: output root, default `data/restaurants`.

By default, scans are written under the city and station:

```text
data/restaurants/<city>/<station>/
├── station.json
├── 2026-06-12T09-27-16-298Z.json
└── latest.json
```

Commit and push normal scan output so GitHub remains the shared history:

```bash
git pull --rebase
git add data/restaurants/<city>/<station>
git commit -m "Update Dianping restaurant snapshot"
git push
```

Timestamped snapshot files make concurrent scans from multiple people additive. If `latest.json` conflicts, keep the version with the newest `updated_at`; both timestamped snapshots should remain in the folder.

## Enrich Shared Map Data

Run enrichment after scans to add derived fields:

```bash
npm run enrich:data
```

Without an AMap REST key, enrichment still updates local text fields and skips geocoding. To persist map coordinates for everyone who loads the site, use an AMap Web Service key:

```bash
AMAP_WEB_SERVICE_KEY=... npm run enrich:data
```

`AMAP_REST_API_KEY` is also accepted. Successful lookups are written to each restaurant as `shop.amap_location` with the query, source, timestamp, and coordinates. Existing coordinates are reused when the query has not changed, so committed JSON acts as the shared geocode cache. The map uses these saved points before falling back to browser-side AMap geocoding or station-distance estimates.

## View

```bash
node scripts/view-dianping-taocan.mjs
```

Useful options:

```bash
node scripts/view-dianping-taocan.mjs --taocan-only
node scripts/view-dianping-taocan.mjs --new
node scripts/view-dianping-taocan.mjs --all
node scripts/view-dianping-taocan.mjs --json
```

`--new` compares `latest.json` against earlier timestamped snapshots and shows only offers not seen before.

## Data Fields

Each restaurant record includes:

- shop identity: name, URL, shop ID, address
- source metadata: listing page, page number, result index
- ratings: overall rating, review count, taste/environment/service scores when visible
- pricing and location: average price per person, area, category, distance from station
- optional shared map cache: AMap longitude/latitude and geocode metadata when enrichment runs with an AMap Web Service key
- visit context: open status, opening hours, ranking badge, amenities
- food context: recommended dishes, menu count, review count from the review section
- offers: vouchers and set meals with title, price, discount, original price, refund/availability flags, group size, valid-time text, earliest usable date, and raw text
- extraction status: whether details were visible, whether verification was required, capture time, method, and elapsed time

## Notes

Dianping sometimes exposes only schedule text, such as `周一至周日`, where a richer package title might be hidden in the rendered page. The JSON keeps `raw_text` for parser improvements.

This repository is the storage layer for now. Commit and push JSON changes after scans to keep history in GitHub without running a separate database.
