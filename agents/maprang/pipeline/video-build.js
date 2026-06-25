'use strict';
/**
 * video-build.js — เพิ่ม subtitle ทับ clip แต่ละตัว แล้ว concat ด้วย FFmpeg
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execFileSync, execSync } = require('child_process');

const FFMPEG    = process.env.FFMPEG_PATH || 'ffmpeg';
const FONT_FILE = process.env.THAI_FONT   || 'C:/Windows/Fonts/tahoma.ttf';

function resolveFFmpeg() {
  try { execSync(`"${FFMPEG}" -version`, { stdio: 'ignore' }); return FFMPEG; } catch {}
  for (const p of ['C:/ffmpeg/bin/ffmpeg.exe', 'C:/Program Files/ffmpeg/bin/ffmpeg.exe']) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('ไม่พบ FFmpeg — ติดตั้ง: winget install Gyan.FFmpeg');
}

function writeTmpText(text) {
  const tmp = path.join(os.tmpdir(), `maprang_${Date.now()}.txt`);
  fs.writeFileSync(tmp, text, 'utf8');
  return tmp;
}

/**
 * เพิ่ม Thai subtitle ลงบนวิดีโอ clip
 * @param {string} clipPath   input .mp4
 * @param {string} text       subtitle ภาษาไทย
 * @param {string} outPath    output .mp4
 */
function addSubtitle(clipPath, text, outPath) {
  const ffmpeg = resolveFFmpeg();

  if (!text || !text.trim()) {
    fs.copyFileSync(clipPath, outPath);
    return outPath;
  }

  const fontEsc = FONT_FILE.replace(/\\/g, '/').replace(/:/g, '\\:');
  const txtFile = writeTmpText(text);
  const txtEsc  = txtFile.replace(/\\/g, '/').replace(/:/g, '\\:');

  const drawtext =
    `drawtext=fontfile='${fontEsc}':textfile='${txtEsc}':` +
    `fontcolor=white:fontsize=52:` +
    `x=(w-text_w)/2:y=h-text_h-h*0.08:` +
    `box=1:boxcolor=black@0.55:boxborderw=20:line_spacing=12`;

  try {
    execFileSync(ffmpeg, [
      '-y', '-i', clipPath,
      '-vf', drawtext,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'copy',
      outPath,
    ], { timeout: 120000, stdio: ['ignore', 'ignore', 'pipe'] });
  } finally {
    try { fs.unlinkSync(txtFile); } catch {}
  }
  return outPath;
}

// Ken Burns motion presets — pan/zoom ต่างกันต่อ scene ให้ภาพนิ่งดูมีชีวิต
const KB_VARIANTS = [
  "z='min(zoom+0.0012,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'",       // zoom in center
  "z='if(eq(on,1),1.18,max(zoom-0.0012,1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'", // zoom out
  "z='1.12':x='(iw-iw/zoom)*on/D':y='ih/2-(ih/zoom/2)'",                          // pan left→right
  "z='1.12':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*on/D'",                          // pan top→bottom
];

/**
 * Animate still image → clip ด้วย Ken Burns (pan/zoom) — ใช้กับ Flux Kontext scene still
 * รับประกันตัวละครคงเดิม (เป็นภาพเดียวกัน) ต่างจาก T2V ที่วาดใหม่
 * @param {string} imagePath  scene still .png
 * @param {string} outPath    output .mp4
 * @param {object} [opts]     { durationSec=3, fps=16, size=512, variant=0 }
 */
function kenBurnsClip(imagePath, outPath, opts = {}) {
  const ffmpeg   = resolveFFmpeg();
  const { durationSec = 3, fps = 16, size = 512, variant = 0 } = opts;
  const frames   = Math.round(durationSec * fps);
  const motion   = KB_VARIANTS[variant % KB_VARIANTS.length].replace(/D/g, String(frames));
  const big      = size * 2; // upscale ก่อน zoompan กัน jitter
  const vf = `scale=${big}:${big}:force_original_aspect_ratio=increase,crop=${big}:${big},` +
             `zoompan=${motion}:d=${frames}:s=${size}x${size}:fps=${fps},format=yuv420p`;
  execFileSync(ffmpeg, [
    '-y', '-loop', '1', '-i', imagePath, '-t', String(durationSec), '-r', String(fps),
    '-vf', vf, '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    outPath,
  ], { timeout: 120000, stdio: ['ignore', 'ignore', 'pipe'] });
  return outPath;
}

/**
 * ขยาย clip ให้ยาวเท่า durationSec โดยค้างเฟรมสุดท้าย — ใช้กับ T2V fallback ที่ยาวคงที่
 * (Ken Burns path สร้าง clip ความยาวพอดีตั้งแต่แรกอยู่แล้ว ไม่ต้องใช้)
 * @param {string} clipPath  input .mp4
 * @param {string} outPath   output .mp4
 * @param {number} durationSec  ความยาวเป้าหมาย
 */
function extendClipToDuration(clipPath, outPath, durationSec) {
  const ffmpeg = resolveFFmpeg();
  execFileSync(ffmpeg, [
    '-y', '-i', clipPath,
    '-vf', `tpad=stop_mode=clone:stop_duration=${durationSec}`,
    '-t', String(durationSec),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    outPath,
  ], { timeout: 120000, stdio: ['ignore', 'ignore', 'pipe'] });
  return outPath;
}

/**
 * Concat หลาย .mp4 เป็นไฟล์เดียว
 * @param {string[]} clipPaths  รายการ clip ตามลำดับ
 * @param {string}   outPath    output .mp4
 */
function concatClips(clipPaths, outPath) {
  const ffmpeg   = resolveFFmpeg();
  const listFile = path.join(os.tmpdir(), `maprang_concat_${Date.now()}.txt`);
  const content  = clipPaths.map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "\\'")}'`).join('\n');
  fs.writeFileSync(listFile, content, 'utf8');

  try {
    execFileSync(ffmpeg, [
      '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'copy',
      outPath,
    ], { timeout: 300000, stdio: ['ignore', 'ignore', 'pipe'] });
  } finally {
    try { fs.unlinkSync(listFile); } catch {}
  }
  return outPath;
}

/**
 * Full build: subtitle แต่ละ clip → concat → story.mp4
 * @param {Array<{clipPath, subtitle_th}>} clips
 * @param {string} outputDir  โฟลเดอร์บันทึก
 * @returns {string} path ของ story.mp4
 */
async function buildStoryVideo(clips, outputDir) {
  const ffmpeg = resolveFFmpeg();
  console.log(`\n🎞️  สร้างวิดีโอ: ${clips.length} clips → story.mp4`);

  const subtitledPaths = [];
  for (const [i, { clipPath, subtitle_th }] of clips.entries()) {
    const out = path.join(outputDir, `clip_sub_${i + 1}.mp4`);
    console.log(`  [${i + 1}/${clips.length}] subtitle: "${subtitle_th}"`);
    addSubtitle(clipPath, subtitle_th, out);
    subtitledPaths.push(out);
  }

  const storyPath = path.join(outputDir, 'story.mp4');
  concatClips(subtitledPaths, storyPath);

  // ลบไฟล์ subtitle tmp
  subtitledPaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });

  console.log(`✅ story.mp4 พร้อม: ${storyPath}`);
  return storyPath;
}

module.exports = { addSubtitle, concatClips, buildStoryVideo, kenBurnsClip, extendClipToDuration };
