/**
 * anime-bot.js — Telegram bot สำหรับ Agent อนิเมะ
 *
 * Flow:
 *   1) ผู้ใช้ส่งข้อความไทยเข้าบอท (หรือ cron เตือนตามเวลา)
 *   2) ใช้ active-template.json (รูปต้นแบบ + prompt + faceWeight + tailFrac) + ข้อความ → สร้างรูปอนิเมะ + ลูกโป่ง
 *   3) ส่งรูปกลับ Telegram พร้อมปุ่ม [✅ อนุมัติ → โพสต์] [❌ ยกเลิก]
 *   4) อนุมัติ → โพสต์ FB + IG (caption = ข้อความลูกโป่ง)
 *
 * ต้องตั้งใน .env: ANIME_TELEGRAM_BOT_TOKEN, ANIME_TELEGRAM_CHAT_ID
 * รัน: node agents/anime/anime-bot.js
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const ROOT = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const { generateAnime }        = require('./anime-gen');
const { renderBalloonOnImage }  = require('./balloon-canvas');
const { summarizeBubble }       = require('./bubble-gen');
const { postFacebookImage, postInstagramImage } = require('./post-anime');

const TOKEN   = process.env.ANIME_TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.ANIME_TELEGRAM_CHAT_ID;
const TPL_FILE = path.join(__dirname, 'active-template.json');
const GAL_DIR  = path.join(__dirname, 'gallery');
const LOCK     = path.join(__dirname, '.anime-bot.lock');

if (!TOKEN || !CHAT_ID) {
  console.error('❌ ขาด ANIME_TELEGRAM_BOT_TOKEN หรือ ANIME_TELEGRAM_CHAT_ID ใน .env');
  process.exit(1);
}

// ─── Telegram API ───────────────────────────────────────────────────────────────
function tg(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params);
    const req = https.request({
      hostname: 'api.telegram.org', path: `/bot${TOKEN}/${method}`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({}); } }); });
    req.on('error', reject); req.write(body); req.end();
  });
}

// ส่งรูปแบบ document (Telegram ไม่บีบอัด → คงความละเอียดเต็ม) พร้อมปุ่ม
// field "document" แทน "photo" — sendPhoto จะบีบอัด/ลดขนาดเหลือ ~1280px
function tgSendDocument(imagePath, caption, replyMarkup) {
  return new Promise((resolve, reject) => {
    const boundary = '----AnimeTG' + Date.now();
    const parts = [];
    const field = (n, v) => parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`));
    field('chat_id', CHAT_ID);
    if (caption) field('caption', caption.substring(0, 1024));
    if (replyMarkup) field('reply_markup', JSON.stringify(replyMarkup));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="anime.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`));
    parts.push(fs.readFileSync(imagePath));
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const payload = Buffer.concat(parts);
    const req = https.request({
      hostname: 'api.telegram.org', path: `/bot${TOKEN}/sendDocument`, method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': payload.length },
    }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({}); } }); });
    req.on('error', reject); req.write(payload); req.end();
  });
}

const send = text => tg('sendMessage', { chat_id: CHAT_ID, text });

// ดาวน์โหลดรูปที่ผู้ใช้ส่งเข้าบอท → คืน path ไฟล์ในเครื่อง
function tgDownloadPhoto(fileId) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.telegram.org/bot${TOKEN}/getFile?file_id=${fileId}`, r => {
      let b = ''; r.on('data', d => b += d); r.on('end', () => {
        let fp; try { fp = JSON.parse(b).result.file_path; } catch { return reject(new Error('getFile fail')); }
        const out = path.join(require('os').tmpdir(), `anime_tg_${Date.now()}.jpg`);
        const ws = fs.createWriteStream(out);
        https.get(`https://api.telegram.org/file/bot${TOKEN}/${fp}`, fr => {
          fr.pipe(ws); ws.on('finish', () => { ws.close(); resolve(out); });
        }).on('error', reject);
      });
    }).on('error', reject);
  });
}

// ─── Template + generation ──────────────────────────────────────────────────────
function loadTemplate() {
  try { return JSON.parse(fs.readFileSync(TPL_FILE, 'utf8').replace(/^﻿/, '')); }
  catch { return null; }
}

let busy = false;
let pendingSource = null;   // รูป override จาก Telegram (ส่งรูปไม่มีแคปชั่น → รอข้อความ)

async function handleText(text, overrideSource) {
  text = (text || '').trim();
  if (!text || text.startsWith('/')) return;
  if (busy) return send('⏳ กำลังสร้างรูปอยู่ รอสักครู่นะคะ');

  const tpl = loadTemplate();
  // รูปต้นแบบ: override (รูปที่ส่งมา) > pendingSource > template
  const src = overrideSource || pendingSource || (tpl && tpl.sourceImage);
  if (!src || !fs.existsSync(src))
    return send('⚠️ ยังไม่มีรูปต้นแบบ — ส่งรูปเข้ามา หรือไปตั้ง template ที่ Dashboard ก่อน');
  pendingSource = null;   // ใช้แล้วล้าง

  const prompt     = (tpl && tpl.prompt) || '1person, upper body';
  const faceWeight = (tpl && tpl.faceWeight) || 1.1;
  const tailFrac   = (tpl && tpl.tailFrac) || { x: 0.46, y: 0.46 };

  busy = true;
  try {
    await send(`🎨 กำลังสร้างรูป… "${text.substring(0, 40)}"`);
    const id   = Date.now().toString();
    const dir  = path.join(GAL_DIR, id);
    fs.mkdirSync(dir, { recursive: true });
    const animePath = path.join(dir, 'anime.png');
    const finalPath = path.join(dir, 'final.jpg');

    await generateAnime(src, {
      prompt, faceWeight,
      loraStrength: Math.max(0.6, Math.min(1.0, faceWeight * 0.75)),
      outPath: animePath, onProgress: m => console.log(`  [bot ${id}] ${m}`),
    });

    await send('💬 AI กำลังสรุปบทพูด...');
    const { text: bubbleText, type: bubbleType } = await summarizeBubble(text);
    console.log(`  [bot ${id}] bubble: [${bubbleType}] "${bubbleText}"`);
    await renderBalloonOnImage(animePath, bubbleText, tailFrac, finalPath, { template: bubbleType });

    try { fs.copyFileSync(src, path.join(dir, 'source.jpg')); } catch {}
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
      prompt, text, bubbleText, bubbleType, faceWeight, balloon: { tailFrac },
      fromTemplate: tpl ? tpl.templateId : null, created: Number(id),
    }, null, 2), 'utf8');

    const captionBubble = bubbleText !== text.trim().slice(0, 60)
      ? `💬 "${bubbleText}"\n📝 จาก: "${text.substring(0, 60)}${text.length > 60 ? '…' : ''}"`
      : `💬 "${bubbleText}"`;
    await tgSendDocument(finalPath, `📷 รูปใหม่พร้อมแล้ว (ความละเอียดเต็ม)\n${captionBubble}\n\nอนุมัติเพื่อโพสต์ FB + IG?`, {
      inline_keyboard: [[
        { text: '✅ อนุมัติ → โพสต์', callback_data: `ok__${id}` },
        { text: '❌ ยกเลิก', callback_data: `no__${id}` },
      ]],
    });
  } catch (e) {
    await send('❌ สร้างรูปไม่สำเร็จ: ' + e.message.substring(0, 150));
  } finally { busy = false; }
}

async function handleCallback(cb) {
  const data = cb.data || '';
  const msgId = cb.message && cb.message.message_id;
  await tg('answerCallbackQuery', { callback_query_id: cb.id });

  const [action, id] = data.split('__');
  const dir = path.join(GAL_DIR, String(id || '').replace(/[^\d]/g, ''));
  const finalPath = path.join(dir, 'final.jpg');
  const metaPath  = path.join(dir, 'meta.json');

  if (action === 'no') {
    if (msgId) await tg('editMessageCaption', { chat_id: CHAT_ID, message_id: msgId, caption: '❌ ยกเลิกแล้ว' });
    return;
  }
  if (action === 'ok') {
    if (!fs.existsSync(finalPath)) return send('⚠️ ไม่พบรูป');
    let caption = '';
    try { const m = JSON.parse(fs.readFileSync(metaPath, 'utf8').replace(/^﻿/, '')); caption = m.bubbleText || m.text || ''; } catch {}
    await send('📤 กำลังโพสต์ FB + IG…');
    const out = [];
    try { const pid = await postFacebookImage(finalPath, caption); out.push('✅ Facebook'); markPosted(metaPath, 'fb'); }
    catch (e) { out.push('❌ FB: ' + e.message.substring(0, 80)); }
    try { const pid = await postInstagramImage(finalPath, caption); out.push('✅ Instagram'); markPosted(metaPath, 'ig'); }
    catch (e) { out.push('❌ IG: ' + e.message.substring(0, 80)); }
    await send(out.join('\n'));
    if (msgId) await tg('editMessageCaption', { chat_id: CHAT_ID, message_id: msgId, caption: '✅ ดำเนินการแล้ว' });
  }
}

function markPosted(metaPath, p) {
  try {
    const m = JSON.parse(fs.readFileSync(metaPath, 'utf8').replace(/^﻿/, ''));
    m.posted = m.posted || {}; m.posted[p] = Date.now();
    fs.writeFileSync(metaPath, JSON.stringify(m, null, 2), 'utf8');
  } catch {}
}

// ─── Cron reminder (เตือนตามเวลา template) ───────────────────────────────────────
let lastReminded = '';
function checkCron() {
  const tpl = loadTemplate();
  if (!tpl || !tpl.time) return;
  const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });
  const hhmm = now.replace('.', ':');
  const want = tpl.time.split(':').map(s => s.padStart(2, '0')).join(':');
  const todayKey = new Date().toISOString().slice(0, 10) + ' ' + want;
  if (hhmm === want && lastReminded !== todayKey) {
    lastReminded = todayKey;
    send(`⏰ ถึงเวลาสร้างรูปประจำวันแล้ว!\nพิมพ์ข้อความลูกโป่ง (ภาษาไทย) ส่งมาได้เลยค่ะ`);
  }
}

// ─── Long-poll loop ─────────────────────────────────────────────────────────────
async function poll() {
  let offset = 0;
  console.log('🎨 anime-bot เริ่มทำงาน — รอข้อความจาก Telegram');
  while (true) {
    try {
      const res = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
      if (res.ok && res.result.length) {
        for (const u of res.result) {
          offset = u.update_id + 1;
          const m = u.message;
          if (m && String(m.chat.id) === String(CHAT_ID) && m.photo && m.photo.length) {
            // ส่งรูปเข้ามา = override รูปต้นแบบ (รูปสุดท้าย = ความละเอียดสูงสุด)
            try {
              const src = await tgDownloadPhoto(m.photo[m.photo.length - 1].file_id);
              if (m.caption && m.caption.trim()) {
                await handleText(m.caption, src);          // มีแคปชั่น → สร้างเลย
              } else {
                pendingSource = src;                        // ไม่มีแคปชั่น → รอข้อความ
                await send('📷 รับรูปต้นแบบแล้ว — พิมพ์ข้อความลูกโป่ง (ภาษาไทย) ส่งมาได้เลยค่ะ');
              }
            } catch (e) { await send('❌ ดาวน์โหลดรูปไม่สำเร็จ: ' + e.message.substring(0, 80)); }
          } else if (m && String(m.chat.id) === String(CHAT_ID) && m.text) {
            await handleText(m.text);
          } else if (u.callback_query && String(u.callback_query.message.chat.id) === String(CHAT_ID)) {
            await handleCallback(u.callback_query);
          }
        }
      }
    } catch (e) { console.error('poll error:', e.message); await new Promise(r => setTimeout(r, 3000)); }
    checkCron();
  }
}

// ── single instance lock (PID-liveness, shared lib/bot-lock) ──
require('../../lib/bot-lock').acquireBotLock(LOCK, 'anime bot');

poll();
