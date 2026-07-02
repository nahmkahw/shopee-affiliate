'use strict';
/**
 * comic.js — orchestrator โหมดการ์ตูน 4 ช่อง (mode `comic`)
 *   gen panels (Typhoon2) → Flux Kontext still ต่อ panel (ใช้ anime_ref) → ประกอบหน้า + บอลลูน
 * end-to-end (ไม่มี approve/build แยก) — output: gallery/{id}/comic.png
 * dependency injection ผ่าน ctx: { COMFY_CFG, ROOT, GALLERY, saveMeta }
 */

const fs   = require('fs');
const path = require('path');

const { generateComicPanels } = require('./comic-gen');
const { generateSceneStill }  = require('../../../lib/flux-kontext');
const { buildComicPage }      = require('./comic-build');
const charReg = require('./char-registry');

// composition directive ต่อช่อง (P1-2 หันหน้าคุยกัน, P3-4 เห็นหน้าทุกตัว) — ผนวกเข้า scene_setting
function composition(panelIdx, names) {
  switch (panelIdx) {
    case 1: return `${names[0] || 'the character'} on the left, facing right in three-quarter view as if talking to someone, face clearly visible, upper body shot`;
    case 2: return `${names[0] || 'the character'} facing left, replying as if in conversation, face clearly visible, upper body shot`;
    case 3: return `the two characters facing each other in conversation, both faces fully visible to the viewer, medium shot`;
    default: return `all ${names.length} characters together facing the viewer, every face fully visible, group shot`;
  }
}

// abs path ของ anime_ref (anchor) → fallback ref_image
function refPath(ROOT, c) {
  const rel = c && (c.anime_ref || c.ref_image);
  if (!rel) return null;
  const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  return fs.existsSync(abs) ? abs : null;
}

/**
 * @param {object} ctx     { COMFY_CFG, ROOT, GALLERY, saveMeta }
 * @param {object} params  { prompt, id, charIds }
 * @returns {Promise<object>} meta
 */
async function runComic(ctx, { prompt, id, charIds }) {
  const dir = path.join(ctx.GALLERY, id);
  fs.mkdirSync(dir, { recursive: true });
  const seed = Math.floor(Math.random() * 1e10);

  const allChars   = charReg.load();
  const useCharIds = charIds
    ? charIds.split(',').map(s => s.trim()).filter(cid => allChars[cid])
    : Object.keys(allChars);
  const useChars = Object.fromEntries(useCharIds.map(cid => [cid, allChars[cid]]));

  const meta = {
    id, prompt, mode: 'comic', created_at: new Date().toISOString(),
    status: 'producing', seed, characters: useCharIds, panels: [], logs: [],
  };
  const log = msg => { meta.logs.push({ t: new Date().toISOString(), msg }); ctx.saveMeta(meta); console.log('  ' + msg); };
  ctx.saveMeta(meta);
  console.log(`\n🎴 มะปราง — การ์ตูน 4 ช่อง\n📖 ${prompt}\n`);

  // ref map ของตัวละครที่เลือก (anime_ref)
  const charRefs = {};
  for (const cid of useCharIds) { const p = refPath(ctx.ROOT, useChars[cid]); if (p) charRefs[cid] = p; }

  log(`🤖 สรุป concept + แตกเป็น panel...`);
  const { concept, sharedSetting, panels } = await generateComicPanels(prompt, useChars);
  meta.concept = concept;
  meta.shared_setting = sharedSetting;
  meta.panels = panels;
  log(`💡 Concept: ${concept.title} (${concept.points.length} ประเด็น)`);
  log(`📍 ฉากร่วมทุกช่อง: ${sharedSetting}`);
  ctx.saveMeta(meta);

  const imagePaths = [];
  for (const p of panels) {
    const refs  = (p.characters || []).map(cid => charRefs[cid]).filter(Boolean);
    const names = (p.characters || []).filter(cid => charRefs[cid]).map(cid => useChars[cid]?.name || cid);
    const out   = path.join(dir, `panel_${p.panel}.png`);
    const setting = `${p.scene_setting_en}. ${composition(p.panel, names)}`;
    log(`🎨 ช่อง ${p.panel}/${panels.length} (${names.length} ตัว): "${p.scene_setting_en.slice(0, 35)}..."`);
    if (refs.length) {
      await generateSceneStill(ctx.COMFY_CFG, refs, setting, out, { seed: seed + p.panel, names });
    } else {
      // ไม่มี ref — Flux Kontext ต้องมี ref; ข้ามด้วยภาพเปล่า (build จะวาด placeholder)
      log(`⚠️ ช่อง ${p.panel} ไม่มี ref ตัวละคร — ช่องว่าง`);
    }
    imagePaths.push(out);
  }

  log(`🖼️ ประกอบหน้าการ์ตูน...`);
  const comicPath = path.join(dir, 'comic.png');
  await buildComicPage(panels, imagePaths, comicPath, { title: '' });

  meta.status = 'done';
  meta.comic_image = 'comic.png';
  meta.done_at = new Date().toISOString();
  ctx.saveMeta(meta);
  console.log(`✅ การ์ตูนพร้อม: ${comicPath}`);
  return meta;
}

module.exports = { runComic };
