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

module.exports = { addSubtitle, concatClips, buildStoryVideo };
