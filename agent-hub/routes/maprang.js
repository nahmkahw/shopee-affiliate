'use strict';
/**
 * agent-hub/routes/maprang.js
 * Routes: /dashboard/maprang | /api/maprang/* | /dashboard/maprang/video/:id
 */

const fs      = require('fs');
const path    = require('path');
const { spawn } = require('child_process');
const charReg   = require('../../agents/maprang/pipeline/char-registry');
const { renderDashboard } = require('../html/maprang');
const sceneHandler = require('./maprang/scene');
const buildHandler = require('./maprang/build');

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

function getRawBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

// spawn run.js --action <act> สำหรับ character (async ไม่ block response)
function spawnCharAction(ROOT, action, charId) {
  const proc = spawn(process.execPath,
    [path.join(ROOT, 'agents', 'maprang', 'run.js'), '--action', action, '--char-id', charId],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env } });
  proc.on('error', e => console.error(`[maprang] ${action} spawn error: ${e.message}`));
}
const spawnGenCharImage = (ROOT, charId) => spawnCharAction(ROOT, 'gen-char-image', charId);
const spawnGenAnimeRef  = (ROOT, charId) => spawnCharAction(ROOT, 'gen-anime-ref', charId);

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

function register(req, res, url, rawUrl, method, deps) {
  const { ROOT } = deps;

  if (url === '/dashboard/maprang') {
    const gallery  = getGallery(ROOT);
    const allChars = charReg.load();
    const active   = gallery.find(m => ['pre_production','producing','building'].includes(m.status));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderDashboard(ROOT, { gallery, allChars, active }));
  }

  // ─── Character API ──────────────────────────────────────────────────────────
  if (url === '/api/maprang/characters' && method === 'GET') {
    return reply(res, 200, { ok: true, characters: charReg.load() });
  }
  if (url === '/api/maprang/characters' && method === 'POST') {
    return getBody(req).then(body => {
      if (!body.id || !body.description) return reply(res, 400, { ok: false, error: 'id และ description required' });
      const fields = { id: body.id, name: body.name || body.id, description: body.description };
      if (body.gender === 'male' || body.gender === 'female') fields.gender = body.gender;
      const char = charReg.upsert(fields);
      return reply(res, 200, { ok: true, char });
    }).catch(e => reply(res, 500, { ok: false, error: e.message }));
  }
  const delCharMatch = url.match(/^\/api\/maprang\/characters\/([\w-]+)$/);
  if (delCharMatch && method === 'DELETE') {
    charReg.remove(delCharMatch[1]);
    return reply(res, 200, { ok: true });
  }
  // สร้างรูปตัวละครด้วย AI (จาก description)
  const genCharMatch = url.match(/^\/api\/maprang\/characters\/([\w-]+)\/generate$/);
  if (genCharMatch && method === 'POST') {
    const c = charReg.load()[genCharMatch[1]];
    if (!c) return reply(res, 404, { ok: false, error: 'ไม่พบตัวละคร' });
    spawnGenCharImage(ROOT, genCharMatch[1]);
    return reply(res, 200, { ok: true, generating: true });
  }
  // อัปโหลดรูปตัวละครเอง (raw image body)
  const upCharMatch = url.match(/^\/api\/maprang\/characters\/([\w-]+)\/image$/);
  if (upCharMatch && method === 'POST') {
    return getRawBody(req).then(buf => {
      if (!buf || !buf.length) return reply(res, 400, { ok: false, error: 'ไม่มีรูป' });
      const dir = path.join(ROOT, 'agents', 'maprang', 'characters');
      fs.mkdirSync(dir, { recursive: true });
      const outPath = path.join(dir, `${upCharMatch[1]}.png`);
      fs.writeFileSync(outPath, buf);
      charReg.upsert({ id: upCharMatch[1], ref_image: path.relative(ROOT, outPath) });
      // Stage-0: รูปถ่ายจริง → anime portrait (anime_ref) อัตโนมัติ (async)
      spawnGenAnimeRef(ROOT, upCharMatch[1]);
      return reply(res, 200, { ok: true, anime_ref_generating: true });
    }).catch(e => reply(res, 500, { ok: false, error: e.message }));
  }

  // ─── Static file serving ────────────────────────────────────────────────────
  const charImgMatch = url.match(/^\/dashboard\/maprang\/charimg\/([\w-]+)$/);
  if (charImgMatch) {
    const c   = charReg.load()[charImgMatch[1]];
    const rel = c?.anime_ref || c?.ref_image;  // โชว์ anime_ref (anchor จริง) ถ้ามี
    const cp  = rel && path.isAbsolute(rel) ? rel : rel ? path.join(ROOT, rel) : null;
    if (!cp || !fs.existsSync(cp)) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': fs.statSync(cp).size });
    return fs.createReadStream(cp).pipe(res);
  }

  const refImgMatch = url.match(/^\/dashboard\/maprang\/refimage\/([\w]+)$/);
  if (refImgMatch) {
    const rp = path.join(ROOT, 'agents', 'maprang', 'gallery', refImgMatch[1], 'char_ref.png');
    if (!fs.existsSync(rp)) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': fs.statSync(rp).size });
    return fs.createReadStream(rp).pipe(res);
  }

  // Clip preview per scene
  const clipMatch = url.match(/^\/dashboard\/maprang\/clip\/([\w]+)\/(\d+)$/);
  if (clipMatch) {
    const cp = path.join(ROOT, 'agents', 'maprang', 'gallery', clipMatch[1], 'clips', `clip_${clipMatch[2]}.mp4`);
    if (!fs.existsSync(cp)) { res.writeHead(404); return res.end('ไม่พบ clip'); }
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': fs.statSync(cp).size });
    return fs.createReadStream(cp).pipe(res);
  }

  // การ์ตูน 4 ช่อง (mode comic) — รูปนิ่ง
  const comicMatch = url.match(/^\/dashboard\/maprang\/comic\/([\w]+)$/);
  if (comicMatch) {
    const cp = path.join(ROOT, 'agents', 'maprang', 'gallery', comicMatch[1], 'comic.png');
    if (!fs.existsSync(cp)) { res.writeHead(404); return res.end('ไม่พบการ์ตูน'); }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache', 'Content-Length': fs.statSync(cp).size });
    return fs.createReadStream(cp).pipe(res);
  }

  const videoMatch = url.match(/^\/dashboard\/maprang\/video\/([\w]+)$/);
  if (videoMatch) {
    const vp = path.join(ROOT, 'agents', 'maprang', 'gallery', videoMatch[1], 'story.mp4');
    if (!fs.existsSync(vp)) { res.writeHead(404); return res.end('ไม่พบวิดีโอ'); }
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': fs.statSync(vp).size });
    return fs.createReadStream(vp).pipe(res);
  }

  // ─── API ────────────────────────────────────────────────────────────────────
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
      // Guard: ห้ามเริ่ม job ถ้าตัวละครที่เลือกยังไม่มี anime_ref (กัน race → char_refs หาย → fallback T2V)
      if (body.char_ids) {
        const chars = charReg.load();
        const notReady = body.char_ids.split(',').map(s => s.trim()).filter(Boolean)
          .filter(cid => chars[cid] && !chars[cid].anime_ref && !chars[cid].ref_image);
        if (notReady.length) return reply(res, 409, { ok: false,
          error: `ตัวละครยังไม่พร้อม (ยังไม่มีรูป/anime_ref): ${notReady.join(', ')} — รอ Stage-0 เสร็จก่อน` });
      }
      const id = Date.now().toString();
      reply(res, 200, { ok: true, id });
      const runScript = path.join(ROOT, 'agents', 'maprang', 'run.js');
      // mode comic → action comic (end-to-end รูปนิ่ง), อื่น ๆ → pre-production (วิดีโอ)
      const action = body.mode === 'comic' ? 'comic' : 'pre-production';
      try {
        const spawnArgs = [runScript, '--action', action, '--id', id, '--prompt', prompt];
        if (body.char_description) spawnArgs.push('--char-desc', body.char_description);
        if (body.char_ids)         spawnArgs.push('--chars', body.char_ids);
        const proc = spawn(process.execPath, spawnArgs, {
          cwd: ROOT, stdio: 'inherit', env: { ...process.env }, detached: false,
        });
        proc.on('error', e => console.error(`[maprang] spawn error: ${e.message}`));
        proc.on('exit', code => console.log(`[maprang] run.js exit: ${code}`));
      } catch (e) { console.error(`[maprang] spawn failed: ${e.message}`); }
    }).catch(e => { if (!res.headersSent) reply(res, 500, { ok: false, error: e.message }); });
  }

  // Scene progress (step, pct) + preview image
  const sceneProgM = url.match(/^\/api\/maprang\/([\w]+)\/scene-progress\/(\d+)$/);
  if (sceneProgM && method === 'GET') {
    const p = path.join(ROOT, 'agents', 'maprang', 'gallery', sceneProgM[1], 'clips', `progress_${sceneProgM[2]}.json`);
    if (!fs.existsSync(p)) return reply(res, 200, { ok: true });
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      const prevP = path.join(ROOT, 'agents', 'maprang', 'gallery', sceneProgM[1], 'clips', `preview_${sceneProgM[2]}.jpg`);
      return reply(res, 200, { ok: true, ...data, has_preview: fs.existsSync(prevP) });
    } catch { return reply(res, 200, { ok: true }); }
  }

  const scenePrevM = url.match(/^\/api\/maprang\/([\w]+)\/scene-preview\/(\d+)$/);
  if (scenePrevM && method === 'GET') {
    const p = path.join(ROOT, 'agents', 'maprang', 'gallery', scenePrevM[1], 'clips', `preview_${scenePrevM[2]}.jpg`);
    if (!fs.existsSync(p)) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache', 'Content-Length': fs.statSync(p).size });
    return fs.createReadStream(p).pipe(res);
  }

  // ─── Movie workflow sub-routes ────────────────────────────────────────────
  if (sceneHandler.handle(req, res, url, method, ROOT)) return;
  if (buildHandler.handle(req, res, url, method, ROOT)) return;

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
