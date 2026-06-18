# Claude Guidance

Use the Claude plugin files in this repo for Claude Code workflows:

- `/dianping-nearby-restaurants:get-restaurant-data` scans Dianping and writes JSON snapshots.
- `/dianping-nearby-restaurants:ask-about-restaurants` answers from saved `latest.json` data.

Do not edit the Codex-native `SKILL.md`, `agents/openai.yaml`, or `scripts/install-codex-skill.sh` when changing Claude-specific behavior.

For browser-backed scans, use the `dianping-restaurants` MCP tools and the Chrome/Edge bridge under `claude/browser-bridge/`. The bridge is intentionally limited to Dianping pages and opens tabs in the background.
