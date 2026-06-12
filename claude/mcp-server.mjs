#!/usr/bin/env node
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  runScan,
  resolveOutDir,
} from '../scripts/scan-dianping-taocan.mjs';

const execFileAsync = promisify(execFile);
const SERVER_VERSION = '0.1.0';
const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const projectDir = process.env.CLAUDE_PROJECT_DIR || repoRoot;
const socketPath = process.env.DIANPING_BROWSER_BRIDGE_SOCKET ||
  path.join(os.tmpdir(), 'dianping-nearby-restaurants-bridge.sock');

let requestBuffer = '';

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function ok(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message, data = undefined) {
  send({ jsonrpc: '2.0', id, error: { code, message, data } });
}

function contentText(value) {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function bridgeRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let buffer = '';

    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) return;
      const line = buffer.slice(0, newlineIndex);
      socket.end();
      const response = JSON.parse(line);
      if (response.error) reject(new Error(response.error.message || 'Browser bridge request failed.'));
      else resolve(response.result);
    });
    socket.on('error', (error) => {
      reject(new Error(`Browser bridge is not connected at ${socketPath}. Load the extension and install the native host first. ${error.message}`));
    });
  });
}

class ClaudeBridgeTab {
  constructor(tabId) {
    this.tabId = tabId;
    this.playwright = {
      waitForLoadState: async () => {},
      evaluate: async (fn) => bridgeRequest('evaluate', {
        tabId: this.tabId,
        source: fn.toString(),
      }),
    };
  }

  async goto(url) {
    await bridgeRequest('navigate', { tabId: this.tabId, url, active: false });
  }

  async close() {
    await bridgeRequest('closeTab', { tabId: this.tabId }).catch(() => {});
  }
}

function createBridgeBrowser() {
  return {
    tabs: {
      async new() {
        const { tabId } = await bridgeRequest('createTab', { active: false });
        return new ClaudeBridgeTab(tabId);
      },
      async finalize() {},
    },
  };
}

async function resolveStationUrl(args) {
  if (args.base_url) return { base_url: args.base_url, source: 'provided' };
  const city = args.city || 'shanghai';
  const stationName = args.station_name;
  if (!stationName) throw new Error('station_name is required when base_url is not supplied.');

  const browser = createBridgeBrowser();
  const tab = await browser.tabs.new();
  try {
    await tab.goto(`https://www.dianping.com/${city}/ch10/d1`);
    const firstLinks = await tab.playwright.evaluate(() => [...document.querySelectorAll('a')]
      .map((a) => ({ text: a.innerText.trim(), href: a.href }))
      .filter((link) => link.text && link.href));

    const direct = firstLinks.find((link) => link.text === stationName);
    if (direct) return { base_url: direct.href.replace(/^http:/, 'https:'), source: 'station-link' };

    let lineLinks = [];
    if (args.line_name) {
      const lineLink = firstLinks.find((link) => link.text === args.line_name);
      if (lineLink) lineLinks = [lineLink];
    } else {
      lineLinks = firstLinks.filter((link) => /号线$/.test(link.text));
    }
    if (lineLinks.length === 0) throw new Error(`Could not find a metro line link for ${city} ${stationName}.`);

    const attemptedLines = [];
    for (const lineLink of lineLinks) {
      attemptedLines.push(lineLink.text);
      await tab.goto(lineLink.href.replace(/^http:/, 'https:'));
      const stationLinks = await tab.playwright.evaluate(() => [...document.querySelectorAll('a')]
        .map((a) => ({ text: a.innerText.trim(), href: a.href }))
        .filter((link) => link.text && link.href));
      const stationLink = stationLinks.find((link) => link.text === stationName);
      if (stationLink) {
        return {
          base_url: stationLink.href.replace(/^http:/, 'https:'),
          line_name: args.line_name || lineLink.text,
          source: 'metro-filter',
        };
      }
    }
    throw new Error(`Could not find station ${stationName} on metro lines: ${attemptedLines.join(', ')}.`);
  } finally {
    await tab.close();
  }
}

async function scanRestaurants(args) {
  const resolved = await resolveStationUrl(args);
  const stationConfig = {
    city: args.city || 'shanghai',
    station_name: args.station_name,
    line_name: args.line_name || resolved.line_name || null,
    base_url: resolved.base_url,
    notes: args.notes || null,
  };
  const result = await runScan({
    browser: createBridgeBrowser(),
    cwd: projectDir,
    pages: args.pages || 1,
    limit: args.limit || 10,
    baseUrl: resolved.base_url,
    stationConfig,
  });
  return {
    scan_id: result.scan_id,
    base_url: result.base_url,
    scanned_shops: result.scanned_shops,
    shops_with_taocan: result.shops_with_taocan,
    paths: result.paths,
  };
}

async function queryRestaurants(args) {
  const outDir = resolveOutDir(args.outDir || 'data/restaurants', projectDir);
  let latestPath;
  if (args.city && args.station_name) {
    latestPath = path.join(outDir, args.city, args.station_name, 'latest.json');
  } else if (args.file) {
    latestPath = path.resolve(projectDir, args.file);
  } else {
    throw new Error('Provide city and station_name, or file.');
  }

  const data = JSON.parse(await fs.readFile(latestPath, 'utf8'));
  let records = data.records || [];
  if (args.taocan_only) {
    records = records.filter((record) => (record.offers || []).some((offer) => offer.type === 'taocan'));
  }
  if (args.has_offers) {
    records = records.filter((record) => (record.offers || []).length > 0);
  }
  if (args.limit) records = records.slice(0, args.limit);

  return {
    scan_id: data.scan_id,
    updated_at: data.updated_at,
    station: data.station,
    count: records.length,
    records,
  };
}

async function publishScan(args) {
  const outDir = resolveOutDir(args.outDir || 'data/restaurants', projectDir);
  const stationDir = args.stationDir || path.join(outDir, args.city, args.station_name);
  await execFileAsync('git', ['pull', '--rebase', 'origin', 'main'], { cwd: projectDir });
  await execFileAsync('git', ['add', stationDir], { cwd: projectDir });
  const { stdout: diffStdout } = await execFileAsync('git', ['diff', '--cached', '--name-only'], { cwd: projectDir });
  const files = diffStdout.trim().split('\n').filter(Boolean);
  if (files.length === 0) return { committed: false, pushed: false, files };
  const message = args.message || `Update ${args.city || ''} ${args.station_name || ''} restaurant snapshot`.trim();
  await execFileAsync('git', ['commit', '-m', message], { cwd: projectDir });
  await execFileAsync('git', ['push', 'origin', 'HEAD'], { cwd: projectDir });
  const { stdout: head } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: projectDir });
  return { committed: true, pushed: true, commit: head.trim(), files };
}

const tools = [
  {
    name: 'browser_healthcheck',
    description: 'Check whether the Dianping browser bridge extension and native host are connected.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'resolve_station_url',
    description: 'Resolve a Dianping subway station restaurant listing URL.',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string' },
        station_name: { type: 'string' },
        line_name: { type: 'string' },
        base_url: { type: 'string' },
      },
      required: ['station_name'],
    },
  },
  {
    name: 'scan_restaurants',
    description: 'Scan Dianping restaurants for a city/station and save latest plus timestamped JSON snapshots.',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string' },
        station_name: { type: 'string' },
        line_name: { type: 'string' },
        base_url: { type: 'string' },
        pages: { type: 'number' },
        limit: { type: 'number' },
        notes: { type: 'string' },
      },
      required: ['city', 'station_name'],
    },
  },
  {
    name: 'query_restaurants',
    description: 'Read saved restaurant data from latest.json.',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string' },
        station_name: { type: 'string' },
        file: { type: 'string' },
        taocan_only: { type: 'boolean' },
        has_offers: { type: 'boolean' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'publish_scan',
    description: 'Commit and push a station data directory after a successful scan.',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string' },
        station_name: { type: 'string' },
        stationDir: { type: 'string' },
        message: { type: 'string' },
      },
    },
  },
];

async function callTool(name, args = {}) {
  if (name === 'browser_healthcheck') {
    return bridgeRequest('healthcheck').then((result) => ({ connected: true, result }));
  }
  if (name === 'resolve_station_url') return resolveStationUrl(args);
  if (name === 'scan_restaurants') return scanRestaurants(args);
  if (name === 'query_restaurants') return queryRestaurants(args);
  if (name === 'publish_scan') return publishScan(args);
  throw new Error(`Unknown tool: ${name}`);
}

async function handleRequest(request) {
  if (request.method === 'initialize') {
    ok(request.id, {
      protocolVersion: request.params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'dianping-restaurants', version: SERVER_VERSION },
    });
    return;
  }
  if (request.method === 'tools/list') {
    ok(request.id, { tools });
    return;
  }
  if (request.method === 'tools/call') {
    try {
      const result = await callTool(request.params?.name, request.params?.arguments || {});
      ok(request.id, contentText(result));
    } catch (error) {
      ok(request.id, {
        content: [{ type: 'text', text: error.message }],
        isError: true,
      });
    }
    return;
  }
  if (request.id !== undefined) fail(request.id, -32601, `Unsupported method: ${request.method}`);
}

process.stdin.on('data', (chunk) => {
  requestBuffer += chunk.toString('utf8');
  let newlineIndex;
  while ((newlineIndex = requestBuffer.indexOf('\n')) >= 0) {
    const line = requestBuffer.slice(0, newlineIndex).trim();
    requestBuffer = requestBuffer.slice(newlineIndex + 1);
    if (!line) continue;
    try {
      const request = JSON.parse(line);
      handleRequest(request).catch((error) => fail(request.id, -32603, error.message));
    } catch (error) {
      fail(null, -32700, error.message);
    }
  }
});
