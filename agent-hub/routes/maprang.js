'use strict';
/**
 * agent-hub/routes/maprang.js
 * Routes: /dashboard/maprang | /api/maprang/generate | /api/maprang/status
 *         /api/maprang/status/:id | /dashboard/maprang/video/:id
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

function readMeta(ROOT, id) {
  const p = path.join(ROOT, 'agents', 'maprang', 'gallery', id, 'meta.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function getGallery(ROOT) {
  const dir = path.join(ROOT, 'agents', 'maprang', 'gallery');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().reverse().slice(0, 20)
    .map(id => { const m = readMeta(ROOT, id); return m ? { id, ...m } : null; })
    .filter(Boolean);
}

function renderDashboard(ROOT) {
  const gallery = getGallery(ROOT);
  const active  = gallery.find(m => m.status === 'generating' || m.status === 'building');
  const rows = gallery.map(m => {
    const hasVideo  = fs.existsSync(path.join(ROOT, 'agents', 'maprang', 'gallery', m.id, 'story.mp4'));
    const hasRefImg = fs.existsSync(path.join(ROOT, 'agents', 'maprang', 'gallery', m.id, 'char_ref.png'));
    const emoji = { generating: '⏳', building: '🎞️', pending_approval: '📱', posted: '✅', error: '❌' }[m.status] || '❓';
    return `<tr>
      <td style="padding:8px;font-size:12px;color:#888">${m.id}</td>
      <td style="padding:8px">${emoji} ${m.status}</td>
      <td style="padding:8px">${hasRefImg ? `<img src="/dashboard/maprang/refimage/${m.id}" style="width:40px;height:56px;object-fit:cover;border-radius:4px;vertical-align:middle">` : ''}</td>
      <td style="padding:8px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.prompt || ''}</td>
      <td style="padding:8px">${m.scenes?.length || 0} scenes</td>
      <td style="padding:8px">${hasVideo ? `<a href="/dashboard/maprang/video/${m.id}" target="_blank">▶ ดู</a>` : '—'}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8"><title>มะปราง</title>
<style>
  body{font-family:sans-serif;background:#0f0f0f;color:#eee;margin:0;padding:24px}
  h1{color:#a855f7;margin:0 0 4px}.sub{color:#888;font-size:14px;margin-bottom:24px}
  .card{background:#1a1a2e;border:1px solid #333;border-radius:12px;padding:20px;margin-bottom:20px}
  textarea{width:100%;background:#111;color:#eee;border:1px solid #444;border-radius:8px;padding:12px;font-size:14px;resize:vertical;box-sizing:border-box}
  button{background:#a855f7;color:#fff;border:none;border-radius:8px;padding:10px 24px;font-size:15px;cursor:pointer;margin-top:8px}
  button:disabled{background:#555;cursor:not-allowed}
  #msg{margin-top:12px;font-size:13px;color:#a855f7}
  table{width:100%;border-collapse:collapse}th{text-align:left;padding:8px;color:#888;font-size:13px;border-bottom:1px solid #333}
  tr:hover td{background:#1e1e3f}a{color:#a855f7}
  .scene-row{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #222}
  .scene-row:last-child{border:none}
  .badge{font-size:11px;padding:2px 8px;border-radius:12px;font-weight:500}
  .b-pending{background:#333;color:#888}.b-generating{background:#7c3aed;color:#fff;animation:pulse 1s infinite}
  .b-done{background:#166534;color:#86efac}.b-error{background:#7f1d1d;color:#fca5a5}
  .b-building{background:#92400e;color:#fde68a}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
  .progress-bar{height:6px;background:#333;border-radius:3px;overflow:hidden;margin-bottom:12px}
  .progress-fill{height:100%;background:#a855f7;border-radius:3px;transition:width .5s}
</style></head>
<body>
<h1>🎌 Agent มะปราง</h1>
<div class="sub">Anime Story Video Generator — ComfyUI Wan2.1 T2V-1.3B</div>

${active ? `<div class="card" id="live-card">
  <h3 style="margin:0 0 8px;color:#a855f7">⏳ กำลังสร้างวิดีโอ... <span id="live-id" style="font-size:12px;color:#888">${active.id}</span></h3>
  <div class="progress-bar"><div class="progress-fill" id="prog-fill" style="width:0%"></div></div>
  <div id="scene-list"></div>
  <div id="live-status" style="margin-top:8px;font-size:12px;color:#888"></div>
</div>` : ''}

<div class="card">
  <h3 style="margin:0 0 12px">สร้างวิดีโอใหม่</h3>
  <textarea id="prompt" rows="4" placeholder="ใส่ story prompt ภาษาไทย..."></textarea>
  <div style="margin-top:10px;font-size:12px;color:#888;margin-bottom:4px">คำอธิบายตัวละครหลัก (ไม่บังคับ — ถ้าว่างจะให้ AI สร้างอัตโนมัติ)</div>
  <textarea id="char-desc" rows="2" placeholder="เช่น: young girl around 10, long brown hair, blue dress, bright eyes" style="font-size:13px"></textarea><br>
  <button id="btn-gen" onclick="generate()">🎬 สร้างวิดีโอ (≈ 30–50 นาที)</button>
  <button onclick="checkComfy()" style="background:#333;margin-left:8px">🔍 ตรวจ ComfyUI</button>
  <div id="msg"></div>
</div>

<div class="card">
  <h3 style="margin:0 0 12px">Gallery (${gallery.length} รายการ)</h3>
  <table><thead><tr><th>ID</th><th>สถานะ</th><th>ตัวละคร</th><th>Prompt</th><th>Scenes</th><th>วิดีโอ</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="5" style="padding:16px;color:#555">ยังไม่มีวิดีโอ</td></tr>'}</tbody></table>
</div>

<script>
const BADGE = {pending:'b-pending',generating:'b-generating',done:'b-done',error:'b-error',building:'b-building'};

async function pollLive() {
  const el = document.getElementById('live-card');
  if (!el) return;
  const id = document.getElementById('live-id').textContent.trim();
  try {
    const r = await fetch('/api/maprang/status/' + id);
    const m = await r.json();
    if (!m.ok) return;
    const scenes = m.scenes || [];
    const done   = scenes.filter(s => s.status === 'done').length;
    const total  = scenes.length;
    const pct    = total ? Math.round(done / total * 100) : 0;
    document.getElementById('prog-fill').style.width = pct + '%';
    document.getElementById('scene-list').innerHTML = scenes.map(s =>
      '<div class="scene-row"><span class="badge ' + (BADGE[s.status] || 'b-pending') + '">' +
      ({pending:'รอ',generating:'กำลัง…',done:'✓ เสร็จ',error:'error'}[s.status]||s.status) +
      '</span><span>' + s.scene_number + '. ' + (s.subtitle_th||'') + '</span></div>'
    ).join('');
    document.getElementById('live-status').textContent = done + '/' + total + ' scenes | ' + m.status;
    if (m.status === 'pending_approval' || m.status === 'posted') {
      setTimeout(() => location.reload(), 2000);
    }
  } catch(e) {}
}

const activeId = ${active ? `'${active.id}'` : 'null'};
if (activeId) { pollLive(); setInterval(pollLive, 5000); }

async function generate() {
  const prompt = document.getElementById('prompt').value.trim();
  if (!prompt) { alert('กรุณาใส่ story prompt'); return; }
  const btn = document.getElementById('btn-gen'), msg = document.getElementById('msg');
  btn.disabled = true;
  msg.textContent = '⏳ กำลังส่งคำสั่ง...';
  try {
    const charDesc = document.getElementById('char-desc').value.trim();
    const r = await fetch('/api/maprang/generate', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt, char_description: charDesc})});
    const j = await r.json();
    if (j.ok) { msg.textContent = '✅ เริ่มแล้ว! ID: ' + j.id; setTimeout(() => location.reload(), 2000); }
    else { msg.textContent = '❌ ' + j.error; btn.disabled = false; }
  } catch(e) { msg.textContent = '❌ ' + e.message; btn.disabled = false; }
}

async function checkComfy() {
  const msg = document.getElementById('msg');
  msg.textContent = '⏳ กำลังตรวจสอบ...';
  const j = await fetch('/api/maprang/check').then(r => r.json());
  msg.textContent = j.online ? ('✅ ComfyUI online' + (j.wan21 ? ' | Wan2.1 ✅' : ' | Wan2.1 ❌')) : '❌ ComfyUI ไม่ตอบสนอง';
}
</script></body></html>`;
}

function register(req, res, url, rawUrl, method, deps) {
  const { ROOT } = deps;

  if (url === '/dashboard/maprang') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderDashboard(ROOT));
  }

  const refImgMatch = url.match(/^\/dashboard\/maprang\/refimage\/([\w]+)$/);
  if (refImgMatch) {
    const rp = path.join(ROOT, 'agents', 'maprang', 'gallery', refImgMatch[1], 'char_ref.png');
    if (!fs.existsSync(rp)) { res.writeHead(404); return res.end('ไม่พบรูป'); }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': fs.statSync(rp).size });
    return fs.createReadStream(rp).pipe(res);
  }

  const videoMatch = url.match(/^\/dashboard\/maprang\/video\/([\w]+)$/);
  if (videoMatch) {
    const vp = path.join(ROOT, 'agents', 'maprang', 'gallery', videoMatch[1], 'story.mp4');
    if (!fs.existsSync(vp)) { res.writeHead(404); return res.end('ไม่พบวิดีโอ'); }
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': fs.statSync(vp).size });
    return fs.createReadStream(vp).pipe(res);
  }

  if (url === '/api/maprang/check' && method === 'GET') {
    const { checkHealth, checkWan21Model } = require('../../agents/maprang/pipeline/comfy-client');
    const cfg = { host: process.env.COMFY_HOST || '10.3.17.118', port: parseInt(process.env.COMFY_PORT || '8188', 10) };
    return checkHealth(cfg).then(online => {
      if (!online) return reply(res, 200, { ok: true, online: false, wan21: false });
      return checkWan21Model(cfg).then(({ found }) => reply(res, 200, { ok: true, online: true, wan21: found }));
    }).catch(e => reply(res, 200, { ok: false, error: e.message }));
  }

  if (url === '/api/maprang/generate' && method === 'POST') {
    return getBody(req).then(body => {
      const prompt = (body.prompt || '').trim();
      if (!prompt) return reply(res, 400, { ok: false, error: 'ต้องระบุ prompt' });
      const id = Date.now().toString();
      reply(res, 200, { ok: true, id });
      const runScript = path.join(ROOT, 'agents', 'maprang', 'run.js');
      try {
        const spawnArgs = [runScript, '--action', 'generate', '--id', id, '--prompt', prompt];
        if (body.char_description) spawnArgs.push('--char-desc', body.char_description);
        const proc = spawn(process.execPath, spawnArgs, {
          cwd: ROOT, stdio: 'inherit', env: { ...process.env }, detached: false,
        });
        proc.on('error', e => console.error(`[maprang] spawn error: ${e.message}`));
        proc.on('exit', code => console.log(`[maprang] run.js exit: ${code}`));
      } catch (e) { console.error(`[maprang] spawn failed: ${e.message}`); }
    }).catch(e => { if (!res.headersSent) reply(res, 500, { ok: false, error: e.message }); });
  }

  const statusMatch = url.match(/^\/api\/maprang\/status\/([\w]+)$/);
  if (statusMatch && method === 'GET') {
    const m = readMeta(ROOT, statusMatch[1]);
    if (!m) return reply(res, 404, { ok: false, error: 'ไม่พบ' });
    return reply(res, 200, { ok: true, ...m });
  }

  if (url === '/api/maprang/status' && method === 'GET') {
    return reply(res, 200, { ok: true, gallery: getGallery(ROOT) });
  }
}

module.exports = { register };
