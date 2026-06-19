'use strict';
/**
 * agents/namkhao/run.js — น้ำข้าว Agent (Supervisor)
 *
 * ใช้งาน:
 *   node agents/namkhao/run.js --action status
 *   node agents/namkhao/run.js --action summary
 *   node agents/namkhao/run.js --action start-mali --target-action approve-today
 *   node agents/namkhao/run.js --action start-manao --target-action full
 */

const fs   = require('fs');
const path = require('path');

const { checkConnections, sendTelegram, loadAlerts, saveAlerts, shouldAlert } = require('../../lib/namkhao-health');
const { createStatusActions } = require('../../lib/namkhao-status');

const ROOT        = path.resolve(__dirname, '..', '..');
const STATUS_FILE = path.join(ROOT, 'agent-status.json');
const LOG_FILE    = path.join(__dirname, 'namkhao.log');
const NEWS_DIR    = path.join(ROOT, 'news');
const ALERT_FILE  = path.join(__dirname, 'monitor-alerts.json');

// ─── .env reader ─────────────────────────────────────────────────────────────

function readEnv(filePath = path.join(ROOT, '.env')) {
  try {
    const env = {};
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return env;
  } catch { return {}; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toLocaleTimeString('th-TH')}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

function updateStatus(fields) {
  try {
    const s = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    Object.assign(s.namkhao, fields);
    fs.writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2), 'utf8');
  } catch {}
}

function readStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); }
  catch { return { mali: {}, manao: {}, namkhao: {} }; }
}

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function readLog(agentName, lines = 30) {
  const logFile = path.join(ROOT, 'agents', agentName, `${agentName}.log`);
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf8').split('\n').filter(l => l.trim()).slice(-lines);
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function actionMonitor() {
  log('🔍 น้ำข้าว ตรวจสอบ Agent สุขภาพ...');
  const rootEnv = readEnv();
  const pipeEnv = readEnv(path.join(ROOT, 'agents', 'manao', 'pipeline', '.env'));
  const TG_TOKEN   = rootEnv.NAMKHAO_TELEGRAM_BOT_TOKEN || rootEnv.TELEGRAM_BOT_TOKEN;
  const TG_CHAT_ID = rootEnv.TELEGRAM_CHAT_ID;

  if (!TG_TOKEN || !TG_CHAT_ID) {
    log('⚠️ ไม่มี NAMKHAO_TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID ใน .env — ข้ามการแจ้งเตือน');
    return;
  }

  const s      = readStatus();
  const now    = Date.now();
  const issues = [];

  for (const [name, label, maxIdleHours] of [
    ['mali',  '🌸 มะลิ',  24],
    ['manao', '🍋 มะนาว',  7],
  ]) {
    const a = s[name] || {};
    if (a.status === 'error') {
      issues.push({ agent: label, level: '🔴', msg: `status = error\nผลล่าสุด: ${a.lastResult || '-'}` });
    }
    if (a.lastRun) {
      const diffHours = (now - new Date(a.lastRun).getTime()) / 3600000;
      if (diffHours > maxIdleHours)
        issues.push({ agent: label, level: '⚠️', msg: `ไม่มีการทำงานนาน ${diffHours.toFixed(1)} ชม. (เกินขีด ${maxIdleHours} ชม.)` });
    }
    const errLines = readLog(name, 50).filter(l => l.includes('❌') || l.includes('[ERROR]'));
    if (errLines.length > 0)
      issues.push({ agent: label, level: '🔴', msg: 'Error ใน log ล่าสุด:\n' + errLines.slice(-3).map(l => `  ${l.trim()}`).join('\n') });
  }

  const pipeLog = path.join(ROOT, 'agents', 'manao', 'pipeline', 'pipeline.log');
  if (fs.existsSync(pipeLog)) {
    const pipeLines = fs.readFileSync(pipeLog, 'utf8').split('\n').filter(l => l.trim()).slice(-80);
    const pipeErrs  = pipeLines.filter(l => l.includes('[ERROR]') || l.includes('ETIMEDOUT') || l.includes('❌'));
    if (pipeErrs.length > 0) {
      const lastErrLine = pipeErrs[pipeErrs.length - 1];
      const timeMatch   = lastErrLine.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
      if (timeMatch && now - new Date(timeMatch[1]).getTime() < 2 * 3600000) {
        issues.push({ agent: '🍋 มะนาว (pipeline)', level: '🔴',
          msg: 'Error ใน pipeline.log:\n' + pipeErrs.slice(-2).map(l => `  ${l.trim()}`).join('\n') });
      }
    }
  }

  log('🔌 ตรวจการเชื่อมต่อ external services...');
  const connIssues = await checkConnections(rootEnv, pipeEnv, log);
  issues.push(...connIssues);
  log(`พบปัญหา: ${issues.length} รายการ`);

  if (issues.length === 0) {
    log('✅ ทุก Agent ทำงานปกติ');
    saveAlerts(ALERT_FILE, {});
    updateStatus({ lastResult: `monitor OK — ${new Date().toLocaleTimeString('th-TH')}` });
    return;
  }

  for (const issue of issues) {
    const key = `${issue.agent}::${issue.msg.substring(0, 60)}`;
    if (!shouldAlert(ALERT_FILE, key)) {
      log(`⏭ ข้าม (ยังอยู่ใน cooldown 3 ชม.): ${key.substring(0, 80)}`);
      continue;
    }
    const text =
      `${issue.level} <b>แจ้งเตือน Agent</b> — ${new Date().toLocaleString('th-TH')}\n\n` +
      `Agent: <b>${issue.agent}</b>\n${issue.msg}\n\n` +
      `<i>ตรวจสอบโดย น้ำข้าว (Supervisor)</i>`;
    const r = await sendTelegram(TG_TOKEN, TG_CHAT_ID, text);
    if (r.ok) log(`📨 ส่ง Telegram แจ้ง: ${issue.agent} — ${issue.level}`);
    else log(`⚠️ Telegram ส่งไม่ได้: ${JSON.stringify(r).substring(0, 100)}`);
  }

  updateStatus({ lastResult: `monitor พบ ${issues.length} ปัญหา — ${new Date().toLocaleTimeString('th-TH')}` });
}

function actionStartAgent(agentName, targetAction) {
  const { spawn } = require('child_process');
  const scriptPath = path.join(ROOT, 'agents', agentName, 'run.js');
  if (!fs.existsSync(scriptPath)) { log(`❌ ไม่พบ ${scriptPath}`); return; }
  log(`▶ น้ำข้าว สั่งให้ ${agentName} เริ่ม action=${targetAction}`);
  const child = spawn(`"C:\\Program Files\\nodejs\\node.exe"`, [scriptPath, '--action', targetAction], {
    cwd: ROOT, shell: true, detached: true, stdio: 'ignore'
  });
  child.unref();
  log(`✅ ${agentName} เริ่มแล้ว PID: ${child.pid}`);
  try {
    const s = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    if (s[agentName]) {
      Object.assign(s[agentName], { status: 'running', currentAction: targetAction, pid: child.pid, lastRun: new Date().toISOString() });
      fs.writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2), 'utf8');
    }
  } catch {}
}

function actionStop(agentName) {
  log(`⏹ น้ำข้าว สั่งหยุด ${agentName}`);
  const pid = readStatus()[agentName]?.pid;
  if (!pid) { log('ไม่มี process กำลังรัน'); return; }
  try {
    process.kill(Number(pid));
    log(`✅ หยุด PID ${pid} สำเร็จ`);
    const st = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    if (st[agentName]) { st[agentName].status = 'idle'; st[agentName].pid = null; }
    fs.writeFileSync(STATUS_FILE, JSON.stringify(st, null, 2), 'utf8');
  } catch (e) {
    log(`⚠️ ไม่สามารถหยุด PID ${pid}: ${e.message}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(argv = process.argv.slice(2)) {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
      if (lines.length > 500) fs.writeFileSync(LOG_FILE, lines.slice(-500).join('\n'), 'utf8');
    }
  } catch {}

  const action       = argv[argv.indexOf('--action') + 1] || 'status';
  const targetAction = argv[argv.indexOf('--target-action') + 1] || 'status';

  const { actionStatus, actionSummary } = createStatusActions({ ROOT, NEWS_DIR, log, readStatus, todayString, readLog, updateStatus });

  updateStatus({ status: 'running', currentAction: action, lastRun: new Date().toISOString() });
  log(`▶ น้ำข้าว เริ่มทำงาน action=${action}`);

  try {
    switch (action) {
      case 'status':      actionStatus();                             break;
      case 'summary':     actionSummary();                            break;
      case 'monitor':     await actionMonitor();                      break;
      case 'start-mali':  actionStartAgent('mali', targetAction);     break;
      case 'start-manao': actionStartAgent('manao', targetAction);    break;
      case 'stop-mali':   actionStop('mali');                         break;
      case 'stop-manao':  actionStop('manao');                        break;
      default:
        log(`❌ ไม่รู้จัก action: ${action}`);
        process.exit(1);
    }
    updateStatus({ status: 'idle' });
    log('▶ น้ำข้าว หยุดทำงาน');
  } catch (e) {
    log(`❌ Error: ${e.message}`);
    updateStatus({ status: 'error', lastResult: e.message.substring(0, 100) });
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { readEnv, readStatus, updateStatus, todayString, readLog, log,
                   actionMonitor, actionStartAgent, actionStop, main };
