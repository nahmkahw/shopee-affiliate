'use strict';
/**
 * routes/maprang/scene.js — Per-scene controls: regen, update-prompt, skip
 * Endpoints:
 *   POST /api/maprang/:id/scenes/:n/regen          — regenerate clip
 *   POST /api/maprang/:id/scenes/:n/update-prompt  — เปลี่ยน visual_prompt_en
 *   POST /api/maprang/:id/scenes/:n/skip           — skip scene
 *   POST /api/maprang/:id/scenes/:n/update-subtitle — เปลี่ยน subtitle_th
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

function spawnScene(ROOT, id, sceneNum) {
  const proc = spawn(process.execPath, [
    path.join(ROOT, 'agents', 'maprang', 'run.js'),
    '--action', 'generate-scene', '--id', id, '--scene', String(sceneNum),
  ], { cwd: ROOT, stdio: 'inherit', env: { ...process.env }, detached: false });
  proc.on('error', e => console.error(`[maprang/scene] spawn error: ${e.message}`));
  proc.on('exit', code => console.log(`[maprang/scene] scene ${sceneNum} exit: ${code}`));
}

/**
 * Handle scene sub-routes
 * URL pattern: /api/maprang/:id/scenes/:n/(regen|update-prompt|skip|update-subtitle)
 */
function handle(req, res, url, method, ROOT) {
  const reply = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  const m = url.match(/^\/api\/maprang\/([\w]+)\/scenes\/(\d+)\/([\w-]+)$/);
  if (!m || method !== 'POST') return false;

  const [, id, sceneStr, op] = m;
  const sceneNum = parseInt(sceneStr, 10);

  getBody(req).then(body => {
    const meta = readMeta(ROOT, id);
    if (!meta) return reply(404, { ok: false, error: 'ไม่พบ job' });
    const scene = meta.scenes.find(s => s.scene_number === sceneNum);
    if (!scene) return reply(404, { ok: false, error: `ไม่พบ scene ${sceneNum}` });

    if (op === 'regen') {
      // reset status แล้ว spawn generate-scene
      scene.status  = 'pending';
      scene.skipped = false;
      scene.done_at = undefined;
      writeMeta(ROOT, id, meta);
      spawnScene(ROOT, id, sceneNum);
      return reply(200, { ok: true, message: `Regenerating scene ${sceneNum}` });
    }

    if (op === 'update-prompt') {
      if (!body.prompt) return reply(400, { ok: false, error: 'ต้องระบุ prompt' });
      scene.visual_prompt_en = body.prompt;
      scene.status  = 'pending';
      scene.skipped = false;
      writeMeta(ROOT, id, meta);
      // spawn immediately ถ้าส่ง generate:true
      if (body.generate) spawnScene(ROOT, id, sceneNum);
      return reply(200, { ok: true, message: 'Updated prompt' + (body.generate ? ' + regenerating' : '') });
    }

    if (op === 'skip') {
      scene.skipped = true;
      scene.status  = 'skip';
      writeMeta(ROOT, id, meta);
      return reply(200, { ok: true, message: `Scene ${sceneNum} skipped` });
    }

    if (op === 'update-subtitle') {
      if (!body.subtitle) return reply(400, { ok: false, error: 'ต้องระบุ subtitle' });
      scene.subtitle_th = body.subtitle;
      writeMeta(ROOT, id, meta);
      return reply(200, { ok: true, message: 'Subtitle updated' });
    }

    return reply(404, { ok: false, error: `Unknown operation: ${op}` });
  }).catch(e => reply(500, { ok: false, error: e.message }));

  return true; // handled
}

module.exports = { handle };
