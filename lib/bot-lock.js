'use strict';
/**
 * bot-lock.js — single-instance lock ด้วย PID-liveness (ใช้ร่วมทุก Telegram bot)
 *
 * กัน 2 ปัญหาของ bot ที่ poll getUpdates:
 *   1. 409 Conflict — 2 process poll token เดียวกัน → ถ้า process เดิมยังรัน → ปฏิเสธตัวที่ 2
 *   2. lock ค้าง — process เดิมตายแต่ไฟล์ lock ยังอยู่ → เช็ค PID ตาย → ล้าง + ยึดใหม่
 *
 * ลบ lock อัตโนมัติตอน exit/SIGINT/SIGTERM
 */

const fs = require('fs');

/**
 * @param {string} lockPath  path ไฟล์ .lock
 * @param {string} [label]   ชื่อ bot สำหรับ log
 */
function acquireBotLock(lockPath, label = 'bot') {
  try {
    if (fs.existsSync(lockPath)) {
      const pid = parseInt(fs.readFileSync(lockPath, 'utf8'), 10);
      if (pid) {
        try {
          process.kill(pid, 0);                       // ไม่ส่ง signal — แค่เช็คว่า process ยังอยู่
          console.error(`❌ ${label} รันอยู่แล้ว (PID ${pid}) — ออก เพื่อกัน 409 Conflict`);
          process.exit(1);
        } catch {
          /* PID ตาย → lock ค้าง: ล้างแล้วยึดใหม่ */
        }
      }
    }
  } catch { /* อ่าน lock ไม่ได้ → ยึดใหม่ */ }

  fs.writeFileSync(lockPath, String(process.pid));
  const cleanup = () => { try { fs.unlinkSync(lockPath); } catch {} };
  process.on('exit', cleanup);
  process.on('SIGINT',  () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
  return lockPath;
}

module.exports = { acquireBotLock };
