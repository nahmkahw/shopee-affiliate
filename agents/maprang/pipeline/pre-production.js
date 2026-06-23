'use strict';
/**
 * pre-production.js — Stage 1: Storyboard + Character ref
 * สร้าง scenes, char_ref.png แล้วรอ user approve ก่อน generate clips
 */

const fs   = require('fs');
const path = require('path');

const { generateScenes, generateScenesWithCharacters,
        generateCharacterDescription, buildCharacterNegative,
        describeCharacterImage } = require('./scene-gen');
const { generateCharacterImage } = require('./comfy-client');
const charReg = require('./char-registry');

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
async function runPreProduction({ prompt, id, charDescOverride, charIdsArg, comfyCfg, saveMeta }) {
  const dir = path.join(GALLERY, id);
  fs.mkdirSync(dir, { recursive: true });

  const sharedSeed = Math.floor(Math.random() * 1e10);
  const meta = {
    id, prompt, created_at: new Date().toISOString(),
    status: 'pre_production', seed: sharedSeed, scenes: [],
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
  const rawScenes = isMulti
    ? await generateScenesWithCharacters(prompt, useChars)
    : await generateScenes(prompt);

  // 3. Character description (single-char path)
  let singleCharDesc = '', singleCharNeg = '';
  if (!isMulti) {
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

  // 5. สร้าง char_ref.png (ถ้าเป็น single-char)
  if (!isMulti) {
    const refPath = path.join(dir, 'char_ref.png');
    try {
      await generateCharacterImage(comfyCfg, singleCharDesc, refPath, sharedSeed);
      meta.ref_image = 'char_ref.png';
      const vd = await describeCharacterImage(refPath);
      if (vd) {
        meta.anchor_description = vd;
        // อัปเดต visual_prompt ทุก scene ด้วย anchor
        meta.scenes = meta.scenes.map(s => ({
          ...s,
          visual_prompt_en: s.visual_prompt_en.replace(
            /^anime style,\s*[^,]+,\s*/i,
            `anime style, ${vd}, `
          ),
        }));
      }
    } catch (e) { console.warn(`⚠️  ข้าม ref image: ${e.message}`); }
    saveMeta(meta);
  }

  console.log(`\n✅ Pre-production เสร็จ — รอ user approve ใน Dashboard`);
  return meta;
}

module.exports = { runPreProduction };
