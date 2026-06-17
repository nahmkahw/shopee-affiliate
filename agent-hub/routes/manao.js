'use strict';
/**
 * agent-hub/routes/manao.js
 * exports register(req, res, url, rawUrl, method, deps)
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { serveNewsHTML } = require('../html/manao');

function readNewsEnv() {
  try {
    const envFile = path.join(AI_NEWS_DIR, '.env');
    const lines   = fs.readFileSync(envFile, 'utf8').split('\n');
    const env     = {};
    for (const line of lines) {
      const m = line.match(/^\s*([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return env;
  } catch { return {}; }
}

function tgRequest(token, method, body) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) },
      rejectUnauthorized: false,
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error('TG parse error')); } });
    });
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Telegram timeout')); });
    req.on('error', reject);
    req.write(json);
    req.end();
  });
}

function tgEscape(t = '') {
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// multipart/form-data upload ภาพไปยัง Telegram sendPhoto
function sendPhotoToTelegram(token, chatId, imagePath, caption, keyboard) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const boundary   = 'TGBound' + crypto.randomBytes(8).toString('hex');
    const imgBuffer  = fs.readFileSync(imagePath);
    const filename   = path.basename(imagePath);

    const addField = (name, value) =>
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);

    const parts = [
      addField('chat_id',    String(chatId)),
      addField('parse_mode', 'HTML'),
    ];
    if (caption)  parts.push(addField('caption', caption));
    if (keyboard) parts.push(addField('reply_markup', JSON.stringify(keyboard)));

    const photoHead = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`
    );
    const body = Buffer.concat([...parts, photoHead, imgBuffer, Buffer.from(`\r\n--${boundary}--\r\n`)]);

    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendPhoto`,
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
      rejectUnauthorized: false,
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error('TG photo parse: ' + buf.substring(0,100))); } });
    });
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Photo upload timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendTelegramApproval(slug, platform) {
  const env    = readNewsEnv();
  const token  = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('ไม่พบ TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID ใน .env');

  const dataPath = path.join(AI_NEWS_DIR, 'news', slug, 'data.json');
  const fbPath   = path.join(AI_NEWS_DIR, 'news', slug, 'content', 'facebook.md');
  const igPath   = path.join(AI_NEWS_DIR, 'news', slug, 'content', 'instagram.md');
  const imgPath  = path.join(AI_NEWS_DIR, 'news', slug, 'image.jpg');

  if (!fs.existsSync(dataPath)) throw new Error(`ไม่พบ news/${slug}/data.json`);

  const data       = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const includesIG = platform === 'ig' || platform === 'fb,ig';
  const includesFB = platform === 'fb' || platform === 'fb,ig';

  // รูปถูก Generate แยกก่อนแล้ว (จากปุ่ม Generate ใน Modal) — ไม่ generate ซ้ำที่นี่

  const hasImage = fs.existsSync(imgPath);

  // ── shortId → queue ───────────────────────────────────────────────────────────
  const shortId   = crypto.createHash('md5').update(slug).digest('hex').substring(0, 12);
  const queueFile = path.join(AI_NEWS_DIR, '_tg_queue.json');
  const queue     = (() => { try { return JSON.parse(fs.readFileSync(queueFile, 'utf8')); } catch { return {}; } })();
  queue[shortId]  = { slug, platform };
  fs.writeFileSync(queueFile, JSON.stringify(queue, null, 2), 'utf8');

  // ── Build message parts ───────────────────────────────────────────────────────
  const title    = tgEscape(data.title || slug);
  const date     = (data.published_at || data.scraped_at || '').substring(0, 10);
  const pfLabels = { fb: '📘 Facebook', ig: '📸 Instagram', 'fb,ig': '📘 Facebook + 📸 Instagram' };
  const pfLabel  = pfLabels[platform] || platform;

  const keyboard = {
    inline_keyboard: [[
      { text: '✅ อนุมัติ & โพสต์', callback_data: `approve:${shortId}` },
      { text: '🔄 สร้างใหม่',       callback_data: `regen:${shortId}`   },
      { text: '❌ ยกเลิก',           callback_data: `cancel:${shortId}`  },
    ]],
  };

  // ── ส่งไปยัง Telegram ─────────────────────────────────────────────────────────
  if (hasImage) {
    // --- ส่งรูป (sendPhoto) พร้อม caption ทุก platform ---
    const fbContent = fs.existsSync(fbPath) ? fs.readFileSync(fbPath, 'utf8') : '';
    const igContent = fs.existsSync(igPath) ? fs.readFileSync(igPath, 'utf8') : '';

    // สร้าง caption: แสดง content preview ตาม platform ที่เลือก (Telegram limit 1024 chars)
    const captionLines = [
      `📰 <b>รอ Approve ก่อนโพสต์</b>`,
      `🗞 ${title}`,
      `📅 ${date} | 🎯 ${pfLabel}`,
      ``,
    ];
    if (includesFB && fbContent) {
      const fbPreview = tgEscape(fbContent.substring(0, 350)) + (fbContent.length > 350 ? '\n...' : '');
      captionLines.push(`📘 <b>Facebook:</b>`, fbPreview);
      if (includesIG) captionLines.push('');  // spacer
    }
    if (includesIG && igContent) {
      const igPreview = tgEscape(igContent.substring(0, 300)) + (igContent.length > 300 ? '\n...' : '');
      captionLines.push(`📸 <b>Instagram:</b>`, igPreview);
    }
    const photoCaption = captionLines.join('\n').substring(0, 1024);

    const photoRes = await sendPhotoToTelegram(token, chatId, imgPath, photoCaption, keyboard);
    if (!photoRes.ok) throw new Error('Telegram sendPhoto: ' + JSON.stringify(photoRes).substring(0, 200));

  } else {
    // --- ส่งข้อความ (ไม่มีรูป — fallback) ---
    const fbContent = fs.existsSync(fbPath) ? fs.readFileSync(fbPath, 'utf8') : '';
    const fbPreview = tgEscape(fbContent.substring(0, 700)) + (fbContent.length > 700 ? '\n...' : '');

    const lines = [
      `📰 <b>รอ Approve ก่อนโพสต์</b>`,
      `─────────────────────────`,
      `🗞 ${title}`,
      `📅 ${date}`,
      `🎯 โพสต์ไปที่: <b>${pfLabel}</b>`,
      `⚠️ <i>ไม่พบรูป Generate — โพสต์โดยไม่มีรูป</i>`,
    ];
    if (fbContent) {
      lines.push('', `📝 <b>Facebook Content Preview:</b>`, fbPreview);
    }
    lines.push(`─────────────────────────`, `กด ✅ เพื่อ Approve และโพสต์ทันที`);

    const res = await tgRequest(token, 'sendMessage', {
      chat_id: chatId, text: lines.join('\n'), parse_mode: 'HTML', reply_markup: keyboard,
    });
    if (!res.ok) throw new Error('Telegram API: ' + JSON.stringify(res).substring(0, 200));
  }

  // ── อัปเดต status ─────────────────────────────────────────────────────────────
  data.status       = 'pending_approval';
  data.pending_since = new Date().toISOString();
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');

  return { shortId, platform, hasImage };
}

function getNewsItems() {
  const newsDir = path.join(AI_NEWS_DIR, 'news');
  if (!fs.existsSync(newsDir)) return [];
  return fs.readdirSync(newsDir)
    .filter(d => fs.existsSync(path.join(newsDir, d, 'data.json')))
    .map(slug => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(newsDir, slug, 'data.json'), 'utf8'));
        const cDir = path.join(newsDir, slug, 'content');
        return {
          slug,
          title: data.title || slug,
          url: data.url || '',
          status: data.status || 'scraped',
          published_at: data.published_at || '',
          scraped_at: data.scraped_at || '',
          posted_at: data.posted_at || '',
          pending_since: data.pending_since || '',
          og_image: data.og_image || '',
          hasFB: fs.existsSync(path.join(cDir, 'facebook.md')),
          hasIG: fs.existsSync(path.join(cDir, 'instagram.md')),
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (b.scraped_at || '').localeCompare(a.scraped_at || ''));
}

function getNewsBotStatus() {
  try {
    const pidFile = path.join(AI_NEWS_DIR, 'telegram-bot.pid');
    if (!fs.existsSync(pidFile)) return { running: false, pid: null };
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
    if (isNaN(pid)) return { running: false, pid: null };
    try { process.kill(pid, 0); return { running: true, pid }; } catch { return { running: false, pid }; }
  } catch { return { running: false, pid: null }; }
}

function getNewsPipelineInfo() {
  try {
    const logFile = path.join(AI_NEWS_DIR, 'pipeline.log');
    if (!fs.existsSync(logFile)) return { last_run: null };
    let content = fs.readFileSync(logFile, 'utf8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    const lines = content.split('\n').filter(Boolean);
    const startLines  = lines.filter(l => l.includes('=== เริ่ม Pipeline ==='));
    const finishLines = lines.filter(l => l.includes('=== Pipeline เสร็จแล้ว'));
    return {
      last_run:    startLines.length  ? startLines[startLines.length-1].replace(/[\r﻿]/g,'').substring(0,19) : null,
      last_finish: finishLines.length ? finishLines[finishLines.length-1].replace(/[\r﻿]/g,'').substring(0,19) : null,
      log_lines: lines.length,
    };
  } catch { return { last_run: null }; }
}

function buildNewsApiData() {
  const items = getNewsItems();
  const counts = { scraped:0, draft:0, pending_approval:0, scheduled:0, posted:0 };
  for (const item of items) { const s = item.status||'scraped'; if (counts[s]!==undefined) counts[s]++; else counts.scraped++; }

  const agentDefs = [
    { id: 'scrape',    name: 'Scraper (Reuters)',  icon: '🌐' },
    { id: 'filter',    name: 'Filter Agent',        icon: '🔍' },
    { id: 'editor',    name: 'Editor Agent',         icon: '✍️' },
    { id: 'formatter', name: 'Formatter Agent',      icon: '📱' },
  ];
  const agentsStatus = agentDefs.map(def => ({
    ...def,
    running: pipelineProcs[def.id] !== null,
    pending: null,
  }));

  return {
    generated_at: new Date().toISOString(),
    stats: { total: items.length, by_status: counts },
    bot: getNewsBotStatus(),
    pipeline: getNewsPipelineInfo(),
    news: items,
    hub: {
      pipeline_running: pipelineProcs.pipeline !== null || agentDefs.some(d => pipelineProcs[d.id] !== null),
      agents: agentsStatus,
    },
  };
}

function register(req, res, url, rawUrl, method, deps) {
  const { AI_NEWS_DIR, pipelineProcs, pipelineStatus, runPipelineSequential } = deps;

    // ── Dashboard: มะนาว (AI News) HTML ────────────────────────────────────────
    if (url === '/dashboard/manao') {
      serveNewsHTML(res);
      return;
    }
  
    // ── Dashboard API: มะนาว /api/data ──────────────────────────────────────────
    if (url.startsWith('/dashboard/manao/api/data')) {
      const data = JSON.stringify(buildNewsApiData(), null, 2);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
      res.end(data);
      return;
    }
  
    // ── Dashboard API: มะนาว /api/config (GET) ──────────────────────────────────
    if (url === '/dashboard/manao/api/config' && method === 'GET') {
      try {
        const cfgFile = path.join(AI_NEWS_DIR, 'config.json');
        const raw = fs.readFileSync(cfgFile, 'utf8');
        const cfg = JSON.parse(raw);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(JSON.stringify({ filter: cfg.filter || {}, formatter: cfg.formatter || {} }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    }
  
    // ── Dashboard API: มะนาว /api/config (POST) ─────────────────────────────────
    if (url === '/dashboard/manao/api/config' && method === 'POST') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const incoming = JSON.parse(body || '{}');
          const cfgFile  = path.join(AI_NEWS_DIR, 'config.json');
          const clampInt = (v, min, max) => {
            let n = parseInt(v, 10); if (isNaN(n)) n = min;
            return Math.max(min, Math.min(max, n));
          };
  
          // อ่าน config.json ปัจจุบัน (เก็บ _comment ไว้)
          let cur = {};
          try { cur = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch {}
          cur.filter    = cur.filter    || {};
          cur.formatter = cur.formatter || {};
  
          const f = incoming.filter || {};
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
  
          const fm = incoming.formatter || {};
          if (Array.isArray(fm.skipStatus))
            cur.formatter.skipStatus = fm.skipStatus.map(s => String(s).trim()).filter(Boolean);
          if (fm.minScore !== undefined) cur.formatter.minScore = clampInt(fm.minScore, 0, 100);
          if (Array.isArray(fm.skipPlatforms))
            cur.formatter.skipPlatforms = fm.skipPlatforms.map(s => String(s).trim().toLowerCase()).filter(Boolean);
  
          fs.writeFileSync(cfgFile, JSON.stringify(cur, null, 2), 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
  
    // ── Dashboard API: มะนาว /api/log ───────────────────────────────────────────
    if (url.startsWith('/dashboard/manao/api/log')) {
      const logFile = path.join(AI_NEWS_DIR, 'pipeline.log');
      if (!fs.existsSync(logFile)) { res.writeHead(404); return res.end('No log'); }
      const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(lines.slice(-100).join('\n'));
    }
  
    // ── Dashboard API: มะนาว facebook/ig content ───────────────────────────────
    if (url.startsWith('/dashboard/manao/api/facebook-content') || url.startsWith('/dashboard/manao/api/ig-content')) {
      const params   = new URLSearchParams(rawUrl.split('?')[1] || '');
      const slug     = params.get('slug');
      const platform = url.includes('facebook') ? 'facebook' : 'instagram';
      if (!slug) { res.writeHead(400); return res.end('Missing slug'); }
      const filePath = path.join(AI_NEWS_DIR, 'news', slug, 'content', platform + '.md');
      if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(fs.readFileSync(filePath, 'utf8'));
    }
  
    // ── Dashboard API: มะนาว GET /news-image/:slug ─────────────────────────────
    const newsImgMatch = url.match(/^\/dashboard\/manao\/news-image\/(.+)$/);
    if (newsImgMatch) {
      const slug    = decodeURIComponent(newsImgMatch[1]);
      const imgPath = path.join(AI_NEWS_DIR, 'news', slug, 'image.jpg');
      if (!fs.existsSync(imgPath)) { res.writeHead(404); return res.end('No image'); }
      const img = fs.readFileSync(imgPath);
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': img.length, 'Cache-Control': 'no-cache' });
      return res.end(img);
    }
  
    // ── Dashboard API: มะนาว POST /api/generate-image ──────────────────────────
    if (url === '/dashboard/manao/api/generate-image' && method === 'POST') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', async () => {
        const { slug } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        if (!slug) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Missing slug' }));
        }
        const dataPath = path.join(AI_NEWS_DIR, 'news', slug, 'data.json');
        if (!fs.existsSync(dataPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: `ไม่พบ news/${slug}/data.json` }));
        }
        try {
          const { execFileSync } = require('child_process');
          console.log(`[Hub] 🎨 Generate image: ${slug}`);
          const out = execFileSync(process.execPath,
            [path.join(AI_NEWS_DIR, 'comfy-gen.js'), slug],
            { cwd: AI_NEWS_DIR, encoding: 'utf8', timeout: 4 * 60 * 1000 }
          );
          const imgPath = path.join(AI_NEWS_DIR, 'news', slug, 'image.jpg');
          const sizeKB  = fs.existsSync(imgPath) ? Math.round(fs.statSync(imgPath).size / 1024) : 0;
          console.log(`[Hub] ✅ Image generated: ${sizeKB} KB`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, sizeKB, message: `Generate สำเร็จ (${sizeKB} KB)` }));
        } catch (e) {
          const errMsg = (e.stdout || e.stderr || e.message || '').substring(0, 300);
          console.log(`[Hub] ❌ Generate failed: ${errMsg.substring(0, 80)}`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: errMsg }));
        }
      });
      return;
    }
  
    // ── Dashboard API: มะนาว POST /api/generate-force ────────────────────────
    // สร้าง content (FB+IG) + รูป ComfyUI ใหม่ทับของเดิม โดยไม่ส่ง Telegram
    if (url === '/dashboard/manao/api/generate-force' && method === 'POST') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', async () => {
        const { slug } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        if (!slug) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Missing slug' }));
        }
        const dataPath = path.join(AI_NEWS_DIR, 'news', slug, 'data.json');
        if (!fs.existsSync(dataPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: `ไม่พบ news/${slug}/data.json` }));
        }
        try {
          const { execFileSync } = require('child_process');
          console.log(`[Hub] 🔄 Generate force: ${slug}`);
          const out = execFileSync(process.execPath,
            [path.join(AI_NEWS_DIR, 'generate.js'), slug, '--force', '--no-telegram'],
            { cwd: AI_NEWS_DIR, encoding: 'utf8', timeout: 10 * 60 * 1000 }  // 10 นาที (Ollama + ComfyUI)
          );
          const imgPath = path.join(AI_NEWS_DIR, 'news', slug, 'image.jpg');
          const hasImg  = fs.existsSync(imgPath);
          const sizeKB  = hasImg ? Math.round(fs.statSync(imgPath).size / 1024) : 0;
          console.log(`[Hub] ✅ Generate force complete: ${slug} img=${hasImg} ${sizeKB}KB`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, hasImage: hasImg, sizeKB, log: out.substring(0, 1000) }));
        } catch (e) {
          const errMsg = (e.stdout || e.stderr || e.message || '').substring(0, 400);
          console.log(`[Hub] ❌ Generate force failed: ${errMsg.substring(0, 80)}`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: errMsg }));
        }
      });
      return;
    }
  
    // ── Dashboard API: มะนาว POST /api/request-approval ───────────────────────
    if (url === '/dashboard/manao/api/request-approval' && method === 'POST') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', async () => {
        const json = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        const { slug, platform } = json;
        if (!slug || !platform) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Missing slug or platform' }));
        }
        try {
          const result = await sendTelegramApproval(slug, platform);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, message: 'ส่งไปยัง Telegram แล้ว รอ Approve', ...result }));
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
  
    // ── Dashboard API: มะนาว POST /api/post ────────────────────────────────────
    if (url === '/dashboard/manao/api/post' && method === 'POST') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', async () => {
        const json = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        const { slug, platform } = json;
        if (!slug || !platform) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Missing slug or platform' }));
        }
        const VALID_PLATFORMS = ['fb', 'ig', 'x', 'fb,ig', 'fb,ig,x', 'fb,x', 'ig,x'];
        if (!VALID_PLATFORMS.includes(platform)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Invalid platform' }));
        }
        const dataPath = path.join(AI_NEWS_DIR, 'news', slug, 'data.json');
        if (!fs.existsSync(dataPath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: `ไม่พบ news/${slug}/data.json` }));
        }
        try {
          const { execFileSync } = require('child_process');
          const postScript = path.join(AI_NEWS_DIR, 'post.js');
          const out = execFileSync(process.execPath,
            [postScript, slug, '--platform', platform],
            { cwd: AI_NEWS_DIR, encoding: 'utf8', timeout: 5 * 60 * 1000 });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, message: 'โพสต์สำเร็จ', output: out.substring(0, 500) }));
        } catch (e) {
          const errMsg = (e.stdout || e.stderr || e.message || '').substring(0, 300);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: errMsg }));
        }
      });
      return;
    }
  
    // ── Dashboard API: มะนาว GET /api/content ──────────────────────────────────
    if (url.startsWith('/dashboard/manao/api/content') && method === 'GET') {
      const params   = new URLSearchParams(rawUrl.split('?')[1] || '');
      const slug     = params.get('slug');
      const platform = params.get('platform');
      if (!slug || !platform) { res.writeHead(400); return res.end('Missing slug or platform'); }
      const pfMap = { fb: 'facebook', ig: 'instagram', x: 'x', tiktok: 'tiktok' };
      const fname = pfMap[platform] || platform;
      const filePath = path.join(AI_NEWS_DIR, 'news', slug, 'content', fname + '.md');
      if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(fs.readFileSync(filePath, 'utf8'));
    }
  
    // ── Dashboard API: มะนาว POST /api/run-agent ────────────────────────────────
    if (url === '/dashboard/manao/api/run-agent' && method === 'POST') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        const json = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        const { agent, args = [] } = json;
        if (!agent) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Missing agent' }));
        }
        if (pipelineProcs.hasOwnProperty(agent) && pipelineProcs[agent] !== null) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: `${agent} กำลังทำงานอยู่แล้ว` }));
        }
        // pipeline → ใช้ sequential runner (step-by-step tracking)
        if (agent === 'pipeline') {
          runPipelineSequential(args);  // async, non-blocking
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, pid: 'pipeline' }));
        }
  
        const scriptMap = {
          scrape:    'scrape.js',
          filter:    path.join('agents', 'filter-agent.js'),
          editor:    path.join('agents', 'editor-agent.js'),
          formatter: path.join('agents', 'formatter-agent.js'),
        };
        const script = scriptMap[agent];
        if (!script) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: `Unknown agent: ${agent}` }));
        }
        const scriptPath = path.join(AI_NEWS_DIR, script);
        if (!fs.existsSync(scriptPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: `ไม่พบ script: ${script}` }));
        }
        const proc = spawn(process.execPath, [scriptPath, ...args], {
          cwd: AI_NEWS_DIR,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        pipelineProcs[agent] = proc.pid;
        const logFile = path.join(AI_NEWS_DIR, 'pipeline.log');
        const ts = () => new Date().toISOString().replace('T',' ').substring(0,19);
        proc.stdout.on('data', d => { try { fs.appendFileSync(logFile, d.toString(), 'utf8'); } catch {} });
        proc.stderr.on('data', d => { try { fs.appendFileSync(logFile, `[ERR] ${d.toString()}`, 'utf8'); } catch {} });
        proc.on('close', code => {
          pipelineProcs[agent] = null;
          try { fs.appendFileSync(logFile, `[${ts()}] ${agent} เสร็จ (exit ${code})\n`, 'utf8'); } catch {}
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, pid: proc.pid }));
      });
      return;
    }
  
    // ── Dashboard API: มะนาว GET /api/pipeline-status ──────────────────────────
    if (url === '/dashboard/manao/api/pipeline-status' && method === 'GET') {
      const st = pipelineStatus || { running: false, steps: [], log: '', startedAt: null, finishedAt: null };
      // ส่ง log 80 บรรทัดล่าสุด (ไม่ส่งทั้งหมดเพื่อลด payload)
      const logLines = (st.log || '').split('\n').filter(Boolean).slice(-80).join('\n');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(JSON.stringify({ ...st, log: logLines }));
    }
  
    // ── Dashboard API: มะนาว GET /api/agent-log ─────────────────────────────────
    if (url.startsWith('/dashboard/manao/api/agent-log') && method === 'GET') {
      const params  = new URLSearchParams(rawUrl.split('?')[1] || '');
      const agentId = params.get('agent');
      const running = pipelineProcs[agentId] !== null;
      const logFile = path.join(AI_NEWS_DIR, 'pipeline.log');
      if (!fs.existsSync(logFile)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ log: '', running }));
      }
      const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).slice(-30);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ log: lines.join('\n'), running }));
    }
  

  return false;
}

module.exports = {
  register,
  readNewsEnv, tgRequest, tgEscape, sendPhotoToTelegram,
  getNewsItems, getNewsBotStatus, getNewsPipelineInfo, buildNewsApiData,
};
