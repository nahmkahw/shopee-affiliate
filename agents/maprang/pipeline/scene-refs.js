'use strict';
/**
 * scene-refs.js — resolve ref image ของ scene สำหรับ Flux Kontext
 * รองรับทั้ง multi-char (meta.char_refs ต่อ scene.characters) และ single-char (meta.ref_image)
 */

const fs   = require('fs');
const path = require('path');

/**
 * @returns {{refs: string[], names: string[]}}  absolute paths + ชื่อตัวละคร (ซ้าย→ขวา)
 */
function resolveSceneRefs(meta, scene, galleryDir, jobId) {
  // multi-char: scene.characters (ถ้า Typhoon2 ไม่ระบุ → ใช้ตัวละครทั้ง job) → char_refs ที่มีไฟล์จริง
  const cids = (scene.characters && scene.characters.length) ? scene.characters : (meta.characters || []);
  if (meta.char_refs && cids.length) {
    const refs = [], names = [];
    for (const cid of cids) {
      const p = meta.char_refs[cid];
      if (p && fs.existsSync(p)) {
        refs.push(p);
        names.push((meta.char_names && meta.char_names[cid]) || cid);
      }
    }
    if (refs.length) return { refs, names };
  }
  // single-char: char_ref.png ใน job dir
  if (meta.ref_image) {
    const p = path.join(galleryDir, jobId, meta.ref_image);
    if (fs.existsSync(p)) return { refs: [p], names: [] };
  }
  return { refs: [], names: [] };
}

module.exports = { resolveSceneRefs };
