'use strict';
/**
 * lib/line-client.js — LINE Messaging API client (Gate 2 shared)
 * ใช้โดย Agent มะยม (webhook slip logger); ออกแบบให้ agent อื่นเรียกซ้ำได้
 *
 * ทุกฟังก์ชันรับ token/secret ผ่าน params (dependency injection) — ไม่อ่าน env เอง
 * ยกเว้น default ที่ดึงจาก MAYOM_* เพื่อความสะดวก
 */

const https  = require('https');
const crypto = require('crypto');

const API_HOST = 'api.line.me';

/**
 * verifySignature — ตรวจ X-Line-Signature (HMAC-SHA256 ของ raw body ด้วย channel secret)
 * @param {Buffer|string} rawBody  body ดิบ (ต้องเป็น bytes ตรงตามที่ LINE ส่ง)
 * @param {string} signature       header 'x-line-signature'
 * @param {string} channelSecret
 * @returns {boolean}
 */
function verifySignature(rawBody, signature, channelSecret) {
  if (!signature || !channelSecret) return false;
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const expected = crypto.createHmac('sha256', channelSecret).update(buf).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function _request({ method, path, token, jsonBody, host = API_HOST }) {
  return new Promise((resolve, reject) => {
    const payload = jsonBody ? JSON.stringify(jsonBody) : null;
    const headers = { Authorization: `Bearer ${token}` };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = https.request({ hostname: host, path, method, headers }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ status: res.statusCode, body });
        else reject(new Error(`LINE ${method} ${path} → ${res.statusCode}: ${body.toString().slice(0, 300)}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error(`LINE ${path} timeout`)); });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * getMessageContent — ดึง bytes รูป/ไฟล์จาก message id (content endpoint คนละ host)
 * @returns {Promise<Buffer>}
 */
async function getMessageContent(messageId, token) {
  const { body } = await _request({
    method: 'GET', host: 'api-data.line.me',
    path: `/v2/bot/message/${messageId}/content`, token,
  });
  return body;
}

/**
 * pushMessage — ส่งข้อความไปยัง group/user (กินโควตา push)
 * @param {string} to     groupId หรือ userId
 * @param {string} text
 */
function pushMessage(to, text, token) {
  return _request({
    method: 'POST', path: '/v2/bot/message/push', token,
    jsonBody: { to, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] },
  });
}

/**
 * replyMessage — ตอบด้วย reply token (ฟรี ไม่กินโควตา แต่ token หมดอายุเร็ว)
 */
function replyMessage(replyToken, text, token) {
  return _request({
    method: 'POST', path: '/v2/bot/message/reply', token,
    jsonBody: { replyToken, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] },
  });
}

/**
 * getGroupMemberProfile — ดึง displayName ของ user ในกลุ่ม
 * @returns {Promise<{userId,displayName,pictureUrl}>}
 */
async function getGroupMemberProfile(groupId, userId, token) {
  const { body } = await _request({
    method: 'GET', path: `/v2/bot/group/${groupId}/member/${userId}`, token,
  });
  try { return JSON.parse(body.toString()); } catch { return { userId, displayName: '' }; }
}

module.exports = {
  verifySignature, getMessageContent, pushMessage, replyMessage, getGroupMemberProfile,
};
