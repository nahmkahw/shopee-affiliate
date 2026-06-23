'use strict';
/**
 * agents/manao/pipeline/lib/telegram.js
 *
 * Pipeline-local Telegram sender สำหรับ generate.js เท่านั้น
 * ต่างจาก lib/tg-approval.js ตรงที่:
 *  - export TG_ENABLED (generate.js ใช้ตัดสินใจ set status)
 *  - sendTelegramApproval() return bool (true = ส่งสำเร็จ)
 *  - ใช้ tg-queue local module (makeShortId + saveQueue)
 *  - preview ใช้ fbContent ไม่ใช่ master
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const { loadQueue, saveQueue, makeShortId } = require('./tg-queue');

const TG_TOKEN   = (process.env.MANAO_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').replace(/"/g, '').trim();
const TG_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').replace(/"/g, '').trim();
const TG_ENABLED = !!(TG_TOKEN && TG_CHAT_ID);

function tgRequest(method, body) {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TG_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) },
      rejectUnauthorized: false,
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error(buf)); } });
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Telegram timeout')); });
    req.on('error', reject);
    req.write(json);
    req.end();
  });
}

function escapeHtml(t = '') {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sendTelegramPhoto(chatId, imagePath, caption, keyboard) {
  return new Promise((resolve, reject) => {
    const imageData = fs.readFileSync(imagePath);
    const boundary  = `----TGBoundary${Date.now()}`;

    const fieldPart = (name, value) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}`;

    const preamble = [
      fieldPart('chat_id',      chatId),
      fieldPart('caption',      caption),
      fieldPart('parse_mode',   'HTML'),
      fieldPart('reply_markup', JSON.stringify(keyboard)),
    ].join('\r\n') + '\r\n';

    const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="image.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`;
    const epilogue   = `\r\n--${boundary}--\r\n`;

    const bodyBuf = Buffer.concat([
      Buffer.from(preamble,    'utf8'),
      Buffer.from(fileHeader,  'utf8'),
      imageData,
      Buffer.from(epilogue,    'utf8'),
    ]);

    const req = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${TG_TOKEN}/sendPhoto`,
      method:   'POST',
      headers: {
        'Content-Type':   `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuf.length,
      },
      rejectUnauthorized: false,
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error(buf)); } });
    });
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Telegram photo timeout')); });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

async function sendTelegramApproval(slug, data, fbContent, newsDir) {
  if (!TG_ENABLED) return false;
  const title   = escapeHtml(data.title || slug);
  const date    = (data.published_at || '').substring(0, 10);
  const preview = escapeHtml(fbContent.substring(0, 800)) + (fbContent.length > 800 ? '...' : '');

  const shortId = makeShortId(slug);
  const queue = loadQueue();
  queue[shortId] = { slug, platform: 'fb' };
  saveQueue(queue);

  const keyboard = {
    inline_keyboard: [[
      { text: '✅ อนุมัติ',   callback_data: `approve:${shortId}` },
      { text: '🔄 สร้างใหม่', callback_data: `regen:${shortId}`   },
    ]],
  };

  const msgLines = [
    `📰 <b>รอ Approve</b>`,
    `─────────────────────────`,
    `🗞 ${title}`,
    `📅 ${date}`,
    ``,
    `📱 <b>Facebook + Instagram:</b>`,
    preview,
    `─────────────────────────`,
  ].join('\n');

  const imagePath = path.join(newsDir, slug, 'image.jpg');
  if (fs.existsSync(imagePath)) {
    try {
      const res = await sendTelegramPhoto(TG_CHAT_ID, imagePath, msgLines, keyboard);
      if (res.ok) { console.log(`  📨 ส่ง Telegram ขอ approve (พร้อมรูป) แล้ว`); return true; }
      console.error(`  ⚠️  Telegram sendPhoto ไม่สำเร็จ:`, res.description, '— fallback ส่ง text');
    } catch (e) {
      console.error(`  ⚠️  Telegram sendPhoto error:`, e.message, '— fallback ส่ง text');
    }
  }

  try {
    const res = await tgRequest('sendMessage', { chat_id: TG_CHAT_ID, text: msgLines, parse_mode: 'HTML', reply_markup: keyboard });
    if (res.ok) { console.log(`  📨 ส่ง Telegram ขอ approve แล้ว`); return true; }
    console.error(`  ⚠️  Telegram ส่งไม่สำเร็จ:`, res.description);
    return false;
  } catch (e) {
    console.error(`  ⚠️  Telegram error:`, e.message);
    return false;
  }
}

module.exports = { TG_TOKEN, TG_CHAT_ID, TG_ENABLED, tgRequest, escapeHtml, sendTelegramPhoto, sendTelegramApproval };
