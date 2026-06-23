'use strict';
/**
 * agent-hub/routes/maprang.js
 * exports register(req, res, url, rawUrl, method, deps)
 * Routes: /dashboard/maprang  |  /api/maprang/generate  |  /api/maprang/status
 *         /dashboard/maprang/video/{id}
 */

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function reply(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function getBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve({}); } });
  });
}

function getGallery(ROOT) {
  const galleryDir = path.join(ROOT, 'agents', 'maprang', 'gallery');
  if (!fs.existsSync(galleryDir)) return [];
  return fs.readdirSync(galleryDir)
    .sort().reverse()
    .slice(0, 20)
    .map(id => {
      const metaPath = path.join(galleryDir, id, 'meta.json');
      if (!fs.existsSync(metaPath)) return null;
      try { return { id, ...JSON.parse(fs.readFileSync(metaPath, 'utf8')) }; } catch { return null; }
    })
    .filter(Boolean);
}

function renderDashboard(ROOT) {
  const gallery = getGallery(ROOT);
  const rows = gallery.map(m => {
    const hasVideo = fs.existsSync(path.join(ROOT, 'agents', 'maprang', 'gallery', m.id, 'story.mp4'));
    const statusEmoji = { generating: '⏳', pending_approval: '📱', posted: '✅', error: '❌' }[m.status] || '❓';
    return `
      <tr>
        <td style="padding:8px;font-size:12px;color:#888">${m.id}</td>
        <td style="padding:8px">${statusEmoji} ${m.status}</td>
        <td style="padding:8px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.prompt || ''}</td>
        <td style="padding:8px">${m.scenes?.length || 0} scenes</td>
        <td style="padding:8px">${hasVideo ? `<a href="/dashboard/maprang/video/${m.id}" target="_blank">▶ ดูวิดีโอ</a>` : '—'}</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>มะปราง — Anime Story Video</title>
  <style>
    body { font-family: sans-serif; background: #0f0f0f; color: #eee; margin: 0; padding: 24px; }
    h1 { color: #a855f7; margin: 0 0 4px }
    .subtitle { color: #888; font-size: 14px; margin-bottom: 24px }
    .card { background: #1a1a2e; border: 1px solid #333; border-radius: 12px; padding: 20px; margin-bottom: 20px }
    textarea { width: 100%; background: #111; color: #eee; border: 1px solid #444; border-radius: 8px; padding: 12px; font-size: 14px; resize: vertical; box-sizing: border-box }
    button { background: #a855f7; color: white; border: none; border-radius: 8px; padding: 10px 24px; font-size: 15px; cursor: pointer; margin-top: 8px }
    button:disabled { background: #555; cursor: not-allowed }
    #status-msg { margin-top: 12px; font-size: 13px; color: #a855f7 }
    table { width: 100%; border-collapse: collapse }
    th { text-align: left; padding: 8px; color: #888; font-size: 13px; border-bottom: 1px solid #333 }
    tr:hover td { background: #1e1e3f }
    a { color: #a855f7 }
  </style>
</head>
<body>
  <h1>🎌 Agent มะปราง</h1>
  <div class="subtitle">Anime Story Video Generator — ComfyUI Wan2.1 T2V-1.3B</div>

  <div class="card">
    <h3 style="margin:0 0 12px">สร้างวิดีโอใหม่</h3>
    <textarea id="prompt" rows="4" placeholder="ใส่ story prompt ภาษาไทย เช่น: เด็กหญิงตัวเล็กค้นพบประตูวิเศษในป่าลึก และได้พบกับสัตว์แฟนตาซีที่กลายเป็นเพื่อนรัก"></textarea>
    <br>
    <button id="btn-generate" onclick="generate()">🎬 สร้างวิดีโอ (≈ 30–50 นาที)</button>
    <button onclick="checkComfy()" style="background:#333;margin-left:8px">🔍 ตรวจ ComfyUI</button>
    <div id="status-msg"></div>
  </div>

  <div class="card">
    <h3 style="margin:0 0 12px">Gallery (${gallery.length} รายการ)</h3>
    <table>
      <thead><tr><th>ID</th><th>สถานะ</th><th>Prompt</th><th>Scenes</th><th>วิดีโอ</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="padding:16px;color:#555">ยังไม่มีวิดีโอ</td></tr>'}</tbody>
    </table>
  </div>

  <script>
    async function generate() {
      const prompt = document.getElementById('prompt').value.trim();
      if (!prompt) { alert('กรุณาใส่ story prompt'); return; }
      const btn = document.getElementById('btn-generate');
      const msg = document.getElementById('status-msg');
      btn.disabled = true;
      msg.textContent = '⏳ กำลังส่งคำสั่ง... (กระบวนการใช้เวลา 30–50 นาที ติดตามผ่าน Telegram)';
      try {
        const r = await fetch('/api/maprang/generate', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ prompt }) });
        const j = await r.json();
        if (j.ok) { msg.textContent = '✅ เริ่มแล้ว! ID: ' + j.id + ' — ดูผลใน Telegram'; setTimeout(() => location.reload(), 3000); }
        else       { msg.textContent = '❌ ' + j.error; btn.disabled = false; }
      } catch(e) { msg.textContent = '❌ ' + e.message; btn.disabled = false; }
    }
    async function checkComfy() {
      const msg = document.getElementById('status-msg');
      msg.textContent = '⏳ กำลังตรวจสอบ...';
      const r = await fetch('/api/maprang/check');
      const j = await r.json();
      msg.textContent = j.online ? ('✅ ComfyUI online' + (j.wan21 ? ' | Wan2.1 ✅' : ' | Wan2.1 ❌ ยังไม่ได้ติดตั้ง')) : '❌ ComfyUI ไม่ตอบสนอง';
    }
  </script>
</body>
</html>`;
}

function register(req, res, url, rawUrl, method, deps) {
  const { ROOT } = deps;

  if (url === '/dashboard/maprang') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderDashboard(ROOT));
  }

  // serve video file
  const videoMatch = url.match(/^\/dashboard\/maprang\/video\/([\w]+)$/);
  if (videoMatch) {
    const vp = path.join(ROOT, 'agents', 'maprang', 'gallery', videoMatch[1], 'story.mp4');
    if (!fs.existsSync(vp)) { res.writeHead(404); return res.end('ไม่พบวิดีโอ'); }
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': fs.statSync(vp).size });
    return fs.createReadStream(vp).pipe(res);
  }

  // API: check ComfyUI
  if (url === '/api/maprang/check' && method === 'GET') {
    const { checkHealth, checkWan21Model } = require('../agents/maprang/pipeline/comfy-client');
    const cfg = { host: process.env.COMFY_HOST || '10.3.17.118', port: parseInt(process.env.COMFY_PORT || '8188', 10) };
    checkHealth(cfg).then(online => {
      if (!online) return reply(res, 200, { ok: true, online: false, wan21: false });
      return checkWan21Model(cfg).then(({ found }) => reply(res, 200, { ok: true, online: true, wan21: found }));
    }).catch(e => reply(res, 200, { ok: false, error: e.message }));
    return;
  }

  // API: generate
  if (url === '/api/maprang/generate' && method === 'POST') {
    getBody(req).then(body => {
      const prompt = (body.prompt || '').trim();
      if (!prompt) return reply(res, 400, { ok: false, error: 'ต้องระบุ prompt' });

      const id = Date.now().toString();
      reply(res, 200, { ok: true, id });

      // spawn run.js ใน background (ไม่ block HTTP response)
      const runScript = path.join(ROOT, 'agents', 'maprang', 'run.js');
      const proc = spawn(process.execPath, [runScript, '--action', 'generate', '--prompt', prompt], {
        cwd: ROOT, stdio: 'inherit',
        env: { ...process.env },
        detached: false,
      });
      proc.on('exit', code => console.log(`[maprang] run.js exit: ${code}`));
    });
    return;
  }

  // API: status
  if (url === '/api/maprang/status' && method === 'GET') {
    reply(res, 200, { ok: true, gallery: getGallery(ROOT) });
    return;
  }
}

module.exports = { register };
