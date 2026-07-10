'use strict';
/**
 * health-check.js — ตรวจว่า agent-hub กลับมาให้บริการหลัง restart (สเต็ป 7)
 *
 * ยิง GET /healthz ที่ 127.0.0.1:3002 — auth.gate() ยกเว้น localhost อยู่แล้ว
 * นโยบาย (ตกลงไว้): ล้มเหลว → soft-retry restart 1 ครั้ง → ยังพัง = แจ้ง Discord
 *                   **ไม่แตะ git** (ไม่ auto-rollback — state ไฟล์สดเสี่ยงกว่า down ชั่วคราว)
 */

const DEFAULT_URL = process.env.HEALTH_URL || 'http://127.0.0.1:3002/healthz';

const sleepReal = ms => new Promise(r => setTimeout(r, ms));

/** ยิงครั้งเดียว → {ok, status?, body?, error?} */
async function probe({ url = DEFAULT_URL, timeoutMs = 5000, fetchFn = fetch } = {}) {
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
 * @returns {{healthy:boolean, attempts:number, last:object}}
 */
async function waitHealthy({
  url = DEFAULT_URL,
  attempts = 12,
  delayMs = 2500,
  timeoutMs = 5000,
  fetchFn = fetch,
  sleep = sleepReal,
  log = console.log,
} = {}) {
  let last = null;
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
