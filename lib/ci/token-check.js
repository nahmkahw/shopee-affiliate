'use strict';
/**
 * token-check.js — เตือน token หมดอายุล่วงหน้า (Phase 4)
 *
 * FB_ACCESS_TOKEN อายุ ~60 วัน หมดแล้วโพสต์เงียบ (pain point จริง). เช็คทุกวันผ่าน
 * Graph debug_token → เหลือ ≤ threshold วัน → สร้าง Calendar all-day event บนวันหมดอายุ
 * + เตือน Discord. idempotent: ไม่เตือนซ้ำ token+expiry เดิม (state file)
 *
 * FB token อ่านจาก <DEPLOY_PATH>/.env โดยตรง → ไม่ต้องเข้า GitHub Secrets (one-place invariant)
 */

const fs = require('fs');
const path = require('path');

const DAY_MS = 86400000;

/** parse ค่า key จากไฟล์ .env (ไม่ dogfood dotenv — อ่าน key เดียวพอ) */
function readEnvValue(envPath, key) {
  let text;
  try { text = fs.readFileSync(envPath, 'utf8'); } catch { return null; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && m[1] === key) return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

/** วันที่เหลือจนหมดอายุ (ปัดลง). expiresAtSec = unix วินาที; 0 = ไม่มีวันหมด (long-lived พิเศษ) */
function daysUntil(expiresAtSec, now = Date.now()) {
  if (!expiresAtSec) return Infinity;
  return Math.floor((expiresAtSec * 1000 - now) / DAY_MS);
}

/** query Graph debug_token — คืน { valid, expiresAt(sec), error? } */
async function inspectFbToken(token, { fetchFn = fetch } = {}) {
  if (!token) return { valid: false, error: 'ไม่มี token' };
  const url = `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(token)}`
    + `&access_token=${encodeURIComponent(token)}`;
  try {
    const res = await fetchFn(url);
    const json = await res.json();
    const d = json.data || {};
    if (d.is_valid === false || json.error) {
      return { valid: false, error: (json.error && json.error.message) || 'token ไม่ valid', expiresAt: d.expires_at || 0 };
    }
    return { valid: true, expiresAt: d.expires_at || 0 };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

/**
 * ตัดสินใจว่าต้องเตือนไหม (pure)
 * @returns {{alert:boolean, reason:string, daysLeft:number}}
 */
function decideAlert({ valid, expiresAt, error }, { thresholdDays = 7, now = Date.now() } = {}) {
  if (!valid) return { alert: true, reason: 'invalid', daysLeft: valid ? daysUntil(expiresAt, now) : -1, detail: error };
  const daysLeft = daysUntil(expiresAt, now);
  if (daysLeft === Infinity) return { alert: false, reason: 'never-expires', daysLeft };
  if (daysLeft <= thresholdDays) return { alert: true, reason: 'expiring', daysLeft };
  return { alert: false, reason: 'ok', daysLeft };
}

/** state กันเตือนซ้ำ: เตือนแล้วสำหรับ expiresAt นี้หรือยัง */
function loadState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}
/** เตือนไปแล้วสำหรับ token+expiry ชุดนี้ไหม (expiry เปลี่ยน = ต่ออายุแล้ว → เตือนใหม่ได้) */
function alreadyReminded(state, name, expiresAt) {
  return state[name] && state[name].remindedFor === expiresAt;
}

const expiryDateBKK = (expiresAtSec) =>
  new Date(expiresAtSec * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });

module.exports = {
  readEnvValue, daysUntil, inspectFbToken, decideAlert,
  loadState, saveState, alreadyReminded, expiryDateBKK,
};
