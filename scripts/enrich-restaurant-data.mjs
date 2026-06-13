import fs from 'node:fs/promises';
import path from 'node:path';
import { pinyin } from 'pinyin-pro';

const DEFAULT_ROOT = 'data/restaurants';

const CITY_NAMES = {
  beijing: '北京',
  shanghai: '上海',
};

function toPinyin(value) {
  if (!value || typeof value !== 'string') return null;
  return pinyin(value, { toneType: 'none', nonZh: 'consecutive' })
    .replace(/\b(\d) (?=\d\b)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function translateValidTime(value) {
  if (!value) return null;
  if (value === '周一至周日') return 'Monday to Sunday';
  const weekdayRange = value.match(/^周([一二三四五六日])至周([一二三四五六日])$/);
  if (weekdayRange) {
    return `${translateWeekday(weekdayRange[1])} to ${translateWeekday(weekdayRange[2])}`;
  }
  const weekdayList = value.match(/^周([一二三四五六日、-]+)$/);
  if (weekdayList) {
    return weekdayList[1]
      .split('、')
      .map((part) => part.replace(/^([一二三四五六日])-([一二三四五六日])$/, (_, start, end) => `${translateWeekday(start)} to ${translateWeekday(end)}`))
      .map((part) => translateWeekday(part) || part)
      .join(', ');
  }
  if (/^[0-9]{1,2}:[0-9]{2}-[0-9]{1,2}:[0-9]{2}$/.test(value)) return value;
  return null;
}

function translateWeekday(value) {
  return {
    一: 'Monday',
    二: 'Tuesday',
    三: 'Wednesday',
    四: 'Thursday',
    五: 'Friday',
    六: 'Saturday',
    日: 'Sunday',
  }[value] || null;
}

function translateEarliestUsable(value) {
  if (!value) return null;
  const match = value.match(/^最早([0-9]{2})\.([0-9]{2})可用$/);
  if (match) return `Available from ${match[1]}/${match[2]}`;
  if (value === '今日可用') return 'Available today';
  return null;
}

function asFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isValidPoint(value) {
  if (!value || typeof value !== 'object') return false;
  return asFiniteNumber(value.lng) !== null && asFiniteNumber(value.lat) !== null;
}

function sanitizeAddress(value) {
  if (!value || typeof value !== 'string') return null;
  return value
    .replace(/不行/g, '步行')
    .replace(/[（(]\s*距[^）)]*(?:步行|不行)[^）)]*[）)]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function normalizeCacheValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function snapshotCity(snapshot) {
  const city = snapshot?.station?.city;
  return typeof city === 'string' && city.trim() ? city.trim() : null;
}

function snapshotStationName(snapshot) {
  const stationName = snapshot?.station?.station_name;
  return typeof stationName === 'string' && stationName.trim() ? stationName.trim() : null;
}

function buildGeocodeQuery(snapshot, shop) {
  const city = snapshotCity(snapshot);
  const cityName = CITY_NAMES[city] || city || '';
  const address = sanitizeAddress(shop.address);
  if (!address) return null;
  const area = typeof shop.area === 'string' ? shop.area.trim() : '';
  return [cityName, area && !address.includes(area) ? area : '', address].filter(Boolean).join('');
}

function geocodeCacheKeys(snapshot, shop) {
  const city = snapshotCity(snapshot);
  const stationName = snapshotStationName(snapshot);
  const keys = [];

  const query = buildGeocodeQuery(snapshot, shop);
  if (query) keys.push(`query:${query}`);

  const shopId = normalizeCacheValue(shop?.shop_id);
  if (city && stationName && shopId) keys.push(`shop:${city}:${stationName}:${shopId}`);

  const name = normalizeCacheValue(shop?.name);
  const address = sanitizeAddress(shop?.address);
  if (city && stationName && name && address) keys.push(`name-address:${city}:${stationName}:${name}:${address}`);

  return keys;
}

function cloneAmapLocation(location) {
  if (!isValidPoint(location)) return null;
  return JSON.parse(JSON.stringify(location));
}

function collectAmapLocationCacheFromSnapshot(snapshot, geocodeCache) {
  if (!Array.isArray(snapshot?.records)) return;
  for (const record of snapshot.records) {
    const shop = record?.shop;
    if (!shop || typeof shop !== 'object') continue;
    const location = cloneAmapLocation(shop.amap_location);
    if (!location) continue;

    const query = normalizeCacheValue(location.query);
    if (query) geocodeCache.set(`query:${query}`, location);
    for (const key of geocodeCacheKeys(snapshot, shop)) {
      geocodeCache.set(key, location);
    }
  }
}

function enrichGeocodeFromCache(snapshot, shop, geocodeCache) {
  if (!shop || typeof shop !== 'object' || isValidPoint(shop.amap_location)) return false;

  for (const key of geocodeCacheKeys(snapshot, shop)) {
    const location = cloneAmapLocation(geocodeCache.get(key));
    if (!location) continue;
    shop.amap_location = location;
    return true;
  }
  return false;
}

async function listJsonFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listJsonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(fullPath);
    }
  }
  return files;
}

function enrichSnapshot(snapshot, missingTitleTranslations, geocodeCache) {
  if (!Array.isArray(snapshot.records)) return false;
  let changed = false;

  for (const record of snapshot.records) {
    const shop = record.shop;
    if (shop && typeof shop === 'object') {
      const namePinyin = toPinyin(shop.name);
      const addressPinyin = toPinyin(shop.address);
      if (namePinyin && shop.name_pinyin !== namePinyin) {
        shop.name_pinyin = namePinyin;
        changed = true;
      }
      if (addressPinyin && shop.address_pinyin !== addressPinyin) {
        shop.address_pinyin = addressPinyin;
        changed = true;
      }
      if (enrichGeocodeFromCache(snapshot, shop, geocodeCache)) {
        changed = true;
      }
    }

    for (const offer of record.offers || []) {
      if (offer.type !== 'taocan') continue;
      if (offer.title && !offer.title_en) missingTitleTranslations.add(offer.title);

      if (!offer.details || typeof offer.details !== 'object') offer.details = {};
      const validTimeEn = translateValidTime(offer.details.valid_time);
      const earliestUsableEn = translateEarliestUsable(offer.details.earliest_usable);
      if (validTimeEn && offer.details.valid_time_en !== validTimeEn) {
        offer.details.valid_time_en = validTimeEn;
        changed = true;
      }
      if (earliestUsableEn && offer.details.earliest_usable_en !== earliestUsableEn) {
        offer.details.earliest_usable_en = earliestUsableEn;
        changed = true;
      }
    }
  }

  return changed;
}

async function collectAmapLocationCache(files) {
  const geocodeCache = new Map();
  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8');
    collectAmapLocationCacheFromSnapshot(JSON.parse(raw), geocodeCache);
  }
  return geocodeCache;
}

async function main() {
  const root = path.resolve(process.cwd(), process.argv[2] || DEFAULT_ROOT);
  const files = await listJsonFiles(root);
  let updated = 0;
  const missingTitleTranslations = new Set();
  const geocodeCache = await collectAmapLocationCache(files);

  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8');
    const snapshot = JSON.parse(raw);
    if (!enrichSnapshot(snapshot, missingTitleTranslations, geocodeCache)) continue;
    await fs.writeFile(file, `${JSON.stringify(snapshot, null, 2)}\n`);
    updated += 1;
  }

  console.log(`Enriched ${updated} file${updated === 1 ? '' : 's'}.`);
  console.log(`Loaded ${geocodeCache.size} saved AMap geocode cache key${geocodeCache.size === 1 ? '' : 's'}.`);
  if (missingTitleTranslations.size) {
    console.log('Missing taocan title translations:');
    for (const title of [...missingTitleTranslations].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))) {
      console.log(`- ${title}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
