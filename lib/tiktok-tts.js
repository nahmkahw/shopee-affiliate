'use strict';

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FFMPEG   = process.env.FFMPEG_PATH  || 'ffmpeg';
const FFPROBE  = process.env.FFPROBE_PATH || 'ffprobe';
const TTS_VOICE = process.env.TTS_VOICE   || 'th-TH-PremwadeeNeural';

let _tts = null;

async function getTTS() {
  if (!_tts) {
    const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
    _tts = new MsEdgeTTS();
    await _tts.setMetadata(TTS_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  }
  return _tts;
}

async function generateVoiceover(text, outputPath) {
  const cleanText = text
    .replace(/^["']+|["']+$/g, '')
    .trim();

  if (!cleanText) {
    execFileSync(FFMPEG, [
      '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
      '-t', '1', '-c:a', 'aac', '-b:a', '128k', outputPath,
    ], { encoding: 'utf8', timeout: 15000 });
    return;
  }

  const tts    = await getTTS();
  const tmpDir = outputPath + '_ttsdir';
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    const result = await tts.toFile(tmpDir, cleanText);
    fs.renameSync(result.audioFilePath, outputPath);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
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

function resetTTS() {
  _tts = null;
}

module.exports = { getTTS, generateVoiceover, getMediaDuration, resetTTS };
