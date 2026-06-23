#!/usr/bin/env node
/**
 * formatter-agent.js — Agent 4: สร้าง content ต่อ platform
 *
 * ทำงาน: อ่าน content/master.md → สร้าง facebook.md, instagram.md, x.md, tiktok.md
 * รัน:   node agents/formatter-agent.js [--platform fb,ig,x,tiktok] [--date YYYY-MM-DD] [--force]
 *
 * น้ำข้าว style ถูกใส่ที่นี่ — formatter รับข้อเท็จจริงจาก master.md
 * แล้วปรับเป็น content สไตล์น้ำข้าวตาม format ของแต่ละ platform
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '..', '..', '.env') });
const fs   = require('fs');
const path = require('path');
const { ollamaChat, checkOllama } = require('./ollama');

const PIPELINE_ROOT = process.env.PIPELINE_ROOT || path.join(__dirname, '..');
const { loadConfig } = require(path.join(PIPELINE_ROOT, 'config'));

const { validateContent, cleanOutput }                    = require('../../../../lib/formatter-core');
const { sendApprovalNotification }                        = require('../../../../lib/tg-approval');
const { generateNewsImage }                               = require('../../../../lib/comfy-news');
const { formatFacebook, formatInstagram, formatX, formatTikTok } = require('../../../../lib/news-prompts');
const { sleep }                                           = require('../../../../lib/utils');

// โหลดค่าตั้งจาก config.json (แก้ค่าได้ที่ pipeline/config.json)
const _cfg        = loadConfig();
const FMT_CFG     = _cfg.formatter;
const COMFY_CFG   = _cfg.comfyui || {};
const SKIP_STATUS = FMT_CFG.skipStatus || ['posted'];   // สถานะที่ข้าม
const FMT_MIN_SCORE = FMT_CFG.minScore || 0;            // ข้ามข่าว filter_score < ค่านี้ (0 = ไม่กรอง)
const SKIP_PLATFORMS = (FMT_CFG.skipPlatforms || []).map(s => String(s).trim().toLowerCase()); // platform ที่ไม่สร้าง

const NEWS_DIR = path.join(PIPELINE_ROOT, 'news');
const https    = require('https');
const args     = process.argv.slice(2);
const force    = args.includes('--force');
const resend   = args.includes('--resend');
const dateIdx  = args.findIndex(a => a === '--date');
const dateArg  = dateIdx !== -1 ? args[dateIdx + 1] : null;
const platIdx  = args.findIndex(a => a === '--platform');
const platArg  = platIdx !== -1 ? args[platIdx + 1] : null;
// หา slug โดย skip ค่าที่ตามหลัง --flag (เช่น 'fb' หลัง --platform)
const flagValIdxs = new Set([dateIdx + 1, platIdx + 1].filter(i => i > 0));
const slugArg  = args.find((a, i) => !a.startsWith('--') && !/^\d{4}-\d{2}-\d{2}$/.test(a) && !flagValIdxs.has(i));
const PLATFORMS = (platArg
  ? platArg.split(',').map(s => s.trim().toLowerCase())
  : ['fb', 'ig', 'x', 'tiktok'])
  // ตัด platform ที่ตั้งให้ข้ามใน config (ยกเว้นระบุ --platform มาเองตรงๆ)
  .filter(p => platArg || !SKIP_PLATFORMS.includes(p));

const PLATFORM_FILE = { fb: 'facebook.md', ig: 'instagram.md', x: 'x.md', tiktok: 'tiktok.md' };
const RETRY_LIMIT   = 3;   // สร้างซ้ำสูงสุดกี่ครั้งเมื่อ validate ไม่ผ่าน

// ─── Items ────────────────────────────────────────────────────────────────────

function getItems() {
  if (!fs.existsSync(NEWS_DIR)) return [];
  return fs.readdirSync(NEWS_DIR)
    .filter(d => resend
      ? fs.existsSync(path.join(NEWS_DIR, d, 'data.json'))
      : fs.existsSync(path.join(NEWS_DIR, d, 'content', 'master.md')))
    .map(slug => {
      const data       = JSON.parse(fs.readFileSync(path.join(NEWS_DIR, slug, 'data.json'), 'utf8'));
      const contentDir = path.join(NEWS_DIR, slug, 'content');
      return { slug, data, contentDir };
    })
    .filter(({ slug, data, contentDir }) => {
      // ข้ามตามสถานะที่กำหนดใน config (เช่น posted, scheduled)
      if (SKIP_STATUS.includes(data.status)) return false;
      // ข้ามข่าวคะแนนต่ำกว่าเกณฑ์ (filter_score ต้องถูกให้คะแนนแล้ว)
      if (FMT_MIN_SCORE > 0 && typeof data.filter_score === 'number' && data.filter_score < FMT_MIN_SCORE)
        return false;
      if (slugArg && slug !== slugArg) return false;
      if (dateArg) {
        const pub = (data.published_at || data.scraped_at || '').substring(0, 10);
        if (pub !== dateArg) return false;
      }
      if (resend) {
        // resend mode: ส่ง Telegram ซ้ำเฉพาะข่าวที่มี facebook.md แต่ยังไม่ approve
        const hasFB = fs.existsSync(path.join(contentDir, 'facebook.md'));
        if (!hasFB) return false;
        if (data.status !== 'pending_approval' && data.status !== 'draft') return false;
        return true;
      }
      if (!force) {
        // ผ่านถ้ายังมี platform ที่ยังไม่ได้สร้าง
        return PLATFORMS.some(p => !fs.existsSync(path.join(contentDir, PLATFORM_FILE[p] || p + '.md')));
      }
      return true;
    });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async function main() {
  console.log(`\n📐 Agent 4 — สร้าง content (formatter-agent) [${PLATFORMS.join(', ')}]${resend ? ' [--resend]' : ''}\n`);

  // ── resend mode: ส่ง Telegram ซ้ำโดยไม่ regenerate ──────────────────────────
  if (resend) {
    const items = getItems();
    if (!items.length) {
      console.log('✅ ไม่มีข่าวที่ต้อง resend (pending_approval/draft + มี facebook.md)');
      process.exit(0);
    }
    console.log(`📋 resend: ${items.length} รายการ\n`);
    for (const { slug, data, contentDir } of items) {
      console.log(`  📰 ${(data.title || '').substring(0, 55)}`);
      const masterPath = path.join(contentDir, 'master.md');
      const fbPath     = path.join(contentDir, 'facebook.md');
      const master = fs.existsSync(masterPath) ? fs.readFileSync(masterPath, 'utf8')
                   : fs.existsSync(fbPath)     ? fs.readFileSync(fbPath, 'utf8')
                   : '';
      process.stdout.write(`     📲 ส่ง Telegram ซ้ำ...`);
      try {
        await sendApprovalNotification(slug, data, master, { pipelineRoot: PIPELINE_ROOT, newsDir: NEWS_DIR });
        process.stdout.write(` ✓\n`);
      } catch (e) {
        process.stdout.write(` ⚠️ ${e.message.substring(0, 60)}\n`);
      }
      await sleep(300);
    }
    console.log(`\n✅ Resend เสร็จ: ${items.length} รายการ`);
    process.exit(0);
  }

  try {
    await checkOllama();
    console.log('✅ Ollama พร้อมใช้\n');
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }

  const items = getItems();
  if (!items.length) {
    console.log('✅ content ครบทุกข่าวแล้ว (ใช้ --force เพื่อสร้างใหม่)');
    process.exit(0);
  }

  console.log(`📋 ต้องสร้าง: ${items.length} รายการ\n`);
  let totalOk = 0, totalFail = 0;

  for (const { slug, data, contentDir } of items) {
    const title = (data.title || '').substring(0, 55);
    console.log(`  📰 ${title}`);

    const master = fs.readFileSync(path.join(contentDir, 'master.md'), 'utf8');
    let okForItem = 0;   // นับ platform ที่สร้างสำเร็จในข่าวนี้

    for (const platform of PLATFORMS) {
      const filename = PLATFORM_FILE[platform] || platform + '.md';
      const outPath  = path.join(contentDir, filename);

      if (fs.existsSync(outPath) && !force) continue;

      // รองรับ platform ที่ไม่รู้จัก
      if (!['fb', 'ig', 'x', 'tiktok'].includes(platform)) {
        process.stdout.write(`     [${platform}] ⚠️  ไม่รู้จัก platform\n`);
        continue;
      }

      let savedContent = null;
      let lastErrors   = [];

      for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
        const label = attempt === 1 ? 'กำลังสร้าง' : `⟳ retry ${attempt - 1}/${RETRY_LIMIT - 1}`;
        process.stdout.write(`     [${platform}] ${label}...`);

        try {
          let raw;
          switch (platform) {
            case 'fb':     raw = await formatFacebook(ollamaChat, cleanOutput, master, data.url); break;
            case 'ig':     raw = await formatInstagram(ollamaChat, cleanOutput, master);          break;
            case 'x':      raw = await formatX(ollamaChat, cleanOutput, master, data.url);        break;
            case 'tiktok': raw = await formatTikTok(ollamaChat, cleanOutput, master);             break;
          }

          lastErrors = validateContent(raw, platform, data, master);

          if (lastErrors.length === 0) {
            savedContent = raw;
            process.stdout.write(` ✓\n`);
            break;
          }

          // แสดง error แล้วลองใหม่
          process.stdout.write(` ⚠️  ${lastErrors.join(' | ')}\n`);

        } catch (e) {
          lastErrors = [e.message.substring(0, 80)];
          process.stdout.write(` ❌ ${lastErrors[0]}\n`);
        }

        await sleep(500);
      }

      if (savedContent) {
        fs.writeFileSync(outPath, savedContent, 'utf8');
        totalOk++;
        okForItem++;
      } else {
        console.log(`     ⛔ [${platform}] ล้มเหลวหลัง ${RETRY_LIMIT} ครั้ง: ${lastErrors.join(' | ')}`);
        totalFail++;
      }

      await sleep(300);
    }

    // อัปเดต status → draft (ถ้ายังไม่ได้โพสต์)
    if (data.status !== 'posted' && data.status !== 'scheduled') {
      data.status = 'draft';
      fs.writeFileSync(path.join(NEWS_DIR, slug, 'data.json'), JSON.stringify(data, null, 2), 'utf8');
    }

    // ส่ง Telegram preview รอ approve (เฉพาะข่าวที่สร้าง content สำเร็จอย่างน้อย 1 platform)
    if (okForItem > 0) {
      // generate รูปด้วย ComfyUI ถ้าไม่มี og_image และไม่มี image.jpg
      const imagePath   = path.join(NEWS_DIR, slug, 'image.jpg');
      const hasLocalImg = fs.existsSync(imagePath);
      const hasOgImage  = !!(data.og_image || '').trim();
      if (!hasLocalImg && !hasOgImage && COMFY_CFG.enabled) {
        process.stdout.write(`     🎨 generate รูปด้วย ComfyUI...`);
        try {
          await generateNewsImage(COMFY_CFG, imagePath, data.title || '');
          process.stdout.write(` ✓\n`);
        } catch (e) {
          process.stdout.write(` ⚠️ ${e.message.substring(0, 60)} (ส่ง text-only)\n`);
        }
      }

      process.stdout.write(`     📲 ส่ง Telegram รอ approve...`);
      try {
        await sendApprovalNotification(slug, data, master, { pipelineRoot: PIPELINE_ROOT, newsDir: NEWS_DIR });
        process.stdout.write(` ✓\n`);
      } catch (e) {
        process.stdout.write(` ⚠️ ${e.message.substring(0, 60)}\n`);
      }
    }

    console.log('');
    await sleep(300);
  }

  console.log(`✅ Formatter Agent เสร็จ: สร้าง ${totalOk} | ล้มเหลว ${totalFail}`);
})();
