'use strict';
/**
 * agents/maprang/run.js — Agent มะปราง: Movie-style Video Generator
 * --action pre-production | generate-scene | skip-scene | build | check | status
 */

require('dotenv').config();

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const { generateClip, generateClipI2V, checkI2VCapability, checkHealth, checkWan21Model } = require('./pipeline/comfy-client');
const { generateSceneStill }    = require('../../lib/flux-kontext');
const { resolveSceneRefs }      = require('./pipeline/scene-refs');
const { kenBurnsClip }          = require('./pipeline/video-build');
const { runPreProduction }      = require('./pipeline/pre-production');
const { runPostProduction }     = require('./pipeline/post-production');
const charActions               = require('./pipeline/char-actions');
const charReg = require('./pipeline/char-registry');

const ROOT = path.join(__dirname, '..', '..'), GALLERY = path.join(__dirname, 'gallery'), CHAR_DIR = path.join(__dirname, 'characters');
const CHAR_CTX = { get COMFY_CFG() { return COMFY_CFG; }, ROOT, CHAR_DIR };
const COMFY_CFG = {
  host:      process.env.COMFY_HOST     || '10.3.17.118',
  port:      parseInt(process.env.COMFY_PORT || '8188', 10),
  timeoutMs: parseInt(process.env.COMFY_TIMEOUT_MS || '900000', 10),
  modelName: process.env.WAN21_MODEL    || 'Wan2.1\\wan2.1_t2v_1.3B_bf16.safetensors',
};
// animate scene still: 'kenburns' (default, เร็ว) | 'i2v' (motion จริง แต่ 14B ช้า)
const ANIMATE = (process.env.MAPRANG_ANIMATE || 'kenburns').toLowerCase();

const TG_TOKEN   = process.env.MAPRANG_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TG_OK      = !!(TG_TOKEN && TG_CHAT_ID);

// ─── Telegram ────────────────────────────────────────────────────────────────

function tgSendText(text) {
  if (!TG_OK) return Promise.resolve();
  const body = JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' });
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.telegram.org', path: `/bot${TG_TOKEN}/sendMessage`,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => { res.on('data', () => {}); res.on('end', resolve); });
    req.setTimeout(15000, () => { req.destroy(); resolve(); });
    req.on('error', resolve);
    req.write(body); req.end();
  });
}

async function tgSendVideo(storyPath, caption) {
  if (!TG_OK) return;
  const boundary = '----MPB' + Math.random().toString(36).substring(2);
  const videoBuf = fs.readFileSync(storyPath);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${TG_CHAT_ID}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption.substring(0, 1024)}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="story.mp4"\r\nContent-Type: video/mp4\r\n\r\n`
  );
  const body = Buffer.concat([head, videoBuf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const r = await new Promise(resolve => {
    const req = https.request({
      hostname: 'api.telegram.org', path: `/bot${TG_TOKEN}/sendVideo`,
      method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
    }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve({}); } });
    });
    req.setTimeout(120000, () => { req.destroy(); resolve({}); });
    req.on('error', () => resolve({}));
    req.write(body); req.end();
  });
  if (!r.ok) console.warn(`⚠️  Telegram sendVideo: ${r.description || JSON.stringify(r)}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function appendLog(meta, msg) {
  if (!meta.logs) meta.logs = [];
  const elapsed = meta.created_at
    ? Math.round((Date.now() - new Date(meta.created_at).getTime()) / 1000) : 0;
  meta.logs.push({ t: new Date().toISOString(), msg, elapsed });
}

function readMeta(id) {
  const p = path.join(GALLERY, id, 'meta.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeMeta(id, meta) {
  fs.writeFileSync(path.join(GALLERY, id, 'meta.json'), JSON.stringify(meta, null, 2));
}

// animate still → clip: Ken Burns (default) | I2V
async function animateStill(stillPath, clipPath, sceneNum, sceneSetting, seed, charNeg) {
  if (ANIMATE === 'i2v') {
    const cap = await checkI2VCapability(COMFY_CFG);
    if (cap.available) {
      const i2vCfg = { ...COMFY_CFG, timeoutMs: Math.max(COMFY_CFG.timeoutMs, 1200000), i2vModelName: cap.i2vModel, clipVisionModel: cap.clipVisionModel };
      return generateClipI2V(i2vCfg, sceneSetting, stillPath, clipPath, seed, charNeg);
    }
    console.warn('  ℹ️ I2V ไม่พร้อม — ใช้ Ken Burns แทน');
  }
  return kenBurnsClip(stillPath, clipPath, { variant: (sceneNum - 1) % 4 });
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function actionCheck() {
  const alive = await checkHealth(COMFY_CFG);
  if (!alive) { console.error('❌ ComfyUI ไม่ตอบสนอง'); process.exit(1); }
  console.log('✅ ComfyUI online');
  const { found, models } = await checkWan21Model(COMFY_CFG);
  console.log(found ? `✅ Wan2.1: ${models.join(', ')}` : '❌ ไม่พบ Wan2.1 model');
}

async function actionPreProduction(prompt, id, charDescOverride, charIdsArg) {
  if (!prompt) { console.error('❌ ต้องระบุ --prompt'); process.exit(1); }
  const actualId = id || Date.now().toString();
  const dir      = path.join(GALLERY, actualId);
  fs.mkdirSync(dir, { recursive: true });
  const saveMeta = m => writeMeta(actualId, m);
  const meta = await runPreProduction({ prompt, id: actualId, charDescOverride, charIdsArg, comfyCfg: COMFY_CFG, saveMeta });
  const sceneList = meta.scenes.map(s => `  ${s.scene_number}. ${s.subtitle_th}`).join('\n');
  await tgSendText(
    `🎬 <b>มะปราง — Storyboard พร้อม</b>\n\n📖 ${prompt.substring(0, 150)}\n\n` +
    `${meta.scenes.length} scenes:\n${sceneList}\n\n` +
    `🆔 <code>${actualId}</code>\n\n⏳ รอ Approve ใน Dashboard`
  );
}

async function actionGenerateScene(id, sceneNum) {
  const meta = readMeta(id);
  if (!meta) { console.error(`❌ ไม่พบ job ${id}`); process.exit(1); }
  const scene = meta.scenes.find(s => s.scene_number === sceneNum);
  if (!scene) { console.error(`❌ ไม่พบ scene ${sceneNum}`); process.exit(1); }
  if (scene.skipped) { console.log(`ℹ️  Scene ${sceneNum} ถูก skip แล้ว`); return; }

  const clipsDir = path.join(GALLERY, id, 'clips');
  fs.mkdirSync(clipsDir, { recursive: true });
  const clipPath = path.join(clipsDir, `clip_${sceneNum}.mp4`);

  scene.status     = 'generating';
  scene.started_at = new Date().toISOString();
  meta.status      = 'producing';
  appendLog(meta, `🎬 Scene ${sceneNum}/${meta.scenes.length}: ${scene.subtitle_th}`);
  writeMeta(id, meta);

  // seed ต่าง scene ต่างกัน — ป้องกัน noise drift เมื่อ prompt เปลี่ยนแต่ seed เดิม
  const sceneSeed = (meta.seed || 0) + scene.scene_number;

  // inject context จาก scene ก่อนหน้า — วางหลัง "anime style," ให้ token priority สูง
  let visualPrompt = scene.visual_prompt_en;
  const prevScene = meta.scenes.find(s => s.scene_number === sceneNum - 1 && !s.skipped);
  if (prevScene?.visual_action) {
    visualPrompt = visualPrompt.replace(
      /^anime style,/i,
      `anime style, after ${prevScene.visual_action},`
    );
  }

  console.log(`\n[Scene ${sceneNum}] ${scene.subtitle_th}`);
  const t0 = Date.now();

  // ── Flux Kontext anchor: ref ตัวละคร = identity anchor → คงเดิมทุก scene (รองรับหลายตัว) ──
  const { refs, names } = resolveSceneRefs(meta, scene, GALLERY, id);
  const sceneSetting = scene.scene_setting_en || scene.visual_prompt_en;
  let generated = false;
  if (refs.length) {
    try {
      const stillPath = path.join(clipsDir, `still_${sceneNum}.png`);
      await generateSceneStill(COMFY_CFG, refs, sceneSetting, stillPath, { seed: sceneSeed, names });
      await animateStill(stillPath, clipPath, sceneNum, sceneSetting, sceneSeed, scene._charNeg || '');
      generated = true;
    } catch (e) {
      console.warn(`  ⚠️ Flux Kontext ล้มเหลว (${e.message}) — fallback T2V`);
    }
  }
  if (!generated) await generateClip(COMFY_CFG, visualPrompt, clipPath, sceneSeed, scene._charNeg || '');
  const durS = Math.round((Date.now() - t0) / 1000);

  scene.status  = 'done';
  scene.done_at = new Date().toISOString();
  appendLog(meta, `✅ Scene ${sceneNum} เสร็จ (${durS}s)`);
  writeMeta(id, meta);
  console.log(`✅ Scene ${sceneNum} เสร็จ`);

  await tgSendText(`✅ Scene ${sceneNum}/${meta.scenes.length} เสร็จแล้ว\n🎬 "${scene.subtitle_th}"`);
}

async function actionSkipScene(id, sceneNum) {
  const meta = readMeta(id);
  if (!meta) { console.error(`❌ ไม่พบ job ${id}`); process.exit(1); }
  const scene = meta.scenes.find(s => s.scene_number === sceneNum);
  if (!scene) { console.error(`❌ ไม่พบ scene ${sceneNum}`); process.exit(1); }
  scene.skipped = true;
  scene.status  = 'skip';
  writeMeta(id, meta);
  console.log(`⏭  Scene ${sceneNum} skip แล้ว`);
}

async function actionGenerateAllScenes(id) {
  const meta = readMeta(id);
  if (!meta) { console.error(`❌ ไม่พบ job ${id}`); process.exit(1); }
  const pending = meta.scenes.filter(s => !s.skipped && s.status === 'pending');
  console.log(`\n🎬 Generate ${pending.length} scenes ต่อกัน`);
  for (const scene of pending) {
    await actionGenerateScene(id, scene.scene_number);
  }
  console.log('\n✅ ทุก scene เสร็จแล้ว — กด Build ใน Dashboard เพื่อสร้าง story.mp4');
}

async function actionBuild(id) {
  const meta = readMeta(id);
  if (!meta) { console.error(`❌ ไม่พบ job ${id}`); process.exit(1); }
  const dir = path.join(GALLERY, id);

  meta.status = 'building';
  appendLog(meta, '🎞️ Post-production: TTS voiceover + subtitle + merge...');
  writeMeta(id, meta);

  const storyPath = await runPostProduction(meta, dir);
  appendLog(meta, '✅ story.mp4 พร้อมแล้ว 🎉');
  meta.status     = 'pending_approval';
  meta.story_path = storyPath;
  writeMeta(id, meta);

  const caption =
    `🎌 <b>มะปราง — Anime Story พร้อมแล้ว!</b>\n\n` +
    `📖 ${meta.prompt.substring(0, 200)}\n\n` +
    `🎬 ${meta.scenes.filter(s => !s.skipped).length} scenes\n\n` +
    `🆔 <code>${id}</code>`;
  await tgSendVideo(storyPath, caption);
  console.log(`\n🎉 เสร็จ! ID: ${id}\n   📹 ${storyPath}`);
}

function actionStatus(galleryId) {
  if (!fs.existsSync(GALLERY)) { console.log('ยังไม่มี gallery'); return; }
  const targets = galleryId ? [galleryId] : fs.readdirSync(GALLERY).sort().reverse().slice(0, 5);
  for (const gid of targets) {
    const m = readMeta(gid);
    if (!m) continue;
    const done = (m.scenes || []).filter(s => s.status === 'done').length;
    console.log(`[${gid}] ${m.status} — scenes: ${done}/${(m.scenes || []).length} — ${m.prompt?.substring(0, 50)}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

const args      = process.argv.slice(2);
const arg        = f => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const action    = arg('--action') || 'status';
const prompt    = arg('--prompt');
const galleryId = arg('--id');
const charDesc  = arg('--char-desc');
const charIds   = arg('--chars');
const sceneNum  = arg('--scene') !== null ? parseInt(arg('--scene'), 10) : null;
const charIdArg = arg('--char-id');

// เขียน status='error' ตอน exit ผิดปกติ (ครอบทั้ง throw และ process.exit) — กัน job ค้าง active
let _exitError = null;
process.on('exit', code => {
  if (code === 0) return;
  try {
    const m = galleryId && readMeta(galleryId);
    if (m && ['pre_production', 'producing', 'building'].includes(m.status)) {
      m.status = 'error';
      m.error_reason = _exitError || 'process exited abnormally';
      appendLog(m, `❌ ล้มเหลว: ${m.error_reason}`);
      writeMeta(galleryId, m);
    }
  } catch {}
});

(async () => {
  if (action === 'check')                  await actionCheck();
  else if (action === 'pre-production')    await actionPreProduction(prompt, galleryId, charDesc, charIds);
  else if (action === 'generate-scene')    await actionGenerateScene(galleryId, sceneNum);
  else if (action === 'generate-all-scenes') await actionGenerateAllScenes(galleryId);
  else if (action === 'skip-scene')        await actionSkipScene(galleryId, sceneNum);
  else if (action === 'build')             await actionBuild(galleryId);
  else if (action === 'gen-char-image')    await charActions.genCharImage(CHAR_CTX, charIdArg);
  else if (action === 'gen-anime-ref')     await charActions.genAnimeRef(CHAR_CTX, charIdArg);
  else if (action === 'comic')             await require('./pipeline/comic').runComic(
    { COMFY_CFG, ROOT, GALLERY, saveMeta: m => writeMeta(galleryId || (m.id), m) },
    { prompt, id: galleryId || Date.now().toString(), charIds });
  else                                     actionStatus(galleryId);
})().catch(e => { console.error('❌', e.message); _exitError = e.message; process.exit(1); });
