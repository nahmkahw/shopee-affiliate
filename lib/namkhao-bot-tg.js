'use strict';
/**
 * lib/namkhao-bot-tg.js — Telegram HTTP helpers สำหรับ namkhao bot
 */

const https = require('https');

function tgRequest(token, method, body) {
  return new Promise((resolve) => {
    const json = JSON.stringify(body);
    const req  = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${token}/${method}`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) },
      rejectUnauthorized: false,
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve({}); } });
    });
    req.setTimeout(30000, () => { req.destroy(); resolve({}); });
    req.on('error', () => resolve({}));
    req.write(json);
    req.end();
  });
}

function sendMsg(token, chatId, text) {
  return tgRequest(token, 'sendMessage', {
    chat_id:    chatId,
    text:       text.substring(0, 4096),
    parse_mode: 'HTML',
  });
}

function sendMenu(token, chatId) {
  return tgRequest(token, 'sendMessage', {
    chat_id:      chatId,
    text:         '🤖 <b>เลือกคำสั่ง:</b>',
    parse_mode:   'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🌸 ดึงสินค้า',   callback_data: 'run:mali:scrape'         },
          { text: '🌸 โพสต์วันนี้', callback_data: 'run:mali:approve-today'  },
        ],
        [
          { text: '🍋 รันทั้งหมด',  callback_data: 'run:manao:full'          },
          { text: '🍋 ดูสถานะ',     callback_data: 'run:manao:status'        },
        ],
        [
          { text: '🔍 ตรวจสุขภาพ', callback_data: 'run:checkagent'          },
        ],
      ],
    },
  });
}

module.exports = { tgRequest, sendMsg, sendMenu };
