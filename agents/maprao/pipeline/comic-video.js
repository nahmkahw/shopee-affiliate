'use strict';
/**
 * comic-video.js — สร้างวิดีโอ story.mp4 จาก 4 panel stills + Typhoon2 TTS narration
 * Title card (2s) → Panel 1-4 (Ken Burns + gTTS narration + bubble subtitle) → concat
 * รองรับ format: 'square' (1:1) | 'portrait' (9:16 — Reels/TikTok)
 * ควบคุมผ่าน env: MAPRAO_VIDEO_SIZE (default 1080), MAPRAO_VIDEO_FORMAT (default portrait)
 */

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { ollamaChat }                     = require('../../../lib/ollama-chat');
const { generateVoiceover, getMediaDuration } = require('../../../lib/tiktok-tts');
const { kenBurnsClip, concatClips, addSubtitle } = require('../../../lib/video-build');

const FFMPEG       = process.env.FFMPEG_PATH       || 'ffmpeg';
const FONT_FILE    = process.env.THAI_FONT          || 'C:/Windows/Fonts/tahoma.ttf';
const VIDEO_SIZE   = parseInt(process.env.MAPRAO_VIDEO_SIZE   || '1080', 10);
const VIDEO_FORMAT = process.env.MAPRAO_VIDEO_FORMAT || 'portrait'; // square|portrait
const MIN_DUR = 3, MAX_DUR = 8, PUNCHLINE_MAX = 10, FPS = 24;

// บทบาทมุกขำ 4 ช่อง — ใช้เป็น context ให้ Typhoon2 รู้ว่าแต่ละช่องต้องทำหน้าที่ไหน
const ROLES = [
  { label: 'Hook',      hint: 'ดึงคนดูให้อยากรู้ต่อ',          maxWords: 15 },
  { label: 'Setup',     hint: 'อธิบายสถานการณ์/ข่าว',           maxWords: 20 },
  { label: 'Twist',     hint: 'สิ่งที่คนไม่คาดคิด พลิกมุม',    maxWords: 20 },
  { label: 'Punchline', hint: 'มุกปิดตลก ให้คนหัวเราะ',         maxWords: 30 },
];

function resolveFFmpeg() {
  for (const p of [FFMPEG, 'C:/ffmpeg/bin/ffmpeg.exe', 'C:/Program Files/ffmpeg/bin/ffmpeg.exe']) {
    try { execFileSync(p, ['-version'], { stdio: 'ignore' }); return p; } catch {}
  }
  throw new Error('ไม่พบ FFmpeg — ติดตั้ง: winget install Gyan.FFmpeg');
}

// parse "1: ..." / "1. ..." / "1) ..." → clean text array[4]
function parseNarrations(raw) {
  const numbered = raw.split('\n')
    .map(l => l.trim())
    .filter(l => /^[1-4][:.)\s]/.test(l))
    .map(l => l.replace(/^[1-4][:.)\s]+\s*/, '').trim())
    .filter(Boolean);
  if (numbered.length >= 4) return numbered.slice(0, 4);
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  return lines.length >= 4 ? lines.slice(0, 4) : null;
}

const TTS_SPEED = parseFloat(process.env.MAPRAO_TTS_SPEED || '0.9');

// strip ภาษาอังกฤษ/Latin ออกก่อนส่ง TTS — กัน Typhoon2 echo กลับ scene_setting_en
function extractThaiText(text) {
  return text
    .replace(/[a-zA-Z]+/g, ' ')  // ตัด Latin words (scene_setting_en remnants)
    .replace(/\s*\|\s*/g, ' ')   // ตัด | separators
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// เรียก Typhoon2 ครั้งเดียว — เห็นทุกช่องพร้อมกัน → บรรยาย Hook/Setup/Twist/Punchline ที่ต่อเนื่องกัน
async function narrateAllPanels(panels, prompt, concept) {
  const sys = [
    'คุณเป็นคอมิคไรเตอร์ขำขำ เขียนบรรยายเสียงพูดสำหรับวิดีโอ TikTok/Reels ภาษาไทยล้วน',
    'กฎเหล็ก: ห้ามมีคำอังกฤษแม้แต่คำเดียว ชื่อคน/ทีม/สถานที่ให้เขียนทับศัพท์ไทย (FIFA=ฟีฟ่า, Mexico=เม็กซิโก)',
    'กฎเหล็ก: ห้าม copy หรือแปลข้อความ input โดยตรง — เขียนบรรยายใหม่ทั้งหมดจากเนื้อเรื่อง',
    'ใช้ภาษาพูดสบายๆ ไม่เป็นทางการ ประโยคสั้น ตรง ห้ามคำเชื่อมทางการ เช่น ดังนั้น/อย่างไรก็ตาม',
    'ตอบเป็น 4 บรรทัดเท่านั้น ขึ้นต้นด้วย 1: 2: 3: 4: ตามลำดับ ไม่มีข้อความอื่นเพิ่ม',
    'ความยาว: บรรทัด 1-2-3 ไม่เกิน 15 คำ  บรรทัด 4 ไม่เกิน 25 คำ',
  ].join('\n');

  const story = concept?.title || prompt || 'การ์ตูนกระต่าย';
  const panelLines = panels.slice(0, 4).map((p, i) => {
    const role   = ROLES[i] || ROLES[3];
    const bubble = p.bubble?.text_th || '';
    // แยก scene (English ref) กับ bubble (Thai) ให้โมเดลเห็นชัด — ไม่ concat เป็น string เดียว
    return `ช่อง ${i + 1} บทบาท=${role.label}(${role.hint}) บทพูดไทย="${bubble}"`;
  }).join('\n');

  const userMsg = `เรื่อง: ${story}\n${panelLines}\nเขียนบรรยายภาษาไทยล้วน 4 บรรทัด:`;

  try {
    const raw = await ollamaChat(userMsg, sys);
    const parsed = parseNarrations(raw);
    if (parsed) return parsed;
  } catch {}

  return panels.slice(0, 4).map(p => (p.bubble?.text_th || p.scene_setting_en || '').slice(0, 80));
}

// Title card: ข้อความขาวบนพื้นดำ 2 วินาที
function makeTitleCard(text, outPath) {
  const ffmpeg  = resolveFFmpeg();
  const outH    = VIDEO_FORMAT === 'portrait' ? Math.round(VIDEO_SIZE * 16 / 9) : VIDEO_SIZE;
  const fontSize = Math.round(VIDEO_SIZE * 0.062);
  const fontEsc  = FONT_FILE.replace(/\\/g, '/').replace(/:/g, '\\:');
  const safe     = (text || '').replace(/[':]/g, '').slice(0, 60);
  const drawtext = `drawtext=fontfile='${fontEsc}':text='${safe}':fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2`;
  // anullsrc = silent audio — ต้องมี audio track ทุก clip ไม่งั้น concat demuxer ตัด audio ออกทั้งหมด
  execFileSync(ffmpeg, [
    '-y',
    '-f', 'lavfi', '-i', `color=black:size=${VIDEO_SIZE}x${outH}:rate=${FPS}`,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', '2', '-vf', drawtext,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k', '-shortest',
    outPath,
  ], { timeout: 30000, stdio: ['ignore', 'ignore', 'pipe'] });
}

// mix video clip + audio → ปิดเสียงท้ายด้วย apad ให้ยาวพอดี durationSec
function mixAudio(clipPath, audioPath, outPath, durationSec) {
  const ffmpeg = resolveFFmpeg();
  // aresample=44100 — normalize ก่อน apad กัน spec ไม่ตรงกับ title card (gTTS=24kHz mono, title=44100Hz stereo)
  execFileSync(ffmpeg, [
    '-y', '-i', clipPath, '-i', audioPath,
    '-filter_complex', '[1:a]aresample=44100,apad[aout]',
    '-map', '0:v', '-map', '[aout]',
    '-t', String(durationSec), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', outPath,
  ], { timeout: 60000, stdio: ['ignore', 'ignore', 'pipe'] });
}

/**
 * สร้างวิดีโอ story.mp4 จาก meta.panels + panel_N.png ของ gallery item
 * @param {object} meta     meta.json (ต้องมี panels[], concept)
 * @param {string} dir      path gallery/{id}/
 * @param {Function} [log]
 * @returns {Promise<string>} absolute path ของ story.mp4
 */
async function buildComicVideo(meta, dir, log = console.log) {
  const tmpDir = path.join(dir, 'video_tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const clips = [];

  const titleText = (meta.concept?.title || meta.prompt || 'การ์ตูน').slice(0, 50);
  log('🎬 สร้าง title card...');
  const titlePath = path.join(tmpDir, 'title.mp4');
  makeTitleCard(titleText, titlePath);
  clips.push(titlePath);

  const panels = meta.panels || [];
  log('🎭 สร้างบรรยายมุกขำ Hook→Setup→Twist→Punchline...');
  const narrations = await narrateAllPanels(panels, meta.prompt, meta.concept);
  narrations.forEach((n, i) => log(`  ${ROLES[i]?.label || i + 1}: "${n}"`));

  for (let i = 0; i < panels.length; i++) {
    const panel  = panels[i];
    const isLast = i === panels.length - 1;
    const panelImg = path.join(dir, `panel_${panel.panel}.png`);
    if (!fs.existsSync(panelImg)) { log(`⚠️ ไม่พบ panel_${panel.panel}.png — ข้าม`); continue; }

    const raw = narrations[i] || panel.bubble?.text_th || '';
    const narration = extractThaiText(raw).slice(0, 120);
    log(`🎞️  ช่อง ${panel.panel} [${ROLES[i]?.label || ''}]: "${narration}"`);

    const ttsPath = path.join(tmpDir, `tts_${i}.mp3`);
    await generateVoiceover(narration, ttsPath, { speedK: TTS_SPEED });
    const ttsDur  = getMediaDuration(ttsPath);
    const maxDur  = isLast ? PUNCHLINE_MAX : MAX_DUR;
    const clipDur = Math.max(MIN_DUR, Math.min(maxDur, ttsDur + 0.5));

    log(`🎞️  Ken Burns ช่อง ${panel.panel} (${VIDEO_FORMAT}, ${clipDur.toFixed(1)}s)...`);
    const kbPath = path.join(tmpDir, `kb_${i}.mp4`);
    kenBurnsClip(panelImg, kbPath, { durationSec: clipDur, fps: FPS, size: VIDEO_SIZE, format: VIDEO_FORMAT, variant: i });

    const voicedPath = path.join(tmpDir, `voiced_${i}.mp4`);
    mixAudio(kbPath, ttsPath, voicedPath, clipDur);

    const finalClip = path.join(tmpDir, `clip_${i}.mp4`);
    const subtitle  = panel.bubble?.text_th || '';
    if (subtitle) addSubtitle(voicedPath, subtitle, finalClip);
    else fs.copyFileSync(voicedPath, finalClip);
    clips.push(finalClip);
  }

  const outPath = path.join(dir, 'story.mp4');
  log(`🔗 concat ${clips.length} clips → story.mp4`);
  concatClips(clips, outPath);
  return outPath;
}

module.exports = { buildComicVideo };
