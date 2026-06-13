#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const HOST_NAME = 'com.seichris.dianping_nearby_restaurants_bridge';
const __filename = fileURLToPath(import.meta.url);
const bridgeDir = path.dirname(__filename);
const hostPath = path.join(bridgeDir, 'native-host.mjs');
const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const args = { browser: 'chrome', extensionId: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--browser') args.browser = argv[++i];
    else if (argv[i] === '--extension-id') args.extensionId = argv[++i];
  }
  return args;
}

function validateExtensionId(extensionId) {
  if (!/^[a-p]{32}$/.test(extensionId)) {
    throw new Error(`Invalid Chrome extension ID: ${extensionId}`);
  }
}

function browserName(browser) {
  return browser === 'edge' ? 'Microsoft Edge' : 'Google Chrome';
}

function unixHostDir(browser) {
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
  throw new Error(`Unsupported platform: ${process.platform}`);
}

function windowsInstallDir() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'DianpingNearbyRestaurantsBridge');
}

function windowsRegistryKey(browser) {
  const browserRoot = browser === 'edge'
    ? 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts'
    : 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts';
  return `${browserRoot}\\${HOST_NAME}`;
}

async function writeWindowsWrapper(dir) {
  const wrapperPath = path.join(dir, 'native-host.cmd');
  const body = [
    '@echo off',
    `node "${hostPath}"`,
    '',
  ].join('\r\n');
  await fs.writeFile(wrapperPath, body);
  return wrapperPath;
}

async function installWindows(manifest) {
  const dir = windowsInstallDir();
  await fs.mkdir(dir, { recursive: true });
  const wrapperPath = await writeWindowsWrapper(dir);
  const manifestPath = path.join(dir, `${HOST_NAME}.json`);
  const windowsManifest = { ...manifest, path: wrapperPath };
  await fs.writeFile(manifestPath, `${JSON.stringify(windowsManifest, null, 2)}\n`);
  await execFileAsync('reg', ['add', windowsRegistryKey(args.browser), '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f']);
  return manifestPath;
}

async function installUnix(manifest) {
  const dir = unixHostDir(args.browser);
  await fs.mkdir(dir, { recursive: true });
  await fs.chmod(hostPath, 0o755);
  const manifestPath = path.join(dir, `${HOST_NAME}.json`);
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

const args = parseArgs(process.argv.slice(2));
if (!args.extensionId) {
  console.error('Usage: node claude/browser-bridge/install-native-host.mjs --browser chrome --extension-id EXTENSION_ID');
  process.exit(1);
}
validateExtensionId(args.extensionId);

const manifest = {
  name: HOST_NAME,
  description: 'Dianping restaurant browser bridge for Claude',
  path: hostPath,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${args.extensionId}/`],
};

const manifestPath = process.platform === 'win32'
  ? await installWindows(manifest)
  : await installUnix(manifest);

console.log(`Installed ${HOST_NAME} native host for ${browserName(args.browser)} at ${manifestPath}`);
