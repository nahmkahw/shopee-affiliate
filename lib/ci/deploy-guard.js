'use strict';
/**
 * deploy-guard.js — รอให้ GPU ว่างก่อน restart (สเต็ป 2 ของ deploy)
 *
 * ทำไม: restart ทับงาน ComfyUI ที่กำลัง gen (คลิป/คอมมิค) = เสียของกลางคัน
 * นโยบาย (ตกลงไว้): **รอจนว่าง** + timeout 15 นาที → เกินแล้ว abort ให้ไปกดใหม่ทีหลัง
 *
 * อ่านคิวจาก lib/gpu-lock.js readQueueStatus() → { holder, waiters[] }
 * dependency ฉีดผ่าน params (testable, ตาม Gate 2)
 */

const DEFAULT_TIMEOUT_MS = parseInt(process.env.DEPLOY_GPU_TIMEOUT_MS || '900000', 10); // 15 นาที
const DEFAULT_POLL_MS = parseInt(process.env.DEPLOY_GPU_POLL_MS || '5000', 10);

const sleepReal = ms => new Promise(r => setTimeout(r, ms));

/**
 * รอจน GPU ว่าง (ไม่มี holder และไม่มี waiter)
 * @returns {{idle:boolean, timedOut?:boolean, waitedMs:number, holder?:object}}
 */
async function waitForGpuIdle({
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
  readStatus,
  sleep = sleepReal,
  now = () => Date.now(),
  log = console.log,
} = {}) {
  const status = readStatus || require('../gpu-lock').readQueueStatus;
  const started = now();

  for (;;) {
    const { holder, waiters } = status();
    const busy = Boolean(holder) || (waiters && waiters.length > 0);
    if (!busy) {
      return { idle: true, waitedMs: now() - started };
    }

    const waited = now() - started;
    if (waited >= timeoutMs) {
      return { idle: false, timedOut: true, waitedMs: waited, holder: holder || null };
    }

    const who = holder ? `${holder.agent}(pid ${holder.pid})` : 'ไม่มี holder';
    log(`[deploy-guard] GPU ไม่ว่าง — ถือโดย ${who}, คิวรอ ${waiters.length} — รอ… (${Math.round(waited / 1000)}s)`);
    await sleep(pollMs);
  }
}

module.exports = { waitForGpuIdle, DEFAULT_TIMEOUT_MS, DEFAULT_POLL_MS };
