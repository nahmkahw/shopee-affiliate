'use strict';
/**
 * dialogue-audio.js — ประกอบเสียงบทสนทนาหลายตัวละครเป็น track เดียว
 *
 * Level A "ตัวละครพูดคุยได้": gTTS (เสถียร) + ffmpeg pitch shift แยกเสียงต่อตัวละคร
 * (edge-tts มีเสียงไทยจริงแต่ rate-limit → ไม่เสถียรพอสำหรับหลายบทพูด)
 */

const path = require('path');
const fs   = require('fs');
const { execFileSync } = require('child_process');
const { generateVoiceover, getMediaDuration } = require('./tiktok-tts');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

// pitchK ต่อบทบาท — asetrate*K, atempo=1/K (คงความยาว). K<1 ทุ้ม, K>1 แหลม
const VOICE_PROFILES = {
  narrator: 1.00,
  male:     [0.85, 0.78, 0.92],  // ชายหลายตัว → ทุ้มต่างระดับ
  female:   [1.12, 1.20, 1.06],  // หญิงหลายตัว → แหลมต่างระดับ
  child:    1.28,
  elder:    0.72,
};

/**
 * เลือก pitchK ตามเพศ + ลำดับตัวละคร (กันเสียงซ้ำเมื่อมีหลายตัวเพศเดียวกัน)
 * @param {string} gender 'male'|'female'|'child'|'elder'|null
 * @param {number} idx    ลำดับตัวละครเพศเดียวกัน (0,1,2)
 */
function pickVoiceK(gender, idx = 0) {
  const p = VOICE_PROFILES[gender];
  if (Array.isArray(p)) return p[idx % p.length];
  if (typeof p === 'number') return p;
  return VOICE_PROFILES.narrator;
}

/**
 * ประกอบ segment เสียงหลายชิ้น (ต่างเสียง) → track เดียว คั่นด้วยช่องว่าง
 * @param {Array<{text, pitchK}>} segments
 * @param {string} outPath  .mp3
 * @param {object} [opts]   { gapSec=0.3 }
 * @returns {Promise<{outPath, duration}>}
 */
async function assembleSceneAudio(segments, outPath, opts = {}) {
  const { gapSec = 0.3 } = opts;
  const segs = (segments || []).filter(s => s && s.text && s.text.trim());
  if (!segs.length) throw new Error('ไม่มี segment เสียง');

  const tmp = [];
  for (let i = 0; i < segs.length; i++) {
    const f = outPath.replace(/\.mp3$/i, `_seg${i}.mp3`);
    await generateVoiceover(segs[i].text, f, { pitchK: segs[i].pitchK || 1 });
    tmp.push(f);
  }

  if (tmp.length === 1) {
    fs.renameSync(tmp[0], outPath);
    return { outPath, duration: getMediaDuration(outPath) };
  }

  // concat ด้วย apad (เว้นช่องว่างหลังแต่ละ segment ยกเว้นชิ้นสุดท้าย)
  const inputs  = tmp.flatMap(f => ['-i', f]);
  const filters = tmp.map((_, i) =>
    i < tmp.length - 1 ? `[${i}:a]apad=pad_dur=${gapSec}[a${i}]` : `[${i}:a]anull[a${i}]`).join(';');
  const concatIn = tmp.map((_, i) => `[a${i}]`).join('');
  const fc = `${filters};${concatIn}concat=n=${tmp.length}:v=0:a=1[out]`;
  execFileSync(FFMPEG, [
    '-y', ...inputs, '-filter_complex', fc, '-map', '[out]', '-c:a', 'libmp3lame', outPath,
  ], { timeout: 60000, stdio: ['ignore', 'ignore', 'pipe'] });

  tmp.forEach(f => { try { fs.unlinkSync(f); } catch {} });
  return { outPath, duration: getMediaDuration(outPath) };
}

module.exports = { VOICE_PROFILES, pickVoiceK, assembleSceneAudio };
