import fs from 'node:fs/promises';
import path from 'node:path';
import { pinyin } from 'pinyin-pro';

const DEFAULT_ROOT = 'data/restaurants';

const TAOCAN_TITLE_TRANSLATIONS = {
  '【收鑶+拍照打卡专属福利】古法陈皮红豆沙': 'Traditional aged tangerine peel red bean soup',
  '【尝鲜】老火煲汤（位）': 'Trial offer: slow-cooked Cantonese soup, per person',
  '精选双人套餐': 'Selected set meal for two',
  '经典双人套餐': 'Classic set meal for two',
  '豪华牛排双人套餐': 'Deluxe steak set meal for two',
  '超值双人商务套餐': 'Value business set meal for two',
  '【夏日上新】经典双人餐•每晚驻唱': 'New summer offer: classic dinner for two with nightly live singing',
  '【鲜活海鲜】精选招牌海鲜饭双人餐': 'Fresh seafood: signature seafood rice set for two',
  '【踏夏寻味】招牌双人套餐': 'Summer flavors: signature set meal for two',
  '【Coops精选】切角蛋糕四选二': 'Coops selection: choose two cake slices',
  '抹茶热压可颂华夫下午茶': 'Matcha pressed croissant waffle afternoon tea',
  '下午茶 · 咖啡甜点套餐': 'Afternoon tea coffee and dessert set',
  '经典热销 · 咖啡单人份': 'Popular classic coffee for one',
  '可配送': 'Delivery available',
  '【优雅时光】烤肉拼盘双人餐（含烟熏烤玉米/可乐）': 'Elegant time: grilled meat platter for two with smoked corn and cola',
  '2人汉堡套餐': 'Burger set meal for two',
  '【人气特惠】法式冰淇淋单人餐（口味4选1）': 'Popular special: French ice cream set for one, choose one of four flavors',
  '【福利】热拿铁双人餐': 'Special offer: hot latte set for two',
  '蜂蜜蛋糕礼盒': 'Honey cake gift box',
  '馥郁伴手礼盒': 'Richly flavored gift box',
  '端午飘香礼盒': 'Dragon Boat Festival fragrant gift box',
  '粽横四海礼盒': 'Zongzi gift box',
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

function enrichSnapshot(snapshot) {
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
    }

    for (const offer of record.offers || []) {
      if (offer.type !== 'taocan') continue;
      const titleEn = TAOCAN_TITLE_TRANSLATIONS[offer.title] || null;
      if (titleEn && offer.title_en !== titleEn) {
        offer.title_en = titleEn;
        changed = true;
      }

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

  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8');
    const snapshot = JSON.parse(raw);
    if (!enrichSnapshot(snapshot)) continue;
    await fs.writeFile(file, `${JSON.stringify(snapshot, null, 2)}\n`);
    updated += 1;
  }

  console.log(`Enriched ${updated} file${updated === 1 ? '' : 's'}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
