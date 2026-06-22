/**
 * telegram-bot.js — Telegram Approval Bot
 *
 * รันเป็น background process — รอรับ approve/reject content ก่อนโพสต์ Facebook
 *
 * ใช้งาน:
 *   node telegram-bot.js
 *
 * Flow:
 *   generate.js สร้าง content → ส่งขอ approve → bot รอรับปุ่ม
 *   ✅ อนุมัติ  → node post.js {slug} --platform fb --schedule  (FB schedule เท่านั้น, IG ข้าม)
 *   🔄 สร้างใหม่ → node generate.js {slug} --force → ส่งขอ approve ใหม่
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });
const https    = require('https');
const crypto   = require('crypto');
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

// queue file สำหรับ map shortId → {slug, platform}  (Telegram callback_data จำกัด 64 bytes)
const TG_QUEUE_FILE        = path.join(__dirname, '_tg_queue.json');
const MAKRUT_QUEUE_FILE    = path.join(__dirname, '..', '..', 'makrut', 'pipeline', '_tg_queue.json');
function loadQueue(file) {
  try { return JSON.parse(fs.readFileSync(file || TG_QUEUE_FILE, 'utf8')); } catch { return {}; }
}
function saveQueue(queue) {
  try { fs.writeFileSync(TG_QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf8'); } catch {}
}
function makeShortId(slug) {
  return crypto.createHash('md5').update(slug).digest('hex').substring(0, 12);
}
// คืน {slug, platform, pipelineRoot?} หรือ null — merge queue ทุก pipeline
function resolveEntry(shortId) {
  // manao ก่อน, makrut ถัดไป (manao takes precedence ถ้า shortId ชนกัน)
  const queue = { ...loadQueue(MAKRUT_QUEUE_FILE), ...loadQueue(TG_QUEUE_FILE) };
  const val = queue[shortId];
  if (!val) return null;
  if (typeof val === 'string') return { slug: val, platform: 'fb' }; // backward compat
  return val;
}

// แยก token: AI-News (manao) ใช้บอทของตัวเอง (fallback ไป TELEGRAM_BOT_TOKEN)
const TOKEN    = (process.env.MANAO_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').replace(/"/g, '').trim();
const CHAT_ID  = (process.env.TELEGRAM_CHAT_ID    || '').replace(/"/g, '').trim();
const NEWS_DIR = path.join(__dirname, 'news');
const PID_FILE = path.join(__dirname, 'telegram-bot.pid');

if (!TOKEN || !CHAT_ID) {
  console.error('❌ ขาด TELEGRAM_BOT_TOKEN หรือ TELEGRAM_CHAT_ID ใน .env');
  process.exit(1);
}

// บันทึก PID เพื่อให้ run-pipeline.ps1 ตรวจสอบได้
fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
process.on('exit', () => { try { fs.unlinkSync(PID_FILE); } catch {} });
process.on('SIGINT',  () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// ป้องกัน crash จาก unhandled rejection / uncaught exception
process.on('unhandledRejection', (reason) => {
  console.log(`[Bot] ⚠️  unhandledRejection: ${reason?.message || reason}`);
  console.error(`[Bot] unhandledRejection: ${reason?.message || reason}`);
});
process.on('uncaughtException', (err) => {
  console.log(`[Bot] ⚠️  uncaughtException: ${err.message}`);
  console.error(`[Bot] uncaughtException: ${err.message}`);
  // ไม่ exit — ให้ bot ทำงานต่อ
});

console.log(`🤖 Telegram Approval Bot เริ่มทำงาน (PID: ${process.pid})`);
console.log(`   Chat ID : ${CHAT_ID}`);
console.log(`   Token   : ...${TOKEN.slice(-8)}\n`);

// ─── Telegram API ─────────────────────────────────────────────────────────────

function telegramReq(method, body) {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) },
      // บางเครือข่าย (เช่น proxy ของมหาวิทยาลัย) ทำ SSL inspection
      // ทำให้ certificate ของ api.telegram.org ไม่ตรง → ต้อง bypass TLS check
      rejectUnauthorized: false,
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch { reject(new Error('Telegram parse error: ' + buf.substring(0, 100))); }
      });
    });
    req.setTimeout(35000, () => { req.destroy(); reject(new Error('Telegram timeout')); });
    req.on('error', reject);
    req.write(json);
    req.end();
  });
}

function escapeHtml(t = '') {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendMessage(text, keyboard = null) {
  const body = { chat_id: CHAT_ID, text, parse_mode: 'HTML' };
  if (keyboard) body.reply_markup = keyboard;
  return telegramReq('sendMessage', body);
}

async function editMessage(chatId, messageId, text, keyboard = null) {
  const body = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
  if (keyboard) body.reply_markup = keyboard;
  return telegramReq('editMessageText', body);
}

async function answerCallback(callbackId, text = '') {
  return telegramReq('answerCallbackQuery', { callback_query_id: callbackId, text });
}

// ─── Approval message ─────────────────────────────────────────────────────────

// shortId ต้องใช้ใน keyboard เสมอ (ไม่ใช้ slug โดยตรง เพราะยาวเกิน 64 bytes)
function approvalKeyboard(shortId) {
  return {
    inline_keyboard: [[
      { text: '✅ อนุมัติ & โพสต์', callback_data: `approve:${shortId}` },
      { text: '🔄 สร้างใหม่',       callback_data: `regen:${shortId}`   },
      { text: '❌ ยกเลิก',           callback_data: `cancel:${shortId}`  },
    ]],
  };
}

function buildApprovalText(slug, data, fbContent, platform = 'fb') {
  const title    = escapeHtml(data.title || slug);
  const date     = (data.published_at || data.scraped_at || '').substring(0, 10);
  const pfLabels = { fb: '📘 Facebook', ig: '📸 Instagram', 'fb,ig': '📘 Facebook + 📸 Instagram' };
  const pfLabel  = pfLabels[platform] || platform;
  // ตัด content ให้ไม่เกิน 700 chars (Telegram limit 4096)
  const preview  = escapeHtml(fbContent.substring(0, 700)) + (fbContent.length > 700 ? '\n...' : '');
  return [
    `📰 <b>รอ Approve ก่อนโพสต์</b>`,
    `─────────────────────────`,
    `🗞 ${title}`,
    `📅 ${date}`,
    `🎯 โพสต์ไปที่: <b>${pfLabel}</b>`,
    ``,
    `📝 <b>Facebook Content Preview:</b>`,
    preview,
    `─────────────────────────`,
    `กด ✅ เพื่อ Approve และโพสต์ทันที`,
  ].join('\n');
}

// sendForApproval — ใช้โดย generate.js ด้วย (ผ่าน require)
async function sendForApproval(slug, platform = 'fb') {
  const dataPath = path.join(NEWS_DIR, slug, 'data.json');
  const fbPath   = path.join(NEWS_DIR, slug, 'content', 'facebook.md');
  if (!fs.existsSync(dataPath) || !fs.existsSync(fbPath)) {
    console.error(`[Bot] ไม่พบ data.json หรือ facebook.md: ${slug}`);
    return false;
  }
  const data      = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const fbContent = fs.readFileSync(fbPath, 'utf8');

  // บันทึก queue: shortId → {slug, platform}
  const shortId = makeShortId(slug);
  const queue   = loadQueue();
  queue[shortId] = { slug, platform };
  saveQueue(queue);

  const res = await sendMessage(buildApprovalText(slug, data, fbContent, platform), approvalKeyboard(shortId));
  if (res.ok) {
    // อัปเดต status
    try {
      data.status = 'pending_approval';
      fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
    } catch {}
    console.log(`[Bot] ✉️  ส่งขอ approve: ${slug} → ${platform}`);
    return true;
  }
  console.error(`[Bot] ❌ ส่งข้อความไม่สำเร็จ:`, JSON.stringify(res));
  return false;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleApprove(slug, platform, chatId, messageId, callbackId, pipelineRoot) {
  const pfLabels = { fb: '📘 Facebook', ig: '📸 Instagram', 'fb,ig': '📘 Facebook + 📸 Instagram' };
  const pfLabel  = pfLabels[platform] || platform;
  await answerCallback(callbackId, `⏳ กำลังโพสต์ไปที่ ${pfLabel}...`);
  await editMessage(chatId, messageId,
    `⏳ <b>กำลังโพสต์...</b>\n🗞 ${escapeHtml(slug)}\n🎯 ${pfLabel}`);
  try {
    // ถ้า pipelineRoot ต่างจาก manao → ใช้ PIPELINE_ROOT env เพื่อให้ post.js ชี้ถูก pipeline
    const cwd = __dirname; // post.js อยู่ใน manao/pipeline เสมอ
    const env = (pipelineRoot && pipelineRoot !== __dirname)
      ? { ...process.env, PIPELINE_ROOT: pipelineRoot }
      : process.env;
    const out = execSync(`node post.js "${slug}" --platform ${platform} --schedule`, {
      cwd, env, encoding: 'utf8', timeout: 5 * 60 * 1000,
    });
    console.log(`[Bot] post.js output: ${out.substring(0, 500)}`);
    const pfDone  = [];
    const pfFail  = [];
    // ตรวจสอบจาก emoji ✅ / ❌ เพื่อกันกรณี error line มีคำว่า Facebook/Instagram ด้วย
    if (out.includes('✅ Facebook'))  pfDone.push('📘 FB');
    if (out.includes('✅ Instagram')) pfDone.push('📸 IG');
    if (out.includes('❌ Facebook'))  pfFail.push('FB');
    if (out.includes('❌ Instagram')) pfFail.push('IG');

    if (pfDone.length === 0) {
      // ไม่มีแม้แต่ platform เดียวที่สำเร็จ → แสดง error
      const errLine = out.split('\n').find(l => l.includes('❌')) || out.substring(0, 250);
      await editMessage(chatId, messageId,
        `❌ <b>โพสต์ไม่สำเร็จ</b>\n🗞 ${escapeHtml(slug)}\n\n${escapeHtml(errLine.substring(0, 250))}`);
    } else {
      const doneStr = pfDone.join(' + ');
      const failNote = pfFail.length ? `\n⚠️ ล้มเหลว: ${pfFail.join(', ')}` : '';
      await editMessage(
        chatId, messageId,
        `✅ <b>โพสต์สำเร็จ!</b>\n─────────────────────────\n🗞 ${escapeHtml(slug)}\n🎯 โพสต์ไปที่: ${doneStr} แล้ว${failNote}`
      );
    }
    console.log(`[Bot] ✅ Posted: ${slug} → ${platform}`);
  } catch (e) {
    console.error(`[Bot] ❌ post.js error:`, e.message);
    await answerCallback(callbackId, '❌ โพสต์ไม่สำเร็จ');
    await editMessage(chatId, messageId,
      `❌ <b>โพสต์ไม่สำเร็จ</b>\n🗞 ${escapeHtml(slug)}\n\n${escapeHtml((e.stdout || e.message || '').substring(0, 250))}`);
  }
}

async function handleRegen(slug, chatId, messageId, callbackId) {
  await answerCallback(callbackId, '⏳ กำลังสร้าง content ใหม่...');
  await editMessage(chatId, messageId, `🔄 <b>กำลังสร้างใหม่...</b>\n🗞 ${escapeHtml(slug)}\n\nรอสักครู่นะคะ ⏳`);
  try {
    execSync(`node generate.js ${slug} --force`, { cwd: __dirname, encoding: 'utf8' });
    // generate.js จะส่ง Telegram ใหม่โดยอัตโนมัติ
    await editMessage(chatId, messageId, `🔄 <b>สร้างใหม่แล้ว</b>\n🗞 ${escapeHtml(slug)}\n\nดู content ใหม่ด้านบนนะคะ ☝️`);
    console.log(`[Bot] 🔄 Regenerated: ${slug}`);
  } catch (e) {
    await sendMessage(`❌ สร้าง content ใหม่ไม่สำเร็จ\n${escapeHtml(e.message.substring(0, 200))}`);
    console.error(`[Bot] ❌ generate.js error:`, e.message);
  }
}

// ─── Long polling ─────────────────────────────────────────────────────────────

let offset = 0;

async function poll() {
  while (true) {
    try {
      const res = await telegramReq('getUpdates', {
        offset,
        timeout: 30,
        allowed_updates: ['callback_query'],
      });

      if (!res.ok || !res.result?.length) continue;

      for (const update of res.result) {
        offset = update.update_id + 1;
        const cb = update.callback_query;
        if (!cb?.data) continue;

        const colonIdx  = cb.data.indexOf(':');
        const action    = cb.data.substring(0, colonIdx);
        const shortId   = cb.data.substring(colonIdx + 1);
        const entry     = resolveEntry(shortId);
        const msgId     = cb.message?.message_id;
        const msgChatId = String(cb.message?.chat?.id ?? CHAT_ID);

        console.log(`[Bot] update_id=${update.update_id} action=${action} shortId=${shortId} chatId=${msgChatId}`);

        if (!entry) {
          console.error(`[Bot] ไม่พบ entry สำหรับ shortId: ${shortId}`);
          await answerCallback(cb.id, '❌ ไม่พบข่าวนี้ใน queue');
          continue;
        }

        const { slug, platform = 'fb', pipelineRoot } = entry;
        console.log(`[Bot] callback: ${action} → ${slug} [${platform}]`);

        if (action === 'approve') await handleApprove(slug, platform, msgChatId, msgId, cb.id, pipelineRoot);
        else if (action === 'regen') await handleRegen(slug, msgChatId, msgId, cb.id);
        else if (action === 'cancel') {
          await answerCallback(cb.id, '❌ ยกเลิกแล้ว');
          await editMessage(msgChatId, msgId, `❌ <b>ยกเลิก</b>\n🗞 ${escapeHtml(slug)}`);
        }
        else await answerCallback(cb.id, '❓ ไม่รู้จักคำสั่ง');
      }
    } catch (e) {
      // log ไปทั้ง stdout และ stderr เพื่อให้เห็นใน telegram-bot.log
      const msg = `[Bot] poll error: ${e.message}`;
      console.log(msg);
      console.error(msg);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ส่ง startup message
sendMessage('🤖 <b>Telegram Approval Bot เริ่มทำงานแล้วค่ะ</b>\nรอรับ content สำหรับ approve...')
  .then(() => poll())
  .catch(e => { console.error('ส่ง startup message ไม่สำเร็จ:', e.message); poll(); });

module.exports = { sendForApproval };
