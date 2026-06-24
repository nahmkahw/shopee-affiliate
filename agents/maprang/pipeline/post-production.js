'use strict';
/**
 * post-production.js — Stage 3: TTS voiceover + subtitle + concat → story.mp4
 * BGM optional (silence ถ้าไม่มี bgm_mood file)
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execFileSync } = require('child_process');

const { addSubtitle, concatClips } = require('./video-build');
const { generateVoiceover }        = require('../../../lib/tiktok-tts');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

/**
 * Mix audio (TTS) ลง clip ที่มีอยู่
 * @param {string} clipPath   mp4 input
 * @param {string} audioPath  mp3/aac input
 * @param {string} outPath    mp4 output
 */
function mixAudioIntoClip(clipPath, audioPath, outPath) {
  // Loop audio ถ้าสั้นกว่าวิดีโอ, ตัดถ้ายาวกว่า, volume 0.85
  execFileSync(FFMPEG, [
    '-y',
    '-i', clipPath,
    '-i', audioPath,
    '-filter_complex', '[1:a]aloop=loop=-1:size=2e+09[looped];[looped]atrim=duration=3[atrimmed];[0:a][atrimmed]amix=inputs=2:duration=first:weights=0 0.85[aout]',
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
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
    const clipPath = path.join(clipsDir, `clip_${scene.scene_number}.mp4`);
    if (!fs.existsSync(clipPath)) {
      console.warn(`  ⚠️  ไม่พบ clip_${scene.scene_number}.mp4 — ข้าม`);
      continue;
    }

    // 1. subtitle overlay
    const subPath = path.join(postDir, `sub_${scene.scene_number}.mp4`);
    console.log(`  [${scene.scene_number}] subtitle: "${scene.subtitle_th}"`);
    addSubtitle(clipPath, scene.subtitle_th, subPath);

    // 2. TTS voiceover
    let withAudio = subPath;
    try {
      const ttsPath = path.join(postDir, `tts_${scene.scene_number}.mp3`);
      await generateVoiceover(scene.narration_th || scene.subtitle_th, ttsPath);
      const mixPath = path.join(postDir, `mix_${scene.scene_number}.mp4`);
      mixAudioIntoClip(subPath, ttsPath, mixPath);
      try { fs.unlinkSync(subPath); } catch {}
      try { fs.unlinkSync(ttsPath); } catch {}
      withAudio = mixPath;
      console.log(`     ✅ TTS + audio mix`);
    } catch (e) {
      console.warn(`     ⚠️  TTS ล้มเหลว (${e.message}) — ใช้ subtitle เฉยๆ`);
    }

    finalClips.push(withAudio);
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
