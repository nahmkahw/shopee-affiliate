/**
 * dashboard.js — AI News Pipeline Dashboard + Agent Hub
 *
 * ใช้งาน:
 *   node dashboard.js          เปิด dashboard ที่ http://localhost:3000
 *   node dashboard.js --port 8080
 */

require('dotenv').config();
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { spawn } = require('child_process');

const NEWS_DIR  = path.join(__dirname, 'news');
const PID_FILE  = path.join(__dirname, 'telegram-bot.pid');
const LOG_FILE  = path.join(__dirname, 'pipeline.log');
const HTML_FILE = path.join(__dirname, 'dashboard.html');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const { loadConfig } = require('./config');

const args    = process.argv.slice(2);
const portIdx = args.findIndex(a => a === '--port');
const PORT    = portIdx !== -1 ? parseInt(args[portIdx + 1]) || 3000 : 3000;

// ─── Track running agents ─────────────────────────────────────────────────────

const runningAgents = {};   // { agentId: { pid, started, log[] } }

// ─── Data collection ──────────────────────────────────────────────────────────

function getNewsItems() {
  if (!fs.existsSync(NEWS_DIR)) return [];
  return fs.readdirSync(NEWS_DIR)
    .filter(d => fs.existsSync(path.join(NEWS_DIR, d, 'data.json')))
    .map(slug => {
      try {
        const data       = JSON.parse(fs.readFileSync(path.join(NEWS_DIR, slug, 'data.json'), 'utf8'));
        const contentDir = path.join(NEWS_DIR, slug, 'content');
        return {
          slug,
          title:        data.title || slug,
          url:          data.url || '',
          status:       data.status || 'scraped',
          filter_score: data.filter_score ?? null,
          filter_label: data.filter_label || null,
          published_at:  data.published_at || '',
          scraped_at:    data.scraped_at || '',
          posted_at:     data.posted_at || '',
          pending_since: data.pending_since || '',
          og_image:      data.og_image || '',
          hasFB:     fs.existsSync(path.join(contentDir, 'facebook.md')),
          hasIG:     fs.existsSync(path.join(contentDir, 'instagram.md')),
          hasX:      fs.existsSync(path.join(contentDir, 'x.md')),
          hasTikTok: fs.existsSync(path.join(contentDir, 'tiktok.md')),
          hasMaster: fs.existsSync(path.join(contentDir, 'master.md')),
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (b.scraped_at || '').localeCompare(a.scraped_at || ''));
}

function getBotStatus() {
  try {
    if (!fs.existsSync(PID_FILE)) return { running: false, pid: null };
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim());
    if (isNaN(pid)) return { running: false, pid: null };
    try { process.kill(pid, 0); return { running: true, pid }; }
    catch { return { running: false, pid }; }
  } catch { return { running: false, pid: null }; }
}

function getPipelineInfo() {
  try {
    if (!fs.existsSync(LOG_FILE)) return { last_run: null };
    let content = fs.readFileSync(LOG_FILE, 'utf8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    const lines        = content.split('\n').filter(Boolean);
    const startLines   = lines.filter(l => l.includes('=== เริ่ม Pipeline ==='));
    const finishLines  = lines.filter(l => l.includes('=== Pipeline เสร็จแล้ว'));
    const lastStart    = startLines.length  ? startLines[startLines.length - 1].replace(/[\r﻿]/g, '').substring(0, 19) : null;
    const lastFinish   = finishLines.length ? finishLines[finishLines.length - 1].replace(/[\r﻿]/g, '').substring(0, 19) : null;
    const now          = new Date();
    const nextHours    = [0, 6, 12, 18];
    const nowUTC       = now.getUTCHours() * 60 + now.getUTCMinutes();
    let nextMin        = nextHours.map(h => h * 60).find(m => m > nowUTC);
    if (!nextMin && nextMin !== 0) nextMin = nextHours[0] * 60 + 24 * 60;
    const diffMin      = nextMin > nowUTC ? nextMin - nowUTC : nextMin + 24 * 60 - nowUTC;
    const nextRunDate  = new Date(now.getTime() + diffMin * 60000);
    return { last_run: lastStart, last_finish: lastFinish, next_run_utc: nextRunDate.toISOString(), log_lines: lines.length };
  } catch { return { last_run: null }; }
}

function getStats(items) {
  const counts = { scraped: 0, draft: 0, pending_approval: 0, scheduled: 0, posted: 0 };
  for (const item of items) {
    const s = item.status || 'scraped';
    if (counts[s] !== undefined) counts[s]++;
    else counts['scraped']++;
  }
  return { total: items.length, by_status: counts };
}

// ─── Agent Hub status ─────────────────────────────────────────────────────────

function getAgentHubStatus(items) {
  const pending_filter    = items.filter(i => i.filter_score === null).length;
  const pending_editor    = items.filter(i => (i.filter_score ?? 100) >= 30 && !i.hasMaster && i.status !== 'posted').length;
  const pending_formatter = items.filter(i => i.hasMaster && (!i.hasFB || !i.hasIG || !i.hasX || !i.hasTikTok) && i.status !== 'posted').length;
  const pending_publisher = items.filter(i => i.status === 'draft').length;

  return {
    agents: [
      {
        id:      'scrape',
        name:    'Agent 1 — ดึงข่าว',
        script:  'scrape.js',
        icon:    '📡',
        pending: null,
        running: !!runningAgents['scrape'],
        pid:     runningAgents['scrape']?.pid || null,
      },
      {
        id:      'filter',
        name:    'Agent 2 — กรองข่าว',
        script:  'agents/filter-agent.js',
        icon:    '🔍',
        pending: pending_filter,
        running: !!runningAgents['filter'],
        pid:     runningAgents['filter']?.pid || null,
      },
      {
        id:      'editor',
        name:    'Agent 3 — เขียนบทความ',
        script:  'agents/editor-agent.js',
        icon:    '✏️',
        pending: pending_editor,
        running: !!runningAgents['editor'],
        pid:     runningAgents['editor']?.pid || null,
      },
      {
        id:      'formatter',
        name:    'Agent 4 — สร้าง content',
        script:  'agents/formatter-agent.js',
        icon:    '📐',
        pending: pending_formatter,
        running: !!runningAgents['formatter'],
        pid:     runningAgents['formatter']?.pid || null,
      },
      {
        id:      'publisher',
        name:    'Publisher — โพสต์',
        script:  'post.js',
        icon:    '🚀',
        pending: pending_publisher,
        running: !!runningAgents['publisher'],
        pid:     runningAgents['publisher']?.pid || null,
      },
    ],
    pipeline_running: !!runningAgents['pipeline'],
    pipeline_pid:     runningAgents['pipeline']?.pid || null,
  };
}

function buildApiData() {
  const items = getNewsItems();
  return {
    generated_at: new Date().toISOString(),
    stats:      getStats(items),
    bot:        getBotStatus(),
    pipeline:   getPipelineInfo(),
    agent_hub:  getAgentHubStatus(items),
    news:       items,
  };
}

// ─── Run agent ────────────────────────────────────────────────────────────────

const AGENT_SCRIPTS = {
  scrape:    ['node', 'scrape.js'],
  filter:    ['node', 'agents/filter-agent.js'],
  editor:    ['node', 'agents/editor-agent.js'],
  formatter: ['node', 'agents/formatter-agent.js'],
  publisher: ['node', 'post.js', '--pending', '--platform', 'fb,ig'],
  pipeline:  ['node', 'manao.js'],
};

function runAgent(agentId, extraArgs = []) {
  if (runningAgents[agentId]) {
    return { ok: false, error: `${agentId} กำลังทำงานอยู่ (PID: ${runningAgents[agentId].pid})` };
  }
  const base = AGENT_SCRIPTS[agentId];
  if (!base) return { ok: false, error: `ไม่รู้จัก agent "${agentId}"` };

  const cmd  = base[0];
  const argv = [...base.slice(1), ...extraArgs];
  const child = spawn(cmd, argv, { cwd: __dirname, env: process.env });

  runningAgents[agentId] = { pid: child.pid, started: new Date().toISOString(), log: [] };

  child.stdout.on('data', d => {
    const line = d.toString();
    runningAgents[agentId]?.log.push(line);
    if (runningAgents[agentId]?.log.length > 200) runningAgents[agentId].log.shift();
  });
  child.stderr.on('data', d => {
    runningAgents[agentId]?.log.push('[ERR] ' + d.toString());
  });
  child.on('close', code => {
    console.log(`[agent-hub] ${agentId} เสร็จ (exit ${code})`);
    delete runningAgents[agentId];
  });

  return { ok: true, pid: child.pid };
}

function getAgentLog(agentId) {
  return (runningAgents[agentId]?.log || []).join('');
}

// ─── Parse JSON body ───────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// แปลงเป็น integer ในช่วง [min, max] (ค่าพัง→ min)
function clampInt(v, min, max) {
  let n = parseInt(v, 10);
  if (isNaN(n)) n = min;
  return Math.max(min, Math.min(max, n));
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  const method  = req.method;

  // ── GET /api/data ────────────────────────────────────────────────────────────
  if (urlPath === '/api/data' && method === 'GET') {
    const data = JSON.stringify(buildApiData(), null, 2);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    return res.end(data);
  }

  // ── GET /api/content?slug=&platform= ─────────────────────────────────────────
  if (urlPath === '/api/content' && method === 'GET') {
    const params   = new URLSearchParams(req.url.split('?')[1] || '');
    const slug     = params.get('slug');
    const platform = params.get('platform') || 'facebook';
    if (!slug) { res.writeHead(400); return res.end('Missing slug'); }
    const fileMap = { facebook: 'facebook.md', instagram: 'instagram.md', x: 'x.md', tiktok: 'tiktok.md', master: 'master.md' };
    const fname   = fileMap[platform];
    if (!fname) { res.writeHead(400); return res.end('Unknown platform'); }
    const filePath = path.join(NEWS_DIR, slug, 'content', fname);
    if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(fs.readFileSync(filePath, 'utf8'));
  }

  // ── backward-compat content endpoints ────────────────────────────────────────
  if ((urlPath === '/api/facebook-content' || urlPath === '/api/ig-content') && method === 'GET') {
    const params   = new URLSearchParams(req.url.split('?')[1] || '');
    const slug     = params.get('slug');
    const platform = urlPath.includes('facebook') ? 'facebook' : 'instagram';
    if (!slug) { res.writeHead(400); return res.end('Missing slug'); }
    const filePath = path.join(NEWS_DIR, slug, 'content', platform + '.md');
    if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(fs.readFileSync(filePath, 'utf8'));
  }

  // ── GET /api/log ─────────────────────────────────────────────────────────────
  if (urlPath === '/api/log' && method === 'GET') {
    if (!fs.existsSync(LOG_FILE)) { res.writeHead(404); return res.end('No log'); }
    const lines   = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
    const last100 = lines.slice(-100).join('\n');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(last100);
  }

  // ── POST /api/run-agent ───────────────────────────────────────────────────────
  if (urlPath === '/api/run-agent' && method === 'POST') {
    const body   = await readBody(req);
    const result = runAgent(body.agent || '', body.args || []);
    res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(result));
  }

  // ── GET /api/agent-log?agent= ─────────────────────────────────────────────────
  if (urlPath === '/api/agent-log' && method === 'GET') {
    const params  = new URLSearchParams(req.url.split('?')[1] || '');
    const agentId = params.get('agent');
    const running = !!runningAgents[agentId];
    const log     = getAgentLog(agentId);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ running, log }));
  }

  // ── legacy generate-force ─────────────────────────────────────────────────────
  if ((urlPath === '/api/generate-force' || urlPath === '/dashboard/manao/api/generate-image') && method === 'POST') {
    const body = await readBody(req);
    const slug  = body.slug;
    if (!slug) { res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'Missing slug' })); }
    // trigger editor + formatter for this slug
    const result = runAgent('editor', ['--force', '--date', '']);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, log: `รัน editor-agent สำหรับ ${slug}` }));
  }

  // ── legacy request-approval ───────────────────────────────────────────────────
  if (urlPath === '/dashboard/manao/api/request-approval' && method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: false, error: 'ใช้ generate.js --resend แทน' }));
  }

  // ── news image ────────────────────────────────────────────────────────────────
  if (urlPath.startsWith('/dashboard/manao/news-image/')) {
    const slug     = decodeURIComponent(urlPath.replace('/dashboard/manao/news-image/', ''));
    const imgPath  = path.join(NEWS_DIR, slug, 'image.jpg');
    if (!fs.existsSync(imgPath)) { res.writeHead(404); return res.end('No image'); }
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    return res.end(fs.readFileSync(imgPath));
  }

  // ── GET /api/config ── อ่านค่าตั้ง filter + formatter ────────────────────────
  if (urlPath === '/api/config' && method === 'GET') {
    const cfg = loadConfig();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({ filter: cfg.filter, formatter: cfg.formatter }));
  }

  // ── POST /api/config ── บันทึกค่าตั้ง (เขียนทับ config.json) ──────────────────
  if (urlPath === '/api/config' && method === 'POST') {
    try {
      const body = await readBody(req);

      // อ่าน config.json ปัจจุบัน (เก็บ _comment ไว้) — ถ้าไม่มีก็เริ่มจาก loadConfig
      let cur = {};
      try { cur = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { cur = loadConfig(); }
      cur.filter    = cur.filter    || {};
      cur.formatter = cur.formatter || {};

      const f = body.filter || {};
      if (f.minScore !== undefined) cur.filter.minScore = clampInt(f.minScore, 0, 100);
      if (f.weights) {
        cur.filter.weights = cur.filter.weights || {};
        ['high','medium','low'].forEach(k => {
          if (f.weights[k] !== undefined) cur.filter.weights[k] = clampInt(f.weights[k], 0, 1000);
        });
      }
      if (f.labels) {
        cur.filter.labels = cur.filter.labels || {};
        ['ai_tech','ai_biz','ai_policy'].forEach(k => {
          if (f.labels[k] !== undefined) cur.filter.labels[k] = clampInt(f.labels[k], 0, 100);
        });
      }
      if (f.keywords) {
        cur.filter.keywords = cur.filter.keywords || {};
        ['high','medium','low'].forEach(k => {
          if (Array.isArray(f.keywords[k]))
            cur.filter.keywords[k] = f.keywords[k].map(s => String(s).trim().toLowerCase()).filter(Boolean);
        });
      }

      const fm = body.formatter || {};
      if (Array.isArray(fm.skipStatus))
        cur.formatter.skipStatus = fm.skipStatus.map(s => String(s).trim()).filter(Boolean);
      if (fm.minScore !== undefined) cur.formatter.minScore = clampInt(fm.minScore, 0, 100);
      if (Array.isArray(fm.skipPlatforms))
        cur.formatter.skipPlatforms = fm.skipPlatforms.map(s => String(s).trim().toLowerCase()).filter(Boolean);

      fs.writeFileSync(CONFIG_FILE, JSON.stringify(cur, null, 2), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  // ── Serve dashboard.html ───────────────────────────────────────────────────────
  if (urlPath === '/' || urlPath === '/index.html') {
    if (!fs.existsSync(HTML_FILE)) { res.writeHead(500); return res.end('dashboard.html not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(HTML_FILE, 'utf8'));
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🍋 มะนาว — AI News Dashboard`);
  console.log(`   URL       : http://localhost:${PORT}`);
  console.log(`   API data  : http://localhost:${PORT}/api/data`);
  console.log(`   Agent Hub : http://localhost:${PORT}/api/run-agent`);
  console.log(`\n   กด Ctrl+C เพื่อหยุด\n`);
});
