'use strict';
/**
 * lib/namkhao-health.js — HTTP helper, Telegram notify, alert dedup, connection checks
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ─── HTTP helper ──────────────────────────────────────────────────────────────

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

// ─── Telegram notify ─────────────────────────────────────────────────────────

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

// ─── Alert dedup ─────────────────────────────────────────────────────────────

function loadAlerts(alertFile) {
  try { return JSON.parse(fs.readFileSync(alertFile, 'utf8')); } catch { return {}; }
}

function saveAlerts(alertFile, a) {
  try { fs.writeFileSync(alertFile, JSON.stringify(a, null, 2), 'utf8'); } catch {}
}

function shouldAlert(alertFile, key, cooldownMs = 3 * 60 * 60 * 1000) {
  const alerts = loadAlerts(alertFile);
  const last   = alerts[key] || 0;
  if (Date.now() - last > cooldownMs) {
    alerts[key] = Date.now();
    saveAlerts(alertFile, alerts);
    return true;
  }
  return false;
}

// ─── Connection Health Checks ─────────────────────────────────────────────────

async function checkConnections(rootEnv, pipeEnv, log) {
  const issues = [];

  const checks = [
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
    {
      name: '🤖 Ollama Server',
      check: async () => {
        const host = pipeEnv.OLLAMA_HOST || 'http://localhost:11434';
        const r    = await httpGet(host.replace(/\/$/, '') + '/api/tags', {}, 8000);
        if (!r.ok) return `ไม่ตอบสนอง (HTTP ${r.status}) — ${host}`;
        return null;
      },
    },
    {
      name: '📘 Facebook Graph API',
      check: async () => {
        const { FB_PAGE_ID: pageId, FB_ACCESS_TOKEN: token } = pipeEnv;
        if (!pageId || !token) return 'ไม่มี FB_PAGE_ID หรือ FB_ACCESS_TOKEN';
        const r = await httpGet(`https://graph.facebook.com/v19.0/${pageId}?fields=id,name&access_token=${token}`);
        if (!r.ok) {
          try { return JSON.parse(r.body).error?.message || `HTTP ${r.status}`; }
          catch { return `HTTP ${r.status}`; }
        }
        return null;
      },
    },
    {
      name: '📸 Instagram Graph API',
      check: async () => {
        const { IG_USER_ID: igId, IG_ACCESS_TOKEN: token } = pipeEnv;
        if (!igId || !token) return 'ไม่มี IG_USER_ID หรือ IG_ACCESS_TOKEN';
        const r = await httpGet(`https://graph.facebook.com/v19.0/${igId}?fields=id,username&access_token=${token}`);
        if (!r.ok) {
          try { return JSON.parse(r.body).error?.message || `HTTP ${r.status}`; }
          catch { return `HTTP ${r.status}`; }
        }
        return null;
      },
    },
    {
      name: '📡 Google News RSS',
      check: async () => {
        const r = await httpGet('https://news.google.com/rss/search?q=artificial+intelligence&hl=en-US&gl=US&ceid=US:en');
        if (!r.ok) return `HTTP ${r.status}`;
        if (!r.body.includes('<rss') && !r.body.includes('<channel')) return 'ไม่ได้รับ RSS feed';
        return null;
      },
    },
    {
      name: '🎨 ComfyUI (Image Gen)',
      check: async () => {
        const r = await httpGet('http://10.3.17.118:8188/system_stats', {}, 8000);
        if (!r.ok) return `ไม่ตอบสนอง (HTTP ${r.status}) — 10.3.17.118:8188`;
        try {
          JSON.parse(r.body);
          const qr = await httpGet('http://10.3.17.118:8188/queue', {}, 5000);
          if (qr.ok) JSON.parse(qr.body);
        } catch { return 'parse error'; }
        return null;
      },
    },
    {
      name: '🖼️  imgBB API',
      check: async () => {
        const key = pipeEnv.IMGBB_API_KEY;
        if (!key) return 'ไม่มี IMGBB_API_KEY ใน pipeline/.env';
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
                const j    = JSON.parse(buf);
                const msg  = (j.error?.message || '').toLowerCase();
                const keyOk = ['no input', 'empty upload', 'empty source', 'no image'];
                if (keyOk.some(m => msg.includes(m)) || j.error?.code === 310) return resolve(null);
                if (msg.includes('invalid') && msg.includes('key')) return resolve(`API Key ไม่ถูกต้อง: ${j.error.message}`);
                resolve(null);
              } catch { resolve(null); }
            });
          });
          req.setTimeout(10000, () => { req.destroy(); resolve('timeout'); });
          req.on('error', e => resolve(`เชื่อมต่อไม่ได้: ${e.message}`));
          req.write(body); req.end();
        });
      },
    },
  ];

  for (const { name, check } of checks) {
    try {
      const err = await check();
      if (err) { issues.push({ agent: name, level: '🔴', msg: err }); log(`❌ [health] ${name}: ${err}`); }
      else      { log(`✅ [health] ${name}: OK`); }
    } catch (e) {
      issues.push({ agent: name, level: '🔴', msg: e.message.substring(0, 100) });
      log(`❌ [health] ${name}: ${e.message}`);
    }
  }
  return issues;
}

module.exports = { httpGet, sendTelegram, loadAlerts, saveAlerts, shouldAlert, checkConnections };
