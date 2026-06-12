import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE_URL = 'https://www.dianping.com/shanghai/ch10/r101837';
const DEFAULT_OUT_DIR = 'data/restaurants';
const DEFAULT_PAGES = 1;
const DEFAULT_LIMIT = Number.POSITIVE_INFINITY;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_DIR = path.resolve(__dirname, '..');

function defaultCwd() {
  if (typeof process !== 'undefined' && typeof process.cwd === 'function') return process.cwd();
  if (typeof nodeRepl !== 'undefined' && nodeRepl.cwd) return nodeRepl.cwd;
  if (globalThis.nodeRepl?.cwd) return globalThis.nodeRepl.cwd;
  return '.';
}

function safePathSegment(value, fallback) {
  return String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

export function cityFromBaseUrl(baseUrl = DEFAULT_BASE_URL) {
  try {
    return new URL(baseUrl).pathname.split('/').filter(Boolean)[0] || 'unknown-city';
  } catch {
    return 'unknown-city';
  }
}

export function stationDataDir(baseOutDir, stationConfig, baseUrl = DEFAULT_BASE_URL) {
  const city = safePathSegment(stationConfig?.city || cityFromBaseUrl(baseUrl), 'unknown-city');
  const station = safePathSegment(stationConfig?.station_name, 'unknown-station');
  return path.join(baseOutDir, city, station);
}

export function snapshotFileName(scanId) {
  return `${scanId.replace(/[:.]/g, '-')}.json`;
}

export function resolveOutDir(outDir = DEFAULT_OUT_DIR, cwd = defaultCwd()) {
  return path.isAbsolute(outDir) ? outDir : path.resolve(cwd, outDir);
}

export async function readStationConfig(options = {}) {
  const cwd = options.cwd || defaultCwd();
  const configPath = options.configPath
    ? path.resolve(cwd, options.configPath)
    : path.resolve(cwd, DEFAULT_OUT_DIR, 'station.json');
  try {
    return JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeStationConfig(config, options = {}) {
  const cwd = options.cwd || defaultCwd();
  const outDir = resolveOutDir(options.outDir || DEFAULT_OUT_DIR, cwd);
  await fs.mkdir(outDir, { recursive: true });
  const configPath = path.join(outDir, 'station.json');
  const payload = {
    address: config.address || null,
    city: config.city || cityFromBaseUrl(config.base_url || config.url || DEFAULT_BASE_URL),
    station_name: config.station_name || null,
    line_name: config.line_name || null,
    base_url: config.base_url || config.url || DEFAULT_BASE_URL,
    notes: config.notes || null,
    updated_at: new Date().toISOString(),
  };
  await fs.writeFile(configPath, `${JSON.stringify(payload, null, 2)}\n`);
  return { configPath, config: payload };
}

export function listingPageUrl(baseUrl, pageNumber) {
  if (pageNumber === 1) return baseUrl;
  return `${baseUrl}d500p${pageNumber}`;
}

export function parseOffers(lines) {
  const offers = [];
  const stopMarkers = new Set(['推荐菜', '菜单', '评价', '商户信息']);
  const flagSet = new Set(['今日可用', '随时退', '过期自动退']);
  const actionSet = new Set(['买券', '抢购']);

  const collect = (startIndex, type) => {
    if (startIndex < 0) return;
    let i = startIndex + 1;
    while (i < lines.length) {
      if (stopMarkers.has(lines[i]) || (type === 'voucher' && lines[i] === '团购套餐')) break;

      const title = lines[i];
      if (
        !title ||
        title.includes('¥') ||
        title.includes('￥') ||
        flagSet.has(title) ||
        actionSet.has(title) ||
        /^[0-9]+(?:\.[0-9]+)?折$/.test(title) ||
        /^[0-9]+(?:\.[0-9]+)?$/.test(title)
      ) {
        i += 1;
        continue;
      }

      let j = i + 1;
      const flags = [];
      while (flagSet.has(lines[j])) {
        flags.push(lines[j]);
        j += 1;
      }

      let price = null;
      if (lines[j] === '¥' && /^[0-9]+(?:\.[0-9]+)?$/.test(lines[j + 1] || '')) {
        price = Number(lines[j + 1]);
        j += 2;
      } else if ((lines[j] || '').startsWith('¥')) {
        const match = lines[j].match(/¥\s*([0-9]+(?:\.[0-9]+)?)/);
        price = match ? Number(match[1]) : null;
        j += 1;
      }

      if (price === null) {
        i += 1;
        continue;
      }

      const discount = /^[0-9]+(?:\.[0-9]+)?折$/.test(lines[j] || '') ? lines[j++] : null;
      const original_price = /^￥\s*[0-9]+(?:\.[0-9]+)?$/.test(lines[j] || '')
        ? Number(lines[j++].replace(/^￥\s*/, ''))
        : null;
      if (actionSet.has(lines[j])) j += 1;

      offers.push({
        type,
        title: title.replace(/[>›]$/, '').trim(),
        price,
        currency: 'CNY',
        discount,
        original_price,
        flags,
        raw_text: lines.slice(i, j).join(' '),
      });
      i = j;
    }
  };

  collect(lines.indexOf('代金券'), 'voucher');
  collect(lines.indexOf('团购套餐'), 'taocan');
  return offers;
}

export async function extractListingShops(tab, pageNumber, pageUrl) {
  await tab.goto(pageUrl);
  await tab.playwright.waitForLoadState({ state: 'domcontentloaded', timeoutMs: 15000 });
  const shops = await tab.playwright.evaluate(() => {
    const anchors = [...document.querySelectorAll('a[href*="/shop/"]')];
    const seen = new Set();
    const result = [];
    for (const a of anchors) {
      const href = new URL(a.href, location.href);
      if (!/^\/shop\/[^/]+$/.test(href.pathname)) continue;
      const text = a.innerText.trim();
      if (!text || text.includes('条评价') || text.includes('人均')) continue;
      if (seen.has(href.pathname)) continue;
      seen.add(href.pathname);
      result.push({ name: text, url: href.origin + href.pathname });
    }
    return result;
  }, undefined, { timeoutMs: 15000 });

  return shops.map((shop, index) => ({
    ...shop,
    source: {
      page_url: pageUrl,
      page_number: pageNumber,
      result_index: index + 1,
    },
  }));
}

export async function extractShopRecord(browser, shop, scanId, baseUrl) {
  const startedAt = Date.now();
  const tab = await browser.tabs.new();
  try {
    await tab.goto(shop.url);
    await tab.playwright.waitForLoadState({ state: 'domcontentloaded', timeoutMs: 15000 });
    const page = await tab.playwright.evaluate(() => {
      const lines = document.body.innerText
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
      return { title: document.title, href: location.href, lines };
    }, undefined, { timeoutMs: 15000 });

    const lines = page.lines;
    const verificationRequired = lines.some((line) => line.includes('身份核实') || line.includes('滑块'));
    const detailsHidden = lines.some((line) => line.includes('打开大众点评App查看'));
    const addressIndex = lines.findIndex((line) => /^.+[0-9]+号/.test(line));
    const shopId = new URL(shop.url).pathname.split('/').pop();

    return {
      scan_id: scanId,
      source: {
        base_url: baseUrl,
        ...shop.source,
      },
      shop: {
        name: lines.find((line) => line === shop.name) || shop.name,
        url: page.href,
        shop_id: shopId,
        address: addressIndex >= 0 ? lines[addressIndex] : null,
      },
      offers: verificationRequired || detailsHidden ? [] : parseOffers(lines),
      extraction: {
        status: verificationRequired ? 'verification_required' : 'ok',
        details_hidden: detailsHidden,
        captured_at: new Date().toISOString(),
        method: 'codex-extension',
        elapsed_ms: Date.now() - startedAt,
      },
    };
  } finally {
    await tab.close().catch(() => {});
  }
}

export async function runScan(options = {}) {
  if (!options.browser) {
    throw new Error('runScan requires a Codex extension-backed browser object.');
  }

  const cwd = options.cwd || defaultCwd();
  const stationConfig = options.baseUrl ? null : await readStationConfig({ cwd, configPath: options.configPath });
  const baseUrl = options.baseUrl || stationConfig?.base_url || DEFAULT_BASE_URL;
  const pages = Number(options.pages || DEFAULT_PAGES);
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : DEFAULT_LIMIT;
  const outDir = resolveOutDir(options.outDir || DEFAULT_OUT_DIR, cwd);
  const scanId = options.scanId || new Date().toISOString();

  const seen = new Set();
  const shops = [];
  const listingTab = await options.browser.tabs.new();
  try {
    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      const pageUrl = listingPageUrl(baseUrl, pageNumber);
      const pageShops = await extractListingShops(listingTab, pageNumber, pageUrl);
      for (const shop of pageShops) {
        if (seen.has(shop.url)) continue;
        seen.add(shop.url);
        shops.push(shop);
        if (shops.length >= limit) break;
      }
      if (shops.length >= limit) break;
    }
  } finally {
    await listingTab.close().catch(() => {});
  }

  const records = [];
  for (const shop of shops) {
    records.push(await extractShopRecord(options.browser, shop, scanId, baseUrl));
  }

  const paths = await persistScan({
    outDir,
    scanId,
    baseUrl,
    stationConfig,
    records,
  });

  return {
    scan_id: scanId,
    base_url: baseUrl,
    pages,
    scanned_shops: records.length,
    shops_with_taocan: records.filter((record) => record.offers.some((offer) => offer.type === 'taocan')).length,
    paths,
    records,
  };
}

export async function persistScan({ outDir, scanId, baseUrl, stationConfig, records }) {
  const effectiveStationConfig = stationConfig || {
    city: cityFromBaseUrl(baseUrl),
    station_name: 'unknown-station',
    base_url: baseUrl,
  };
  const stationDir = stationDataDir(outDir, effectiveStationConfig, baseUrl);
  await fs.mkdir(stationDir, { recursive: true });
  const snapshotPath = path.join(stationDir, snapshotFileName(scanId));
  const latestPath = path.join(stationDir, 'latest.json');
  const stationConfigPath = path.join(stationDir, 'station.json');

  const latest = {
    scan_id: scanId,
    base_url: baseUrl,
    station: effectiveStationConfig,
    updated_at: new Date().toISOString(),
    count: records.length,
    shops_with_taocan: records.filter((record) => record.offers.some((offer) => offer.type === 'taocan')).length,
    records,
  };
  await fs.writeFile(stationConfigPath, `${JSON.stringify(effectiveStationConfig, null, 2)}\n`);
  await fs.writeFile(snapshotPath, `${JSON.stringify(latest, null, 2)}\n`);
  await fs.writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`);

  return { stationDir, stationConfigPath, snapshotPath, latestPath };
}

export function skillDir() {
  return SKILL_DIR;
}
