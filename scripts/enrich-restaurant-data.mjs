import fs from 'node:fs/promises';
import path from 'node:path';
import { pinyin } from 'pinyin-pro';

const DEFAULT_ROOT = 'data/restaurants';

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

function enrichSnapshot(snapshot, missingTitleTranslations) {
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

  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8');
    const snapshot = JSON.parse(raw);
    if (!enrichSnapshot(snapshot, missingTitleTranslations)) continue;
    await fs.writeFile(file, `${JSON.stringify(snapshot, null, 2)}\n`);
    updated += 1;
  }

  console.log(`Enriched ${updated} file${updated === 1 ? '' : 's'}.`);
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
