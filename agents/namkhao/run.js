/**
 * agents/namkhao/run.js — น้ำข้าว Agent (Supervisor)
 *
 * ใช้งาน:
 *   node agents/namkhao/run.js --action status
 *   node agents/namkhao/run.js --action summary
 *   node agents/namkhao/run.js --action start-mali --target-action approve-today
 *   node agents/namkhao/run.js --action start-manao --target-action full
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const ROOT        = path.resolve(__dirname, '..', '..');
const STATUS_FILE = path.join(ROOT, 'agent-status.json');
const LOG_FILE    = path.join(__dirname, 'namkhao.log');
const NEWS_DIR    = path.join(ROOT, 'news');
const ALERT_FILE  = path.join(__dirname, 'monitor-alerts.json'); // track sent alerts

// ─── .env reader (ไม่ต้องพึ่ง dotenv) ───────────────────────────────────────
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

// ─── Telegram ────────────────────────────────────────────────────────────────
function sendTelegram(token, chatId, text) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: chatId, text: text.substring(0, 4096), parse_mode: 'HTML' });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      rejectUnauthorized: false,
    }, res => {
      let buf = ''; res.on('data', d => buf += d);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve({}); } });
    });
    req.setTimeout(15000, () => { req.destroy(); resolve({}); });
    req.on('error', () => resolve({}));
    req.write(body); req.end();
  });
}

// ─── Alert dedup — ไม่ส่ง alert เดิมซ้ำภายใน cooldown ──────────────────────
function loadAlerts() {
  try { return JSON.parse(fs.readFileSync(ALERT_FILE, 'utf8')); } catch { return {}; }
}
function saveAlerts(a) {
  try { fs.writeFileSync(ALERT_FILE, JSON.stringify(a, null, 2), 'utf8'); } catch {}
}
function shouldAlert(key, cooldownMs = 3 * 60 * 60 * 1000) { // 3 ชั่วโมง default
  const alerts = loadAlerts();
  const last   = alerts[key] || 0;
  if (Date.now() - last > cooldownMs) {
    alerts[key] = Date.now();
    saveAlerts(alerts);
    return true;
  }
  return false;
}

// ─── HTTP helper (ไม่พึ่ง axios / node-fetch) ─────────────────────────────────
function httpGet(url, headers = {}, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : require('http');
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method: 'GET',
      headers: { 'User-Agent': 'namkhao-monitor/1.0', ...headers },
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

// ─── อ่าน pipeline .env ───────────────────────────────────────────────────────
function readPipelineEnv() {
  try {
    const lines = fs.readFileSync(path.join(ROOT, 'agents', 'manao', 'pipeline', '.env'), 'utf8').split('\n');
    const env = {};
    for (const line of lines) {
      const m = line.match(/^\s*([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return env;
  } catch { return {}; }
}

// ─── Connection Health Checks ─────────────────────────────────────────────────
async function checkConnections() {
  const rootEnv = readEnv();
  const pipeEnv = readPipelineEnv();
  const issues  = [];

  const checks = [
    // 1. Telegram Bot API
    {
      name: '📱 Telegram API',
      check: async () => {
        const token = rootEnv.NAMKHAO_TELEGRAM_BOT_TOKEN || rootEnv.TELEGRAM_BOT_TOKEN;
        if (!token) return 'ไม่มี NAMKHAO_TELEGRAM_BOT_TOKEN หรือ TELEGRAM_BOT_TOKEN ใน .env';
        const r = await httpGet(`https://api.telegram.org/bot${token}/getMe`);
        if (!r.ok) return `HTTP ${r.status}: ${r.body.substring(0, 80)}`;
        try {
          const j = JSON.parse(r.body);
          if (!j.ok) return `API error: ${j.description}`;
        } catch { return 'parse error'; }
        return null;
      },
    },
    // 2. Ollama remote server
    {
      name: '🤖 Ollama Server',
      check: async () => {
        const host = pipeEnv.OLLAMA_HOST || 'http://localhost:11434';
        const url  = host.replace(/\/$/, '') + '/api/tags';
        const r    = await httpGet(url, {}, 8000);
        if (!r.ok) return `ไม่ตอบสนอง (HTTP ${r.status}) — ${host}`;
        return null;
      },
    },
    // 4. Facebook Graph API
    {
      name: '📘 Facebook Graph API',
      check: async () => {
        const pageId = pipeEnv.FB_PAGE_ID;
        const token  = pipeEnv.FB_ACCESS_TOKEN;
        if (!pageId || !token) return 'ไม่มี FB_PAGE_ID หรือ FB_ACCESS_TOKEN';
        const r = await httpGet(
          `https://graph.facebook.com/v19.0/${pageId}?fields=id,name&access_token=${token}`
        );
        if (!r.ok) {
          try { return JSON.parse(r.body).error?.message || `HTTP ${r.status}`; }
          catch { return `HTTP ${r.status}`; }
        }
        return null;
      },
    },
    // 5. Instagram Graph API
    {
      name: '📸 Instagram Graph API',
      check: async () => {
        const igId  = pipeEnv.IG_USER_ID;
        const token = pipeEnv.IG_ACCESS_TOKEN;
        if (!igId || !token) return 'ไม่มี IG_USER_ID หรือ IG_ACCESS_TOKEN';
        const r = await httpGet(
          `https://graph.facebook.com/v19.0/${igId}?fields=id,username&access_token=${token}`
        );
        if (!r.ok) {
          try { return JSON.parse(r.body).error?.message || `HTTP ${r.status}`; }
          catch { return `HTTP ${r.status}`; }
        }
        return null;
      },
    },
    // 6. Google News RSS (scrape.js ใช้)
    {
      name: '📡 Google News RSS',
      check: async () => {
        const r = await httpGet(
          'https://news.google.com/rss/search?q=artificial+intelligence&hl=en-US&gl=US&ceid=US:en'
        );
        if (!r.ok) return `HTTP ${r.status}`;
        if (!r.body.includes('<rss') && !r.body.includes('<channel')) return 'ไม่ได้รับ RSS feed';
        return null;
      },
    },
    // 7. ComfyUI image generation (comfy-gen.js ใช้)
    {
      name: '🎨 ComfyUI (Image Gen)',
      check: async () => {
        // GET /system_stats — ตรวจว่า ComfyUI รันอยู่และ GPU พร้อม
        const r = await httpGet('http://10.3.17.118:8188/system_stats', {}, 8000);
        if (!r.ok) return `ไม่ตอบสนอง (HTTP ${r.status}) — 10.3.17.118:8188`;
        try {
          const j = JSON.parse(r.body);
          // ตรวจสถานะ queue — ถ้า queue_running > 0 แสดงว่า GPU กำลังทำงาน
          const qr = await httpGet('http://10.3.17.118:8188/queue', {}, 5000);
          if (qr.ok) {
            const q = JSON.parse(qr.body);
            const running = (q.queue_running || []).length;
            const pending = (q.queue_pending || []).length;
            if (running > 0 || pending > 0) {
              return null; // ปกติ — กำลังทำงาน
            }
          }
          return null;
        } catch { return 'parse error'; }
      },
    },
    // 8. imgBB API (post.js ใช้สำหรับอัปโหลดรูป Instagram)
    {
      name: '🖼️  imgBB API',
      check: async () => {
        const key = pipeEnv.IMGBB_API_KEY;
        if (!key) return 'ไม่มี IMGBB_API_KEY ใน pipeline/.env';
        // POST โดยไม่ส่งรูป — key ถูกต้องจะ error "No input file" (ไม่ใช่ auth error)
        return new Promise((resolve) => {
          const body = `key=${encodeURIComponent(key)}`;
          const req  = require('https').request({
            hostname: 'api.imgbb.com',
            path:     '/1/upload',
            method:   'POST',
            headers:  { 'Content-Type': 'application/x-www-form-urlencoded',
                        'Content-Length': Buffer.byteLength(body) },
          }, res => {
            let buf = '';
            res.on('data', d => buf += d);
            res.on('end', () => {
              try {
                const j = JSON.parse(buf);
                // key ถูกต้อง: error เรื่อง upload (ไม่มีรูป) — ไม่ใช่ auth error
                const msg = (j.error?.message || '').toLowerCase();
                const keyOkMessages = ['no input', 'empty upload', 'empty source', 'no image'];
                if (keyOkMessages.some(m => msg.includes(m)) || j.error?.code === 310) {
                  resolve(null);   // key valid — แค่ไม่มีรูปส่ง
                } else if (msg.includes('invalid') && msg.includes('key')) {
                  resolve(`API Key ไม่ถูกต้อง: ${j.error.message}`);
                } else if (j.status === 200 || j.data) {
                  resolve(null);   // upload สำเร็จ (ไม่น่าเกิด แต่ถือว่า ok)
                } else {
                  resolve(null);   // error อื่นที่ไม่ใช่ auth — key น่าจะ ok
                }
              } catch { resolve(null); } // ถ้า parse ไม่ได้ถือว่า host ตอบ
            });
          });
          req.setTimeout(10000, () => { req.destroy(); resolve('timeout'); });
          req.on('error', e => resolve(`เชื่อมต่อไม่ได้: ${e.message}`));
          req.write(body);
          req.end();
        });
      },
    },
  ];

  for (const { name, check } of checks) {
    try {
      const err = await check();
      if (err) {
        issues.push({ agent: name, level: '🔴', msg: err });
        log(`❌ [health] ${name}: ${err}`);
      } else {
        log(`✅ [health] ${name}: OK`);
      }
    } catch (e) {
      issues.push({ agent: name, level: '🔴', msg: e.message.substring(0, 100) });
      log(`❌ [health] ${name}: ${e.message}`);
    }
  }

  return issues;
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
  const env = readEnv();
  const TG_TOKEN   = env.NAMKHAO_TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN;
  const TG_CHAT_ID = env.TELEGRAM_CHAT_ID;

  if (!TG_TOKEN || !TG_CHAT_ID) {
    log('⚠️ ไม่มี NAMKHAO_TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID ใน .env — ข้ามการแจ้งเตือน');
    return;
  }

  const s       = readStatus();
  const now     = Date.now();
  const issues  = []; // { agent, level, msg }

  // ── ตรวจแต่ละ Agent ────────────────────────────────────────────────────────
  for (const [name, label, maxIdleHours] of [
    ['mali',  '🌸 มะลิ',  24],   // mali ไม่รันนานกว่า 24 ชม. = น่าสงสัย
    ['manao', '🍋 มะนาว',  7],   // manao ควร run ทุก ~6 ชม.
  ]) {
    const a = s[name] || {};

    // 1) status === 'error'
    if (a.status === 'error') {
      issues.push({ agent: label, level: '🔴', msg: `status = error\nผลล่าสุด: ${a.lastResult || '-'}` });
    }

    // 2) ไม่มีการรันนานเกินกำหนด
    if (a.lastRun) {
      const diffHours = (now - new Date(a.lastRun).getTime()) / 3600000;
      if (diffHours > maxIdleHours) {
        issues.push({
          agent: label, level: '⚠️',
          msg: `ไม่มีการทำงานนาน ${diffHours.toFixed(1)} ชม. (เกินขีด ${maxIdleHours} ชม.)`
        });
      }
    }

    // 3) ดู log ล่าสุด 50 บรรทัด หา ❌
    const logLines = readLog(name, 50);
    const errLines = logLines.filter(l => l.includes('❌') || l.includes('[ERROR]'));
    if (errLines.length > 0) {
      // เอาแค่บรรทัดล่าสุด 3 บรรทัด
      issues.push({
        agent: label, level: '🔴',
        msg: 'Error ใน log ล่าสุด:\n' + errLines.slice(-3).map(l => `  ${l.trim()}`).join('\n')
      });
    }
  }

  // 4) ตรวจ pipeline.log ของ มะนาว เพิ่มเติม (Ollama, Telegram errors)
  const pipeLog = path.join(ROOT, 'agents', 'manao', 'pipeline', 'pipeline.log');
  if (fs.existsSync(pipeLog)) {
    const pipeLines = fs.readFileSync(pipeLog, 'utf8').split('\n').filter(l => l.trim()).slice(-80);
    const pipeErrs  = pipeLines.filter(l => l.includes('[ERROR]') || l.includes('ETIMEDOUT') || l.includes('❌'));
    if (pipeErrs.length > 0) {
      // ตรวจว่า error ล่าสุดอยู่ในช่วง 2 ชม.ที่ผ่านมา
      const lastErrLine = pipeErrs[pipeErrs.length - 1];
      const timeMatch   = lastErrLine.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
      if (timeMatch) {
        const errTime = new Date(timeMatch[1]).getTime();
        if (now - errTime < 2 * 3600000) {
          issues.push({
            agent: '🍋 มะนาว (pipeline)', level: '🔴',
            msg: 'Error ใน pipeline.log:\n' + pipeErrs.slice(-2).map(l => `  ${l.trim()}`).join('\n')
          });
        }
      }
    }
  }

  // ── ตรวจการเชื่อมต่อภายนอก ─────────────────────────────────────────────────
  log('🔌 ตรวจการเชื่อมต่อ external services...');
  const connIssues = await checkConnections();
  issues.push(...connIssues);

  log(`พบปัญหา: ${issues.length} รายการ`);

  if (issues.length === 0) {
    log('✅ ทุก Agent ทำงานปกติ');
    // ลบ alert state เดิมถ้าหาย error แล้ว (reset cooldown)
    saveAlerts({});
    updateStatus({ lastResult: `monitor OK — ${new Date().toLocaleTimeString('th-TH')}` });
    return;
  }

  // ── รวมปัญหาและตัดสินใจส่ง Telegram ────────────────────────────────────────
  // group by agent+msg เพื่อ dedup
  for (const issue of issues) {
    const key = `${issue.agent}::${issue.msg.substring(0, 60)}`;
    if (!shouldAlert(key)) {
      log(`⏭ ข้าม (ยังอยู่ใน cooldown 3 ชม.): ${key.substring(0, 80)}`);
      continue;
    }

    const now_str = new Date().toLocaleString('th-TH');
    const text =
      `${issue.level} <b>แจ้งเตือน Agent</b> — ${now_str}\n\n` +
      `Agent: <b>${issue.agent}</b>\n` +
      `${issue.msg}\n\n` +
      `<i>ตรวจสอบโดย น้ำข้าว (Supervisor)</i>`;

    const r = await sendTelegram(TG_TOKEN, TG_CHAT_ID, text);
    if (r.ok) {
      log(`📨 ส่ง Telegram แจ้ง: ${issue.agent} — ${issue.level}`);
    } else {
      log(`⚠️ Telegram ส่งไม่ได้: ${JSON.stringify(r).substring(0, 100)}`);
    }
  }

  updateStatus({ lastResult: `monitor พบ ${issues.length} ปัญหา — ${new Date().toLocaleTimeString('th-TH')}` });
}

function actionStatus() {
  log('👀 น้ำข้าว ตรวจสอบสถานะทุก Agent');
  const s = readStatus();

  ['mali', 'manao'].forEach(name => {
    const a = s[name] || {};
    const icon = a.status === 'running' ? '🟡' : a.status === 'error' ? '🔴' : '🟢';
    log(`${icon} ${name === 'mali' ? 'มะลิ' : 'มะนาว'}: ${a.status || 'idle'} | ${a.currentAction || '-'} | ${a.lastResult || '-'}`);
    if (a.lastRun) log(`   ล่าสุด: ${new Date(a.lastRun).toLocaleString('th-TH')}`);
  });

  // สรุป Shopee
  const prodDir = path.join(ROOT, 'products');
  if (fs.existsSync(prodDir)) {
    const today = todayString();
    const dirs  = fs.readdirSync(prodDir).filter(d => fs.existsSync(path.join(prodDir, d, 'data.json')));
    let posted = 0, todayCount = 0;
    dirs.forEach(id => {
      const d = JSON.parse(fs.readFileSync(path.join(prodDir, id, 'data.json'), 'utf8'));
      if (d.status === 'posted') posted++;
      if (d.post_date === today) todayCount++;
    });
    log(`📦 Shopee: สินค้า ${dirs.length} รายการ | โพสต์แล้ว: ${posted} | วันนี้: ${todayCount}`);
  }

  // สรุป News
  const todayNews = path.join(NEWS_DIR, todayString(), 'articles.json');
  if (fs.existsSync(todayNews)) {
    const articles = JSON.parse(fs.readFileSync(todayNews, 'utf8'));
    log(`📰 Reuters News: ${articles.length} บทความวันนี้`);
  } else {
    log('📰 Reuters News: ยังไม่มีข่าววันนี้');
  }

  updateStatus({ lastResult: 'status check สำเร็จ' });
}

function actionSummary() {
  log('📊 น้ำข้าว สรุปผลงานรายวัน');
  const today = todayString();
  const s     = readStatus();

  log('='.repeat(40));
  log(`สรุปวันที่ ${today}`);
  log('='.repeat(40));

  // Shopee Summary
  const prodDir = path.join(ROOT, 'products');
  if (fs.existsSync(prodDir)) {
    const dirs = fs.readdirSync(prodDir).filter(d => fs.existsSync(path.join(prodDir, d, 'data.json')));
    let total = 0, posted = 0, ready = 0, todayCount = 0;
    dirs.forEach(id => {
      const d = JSON.parse(fs.readFileSync(path.join(prodDir, id, 'data.json'), 'utf8'));
      if (d.status === 'placeholder') return;
      total++;
      if (d.status === 'posted') posted++;
      if (d.post_date === today) todayCount++;
      if (fs.existsSync(path.join(prodDir, id, 'content', 'facebook.md'))) ready++;
    });
    log(`\n🌸 มะลิ (Shopee Affiliate)`);
    log(`   สินค้าทั้งหมด: ${total} | วันนี้: ${todayCount}`);
    log(`   โพสต์แล้ว: ${posted} | มี content: ${ready}`);
    log(`   สถานะ: ${s.mali?.lastResult || '-'}`);
  }

  // News Summary
  log(`\n🍋 มะนาว (Reuters AI News)`);
  const todayNews = path.join(NEWS_DIR, today, 'articles.json');
  if (fs.existsSync(todayNews)) {
    const articles = JSON.parse(fs.readFileSync(todayNews, 'utf8'));
    const notified = articles.filter(a => a.notified).length;
    log(`   ข่าวทั้งหมด: ${articles.length} | แจ้ง Telegram: ${notified}`);
    articles.slice(0, 3).forEach((a, i) => log(`   ${i+1}. ${a.title.substring(0, 55)}`));
  } else {
    log('   ยังไม่ได้ดึงข่าววันนี้');
  }

  // Recent logs
  log(`\n📜 Log ล่าสุด — มะลิ:`);
  readLog('mali', 5).forEach(l => log(`   ${l}`));

  log(`\n📜 Log ล่าสุด — มะนาว:`);
  readLog('manao', 5).forEach(l => log(`   ${l}`));

  log('='.repeat(40));
  updateStatus({ lastResult: `daily summary ${today}` });
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

  // อัปเดต status ของ agent นั้น
  try {
    const s = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    if (s[agentName]) {
      s[agentName].status = 'running';
      s[agentName].currentAction = targetAction;
      s[agentName].pid = child.pid;
      s[agentName].lastRun = new Date().toISOString();
      fs.writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2), 'utf8');
    }
  } catch {}
}

function actionStop(agentName) {
  log(`⏹ น้ำข้าว สั่งหยุด ${agentName}`);
  const s = readStatus();
  const pid = s[agentName]?.pid;
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

try {
  if (fs.existsSync(LOG_FILE)) {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
    if (lines.length > 500) fs.writeFileSync(LOG_FILE, lines.slice(-500).join('\n'), 'utf8');
  }
} catch {}

const args         = process.argv.slice(2);
const action       = args[args.indexOf('--action') + 1] || 'status';
const targetAction = args[args.indexOf('--target-action') + 1] || 'status';

updateStatus({ status: 'running', currentAction: action, lastRun: new Date().toISOString() });
log(`▶ น้ำข้าว เริ่มทำงาน action=${action}`);

(async () => {
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
})();
