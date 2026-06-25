'use strict';
/**
 * post-production.js — Stage 3: TTS voiceover + subtitle + concat → story.mp4
 * BGM optional (silence ถ้าไม่มี bgm_mood file)
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execFileSync } = require('child_process');

const { addSubtitle, concatClips, kenBurnsClip, extendClipToDuration } = require('./video-build');
const { assembleSceneAudio }       = require('../../../lib/dialogue-audio');
const { capNarration }             = require('./scene-gen');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

// ความยาว clip = ความยาวเสียงพากย์ (clamp) — กันเสียงเล่าเรื่องขาด
const MIN_SCENE_SEC = 3;
const MAX_SCENE_SEC = parseFloat(process.env.MAPRANG_MAX_SCENE_SEC || '8');
const MAX_DIALOG_SEC = parseFloat(process.env.MAPRANG_MAX_DIALOG_SEC || '24'); // scene มีบทสนทนายาวกว่าได้
const TTS_PAD_SEC   = 0.3;

// สร้าง track เสียงของ scene: ถ้ามี dialogue → หลายเสียงต่อกัน, ไม่งั้น narration เสียงเดียว
async function buildSceneAudio(scene, outPath) {
  const segs = [];
  if (scene.narration_th) segs.push({ text: capNarration(scene.narration_th), pitchK: 1.0 });
  for (const d of (scene.dialogue || [])) segs.push({ text: d.line_th, pitchK: d.pitchK || 1.0 });
  if (!segs.length) segs.push({ text: scene.subtitle_th || '', pitchK: 1.0 });
  return assembleSceneAudio(segs, outPath);
}

/**
 * Mix audio (TTS) ลง clip ที่มีอยู่
 * @param {string} clipPath   mp4 input
 * @param {string} audioPath  mp3/aac input
 * @param {string} outPath    mp4 output
 */
function mixAudioIntoClip(clipPath, audioPath, outPath) {
  // clip จาก ComfyUI เป็น video-only (ไม่มี audio stream)
  // [1:a]apad: pad TTS ด้วย silence ถ้าสั้นกว่าวิดีโอ
  // -shortest: ตัดที่ความยาววิดีโอถ้า TTS ยาวกว่า
  execFileSync(FFMPEG, [
    '-y',
    '-i', clipPath,
    '-i', audioPath,
    '-filter_complex', '[1:a]apad[aout]',
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest',
    outPath,
  ], { timeout: 60000, stdio: ['ignore', 'ignore', 'pipe'] });
}

/**
 * Stage 3: สร้าง story.mp4 จาก approved clips
 * @param {object} meta    meta.json object
 * @param {string} dir     gallery/{id}/
 * @returns {Promise<string>}  path ของ story.mp4
 */
async function runPostProduction(meta, dir) {
  const clipsDir = path.join(dir, 'clips');
  const postDir  = path.join(dir, 'post');
  fs.mkdirSync(postDir, { recursive: true });

  const approvedScenes = meta.scenes.filter(s => !s.skipped && s.status === 'done');
  if (!approvedScenes.length) throw new Error('ไม่มี scene ที่ approved เลย');

  console.log(`\n🎞️  Post-production — ${approvedScenes.length} scenes`);
  const finalClips = [];

  for (const scene of approvedScenes) {
    const n        = scene.scene_number;
    const clipPath = path.join(clipsDir, `clip_${n}.mp4`);
    if (!fs.existsSync(clipPath)) {
      console.warn(`  ⚠️  ไม่พบ clip_${n}.mp4 — ข้าม`);
      continue;
    }

    // 1. เสียงก่อน — รู้ความยาวเพื่อกำหนดความยาว clip (กันเสียงขาด)
    let baseClip = clipPath, ttsPath = null;
    try {
      ttsPath = path.join(postDir, `tts_${n}.mp3`);
      const { duration: ttsDur } = await buildSceneAudio(scene, ttsPath);
      const maxSec    = (scene.dialogue && scene.dialogue.length) ? MAX_DIALOG_SEC : MAX_SCENE_SEC;
      const targetDur = Math.min(Math.max(ttsDur + TTS_PAD_SEC, MIN_SCENE_SEC), maxSec);

      // 2. สร้าง clip ยาวเท่าเสียง — still มี → Ken Burns ใหม่ (motion ต่อเนื่อง), ไม่มี → ค้างเฟรมท้าย
      baseClip = path.join(postDir, `base_${n}.mp4`);
      const stillPath = path.join(clipsDir, `still_${n}.png`);
      if (fs.existsSync(stillPath)) kenBurnsClip(stillPath, baseClip, { durationSec: targetDur, variant: (n - 1) % 4 });
      else                          extendClipToDuration(clipPath, baseClip, targetDur);
      console.log(`  [${n}] เสียง ${ttsDur.toFixed(1)}s → clip ${targetDur.toFixed(1)}s`);
    } catch (e) {
      console.warn(`     ⚠️  TTS/resize ล้มเหลว (${e.message}) — ใช้ clip เดิม`);
      baseClip = clipPath; ttsPath = null;
    }

    // 3. subtitle overlay
    const subPath = path.join(postDir, `sub_${n}.mp4`);
    addSubtitle(baseClip, scene.subtitle_th, subPath);
    if (baseClip !== clipPath) { try { fs.unlinkSync(baseClip); } catch {} }

    // 4. mix เสียงพากย์ (clip ≥ เสียงแล้ว เสียงจึงครบ)
    let finalC = subPath;
    if (ttsPath && fs.existsSync(ttsPath)) {
      const mixPath = path.join(postDir, `mix_${n}.mp4`);
      mixAudioIntoClip(subPath, ttsPath, mixPath);
      try { fs.unlinkSync(subPath); } catch {}
      try { fs.unlinkSync(ttsPath); } catch {}
      finalC = mixPath;
      console.log(`     ✅ TTS + audio mix`);
    }
    finalClips.push(finalC);
  }

  if (!finalClips.length) throw new Error('ไม่มี clip สำหรับ concat');

  const storyPath = path.join(dir, 'story.mp4');
  console.log(`\n🎬 Concat ${finalClips.length} clips → story.mp4`);
  concatClips(finalClips, storyPath);

  // cleanup post tmp
  finalClips.forEach(p => { try { fs.unlinkSync(p); } catch {} });
  try { fs.rmdirSync(postDir); } catch {}

  console.log(`✅ story.mp4 พร้อม: ${storyPath}`);
  return storyPath;
}

module.exports = { runPostProduction };
