'use strict';
/**
 * approval-bot.js — Telegram Approval Bot สำหรับ Shopee Affiliate FB Posts
 *
 * Flow:
 *   1. หาสินค้าของวันปัจจุบัน
 *   2. ส่ง Facebook content ไปยัง Telegram พร้อมปุ่ม ✅ โพสต์ / 🔄 สร้างใหม่
 *   3. รอการตอบกลับ (timeout 1 ชั่วโมง)
 *   4. ถ้า Approve  → node post.js {item_id} --platform fb
 *   5. ถ้า Regenerate → Template สร้าง content ใหม่ → ส่งรอ Approve อีกครั้ง
 *
 * .env ที่ต้องมี:
 *   TELEGRAM_BOT_TOKEN=xxxxx:yyyyyyy
 *   TELEGRAM_CHAT_ID=123456789
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { createTelegramClient, sleep } = require('./lib/telegram');
const { postFbClip, postAllPlatforms } = require('./lib/fb-post');
const { createApprovalFlow, regenerateFromTemplate } = require('./lib/approval-flow');

const ROOT      = path.resolve(__dirname);
const LOCK_FILE = path.join(ROOT, '.approval-bot.lock');

// ─── Credentials ──────────────────────────────────────────────────────────────

const BOT_TOKEN = (process.env.MALI_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').replace(/"/g, '').trim();
const CHAT_ID   = (process.env.TELEGRAM_CHAT_ID || '').replace(/"/g, '').trim();

const tg = createTelegramClient(BOT_TOKEN, CHAT_ID);
const { tgApi, sendMsg, editMsg, answerCb, initOffset, waitForCallback, waitForDecision } = tg;
const { approveLoop, handleOldProducts, postAndReport } = createApprovalFlow({
  sendMsg, editMsg, answerCb, waitForCallback, waitForDecision, sleep, postAllPlatforms, ROOT
});

// ─── Lock file — ป้องกันรันซ้อนกัน ──────────────────────────────────────────

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const pid = fs.readFileSync(LOCK_FILE, 'utf8').trim();
    try {
      process.kill(Number(pid), 0);
      console.error(`❌ approval-bot กำลังรันอยู่แล้ว (PID: ${pid})\nถ้าค้างอยู่ให้ลบไฟล์ .approval-bot.lock แล้วรันใหม่`);
      process.exit(1);
    } catch {
      fs.unlinkSync(LOCK_FILE);
    }
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
  process.on('exit',   () => { try { fs.unlinkSync(LOCK_FILE); } catch {} });
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM',() => process.exit(0));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const today     = todayString();
  const argItemId = process.argv[2]?.match(/^\d{8,}$/) ? process.argv[2] : null;

  console.log(`🤖 Approval Bot — ${argItemId ? 'ทดสอบ item_id: ' + argItemId : today}`);
  await initOffset();

  const dirs = fs.existsSync('products') ? fs.readdirSync('products') : [];
  const products = dirs
    .filter(d => fs.existsSync(path.join('products', d, 'data.json')))
    .map(id => ({ id, data: JSON.parse(fs.readFileSync(path.join('products', id, 'data.json'), 'utf8')) }))
    .filter(({ id, data: d }) => {
      if (d.status === 'placeholder') return false;
      if (argItemId) return id === argItemId;
      return d.post_date === today;
    });

  if (!products.length) {
    await sendMsg(`📭 ไม่พบสินค้า ${argItemId ? `item_id: ${argItemId}` : `วันที่ ${today}`}`);
    console.log('ไม่พบสินค้า');
    return;
  }

  const label = argItemId ? `🧪 ทดสอบ` : today;
  await sendMsg(
    `🚀 <b>Shopee Affiliate — ${label}</b>\n` +
    `พบ <b>${products.length}</b> รายการ รอ Approve\n\n` +
    `กด ✅ เพื่อโพสต์ หรือ 🔄 เพื่อสร้าง content ใหม่`
  );

  const posted = [], skipped = [];

  for (const { id, data } of products) {
    const title = (data.title || '').substring(0, 35);
    console.log(`\n[${id}] ${title}`);

    const videoPath    = path.join('products', id, 'video.mp4');
    const tiktokMdPath = path.join('products', id, 'content', 'tiktok.md');

    if (fs.existsSync(videoPath)) {
      console.log(`  🎬 มีวิดีโออยู่แล้ว (${(fs.statSync(videoPath).size / 1024 / 1024).toFixed(1)}MB) — ข้ามการสร้าง`);
    } else if (fs.existsSync(tiktokMdPath)) {
      console.log(`  🎬 กำลังสร้างวิดีโอ...`);
      await sendMsg(`🎬 กำลังสร้างวิดีโอ TikTok\n🛍 <b>${title}</b>\n⏳ กรุณารอสักครู่ (~2-5 นาที)`);
      try {
        execFileSync(process.execPath, ['make-tiktok-video.js', id], {
          cwd: ROOT, stdio: 'inherit', timeout: 10 * 60 * 1000,
        });
        if (fs.existsSync(videoPath)) {
          const sizeMB = (fs.statSync(videoPath).size / 1024 / 1024).toFixed(1);
          console.log(`  ✅ วิดีโอสร้างเสร็จ: ${sizeMB}MB`);
          await sendMsg(`✅ สร้างวิดีโอสำเร็จ! (${sizeMB}MB)\nกำลังแสดง content รอ Approve 👇`);
        }
      } catch (e) {
        const errMsg = (e.stdout || e.stderr || e.message || '').substring(0, 200);
        console.error(`  ⚠️ สร้างวิดีโอล้มเหลว: ${errMsg}`);
        await sendMsg(`⚠️ สร้างวิดีโอไม่สำเร็จ — ดำเนินการต่อโดยไม่มีวิดีโอ\n<code>${errMsg}</code>`);
      }
    }

    const approved = await approveLoop(id, data);
    if (approved) {
      const allOk = await postAndReport(id, title);
      if (allOk) posted.push(id); else skipped.push(id);
    } else {
      skipped.push(id);
    }
  }

  await sendMsg(
    `📊 <b>สรุป ${label}</b>\n` +
    `✅ โพสต์แล้ว: <b>${posted.length}</b> รายการ\n` +
    `⏭ ข้าม/ปฏิเสธ: <b>${skipped.length}</b> รายการ`
  );
  console.log(`\n✅ เสร็จสิ้น — โพสต์ ${posted.length}/${products.length} รายการ`);

  if (!argItemId) {
    const oldProducts = dirs
      .filter(d => fs.existsSync(path.join('products', d, 'data.json')))
      .map(id => ({ id, data: JSON.parse(fs.readFileSync(path.join('products', id, 'data.json'), 'utf8')) }))
      .filter(({ data: d }) => d.status !== 'placeholder' && d.post_date < today)
      .sort((a, b) => b.data.post_date.localeCompare(a.data.post_date));

    if (oldProducts.length) {
      const { data: ask, cbId: askCb } = await (async () => {
        await sendMsg(
          `📦 มีสินค้าเก่า <b>${oldProducts.length}</b> รายการ\nต้องการโพสต์ด้วยไหม?`,
          [[{ text: '📋 แสดงรายการ', callback_data: 'old_show' },
            { text: '❌ ไม่ต้องการ',  callback_data: 'old_skip' }]]
        );
        return waitForCallback(['old_show', 'old_skip'], 5 * 60 * 1000);
      })();
      if (askCb) await answerCb(askCb, '');
      if (ask === 'old_show') await handleOldProducts(oldProducts);
    }
  }
}

// ─── Startup ──────────────────────────────────────────────────────────────────

function startup(token = BOT_TOKEN, chatId = CHAT_ID) {
  if (!token || !chatId) {
    console.error('❌ ขาด MALI_TELEGRAM_BOT_TOKEN (หรือ TELEGRAM_BOT_TOKEN) หรือ TELEGRAM_CHAT_ID ใน .env');
    process.exit(1);
    return;
  }
  acquireLock();
  main().catch(e => { console.error(e.message); process.exit(1); });
}

if (require.main === module) startup();

module.exports = {
  tgApi, sendMsg, editMsg, answerCb,
  waitForCallback, waitForDecision, initOffset,
  regenerateFromTemplate, postFbClip, postAllPlatforms,
  approveLoop, todayString, acquireLock, main, startup,
};
