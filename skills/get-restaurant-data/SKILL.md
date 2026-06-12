---
description: Scan Dianping restaurants near a subway station and save timestamped JSON snapshots. Use when the user asks to get, scrape, refresh, scan, or update restaurant data.
argument-hint: "[city] [station] [limit]"
---

# Get Restaurant Data

Use the `dianping-restaurants` MCP tools for this workflow.

1. Resolve the station listing URL with `resolve_station_url` unless the user already supplied a Dianping listing URL.
2. Run `scan_restaurants` with the requested city, station, line name if known, page count, and limit.
3. Confirm the result wrote `station.json`, a timestamped snapshot, and `latest.json` under `data/restaurants/<city>/<station>/`.
4. Validate that the saved JSON parses, the scan count matches the requested limit when Dianping returned enough restaurants, and station metadata does not contain a raw address.
5. Commit and push only the changed station data directory when the user wants the GitHub-backed data updated.

Do not bypass CAPTCHA, login, identity verification, or app-only gates. If the browser bridge reports one of those states, save the extraction status and tell the user what manual step is needed.
