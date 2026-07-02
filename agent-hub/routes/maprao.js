'use strict';
/**
 * agent-hub/routes/maprao.js
 * Routes: /dashboard/maprao | /api/maprao/* | /dashboard/maprao/comic/:id
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mascot = require('../../agents/maprao/pipeline/mascot');
const { renderDashboard } = require('../html/maprao');

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
  const p = path.join(ROOT, 'agents', 'maprao', 'gallery', id, 'meta.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function getGallery(ROOT) {
  const dir = path.join(ROOT, 'agents', 'maprao', 'gallery');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().reverse().slice(0, 20)
    .map(id => { const m = readMeta(ROOT, id); return m ? { id, ...m } : null; })
    .filter(Boolean);
}

function spawnRun(ROOT, args) {
  const proc = spawn(process.execPath, [path.join(ROOT, 'agents', 'maprao', 'run.js'), ...args],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env } });
  proc.on('error', e => console.error(`[maprao] spawn error: ${e.message}`));
  proc.on('exit', code => console.log(`[maprao] run.js exit: ${code}`));
}

function register(req, res, url, rawUrl, method, deps) {
  const { ROOT } = deps;

  if (url === '/dashboard/maprao') {
    const gallery = getGallery(ROOT);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderDashboard(ROOT, { gallery, mascotReady: !!mascot.refPath() }));
  }

  if (url === '/api/maprao/mascot/generate' && method === 'POST') {
    spawnRun(ROOT, ['--action', 'gen-mascot-ref']);
    return reply(res, 200, { ok: true, generating: true });
  }

  if (url === '/api/maprao/generate' && method === 'POST') {
    return getBody(req).then(body => {
      const prompt = (body.prompt || '').trim();
      if (!prompt) return reply(res, 400, { ok: false, error: 'ต้องระบุ prompt' });
      if (!mascot.refPath()) return reply(res, 409, { ok: false, error: 'ยังไม่มี Mascot Ref — กดสร้างก่อน' });
      const id = Date.now().toString();
      reply(res, 200, { ok: true, id });
      spawnRun(ROOT, ['--action', 'comic', '--id', id, '--prompt', prompt]);
    }).catch(e => { if (!res.headersSent) reply(res, 500, { ok: false, error: e.message }); });
  }

  const comicMatch = url.match(/^\/dashboard\/maprao\/comic\/([\w]+)$/);
  if (comicMatch) {
    const cp = path.join(ROOT, 'agents', 'maprao', 'gallery', comicMatch[1], 'comic.png');
    if (!fs.existsSync(cp)) { res.writeHead(404); return res.end('ไม่พบการ์ตูน'); }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache', 'Content-Length': fs.statSync(cp).size });
    return fs.createReadStream(cp).pipe(res);
  }

  const statusMatch = url.match(/^\/api\/maprao\/status\/([\w]+)$/);
  if (statusMatch && method === 'GET') {
    const m = readMeta(ROOT, statusMatch[1]);
    if (!m) return reply(res, 404, { ok: false, error: 'ไม่พบ' });
    return reply(res, 200, { ok: true, ...m });
  }

  if (url === '/api/maprao/status' && method === 'GET') {
    return reply(res, 200, { ok: true, gallery: getGallery(ROOT), mascotReady: !!mascot.refPath() });
  }
}

module.exports = { register };
