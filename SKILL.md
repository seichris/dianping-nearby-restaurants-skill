---
name: dianping-taocan-discovery
description: Use when scanning Dianping restaurants near a Shanghai subway station for taocan, vouchers, nearby food options, or recurring meal-deal snapshots.
---

# Dianping Taocan Discovery

## Overview

Use the Codex extension-backed browser to find Dianping restaurant offer data around a saved Shanghai subway station. The skill stores each scan as a timestamped JSON snapshot and rewrites `latest.json` for quick viewing.

Do not use alternate browser-control paths for this workflow. Work through the Codex extension-backed browser session, keep the user's logged-in browser state, and close tabs with `browser.tabs.finalize({ keep: [] })` when done.

## Storage

The default output root is `data/restaurants` in the current workspace. Scan output is partitioned by city and station:

```text
data/restaurants/<city>/<station>/
├── station.json
├── <scan-timestamp>.json
└── latest.json
```

- `station.json`: saved user address, subway line/station, city, and station listing URL.
- `<scan-timestamp>.json`: immutable full scan snapshot using a filename derived from the scan timestamp.
- `latest.json`: latest full scan snapshot for querying and human review.

After every successful normal scan, persist the GitHub-backed storage by committing and pushing the changed files under the returned `result.paths.stationDir`. Before committing, run `git pull --rebase` to pick up other agents' snapshots. Then stage only the station data directory, commit with a scan-specific message, and push.

If multiple people write to the same repo, the timestamped JSON snapshots should not conflict. `latest.json` can conflict when two scans overlap; resolve it by keeping the snapshot with the newest `updated_at`, while preserving both timestamped snapshot files. Avoid adding a database unless the user asks for multi-user access, remote writes outside Codex, or server-side querying.

## First Run

If `data/restaurants/station.json` does not exist and the user did not provide a station listing URL, ask for either the user's address or the subway station they want to use.

If the user gives a subway station, use it directly. If the user gives an address, search online for the closest Shanghai metro station and line. Present the likely candidate to the user for confirmation before saving it. If the search returns multiple plausible candidates, ask the user to choose from the top candidates.

Open `https://www.dianping.com/shanghai/ch10/d1` in the extension-backed browser. Use the Dianping location filters to select `地铁线`, then the confirmed subway line, then the confirmed station.

After Dianping navigates to the station result page, save the resulting URL:

```js
const { writeStationConfig } = await import(`${nodeRepl.homeDir}/.codex/skills/dianping-taocan-discovery/scripts/scan-dianping-taocan.mjs`);

await writeStationConfig({
  address: 'USER_ADDRESS',
  city: 'CITY_SLUG',
  line_name: 'SUBWAY_LINE',
  station_name: 'STATION_NAME',
  base_url: await tab.url(),
}, {
  cwd: nodeRepl.cwd,
});
```

## Browser Setup

Use the Codex extension browser runtime from the active bundled browser client:

```js
const { setupBrowserRuntime } = await import('PATH_TO_CODEX_BROWSER_CLIENT');

await setupBrowserRuntime({ globals: globalThis });
globalThis.browser = await agent.browsers.get('extension');
await browser.nameSession('Dianping taocan scan');
```

Use this `browser` object for all Dianping navigation and extraction.

## Scan

Run the bundled scanner from a Node REPL after the extension-backed `browser` object exists:

```js
const { runScan } = await import(`${nodeRepl.homeDir}/.codex/skills/dianping-taocan-discovery/scripts/scan-dianping-taocan.mjs`);

const result = await runScan({
  browser,
  cwd: nodeRepl.cwd,
  pages: 3,
});

await browser.tabs.finalize({ keep: [] });
result;
```

`runScan` reads `station.json` by default and writes to `data/restaurants/<city>/<station>/`. Pass `baseUrl` to override the saved station URL, `pages` to scan multiple listing pages, `limit` for a small smoke test, and `outDir` to override the output root.

The scanner visits listing pages like:

- Page 1: `https://www.dianping.com/shanghai/ch10/r101837`
- Page 2: `https://www.dianping.com/shanghai/ch10/r101837d500p2`
- Page 3: `https://www.dianping.com/shanghai/ch10/r101837d500p3`

It opens each restaurant page, extracts restaurant name, URL, shop id, address, rating, review count, average price, category, area, opening status, opening hours, station distance, ranking badge, amenities, recommended dishes, vouchers, taocan, scan timestamp, and extraction status, then persists the scan.

After a normal scan, commit and push the returned data paths:

```bash
git pull --rebase
git add "$STATION_DIR"
git commit -m "Update Dianping restaurant snapshot"
git push
```

Use `result.paths.stationDir` for `STATION_DIR`. Do not commit temp smoke-test output. If there are no staged changes, report that the scan matched the existing GitHub data and skip the commit.

## Query

Use the viewer script to inspect saved data:

```bash
node ~/.codex/skills/dianping-taocan-discovery/scripts/view-dianping-taocan.mjs
```

Useful options:

```bash
node ~/.codex/skills/dianping-taocan-discovery/scripts/view-dianping-taocan.mjs --taocan-only
node ~/.codex/skills/dianping-taocan-discovery/scripts/view-dianping-taocan.mjs --new
node ~/.codex/skills/dianping-taocan-discovery/scripts/view-dianping-taocan.mjs --all
node ~/.codex/skills/dianping-taocan-discovery/scripts/view-dianping-taocan.mjs --json
```

`--new` compares `latest.json` against earlier timestamped snapshots and shows only taocan or voucher offers that were not seen in previous scans.

## Validation

For a quick smoke test, scan one page with `limit: 4`. The reference listing should include Bites&Brews (`https://www.dianping.com/shop/H6FTDJ7sRsAlufja`), which has voucher and taocan data.

Expected Bites&Brews offers include:

- `100元代金券`
- `单人午市套餐`
- `双人牛排套餐`

If Dianping shows identity verification or hides details behind app-only copy, save the record with extraction status instead of forcing the page.
