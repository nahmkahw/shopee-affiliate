'use strict';
/**
 * gpu-lock.js — cross-process mutex สำหรับ ComfyUI (กัน client timeout ตอนรอคิว)
 *
 * ปัญหา: ComfyUI serialize งาน GPU ฝั่ง server อยู่แล้ว แต่ถ้า agent หลายตัว submit พร้อมกัน
 *        งานที่มาทีหลังต้องรอใน ComfyUI queue → client timeout ฝั่ง agent fire ก่อนงานได้รัน
 * วิธีแก้: ทุก ComfyUI submit ต้อง acquire lock ก่อน → submit+poll → release
 *        ตัวที่รอ block จนคิวว่าง (timeout ของ ComfyUI ยังไม่เริ่มนับขณะรอ)
 *
 * lock = ไฟล์ {pid, agent, since}. ยึดได้ถ้า: ไม่มีไฟล์ / holder ตาย (PID) / ถืออายุเกิน MAX_HOLD
 * ดู docs/ADR-comfyui-gpu-queue.md
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const LOCK_FILE   = process.env.GPU_LOCK_FILE     || path.join(os.tmpdir(), 'comfyui-gpu.lock');
const MAX_HOLD_MS = parseInt(process.env.GPU_LOCK_MAX_HOLD_MS || '900000', 10); // 15 นาที (> งานยาวสุด ~8 นาที)
const POLL_MS     = parseInt(process.env.GPU_LOCK_POLL_MS     || '3000', 10);

function readLock() {
  try { return JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); } catch { return null; }
}
function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
// lock ปลดได้ไหม: ตาย หรือ ถือนานเกิน MAX_HOLD (กัน holder ค้างแต่ยังไม่ตาย)
function isStale(lock) {
  if (!lock || !lock.pid) return true;
  if (!isAlive(lock.pid)) return true;
  if (Date.now() - (lock.since || 0) > MAX_HOLD_MS) return true;
  return false;
}

// พยายามยึด 1 ครั้ง (atomic ด้วย flag 'wx' — fail ถ้าไฟล์มีอยู่)
function tryAcquireOnce(label) {
  try {
    const fd = fs.openSync(LOCK_FILE, 'wx');
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, agent: label, since: Date.now() }));
    fs.closeSync(fd);
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    if (isStale(readLock())) {                  // lock ค้าง/holder ตาย → ล้างแล้วลองใหม่
      try { fs.unlinkSync(LOCK_FILE); } catch {}
      return tryAcquireOnce(label);
    }
    return false;                               // holder ยังทำงาน → รอ
  }
}

async function acquire(label) {
  while (!tryAcquireOnce(label)) {
    await new Promise(r => setTimeout(r, POLL_MS));   // รอจนคิวว่าง — ไม่มี hard cap (เจตนา)
  }
}

function release() {
  const cur = readLock();
  if (cur && cur.pid === process.pid) { try { fs.unlinkSync(LOCK_FILE); } catch {} }
}

/**
 * acquire → รัน fn (ComfyUI submit+poll) → release (กัน leak แม้ fn throw / process exit)
 * @param {string} label  ชื่อ agent (สำหรับ debug ว่าใครถือ GPU)
 * @param {Function} fn    async function ที่ submit + poll ComfyUI
 */
async function withGpuLock(label, fn) {
  await acquire(label);
  const onExit = () => release();
  process.on('exit', onExit);
  try { return await fn(); }
  finally { release(); process.removeListener('exit', onExit); }
}

module.exports = { withGpuLock, acquire, release, readLock };
