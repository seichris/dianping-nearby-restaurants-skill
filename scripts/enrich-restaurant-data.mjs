import fs from 'node:fs/promises';
import path from 'node:path';
import { pinyin } from 'pinyin-pro';

const DEFAULT_ROOT = 'data/restaurants';
const AMAP_GEOCODE_URL = 'https://restapi.amap.com/v3/geocode/geo';
const AMAP_REST_KEY = process.env.AMAP_WEB_SERVICE_KEY || process.env.AMAP_REST_API_KEY || '';
const GEOCODE_DELAY_MS = Number(process.env.AMAP_GEOCODE_DELAY_MS || 120);

const CITY_NAMES = {
  beijing: '北京',
  shanghai: '上海',
};

const STATION_CENTERS = {
  'beijing::团结湖': { lng: 116.4618, lat: 39.9338 },
  'shanghai::静安寺': { lng: 121.446, lat: 31.2231 },
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

function delay(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
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

function haversineMeters(a, b) {
  const earthRadius = 6_371_000;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

function stationFallbackLocation(snapshot, shop, location) {
  const city = snapshotCity(snapshot);
  const stationName = snapshotStationName(snapshot);
  const center = STATION_CENTERS[`${city}::${stationName}`];
  const walkingDistance = asFiniteNumber(shop?.distance_from_station?.walking_distance_meters);
  if (!center || walkingDistance === null) return null;
  const maxExpectedDistance = Math.max(2500, walkingDistance + 1500);
  return haversineMeters(center, location) > maxExpectedDistance
    ? { center, maxExpectedDistance }
    : null;
}

function parseAmapLocation(response, query) {
  const first = response?.geocodes?.[0];
  const location = typeof first?.location === 'string' ? first.location.split(',') : [];
  const lng = asFiniteNumber(location[0]);
  const lat = asFiniteNumber(location[1]);
  if (lng === null || lat === null) return null;
  return {
    lng,
    lat,
    formatted_address: typeof first.formatted_address === 'string' ? first.formatted_address : null,
    level: typeof first.level === 'string' ? first.level : null,
    query,
    source: 'amap_rest_geocode',
    geocoded_at: new Date().toISOString(),
  };
}

async function geocodeQuery(query, city) {
  const url = new URL(AMAP_GEOCODE_URL);
  url.searchParams.set('key', AMAP_REST_KEY);
  url.searchParams.set('address', query);
  if (city) url.searchParams.set('city', CITY_NAMES[city] || city);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`AMap geocode failed with HTTP ${response.status}`);
  }
  const body = await response.json();
  if (body?.status !== '1') return null;
  return parseAmapLocation(body, query);
}

async function enrichGeocode(snapshot, shop, geocodeCache) {
  if (!AMAP_REST_KEY || !shop || typeof shop !== 'object') return false;
  const query = buildGeocodeQuery(snapshot, shop);
  if (!query) return false;
  if (shop.amap_location?.query === query && isValidPoint(shop.amap_location)) return false;

  const city = snapshotCity(snapshot);
  let location;
  if (geocodeCache.has(query)) {
    location = geocodeCache.get(query);
  } else {
    await delay(GEOCODE_DELAY_MS);
    location = await geocodeQuery(query, city);
    geocodeCache.set(query, location);
  }
  if (!location) return false;

  const fallback = stationFallbackLocation(snapshot, shop, location);
  if (fallback) {
    shop.amap_location = {
      ...fallback.center,
      formatted_address: location.formatted_address,
      level: location.level,
      query,
      source: 'amap_rest_geocode_station_fallback',
      geocoded_at: location.geocoded_at,
      original_location: {
        lng: location.lng,
        lat: location.lat,
      },
      max_expected_station_distance_meters: Math.round(fallback.maxExpectedDistance),
    };
  } else {
    shop.amap_location = location;
  }
  return true;
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

async function enrichSnapshot(snapshot, missingTitleTranslations, geocodeCache) {
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
      if (await enrichGeocode(snapshot, shop, geocodeCache)) {
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

async function main() {
  const root = path.resolve(process.cwd(), process.argv[2] || DEFAULT_ROOT);
  const files = await listJsonFiles(root);
  let updated = 0;
  const missingTitleTranslations = new Set();
  const geocodeCache = new Map();

  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8');
    const snapshot = JSON.parse(raw);
    if (!await enrichSnapshot(snapshot, missingTitleTranslations, geocodeCache)) continue;
    await fs.writeFile(file, `${JSON.stringify(snapshot, null, 2)}\n`);
    updated += 1;
  }

  console.log(`Enriched ${updated} file${updated === 1 ? '' : 's'}.`);
  if (!AMAP_REST_KEY) {
    console.log('Skipped AMap geocoding because AMAP_WEB_SERVICE_KEY or AMAP_REST_API_KEY is not set.');
  }
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
