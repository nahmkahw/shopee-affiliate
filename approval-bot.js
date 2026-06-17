/**
 * approval-bot.js — Telegram Approval Bot สำหรับ Shopee Affiliate FB Posts
 *
 * Flow:
 *   1. หาสินค้าของวันปัจจุบัน
 *   2. ส่ง Facebook content ไปยัง Telegram พร้อมปุ่ม ✅ โพสต์ / 🔄 สร้างใหม่
 *   3. รอการตอบกลับ (timeout 1 ชั่วโมง)
 *   4. ถ้า Approve  → node post.js {item_id} --platform fb
 *   5. ถ้า Regenerate → Claude API สร้าง content ใหม่ → ส่งรอ Approve อีกครั้ง
 *
 * .env ที่ต้องมี:
 *   TELEGRAM_BOT_TOKEN=xxxxx:yyyyyyy
 *   TELEGRAM_CHAT_ID=123456789
 */

require('dotenv').config();
const https                      = require('https');
const http                       = require('http');
const fs                         = require('fs');
const path                       = require('path');
const { execSync, execFileSync } = require('child_process');

const HUB_PORT = 3002; // agent-hub port

// ─── Lock file — ป้องกันรันซ้อนกัน (หลายตัวแย่งกัน consume Telegram updates) ───

const LOCK_FILE = path.join(__dirname, '.approval-bot.lock');

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const pid = fs.readFileSync(LOCK_FILE, 'utf8').trim();
    // ตรวจว่า process ยังมีชีวิตอยู่ไหม
    try {
      process.kill(Number(pid), 0); // ถ้า throw = process ตายแล้ว
      console.error(`❌ approval-bot กำลังรันอยู่แล้ว (PID: ${pid})\nถ้าค้างอยู่ให้ลบไฟล์ .approval-bot.lock แล้วรันใหม่`);
      process.exit(1);
    } catch {
      // process นั้นตายแล้ว → ลบ lock เก่าออก
      fs.unlinkSync(LOCK_FILE);
    }
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
  // ลบ lock เมื่อ process จบ
  process.on('exit',   () => { try { fs.unlinkSync(LOCK_FILE); } catch {} });
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM',() => process.exit(0));
}

// ─── Credentials ──────────────────────────────────────────────────────────────

const BOT_TOKEN = (process.env.MALI_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').replace(/"/g, '').trim();
const CHAT_ID   = (process.env.TELEGRAM_CHAT_ID || '').replace(/"/g, '').trim();


// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ─── Telegram API ─────────────────────────────────────────────────────────────

function tgApi(method, params = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(buf); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const sendMsg = (text, keyboard = null) => {
  const params = { chat_id: CHAT_ID, text: text.substring(0, 4096), parse_mode: 'HTML' };
  if (keyboard) params.reply_markup = { inline_keyboard: keyboard };
  return tgApi('sendMessage', params);
};

const editMsg = (msgId, text, keyboard = null) => {
  const params = { chat_id: CHAT_ID, message_id: msgId, text: text.substring(0, 4096), parse_mode: 'HTML' };
  if (keyboard) params.reply_markup = { inline_keyboard: keyboard };
  return tgApi('editMessageText', params);
};

const answerCb = (cbId, text = 'OK') =>
  tgApi('answerCallbackQuery', { callback_query_id: cbId, text });

// ─── Long-poll สำหรับ callback query ─────────────────────────────────────────

let globalOffset = 0;

async function initOffset() {
  const res = await tgApi('getUpdates', { limit: 1, offset: -1 });
  if (res.result?.length) globalOffset = res.result[0].update_id + 1;
}

// รอ callback ใด ๆ จาก validCbs array
async function waitForCallback(validCbs, timeoutMs = 60 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await tgApi('getUpdates', {
        offset: globalOffset, timeout: 25, allowed_updates: ['callback_query']
      });
      if (res.result) {
        for (const upd of res.result) {
          globalOffset = upd.update_id + 1;
          const cb = upd.callback_query;
          if (!cb) continue;
          if (validCbs.includes(cb.data)) return { data: cb.data, cbId: cb.id };
        }
      }
    } catch (e) {
      console.error('[TG] getUpdates error:', e.message);
    }
    await sleep(500);
  }
  return { data: 'timeout', cbId: null };
}

// wrapper สำหรับ approve/regen flow เดิม
async function waitForDecision(approveData, regenData, timeoutMs = 60 * 60 * 1000) {
  const { data, cbId } = await waitForCallback([approveData, regenData], timeoutMs);
  if (data === 'timeout') return { decision: 'timeout', cbId: null };
  return { decision: data === approveData ? 'approve' : 'regen', cbId };
}

// ─── Template — สร้าง Facebook content ใหม่ (ไม่ต้องใช้ API Key) ───────────────

function regenerateFromTemplate(data, attempt) {
  // hook หมุนเวียนตามจำนวนครั้งที่ regenerate
  const hooks = [
    `ใครกำลังมองหา "${(data.title || '').substring(0, 30)}" อยู่บ้าง? 🙋\n\nบอกเลยว่าเจอของตรงปกแล้ว!`,
    `รู้สึกเสียดายเงินกับของที่ซื้อแล้วไม่คุ้มไหม? 💸\n\nครั้งนี้ขอแนะนำตัวเลือกที่น่าสนใจมากกว่านั้น`,
    `ของดีราคาคุ้ม หายากแค่ไหน? 🔍\n\nไม่ต้องตามหาอีกต่อไป เจอแล้ว!`,
    `ช้อปออนไลน์แล้วผิดหวังบ่อยไหม? 😅\n\nรายการนี้รีวิวดีมาก บอกต่อเลย`,
    `ของที่ใช้แล้วชอบ อยากแชร์ให้เพื่อน ๆ รู้จัก 📢`,
  ];
  const hook = hooks[(attempt - 1) % hooks.length];

  // สร้าง feature list จากข้อมูลที่มี
  const features = [];
  if (data.rating) features.push(`⭐ รีวิว ${data.rating}/5 — ผู้ซื้อให้คะแนนสูง`);
  if (data.discount) features.push(`🏷️ ลดราคา ${data.discount} จากราคาปกติ`);
  if (data.shop_name) features.push(`🏪 จากร้าน ${data.shop_name} ที่เชื่อถือได้`);
  features.push(`✅ สินค้าพร้อมส่ง ของแท้ 100%`);

  // ส่วนราคา
  const priceSection = data.original_price
    ? `~~${data.original_price} บาท~~ → เหลือแค่ **${data.price} บาท** เท่านั้น!`
    : `ราคา **${data.price} บาท** เท่านั้น!`;

  return `${hook}

ขอแนะนำ ${data.title}

${features.join('\n')}

${priceSection}

สั่งซื้อ / ดูรายละเอียดเพิ่ม 👉 ${data.affiliate_short_link}
.
.
#Shopeeaffiliate #รีวิวของดี #Shopeeไทย #ของน่าซื้อ`;
}

// ─── โพสต์ fb schedule + fb-clip (ถ้ามี video.mp4) — IG ข้าม ────────────────

async function postFbClip(itemId) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ id: itemId });
    const req = http.request({
      hostname: 'localhost',
      port: HUB_PORT,
      path: '/dashboard/mali/api/post-fb-clip',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch { resolve({ ok: false, error: buf.substring(0, 100) }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(5 * 60 * 1000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

async function postAllPlatforms(itemId) {
  const results = {};

  // 1) Facebook schedule เท่านั้น (IG ข้าม)
  try {
    const out = execFileSync(process.execPath, ['post.js', itemId, '--platform', 'fb', '--schedule'], {
      cwd: path.resolve(__dirname), encoding: 'utf8', timeout: 120_000, maxBuffer: 10 * 1024 * 1024
    });
    const fbOk = out.includes('Facebook') && (out.includes('post_id') || out.includes('✅'));
    results.fb = fbOk ? '✅ Scheduled' : '⚠️ ไม่แน่ใจ';
    results.ig = '⏭ ข้าม (IG ไม่รองรับ schedule)';
    console.log(out);
  } catch (e) {
    const msg = (e.stdout || e.message || '').substring(0, 200);
    results.fb = '❌ ล้มเหลว';
    results.ig = '⏭ ข้าม';
    results.error = msg;
  }

  // 2) FB Clip (ถ้ามี video.mp4)
  const videoPath = path.join(__dirname, 'products', itemId, 'video.mp4');
  if (fs.existsSync(videoPath)) {
    const r = await postFbClip(itemId);
    results.fbClip = r.ok ? `✅ สำเร็จ` : `❌ ${(r.error || '').substring(0, 80)}`;
  } else {
    results.fbClip = '⏭ ไม่มี video.mp4';
  }

  return results;
}

// ─── Approval loop สำหรับสินค้า 1 ชิ้น ──────────────────────────────────────

async function approveLoop(itemId, data) {
  const title       = (data.title || '').substring(0, 35);
  const contentPath = path.join('products', itemId, 'content', 'facebook.md');

  if (!fs.existsSync(contentPath)) {
    await sendMsg(
      `⚠️ ไม่พบ facebook.md สำหรับ\n<b>${title}</b> (${itemId})\n` +
      `กรุณารัน /สร้าง-content ก่อน`
    );
    return false;
  }

  let attempt = 0;

  while (true) {
    attempt++;
    const content = fs.readFileSync(contentPath, 'utf8').trim();
    const preview = content.length > 3200 ? content.substring(0, 3200) + '\n...' : content;

    const header =
      `📝 <b>รอ Approve (ครั้งที่ ${attempt})</b>\n` +
      `🛍 ${title}\n💰 ${data.price} บาท | ⭐ ${data.rating}\n` +
      `${'─'.repeat(28)}\n`;

    const apData = `ap_${itemId}_${attempt}`;
    const rgData = `rg_${itemId}_${attempt}`;

    const msg   = await sendMsg(header + preview, [[
      { text: '✅ โพสต์เลย',           callback_data: apData },
      { text: '🔄 สร้าง Content ใหม่', callback_data: rgData }
    ]]);
    const msgId = msg.result?.message_id;

    const { decision, cbId } = await waitForDecision(apData, rgData);

    // ── Timeout ───────────────────────────────────────────────────────────────
    if (decision === 'timeout') {
      if (msgId) await editMsg(msgId, header + preview + '\n\n⏰ <b>หมดเวลา — ข้ามสินค้านี้</b>');
      return false;
    }

    // ── Approve ───────────────────────────────────────────────────────────────
    if (decision === 'approve') {
      await answerCb(cbId, '✅ กำลังโพสต์...');
      if (msgId) await editMsg(msgId, header + preview + '\n\n✅ <b>Approved — กำลังโพสต์...</b>');
      return true;
    }

    // ── Regenerate ────────────────────────────────────────────────────────────
    await answerCb(cbId, '🔄 กำลังสร้าง content ใหม่...');
    try { if (msgId) await editMsg(msgId, header + preview + '\n\n🔄 <b>กำลังสร้าง content ใหม่...</b>'); } catch {}

    try {
      const newContent = regenerateFromTemplate(data, attempt);
      fs.writeFileSync(contentPath, newContent, 'utf8');
      console.log(`  ✓ สร้าง content ใหม่สำเร็จ (รอบที่ ${attempt})`);
    } catch (e) {
      await sendMsg(
        `❌ สร้าง content ใหม่ไม่สำเร็จ: ${e.message.substring(0, 200)}\n` +
        `กรุณาสร้างเองแล้วรัน approval-bot.js ใหม่`
      );
      return false;
    }

    // แจ้งก่อนส่ง approval message ใหม่ เพื่อให้รู้ว่ามีข้อความใหม่ด้านล่าง
    await sendMsg(`🔄 สร้าง content ใหม่เรียบร้อยแล้ว!\nกำลังส่ง content รอบที่ ${attempt + 1} ให้ Approve 👇`);
    await sleep(500);
    // วนซ้ำ → ส่งให้ Approve อีกครั้ง
  }
}

// ─── เมนูสินค้าเก่า (paginated) ──────────────────────────────────────────────

async function handleOldProducts(oldProducts) {
  const PAGE = 8;
  let page = 0;

  while (true) {
    const slice    = oldProducts.slice(page * PAGE, page * PAGE + PAGE);
    const totalPg  = Math.ceil(oldProducts.length / PAGE);
    const hasNext  = (page + 1) * PAGE < oldProducts.length;
    const hasPrev  = page > 0;

    // ปุ่มสินค้า
    const keyboard = slice.map(({ id, data }) => [{
      text: `${data.post_date} | ${(data.title || '').substring(0, 22)}`,
      callback_data: `os_${id}`
    }]);

    // ปุ่มนำทาง
    const nav = [];
    if (hasPrev) nav.push({ text: '⬅️ ก่อนหน้า', callback_data: `op_${page - 1}` });
    nav.push({ text: '✅ เสร็จแล้ว', callback_data: 'old_done' });
    if (hasNext) nav.push({ text: 'ถัดไป ➡️', callback_data: `op_${page + 1}` });
    keyboard.push(nav);

    const msg   = await sendMsg(
      `📦 <b>สินค้าเก่า</b> — เลือกรายการที่ต้องการโพสต์\n` +
      `หน้า ${page + 1}/${totalPg} (${oldProducts.length} รายการ)`,
      keyboard
    );
    const msgId = msg.result?.message_id;

    // รอ callback ที่ถูกต้อง
    const validCbs = [
      ...slice.map(({ id }) => `os_${id}`),
      'old_done',
      ...(hasPrev ? [`op_${page - 1}`] : []),
      ...(hasNext ? [`op_${page + 1}`] : [])
    ];

    const { data, cbId } = await waitForCallback(validCbs, 10 * 60 * 1000);
    if (cbId) await answerCb(cbId, '');

    // เสร็จแล้ว / timeout
    if (data === 'timeout' || data === 'old_done') {
      if (msgId) await editMsg(msgId, `📦 สินค้าเก่า — ✅ เสร็จแล้ว`);
      return;
    }

    // เปลี่ยนหน้า
    if (data.startsWith('op_')) {
      page = parseInt(data.slice(3));
      if (msgId) await editMsg(msgId, `📦 กำลังโหลดหน้า ${page + 1}...`);
      continue;
    }

    // เลือกสินค้า
    if (data.startsWith('os_')) {
      const selId  = data.slice(3);
      const selPrd = oldProducts.find(p => p.id === selId);
      if (!selPrd) continue;

      if (msgId) await editMsg(msgId,
        `📝 กำลังแสดง content ของ\n<b>${(selPrd.data.title || '').substring(0, 40)}</b>...`
      );

      const approved = await approveLoop(selPrd.id, selPrd.data);
      if (approved) {
        const selTitle = (selPrd.data.title || '').substring(0, 35);
        await sendMsg(`⏳ กำลังโพสต์ <b>${selTitle}</b> ไปยัง FB Schedule + FB Clip...`);
        const r = await postAllPlatforms(selPrd.id);
        const summary =
          `📘 Facebook: ${r.fb}\n` +
          `📸 Instagram: ⏭ ข้าม\n` +
          `🎬 FB Reels: ${r.fbClip}` +
          (r.error ? `\n\n⚠️ Error: ${r.error}` : '');
        const allOk = r.fb.startsWith('✅');
        await sendMsg((allOk ? '✅' : '⚠️') + ` <b>โพสต์เสร็จแล้ว</b>\n🛍 ${selTitle}\n\n${summary}`);
      }
      // กลับไปแสดงเมนูสินค้าเก่า
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const today    = todayString();
  // รองรับ argument: node approval-bot.js {item_id}
  const argItemId = process.argv[2]?.match(/^\d{8,}$/) ? process.argv[2] : null;

  console.log(`🤖 Approval Bot — ${argItemId ? 'ทดสอบ item_id: ' + argItemId : today}`);

  await initOffset(); // flush stale Telegram updates

  // หาสินค้า: ถ้ามี argument ใช้ item_id, ไม่งั้นใช้ post_date วันนี้
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
    const label = argItemId ? `item_id: ${argItemId}` : `วันที่ ${today}`;
    await sendMsg(`📭 ไม่พบสินค้า ${label}`);
    console.log('ไม่พบสินค้า');
    return;
  }

  const label = argItemId ? `🧪 ทดสอบ` : today;
  await sendMsg(
    `🚀 <b>Shopee Affiliate — ${label}</b>\n` +
    `พบ <b>${products.length}</b> รายการ รอ Approve\n\n` +
    `กด ✅ เพื่อโพสต์ หรือ 🔄 เพื่อสร้าง content ใหม่`
  );

  const posted  = [];
  const skipped = [];

  for (const { id, data } of products) {
    const title = (data.title || '').substring(0, 35);
    console.log(`\n[${id}] ${title}`);

    // ── สร้างวิดีโอก่อนส่ง Telegram (ถ้ายังไม่มี video.mp4) ──────────────────
    const videoPath    = path.join('products', id, 'video.mp4');
    const tiktokMdPath = path.join('products', id, 'content', 'tiktok.md');

    if (fs.existsSync(videoPath)) {
      const sizeMB = (fs.statSync(videoPath).size / 1024 / 1024).toFixed(1);
      console.log(`  🎬 มีวิดีโออยู่แล้ว (${sizeMB}MB) — ข้ามการสร้าง`);
    } else if (fs.existsSync(tiktokMdPath)) {
      console.log(`  🎬 กำลังสร้างวิดีโอ...`);
      await sendMsg(
        `🎬 กำลังสร้างวิดีโอ TikTok\n` +
        `🛍 <b>${title}</b>\n` +
        `⏳ กรุณารอสักครู่ (~2-5 นาที)`
      );
      try {
        execFileSync(process.execPath, ['make-tiktok-video.js', id], {
          cwd:     path.resolve(__dirname),
          stdio:   'inherit',           // output ตรงไป console ไม่ buffer — ป้องกัน overflow
          timeout: 10 * 60 * 1000,     // 10 นาที
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
    // (ไม่มี tiktok.md → ข้ามการสร้างวิดีโอเงียบๆ)

    const approved = await approveLoop(id, data);

    if (approved) {
      await sendMsg(`⏳ กำลังโพสต์ <b>${title}</b> ไปยัง FB Schedule + FB Clip...`);
      const r = await postAllPlatforms(id);
      const summary =
        `📘 Facebook: ${r.fb}\n` +
        `📸 Instagram: ⏭ ข้าม\n` +
        `🎬 FB Reels: ${r.fbClip}` +
        (r.error ? `\n\n⚠️ Error: ${r.error}` : '');
      const allOk = r.fb.startsWith('✅');
      await sendMsg((allOk ? '✅' : '⚠️') + ` <b>โพสต์เสร็จแล้ว</b>\n🛍 ${title}\n\n${summary}`);
      if (allOk) posted.push(id); else skipped.push(id);
    } else {
      skipped.push(id);
    }
  }

  // สรุปวันนี้
  await sendMsg(
    `📊 <b>สรุป ${label}</b>\n` +
    `✅ โพสต์แล้ว: <b>${posted.length}</b> รายการ\n` +
    `⏭ ข้าม/ปฏิเสธ: <b>${skipped.length}</b> รายการ`
  );
  console.log(`\n✅ เสร็จสิ้น — โพสต์ ${posted.length}/${products.length} รายการ`);

  // ── เสนอโพสต์สินค้าเก่า (เฉพาะ mode รันตามวันที่ ไม่ใช่ทดสอบ item_id) ──────────
  if (!argItemId) {
    const oldProducts = dirs
      .filter(d => fs.existsSync(path.join('products', d, 'data.json')))
      .map(id => ({ id, data: JSON.parse(fs.readFileSync(path.join('products', id, 'data.json'), 'utf8')) }))
      .filter(({ data: d }) => d.status !== 'placeholder' && d.post_date < today)
      .sort((a, b) => b.data.post_date.localeCompare(a.data.post_date));

    if (oldProducts.length) {
      const askMsg = await sendMsg(
        `📦 มีสินค้าเก่า <b>${oldProducts.length}</b> รายการ\nต้องการโพสต์ด้วยไหม?`,
        [[
          { text: '📋 แสดงรายการ', callback_data: 'old_show' },
          { text: '❌ ไม่ต้องการ',  callback_data: 'old_skip' }
        ]]
      );
      const { data: ask, cbId: askCb } = await waitForCallback(['old_show', 'old_skip'], 5 * 60 * 1000);
      if (askCb) await answerCb(askCb, '');
      if (ask === 'old_show') await handleOldProducts(oldProducts);
    }
  }
}

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
  tgApi,
  sendMsg,
  editMsg,
  answerCb,
  waitForCallback,
  waitForDecision,
  regenerateFromTemplate,
  postFbClip,
  postAllPlatforms,
  approveLoop,
  todayString,
  initOffset,
  main,
  acquireLock,
  startup,
};
