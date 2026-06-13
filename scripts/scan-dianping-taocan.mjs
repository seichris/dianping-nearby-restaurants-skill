import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinyin } from 'pinyin-pro';

const DEFAULT_BASE_URL = 'https://www.dianping.com/shanghai/ch10/r101837';
const DEFAULT_OUT_DIR = 'data/restaurants';
const DEFAULT_PAGES = 3;
const DEFAULT_LIMIT = Number.POSITIVE_INFINITY;
const KNOWN_CATEGORIES = [
  '本帮江浙菜',
  '东南亚菜',
  '意大利菜',
  '日本料理',
  '韩国料理',
  '面包甜点',
  '小吃快餐',
  '潮汕牛肉火锅',
  '茶餐厅',
  '自助餐',
  '西班牙菜',
  '西餐',
  '咖啡',
  '火锅',
  '烧烤',
  '小笼',
  '酒吧',
  '川菜',
  '粤菜',
  '湘菜',
  '素菜',
  '海鲜',
  '小吃',
  '快餐',
  '面馆',
  '甜品',
  '饮品',
].sort((a, b) => b.length - a.length);
const AMENITY_MARKERS = new Set([
  '有大桌',
  '付费停车',
  '免费停车',
  '有宝宝椅',
  '有包间',
  '可外带',
  '可订座',
  '可刷卡',
  '有Wi-Fi',
  '有WIFI',
]);

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

export function sanitizeStationConfig(config) {
  if (!config) return null;
  const safeConfig = { ...config };
  delete safeConfig.address;
  return safeConfig;
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
  const payload = sanitizeStationConfig({
    city: config.city || cityFromBaseUrl(config.base_url || config.url || DEFAULT_BASE_URL),
    station_name: config.station_name || null,
    line_name: config.line_name || null,
    base_url: config.base_url || config.url || DEFAULT_BASE_URL,
    notes: config.notes || null,
    updated_at: new Date().toISOString(),
  });
  await fs.writeFile(configPath, `${JSON.stringify(payload, null, 2)}\n`);
  return { configPath, config: payload };
}

export function canonicalListingBaseUrl(baseUrl = DEFAULT_BASE_URL) {
  try {
    const url = new URL(baseUrl);
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname
      .replace(/d500p[0-9]+\/?$/, '')
      .replace(/\/+$/, '');
    return url.toString();
  } catch {
    return String(baseUrl)
      .split(/[?#]/)[0]
      .replace(/d500p[0-9]+\/?$/, '')
      .replace(/\/+$/, '');
  }
}

export function listingPageUrl(baseUrl, pageNumber) {
  const cleanBaseUrl = canonicalListingBaseUrl(baseUrl);
  if (pageNumber === 1) return cleanBaseUrl;
  return `${cleanBaseUrl}d500p${pageNumber}`;
}

function parseNumber(value) {
  if (!value) return null;
  const normalized = String(value).replace(/,/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function toPinyin(value) {
  if (!value || typeof value !== 'string') return null;
  return pinyin(value, { toneType: 'none', nonZh: 'consecutive' })
    .replace(/\b(\d) (?=\d\b)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function parseAreaCategory(value) {
  if (!value) return { area: null, category: null };
  for (const category of KNOWN_CATEGORIES) {
    if (value.endsWith(category) && value.length > category.length) {
      const area = value.slice(0, -category.length).replace(/[/-]+$/g, '') || null;
      return { area, category };
    }
  }
  if (value.includes('/')) {
    const parts = value.split('/');
    return {
      area: parts.slice(0, -1).join('/') || null,
      category: parts.at(-1) || null,
    };
  }
  return { area: null, category: value };
}

function parseScoreBreakdown(line) {
  const scores = {};
  for (const [, key, value] of line.matchAll(/(口味|环境|服务):([0-9]+(?:\.[0-9]+)?)/g)) {
    scores[key] = Number(value);
  }
  return Object.keys(scores).length > 0 ? scores : null;
}

function parseDistance(line) {
  const match = line.match(/距地铁(.+?站.*?)步行([0-9]+(?:\.[0-9]+)?)(m|米|km|公里)/i);
  if (!match) return null;
  const value = Number(match[2]);
  const meters = match[3].toLowerCase() === 'km' || match[3] === '公里' ? value * 1000 : value;
  return {
    raw_text: line,
    transit_text: match[1],
    walking_distance_meters: Math.round(meters),
  };
}

function parseRecommendedDishes(lines) {
  const start = lines.indexOf('推荐菜');
  if (start < 0) return [];
  const dishes = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('去大众点评App查看') || line.startsWith('菜单') || line === '评价' || line.startsWith('评价(')) break;
    if (
      line === '查看更多' ||
      /^网友推荐\([0-9]+\)$/.test(line) ||
      /^[0-9]+人推荐$/.test(line) ||
      line.length > 30
    ) {
      continue;
    }
    dishes.push(line);
    if (dishes.length >= 12) break;
  }
  return dishes;
}

function parseCountAfterLabel(lines, label) {
  const line = lines.find((candidate) => candidate.startsWith(label));
  const match = line?.match(/\(([0-9,]+)\)/);
  return match ? parseNumber(match[1]) : null;
}

export function parseShopMetadata(lines) {
  const reviewLineIndex = lines.findIndex((line) => /[0-9,]+条(?:评价)?(?:¥[0-9]+(?:\.[0-9]+)?\/人)?/.test(line));
  const reviewLine = reviewLineIndex >= 0 ? lines[reviewLineIndex] : null;
  const reviewMatch = reviewLine?.match(/([0-9,]+)条(?:评价)?(?:¥([0-9]+(?:\.[0-9]+)?)\/人)?/);
  const rating = lines
    .slice(Math.max(0, reviewLineIndex - 8), reviewLineIndex >= 0 ? reviewLineIndex : 0)
    .map((line) => line.match(/^([0-5](?:\.[0-9]+)?)$/)?.[1])
    .filter(Boolean)
    .map(Number)
    .find((value) => value >= 0 && value <= 5) || null;
  const areaCategoryLine = reviewLineIndex >= 0 ? lines[reviewLineIndex + 1] : null;
  const { area, category } = parseAreaCategory(areaCategoryLine);
  const scoreBreakdown = lines.map(parseScoreBreakdown).find(Boolean) || null;
  const openingLine = lines.find((line) => /^(营业中|休息中|尚未营业|已打烊|暂停营业)/.test(line));
  const openingMatch = openingLine?.match(/^(营业中|休息中|尚未营业|已打烊|暂停营业)\s*(.*)$/);
  const distance = lines.map(parseDistance).find(Boolean) || null;
  const amenities = lines.filter((line) => AMENITY_MARKERS.has(line));

  return {
    rating,
    review_count: reviewMatch ? parseNumber(reviewMatch[1]) : null,
    avg_price_per_person: reviewMatch?.[2] ? Number(reviewMatch[2]) : null,
    area,
    category,
    score_breakdown: scoreBreakdown,
    ranking_badge: lines.find((line) => line.includes('榜') && /第[0-9]+名/.test(line)) || null,
    open_status: openingMatch?.[1] || null,
    opening_hours: openingMatch?.[2] || null,
    distance_from_station: distance,
    amenities,
    recommended_dishes: parseRecommendedDishes(lines),
    menu_count: parseCountAfterLabel(lines, '菜单'),
    review_section_count: parseCountAfterLabel(lines, '评价'),
  };
}

function parseOfferDetails(title, lines) {
  const validTime = lines.find((line) => /^周[周一二三四五六日至、-]+$/.test(line) || /^[0-9]{1,2}:[0-9]{2}-[0-9]{1,2}:[0-9]{2}$/.test(line)) || null;
  const earliestUsable = lines.find((line) => /^最早[0-9]{2}\.[0-9]{2}可用$/.test(line)) || null;
  const groupSizeMatch = title.match(/(单人|双人|[0-9]+-[0-9]+人|[0-9]+人)/);
  return {
    group_size: groupSizeMatch?.[1] || null,
    valid_time: validTime,
    earliest_usable: earliestUsable,
  };
}

function findOfferImageUrl(offer, candidates = []) {
  if (!offer?.title) return null;
  const priceText = offer.price === null || offer.price === undefined ? null : String(offer.price);
  const match = candidates.find((candidate) => {
    if (!candidate?.image_url || !candidate.text?.includes(offer.title)) return false;
    return !priceText || candidate.text.includes(priceText);
  });
  return match?.image_url || null;
}

function isOfferDetailLine(line, flagSet) {
  return flagSet.has(line) ||
    /^周[周一二三四五六日至、-]+$/.test(line) ||
    /^[0-9]{1,2}:[0-9]{2}-[0-9]{1,2}:[0-9]{2}$/.test(line) ||
    /^最早[0-9]{2}\.[0-9]{2}可用$/.test(line) ||
    /^限用[0-9]+张$/.test(line) ||
    /^每.*限用[0-9]+张$/.test(line) ||
    /^不可叠加/.test(line);
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
        isOfferDetailLine(title, flagSet) ||
        actionSet.has(title) ||
        /^[0-9]+(?:\.[0-9]+)?折$/.test(title) ||
        /^[0-9]+(?:\.[0-9]+)?$/.test(title)
      ) {
        i += 1;
        continue;
      }

      let j = i + 1;
      const flags = [];
      while (isOfferDetailLine(lines[j], flagSet)) {
        if (flagSet.has(lines[j])) flags.push(lines[j]);
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

      const rawLines = lines.slice(i, j);
      offers.push({
        type,
        title: title.replace(/[>›]$/, '').trim(),
        price,
        currency: 'CNY',
        discount,
        original_price,
        flags,
        details: parseOfferDetails(title, rawLines),
        raw_text: rawLines.join(' '),
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
    const normalizeImageUrl = (value, baseUrl) => {
      if (!value || typeof value !== 'string') return null;
      const firstCandidate = value
        .split(',')
        .map((part) => part.trim().split(/\s+/)[0])
        .find(Boolean);
      if (!firstCandidate || firstCandidate.startsWith('data:')) return null;

      const styleMatch = firstCandidate.match(/url\(["']?([^"')]+)["']?\)/);
      const rawUrl = styleMatch?.[1] || firstCandidate;
      if (!rawUrl || rawUrl.startsWith('data:')) return null;

      try {
        return new URL(rawUrl, baseUrl).toString();
      } catch {
        if (rawUrl.startsWith('//')) return `https:${rawUrl}`;
        return null;
      }
    };

    const findImageUrl = (root, baseUrl) => {
      if (!root) return null;
      const imageSelectors = [
        'img[data-src]',
        'img[data-original]',
        'img[data-lazy-src]',
        'img[data-lazyload]',
        'img[srcset]',
        'img[src]',
      ];

      for (const selector of imageSelectors) {
        for (const image of root.querySelectorAll(selector)) {
          const imageUrl = normalizeImageUrl(
            image.getAttribute('data-src') ||
              image.getAttribute('data-original') ||
              image.getAttribute('data-lazy-src') ||
              image.getAttribute('data-lazyload') ||
              image.getAttribute('srcset') ||
              image.getAttribute('src'),
            baseUrl
          );
          if (imageUrl) return imageUrl;
        }
      }

      for (const element of root.querySelectorAll('[style*="background"]')) {
        const imageUrl = normalizeImageUrl(element.style.backgroundImage, baseUrl);
        if (imageUrl) return imageUrl;
      }

      return null;
    };

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
      const container = a.closest('li, .item, .shop-list-item, .shop-item, [class*="shop"], [class*="item"]') || a.parentElement;
      result.push({ name: text, url: href.origin + href.pathname, image_url: findImageUrl(container, location.href) });
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
      const normalizeImageUrl = (value, baseUrl) => {
        if (!value || typeof value !== 'string') return null;
        const firstCandidate = value
          .split(',')
          .map((part) => part.trim().split(/\s+/)[0])
          .find(Boolean);
        if (!firstCandidate || firstCandidate.startsWith('data:')) return null;

        const styleMatch = firstCandidate.match(/url\(["']?([^"')]+)["']?\)/);
        const rawUrl = styleMatch?.[1] || firstCandidate;
        if (!rawUrl || rawUrl.startsWith('data:')) return null;

        try {
          return new URL(rawUrl, baseUrl).toString();
        } catch {
          if (rawUrl.startsWith('//')) return `https:${rawUrl}`;
          return null;
        }
      };

      const findImageUrl = (root, baseUrl) => {
        if (!root) return null;
        const imageSelectors = [
          'img[data-src]',
          'img[data-original]',
          'img[data-lazy-src]',
          'img[data-lazyload]',
          'img[srcset]',
          'img[src]',
        ];

        for (const selector of imageSelectors) {
          for (const image of root.querySelectorAll(selector)) {
            const imageUrl = normalizeImageUrl(
              image.getAttribute('data-src') ||
                image.getAttribute('data-original') ||
                image.getAttribute('data-lazy-src') ||
                image.getAttribute('data-lazyload') ||
                image.getAttribute('srcset') ||
                image.getAttribute('src'),
              baseUrl
            );
            if (imageUrl) return imageUrl;
          }
        }

        for (const element of root.querySelectorAll('[style*="background"]')) {
          const imageUrl = normalizeImageUrl(element.style.backgroundImage, baseUrl);
          if (imageUrl) return imageUrl;
        }

        return null;
      };

      const offerImageCandidates = () => {
        const seen = new Set();
        return [...document.querySelectorAll('img, [style*="background"]')]
          .map((element) => {
            const container =
              element.closest(
                'li, .item, .shop-list-item, .shop-item, [class*="deal"], [class*="group"], [class*="coupon"], [class*="package"], [class*="promo"], [class*="offer"], [class*="item"]'
              ) || element.parentElement;
            const text = container?.innerText?.trim() || '';
            const imageUrl = findImageUrl(container, location.href);
            if (!text || !imageUrl || seen.has(`${text}:${imageUrl}`)) return null;
            seen.add(`${text}:${imageUrl}`);
            return { text, image_url: imageUrl };
          })
          .filter(Boolean);
      };

      const lines = document.body.innerText
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
      return {
        title: document.title,
        href: location.href,
        imageUrl: findImageUrl(document.body, location.href),
        offerImageCandidates: offerImageCandidates(),
        lines,
      };
    }, undefined, { timeoutMs: 15000 });

    const lines = page.lines;
    const verificationRequired = lines.some((line) => line.includes('身份核实') || line.includes('滑块'));
    const detailsHidden = lines.some((line) => line.includes('打开大众点评App查看'));
    const addressIndex = lines.findIndex((line) => /^.+[0-9]+号/.test(line));
    const address = addressIndex >= 0 ? lines[addressIndex] : null;
    const shopId = new URL(shop.url).pathname.split('/').pop();
    const metadata = parseShopMetadata(lines);
    const offers = verificationRequired
      ? []
      : parseOffers(lines).map((offer) => ({
        ...offer,
        image_url: findOfferImageUrl(offer, page.offerImageCandidates),
      }));
    const extractionStatus = verificationRequired
      ? 'verification_required'
      : detailsHidden && offers.length === 0
        ? 'details_hidden'
        : 'ok';

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
        image_url: shop.image_url || page.imageUrl || null,
        name_pinyin: toPinyin(lines.find((line) => line === shop.name) || shop.name),
        address,
        address_pinyin: toPinyin(address),
        ...metadata,
      },
      offers,
      extraction: {
        status: extractionStatus,
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
  const savedStationConfig = options.stationConfig || await readStationConfig({ cwd, configPath: options.configPath });
  const baseUrl = options.baseUrl || savedStationConfig?.base_url || DEFAULT_BASE_URL;
  const stationConfig = options.stationConfig || (
    !options.baseUrl ||
    (savedStationConfig?.base_url && canonicalListingBaseUrl(savedStationConfig.base_url) === canonicalListingBaseUrl(baseUrl))
      ? savedStationConfig
      : null
  );
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
  const effectiveStationConfig = sanitizeStationConfig(stationConfig || {
    city: cityFromBaseUrl(baseUrl),
    station_name: 'unknown-station',
    base_url: baseUrl,
  });
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
