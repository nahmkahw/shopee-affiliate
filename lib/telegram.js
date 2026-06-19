'use strict';
/**
 * lib/telegram.js — Telegram Bot API client factory
 *
 * ใช้งาน:
 *   const { createTelegramClient, sleep } = require('./lib/telegram');
 *   const tg = createTelegramClient(BOT_TOKEN, CHAT_ID);
 *   await tg.sendMsg('สวัสดี');
 */

const https = require('https');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * สร้าง Telegram client ที่ผูกกับ token และ chatId ที่กำหนด
 * @returns {{ tgApi, sendMsg, editMsg, answerCb, initOffset, waitForCallback, waitForDecision }}
 */
function createTelegramClient(token, chatId) {
  let globalOffset = 0;

  function tgApi(method, params = {}) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(params);
      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${token}/${method}`,
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
    const params = { chat_id: chatId, text: text.substring(0, 4096), parse_mode: 'HTML' };
    if (keyboard) params.reply_markup = { inline_keyboard: keyboard };
    return tgApi('sendMessage', params);
  };

  const editMsg = (msgId, text, keyboard = null) => {
    const params = { chat_id: chatId, message_id: msgId, text: text.substring(0, 4096), parse_mode: 'HTML' };
    if (keyboard) params.reply_markup = { inline_keyboard: keyboard };
    return tgApi('editMessageText', params);
  };

  const answerCb = (cbId, text = 'OK') =>
    tgApi('answerCallbackQuery', { callback_query_id: cbId, text });

  async function initOffset() {
    const res = await tgApi('getUpdates', { limit: 1, offset: -1 });
    if (res.result?.length) globalOffset = res.result[0].update_id + 1;
  }

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

  async function waitForDecision(approveData, regenData, timeoutMs = 60 * 60 * 1000) {
    const { data, cbId } = await waitForCallback([approveData, regenData], timeoutMs);
    if (data === 'timeout') return { decision: 'timeout', cbId: null };
    return { decision: data === approveData ? 'approve' : 'regen', cbId };
  }

  return { tgApi, sendMsg, editMsg, answerCb, initOffset, waitForCallback, waitForDecision };
}

module.exports = { createTelegramClient, sleep };
