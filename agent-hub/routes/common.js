'use strict';
/**
 * agent-hub/routes/common.js
 * exports register(req, res, url, rawUrl, method, deps)
 */

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { buildMainPage, buildAgentPage } = require('../html/main');

async function register(req, res, url, rawUrl, method, deps) {
  const { ROOT, STATUS_FILE, AGENTS, COMFYUI_HOST, COMFYUI_PORT,
          readStatus, readLog, startAgent, stopAgent,
          submitComfyJob, getComfyJobResult, comfyGetBinary,
          STYLE_BASE, GENDER_BASE, OUTFIT_PROMPTS } = deps;

    // ── Avatar (PNG → fallback SVG) ─────────────────────────────────────────────
    const avatarMatch = url.match(/^\/avatar\/(\w+)$/);
    if (avatarMatch) {
      const name    = avatarMatch[1];
      const pngPath = path.join(ROOT, 'agents', name, 'avatar.png');
      const svgPath = path.join(ROOT, 'agents', name, 'avatar.svg');
      if (fs.existsSync(pngPath)) {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
        fs.createReadStream(pngPath).pipe(res);
      } else if (fs.existsSync(svgPath)) {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=3600' });
        fs.createReadStream(svgPath).pipe(res);
      } else { res.writeHead(404); res.end(); }
      return;
    }
  
    // ── API: ComfyUI proxy image ─────────────────────────────────────────────────
    if (url === '/api/comfy-image' && method === 'GET') {
      const params    = new URLSearchParams(rawUrl.split('?')[1] || '');
      const filename  = params.get('filename') || '';
      const subfolder = params.get('subfolder') || '';
      const type      = params.get('type') || 'output';
      const comfyPath = `/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
      try {
        const { data, contentType } = await comfyGetBinary(comfyPath);
        res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
        res.end(data);
      } catch(e) { res.writeHead(502); res.end('ComfyUI error: ' + e.message); }
      return;
    }
  
    // ── API: Generate avatar (submit 4 jobs) ─────────────────────────────────────
    if (url === '/api/generate-avatar' && method === 'POST') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', async () => {
        try {
          const { gender = 'f', outfit = 'นักเรียน' } = JSON.parse(body || '{}');
          const gKey     = gender === 'm' ? 'm' : 'f';
          const outfitTags = (OUTFIT_PROMPTS[outfit] || OUTFIT_PROMPTS['นักเรียน'])[gKey];
          const positive = `${STYLE_BASE}, ${GENDER_BASE[gKey]}, ${outfitTags}`;
  
          // submit 4 jobs concurrently
          const promptIds = await Promise.all([
            submitComfyJob(positive),
            submitComfyJob(positive),
            submitComfyJob(positive),
            submitComfyJob(positive),
          ]);
  
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, promptIds, positive }));
        } catch(e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
  
    // ── API: Poll single avatar job ──────────────────────────────────────────────
    const jobMatch = url.match(/^\/api\/avatar-job\/([a-zA-Z0-9-]+)$/);
    if (jobMatch && method === 'GET') {
      try {
        const result = await getComfyJobResult(jobMatch[1]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'pending' }));
      }
      return;
    }
  
    // ── API: Save selected avatar ────────────────────────────────────────────────
    if (url === '/api/save-avatar' && method === 'POST') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', async () => {
        try {
          const { agentName, filename, subfolder, type } = JSON.parse(body || '{}');
          if (!agentName || !filename) throw new Error('Missing agentName or filename');
          const comfyPath = `/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder||'')}&type=${encodeURIComponent(type||'output')}`;
          const { data }  = await comfyGetBinary(comfyPath);
          const savePath  = path.join(ROOT, 'agents', agentName, 'avatar.png');
          fs.writeFileSync(savePath, data);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, saved: savePath }));
        } catch(e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
  
    // ── API: Reset avatar to SVG (ลบ PNG) ───────────────────────────────────────
    if (url === '/api/reset-avatar' && method === 'POST') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const { agentName } = JSON.parse(body || '{}');
          const pngPath = path.join(ROOT, 'agents', agentName, 'avatar.png');
          if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch(e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
  

    // ── API: GET status ─────────────────────────────────────────────────────────
    if (url === '/api/status' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(readStatus()));
      return;
    }
  
    // ── API: GET logs ───────────────────────────────────────────────────────────
    const logsMatch = url.match(/^\/api\/agent\/(\w+)\/logs$/);
    if (logsMatch && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ lines: readLog(logsMatch[1], 100) }));
      return;
    }
  
    // ── API: POST start ─────────────────────────────────────────────────────────
    const startMatch = url.match(/^\/api\/agent\/(\w+)\/start$/);
    if (startMatch && method === 'POST') {
      const name = startMatch[1];
      if (!AGENTS[name]) { res.writeHead(404); res.end(JSON.stringify({ ok:false, error:'not found' })); return; }
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        const { action = 'status' } = JSON.parse(body || '{}');
        const pid = startAgent(name, action);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, pid }));
      });
      return;
    }
  
    // ── API: POST /api/telegram/restart ────────────────────────────────────────
    if (url === '/api/telegram/restart' && method === 'POST') {
      const botScript = path.join(ROOT, 'agents', 'namkhao', 'telegram-bot.js');
      const pidFile   = path.join(ROOT, 'agents', 'namkhao', 'telegram-bot.pid');
  
      // Kill process เดิม
      if (fs.existsSync(pidFile)) {
        try {
          const oldPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
          if (!isNaN(oldPid)) process.kill(oldPid);
        } catch {}
        try { fs.unlinkSync(pidFile); } catch {}
      }
  
      // รอให้ process เดิมปิดสนิท
      await new Promise(r => setTimeout(r, 1000));
  
      // เริ่ม bot ใหม่
      if (!fs.existsSync(botScript)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'ไม่พบ telegram-bot.js' }));
      }
  
      const bot = spawn(process.execPath, [botScript], {
        cwd: ROOT, detached: true, stdio: 'ignore',
      });
      bot.unref();
      console.log(`🤖 Telegram Bot restart สำเร็จ (PID: ${bot.pid})`);
  
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, pid: bot.pid }));
    }
  
    // ── API: POST stop ──────────────────────────────────────────────────────────
    const stopMatch = url.match(/^\/api\/agent\/(\w+)\/stop$/);
    if (stopMatch && method === 'POST') {
      stopAgent(stopMatch[1]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
  
    // ── API: POST clear-log ─────────────────────────────────────────────────────
    const clearMatch = url.match(/^\/api\/agent\/(\w+)\/clear-log$/);
    if (clearMatch && method === 'POST') {
      const logFile = path.join(ROOT, 'agents', clearMatch[1], `${clearMatch[1]}.log`);
      try { fs.writeFileSync(logFile, '', 'utf8'); } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
  
    // ── Page: Agent detail ──────────────────────────────────────────────────────
    const agentMatch = url.match(/^\/agent\/(\w+)$/);
    if (agentMatch) {
      const name = agentMatch[1];
      if (!AGENTS[name]) { res.writeHead(404); res.end('ไม่พบ Agent'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildAgentPage(name, readStatus(), AGENTS, ROOT, readLog));
      return;
    }
  

    // ── Page: Main ──────────────────────────────────────────────────────────────
    if (url === '/' || url === '/hub') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildMainPage(readStatus(), AGENTS, ROOT));
      return;
    }
  
    res.writeHead(404); res.end('Not found');
}

module.exports = { register };
