function render(status) {
  const statusEl = document.getElementById('status');
  const connectedEl = document.getElementById('connected');
  const errorEl = document.getElementById('error');
  statusEl.textContent = status.connected ? 'Connected' : 'Disconnected';
  statusEl.className = status.connected ? 'ok' : 'bad';
  connectedEl.textContent = status.last_connected_at || '-';
  errorEl.textContent = status.last_error || '-';
}

async function refresh() {
  const status = await chrome.runtime.sendMessage({ type: 'status' });
  render(status || { connected: false, last_error: 'No status response' });
}

document.getElementById('reconnect').addEventListener('click', async () => {
  const status = await chrome.runtime.sendMessage({ type: 'reconnect' });
  render(status || { connected: false, last_error: 'No reconnect response' });
  setTimeout(refresh, 500);
});

refresh();
setTimeout(refresh, 750);
