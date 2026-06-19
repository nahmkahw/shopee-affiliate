'use strict';
/**
 * lib/namkhao-bot-status.js — buildStatusMessage + checkConnections สำหรับ namkhao bot
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');

function readLog(root, agentName, n = 10) {
  const f = path.join(root, 'agents', agentName, `${agentName}.log`);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim()).slice(-n);
}

function timeSince(isoStr) {
  if (!isoStr) return 'ไม่ทราบ';
  const diff = Date.now() - new Date(isoStr).getTime();
  const h    = Math.floor(diff / 3600000);
  const m    = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h} ชม. ${m} นาทีที่แล้ว` : `${m} นาทีที่แล้ว`;
}

function buildStatusMessage(root, statusFile) {
  const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  let msg   = `🤖 <b>สถานะ Agent ทั้งหมด</b>\n📅 ${now}\n${'─'.repeat(30)}\n\n`;

  let s = { mali: {}, manao: {}, namkhao: {} };
  try { s = JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch {}

  const mali     = s.mali || {};
  const maliIcon = mali.status === 'running' ? '🟡' : mali.status === 'error' ? '🔴' : '🟢';
  msg += `${maliIcon} <b>มะลิ</b> (Shopee Affiliate)\n`;
  msg += `   สถานะ: ${mali.status || 'idle'}\n`;
  msg += `   ล่าสุด: ${timeSince(mali.lastRun)}\n`;
  msg += `   ผล: ${mali.lastResult || '-'}\n`;

  try {
    const today   = new Date().toISOString().slice(0, 10);
    const prodDir = path.join(root, 'products');
    const dirs    = fs.readdirSync(prodDir).filter(d => fs.existsSync(path.join(prodDir, d, 'data.json')));
    let todayCount = 0, postedToday = 0, totalPosted = 0;
    dirs.forEach(id => {
      const d = JSON.parse(fs.readFileSync(path.join(prodDir, id, 'data.json'), 'utf8'));
      if (d.status === 'placeholder') return;
      if (d.status === 'posted') totalPosted++;
      if (d.post_date === today) { todayCount++; if (d.status === 'posted') postedToday++; }
    });
    msg += `   วันนี้: ${todayCount} รายการ (โพสต์แล้ว ${postedToday}) | รวม: ${totalPosted} รายการ\n`;
  } catch {}

  const maliErrs = readLog(root, 'mali', 20).filter(l => l.includes('❌') || l.includes('[ERROR]'));
  if (maliErrs.length) {
    msg += `   ⚠️ Error ล่าสุด:\n`;
    maliErrs.slice(-2).forEach(l => msg += `   <code>${l.trim().substring(0, 80)}</code>\n`);
  }
  msg += '\n';

  const manao     = s.manao || {};
  const manaoIcon = manao.status === 'running' ? '🟡' : manao.status === 'error' ? '🔴' : '🟢';
  msg += `${manaoIcon} <b>มะนาว</b> (Reuters AI News)\n`;
  msg += `   สถานะ: ${manao.status || 'idle'}\n`;
  msg += `   ล่าสุด: ${timeSince(manao.lastRun)}\n`;
  msg += `   ผล: ${manao.lastResult || '-'}\n`;

  try {
    const pipeLog = path.join(root, 'agents', 'manao', 'pipeline', 'pipeline.log');
    if (fs.existsSync(pipeLog)) {
      const pLines     = fs.readFileSync(pipeLog, 'utf8').split('\n').filter(l => l.trim()).slice(-15);
      const lastHeader = [...pLines].reverse().find(l => l.includes('=== เริ่ม Pipeline'));
      const lastFooter = [...pLines].reverse().find(l => l.includes('=== Pipeline'));
      if (lastHeader) msg += `   Pipeline เริ่ม: ${lastHeader.split(' ')[0]} ${lastHeader.split(' ')[1]}\n`;
      if (lastFooter) msg += `   Pipeline สิ้นสุด: ${lastFooter.includes('เสร็จ') ? '✅ สำเร็จ' : '❌ ล้มเหลว'}\n`;
      const pipeErrs = pLines.filter(l => l.includes('[ERROR]') || l.includes('ETIMEDOUT'));
      if (pipeErrs.length) msg += `   ⚠️ Error: <code>${pipeErrs[pipeErrs.length - 1].trim().substring(0, 80)}</code>\n`;
    }
  } catch {}

  const namkhao = s.namkhao || {};
  msg += `\n🟢 <b>น้ำข้าว</b> (Supervisor)\n`;
  msg += `   Monitor ล่าสุด: ${timeSince(namkhao.lastRun)}\n`;
  msg += `   ผล: ${namkhao.lastResult || '-'}\n`;
  msg += `\n${'─'.repeat(30)}\n`;
  msg += `💡 พิมพ์ <b>checkagent</b> เพื่อตรวจสอบใหม่ | <b>menu</b> เพื่อสั่งงาน`;

  return msg;
}

function httpGetRaw(url, headers = {}, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : http;
    const req    = lib.request({
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

async function checkConnections(token, pipeEnv) {
  const checks = [
    { icon: '📱', name: 'Telegram API', check: async () => {
        const r = await httpGetRaw(`https://api.telegram.org/bot${token}/getMe`);
        if (!r.ok) return `HTTP ${r.status}`;
        const j = JSON.parse(r.body); return j.ok ? null : j.description;
    }},
    { icon: '🤖', name: 'Ollama Server', check: async () => {
        const host = (pipeEnv.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
        const r    = await httpGetRaw(`${host}/api/tags`);
        return r.ok ? null : `ไม่ตอบสนอง — ${host}`;
    }},
    { icon: '📘', name: 'Facebook API', check: async () => {
        if (!pipeEnv.FB_PAGE_ID || !pipeEnv.FB_ACCESS_TOKEN) return 'ไม่มี credentials';
        const r = await httpGetRaw(`https://graph.facebook.com/v19.0/${pipeEnv.FB_PAGE_ID}?fields=id&access_token=${pipeEnv.FB_ACCESS_TOKEN}`);
        if (!r.ok) { try { return JSON.parse(r.body).error?.message || `HTTP ${r.status}`; } catch { return `HTTP ${r.status}`; } }
        return null;
    }},
    { icon: '📸', name: 'Instagram API', check: async () => {
        if (!pipeEnv.IG_USER_ID || !pipeEnv.IG_ACCESS_TOKEN) return 'ไม่มี credentials';
        const r = await httpGetRaw(`https://graph.facebook.com/v19.0/${pipeEnv.IG_USER_ID}?fields=id&access_token=${pipeEnv.IG_ACCESS_TOKEN}`);
        if (!r.ok) { try { return JSON.parse(r.body).error?.message || `HTTP ${r.status}`; } catch { return `HTTP ${r.status}`; } }
        return null;
    }},
    { icon: '🎨', name: 'ComfyUI (Image)', check: async () => {
        const r = await httpGetRaw('http://10.3.17.118:8188/system_stats');
        return r.ok ? null : 'ไม่ตอบสนอง — 10.3.17.118:8188';
    }},
    { icon: '📡', name: 'Google News RSS', check: async () => {
        const r = await httpGetRaw('https://news.google.com/rss/search?q=artificial+intelligence&hl=en-US&gl=US&ceid=US:en');
        if (!r.ok) return `HTTP ${r.status}`;
        return r.body.includes('<rss') || r.body.includes('<channel') ? null : 'ไม่ได้รับ RSS feed';
    }},
  ];

  const results = [];
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

module.exports = { readLog, timeSince, buildStatusMessage, httpGetRaw, checkConnections };
