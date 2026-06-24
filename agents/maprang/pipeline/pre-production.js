'use strict';
/**
 * pre-production.js — Stage 1: Storyboard + Character ref
 * สร้าง scenes, char_ref.png แล้วรอ user approve ก่อน generate clips
 */

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { generateScenes, generateScenesWithCharacters,
        generateCharacterDescription, buildCharacterNegative,
        describeCharacterImage } = require('./scene-gen');
const { generateClip } = require('./comfy-client');
const charReg = require('./char-registry');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

const GALLERY = path.join(__dirname, '..', 'gallery');

/**
 * @param {object} params
 * @param {string} params.prompt
 * @param {string} params.id
 * @param {string} [params.charDescOverride]
 * @param {string} [params.charIdsArg]       comma-separated char ids
 * @param {object} params.comfyCfg
 * @param {Function} params.saveMeta
 * @returns {Promise<object>}  updated meta
 */
function appendLog(meta, msg, saveMeta) {
  if (!meta.logs) meta.logs = [];
  const elapsed = Math.round((Date.now() - new Date(meta.created_at).getTime()) / 1000);
  meta.logs.push({ t: new Date().toISOString(), msg, elapsed });
  if (saveMeta) saveMeta(meta);
}

async function runPreProduction({ prompt, id, charDescOverride, charIdsArg, comfyCfg, saveMeta }) {
  const dir = path.join(GALLERY, id);
  fs.mkdirSync(dir, { recursive: true });

  const sharedSeed = Math.floor(Math.random() * 1e10);
  const meta = {
    id, prompt, created_at: new Date().toISOString(),
    status: 'pre_production', seed: sharedSeed, scenes: [], logs: [],
    bgm_mood: 'adventure',
  };
  saveMeta(meta);
  console.log(`\n🎌 มะปราง — Pre-production\n📖 ${prompt}\n`);

  // 1. โหลด characters
  const allChars   = charReg.load();
  const useCharIds = charIdsArg
    ? charIdsArg.split(',').map(s => s.trim()).filter(cid => allChars[cid])
    : Object.keys(allChars);
  const useChars = Object.fromEntries(useCharIds.map(cid => [cid, allChars[cid]]));
  const isMulti  = useCharIds.length > 0;

  // 2. Scene breakdown
  const charLabel = isMulti ? `${useCharIds.length} ตัวละคร` : 'ตัวละครเดี่ยว';
  appendLog(meta, `🤖 Typhoon2: วิเคราะห์เนื้อเรื่อง (${charLabel})`, saveMeta);
  const t0 = Date.now();
  const rawScenes = isMulti
    ? await generateScenesWithCharacters(prompt, useChars)
    : await generateScenes(prompt);
  appendLog(meta, `✅ ได้ ${rawScenes.length} scenes (${Math.round((Date.now()-t0)/1000)}s)`, saveMeta);

  // 3. Character description (single-char path)
  let singleCharDesc = '', singleCharNeg = '';
  if (!isMulti) {
    appendLog(meta, '🧬 สร้าง character description...', saveMeta);
    singleCharDesc = charDescOverride || await generateCharacterDescription(prompt);
    singleCharNeg  = buildCharacterNegative(singleCharDesc);
    meta.character_description = singleCharDesc;
    meta.character_negative    = singleCharNeg;
  } else {
    meta.characters = useCharIds;
  }

  // 4. Build scene list (พร้อม _charNeg — ใช้ตอน generate-scene)
  meta.scenes = rawScenes.map(s => {
    const charPrompt = isMulti
      ? charReg.buildSceneCharPrompt(s.characters || useCharIds, useChars)
      : singleCharDesc;
    const charNeg = isMulti
      ? charReg.buildSceneCharNeg(s.characters || useCharIds, useChars)
      : singleCharNeg;
    return {
      ...s,
      narration_th:  s.narration_th  || s.subtitle_th,
      visual_action: s.visual_action || '',
      status: 'pending',
      approved: false,
      skipped: false,
      _charNeg: charNeg,
      visual_prompt_en: s.visual_prompt_en.replace(
        /^anime style,\s*/i,
        `anime style, ${charPrompt}, `
      ),
    };
  });
  saveMeta(meta);

  // 5. สร้าง char_ref.png ด้วย Wan2.1 T2V (same model family กับ scene clips)
  // — ป้องกัน AnythingXL ↔ Wan2.1 latent space mismatch
  if (!isMulti) {
    const refPath  = path.join(dir, 'char_ref.png');
    const tmpClip  = path.join(dir, '.char_ref_clip.mp4');
    try {
      appendLog(meta, '🎨 Wan2.1 T2V: สร้าง character reference (same model family)...', saveMeta);
      const t1 = Date.now();
      const charClipPrompt = `anime style video, ${singleCharDesc}, standing still, neutral pose, full body, soft studio lighting, white background, character sheet, no motion`;
      await generateClip(comfyCfg, charClipPrompt, tmpClip, sharedSeed);
      // Extract first frame → char_ref.png (Wan2.1-rendered, consistent with scene clips)
      execFileSync(FFMPEG, ['-y', '-i', tmpClip, '-ss', '0', '-vframes', '1', refPath],
        { stdio: ['ignore', 'ignore', 'pipe'], timeout: 30000 });
      try { fs.unlinkSync(tmpClip); } catch {}
      appendLog(meta, `✅ char_ref.png พร้อม (${Math.round((Date.now()-t1)/1000)}s) — rendered by Wan2.1`, saveMeta);
      meta.ref_image = 'char_ref.png';
      appendLog(meta, '🔍 LLaVA: วิเคราะห์ภาพตัวละคร (จาก Wan2.1 output)...', saveMeta);
      const vd = await describeCharacterImage(refPath);
      if (vd) {
        meta.anchor_description = vd;
        appendLog(meta, '✅ anchor description พร้อม — inject ทุก scene', saveMeta);
        meta.scenes = meta.scenes.map(s => ({
          ...s,
          visual_prompt_en: s.visual_prompt_en.replace(
            /^anime style,\s*[^,]+,\s*/i,
            `anime style, ${vd}, `
          ),
        }));
      }
    } catch (e) {
      appendLog(meta, `⚠️ ข้าม char_ref (${e.message}) — ใช้ natural desc โดยตรง`, saveMeta);
      console.warn(`⚠️  ข้าม ref image: ${e.message}`);
      try { fs.unlinkSync(tmpClip); } catch {}
    }
    saveMeta(meta);
  }

  appendLog(meta, '🏁 Pre-production เสร็จ — รอ Approve ใน Dashboard', saveMeta);
  console.log(`\n✅ Pre-production เสร็จ — รอ user approve ใน Dashboard`);
  return meta;
}

module.exports = { runPreProduction };
