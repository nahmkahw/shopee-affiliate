'use strict';
/**
 * agents/maprang/run.js — Agent มะปราง: Anime Story Video Generator
 *
 * Actions:
 *   --action check              ตรวจ ComfyUI + Wan2.1 model
 *   --action generate           สร้างวิดีโอ (อ่าน prompt จาก --prompt หรือ stdin)
 *   --action status [--id ID]   ดูสถานะ gallery ล่าสุด / gallery ID ที่ระบุ
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const http = require('http');

const { generateScenes }  = require('./pipeline/scene-gen');
const { checkHealth, checkWan21Model, generateClip } = require('./pipeline/comfy-client');
const { buildStoryVideo } = require('./pipeline/video-build');

const ROOT    = path.join(__dirname);
const GALLERY = path.join(ROOT, 'gallery');

const COMFY_CFG = {
  host:      process.env.COMFY_HOST      || '10.3.17.118',
  port:      parseInt(process.env.COMFY_PORT || '8188', 10),
  timeoutMs: parseInt(process.env.COMFY_TIMEOUT_MS || '600000', 10),
  modelName: process.env.WAN21_MODEL || 'Wan2.1\\wan2.1_t2v_1.3B_bf16.safetensors',
};

const TG_TOKEN   = process.env.MAPRANG_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// --- Telegram helpers ---

function _tgPost(method, form) {
  return new Promise(resolve => {
    const body = JSON.stringify(form);
    const req  = http.request({
      hostname: 'api.telegram.org',
      path:     `/bot${TG_TOKEN}/${method}`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => { res.on('data', () => {}); res.on('end', resolve); });
    req.setTimeout(15000, () => { req.destroy(); resolve(); });
    req.on('error', resolve);
    req.write(body); req.end();
  });
}

async function sendTelegramPreview(galleryId, storyPath, meta) {
  if (!TG_TOKEN || !TG_CHAT_ID) {
    console.warn('⚠️  ไม่มี TELEGRAM token — ข้าม Telegram preview');
    return;
  }
  const caption =
    `🎌 <b>มะปราง — Anime Story</b>\n\n` +
    `📖 ${meta.prompt.substring(0, 200)}\n\n` +
    `🎬 ${meta.scenes.length} scenes | ${meta.scenes.map(s => s.subtitle_th).join(' → ')}\n\n` +
    `ID: <code>${galleryId}</code>`;

  // ส่งเป็น document (video file ขนาดใหญ่)
  const boundary = '----MPBoundary' + Math.random().toString(36).substring(2);
  const videoBuf = fs.readFileSync(storyPath);
  const head1    = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${TG_CHAT_ID}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption.substring(0, 1024)}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="story.mp4"\r\nContent-Type: video/mp4\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body  = Buffer.concat([head1, videoBuf, tail]);

  await new Promise(resolve => {
    const req = http.request({
      hostname: 'api.telegram.org',
      path:     `/bot${TG_TOKEN}/sendVideo`,
      method:   'POST',
      headers:  { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
    }, res => { res.on('data', () => {}); res.on('end', resolve); });
    req.setTimeout(120000, () => { req.destroy(); resolve(); });
    req.on('error', resolve);
    req.write(body); req.end();
  });
  console.log('📱 ส่ง Telegram preview แล้ว');
}

// --- Actions ---

async function actionCheck() {
  console.log(`🔍 ตรวจสอบ ComfyUI @ ${COMFY_CFG.host}:${COMFY_CFG.port}`);
  const alive = await checkHealth(COMFY_CFG);
  if (!alive) {
    console.error(`❌ ComfyUI ไม่ตอบสนอง — ตรวจสอบว่า ComfyUI รันอยู่ที่ ${COMFY_CFG.host}:${COMFY_CFG.port}`);
    process.exit(1);
  }
  console.log('✅ ComfyUI online');
  const { found, models } = await checkWan21Model(COMFY_CFG);
  if (found) console.log(`✅ Wan2.1 models: ${models.join(', ')}`);
  else        console.log('❌ Wan2.1 ยังไม่ได้ติดตั้ง (ดูคำแนะนำด้านบน)');
}

async function actionGenerate(prompt) {
  if (!prompt) { console.error('❌ ต้องระบุ --prompt "..."'); process.exit(1); }

  const id  = Date.now().toString();
  const dir = path.join(GALLERY, id);
  fs.mkdirSync(dir, { recursive: true });

  const meta = { id, prompt, created_at: new Date().toISOString(), status: 'generating', scenes: [] };
  const saveMeta = () => fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  saveMeta();

  console.log(`\n🎌 Agent มะปราง — เริ่มสร้าง Anime Story Video\n📖 Prompt: ${prompt}\n`);

  // 1. Scene breakdown
  const scenes = await generateScenes(prompt);
  meta.scenes  = scenes;
  saveMeta();

  // 2. Generate clips
  console.log('\n🎬 Generate video clips จาก ComfyUI Wan2.1...');
  const clipsDir = path.join(dir, 'clips');
  fs.mkdirSync(clipsDir, { recursive: true });

  const clipData = [];
  for (const scene of scenes) {
    const clipPath = path.join(clipsDir, `clip_${scene.scene_number}.mp4`);
    console.log(`\n[Scene ${scene.scene_number}/5]`);
    await generateClip(COMFY_CFG, scene.visual_prompt_en, clipPath);
    clipData.push({ clipPath, subtitle_th: scene.subtitle_th });
  }

  // 3. Subtitle + concat
  const storyPath = await buildStoryVideo(clipData, dir);
  meta.story_path = storyPath;
  meta.status     = 'pending_approval';
  saveMeta();

  // 4. Telegram preview
  await sendTelegramPreview(id, storyPath, meta);

  console.log(`\n🎉 เสร็จแล้ว! gallery ID: ${id}`);
  console.log(`   📁 ${dir}`);
  console.log(`   📹 ${storyPath}`);
}

function actionStatus(galleryId) {
  if (!fs.existsSync(GALLERY)) { console.log('ยังไม่มี gallery'); return; }
  const dirs = fs.readdirSync(GALLERY).sort().reverse();
  const targets = galleryId ? [galleryId] : dirs.slice(0, 5);
  for (const id of targets) {
    const meta = path.join(GALLERY, id, 'meta.json');
    if (!fs.existsSync(meta)) continue;
    const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
    console.log(`[${id}] ${m.status} — ${m.prompt?.substring(0, 60)}`);
  }
}

// --- Main ---

const args     = process.argv.slice(2);
const action   = args[args.indexOf('--action') + 1] || 'status';
const promptI  = args.indexOf('--prompt');
const prompt   = promptI !== -1 ? args[promptI + 1] : null;
const idI      = args.indexOf('--id');
const galleryId = idI !== -1 ? args[idI + 1] : null;

(async () => {
  if (action === 'check')    await actionCheck();
  else if (action === 'generate') await actionGenerate(prompt);
  else                       actionStatus(galleryId);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
