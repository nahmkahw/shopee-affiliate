'use strict';
/**
 * lib/namkhao-bot-scheduler.js — Daily scheduler สำหรับ namkhao bot
 * รัน มะนาว pipeline อัตโนมัติทุก 07:00 + 13:00 BKK
 */

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SCHEDULE_HOURS = [7, 13]; // BKK time (UTC+7)

function isPipelineLocked(lockFile) {
  if (!fs.existsSync(lockFile)) return false;
  try {
    const pid = parseInt(fs.readFileSync(lockFile, 'utf8').trim(), 10);
    process.kill(pid, 0);
    return true;
  } catch {
    try { fs.unlinkSync(lockFile); } catch {}
    return false;
  }
}

function runManaoPipeline({ root, lockFile, manaoRun, sendMsg, chatId, log }) {
  if (isPipelineLocked(lockFile)) {
    if (log) log('⚠️ [Scheduler] pipeline กำลังรันอยู่แล้ว — ข้าม');
    if (chatId && sendMsg) sendMsg(chatId, '⚠️ <b>Scheduler</b>: มะนาว pipeline ยังรันค้างอยู่ — ข้ามรอบนี้');
    return;
  }

  const child = spawn(process.execPath, [manaoRun], {
    cwd:   path.dirname(manaoRun),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  fs.writeFileSync(lockFile, String(child.pid), 'utf8');
  if (log) log(`🔒 [Scheduler] lock PID=${child.pid}`);

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', d => d.split('\n').filter(l => l.trim()).forEach(l => log && log('[มะนาว] ' + l)));
  child.stderr.on('data', d => d.split('\n').filter(l => l.trim()).forEach(l => log && log('[มะนาว ⚠️] ' + l)));
  child.on('close', code => {
    try { fs.unlinkSync(lockFile); } catch {}
    if (code === 0) {
      if (log) log('✅ [Scheduler] มะนาว pipeline เสร็จสิ้น');
    } else {
      if (log) log(`❌ [Scheduler] มะนาว pipeline exit ${code}`);
      if (chatId && sendMsg) sendMsg(chatId, `❌ <b>Scheduler</b>: มะนาว pipeline ล้มเหลว (exit ${code})`);
    }
  });
  child.on('error', e => {
    try { fs.unlinkSync(lockFile); } catch {}
    if (log) log(`❌ [Scheduler] spawn error: ${e.message}`);
  });
}

async function schedulerLoop({ root, lockFile, manaoRun, sendMsg, chatId, log }) {
  let lastScheduledDate = '';
  while (true) {
    const now     = new Date(Date.now() + 7 * 3600 * 1000); // UTC → BKK
    const hhmm    = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
    const dateKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')} ${now.getUTCHours()}`;

    if (SCHEDULE_HOURS.includes(now.getUTCHours()) && now.getUTCMinutes() === 0 && lastScheduledDate !== dateKey) {
      lastScheduledDate = dateKey;
      if (log) log(`⏰ [Scheduler] ${hhmm} BKK — เริ่ม มะนาว full pipeline`);
      if (chatId && sendMsg) await sendMsg(chatId, `⏰ <b>Scheduler</b> ${hhmm} น.\nกำลังสั่ง 🍋 มะนาว ดึงข่าว + สร้าง content...`);
      runManaoPipeline({ root, lockFile, manaoRun, sendMsg, chatId, log });
    }

    await new Promise(r => setTimeout(r, 30000));
  }
}

module.exports = { isPipelineLocked, runManaoPipeline, schedulerLoop };
