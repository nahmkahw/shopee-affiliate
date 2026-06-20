/**
 * generate.js — AI News Content Generator (Thai)
 *
 * ใช้ Ollama สร้าง content ภาษาไทยสำหรับ Facebook และ Instagram
 *
 * ใช้งาน:
 *   node generate.js                        ← สร้างทุกข่าวที่ยังไม่มี content
 *   node generate.js {slug}                 ← สร้างเฉพาะ news_id นั้น
 *   node generate.js --date 2026-05-27      ← สร้างเฉพาะข่าวของวันนั้น
 *   node generate.js --force                ← สร้างใหม่ทุกข่าว (แม้มี content แล้ว)
 *   node generate.js {slug} --force        ← สร้างใหม่เฉพาะข่าวนั้น
 *   node generate.js --resend              ← ส่ง Telegram ซ้ำให้ข่าวที่ pending_approval/draft
 *   node generate.js --resend --date 2026-05-28 ← resend เฉพาะวันนั้น
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const { TG_ENABLED, sendTelegramApproval } = require('./lib/telegram');
const { OLLAMA_HOST, OLLAMA_MODEL, checkOllamaReady } = require('./lib/ollama');
const { generateContent } = require('./lib/content');
const { getPendingItems }  = require('./lib/queue-items');

const NEWS_DIR = path.join(__dirname, 'news');

const args       = process.argv.slice(2);
const slugArg    = args.find(a => !a.startsWith('--'));
const dateIdx    = args.findIndex(a => a === '--date');
const dateArg    = dateIdx !== -1 ? args[dateIdx + 1] : null;
const force      = args.includes('--force');
const resend     = args.includes('--resend');
const noTelegram = args.includes('--no-telegram');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async function main() {
  if (resend) {
    if (!TG_ENABLED) {
      console.error('❌ ต้องตั้งค่า TELEGRAM_BOT_TOKEN และ TELEGRAM_CHAT_ID ใน .env ก่อน');
      process.exit(1);
    }
    console.log('\n📨 Resend mode — ส่ง Telegram ซ้ำสำหรับข่าวที่ยังไม่ approve\n');
    const pending = getPendingItems(NEWS_DIR, { slugArg, dateArg, resend: true });
    if (!pending.length) {
      console.log('✅ ไม่มีข่าว pending_approval/draft ที่ต้องส่งซ้ำ');
      process.exit(0);
    }
    console.log(`📋 พบ ${pending.length} รายการที่ยังรอ approve:\n`);
    let sentCount = 0;
    for (const { slug, data } of pending) {
      const fbPath = path.join(NEWS_DIR, slug, 'content', 'facebook.md');
      const fbContent = fs.readFileSync(fbPath, 'utf8');
      const hasImage = fs.existsSync(path.join(NEWS_DIR, slug, 'image.jpg'));
      console.log(`  📰 ${data.title?.substring(0, 60)}${hasImage ? ' 🖼' : ''}`);
      const sent = await sendTelegramApproval(slug, data, fbContent, NEWS_DIR);
      if (sent) {
        data.status = 'pending_approval';
        data.pending_since = new Date().toISOString();
        fs.writeFileSync(path.join(NEWS_DIR, slug, 'data.json'), JSON.stringify(data, null, 2), 'utf8');
        sentCount++;
      }
      await sleep(500);
    }
    console.log(`\n✅ ส่ง Telegram สำเร็จ ${sentCount}/${pending.length} รายการ`);
    process.exit(0);
  }

  console.log(`\n🤖 AI News Content Generator (Ollama: ${OLLAMA_MODEL})\n`);

  try {
    await checkOllamaReady();
    console.log(`✅ Ollama พร้อมใช้ที่ ${OLLAMA_HOST}\n`);
  } catch (e) {
    console.error(`❌ เชื่อมต่อ Ollama ไม่ได้: ${OLLAMA_HOST}`);
    console.error(`   ${e.message}`);
    process.exit(1);
  }

  if (force) console.log('⚠️  --force mode: สร้าง content ใหม่ทับของเดิม\n');

  const pending = getPendingItems(NEWS_DIR, { slugArg, dateArg, force, noTelegram });

  if (!pending.length) {
    const msg = force
      ? '✅ ไม่มีข่าวที่ต้องสร้างใหม่ (ข่าวที่ status=posted ไม่แตะ)'
      : '✅ content ครบทุกข่าวแล้ว ใช้ --force เพื่อสร้างใหม่';
    console.log(msg);
    process.exit(0);
  }

  console.log(`📋 ข่าวที่ต้องสร้าง content: ${pending.length} รายการ\n`);
  pending.forEach(({ slug, data }) => {
    console.log(`  • ${data.published_at?.substring(0, 10) || '?'} | ${data.title?.substring(0, 60)}`);
  });
  console.log('');

  for (const { slug, data } of pending) {
    console.log(`\n[${slug}]`);
    console.log(`📰 ${data.title}`);

    process.stdout.write('  🤖 กำลังสร้าง content ภาษาไทย...');
    const content = await generateContent(data);
    process.stdout.write(' ✓\n');

    const contentDir = path.join(NEWS_DIR, slug, 'content');
    fs.mkdirSync(contentDir, { recursive: true });

    fs.writeFileSync(path.join(contentDir, 'facebook.md'),  content.facebook,  'utf8');
    fs.writeFileSync(path.join(contentDir, 'instagram.md'), content.instagram, 'utf8');

    process.stdout.write('  🎨 กำลัง Generate รูปผ่าน ComfyUI...');
    try {
      const { generateNewsImage } = require('./comfy-gen');
      await generateNewsImage(slug, data.title || slug);
      process.stdout.write(' ✓\n');
    } catch (e) {
      process.stdout.write(` ⚠️ ข้าม (${e.message.substring(0, 80)})\n`);
    }

    const sent = noTelegram ? false : await sendTelegramApproval(slug, data, content.facebook, NEWS_DIR);
    if (noTelegram) console.log('  ⏭️  ข้ามการส่ง Telegram (--no-telegram)');

    if (data.status !== 'posted') {
      data.status = sent ? 'pending_approval' : 'draft';
      if (sent) data.pending_since = new Date().toISOString();
    }
    fs.writeFileSync(path.join(NEWS_DIR, slug, 'data.json'), JSON.stringify(data, null, 2), 'utf8');

    const statusLabel = sent ? '📨 รอ approve ใน Telegram' : '📝 draft';
    console.log(`  ✅ บันทึกแล้ว: news/${slug}/content/ [${statusLabel}]`);

    await sleep(1000);
  }

  console.log('\n' + '═'.repeat(55));
  console.log(`✅ สร้าง content เสร็จ: ${pending.length} ข่าว`);
  console.log('📁 ดู draft ได้ที่ news/{slug}/content/');
  console.log('⚠️  กรุณาตรวจสอบก่อนโพสต์');
})();
