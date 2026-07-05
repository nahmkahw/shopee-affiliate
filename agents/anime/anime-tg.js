'use strict';
/**
 * anime-tg.js — ส่งรูป anime พร้อมปุ่ม Approve/Reject ไปยัง Telegram (ใช้จาก route resend)
 * callback `ok__${id}` / `no__${id}` รับที่ anime-bot.js handleCallback()
 */

const https = require('https');
const fs    = require('fs');

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

function sendAnimeApproval(id, meta, finalPath) {
  const TOKEN   = process.env.ANIME_TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.ANIME_TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT_ID) throw new Error('ขาด ANIME_TELEGRAM_BOT_TOKEN/ANIME_TELEGRAM_CHAT_ID ใน .env');

  const bubbleText = meta.bubbleText || meta.text || '';
  const caption = bubbleText
    ? `💬 "${bubbleText.substring(0, 100)}"\n\nอนุมัติเพื่อโพสต์ Facebook?`
    : '📷 อนุมัติเพื่อโพสต์ Facebook?';

  return new Promise((resolve, reject) => {
    const boundary = '----AnimeResend' + Date.now();
    const parts = [];
    const field = (n, v) => parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`
    ));
    field('chat_id', CHAT_ID);
    field('caption', caption.substring(0, 1024));
    field('reply_markup', JSON.stringify({ inline_keyboard: [[
      { text: '✅ อนุมัติ → โพสต์ FB', callback_data: `ok__${id}` },
      { text: '❌ ยกเลิก',              callback_data: `no__${id}` },
    ]]}));
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="anime.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
    ));
    parts.push(fs.readFileSync(finalPath));
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const payload = Buffer.concat(parts);

    const req = https.request({
      hostname: 'api.telegram.org', path: `/bot${TOKEN}/sendDocument`, method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': payload.length },
    }, r => {
      let b = ''; r.on('data', d => b += d);
      r.on('end', () => {
        try {
          const j = JSON.parse(b);
          j.ok ? resolve(j) : reject(new Error(j.description || 'Telegram ตอบกลับ error'));
        } catch { reject(new Error('Telegram: parse response ไม่ได้')); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = { sendAnimeApproval };
