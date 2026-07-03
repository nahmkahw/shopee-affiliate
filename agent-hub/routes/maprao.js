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
const { postNow } = require('../../lib/namkhao-bot-news');
const { sendApprovalNotification } = require('../../lib/tg-approval');

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

function pipelineRoot(ROOT) { return path.join(ROOT, 'agents', 'maprao', 'pipeline'); }
function newsDir(ROOT) { return path.join(pipelineRoot(ROOT), 'news'); }

function readNewsData(ROOT, id) {
  const p = path.join(newsDir(ROOT), id, 'data.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function readFbCaption(ROOT, id) {
  const p = path.join(newsDir(ROOT), id, 'content', 'facebook.md');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

// ลบ _tg_queue.json entry ของ id นี้ (ถ้ามี) — กัน queue ค้าง shortId ที่ชี้ไปยังรายการที่ลบแล้ว
function removeFromQueue(ROOT, id) {
  const qFile = path.join(pipelineRoot(ROOT), '_tg_queue.json');
  if (!fs.existsSync(qFile)) return;
  try {
    const q = JSON.parse(fs.readFileSync(qFile, 'utf8'));
    for (const [shortId, entry] of Object.entries(q)) {
      if ((typeof entry === 'object' ? entry.slug : entry) === id) delete q[shortId];
    }
    fs.writeFileSync(qFile, JSON.stringify(q, null, 2));
  } catch {}
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
    return res.end(renderDashboard(ROOT, { gallery, mascotList: mascot.list(), lastDetail: mascot.lastDetail() }));
  }

  if (url === '/api/maprao/mascot/generate' && method === 'POST') {
    return getBody(req).then(body => {
      const detail = (body.detail || '').trim();
      spawnRun(ROOT, ['--action', 'gen-mascot-ref', ...(detail ? ['--detail', detail] : [])]);
      return reply(res, 200, { ok: true, generating: true });
    }).catch(e => { if (!res.headersSent) reply(res, 500, { ok: false, error: e.message }); });
  }

  if (url === '/api/maprao/mascot/list' && method === 'GET') {
    return reply(res, 200, { ok: true, items: mascot.list() });
  }

  const selectMatch = url.match(/^\/api\/maprao\/mascot\/([\w-]+)\/select$/);
  if (selectMatch && method === 'POST') {
    try { mascot.selectActive(selectMatch[1]); return reply(res, 200, { ok: true }); }
    catch (e) { return reply(res, 404, { ok: false, error: e.message }); }
  }

  const deleteMatch = url.match(/^\/api\/maprao\/mascot\/([\w-]+)$/);
  if (deleteMatch && method === 'DELETE') {
    try { mascot.remove(deleteMatch[1]); return reply(res, 200, { ok: true }); }
    catch (e) { return reply(res, 400, { ok: false, error: e.message }); }
  }

  const mascotImgMatch = url.match(/^\/dashboard\/maprao\/mascot\/([\w-]+)$/);
  if (mascotImgMatch) {
    const item = mascot.list().find(it => it.id === mascotImgMatch[1]);
    const ip = item && path.join(ROOT, item.file);
    if (!ip || !fs.existsSync(ip)) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': fs.statSync(ip).size });
    return fs.createReadStream(ip).pipe(res);
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

  // โพสต์ FB ตรงจาก dashboard (bypass Telegram approval — คนกดปุ่มคือคนอนุมัติ)
  const postMatch = url.match(/^\/api\/maprao\/gallery\/([\w]+)\/post$/);
  if (postMatch && method === 'POST') {
    const id = postMatch[1];
    if (!readNewsData(ROOT, id)) return reply(res, 404, { ok: false, error: 'ไม่พบรายการนี้' });
    return postNow(pipelineRoot(ROOT), id, 'fb', {}).then(({ code, output }) => {
      if (code === 0) return reply(res, 200, { ok: true });
      return reply(res, 500, { ok: false, error: output.slice(-300) });
    }).catch(e => reply(res, 500, { ok: false, error: e.message }));
  }

  // ส่ง Telegram approval ซ้ำด้วยข้อมูลเดิม (resend — ไม่ generate ใหม่)
  const resendMatch = url.match(/^\/api\/maprao\/gallery\/([\w]+)\/resend$/);
  if (resendMatch && method === 'POST') {
    const id = resendMatch[1];
    const data = readNewsData(ROOT, id);
    if (!data) return reply(res, 404, { ok: false, error: 'ไม่พบรายการนี้' });
    const fbCaption = readFbCaption(ROOT, id);
    return sendApprovalNotification(id, data, fbCaption, {
      pipelineRoot: pipelineRoot(ROOT), newsDir: newsDir(ROOT),
      mode: 'immediate', emoji: '🥥', kind: 'การ์ตูนใหม่',
    }).then(() => reply(res, 200, { ok: true })).catch(e => reply(res, 500, { ok: false, error: e.message }));
  }

  // ลบรายการ Gallery (gallery/{id}/ + pipeline/news/{id}/ + queue entry) — ห้ามลบตอนกำลังสร้าง
  const galleryDeleteMatch = url.match(/^\/api\/maprao\/gallery\/([\w]+)$/);
  if (galleryDeleteMatch && method === 'DELETE') {
    const id = galleryDeleteMatch[1];
    const meta = readMeta(ROOT, id);
    if (!meta) return reply(res, 404, { ok: false, error: 'ไม่พบรายการนี้' });
    if (meta.status === 'producing') return reply(res, 409, { ok: false, error: 'กำลังสร้างอยู่ — ลบตอนนี้ไม่ได้' });
    fs.rmSync(path.join(ROOT, 'agents', 'maprao', 'gallery', id), { recursive: true, force: true });
    fs.rmSync(path.join(newsDir(ROOT), id), { recursive: true, force: true });
    removeFromQueue(ROOT, id);
    return reply(res, 200, { ok: true });
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
