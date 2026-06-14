/**
 * agents/namkhao/telegram-bot.js — น้ำข้าว Telegram Command Bot
 *
 * รันเป็น background daemon — รอรับคำสั่งจาก Telegram
 *
 * คำสั่งที่รองรับ:
 *   checkagent  → ตรวจสถานะ Agent ทั้งหมด (มะลิ + มะนาว) พร้อม log ล่าสุด
 *
 * ใช้งาน:
 *   node agents/namkhao/telegram-bot.js
 */

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { spawn } = require('child_process');

const ROOT        = path.resolve(__dirname, '..', '..');
const STATUS_FILE = path.join(ROOT, 'agent-status.json');
const PID_FILE    = path.join(__dirname, 'telegram-bot.pid');
const LOG_FILE    = path.join(__dirname, 'namkhao-bot.log');
const AI_NEWS_DIR   = path.join(ROOT, 'agents', 'manao', 'pipeline');
const TG_QUEUE_FILE = path.join(AI_NEWS_DIR, '_tg_queue.json');

/** โหลด shortId→{slug,platform} map จาก generate.js */
function loadQueue() {
  try { return JSON.parse(fs.readFileSync(TG_QUEUE_FILE, 'utf8')); }
  catch { return {}; }
}

// ─── .env reader ──────────────────────────────────────────────────────────────
function readEnv() {
  try {
    const lines = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n');
    const env = {};
    for (const line of lines) {
      const m = line.match(/^\s*([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return env;
  } catch { return {}; }
}

const env     = readEnv();
// แยก token: namkhao ใช้บอทของตัวเอง (fallback ไป TELEGRAM_BOT_TOKEN ถ้ายังไม่ตั้ง)
const TOKEN   = env.NAMKHAO_TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID;

if (!TOKEN || !CHAT_ID) {
  console.error('❌ ขาด TELEGRAM_BOT_TOKEN หรือ TELEGRAM_CHAT_ID ใน .env');
  process.exit(1);
}

// ─── PID file ─────────────────────────────────────────────────────────────────
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

// trim log ไม่ให้ยาวเกิน 500 บรรทัด
try {
  if (fs.existsSync(LOG_FILE)) {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
    if (lines.length > 500) fs.writeFileSync(LOG_FILE, lines.slice(-500).join('\n'), 'utf8');
  }
} catch {}

// ─── Telegram API ─────────────────────────────────────────────────────────────
function tgRequest(method, body) {
  return new Promise((resolve) => {
    const json = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) },
      rejectUnauthorized: false,
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve({}); } });
    });
    req.setTimeout(30000, () => { req.destroy(); resolve({}); });
    req.on('error', () => resolve({}));
    req.write(json);
    req.end();
  });
}

function sendMsg(chatId, text) {
  return tgRequest('sendMessage', {
    chat_id: chatId,
    text: text.substring(0, 4096),
    parse_mode: 'HTML',
  });
}

// ─── Approve / Skip ───────────────────────────────────────────────────────────

/**
 * หา slug จริงจาก prefix (เพราะ callback_data ถูก truncate ที่ 54 chars)
 */
function resolveSlug(prefix) {
  const newsDir = path.join(AI_NEWS_DIR, 'news');
  if (!fs.existsSync(newsDir)) {
    log(`⚠️ resolveSlug: ไม่พบ newsDir "${newsDir}"`);
    return null;
  }
  const dirs = fs.readdirSync(newsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
  log(`[resolveSlug] prefix="${prefix}" dirs(${dirs.length}): ${dirs.slice(0,3).join(' | ')}`);
  const found = dirs.find(d => d === prefix || d.startsWith(prefix));
  if (!found) log(`⚠️ resolveSlug: ไม่พบ slug prefix="${prefix}" dirs=[${dirs.join(', ')}]`);
  return found || null;
}

function setNewsStatus(slug, status) {
  const dataPath = path.join(AI_NEWS_DIR, 'news', slug, 'data.json');
  if (!fs.existsSync(dataPath)) return false;
  try {
    const data   = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    data.status  = status;
    data.approved_at = new Date().toISOString();
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch { return false; }
}

// ─── Schedule post via post.js ────────────────────────────────────────────────
function schedulePost(slug, platform = 'fb') {
  return new Promise((resolve) => {
    const postScript = path.join(AI_NEWS_DIR, 'post.js');
    const proc = spawn(process.execPath, [postScript, slug, '--schedule', '--platform', platform], {
      cwd: AI_NEWS_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },  // ส่ง .env vars ไปยัง child process
    });
    let output = '';
    let done   = false;
    const finish = (code, out) => {
      if (done) return;
      done = true;
      resolve({ code, output: out.trim() });
    };
    proc.stdout.on('data', d => { output += d.toString(); });
    proc.stderr.on('data', d => { output += d.toString(); });
    proc.on('close', code => finish(code, output));
    proc.on('error', err  => finish(-1, err.message));
    setTimeout(() => finish(-1, output + '\n[timeout 60s]'), 60000);
  });
}

// ─── Connection Health Check ──────────────────────────────────────────────────

function readPipelineEnv() {
  try {
    const lines = fs.readFileSync(path.join(AI_NEWS_DIR, '.env'), 'utf8').split('\n');
    const e = {};
    for (const line of lines) {
      const m = line.match(/^\s*([^#=]+)=(.*)$/);
      if (m) e[m[1].trim()] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return e;
  } catch { return {}; }
}

function httpGetRaw(url, headers = {}, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + (parsed.search || ''),
      method:   'GET',
      headers:  { 'User-Agent': 'namkhao-bot/1.0', ...headers },
      rejectUnauthorized: false,
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, body: buf }));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, status: 0, body: 'timeout' }); });
    req.on('error', e => resolve({ ok: false, status: 0, body: e.message }));
    req.end();
  });
}

async function checkConnections() {
  const pipeEnv = readPipelineEnv();
  const results = [];

  const checks = [
    {
      icon: '📱', name: 'Telegram API',
      check: async () => {
        const r = await httpGetRaw(`https://api.telegram.org/bot${TOKEN}/getMe`);
        if (!r.ok) return `HTTP ${r.status}`;
        const j = JSON.parse(r.body);
        return j.ok ? null : j.description;
      },
    },
    {
      icon: '🤖', name: 'Ollama Server',
      check: async () => {
        const host = (pipeEnv.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
        const r = await httpGetRaw(`${host}/api/tags`);
        return r.ok ? null : `ไม่ตอบสนอง — ${host}`;
      },
    },
    {
      icon: '📘', name: 'Facebook API',
      check: async () => {
        const pageId = pipeEnv.FB_PAGE_ID;
        const token  = pipeEnv.FB_ACCESS_TOKEN;
        if (!pageId || !token) return 'ไม่มี credentials';
        const r = await httpGetRaw(`https://graph.facebook.com/v19.0/${pageId}?fields=id&access_token=${token}`);
        if (!r.ok) {
          try { return JSON.parse(r.body).error?.message || `HTTP ${r.status}`; } catch { return `HTTP ${r.status}`; }
        }
        return null;
      },
    },
    {
      icon: '📸', name: 'Instagram API',
      check: async () => {
        const igId  = pipeEnv.IG_USER_ID;
        const token = pipeEnv.IG_ACCESS_TOKEN;
        if (!igId || !token) return 'ไม่มี credentials';
        const r = await httpGetRaw(`https://graph.facebook.com/v19.0/${igId}?fields=id&access_token=${token}`);
        if (!r.ok) {
          try { return JSON.parse(r.body).error?.message || `HTTP ${r.status}`; } catch { return `HTTP ${r.status}`; }
        }
        return null;
      },
    },
    {
      icon: '🎨', name: 'ComfyUI (Image)',
      check: async () => {
        const r = await httpGetRaw('http://10.3.17.118:8188/system_stats');
        return r.ok ? null : 'ไม่ตอบสนอง — 10.3.17.118:8188';
      },
    },
    {
      icon: '🖼️', name: 'imgBB API',
      check: async () => {
        const key = pipeEnv.IMGBB_API_KEY;
        if (!key) return 'ไม่มี IMGBB_API_KEY';
        return new Promise((resolve) => {
          const body = `key=${encodeURIComponent(key)}`;
          const req  = https.request({
            hostname: 'api.imgbb.com', path: '/1/upload', method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded',
                       'Content-Length': Buffer.byteLength(body) },
          }, res => {
            let buf = '';
            res.on('data', d => buf += d);
            res.on('end', () => {
              try {
                const j   = JSON.parse(buf);
                const msg = (j.error?.message || '').toLowerCase();
                const ok  = ['no input','empty upload','empty source','no image'].some(m => msg.includes(m));
                resolve(ok ? null : (msg.includes('invalid') && msg.includes('key') ? 'API Key ไม่ถูกต้อง' : null));
              } catch { resolve(null); }
            });
          });
          req.setTimeout(10000, () => { req.destroy(); resolve('timeout'); });
          req.on('error', e => resolve(`เชื่อมไม่ได้: ${e.message}`));
          req.write(body); req.end();
        });
      },
    },
    {
      icon: '📡', name: 'Google News RSS',
      check: async () => {
        const r = await httpGetRaw('https://news.google.com/rss/search?q=artificial+intelligence&hl=en-US&gl=US&ceid=US:en');
        if (!r.ok) return `HTTP ${r.status}`;
        return r.body.includes('<rss') || r.body.includes('<channel') ? null : 'ไม่ได้รับ RSS feed';
      },
    },
  ];

  for (const { icon, name, check } of checks) {
    try {
      const err = await check();
      results.push({ icon, name, ok: !err, err: err || '' });
    } catch (e) {
      results.push({ icon, name, ok: false, err: e.message.substring(0, 60) });
    }
  }
  return results;
}

// ─── Status Builder ───────────────────────────────────────────────────────────
function readLog(agentName, n = 10) {
  const f = path.join(ROOT, 'agents', agentName, `${agentName}.log`);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim()).slice(-n);
}

function timeSince(isoStr) {
  if (!isoStr) return 'ไม่ทราบ';
  const diff = Date.now() - new Date(isoStr).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h} ชม. ${m} นาทีที่แล้ว`;
  return `${m} นาทีที่แล้ว`;
}

function buildStatusMessage() {
  const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  let msg = `🤖 <b>สถานะ Agent ทั้งหมด</b>\n📅 ${now}\n${'─'.repeat(30)}\n\n`;

  let s = { mali: {}, manao: {}, namkhao: {} };
  try { s = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch {}

  // ── มะลิ (Shopee) ─────────────────────────────────────────────────────────
  const mali = s.mali || {};
  const maliIcon = mali.status === 'running' ? '🟡' : mali.status === 'error' ? '🔴' : '🟢';
  msg += `${maliIcon} <b>มะลิ</b> (Shopee Affiliate)\n`;
  msg += `   สถานะ: ${mali.status || 'idle'}\n`;
  msg += `   ล่าสุด: ${timeSince(mali.lastRun)}\n`;
  msg += `   ผล: ${mali.lastResult || '-'}\n`;

  // สรุปสินค้าวันนี้
  try {
    const today = new Date().toISOString().slice(0, 10);
    const prodDir = path.join(ROOT, 'products');
    const dirs = fs.readdirSync(prodDir).filter(d => fs.existsSync(path.join(prodDir, d, 'data.json')));
    let todayCount = 0, postedToday = 0, totalPosted = 0;
    dirs.forEach(id => {
      const d = JSON.parse(fs.readFileSync(path.join(prodDir, id, 'data.json'), 'utf8'));
      if (d.status === 'placeholder') return;
      if (d.status === 'posted') totalPosted++;
      if (d.post_date === today) {
        todayCount++;
        if (d.status === 'posted') postedToday++;
      }
    });
    msg += `   วันนี้: ${todayCount} รายการ (โพสต์แล้ว ${postedToday}) | รวม: ${totalPosted} รายการ\n`;
  } catch {}

  // log error ล่าสุด
  const maliErrLines = readLog('mali', 20).filter(l => l.includes('❌') || l.includes('[ERROR]'));
  if (maliErrLines.length) {
    msg += `   ⚠️ Error ล่าสุด:\n`;
    maliErrLines.slice(-2).forEach(l => msg += `   <code>${l.trim().substring(0, 80)}</code>\n`);
  }

  msg += '\n';

  // ── มะนาว (Reuters AI News) ───────────────────────────────────────────────
  const manao = s.manao || {};
  const manaoIcon = manao.status === 'running' ? '🟡' : manao.status === 'error' ? '🔴' : '🟢';
  msg += `${manaoIcon} <b>มะนาว</b> (Reuters AI News)\n`;
  msg += `   สถานะ: ${manao.status || 'idle'}\n`;
  msg += `   ล่าสุด: ${timeSince(manao.lastRun)}\n`;
  msg += `   ผล: ${manao.lastResult || '-'}\n`;

  // ตรวจ pipeline.log บรรทัดสุดท้าย
  try {
    const pipeLog = path.join(AI_NEWS_DIR, 'pipeline.log');
    if (fs.existsSync(pipeLog)) {
      const pLines = fs.readFileSync(pipeLog, 'utf8').split('\n').filter(l => l.trim()).slice(-15);
      // หา === บรรทัดสุดท้าย = สรุป pipeline ล่าสุด
      const lastHeader = [...pLines].reverse().find(l => l.includes('=== เริ่ม Pipeline'));
      const lastFooter = [...pLines].reverse().find(l => l.includes('=== Pipeline'));
      if (lastHeader) msg += `   Pipeline เริ่ม: ${lastHeader.split(' ')[0]} ${lastHeader.split(' ')[1]}\n`;
      if (lastFooter) msg += `   Pipeline สิ้นสุด: ${lastFooter.includes('เสร็จ') ? '✅ สำเร็จ' : '❌ ล้มเหลว'}\n`;

      // error ล่าสุด
      const pipeErrs = pLines.filter(l => l.includes('[ERROR]') || l.includes('ETIMEDOUT'));
      if (pipeErrs.length) {
        msg += `   ⚠️ Error: <code>${pipeErrs[pipeErrs.length - 1].trim().substring(0, 80)}</code>\n`;
      }
    }
  } catch {}

  // ── น้ำข้าว ───────────────────────────────────────────────────────────────
  const namkhao = s.namkhao || {};
  msg += '\n';
  msg += `🟢 <b>น้ำข้าว</b> (Supervisor)\n`;
  msg += `   Monitor ล่าสุด: ${timeSince(namkhao.lastRun)}\n`;
  msg += `   ผล: ${namkhao.lastResult || '-'}\n`;

  msg += `\n${'─'.repeat(30)}\n`;
  msg += `💡 พิมพ์ <b>checkagent</b> เพื่อตรวจสอบใหม่`;

  return msg;
}

// ─── Long-poll loop ───────────────────────────────────────────────────────────
let offset = 0;

async function initOffset() {
  const res = await tgRequest('getUpdates', { limit: 1, offset: -1 });
  if (res.result?.length) offset = res.result[0].update_id + 1;
  log(`🚀 Bot เริ่มต้น (offset=${offset}) — รอคำสั่ง "checkagent"`);
}

async function poll() {
  try {
    const res = await tgRequest('getUpdates', {
      offset,
      timeout: 25,
      allowed_updates: ['message', 'callback_query'],
    });

    if (!res.result?.length) return;

    for (const upd of res.result) {
      offset = upd.update_id + 1;

      // ── callback_query (ปุ่ม Approve / Skip) ────────────────────────────────
      if (upd.callback_query) {
        const cbq    = upd.callback_query;
        const cbData = cbq.data || '';
        const cbChat = String(cbq.message?.chat?.id || CHAT_ID);

        log(`[cb_raw] data="${cbData}" chat=${cbChat} expectedChat=${CHAT_ID}`);

        if (CHAT_ID && cbChat !== CHAT_ID) {
          log(`⚠️ [cb_raw] ข้าม — chat ไม่ตรง (${cbChat} ≠ ${CHAT_ID})`);
          continue;
        }

        // ── รูปแบบ generate.js: approve:shortId / cancel:shortId / regen:shortId ──
        if (cbData.startsWith('approve:') || cbData.startsWith('cancel:') || cbData.startsWith('regen:')) {
          const colonIdx = cbData.indexOf(':');
          const action   = cbData.substring(0, colonIdx);
          const shortId  = cbData.substring(colonIdx + 1);
          const queue    = loadQueue();
          const entry    = queue[shortId];

          if (!entry) {
            await tgRequest('answerCallbackQuery', { callback_query_id: cbq.id, text: '❓ ไม่พบข่าวนี้ใน queue' });
            continue;
          }

          const slug     = typeof entry === 'string' ? entry : entry.slug;
          const platform = (typeof entry === 'object' && entry.platform) ? entry.platform : 'fb,ig';
          log(`[queue] action=${action} shortId=${shortId} slug=${slug} platform=${platform}`);

          if (action === 'approve') {
            await tgRequest('answerCallbackQuery', { callback_query_id: cbq.id, text: '⏳ กำลัง schedule...' });
            await sendMsg(cbChat, `⏳ <b>กำลัง schedule...</b>\n<code>${slug}</code>`);
            log(`⏳ schedule (queue): ${slug} [${platform}]`);

            const { code, output } = await schedulePost(slug, platform);

            if (code === 0) {
              const timeMatch = output.match(/กำหนดโพสต์:\s*(.+)/);
              const timeStr   = timeMatch ? timeMatch[1].trim() : '';
              log(`✅ scheduled: ${slug}`);
              await sendMsg(cbChat,
                `✅ <b>Schedule สำเร็จ!</b>\n<code>${slug}</code>\n` +
                (timeStr ? `⏰ <b>กำหนดโพสต์:</b> ${timeStr}` : '')
              );
            } else {
              log(`❌ schedule ล้มเหลว: ${slug} (code=${code})`);
              const errSnip = output.slice(-200).replace(/</g, '&lt;').replace(/>/g, '&gt;');
              await sendMsg(cbChat,
                `❌ <b>Schedule ล้มเหลว</b> (code=${code})\n<code>${slug}</code>\n` +
                (errSnip ? `<pre>${errSnip}</pre>` : '')
              );
            }

          } else if (action === 'cancel') {
            setNewsStatus(slug, 'skipped');
            await tgRequest('answerCallbackQuery', { callback_query_id: cbq.id, text: '❌ ยกเลิกแล้ว' });
            log(`❌ cancelled: ${slug}`);
            await sendMsg(cbChat, `❌ <b>ยกเลิกแล้ว</b>\n<code>${slug}</code>`);

          } else {
            // regen — namkhao bot ไม่รองรับ — แนะนำให้ใช้ generate.js โดยตรง
            await tgRequest('answerCallbackQuery', { callback_query_id: cbq.id, text: '⚠️ ไม่รองรับ — ใช้ generate.js --force แทน' });
          }
          continue;
        }

        // ── รูปแบบ formatter-agent: approve__slug / skip__slug ───────────────
        if (cbData.startsWith('approve__') || cbData.startsWith('skip__')) {
          const isApprove = cbData.startsWith('approve__');
          const prefix    = cbData.replace(/^(approve|skip)__/, '');
          log(`[approve] cbData="${cbData}" prefix="${prefix}" len=${prefix.length}`);
          const slug      = resolveSlug(prefix);

          if (!slug) {
            await tgRequest('answerCallbackQuery', { callback_query_id: cbq.id, text: '❓ ไม่พบข่าวนี้' });
            continue;
          }

          if (isApprove) {
            // ─── Approve → schedule FB + IG ────────────────────────────────
            // ตอบ Telegram ทันที (Telegram timeout 10 วิ)
            await tgRequest('answerCallbackQuery', { callback_query_id: cbq.id, text: '⏳ กำลัง schedule...' });
            await sendMsg(cbChat, `⏳ <b>กำลัง schedule...</b>\n<code>${slug}</code>`);
            log(`⏳ schedule: ${slug}`);

            // รัน post.js {slug} --schedule --platform fb
            const { code, output } = await schedulePost(slug, 'fb');

            if (code === 0) {
              // ดึงเวลาโพสต์จาก output
              const timeMatch = output.match(/กำหนดโพสต์:\s*(.+)/);
              const timeStr   = timeMatch ? timeMatch[1].trim() : '';
              log(`✅ scheduled: ${slug}`);
              await sendMsg(cbChat,
                `✅ <b>Schedule สำเร็จ!</b>\n` +
                `<code>${slug}</code>\n` +
                (timeStr ? `⏰ <b>กำหนดโพสต์:</b> ${timeStr}` : '')
              );
            } else {
              log(`❌ schedule ล้มเหลว: ${slug} (code=${code})`);
              const errSnip = output.slice(-200).replace(/</g, '&lt;').replace(/>/g, '&gt;');
              await sendMsg(cbChat,
                `❌ <b>Schedule ล้มเหลว</b> (code=${code})\n` +
                `<code>${slug}</code>\n` +
                (errSnip ? `<pre>${errSnip}</pre>` : '')
              );
            }

          } else {
            // ─── Skip → อัปเดต status เป็น skipped ────────────────────────
            const ok = setNewsStatus(slug, 'skipped');
            await tgRequest('answerCallbackQuery', { callback_query_id: cbq.id, text: '❌ ข้ามแล้ว' });
            if (ok) {
              log(`❌ skipped: ${slug}`);
              await sendMsg(cbChat, `❌ <b>ข้ามแล้ว</b>\n<code>${slug}</code>`);
            }
          }
        }
        continue;
      }

      // ── message ──────────────────────────────────────────────────────────────
      const msg = upd.message;
      if (!msg?.text) continue;

      const text     = msg.text.trim().toLowerCase();
      const chatId   = String(msg.chat.id);
      const fromName = msg.from?.first_name || 'ผู้ใช้';

      // ตรวจคำสั่ง checkagent (รับทั้ง "checkagent", "/checkagent", "check agent")
      const isCheckAgent = /checkagent|check.?agent/.test(text);

      if (isCheckAgent) {
        // ตรวจว่ามาจาก chat ที่ถูกต้อง (ถ้า CHAT_ID ตั้งไว้)
        if (CHAT_ID && chatId !== CHAT_ID) {
          log(`⚠️ ข้ามคำสั่งจาก chat ${chatId} (ไม่ใช่ chat ที่กำหนด)`);
          continue;
        }

        log(`📩 ได้รับคำสั่ง checkagent จาก ${fromName} (chat: ${chatId})`);
        await sendMsg(chatId, '⏳ กำลังตรวจสอบ Agent และการเชื่อมต่อ...');

        // ── ส่ง 1: สถานะ Agent ────────────────────────────────────────────────
        const statusMsg = buildStatusMessage();
        await sendMsg(chatId, statusMsg);

        // ── ส่ง 2: ตรวจการเชื่อมต่อ (async) ──────────────────────────────────
        const connResults = await checkConnections();
        const allOk = connResults.every(r => r.ok);
        const now   = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

        let connMsg = `🔌 <b>การเชื่อมต่อ External Services</b>\n📅 ${now}\n${'─'.repeat(28)}\n`;
        for (const { icon, name, ok, err } of connResults) {
          connMsg += ok
            ? `${icon} ${name}: ✅\n`
            : `${icon} ${name}: ❌ <code>${err}</code>\n`;
        }
        connMsg += `${'─'.repeat(28)}\n`;
        connMsg += allOk ? '✅ <b>ทุก service เชื่อมต่อได้ปกติ</b>' : `⚠️ <b>พบปัญหา ${connResults.filter(r => !r.ok).length} รายการ</b>`;

        await sendMsg(chatId, connMsg);
        log(`✅ ส่งสถานะ + การเชื่อมต่อ ไปยัง ${fromName} แล้ว`);
      }
    }
  } catch (e) {
    log(`⚠️ poll error: ${e.message}`);
    await new Promise(r => setTimeout(r, 5000)); // รอ 5 วิ ก่อน retry
  }
}

// ─── Daily Scheduler (สั่ง มะนาว pipeline 07:00 + 13:00) ────────────────────
const SCHEDULE_HOURS  = [7, 13]; // BKK time (UTC+7)
const PIPELINE_LOCK   = path.join(ROOT, 'agents', 'manao', '.pipeline.lock');
let lastScheduledDate = '';      // วันที่ล่าสุดที่ triggered (YYYY-MM-DD HH)

function isPipelineLocked() {
  if (!fs.existsSync(PIPELINE_LOCK)) return false;
  try {
    const pid = parseInt(fs.readFileSync(PIPELINE_LOCK, 'utf8').trim(), 10);
    process.kill(pid, 0); // ถ้าไม่ throw = process ยังมีชีวิต
    return true;
  } catch {
    fs.unlinkSync(PIPELINE_LOCK); // process ตายแล้ว → ลบ lock เก่า
    return false;
  }
}

function runManaoPipeline() {
  if (isPipelineLocked()) {
    log('⚠️ [Scheduler] pipeline กำลังรันอยู่แล้ว — ข้าม');
    if (CHAT_ID) sendMsg(CHAT_ID, '⚠️ <b>Scheduler</b>: มะนาว pipeline ยังรันค้างอยู่ — ข้ามรอบนี้');
    return;
  }

  const manaoRun = path.join(ROOT, 'agents', 'manao', 'pipeline', 'manao.js');
  const child = spawn(process.execPath, [manaoRun], {
    cwd: path.join(ROOT, 'agents', 'manao', 'pipeline'),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  fs.writeFileSync(PIPELINE_LOCK, String(child.pid), 'utf8');
  log(`🔒 [Scheduler] lock PID=${child.pid}`);

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', d => d.split('\n').filter(l => l.trim()).forEach(l => log('[มะนาว] ' + l)));
  child.stderr.on('data', d => d.split('\n').filter(l => l.trim()).forEach(l => log('[มะนาว ⚠️] ' + l)));
  child.on('close', code => {
    try { fs.unlinkSync(PIPELINE_LOCK); } catch {}
    if (code === 0) {
      log('✅ [Scheduler] มะนาว pipeline เสร็จสิ้น');
    } else {
      log(`❌ [Scheduler] มะนาว pipeline exit ${code}`);
      if (CHAT_ID) sendMsg(CHAT_ID, `❌ <b>Scheduler</b>: มะนาว pipeline ล้มเหลว (exit ${code})`);
    }
  });
  child.on('error', e => {
    try { fs.unlinkSync(PIPELINE_LOCK); } catch {}
    log(`❌ [Scheduler] spawn error: ${e.message}`);
  });
}

async function schedulerLoop() {
  while (true) {
    const now     = new Date(Date.now() + 7 * 3600 * 1000); // UTC → BKK
    const hhmm    = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
    const dateKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')} ${now.getUTCHours()}`;

    if (SCHEDULE_HOURS.includes(now.getUTCHours()) && now.getUTCMinutes() === 0 && lastScheduledDate !== dateKey) {
      lastScheduledDate = dateKey;
      log(`⏰ [Scheduler] ${hhmm} BKK — เริ่ม มะนาว full pipeline`);
      if (CHAT_ID) await sendMsg(CHAT_ID, `⏰ <b>Scheduler</b> ${hhmm} น.\nกำลังสั่ง 🍋 มะนาว ดึงข่าว + สร้าง content...`);
      runManaoPipeline();
    }

    await new Promise(r => setTimeout(r, 30000)); // ตรวจทุก 30 วิ
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  log('🍚 น้ำข้าว Telegram Bot เริ่มทำงาน');
  await initOffset();

  schedulerLoop(); // รันควบคู่กับ poll (ไม่ await — fire and forget loop)
  while (true) {
    await poll();
  }
})();
