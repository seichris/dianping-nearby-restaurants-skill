#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const bridgeDir = path.dirname(__filename);
const extensionDir = path.join(bridgeDir, 'extension');
const installScript = path.join(bridgeDir, 'install-native-host.mjs');
const EXTENSION_NAME = 'Dianping Restaurant Bridge';

function parseArgs(argv) {
  const args = { browser: 'chrome', extensionId: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--browser') args.browser = argv[++i];
    else if (argv[i] === '--extension-id') args.extensionId = argv[++i];
  }
  return args;
}

function browserLabel(browser) {
  return browser === 'edge' ? 'Microsoft Edge' : 'Google Chrome';
}

function userDataDir(browser) {
  if (process.platform === 'darwin') {
    return browser === 'edge'
      ? path.join(os.homedir(), 'Library/Application Support/Microsoft Edge')
      : path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
  }
  if (process.platform === 'linux') {
    return browser === 'edge'
      ? path.join(os.homedir(), '.config/microsoft-edge')
      : path.join(os.homedir(), '.config/google-chrome');
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return browser === 'edge'
      ? path.join(localAppData, 'Microsoft/Edge/User Data')
      : path.join(localAppData, 'Google/Chrome/User Data');
  }
  throw new Error(`Unsupported platform: ${process.platform}`);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function profilePreferenceFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && (entry.name === 'Default' || /^Profile \d+$/.test(entry.name)))
    .map((entry) => path.join(root, entry.name, 'Preferences'));
}

async function detectExtensionIds(browser) {
  const root = userDataDir(browser);
  const preferenceFiles = await profilePreferenceFiles(root);
  const expectedPath = path.resolve(extensionDir);
  const candidates = [];

  for (const preferencesPath of preferenceFiles) {
    const preferences = await readJson(preferencesPath);
    const settings = preferences?.extensions?.settings || {};
    for (const [id, setting] of Object.entries(settings)) {
      const installedPath = setting?.path ? path.resolve(setting.path) : null;
      const manifestName = setting?.manifest?.name;
      if (installedPath === expectedPath || manifestName === EXTENSION_NAME) {
        candidates.push({ id, profile: path.basename(path.dirname(preferencesPath)), path: installedPath });
      }
    }
  }

  return candidates;
}

function printLoadInstructions(browser) {
  console.log(`Load the extension in ${browserLabel(browser)} first:`);
  console.log('');
  console.log('1. Open the browser extensions page.');
  console.log('   Chrome: chrome://extensions');
  console.log('   Edge:   edge://extensions');
  console.log('2. Enable Developer mode.');
  console.log(`3. Click "Load unpacked" and choose: ${extensionDir}`);
  console.log('4. Re-run this setup command, or pass the extension ID with --extension-id.');
}

const args = parseArgs(process.argv.slice(2));
let extensionId = args.extensionId;
if (!extensionId) {
  const candidates = await detectExtensionIds(args.browser);
  if (candidates.length === 1) {
    extensionId = candidates[0].id;
    console.log(`Detected extension ${extensionId} in ${browserLabel(args.browser)} profile ${candidates[0].profile}.`);
  } else if (candidates.length > 1) {
    console.error('Multiple matching unpacked extensions were found. Re-run with one extension ID:');
    for (const candidate of candidates) {
      console.error(`- ${candidate.id} (${candidate.profile})`);
    }
    process.exit(1);
  } else {
    printLoadInstructions(args.browser);
    process.exit(1);
  }
}

const { stdout, stderr } = await execFileAsync(process.execPath, [
  installScript,
  '--browser',
  args.browser,
  '--extension-id',
  extensionId,
]);
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);

console.log('');
console.log('Setup complete. Restart the browser or click the extension icon once, then run Claude Code with:');
console.log('claude --plugin-dir .');
