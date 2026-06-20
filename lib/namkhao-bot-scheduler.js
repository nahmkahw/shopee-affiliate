'use strict';
/**
 * lib/namkhao-bot-scheduler.js — Daily scheduler สำหรับ namkhao bot
 * มะนาว: 07:00 + 13:00 BKK
 * มะกรูด: 06:00 + 18:00 BKK
 */

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MANAO_HOURS  = [7, 13];  // BKK (UTC+7)
const MAKRUT_HOURS = [6, 18];  // BKK (UTC+7)

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

function runPipeline({ label, lockFile, scriptPath, sendMsg, chatId, log }) {
  if (isPipelineLocked(lockFile)) {
    if (log) log(`⚠️ [Scheduler] ${label} pipeline กำลังรันอยู่แล้ว — ข้าม`);
    if (chatId && sendMsg) sendMsg(chatId, `⚠️ <b>Scheduler</b>: ${label} pipeline ยังรันค้างอยู่ — ข้ามรอบนี้`);
    return;
  }

  const child = spawn(process.execPath, [scriptPath], {
    cwd:   path.dirname(scriptPath),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  fs.writeFileSync(lockFile, String(child.pid), 'utf8');
  if (log) log(`🔒 [Scheduler] ${label} lock PID=${child.pid}`);

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', d => d.split('\n').filter(l => l.trim()).forEach(l => log && log(`[${label}] ` + l)));
  child.stderr.on('data', d => d.split('\n').filter(l => l.trim()).forEach(l => log && log(`[${label} ⚠️] ` + l)));
  child.on('close', code => {
    try { fs.unlinkSync(lockFile); } catch {}
    if (code === 0) {
      if (log) log(`✅ [Scheduler] ${label} pipeline เสร็จสิ้น`);
    } else {
      if (log) log(`❌ [Scheduler] ${label} pipeline exit ${code}`);
      if (chatId && sendMsg) sendMsg(chatId, `❌ <b>Scheduler</b>: ${label} pipeline ล้มเหลว (exit ${code})`);
    }
  });
  child.on('error', e => {
    try { fs.unlinkSync(lockFile); } catch {}
    if (log) log(`❌ [Scheduler] ${label} spawn error: ${e.message}`);
  });
}

// backward-compat alias
function runManaoPipeline({ root, lockFile, manaoRun, sendMsg, chatId, log }) {
  runPipeline({ label: 'มะนาว', lockFile, scriptPath: manaoRun, sendMsg, chatId, log });
}

async function schedulerLoop({ root, lockFile, manaoRun, makrutRun, makrutLock, sendMsg, chatId, log }) {
  let lastScheduled = '';
  while (true) {
    const now     = new Date(Date.now() + 7 * 3600 * 1000); // UTC → BKK
    const hour    = now.getUTCHours();
    const min     = now.getUTCMinutes();
    const hhmm    = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    const dateKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')} ${hour}`;

    if (min === 0 && lastScheduled !== dateKey) {
      if (MANAO_HOURS.includes(hour)) {
        lastScheduled = dateKey;
        if (log) log(`⏰ [Scheduler] ${hhmm} BKK — เริ่ม มะนาว full pipeline`);
        if (chatId && sendMsg) await sendMsg(chatId, `⏰ <b>Scheduler</b> ${hhmm} น.\nกำลังสั่ง 🍋 มะนาว ดึงข่าว + สร้าง content...`);
        runPipeline({ label: 'มะนาว', lockFile, scriptPath: manaoRun, sendMsg, chatId, log });
      }
      if (MAKRUT_HOURS.includes(hour) && makrutRun && makrutLock) {
        lastScheduled = dateKey;
        if (log) log(`⏰ [Scheduler] ${hhmm} BKK — เริ่ม มะกรูด full pipeline`);
        if (chatId && sendMsg) await sendMsg(chatId, `⏰ <b>Scheduler</b> ${hhmm} น.\nกำลังสั่ง 🍋 มะกรูด ดึงข่าวบอลโลก...`);
        runPipeline({ label: 'มะกรูด', lockFile: makrutLock, scriptPath: makrutRun, sendMsg, chatId, log });
      }
    }

    await new Promise(r => setTimeout(r, 30000));
  }
}

module.exports = { isPipelineLocked, runPipeline, runManaoPipeline, schedulerLoop };
