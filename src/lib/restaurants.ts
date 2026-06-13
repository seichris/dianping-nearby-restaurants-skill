import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type {
  CityRestaurantGroup,
  RestaurantAmapLocation,
  RestaurantDataset,
  RestaurantOffer,
  RestaurantRecord,
} from "@/types/restaurants";

const CITY_LABELS: Record<string, string> = {
  beijing: "Beijing",
  shanghai: "Shanghai",
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" ? (value as JsonRecord) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asString).filter((item): item is string => Boolean(item)) : [];
}

function cityLabel(city: string): string {
  return CITY_LABELS[city] || city.charAt(0).toUpperCase() + city.slice(1);
}

function stationKey(city: string, stationName: string): string {
  return `${city}::${stationName}`;
}

function parseOffers(value: unknown): RestaurantOffer[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      const offer = asRecord(item);
      if (!offer) return null;
      const details = asRecord(offer.details);
      return {
        type: asString(offer.type) || "offer",
        title: asString(offer.title) || "Untitled offer",
        titleEn: asString(offer.title_en),
        price: asNumber(offer.price),
        originalPrice: asNumber(offer.original_price),
        discount: asString(offer.discount),
        validTime: asString(details?.valid_time),
        validTimeEn: asString(details?.valid_time_en),
        earliestUsable: asString(details?.earliest_usable),
        earliestUsableEn: asString(details?.earliest_usable_en),
        imageUrl: asString(offer.image_url),
      };
    })
    .filter((item): item is RestaurantOffer => Boolean(item));
}

function parsePoint(value: unknown): { lng: number; lat: number } | null {
  const point = asRecord(value);
  if (!point) return null;
  const lng = asNumber(point.lng);
  const lat = asNumber(point.lat);
  return lng !== null && lat !== null ? { lng, lat } : null;
}

function parseAmapLocation(value: unknown): RestaurantAmapLocation | null {
  const location = asRecord(value);
  const point = parsePoint(location);
  if (!location || !point) return null;

  return {
    ...point,
    formattedAddress: asString(location.formatted_address),
    level: asString(location.level),
    query: asString(location.query),
    source: asString(location.source),
    geocodedAt: asString(location.geocoded_at),
    originalLocation: parsePoint(location.original_location),
    maxExpectedStationDistanceMeters: asNumber(location.max_expected_station_distance_meters),
  };
}

function parseLatestJson(city: string, stationDirName: string, json: unknown): RestaurantRecord[] {
  const root = asRecord(json);
  if (!root) return [];

  const station = asRecord(root.station);
  const stationName = asString(station?.station_name) || stationDirName;
  const lineName = asString(station?.line_name);
  const updatedAt = asString(root.updated_at);
  const scanId = asString(root.scan_id);
  const records = Array.isArray(root.records) ? root.records : [];

  return records
    .map((recordLike, index) => {
      const record = asRecord(recordLike);
      const shop = asRecord(record?.shop);
      if (!shop) return null;
      const source = asRecord(record?.source);
      const distance = asRecord(shop.distance_from_station);
      const offers = parseOffers(record?.offers);
      const taocanCount = offers.filter((offer) => offer.type === "taocan").length;
      const voucherCount = offers.filter((offer) => offer.type === "voucher").length;
      const offerPrices = offers.map((offer) => offer.price).filter((price): price is number => price !== null);
      const shopId = asString(shop.shop_id);
      const name = asString(shop.name);
      if (!name) return null;

      return {
        id: `${city}:${stationName}:${shopId || index}`,
        city,
        cityLabel: cityLabel(city),
        stationName,
        stationKey: stationKey(city, stationName),
        lineName,
        updatedAt,
        scanId,
        sourceUrl: asString(source?.page_url) || asString(root.base_url),
        name,
        namePinyin: asString(shop.name_pinyin),
        shopUrl: asString(shop.url),
        shopId,
        imageUrl: asString(shop.image_url),
        address: asString(shop.address),
        addressPinyin: asString(shop.address_pinyin),
        amapLocation: parseAmapLocation(shop.amap_location),
        rating: asNumber(shop.rating),
        reviewCount: asNumber(shop.review_count),
        avgPricePerPerson: asNumber(shop.avg_price_per_person),
        area: asString(shop.area),
        category: asString(shop.category),
        rankingBadge: asString(shop.ranking_badge),
        openStatus: asString(shop.open_status),
        openingHours: asString(shop.opening_hours),
        distanceText: asString(distance?.raw_text),
        distanceMeters: asNumber(distance?.walking_distance_meters),
        recommendedDishes: asStringArray(shop.recommended_dishes),
        offers,
        taocanCount,
        voucherCount,
        bestOfferPrice: offerPrices.length ? Math.min(...offerPrices) : null,
      } satisfies RestaurantRecord;
    })
    .filter((item): item is RestaurantRecord => Boolean(item));
}

export async function loadRestaurantDataset(): Promise<RestaurantDataset> {
  const root = path.join(process.cwd(), "data", "restaurants");
  const cityEntries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const cityGroups: CityRestaurantGroup[] = [];

  for (const cityEntry of cityEntries) {
    if (!cityEntry.isDirectory()) continue;
    const city = cityEntry.name;
    const cityPath = path.join(root, city);
    const stationEntries = await readdir(cityPath, { withFileTypes: true }).catch(() => []);
    const records: RestaurantRecord[] = [];

    for (const stationEntry of stationEntries) {
      if (!stationEntry.isDirectory()) continue;
      const latestPath = path.join(cityPath, stationEntry.name, "latest.json");
      const file = await readFile(latestPath, "utf8").catch(() => null);
      if (!file) continue;
      try {
        records.push(...parseLatestJson(city, stationEntry.name, JSON.parse(file)));
      } catch (error) {
        console.warn(
          `Skipping invalid restaurant snapshot at ${latestPath}: ${
            error instanceof Error ? error.message : "unknown parse error"
          }`
        );
      }
    }

    if (records.length) {
      records.sort((a, b) => a.stationName.localeCompare(b.stationName, "zh-Hans-CN") || a.name.localeCompare(b.name));
      cityGroups.push({
        city,
        cityLabel: cityLabel(city),
        records,
      });
    }
  }

  cityGroups.sort((a, b) => a.cityLabel.localeCompare(b.cityLabel));
  const allRecords = cityGroups.flatMap((city) => city.records);
  const stationByKey = new Map(
    allRecords.map((record) => [
      record.stationKey,
      {
        key: record.stationKey,
        city: record.city,
        cityLabel: record.cityLabel,
        stationName: record.stationName,
        lineName: record.lineName,
      },
    ])
  );
  const updatedTimes = allRecords
    .map((record) => (record.updatedAt ? Date.parse(record.updatedAt) : NaN))
    .filter((value) => Number.isFinite(value));

  return {
    cities: cityGroups,
    stations: [...stationByKey.values()].sort(
      (a, b) => a.cityLabel.localeCompare(b.cityLabel) || a.stationName.localeCompare(b.stationName, "zh-Hans-CN")
    ),
    totalRecords: allRecords.length,
    totalTaocanShops: allRecords.filter((record) => record.taocanCount > 0).length,
    latestUpdatedAt: updatedTimes.length ? new Date(Math.max(...updatedTimes)).toISOString() : null,
  };
}
