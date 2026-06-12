---
description: Answer questions from saved Dianping restaurant JSON data. Use when the user asks about restaurants, offers, taocan, vouchers, prices, categories, ratings, or recommendations from saved scans.
argument-hint: "[city] [station] [question]"
---

# Ask About Restaurants

Use saved JSON before browsing.

1. Use `query_restaurants` for the requested city and station, or inspect `data/restaurants/**/latest.json` when the station is not specified.
2. Answer from `latest.json` and mention the scan timestamp when freshness matters.
3. Use the local viewer script for comparisons such as new offers, taocan-only, or all scanned shops:

```bash
node scripts/view-dianping-taocan.mjs --file data/restaurants/<city>/<station>/latest.json --all
```

Only run a new Dianping scan when the user asks for current data or explicitly asks to refresh.
