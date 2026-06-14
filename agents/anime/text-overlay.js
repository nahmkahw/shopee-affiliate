/**
 * text-overlay.js — ฝังข้อความภาษาไทยลงบนรูปด้วย FFmpeg drawtext
 *
 * รองรับตำแหน่ง: top | center | bottom
 * ใช้ฟอนต์ไทย (Tahoma) — รองรับสระ/วรรณยุกต์
 */

const { execFileSync, execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const FFMPEG    = process.env.FFMPEG_PATH || 'ffmpeg';
const FONT_FILE = process.env.THAI_FONT || 'C:/Windows/Fonts/tahoma.ttf';

// ตรวจ FFmpeg
function hasFFmpeg() {
  try { execSync(`"${FFMPEG}" -version`, { stdio: 'ignore' }); return true; }
  catch {
    for (const p of ['C:/ffmpeg/bin/ffmpeg.exe', 'C:/Program Files/ffmpeg/bin/ffmpeg.exe']) {
      if (fs.existsSync(p)) return p;
    }
    return false;
  }
}

// escape ข้อความสำหรับ drawtext
function escapeDrawtext(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "’")     // ' → ’ (กัน quote แตก)
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%');
}

// แปลง \n เป็นหลายบรรทัด (drawtext ใช้ไฟล์ text หรือ \n ภายใน)
// ใช้วิธี textfile เพื่อความปลอดภัยกับ unicode ไทย
function writeTextFile(text) {
  const os  = require('os');
  const tmp = path.join(os.tmpdir(), `anime_txt_${Date.now()}.txt`);
  fs.writeFileSync(tmp, text, 'utf8');
  return tmp;
}

/**
 * ฝังข้อความลงรูป
 * @param {string} imgPath   รูปต้นทาง
 * @param {string} text      ข้อความไทย (รองรับหลายบรรทัดด้วย \n)
 * @param {object} opts      { position:'top|center|bottom', fontSize, color, outPath }
 * @returns {string} outPath
 */
function overlayText(imgPath, text, opts = {}) {
  const {
    position = 'bottom',
    fontSize = 64,
    color    = 'white',
    outPath  = imgPath.replace(/\.(\w+)$/, '_text.$1'),
  } = opts;

  const bin = hasFFmpeg();
  if (!bin) throw new Error('ไม่พบ FFmpeg — ติดตั้งก่อน (winget install Gyan.FFmpeg)');
  const ffmpeg = bin === true ? FFMPEG : bin;

  if (!text || !text.trim()) {
    // ไม่มีข้อความ → แค่ copy
    fs.copyFileSync(imgPath, outPath);
    return outPath;
  }

  // ตำแหน่งแนวตั้ง (มี margin จากขอบ)
  const yByPos = {
    top:    'h*0.07',
    center: '(h-text_h)/2',
    bottom: 'h-text_h-h*0.07',
  };
  const y = yByPos[position] || yByPos.bottom;

  const fontFileEsc = FONT_FILE.replace(/\\/g, '/').replace(/:/g, '\\:');
  const txtFile     = writeTextFile(text);
  const txtFileEsc  = txtFile.replace(/\\/g, '/').replace(/:/g, '\\:');

  // กล่องดำโปร่งใสรองข้อความ ให้อ่านง่ายบนทุกพื้นหลัง
  const drawtext =
    `drawtext=fontfile='${fontFileEsc}':textfile='${txtFileEsc}':` +
    `fontcolor=${color}:fontsize=${fontSize}:` +
    `x=(w-text_w)/2:y=${y}:` +
    `box=1:boxcolor=black@0.5:boxborderw=24:line_spacing=14`;

  try {
    execFileSync(ffmpeg, ['-y', '-i', imgPath, '-vf', drawtext, '-update', '1', '-frames:v', '1', outPath],
      { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'ignore', 'pipe'] });
  } finally {
    try { fs.unlinkSync(txtFile); } catch {}
  }
  return outPath;
}

module.exports = { overlayText, hasFFmpeg };
