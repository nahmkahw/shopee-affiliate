'use strict';
/**
 * agents/maprao/run.js — Agent มะพร้าว: B&W Manga Comic Strip Generator
 * --action comic | gen-mascot-ref | status
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const fs   = require('fs');
const path = require('path');

const mascot = require('./pipeline/mascot');

const ROOT          = path.join(__dirname, '..', '..');
const GALLERY       = path.join(__dirname, 'gallery');
const PIPELINE_ROOT = path.join(__dirname, 'pipeline');
const NEWS_DIR       = path.join(PIPELINE_ROOT, 'news');

const COMFY_CFG = {
  host:      process.env.COMFY_HOST     || '10.3.17.118',
  port:      parseInt(process.env.COMFY_PORT || '8188', 10),
  timeoutMs: parseInt(process.env.COMFY_TIMEOUT_MS || '900000', 10),
};

function readMeta(id) {
  const p = path.join(GALLERY, id, 'meta.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeMeta(id, meta) {
  fs.mkdirSync(path.join(GALLERY, id), { recursive: true });
  fs.writeFileSync(path.join(GALLERY, id, 'meta.json'), JSON.stringify(meta, null, 2));
}

async function actionComic(prompt, id) {
  if (!prompt) { console.error('❌ ต้องระบุ --prompt'); process.exit(1); }
  const ctx = { COMFY_CFG, ROOT, GALLERY, PIPELINE_ROOT, NEWS_DIR, saveMeta: m => writeMeta(id, m) };
  await require('./pipeline/comic').runComic(ctx, { prompt, id });
}

async function actionGenMascotRef() {
  await mascot.generateMascotRef(COMFY_CFG, Math.floor(Math.random() * 1e9));
}

async function actionVideo(id) {
  if (!id) { console.error('❌ ต้องระบุ --id'); process.exit(1); }
  const meta = readMeta(id);
  if (!meta) { console.error(`❌ ไม่พบ meta.json ของ ${id}`); process.exit(1); }
  const dir = path.join(GALLERY, id);
  const { buildComicVideo } = require('./pipeline/comic-video');
  await buildComicVideo(meta, dir);
}

function actionStatus(galleryId) {
  if (!fs.existsSync(GALLERY)) { console.log('ยังไม่มี gallery'); return; }
  const targets = galleryId ? [galleryId] : fs.readdirSync(GALLERY).sort().reverse().slice(0, 5);
  for (const gid of targets) {
    const m = readMeta(gid);
    if (!m) continue;
    console.log(`[${gid}] ${m.status} — ${m.prompt?.substring(0, 50)}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

const args      = process.argv.slice(2);
const arg       = f => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const action    = arg('--action') || 'status';
const prompt    = arg('--prompt');
const galleryId = arg('--id');
const mode      = arg('--mode');
const actualId  = galleryId || Date.now().toString(); // คำนวณครั้งเดียวที่ top — ใช้ทั้ง comic + chain video

// เขียน status='error' ตอน exit ผิดปกติ — กัน job ค้าง active (pattern เดียวกับมะปราง)
let _exitError = null;
process.on('exit', code => {
  if (code === 0) return;
  try {
    const m = actualId && readMeta(actualId);
    if (m && m.status === 'producing') {
      m.status = 'error';
      m.error_reason = _exitError || 'process exited abnormally';
      m.logs = m.logs || [];
      m.logs.push({ t: new Date().toISOString(), msg: `❌ ล้มเหลว: ${m.error_reason}` });
      writeMeta(actualId, m);
    }
  } catch {}
});

(async () => {
  if (action === 'comic') {
    await actionComic(prompt, actualId);
    if (mode === 'video') await actionVideo(actualId); // chain วิดีโอต่อทันทีถ้าส่ง --mode video
  } else if (action === 'gen-mascot-ref') await actionGenMascotRef();
  else if (action === 'video')            await actionVideo(galleryId);
  else                                    actionStatus(galleryId);
})().catch(e => { console.error('❌', e.message); _exitError = e.message; process.exit(1); });
