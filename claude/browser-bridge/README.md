# Claude Browser Bridge

This bridge lets the Claude MCP server use the user's normal Chrome or Edge profile without a DevTools debug port.

The bridge has two pieces:

- `extension/`: an unpacked Chrome/Edge extension that creates inactive tabs and extracts page data.
- `native-host.mjs`: a native messaging host that relays commands between the extension and the Claude MCP server over a local Unix socket.

Install flow:

1. Load `claude/browser-bridge/extension/` as an unpacked extension in Chrome or Edge.
2. Run the guided setup:

```bash
node claude/browser-bridge/setup.mjs --browser chrome
```

Use `--browser edge` for Microsoft Edge. If the setup script cannot auto-detect the extension ID, copy it from the browser extension details page and pass it explicitly:

```bash
node claude/browser-bridge/setup.mjs --browser chrome --extension-id EXTENSION_ID
```

The setup script installs the native host on macOS, Linux, and Windows. On Windows it writes a native-host manifest under `%LOCALAPPDATA%` and registers it with the current user's Chrome or Edge native messaging registry key.

The extension only requests host access for Dianping pages. It opens scan tabs with `active: false`, closes them after extraction, and reports login/CAPTCHA states instead of bypassing them.

If Claude reports that the browser bridge is not connected, open the extension popup and click Reconnect, or restart Chrome/Edge. The extension reconnects to the native host on install, browser startup, status check, and explicit reconnect.
