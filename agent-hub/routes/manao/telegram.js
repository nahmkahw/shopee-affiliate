'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const https  = require('https');

function tgRequest(token, method, body) {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) },
      rejectUnauthorized: false,
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error('TG parse error')); } });
    });
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Telegram timeout')); });
    req.on('error', reject);
    req.write(json);
    req.end();
  });
}

function tgEscape(t = '') {
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function sendPhotoToTelegram(token, chatId, imagePath, caption, keyboard) {
  return new Promise((resolve, reject) => {
    const boundary   = 'TGBound' + crypto.randomBytes(8).toString('hex');
    const imgBuffer  = fs.readFileSync(imagePath);
    const filename   = path.basename(imagePath);

    const addField = (name, value) =>
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);

    const parts = [
      addField('chat_id',    String(chatId)),
      addField('parse_mode', 'HTML'),
    ];
    if (caption)  parts.push(addField('caption', caption));
    if (keyboard) parts.push(addField('reply_markup', JSON.stringify(keyboard)));

    const photoHead = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`
    );
    const body = Buffer.concat([...parts, photoHead, imgBuffer, Buffer.from(`\r\n--${boundary}--\r\n`)]);

    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendPhoto`,
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
      rejectUnauthorized: false,
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error('TG photo parse: ' + buf.substring(0,100))); } });
    });
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Photo upload timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendTelegramApproval(AI_NEWS_DIR, slug, platform, readNewsEnv) {
  const env    = readNewsEnv();
  const token  = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('ไม่พบ TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID ใน .env');

  const dataPath = path.join(AI_NEWS_DIR, 'news', slug, 'data.json');
  const fbPath   = path.join(AI_NEWS_DIR, 'news', slug, 'content', 'facebook.md');
  const igPath   = path.join(AI_NEWS_DIR, 'news', slug, 'content', 'instagram.md');
  const imgPath  = path.join(AI_NEWS_DIR, 'news', slug, 'image.jpg');

  if (!fs.existsSync(dataPath)) throw new Error(`ไม่พบ news/${slug}/data.json`);

  const data       = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const includesIG = platform === 'ig' || platform === 'fb,ig';
  const includesFB = platform === 'fb' || platform === 'fb,ig';
  const hasImage   = fs.existsSync(imgPath);

  const shortId   = crypto.createHash('md5').update(slug).digest('hex').substring(0, 12);
  const queueFile = path.join(AI_NEWS_DIR, '_tg_queue.json');
  const queue     = (() => { try { return JSON.parse(fs.readFileSync(queueFile, 'utf8')); } catch { return {}; } })();
  queue[shortId]  = { slug, platform };
  fs.writeFileSync(queueFile, JSON.stringify(queue, null, 2), 'utf8');

  const title    = tgEscape(data.title || slug);
  const date     = (data.published_at || data.scraped_at || '').substring(0, 10);
  const pfLabels = { fb: '📘 Facebook', ig: '📸 Instagram', 'fb,ig': '📘 Facebook + 📸 Instagram' };
  const pfLabel  = pfLabels[platform] || platform;

  const keyboard = {
    inline_keyboard: [[
      { text: '✅ อนุมัติ & โพสต์', callback_data: `approve:${shortId}` },
      { text: '🔄 สร้างใหม่',       callback_data: `regen:${shortId}`   },
      { text: '❌ ยกเลิก',           callback_data: `cancel:${shortId}`  },
    ]],
  };

  if (hasImage) {
    const fbContent = fs.existsSync(fbPath) ? fs.readFileSync(fbPath, 'utf8') : '';
    const igContent = fs.existsSync(igPath) ? fs.readFileSync(igPath, 'utf8') : '';
    const captionLines = [
      `📰 <b>รอ Approve ก่อนโพสต์</b>`,
      `🗞 ${title}`,
      `📅 ${date} | 🎯 ${pfLabel}`,
      ``,
    ];
    if (includesFB && fbContent) {
      const fbPreview = tgEscape(fbContent.substring(0, 350)) + (fbContent.length > 350 ? '\n...' : '');
      captionLines.push(`📘 <b>Facebook:</b>`, fbPreview);
      if (includesIG) captionLines.push('');
    }
    if (includesIG && igContent) {
      const igPreview = tgEscape(igContent.substring(0, 300)) + (igContent.length > 300 ? '\n...' : '');
      captionLines.push(`📸 <b>Instagram:</b>`, igPreview);
    }
    const photoCaption = captionLines.join('\n').substring(0, 1024);
    const photoRes = await sendPhotoToTelegram(token, chatId, imgPath, photoCaption, keyboard);
    if (!photoRes.ok) throw new Error('Telegram sendPhoto: ' + JSON.stringify(photoRes).substring(0, 200));
  } else {
    const fbContent = fs.existsSync(fbPath) ? fs.readFileSync(fbPath, 'utf8') : '';
    const fbPreview = tgEscape(fbContent.substring(0, 700)) + (fbContent.length > 700 ? '\n...' : '');
    const lines = [
      `📰 <b>รอ Approve ก่อนโพสต์</b>`,
      `─────────────────────────`,
      `🗞 ${title}`,
      `📅 ${date}`,
      `🎯 โพสต์ไปที่: <b>${pfLabel}</b>`,
      `⚠️ <i>ไม่พบรูป Generate — โพสต์โดยไม่มีรูป</i>`,
    ];
    if (fbContent) lines.push('', `📝 <b>Facebook Content Preview:</b>`, fbPreview);
    lines.push(`─────────────────────────`, `กด ✅ เพื่อ Approve และโพสต์ทันที`);
    const res = await tgRequest(token, 'sendMessage', {
      chat_id: chatId, text: lines.join('\n'), parse_mode: 'HTML', reply_markup: keyboard,
    });
    if (!res.ok) throw new Error('Telegram API: ' + JSON.stringify(res).substring(0, 200));
  }

  data.status        = 'pending_approval';
  data.pending_since = new Date().toISOString();
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');

  return { shortId, platform, hasImage };
}

module.exports = { tgRequest, tgEscape, sendPhotoToTelegram, sendTelegramApproval };
