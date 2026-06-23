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
      const char = charReg.upsert({ id: body.id, name: body.name || body.id, description: body.description });
      return reply(res, 200, { ok: true, char });
    }).catch(e => reply(res, 500, { ok: false, error: e.message }));
  }
  const delCharMatch = url.match(/^\/api\/maprang\/characters\/([\w-]+)$/);
  if (delCharMatch && method === 'DELETE') {
    charReg.remove(delCharMatch[1]);
    return reply(res, 200, { ok: true });
  }

  // ─── Static file serving ────────────────────────────────────────────────────
  const charImgMatch = url.match(/^\/dashboard\/maprang\/charimg\/([\w-]+)$/);
  if (charImgMatch) {
    const c  = charReg.load()[charImgMatch[1]];
    const cp = c?.ref_image && path.isAbsolute(c.ref_image) ? c.ref_image
             : c?.ref_image ? path.join(ROOT, c.ref_image) : null;
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
      const id = Date.now().toString();
      reply(res, 200, { ok: true, id });
      const runScript = path.join(ROOT, 'agents', 'maprang', 'run.js');
      try {
        const spawnArgs = [runScript, '--action', 'pre-production', '--id', id, '--prompt', prompt];
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
