'use strict';
/**
 * agents/maprang/run.js — Agent มะปราง: Anime Story Video Generator
 * --action check | generate | status
 */

require('dotenv').config();

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const { generateScenes, generateScenesWithCharacters, generateCharacterDescription, buildCharacterNegative, describeCharacterImage } = require('./pipeline/scene-gen');
const { checkHealth, checkWan21Model, generateClip, generateCharacterImage } = require('./pipeline/comfy-client');
const { buildStoryVideo }                        = require('./pipeline/video-build');
const charReg = require('./pipeline/char-registry');

const GALLERY   = path.join(__dirname, 'gallery');
const COMFY_CFG = {
  host:      process.env.COMFY_HOST     || '10.3.17.118',
  port:      parseInt(process.env.COMFY_PORT || '8188', 10),
  timeoutMs: parseInt(process.env.COMFY_TIMEOUT_MS || '600000', 10),
  modelName: process.env.WAN21_MODEL    || 'Wan2.1\\wan2.1_t2v_1.3B_bf16.safetensors',
};
const TG_TOKEN   = process.env.MAPRANG_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TG_OK      = !!(TG_TOKEN && TG_CHAT_ID);

// ─── Telegram helpers ────────────────────────────────────────────────────────

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
  if (!TG_OK) { console.warn('⚠️  ไม่มี TELEGRAM token — ข้าม'); return; }
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
    req.setTimeout(120000, () => { req.destroy(); resolve({ ok: false, description: 'timeout' }); });
    req.on('error', e => resolve({ ok: false, description: e.message }));
    req.write(body); req.end();
  });
  if (r.ok) console.log('📱 ส่ง Telegram video สำเร็จ');
  else {
    console.error(`⚠️  Telegram sendVideo ล้มเหลว: ${r.description || JSON.stringify(r)}`);
    console.error(`   TOKEN: ${TG_TOKEN?.substring(0, 10)}... CHAT_ID: ${TG_CHAT_ID}`);
  }
}

async function tgSendPhoto(photoPath, caption) {
  if (!TG_OK) return;
  const boundary = '----MPB' + Math.random().toString(36).substring(2);
  const photoBuf = fs.readFileSync(photoPath);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${TG_CHAT_ID}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption.substring(0, 1024)}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="char_ref.png"\r\nContent-Type: image/png\r\n\r\n`
  );
  const body = Buffer.concat([head, photoBuf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const r = await new Promise(resolve => {
    const req = https.request({
      hostname: 'api.telegram.org', path: `/bot${TG_TOKEN}/sendPhoto`,
      method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
    }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve({}); } });
    });
    req.setTimeout(30000, () => { req.destroy(); resolve({}); });
    req.on('error', () => resolve({}));
    req.write(body); req.end();
  });
  if (r.ok) console.log('📸 ส่ง Telegram photo สำเร็จ');
  else console.warn(`⚠️  Telegram sendPhoto: ${r.description || JSON.stringify(r)}`);
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function actionCheck() {
  const alive = await checkHealth(COMFY_CFG);
  if (!alive) { console.error(`❌ ComfyUI ไม่ตอบสนอง`); process.exit(1); }
  console.log('✅ ComfyUI online');
  const { found, models } = await checkWan21Model(COMFY_CFG);
  console.log(found ? `✅ Wan2.1: ${models.join(', ')}` : '❌ ไม่พบ Wan2.1 model');
}

async function actionGenerate(prompt, idOverride, charDescOverride, charIdsArg) {
  if (!prompt) { console.error('❌ ต้องระบุ --prompt'); process.exit(1); }

  const id  = idOverride || Date.now().toString();
  const dir = path.join(GALLERY, id);
  fs.mkdirSync(dir, { recursive: true });
  const saveMeta = m => fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(m, null, 2));

  const sharedSeed = Math.floor(Math.random() * 1e10);
  const meta = { id, prompt, created_at: new Date().toISOString(), status: 'generating', seed: sharedSeed, scenes: [] };
  saveMeta(meta);
  console.log(`\n🎌 มะปราง — เริ่มสร้าง\n📖 ${prompt}\n`);

  // 1. โหลด/เตรียม characters
  const allChars   = charReg.load();
  const useCharIds = charIdsArg
    ? charIdsArg.split(',').map(s => s.trim()).filter(id => allChars[id])
    : Object.keys(allChars);
  const useChars   = Object.fromEntries(useCharIds.map(id => [id, allChars[id]]));
  const isMulti    = useCharIds.length > 0;

  // 2. Scene breakdown
  const scenes = isMulti
    ? await generateScenesWithCharacters(prompt, useChars)
    : await generateScenes(prompt);

  // 3. Single-char fallback: สร้าง charDesc จาก story หรือ override
  let singleCharDesc = '', singleCharNeg = '';
  if (!isMulti) {
    singleCharDesc = charDescOverride || await generateCharacterDescription(prompt);
    singleCharNeg  = buildCharacterNegative(singleCharDesc);
    meta.character_description = singleCharDesc;
    meta.character_negative    = singleCharNeg;
  } else {
    meta.characters = useCharIds;
  }
  saveMeta(meta);

  // 4. สร้าง ref image + vision describe (single-char) หรือ per-character (multi)
  if (!isMulti) {
    const refImagePath = path.join(dir, 'char_ref.png');
    let anchorDesc = singleCharDesc;
    try {
      await generateCharacterImage(COMFY_CFG, singleCharDesc, refImagePath, sharedSeed);
      meta.ref_image = 'char_ref.png';
      saveMeta(meta);
      const vd = await describeCharacterImage(refImagePath);
      if (vd) { anchorDesc = vd; meta.anchor_description = anchorDesc; saveMeta(meta); }
    } catch (e) { console.warn(`⚠️  ข้าม ref image: ${e.message}`); }
    singleCharDesc = anchorDesc;
  }

  // 5. Build final scene list พร้อม injected character descriptions
  meta.scenes = scenes.map(s => {
    const charPrompt = isMulti
      ? charReg.buildSceneCharPrompt(s.characters, useChars)
      : singleCharDesc;
    const charNeg = isMulti
      ? charReg.buildSceneCharNeg(s.characters, useChars)
      : singleCharNeg;
    return {
      ...s, status: 'pending', _charNeg: charNeg,
      visual_prompt_en: s.visual_prompt_en.replace(/^anime style,\s*/i, `anime style, ${charPrompt}, `),
    };
  });
  saveMeta(meta);

  // ส่ง Telegram เริ่มต้น
  const refImagePath = path.join(dir, 'char_ref.png');
  const sceneList = meta.scenes.map(s => `  ${s.scene_number}. ${s.subtitle_th}`).join('\n');
  if (!isMulti && fs.existsSync(refImagePath)) {
    await tgSendPhoto(refImagePath,
      `🎨 <b>ตัวละคร Reference</b>\n\n📖 ${prompt.substring(0, 100)}\n\n🎬 ${meta.scenes.length} scenes:\n${sceneList}\n\n⏳ กำลัง generate...`);
  } else {
    const charLabel = isMulti
      ? `👥 Characters: ${useCharIds.map(id => useChars[id].name || id).join(', ')}`
      : `🧑 Character: ${singleCharDesc}`;
    await tgSendText(`🎌 <b>มะปราง — เริ่มสร้างวิดีโอ</b>\n\n📖 ${prompt.substring(0, 150)}\n\n${charLabel}\n\n🎬 ${meta.scenes.length} scenes:\n${sceneList}\n\n⏳ กำลัง generate...`);
  }

  // 6. Generate clips
  const clipsDir = path.join(dir, 'clips');
  fs.mkdirSync(clipsDir, { recursive: true });
  const clipData = [];

  for (let i = 0; i < meta.scenes.length; i++) {
    const scene    = meta.scenes[i];
    const clipPath = path.join(clipsDir, `clip_${scene.scene_number}.mp4`);

    scene.status     = 'generating';
    scene.started_at = new Date().toISOString();
    saveMeta(meta);

    console.log(`\n[Scene ${scene.scene_number}/${meta.scenes.length}] ${scene.subtitle_th}`);
    await generateClip(COMFY_CFG, scene.visual_prompt_en, clipPath, sharedSeed, scene._charNeg || '');

    scene.status  = 'done';
    scene.done_at = new Date().toISOString();
    saveMeta(meta);
    clipData.push({ clipPath, subtitle_th: scene.subtitle_th });

    await tgSendText(
      `✅ Scene ${scene.scene_number}/${meta.scenes.length} เสร็จแล้ว\n` +
      `🎬 "${scene.subtitle_th}"\n` +
      `(${meta.scenes.filter(s => s.status === 'done').length}/${meta.scenes.length} scenes done)`
    );
  }

  // 4. Subtitle + concat
  console.log('\n🎞️  สร้าง story.mp4...');
  meta.status = 'building';
  saveMeta(meta);
  const storyPath = await buildStoryVideo(clipData, dir);
  meta.story_path = storyPath;
  meta.status     = 'pending_approval';
  saveMeta(meta);

  // 5. ส่ง Telegram video พร้อม caption สรุป
  const caption =
    `🎌 <b>มะปราง — Anime Story พร้อมแล้ว!</b>\n\n` +
    `📖 ${meta.prompt.substring(0, 200)}\n\n` +
    `🎬 ${meta.scenes.length} scenes: ${meta.scenes.map(s => s.subtitle_th).join(' → ')}\n\n` +
    `🆔 <code>${id}</code>`;
  await tgSendVideo(storyPath, caption);

  console.log(`\n🎉 เสร็จ! ID: ${id}\n   📹 ${storyPath}`);
}

function actionStatus(galleryId) {
  if (!fs.existsSync(GALLERY)) { console.log('ยังไม่มี gallery'); return; }
  const targets = galleryId ? [galleryId] : fs.readdirSync(GALLERY).sort().reverse().slice(0, 5);
  for (const gid of targets) {
    const p = path.join(GALLERY, gid, 'meta.json');
    if (!fs.existsSync(p)) continue;
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    console.log(`[${gid}] ${m.status} — ${m.prompt?.substring(0, 60)}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

const args      = process.argv.slice(2);
const action    = args[args.indexOf('--action') + 1] || 'status';
const promptI   = args.indexOf('--prompt');
const prompt    = promptI !== -1 ? args[promptI + 1] : null;
const idI       = args.indexOf('--id');
const galleryId = idI !== -1 ? args[idI + 1] : null;
const charI     = args.indexOf('--char-desc');
const charDesc  = charI !== -1 ? args[charI + 1] : null;
const charsI    = args.indexOf('--chars');
const charIds   = charsI !== -1 ? args[charsI + 1] : null;

(async () => {
  if (action === 'check')          await actionCheck();
  else if (action === 'generate')  await actionGenerate(prompt, galleryId, charDesc, charIds);
  else                             actionStatus(galleryId);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
