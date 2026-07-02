'use strict';

/**
 * Telegram approval notification sender for news pipelines.
 * Sends preview + inline keyboard to Telegram for human approval before posting.
 */

const fs     = require('fs');
const path   = require('path');
const https  = require('https');
const crypto = require('crypto');

function _sendTextMessage(token, chatId, text, replyMarkup) {
  const body = JSON.stringify({
    chat_id:      chatId,
    text:         text.substring(0, 4096),
    parse_mode:   'HTML',
    reply_markup: replyMarkup,
  });
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${token}/sendMessage`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => { let _b = ''; res.on('data', d => _b += d); res.on('end', () => { try { resolve(JSON.parse(_b)); } catch { resolve(); } }); });
    req.setTimeout(15000, () => { req.destroy(); resolve(); });
    req.on('error', resolve);
    req.write(body); req.end();
  });
}

function _sendPhotoUrl(token, chatId, photoUrl, caption, replyMarkup) {
  const body = JSON.stringify({
    chat_id:      chatId,
    photo:        photoUrl,
    caption:      caption.substring(0, 1024),
    parse_mode:   'HTML',
    reply_markup: replyMarkup,
  });
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${token}/sendPhoto`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => { let _b = ''; res.on('data', d => _b += d); res.on('end', () => { try { resolve(JSON.parse(_b)); } catch { resolve(); } }); });
    req.setTimeout(15000, () => { req.destroy(); resolve(); });
    req.on('error', resolve);
    req.write(body); req.end();
  });
}

function _sendPhotoMultipart(token, chatId, imagePath, caption, replyMarkup) {
  const boundary = '----TGBoundary' + Math.random().toString(36).substring(2);
  const imgBuf   = fs.readFileSync(imagePath);
  const fileName = path.basename(imagePath);
  const fields   = [
    ['chat_id',      chatId],
    ['caption',      caption.substring(0, 1024)],
    ['parse_mode',   'HTML'],
    ['reply_markup', JSON.stringify(replyMarkup)],
  ];
  let fieldStr = '';
  for (const [name, value] of fields) {
    fieldStr += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }
  const photoHeader = `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${fileName}"\r\nContent-Type: image/jpeg\r\n\r\n`;
  const photoFooter = `\r\n--${boundary}--\r\n`;
  const headerBuf   = Buffer.from(fieldStr + photoHeader, 'utf8');
  const footerBuf   = Buffer.from(photoFooter, 'utf8');
  const totalLen    = headerBuf.length + imgBuf.length + footerBuf.length;

  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${token}/sendPhoto`,
      method:   'POST',
      headers:  { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': totalLen },
    }, res => { let _b = ''; res.on('data', d => _b += d); res.on('end', () => { try { resolve(JSON.parse(_b)); } catch { resolve(); } }); });
    req.setTimeout(30000, () => { req.destroy(); resolve(); });
    req.on('error', resolve);
    req.write(headerBuf); req.write(imgBuf); req.write(footerBuf); req.end();
  });
}

/**
 * ส่ง Telegram preview + inline keyboard รอ approve
 * @param {string} slug
 * @param {object} data  — data.json ของข่าว/งาน
 * @param {string} master — เนื้อหากลาง (ใช้เป็น preview)
 * @param {{ pipelineRoot: string, newsDir: string, mode?: string, emoji?: string, kind?: string }} opts
 *   mode: 'schedule' (default) | 'immediate' — ส่งต่อให้ handleNewsCallback เลือกวิธี post
 *   emoji/kind: ปรับข้อความหัวข้อ (default '📰' / 'ข่าวใหม่') สำหรับ pipeline อื่นที่ไม่ใช่ข่าว (เช่น การ์ตูน)
 */
async function sendApprovalNotification(slug, data, master, { pipelineRoot, newsDir, mode, emoji, kind }) {
  // ส่งด้วย namkhao bot token (ตัวที่ poll callback) — ปุ่ม inline callback ไปหา bot เจ้าของข้อความ
  // ถ้าใช้ MANAO/MAKRUT token (คนละ bot) → namkhao ไม่ poll → กด Approve แล้วเงียบ ไม่โพสต์
  const token  = process.env.NAMKHAO_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const shortId   = crypto.createHash('md5').update(slug).digest('hex').substring(0, 12);
  const queueFile = path.join(pipelineRoot, '_tg_queue.json');
  const queue     = (() => { try { return JSON.parse(fs.readFileSync(queueFile, 'utf8')); } catch { return {}; } })();
  queue[shortId]  = { slug, platform: 'fb', pipelineRoot, mode: mode || 'schedule' };
  try { fs.writeFileSync(queueFile, JSON.stringify(queue, null, 2), 'utf8'); } catch {}

  const title   = (data.title || slug).replace(/[<>&"]/g, '');
  const date    = (data.published_at || '').substring(0, 10);
  const preview = master.substring(0, 280).replace(/[<>&"]/g, '');
  const dots    = master.length > 280 ? '…' : '';
  const text    = `${emoji || '📰'} <b>${kind || 'ข่าวใหม่'}รอ Approve</b>\n\n<b>${title}</b>\n📅 ${date}\n\n<i>${preview}${dots}</i>`;

  const replyMarkup = {
    inline_keyboard: [[
      { text: '✅ อนุมัติ & โพสต์', callback_data: `approve:${shortId}` },
      { text: '🔄 สร้างใหม่',       callback_data: `regen:${shortId}`   },
      { text: '❌ ยกเลิก',           callback_data: `cancel:${shortId}`  },
    ]]
  };

  const imagePath   = path.join(newsDir, slug, 'image.jpg');
  const hasLocalImg = fs.existsSync(imagePath);
  const ogImageUrl  = (data.og_image || '').trim();

  let res;
  if (hasLocalImg)      res = await _sendPhotoMultipart(token, chatId, imagePath, text, replyMarkup);
  else if (ogImageUrl)  res = await _sendPhotoUrl(token, chatId, ogImageUrl, text, replyMarkup);
  else                  res = await _sendTextMessage(token, chatId, text, replyMarkup);

  // fallback: ส่งรูปไม่ผ่าน (og_image เสีย/รูปใหญ่ → Telegram ปฏิเสธ) → ส่ง text-only กันข่าวหายเงียบ
  if ((hasLocalImg || ogImageUrl) && !(res && res.ok)) {
    console.warn(`  ⚠️ ส่งรูปไม่ผ่าน (${res?.description || 'no response'}) — fallback text-only`);
    res = await _sendTextMessage(token, chatId, text, replyMarkup);
  }
  return res;
}

module.exports = { sendApprovalNotification };
