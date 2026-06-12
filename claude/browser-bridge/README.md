# Claude Browser Bridge

This bridge lets the Claude MCP server use the user's normal Chrome or Edge profile without a DevTools debug port.

The bridge has two pieces:

- `extension/`: an unpacked Chrome/Edge extension that creates inactive tabs and extracts page data.
- `native-host.mjs`: a native messaging host that relays commands between the extension and the Claude MCP server over a local Unix socket.

Install flow:

1. Load `claude/browser-bridge/extension/` as an unpacked extension in Chrome or Edge.
2. Copy the extension ID from the browser extension details page.
3. Run:

```bash
node claude/browser-bridge/install-native-host.mjs --browser chrome --extension-id EXTENSION_ID
```

Use `--browser edge` for Microsoft Edge.

The extension only requests host access for Dianping pages. It opens scan tabs with `active: false`, closes them after extraction, and reports login/CAPTCHA states instead of bypassing them.

If Claude reports that the browser bridge is not connected, click the extension icon once or restart Chrome/Edge. The extension reconnects to the native host on install, browser startup, and extension icon click.
