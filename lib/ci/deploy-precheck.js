'use strict';
/**
 * deploy-precheck.js — ตรรกะตรวจก่อน deploy (pure, ไม่มี I/O → เทสต์ได้)
 *
 * ทำไมไม่ใช้ "dirty tree → abort" ตรงๆ:
 *   repo จริงบนเครื่อง prod **ไม่มีวันสะอาด** — agent เขียนทับไฟล์ tracked ตอน runtime
 *   (agents/manao/pipeline/_tg_queue.json, input.txt, agents/namkhao/telegram-bot.pid)
 *   ถ้า abort เพราะ dirty จะ abort ทุกครั้ง
 *
 * ที่ต้องกันจริงคือ: ไฟล์ที่แก้ค้างในเครื่อง **ชนกับ** ไฟล์ที่ upstream เปลี่ยน
 *   → git pull --ff-only จะพัง (หรือทับงานที่ยังไม่ commit)
 */

/** ไฟล์ที่แก้ค้างและ upstream ก็แก้ด้วย → pull ไม่ได้ ต้องหยุด */
function conflictingPaths(localModified = [], upstreamChanged = []) {
  const up = new Set(upstreamChanged.filter(Boolean));
  return localModified.filter(p => p && up.has(p));
}

/** ต้อง npm ci ไหม — เฉพาะเมื่อ dependency lock เปลี่ยน */
function needsNpmCi(upstreamChanged = []) {
  return upstreamChanged.some(p => p === 'package-lock.json' || p === 'package.json');
}

/**
 * ตัดสินใจว่า deploy ต่อได้ไหม
 * @returns {{proceed:boolean, reason?:string, conflicts?:string[], npmCi:boolean, behind:number}}
 */
function evaluate({ localModified = [], upstreamChanged = [], behind = 0 } = {}) {
  if (behind === 0) {
    return { proceed: false, reason: 'up-to-date', npmCi: false, behind: 0 };
  }
  const conflicts = conflictingPaths(localModified, upstreamChanged);
  if (conflicts.length > 0) {
    return { proceed: false, reason: 'conflict', conflicts, npmCi: false, behind };
  }
  return { proceed: true, npmCi: needsNpmCi(upstreamChanged), behind };
}

module.exports = { conflictingPaths, needsNpmCi, evaluate };
