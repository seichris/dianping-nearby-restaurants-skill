#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_FILE = 'data/restaurants/latest.json';
const DEFAULT_DATA_DIR = 'data/restaurants';

function usage() {
  return `Usage: node view-dianping-taocan.mjs [options]

Options:
  --file <path>       Read a specific latest.json file. Default: newest station latest.json
  --all               Include shops with no saved offers.
  --taocan-only       Show only shops with taocan. Default shows taocan and vouchers.
  --new               Show only offers not seen in earlier snapshots.
  --json              Print filtered records as JSON.
  --help              Show this help.
`;
}

function parseArgs(argv) {
  const args = {
    file: DEFAULT_FILE,
    fileProvided: false,
    includeAll: false,
    taocanOnly: false,
    newOnly: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file') {
      args.file = argv[++i];
      args.fileProvided = true;
    } else if (arg === '--all') {
      args.includeAll = true;
    } else if (arg === '--taocan-only') {
      args.taocanOnly = true;
    } else if (arg === '--new') {
      args.newOnly = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
}

async function collectLatestFiles(dir) {
  const latestFiles = [];

  async function walk(currentDir) {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile() && entry.name === 'latest.json') {
        const stat = await fs.stat(entryPath);
        latestFiles.push({ path: entryPath, mtimeMs: stat.mtimeMs });
      }
    }
  }

  await walk(dir);
  return latestFiles;
}

async function resolveLatestFile(args) {
  const requestedPath = path.resolve(process.cwd(), args.file);
  if (args.fileProvided) return requestedPath;

  const dataDir = path.resolve(process.cwd(), DEFAULT_DATA_DIR);
  const latestFiles = (await collectLatestFiles(dataDir))
    .filter((entry) => entry.path !== requestedPath);
  if (latestFiles.length === 0) return requestedPath;

  latestFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return latestFiles[0].path;
}

function offerMatches(offer, args) {
  if (args.taocanOnly) return offer.type === 'taocan';
  return offer.type === 'taocan' || offer.type === 'voucher';
}

function filterRecords(records, args) {
  if (args.includeAll) return records;
  return records
    .map((record) => ({
      ...record,
      offers: record.offers.filter((offer) => offerMatches(offer, args)),
    }))
    .filter((record) => record.offers.length > 0);
}

function offerKey(record, offer) {
  return [
    record.shop.shop_id || record.shop.url,
    offer.type,
    offer.title,
    offer.price,
    offer.original_price || '',
  ].join('\t');
}

async function readPreviousOfferKeys(latestPath, latestScanId) {
  const dir = path.dirname(latestPath);
  const legacyRootDir = path.resolve(dir, '..', '..');
  const historyDirs = [...new Set([dir, legacyRootDir])];
  const historyFiles = [];

  for (const historyDir of historyDirs) {
    let entries;
    try {
      entries = await fs.readdir(historyDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    historyFiles.push(...entries
      .filter((entry) => entry.isFile() && (
        /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name) ||
        (/^\d{4}-\d{2}-\d{2}T.+\.json$/.test(entry.name) && entry.name !== 'latest.json')
      ))
      .map((entry) => path.join(historyDir, entry.name)));
  }

  historyFiles.sort();
  const keys = new Set();

  for (const historyFile of historyFiles) {
    const text = await fs.readFile(historyFile, 'utf8');
    if (historyFile.endsWith('.jsonl')) {
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const record = JSON.parse(line);
        if (record.scan_id === latestScanId) continue;
        for (const offer of record.offers || []) {
          keys.add(offerKey(record, offer));
        }
      }
      continue;
    }

    const snapshot = JSON.parse(text);
    if (snapshot.scan_id === latestScanId) continue;
    for (const record of snapshot.records || []) {
      if (record.scan_id === latestScanId) continue;
      for (const offer of record.offers || []) {
        keys.add(offerKey(record, offer));
      }
    }
  }

  return keys;
}

function filterNewOffers(records, previousOfferKeys) {
  return records
    .map((record) => ({
      ...record,
      offers: record.offers.filter((offer) => !previousOfferKeys.has(offerKey(record, offer))),
    }))
    .filter((record) => record.offers.length > 0);
}

function formatOffer(offer) {
  const kind = offer.type === 'taocan' ? 'taocan' : 'voucher';
  const bits = [`${kind}: ${offer.title}`, `¥${offer.price}`];
  if (offer.discount) bits.push(offer.discount);
  if (offer.original_price) bits.push(`was ¥${offer.original_price}`);
  if (offer.flags?.length) bits.push(offer.flags.join('/'));
  return bits.join(' | ');
}

function printHuman(data, records) {
  const station = data.station?.station_name
    ? `${data.station.station_name}${data.station.line_name ? ` (${data.station.line_name})` : ''}`
    : data.base_url;

  console.log(`Dianping taocan snapshot: ${data.updated_at || data.scan_id}`);
  console.log(`Station/listing: ${station}`);
  console.log(`Showing ${records.length} shop${records.length === 1 ? '' : 's'}`);
  console.log('');

  for (const record of records) {
    console.log(record.shop.name);
    if (record.shop.address) console.log(`  Address: ${record.shop.address}`);
    console.log(`  URL: ${record.shop.url}`);
    if (record.offers.length === 0) {
      console.log('  Offers: none saved');
    } else {
      for (const offer of record.offers) {
        console.log(`  - ${formatOffer(offer)}`);
      }
    }
    console.log('');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const filePath = await resolveLatestFile(args);
  const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
  let records = filterRecords(data.records || [], args);
  if (args.newOnly) {
    const previousOfferKeys = await readPreviousOfferKeys(filePath, data.scan_id);
    records = filterNewOffers(records, previousOfferKeys);
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
    return;
  }

  printHuman(data, records);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
