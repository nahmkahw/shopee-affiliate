'use strict';

const fs   = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const FFMPEG  = process.env.FFMPEG_PATH  || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const PYTHON  = process.env.PYTHON_PATH  || 'python';

// pitch shift คงความยาว: asetrate เปลี่ยน pitch+speed → atempo ดึง speed กลับ (gTTS = 24kHz mono)
function applyPitch(srcPath, outPath, pitchK) {
  execFileSync(FFMPEG, [
    '-y', '-i', srcPath,
    '-af', `asetrate=24000*${pitchK},aresample=24000,atempo=${(1 / pitchK).toFixed(4)}`,
    outPath,
  ], { timeout: 20000, stdio: ['ignore', 'ignore', 'pipe'] });
}

/**
 * @param {string} text
 * @param {string} outputPath
 * @param {object} [opts]  { pitchK } — แยกเสียงตามตัวละคร (1=ปกติ, <1 ทุ้ม, >1 แหลม)
 */
async function generateVoiceover(text, outputPath, opts = {}) {
  const { pitchK = 1 } = opts;
  const cleanText = text.replace(/^["']+|["']+$/g, '').trim();

  if (!cleanText) {
    execFileSync(FFMPEG, [
      '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
      '-t', '1', '-c:a', 'aac', '-b:a', '128k', outputPath,
    ], { encoding: 'utf8', timeout: 15000 });
    return;
  }

  // gTTS (Google TTS) — ฟรี 100%, ไม่ต้อง API key, ไทยคุณภาพดี, ไม่มี rate limit
  const gttsTarget = pitchK !== 1 ? outputPath + '.raw.mp3' : outputPath;
  const script = `from gtts import gTTS; gTTS(text=${JSON.stringify(cleanText)}, lang="th").save(${JSON.stringify(gttsTarget)})`;
  const result = spawnSync(PYTHON, ['-c', script], {
    timeout: 20000, stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (result.status !== 0) {
    const msg = result.stderr?.toString().trim() || 'gTTS failed';
    throw new Error(msg);
  }
  if (pitchK !== 1) {
    applyPitch(gttsTarget, outputPath, pitchK);
    try { fs.unlinkSync(gttsTarget); } catch {}
  }
}

function getMediaDuration(filePath) {
  try {
    const out = execFileSync(FFPROBE, [
      '-v', 'quiet', '-print_format', 'json', '-show_format', filePath,
    ], { encoding: 'utf8', timeout: 10000 });
    const dur = parseFloat(JSON.parse(out).format?.duration || '0');
    return Math.max(dur, 1.0);
  } catch {
    return 2.0;
  }
}

module.exports = { generateVoiceover, getMediaDuration };
