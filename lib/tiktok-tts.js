'use strict';

const fs   = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const FFMPEG  = process.env.FFMPEG_PATH  || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const PYTHON  = process.env.PYTHON_PATH  || 'python';


/**
 * @param {string} text
 * @param {string} outputPath
 * @param {object} [opts]  { pitchK, speedK } — pitchK: แยกเสียงตัวละคร (1=ปกติ), speedK: ความเร็ว (0.9=ช้าลงนิด ฟังธรรมชาติกว่า)
 */
async function generateVoiceover(text, outputPath, opts = {}) {
  const { pitchK = 1, speedK = 1 } = opts;
  const cleanText = text.replace(/^["']+|["']+$/g, '').trim();

  if (!cleanText) {
    execFileSync(FFMPEG, [
      '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
      '-t', '1', '-c:a', 'aac', '-b:a', '128k', outputPath,
    ], { encoding: 'utf8', timeout: 15000 });
    return;
  }

  // gTTS (Google TTS) — ฟรี 100%, ไม่ต้อง API key, ไทยคุณภาพดี, ไม่มี rate limit
  const needsPostProcess = pitchK !== 1 || speedK !== 1;
  const gttsTarget = needsPostProcess ? outputPath + '.raw.mp3' : outputPath;
  const script = `from gtts import gTTS; gTTS(text=${JSON.stringify(cleanText)}, lang="th").save(${JSON.stringify(gttsTarget)})`;
  const result = spawnSync(PYTHON, ['-c', script], {
    timeout: 20000, stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (result.status !== 0) {
    const msg = result.stderr?.toString().trim() || 'gTTS failed';
    throw new Error(msg);
  }
  if (needsPostProcess) {
    // pitch shift + speed adjust — clamp atempo ไว้ [0.5, 2.0] ตาม FFmpeg limit
    const effectivePitch = pitchK !== 1 ? pitchK : null;
    const effectiveSpeed = Math.min(2.0, Math.max(0.5, speedK));
    const af = effectivePitch
      ? `asetrate=24000*${effectivePitch},aresample=24000,atempo=${(effectiveSpeed / effectivePitch).toFixed(4)}`
      : `atempo=${effectiveSpeed.toFixed(4)}`;
    execFileSync(FFMPEG, ['-y', '-i', gttsTarget, '-af', af, outputPath],
      { timeout: 20000, stdio: ['ignore', 'ignore', 'pipe'] });
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
