'use strict';
/**
 * routes/maprang/build.js — Approve pre-production + trigger post-production build
 * Endpoints:
 *   POST /api/maprang/:id/approve   — approve storyboard → start generating all scenes
 *   POST /api/maprang/:id/build     — trigger post-production (concat + TTS)
 *   PATCH /api/maprang/:id/bgm      — เปลี่ยน bgm_mood
 */

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function readMeta(ROOT, id) {
  const p = path.join(ROOT, 'agents', 'maprang', 'gallery', id, 'meta.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeMeta(ROOT, id, meta) {
  fs.writeFileSync(
    path.join(ROOT, 'agents', 'maprang', 'gallery', id, 'meta.json'),
    JSON.stringify(meta, null, 2)
  );
}

function getBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve({}); } });
  });
}

function spawnAction(ROOT, id, action, extra = []) {
  const proc = spawn(process.execPath, [
    path.join(ROOT, 'agents', 'maprang', 'run.js'),
    '--action', action, '--id', id, ...extra,
  ], { cwd: ROOT, stdio: 'inherit', env: { ...process.env }, detached: false });
  proc.on('error', e => console.error(`[maprang/build] spawn error: ${e.message}`));
  proc.on('exit', code => console.log(`[maprang/build] ${action} exit: ${code}`));
}

/**
 * Handle build sub-routes
 * URL pattern: /api/maprang/:id/(approve|build|bgm)
 */
function handle(req, res, url, method, ROOT) {
  const reply = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  // approve storyboard → spawn generate-scene สำหรับทุก scene ต่อกัน (sequential ใน run.js)
  const approveM = url.match(/^\/api\/maprang\/([\w]+)\/approve$/);
  if (approveM && method === 'POST') {
    res._claimed = true;
    getBody(req).then(body => {
      const id   = approveM[1];
      const meta = readMeta(ROOT, id);
      if (!meta) return reply(404, { ok: false, error: 'ไม่พบ job' });
      if (meta.status !== 'pre_production')
        return reply(400, { ok: false, error: `status ปัจจุบันคือ ${meta.status} ไม่ใช่ pre_production` });

      // อัปเดต bgm_mood ถ้าส่งมา
      if (body.bgm_mood) { meta.bgm_mood = body.bgm_mood; writeMeta(ROOT, id, meta); }

      meta.status = 'producing';
      writeMeta(ROOT, id, meta);

      // spawn scene generation ทีละ scene ผ่าน single run.js call (sequential loop inside)
      spawnAction(ROOT, id, 'generate-all-scenes');
      return reply(200, { ok: true, message: 'Production started', scenes: meta.scenes.length });
    }).catch(e => reply(500, { ok: false, error: e.message }));
    return true;
  }

  // build (post-production)
  const buildM = url.match(/^\/api\/maprang\/([\w]+)\/build$/);
  if (buildM && method === 'POST') {
    res._claimed = true;
    const id   = buildM[1];
    const meta = readMeta(ROOT, id);
    if (!meta) return reply(404, { ok: false, error: 'ไม่พบ job' });
    const doneScenes = (meta.scenes || []).filter(s => s.status === 'done').length;
    if (doneScenes === 0) return reply(400, { ok: false, error: 'ยังไม่มี scene ที่เสร็จเลย' });
    spawnAction(ROOT, id, 'build');
    return reply(200, { ok: true, message: 'Post-production started', done_scenes: doneScenes });
  }

  // update bgm_mood
  const bgmM = url.match(/^\/api\/maprang\/([\w]+)\/bgm$/);
  if (bgmM && (method === 'POST' || method === 'PATCH')) {
    res._claimed = true;
    getBody(req).then(body => {
      const id   = bgmM[1];
      const meta = readMeta(ROOT, id);
      if (!meta) return reply(404, { ok: false, error: 'ไม่พบ job' });
      meta.bgm_mood = body.mood || 'adventure';
      writeMeta(ROOT, id, meta);
      return reply(200, { ok: true, bgm_mood: meta.bgm_mood });
    }).catch(e => reply(500, { ok: false, error: e.message }));
    return true;
  }

  return false; // not handled
}

module.exports = { handle };
