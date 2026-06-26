'use strict';
/**
 * char-actions.js — CLI actions สำหรับสร้างรูปตัวละคร (เรียกจาก run.js)
 *   genCharImage — AI gen จาก description (AnythingXL T2I, ได้ anime → เป็นทั้ง ref_image+anime_ref)
 *   genAnimeRef  — Stage-0: รูปถ่ายจริง (ref_image) → anime portrait (anime_ref) ผ่าน IPAdapterFaceID
 * dependency injection ผ่าน ctx: { COMFY_CFG, ROOT, CHAR_DIR }
 */

const fs   = require('fs');
const path = require('path');

const { generateCharacterImage } = require('./comfy-client');
const { generateAnimeRef }       = require('./anime-portrait');
const { detectGenderEn }         = require('./scene-gen');
const charReg = require('./char-registry');

function loadChar(charId) {
  const c = charReg.load()[charId];
  if (!c) { console.error(`❌ ไม่พบ character ${charId}`); process.exit(1); }
  return c;
}

// description → anime image (ไม่มีรูปถ่ายจริง → ใช้ผลเป็น anime_ref ได้เลย)
async function genCharImage(ctx, charId) {
  const c = loadChar(charId);
  fs.mkdirSync(ctx.CHAR_DIR, { recursive: true });
  const outPath = path.join(ctx.CHAR_DIR, `${charId}.png`);
  console.log(`🎨 สร้างรูปตัวละคร ${charId}...`);
  await generateCharacterImage(ctx.COMFY_CFG, c.description, outPath, Math.floor(Math.random() * 1e9));
  const rel = path.relative(ctx.ROOT, outPath);
  charReg.upsert({ id: charId, ref_image: rel, anime_ref: rel,
    gender: c.gender || detectGenderEn(c.description) || '' });
  console.log(`✅ ref image (anime): ${outPath}`);
}

// Stage-0: รูปถ่ายจริง → anime portrait
async function genAnimeRef(ctx, charId) {
  const c = loadChar(charId);
  const photo = c.ref_image && (path.isAbsolute(c.ref_image) ? c.ref_image : path.join(ctx.ROOT, c.ref_image));
  if (!photo || !fs.existsSync(photo)) { console.error(`❌ ${charId} ไม่มี ref_image (รูปถ่าย)`); process.exit(1); }
  fs.mkdirSync(ctx.CHAR_DIR, { recursive: true });
  const outPath = path.join(ctx.CHAR_DIR, `${charId}_anime.png`);
  await generateAnimeRef(ctx.COMFY_CFG, c, photo, outPath, Math.floor(Math.random() * 1e9));
  charReg.upsert({ id: charId, anime_ref: path.relative(ctx.ROOT, outPath),
    gender: c.gender || detectGenderEn(c.description) || '' });
  console.log(`✅ anime_ref: ${outPath}`);
}

module.exports = { genCharImage, genAnimeRef };
