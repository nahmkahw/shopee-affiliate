'use strict';
/**
 * tg-notify.js — One-shot Telegram progress notification (no buttons, silent fail)
 * ส่งสถานะ pipeline progress ผ่าน namkhao bot — ไม่ใช่ approval flow (ไม่มีปุ่ม inline keyboard)
 * ใช้ร่วมกัน: maprao comic, comic-video — ขยายได้ทุก agent ที่ต้องการ progress updates
 */

const { createTelegramClient } = require('./telegram');

/**
 * ส่ง progress notification ไปยัง Telegram chat
 * @param {string} text  HTML-formatted text (รองรับ <b>, <i>, <code>)
 * Silent fail — ไม่ throw ถ้า Telegram ล้มเหลวหรือไม่มี token/chatId
 */
async function sendNotification(text) {
  const token  = process.env.NAMKHAO_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const tg = createTelegramClient(token, chatId);
    await tg.sendMsg(text);
  } catch {}
}

module.exports = { sendNotification };
