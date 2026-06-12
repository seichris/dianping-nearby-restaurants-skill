#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST_NAME = 'com.seichris.dianping_nearby_restaurants_bridge';
const __filename = fileURLToPath(import.meta.url);
const bridgeDir = path.dirname(__filename);
const hostPath = path.join(bridgeDir, 'native-host.mjs');

function parseArgs(argv) {
  const args = { browser: 'chrome', extensionId: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--browser') args.browser = argv[++i];
    else if (argv[i] === '--extension-id') args.extensionId = argv[++i];
  }
  return args;
}

function hostDir(browser) {
  if (process.platform === 'darwin') {
    if (browser === 'edge') {
      return path.join(os.homedir(), 'Library/Application Support/Microsoft Edge/NativeMessagingHosts');
    }
    return path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts');
  }
  if (process.platform === 'linux') {
    if (browser === 'edge') return path.join(os.homedir(), '.config/microsoft-edge/NativeMessagingHosts');
    return path.join(os.homedir(), '.config/google-chrome/NativeMessagingHosts');
  }
  throw new Error('Install script currently supports macOS and Linux. On Windows, add the native host manifest via the browser registry key.');
}

const args = parseArgs(process.argv.slice(2));
if (!args.extensionId) {
  console.error('Usage: node claude/browser-bridge/install-native-host.mjs --browser chrome --extension-id EXTENSION_ID');
  process.exit(1);
}

const manifest = {
  name: HOST_NAME,
  description: 'Dianping restaurant browser bridge for Claude',
  path: hostPath,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${args.extensionId}/`],
};

const dir = hostDir(args.browser);
await fs.mkdir(dir, { recursive: true });
await fs.chmod(hostPath, 0o755);
const manifestPath = path.join(dir, `${HOST_NAME}.json`);
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Installed ${HOST_NAME} native host manifest at ${manifestPath}`);
