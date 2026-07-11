'use strict';
/**
 * token-check-runner.js — orchestrator ที่ token-check.yml เรียก (thin)
 *
 * อ่าน FB token จาก <DEPLOY_PATH>/.env → inspect → ถ้าใกล้หมด/หมด →
 * Calendar all-day event บนวันหมดอายุ + Discord alert (idempotent ผ่าน state file)
 *
 * env: DEPLOY_PATH (บังคับ), TOKEN_ALERT_DAYS (default 7),
 *      GCP_SA_KEY + GOOGLE_CALENDAR_ID + DISCORD_WEBHOOK_URL (จาก GitHub Secrets)
 */

const path = require('path');
const {
  readEnvValue, inspectFbToken, decideAlert,
  loadState, saveState, alreadyReminded, expiryDateBKK,
} = require('./token-check');
const { createAllDayEvent } = require('./gcal-log');
const { postDiscord } = require('./discord-notify');

const ROOT = process.env.DEPLOY_PATH || process.cwd();
const THRESHOLD = parseInt(process.env.TOKEN_ALERT_DAYS || '7', 10);
const STATE_FILE = path.join(ROOT, '.token-check-state.json');

async function main() {
  const envPath = path.join(ROOT, '.env');
  const token = readEnvValue(envPath, 'FB_ACCESS_TOKEN');
  if (!token) {
    console.log(`[token-check] ไม่พบ FB_ACCESS_TOKEN ใน ${envPath} — ข้าม`);
    return;
  }

  const info = await inspectFbToken(token);
  const verdict = decideAlert(info, { thresholdDays: THRESHOLD });
  console.log(`[token-check] FB token: valid=${info.valid} daysLeft=${verdict.daysLeft} reason=${verdict.reason}`);

  if (!verdict.alert) return;

  const state = loadState(STATE_FILE);
  if (info.valid && alreadyReminded(state, 'FB_ACCESS_TOKEN', info.expiresAt)) {
    console.log('[token-check] เตือน expiry นี้ไปแล้ว — ข้าม (idempotent)');
    return;
  }

  const expDate = info.valid && info.expiresAt ? expiryDateBKK(info.expiresAt) : null;
  const title = info.valid
    ? `⚠️ FB_ACCESS_TOKEN หมดอายุใน ${verdict.daysLeft} วัน`
    : `❌ FB_ACCESS_TOKEN ใช้ไม่ได้แล้ว`;
  const body = 'ต่ออายุ: Graph API Explorer → long-lived token → อัปเดต root .env (ดู CLAUDE.md)';

  // Calendar all-day event บนวันหมดอายุ (ถ้ารู้วัน) — เตือนล่วงหน้า
  if (expDate) {
    await createAllDayEvent({ summary: title, description: body, date: expDate })
      .then(r => !r.skipped && console.log('[token-check] Calendar event:', r.htmlLink))
      .catch(e => console.error('[gcal]', e.message));
  }
  await postDiscord(`${title}\n${verdict.detail ? verdict.detail + '\n' : ''}${body}`)
    .catch(e => console.error('[discord]', e.message));

  // จำว่าเตือนแล้วสำหรับ expiry ชุดนี้ (ต่ออายุ → expiresAt เปลี่ยน → เตือนใหม่ได้)
  state.FB_ACCESS_TOKEN = { remindedFor: info.expiresAt, at: new Date().toISOString(), daysLeft: verdict.daysLeft };
  saveState(STATE_FILE, state);
}

if (require.main === module) {
  main().catch(async (e) => {
    console.error('[token-check] error:', e.message);
    await postDiscord(`❌ token-check error: ${e.message}`).catch(() => {});
    process.exitCode = 1;
  });
}

module.exports = { main };
