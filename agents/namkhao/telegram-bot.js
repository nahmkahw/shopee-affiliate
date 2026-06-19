'use strict';
/**
 * agents/namkhao/telegram-bot.js — น้ำข้าว Telegram Command Bot
 *
 * คำสั่งที่รองรับ:
 *   checkagent  → ตรวจสถานะ Agent ทั้งหมด + การเชื่อมต่อ
 *   menu        → แสดงปุ่มสั่งงาน Agent แบบ inline keyboard
 */

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { tgRequest, sendMsg, sendMenu } = require('../../lib/namkhao-bot-tg');
const { loadQueue, handleNewsCallback }  = require('../../lib/namkhao-bot-news');
const { buildStatusMessage, checkConnections } = require('../../lib/namkhao-bot-status');
const { schedulerLoop } = require('../../lib/namkhao-bot-scheduler');

const ROOT          = path.resolve(__dirname, '..', '..');
const STATUS_FILE   = path.join(ROOT, 'agent-status.json');
const PID_FILE      = path.join(__dirname, 'telegram-bot.pid');
const LOG_FILE      = path.join(__dirname, 'namkhao-bot.log');
const AI_NEWS_DIR   = path.join(ROOT, 'agents', 'manao', 'pipeline');
const PIPELINE_LOCK = path.join(ROOT, 'agents', 'manao', '.pipeline.lock');
const MANAO_RUN     = path.join(AI_NEWS_DIR, 'manao.js');
const MAKRUT_DIR    = path.join(ROOT, 'agents', 'makrut', 'pipeline');
const MAKRUT_RUN    = path.join(MAKRUT_DIR, 'makrut.js');
const MAKRUT_LOCK   = path.join(ROOT, 'agents', 'makrut', '.pipeline.lock');

// ─── .env reader ──────────────────────────────────────────────────────────────
function readEnv() {
  try {
    const env = {};
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return env;
  } catch { return {}; }
}

function readPipelineEnv() {
  try {
    const env = {};
    for (const line of fs.readFileSync(path.join(AI_NEWS_DIR, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return env;
  } catch { return {}; }
}

const env     = readEnv();
const TOKEN   = env.NAMKHAO_TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID;

if (!TOKEN || !CHAT_ID) {
  console.error('❌ ขาด TELEGRAM_BOT_TOKEN หรือ TELEGRAM_CHAT_ID ใน .env');
  process.exit(1);
}

// ─── PID + process lifecycle ──────────────────────────────────────────────────
fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
process.on('exit',   () => { try { fs.unlinkSync(PID_FILE); } catch {} });
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM',() => process.exit(0));
process.on('unhandledRejection', r => log(`⚠️ unhandledRejection: ${r?.message || r}`));
process.on('uncaughtException',  e => log(`⚠️ uncaughtException: ${e.message}`));

// ─── Logger ───────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toLocaleTimeString('th-TH')}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n', 'utf8'); } catch {}
}

try {
  if (fs.existsSync(LOG_FILE)) {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
    if (lines.length > 500) fs.writeFileSync(LOG_FILE, lines.slice(-500).join('\n'), 'utf8');
  }
} catch {}

// ─── Bound Telegram helpers ───────────────────────────────────────────────────
const tg      = (method, body) => tgRequest(TOKEN, method, body);
const send    = (chatId, text) => sendMsg(TOKEN, chatId, text);
const menu    = (chatId)       => sendMenu(TOKEN, chatId);

// ─── Spawn Agent (fire-and-forget) ────────────────────────────────────────────
function spawnAgent(agentName, action) {
  const scriptPath = path.join(ROOT, 'agents', agentName, 'run.js');
  if (!fs.existsSync(scriptPath)) {
    log(`❌ spawnAgent: ไม่พบ ${scriptPath}`);
    return false;
  }
  const child = spawn(process.execPath, [scriptPath, '--action', action], {
    cwd: ROOT, detached: true, stdio: 'ignore',
  });
  child.unref();
  log(`▶ spawn ${agentName} action=${action} PID=${child.pid}`);

  try {
    const s = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    if (s[agentName]) Object.assign(s[agentName], { status: 'running', currentAction: action, pid: child.pid, lastRun: new Date().toISOString() });
    fs.writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2), 'utf8');
  } catch {}
  return true;
}

// ─── handle run:* callback ────────────────────────────────────────────────────
const RUN_LABELS = {
  'run:mali:scrape':         { agent: 'mali',   action: 'scrape',        label: '🌸 ดึงสินค้า'    },
  'run:mali:approve-today':  { agent: 'mali',   action: 'approve-today', label: '🌸 โพสต์วันนี้'  },
  'run:manao:full':          { agent: 'manao',  action: 'full',          label: '🍋 มะนาว รัน'    },
  'run:manao:status':        { agent: 'manao',  action: 'status',        label: '🍋 มะนาว สถานะ'  },
  'run:makrut:full':         { agent: 'makrut', action: 'full',          label: '⚽ มะกรูด รัน'   },
  'run:makrut:status':       { agent: 'makrut', action: 'status',        label: '⚽ มะกรูด สถานะ' },
};

async function handleRunCallback(cbData, cbq, cbChat) {
  if (cbData === 'run:checkagent') {
    await tg('answerCallbackQuery', { callback_query_id: cbq.id, text: '⏳ กำลังตรวจสอบ...' });
    await handleCheckAgent(cbChat);
    return true;
  }

  const entry = RUN_LABELS[cbData];
  if (!entry) return false;

  await tg('answerCallbackQuery', { callback_query_id: cbq.id, text: `⏳ สั่ง ${entry.label}...` });
  const ok = spawnAgent(entry.agent, entry.action);
  await send(cbChat, ok
    ? `⏳ <b>กำลังสั่งงาน:</b> ${entry.label}\n<i>ดูผลได้ใน log หรือกด checkagent</i>`
    : `❌ ไม่พบ script สำหรับ ${entry.label}`
  );
  return true;
}

// ─── handleCheckAgent ─────────────────────────────────────────────────────────
async function handleCheckAgent(chatId) {
  await send(chatId, '⏳ กำลังตรวจสอบ Agent และการเชื่อมต่อ...');
  await send(chatId, buildStatusMessage(ROOT, STATUS_FILE));

  const pipeEnv    = readPipelineEnv();
  const connResults = await checkConnections(TOKEN, pipeEnv);
  const allOk      = connResults.every(r => r.ok);
  const now        = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

  let connMsg = `🔌 <b>การเชื่อมต่อ External Services</b>\n📅 ${now}\n${'─'.repeat(28)}\n`;
  for (const { icon, name, ok, err } of connResults) {
    connMsg += ok ? `${icon} ${name}: ✅\n` : `${icon} ${name}: ❌ <code>${err}</code>\n`;
  }
  connMsg += `${'─'.repeat(28)}\n`;
  connMsg += allOk ? '✅ <b>ทุก service เชื่อมต่อได้ปกติ</b>' : `⚠️ <b>พบปัญหา ${connResults.filter(r => !r.ok).length} รายการ</b>`;

  await send(chatId, connMsg);
  log(`✅ ส่ง checkagent ไปยัง chat ${chatId}`);
}

// ─── Long-poll loop ───────────────────────────────────────────────────────────
let offset = 0;

async function initOffset() {
  const res = await tg('getUpdates', { limit: 1, offset: -1 });
  if (res.result?.length) offset = res.result[0].update_id + 1;
  log(`🚀 Bot เริ่มต้น (offset=${offset})`);
}

async function poll() {
  try {
    const res = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
    if (!res.result?.length) return;

    for (const upd of res.result) {
      offset = upd.update_id + 1;

      // ── callback_query ────────────────────────────────────────────────────
      if (upd.callback_query) {
        const cbq    = upd.callback_query;
        const cbData = cbq.data || '';
        const cbChat = String(cbq.message?.chat?.id || CHAT_ID);
        log(`[cb] data="${cbData}" chat=${cbChat}`);
        if (CHAT_ID && cbChat !== CHAT_ID) continue;

        if (cbData.startsWith('run:')) { await handleRunCallback(cbData, cbq, cbChat); continue; }

        // news callbacks (approve:/skip:/approve__/skip__)
        const newsDone = await handleNewsCallback(cbData, cbq, cbChat, {
          tgRequest: tg, sendMsg: send,
          loadQueueFn: () => loadQueue(path.join(AI_NEWS_DIR, '_tg_queue.json')),
          newsDir: path.join(AI_NEWS_DIR, 'news'),
          aiNewsDir: AI_NEWS_DIR, env, log,
        });
        if (!newsDone) log(`⚠️ [cb] ไม่รู้จัก callback: ${cbData}`);
        continue;
      }

      // ── message ───────────────────────────────────────────────────────────
      const msg = upd.message;
      if (!msg?.text) continue;

      const text   = msg.text.trim().toLowerCase();
      const chatId = String(msg.chat.id);
      if (CHAT_ID && chatId !== CHAT_ID) { log(`⚠️ ข้ามคำสั่งจาก chat ${chatId}`); continue; }

      const fromName = msg.from?.first_name || 'ผู้ใช้';
      log(`📩 ได้รับ: "${text}" จาก ${fromName}`);

      if (/^menu$/.test(text)) {
        await menu(chatId);
      } else if (/checkagent|check.?agent/.test(text)) {
        await handleCheckAgent(chatId);
      }
    }
  } catch (e) {
    log(`⚠️ poll error: ${e.message}`);
    await new Promise(r => setTimeout(r, 5000));
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  log('🍚 น้ำข้าว Telegram Bot เริ่มทำงาน');
  await initOffset();

  schedulerLoop({ root: ROOT, lockFile: PIPELINE_LOCK, manaoRun: MANAO_RUN,
                  makrutRun: MAKRUT_RUN, makrutLock: MAKRUT_LOCK,
                  sendMsg: send, chatId: CHAT_ID, log });

  while (true) { await poll(); }
})();
