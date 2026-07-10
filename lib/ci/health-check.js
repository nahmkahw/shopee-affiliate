'use strict';
/**
 * health-check.js — ตรวจว่า agent-hub กลับมาให้บริการหลัง restart (สเต็ป 7)
 *
 * ยิง GET /healthz ที่ 127.0.0.1:3002 — auth.gate() ยกเว้น localhost อยู่แล้ว
 * นโยบาย (ตกลงไว้): ล้มเหลว → soft-retry restart 1 ครั้ง → ยังพัง = แจ้ง Discord
 *                   **ไม่แตะ git** (ไม่ auto-rollback — state ไฟล์สดเสี่ยงกว่า down ชั่วคราว)
 */

const http = require('node:http');

const DEFAULT_URL = process.env.HEALTH_URL || 'http://127.0.0.1:3002/healthz';

const sleepReal = ms => new Promise(r => setTimeout(r, ms));

/**
 * probe ด้วย node:http + keepAlive:false — ตั้งใจไม่ใช้ global fetch เพราะ:
 *  1. undici คง socket ไว้ใน pool (keep-alive) → แถว ESTABLISHED ค้าง ทำให้
 *     start-all-agents.bat เผลอ taskkill ตัว deploy-runner เอง
 *  2. socket ค้าง = libuv handle ยังเปิดตอน process ปิด → assertion crash (async.c:94)
 */
function httpGetJson(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, { agent: new http.Agent({ keepAlive: false }) }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return resolve({ ok: false, status: res.statusCode });
        }
        let body = {};
        try { body = JSON.parse(raw); } catch { /* ไม่ใช่ JSON — ไม่เป็นไร */ }
        resolve({ ok: true, status: res.statusCode, body });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout ${timeoutMs}ms`)));
    req.on('error', e => resolve({ ok: false, error: e.message }));
  });
}

/** ยิงครั้งเดียว → {ok, status?, body?, error?} — inject fetchFn ได้ใน test */
async function probe({ url = DEFAULT_URL, timeoutMs = 5000, fetchFn } = {}) {
  if (!fetchFn) return httpGetJson(url, timeoutMs);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, status: res.status };
    const body = await res.json().catch(() => ({}));
    return { ok: true, status: res.status, body };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

/**
 * รอจน healthy (agent-hub ใช้เวลา boot สักครู่)
 *
 * initialDelayMs: หน่วงก่อน probe แรก — start-all-agents.bat ต้องมีเวลา kill ตัวเก่า
 *   + boot ตัวใหม่. ถ้า probe เร็วเกินจะไปโดน hub **ตัวเก่า** (ตอบ 404 เพราะไม่มี /healthz)
 *   และเปิด socket ค้างไว้ให้ bat เผลอ taskkill (ดู start-all-agents.bat)
 *
 * @returns {{healthy:boolean, attempts:number, last:object}}
 */
async function waitHealthy({
  url = DEFAULT_URL,
  attempts = 12,
  delayMs = 2500,
  initialDelayMs = 0,
  timeoutMs = 5000,
  fetchFn,            // undefined = ใช้ node:http (keepAlive:false) — อย่า default เป็น fetch
  sleep = sleepReal,
  log = console.log,
} = {}) {
  let last = null;
  if (initialDelayMs > 0) {
    log(`[health] รอ ${Math.round(initialDelayMs / 1000)}s ให้ agent-hub boot ก่อน probe`);
    await sleep(initialDelayMs);
  }
  for (let i = 1; i <= attempts; i++) {
    last = await probe({ url, timeoutMs, fetchFn });
    if (last.ok) {
      log(`[health] ✓ healthy (ลองครั้งที่ ${i}) uptime=${last.body?.uptime ?? '?'}s`);
      return { healthy: true, attempts: i, last };
    }
    log(`[health] ยังไม่ขึ้น (${i}/${attempts}) — ${last.error || 'HTTP ' + last.status}`);
    if (i < attempts) await sleep(delayMs);
  }
  return { healthy: false, attempts, last };
}

module.exports = { probe, waitHealthy, DEFAULT_URL };
