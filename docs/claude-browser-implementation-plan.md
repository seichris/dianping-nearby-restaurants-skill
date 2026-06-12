# Claude Browser Implementation Plan

## Goal

Make this repository work well from Claude Code with the same two user-facing flows as the Codex setup:

1. Get restaurant data from Dianping and persist it under `data/restaurants/<city>/<station>/`.
2. Ask questions about the saved restaurants and offers from `latest.json`.

The Claude implementation should avoid requiring users to reopen Chrome with a debug port, should use the user's existing browser login state, and should avoid stealing focus by opening scan tabs in the background where the browser platform allows it.

## Current Claude Capabilities

Claude Code now has an official Chrome integration through the Claude in Chrome extension. According to Anthropic's current docs, it connects Claude Code to Chrome or Edge, uses the user's logged-in browser state, opens new tabs for browser work, and pauses for manual login or CAPTCHA handling. It is currently documented as a beta feature, requires a direct Anthropic plan, and is not supported on Brave, Arc, WSL, or other Chromium-based browsers.

That official integration is the best starting point for simple browser tasks, but it is not enough for this repository's best implementation because Anthropic describes browser actions as happening in a visible Chrome window. For this project, we want scan tabs to be inactive/background tabs so the user is not pulled away from their current tab during a multi-restaurant scan.

## Recommended Architecture

Use a Claude-native plugin for discoverability and workflow instructions, plus a project-owned browser bridge for deterministic background-tab scanning.

```text
dianping-nearby-restaurants-skill/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   ├── get-restaurant-data/
│   │   └── SKILL.md
│   └── ask-about-restaurants/
│       └── SKILL.md
├── claude/
│   ├── mcp-server.mjs
│   └── browser-bridge/
│       ├── extension/
│       │   ├── manifest.json
│       │   ├── service-worker.js
│       │   └── content-script.js
│       └── native-host.mjs
└── scripts/
    ├── scan-dianping-taocan.mjs
    └── view-dianping-taocan.mjs
```

### Why This Shape

- Claude plugin: makes the repo discoverable and installable in Claude Code without relying on a long README prompt.
- Claude skills: map directly to the two natural user prompts, while keeping context small until a flow is invoked.
- Local MCP server: gives Claude explicit tools for station resolution, scanning, querying, and publishing data.
- Browser bridge extension: gives us background tabs through Chrome extension APIs such as inactive tab creation, while still using the user's real browser cookies and login state.
- Shared scanner core: keeps Codex and Claude using the same extraction and persistence logic rather than forking two scrapers.

## Implementation Plan

### Phase 1: Package The Repo As A Claude Plugin

Add `.claude-plugin/plugin.json` at the repo root:

```json
{
  "name": "dianping-nearby-restaurants",
  "description": "Find Dianping restaurants near subway stations, save restaurant snapshots, and answer questions from saved JSON data.",
  "version": "0.1.0",
  "author": {
    "name": "seichris"
  }
}
```

Add two Claude skills:

- `skills/get-restaurant-data/SKILL.md`: instructs Claude to resolve the city/station, run the scan tool, validate JSON, commit, and push if the user requested persistence.
- `skills/ask-about-restaurants/SKILL.md`: instructs Claude to read `latest.json` through the viewer script and answer without scraping unless the user asks for fresh data.

Keep these distinct from the existing root `SKILL.md`, which is currently Codex-oriented. The root skill can stay for Codex until we choose to make it tool-neutral.

### Phase 2: Split Scanner Core From Browser Adapter

Refactor `scripts/scan-dianping-taocan.mjs` around a small browser interface:

```js
{
  newTab({ active?: boolean }): Promise<Tab>,
  finalize?(): Promise<void>
}

{
  goto(url): Promise<void>,
  evaluate(fn): Promise<unknown>,
  close(): Promise<void>
}
```

Then provide adapters:

- `CodexBrowserAdapter`: wraps the existing Codex extension-backed `browser.tabs` object.
- `ClaudeBridgeAdapter`: calls the local MCP/browser bridge tools.

This keeps parsing, station folder naming, JSON persistence, snapshot history, and `latest.json` behavior shared.

### Phase 3: Build The Claude MCP Server

Add a local stdio MCP server at `claude/mcp-server.mjs`. It should expose narrow tools:

- `resolve_station_url({ city, station_name, line_name? })`
- `scan_restaurants({ city, station_name, line_name?, base_url?, limit, pages })`
- `query_restaurants({ city, station_name, filters })`
- `publish_scan({ city, station_name, message? })`
- `browser_healthcheck()`

The MCP server should not expose arbitrary browser automation. It should only allow the Dianping scan workflow and read/query workflow, which reduces prompt-injection and accidental browsing risk.

Configure it from the plugin through `.mcp.json` or inline plugin MCP configuration so Claude loads it when the plugin is enabled.

### Phase 4: Build The Background Browser Bridge

Implement a small Chrome/Edge extension and native messaging host:

- Extension service worker receives scan commands from the native host.
- It opens scan pages with `active: false`.
- It injects a content script only on allowed Dianping hostnames.
- It extracts `document.body.innerText`, URL, title, and link lists.
- It closes tabs after each restaurant page is processed.
- It reports login/CAPTCHA/verification states instead of trying to bypass them.

The bridge should use native messaging rather than a Chrome DevTools debug port. That matches the user experience we want: install once, keep the normal browser profile, no special launch command, no exposed debugging endpoint.

Recommended extension permissions:

```json
{
  "permissions": ["tabs", "scripting", "nativeMessaging"],
  "host_permissions": [
    "https://www.dianping.com/*",
    "https://*.dianping.com/*"
  ]
}
```

The native host should be installed by a script such as:

```bash
node claude/browser-bridge/install-native-host.mjs
```

### Phase 5: Claude Workflow Behavior

For "get restaurant data":

1. Resolve station URL from saved config or Dianping filters.
2. Run `scan_restaurants` with the requested city/station and limit.
3. Write a timestamped snapshot and `latest.json`.
4. Validate: JSON parses, count matches requested limit, no raw user address is stored.
5. Pull/rebase, stage only `data/restaurants/<city>/<station>/`, commit, and push if the repo is meant to store that data.

For "ask about restaurants":

1. Read the requested station's `latest.json`.
2. Use `scripts/view-dianping-taocan.mjs` for filtering and new-offer comparisons.
3. Answer from saved data.
4. Ask whether to refresh only when the user clearly wants current Dianping state.

### Phase 6: Safety And Privacy

- Never store raw user addresses in `station.json` or snapshot station metadata.
- Treat public repos as unsuitable for private location history unless the user explicitly wants public sample data.
- Restrict the background bridge to Dianping host permissions.
- Do not attempt to bypass CAPTCHA, identity verification, or app-only gates.
- Close scan tabs after use and keep a hard limit on concurrent tabs.
- Log only station, URL, status, and counts by default; avoid saving full page text unless debugging is enabled.

## Acceptance Criteria

- A Claude user can install or load the repo as a plugin and discover the two workflows without reading this whole repository.
- The scan flow works without launching Chrome/Edge with a debug port.
- Dianping pages open in inactive/background tabs and do not take focus during normal scans.
- The browser bridge uses the user's existing Chrome/Edge login state.
- A scan of 10 restaurants for a city/station writes:
  - `data/restaurants/<city>/<station>/station.json`
  - `data/restaurants/<city>/<station>/<timestamp>.json`
  - `data/restaurants/<city>/<station>/latest.json`
- `latest.json` and the timestamped snapshot match for a completed scan.
- The query flow can answer from saved JSON without browser access.
- Codex scans continue to work through the existing Codex adapter.

## Open Questions

- Should the public repo ship the browser bridge extension source, or should it live in a separate companion repo and be referenced as an optional install?
- Should `publish_scan` be enabled by default, or should Claude only commit/push after explicit user confirmation?
- Should sample public data remain in this repo, or should the open-source version keep `data/restaurants` ignored by default?
- Should we support Firefox later, or keep the first version Chrome/Edge only to match Claude's current extension support?

## References

- Claude Code Chrome integration: https://code.claude.com/docs/en/chrome.md
- Claude Code MCP: https://code.claude.com/docs/en/mcp.md
- Claude Code plugins: https://code.claude.com/docs/en/plugins.md
- Claude Code skills: https://code.claude.com/docs/en/skills.md
