#!/usr/bin/env node
/**
 * filter-agent.js — Agent 2: กรองและให้คะแนนข่าว AI/Tech
 *
 * ทำงาน: อ่าน data.json → ให้คะแนน 0-100 → บันทึก filter_score + filter_label
 * รัน:   node agents/filter-agent.js [--date YYYY-MM-DD] [--force] [--dry-run]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '..', '..', '.env') });
const fs   = require('fs');
const path = require('path');

const PIPELINE_ROOT = process.env.PIPELINE_ROOT || path.join(__dirname, '..');
const { loadConfig } = require(path.join(PIPELINE_ROOT, 'config'));
const NEWS_DIR = path.join(PIPELINE_ROOT, 'news');
const args     = process.argv.slice(2);
const force    = args.includes('--force');
const dryRun   = args.includes('--dry-run');
const dateIdx  = args.findIndex(a => a === '--date');
const dateArg  = dateIdx !== -1 ? args[dateIdx + 1] : null;
const slugArg  = args.find(a => !a.startsWith('--') && !/^\d{4}-\d{2}-\d{2}$/.test(a));

// โหลดค่าตั้งจาก config.json (แก้ค่าได้ที่ pipeline/config.json)
const CFG      = loadConfig().filter;
const HIGH     = CFG.keywords.high;
const MEDIUM   = CFG.keywords.medium;
const LOW      = CFG.keywords.low;
const W        = CFG.weights;       // { high, medium, low }
const LBL      = CFG.labels;        // { ai_tech, ai_biz, ai_policy }
const MIN_SCORE = CFG.minScore;     // เกณฑ์ผ่าน/ไม่ผ่าน

function scoreNews(title, body = '') {
  const text = (title + ' ' + body).toLowerCase();

  let high = 0, mid = 0, low = 0;
  for (const kw of HIGH)   if (text.includes(kw)) high++;
  for (const kw of MEDIUM) if (text.includes(kw)) mid++;
  for (const kw of LOW)    if (text.includes(kw)) low++;

  const score = Math.max(0, Math.min(100, high * W.high + mid * W.medium - low * W.low));

  let label;
  if      (score >= LBL.ai_tech)   label = 'ai_tech';    // ข่าว AI/Tech จริงๆ
  else if (score >= LBL.ai_biz)    label = 'ai_biz';     // AI ในบริบทธุรกิจ
  else if (score >= LBL.ai_policy) label = 'ai_policy';  // AI ในบริบทนโยบาย/กฎหมาย
  else                             label = 'tangential'; // กล่าวถึง AI แต่ไม่ตรง

  return { score, label };
}

function getItems() {
  if (!fs.existsSync(NEWS_DIR)) return [];
  return fs.readdirSync(NEWS_DIR)
    .filter(d => fs.existsSync(path.join(NEWS_DIR, d, 'data.json')))
    .map(slug => {
      const data = JSON.parse(fs.readFileSync(path.join(NEWS_DIR, slug, 'data.json'), 'utf8'));
      return { slug, data };
    })
    .filter(({ slug, data }) => {
      if (!force && data.filter_score !== undefined) return false;
      if (slugArg && slug !== slugArg) return false;
      if (dateArg) {
        const pub = (data.published_at || data.scraped_at || '').substring(0, 10);
        return pub === dateArg;
      }
      return true;
    });
}

(function main() {
  console.log('\n🔍 Agent 2 — กรองข่าว (filter-agent)\n');

  const items = getItems();
  if (!items.length) {
    console.log('✅ ข่าวทุกรายการให้คะแนนแล้ว (ใช้ --force เพื่อให้คะแนนใหม่)');
    process.exit(0);
  }

  let passed = 0, filtered = 0;

  for (const { slug, data } of items) {
    const { score, label } = scoreNews(data.title, data.body);
    const mark  = score >= MIN_SCORE ? '✓' : '✗';
    const title = (data.title || '').substring(0, 55);

    console.log(`  ${mark} [${String(score).padStart(3)}] ${label.padEnd(12)} ${title}`);

    if (!dryRun) {
      data.filter_score = score;
      data.filter_label = label;
      fs.writeFileSync(path.join(NEWS_DIR, slug, 'data.json'), JSON.stringify(data, null, 2), 'utf8');
    }

    score >= MIN_SCORE ? passed++ : filtered++;
  }

  console.log(`\n📊 ผล: ผ่าน ${passed} | กรองออก ${filtered} (คะแนน < ${MIN_SCORE})`);
  if (dryRun) console.log('   [dry-run: ไม่บันทึก]');
})();
