'use strict';
/**
 * agents/maprao/run.js — Agent มะพร้าว: B&W Manga Comic Strip Generator
 * --action comic | gen-mascot-ref | status
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const fs   = require('fs');
const path = require('path');

const { sendNotification } = require('../../lib/tg-notify');
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
  const actualId = id || Date.now().toString();
  const ctx = { COMFY_CFG, ROOT, GALLERY, PIPELINE_ROOT, NEWS_DIR, saveMeta: m => writeMeta(actualId, m) };
  await require('./pipeline/comic').runComic(ctx, { prompt, id: actualId });
}

// comic-video: สร้างการ์ตูน (→ ส่ง TG approval) + สร้างวิดีโอ (→ ส่ง TG sendVideo)
async function actionComicVideo(prompt, id) {
  if (!prompt) { console.error('❌ ต้องระบุ --prompt'); process.exit(1); }
  const actualId = id || Date.now().toString();
  const dir = path.join(GALLERY, actualId);
  const ctx = { COMFY_CFG, ROOT, GALLERY, PIPELINE_ROOT, NEWS_DIR, saveMeta: m => writeMeta(actualId, m) };

  // ขั้น 1: สร้างการ์ตูน + ส่ง TG approval (รูป comic.png + ปุ่ม Approve)
  await require('./pipeline/comic').runComic(ctx, { prompt, id: actualId });

  // ขั้น 2: สร้างวิดีโอ Reels 9:16
  const meta = readMeta(actualId);
  console.log('\n🎬 ต่อเนื่อง: สร้างวิดีโอ Reels...');
  meta.video_status = 'producing';
  writeMeta(actualId, meta);
  try {
    const { buildComicVideo }     = require('./pipeline/comic-video');
    const { sendVideoToTelegram } = require('../../lib/tg-approval');
    const videoPath = await buildComicVideo(meta, dir, msg => console.log('  ' + msg));
    meta.video_status = 'done';
    meta.story_video  = 'story.mp4';
    writeMeta(actualId, meta);
    console.log(`✅ วิดีโอพร้อม: ${videoPath}`);

    // ขั้น 3: ส่งวิดีโอไป Telegram
    const caption = `🎬 <b>วิดีโอ Reels พร้อมแล้ว!</b>\n📖 <i>${prompt.substring(0, 120)}</i>`;
    const res = await sendVideoToTelegram(videoPath, caption);
    if (res && res.ok) console.log('✅ ส่งวิดีโอไป Telegram แล้ว');
    else console.warn('⚠️ ส่งวิดีโอไม่สำเร็จ:', res?.description || 'no response');
  } catch (e) {
    meta.video_status = 'error';
    writeMeta(actualId, meta);
    throw e;
  }
}

async function actionVideo(galleryId) {
  if (!galleryId) { console.error('❌ ต้องระบุ --id'); process.exit(1); }
  const meta = readMeta(galleryId);
  if (!meta) { console.error('❌ ไม่พบ gallery item:', galleryId); process.exit(1); }
  const dir = path.join(GALLERY, galleryId);
  console.log(`\n🎬 มะพร้าว — สร้างวิดีโอ: ${galleryId}\n📖 ${meta.prompt}\n`);
  meta.video_status = 'producing';
  writeMeta(galleryId, meta);
  try {
    const { buildComicVideo } = require('./pipeline/comic-video');
    const videoPath = await buildComicVideo(meta, dir, msg => console.log('  ' + msg));
    meta.video_status = 'done';
    meta.story_video  = 'story.mp4';
    writeMeta(galleryId, meta);
    console.log(`✅ วิดีโอพร้อม: ${videoPath}`);
    sendNotification(`🎬 <b>วิดีโอพร้อมแล้ว!</b>\n📖 ${(meta.prompt || '').slice(0, 80)}\nดาวน์โหลดได้ที่ Dashboard`).catch(() => {});
  } catch (e) {
    meta.video_status = 'error';
    writeMeta(galleryId, meta);
    throw e;
  }
}

async function actionGenMascotRef(detail) {
  await mascot.generateMascotRef(COMFY_CFG, Math.floor(Math.random() * 1e9), detail || '');
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
const detail    = arg('--detail');

// เขียน status='error' ตอน exit ผิดปกติ — กัน job ค้าง active (pattern เดียวกับมะปราง)
let _exitError = null;
process.on('exit', code => {
  if (code === 0) return;
  try {
    const m = galleryId && readMeta(galleryId);
    if (m && m.status === 'producing') {
      m.status = 'error';
      m.error_reason = _exitError || 'process exited abnormally';
      m.logs = m.logs || [];
      m.logs.push({ t: new Date().toISOString(), msg: `❌ ล้มเหลว: ${m.error_reason}` });
      writeMeta(galleryId, m);
    }
  } catch {}
});

(async () => {
  if (action === 'comic')               await actionComic(prompt, galleryId);
  else if (action === 'comic-video')    await actionComicVideo(prompt, galleryId);
  else if (action === 'video')          await actionVideo(galleryId);
  else if (action === 'gen-mascot-ref') await actionGenMascotRef(detail);
  else                                  actionStatus(galleryId);
})().catch(async e => {
  console.error('❌', e.message);
  _exitError = e.message;
  await sendNotification(`❌ <b>มะพร้าว Error</b>\n<code>${e.message.slice(0, 200)}</code>`).catch(() => {});
  process.exit(1);
});
