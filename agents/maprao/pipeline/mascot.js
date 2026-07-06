'use strict';
/**
 * mascot.js — คลัง Mascot Ref ของมะพร้าว (กระต่าย chibi) — เก็บได้หลายรูป เลือก 1 รูปเป็น "active"
 * Storage: agents/maprao/mascot.json { activeId, lastDetail, items: { id: { file, created_at, detail } } }
 *          agents/maprao/mascot/{id}.png
 * Mascot Ref ที่ active คือ anchor ที่ใช้กับทุก Comic Strip (แม้จะมีหลายรูปในคลัง ใช้ทีละรูปเดียว)
 *
 * Mascot Detail: ข้อความเสริมที่ user พิมพ์ ต่อท้าย base style prompt (B&W manga chibi bunny) ที่ล็อกไว้เสมอ
 * — ปรับได้แค่ positive prompt ส่วนเสริม, negative prompt คงที่เสมอ (safety net กันสไตล์หลุด)
 */

const fs   = require('fs');
const path = require('path');
const { submitImageWorkflow } = require('../../../lib/comfy-client-core');

const ROOT_DIR     = path.join(__dirname, '..', '..', '..');
const MASCOT_JSON  = path.join(__dirname, '..', 'mascot.json');
const MASCOT_DIR   = path.join(__dirname, '..', 'mascot');
const DEFAULT_REF  = path.join(__dirname, '..', 'mascot-ref.png'); // bundled default — ใช้เมื่อคลังว่าง

function load() {
  if (!fs.existsSync(MASCOT_JSON)) return { activeId: null, lastDetail: '', items: {} };
  try {
    const m = JSON.parse(fs.readFileSync(MASCOT_JSON, 'utf8'));
    return { activeId: m.activeId || null, lastDetail: m.lastDetail || '', items: m.items || {} };
  } catch { return { activeId: null, lastDetail: '', items: {} }; }
}

function save(m) {
  fs.writeFileSync(MASCOT_JSON, JSON.stringify(m, null, 2));
}

// รายการ Mascot Ref ทั้งหมดในคลัง เรียงใหม่→เก่า พร้อม flag active + detail ที่ใช้สร้าง
function list() {
  const { activeId, items } = load();
  return Object.entries(items)
    .map(([id, it]) => ({ id, file: it.file, created_at: it.created_at, detail: it.detail || '', active: id === activeId }))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

// Mascot Detail ล่าสุดที่ใช้ generate — เป็น default ให้ครั้งถัดไป
function lastDetail() {
  return load().lastDetail;
}

// path เต็มของ Mascot Ref — fallback ตามลำดับ: activeId → latest ในคลัง → mascot-ref.png (default)
function refPath() {
  const { activeId, items } = load();
  // 1. active item
  let it = activeId && items[activeId];
  // 2. latest item in library (ถ้า activeId ไม่ได้ตั้งหรือไฟล์หาย)
  if (!it || !fs.existsSync(path.join(ROOT_DIR, it.file))) {
    const latestId = Object.keys(items).sort().pop();
    it = latestId ? items[latestId] : null;
  }
  if (it) {
    const p = path.join(ROOT_DIR, it.file);
    if (fs.existsSync(p)) return p;
  }
  // 3. bundled default
  return fs.existsSync(DEFAULT_REF) ? DEFAULT_REF : null;
}

// เลือกรูปในคลังให้เป็น active Mascot Ref
function selectActive(id) {
  const m = load();
  if (!m.items[id]) throw new Error(`ไม่พบ Mascot Ref id=${id}`);
  m.activeId = id;
  save(m);
  return m.items[id];
}

// ลบรูปในคลัง (ทั้ง entry + ไฟล์จริง) — ถ้าลบ active ให้ auto-select ตัวที่เหลือล่าสุด
function remove(id) {
  const m = load();
  if (!m.items[id]) throw new Error(`ไม่พบ Mascot Ref id=${id}`);
  const p = path.join(ROOT_DIR, m.items[id].file);
  try { fs.unlinkSync(p); } catch {}
  delete m.items[id];
  if (m.activeId === id) {
    const remaining = Object.keys(m.items).sort();
    m.activeId = remaining.length ? remaining[remaining.length - 1] : null;
  }
  save(m);
}

// base style prompt ล็อกไว้เสมอ (ไม่ให้ user แก้) — Mascot Detail (ถ้ามี) ต่อท้ายเป็นรายละเอียดเสริม
function buildMascotWorkflow(seed, detail) {
  const base = 'masterpiece, best quality, black and white manga ink drawing, chibi bunny character, ' +
    'simple ink linework, clean lineart, minimal shading, monochrome, no color, white background, ' +
    'full body, solo, cute, big round eyes, studio manga';
  const pos = detail && detail.trim() ? `${base}, ${detail.trim()}` : base;
  const neg = 'color, colored, photorealistic, 3d, lowres, bad anatomy, extra fingers, worst quality, ' +
    'blurry, watermark, nsfw, multiple characters, crowd, grayscale gradient, painterly shading';
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'AnythingXL_xl.safetensors' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: pos } },
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: neg } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 768, batch_size: 1 } },
    '5': { class_type: 'KSampler', inputs: {
             model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0],
             seed: seed || Math.floor(Math.random() * 1e10),
             steps: 25, cfg: 7.0, sampler_name: 'dpmpp_2m_sde', scheduler: 'karras', denoise: 1.0 } },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'maprao_mascot' } },
  };
}

/**
 * สร้าง Mascot Ref ใหม่ (AnythingXL T2I, B&W manga ink) — เพิ่มเข้าคลังเป็นรูปใหม่ แล้วตั้งเป็น active ทันที
 * @param {object} comfyCfg
 * @param {number} seed
 * @param {string} [detail]  Mascot Detail — รายละเอียดเสริมต่อท้าย base style prompt (ไม่บังคับ)
 * @returns {Promise<{id, outputPath}>}
 */
async function generateMascotRef(comfyCfg, seed, detail = '') {
  console.log(`  🎨 ComfyUI T2I: สร้าง Mascot Ref ใหม่ (B&W manga ink)${detail ? ` + "${detail}"` : ''}...`);
  fs.mkdirSync(MASCOT_DIR, { recursive: true });
  const id = Date.now().toString();
  const outputPath = path.join(MASCOT_DIR, `${id}.png`);
  const timeout = comfyCfg.imageTimeoutMs || comfyCfg.timeoutMs || 300000;
  const { bytes } = await submitImageWorkflow(
    comfyCfg, buildMascotWorkflow(seed, detail), '7', outputPath, timeout, 'maprao-img');

  const m = load();
  m.items[id] = { file: path.relative(ROOT_DIR, outputPath), created_at: new Date().toISOString(), detail };
  m.activeId = id;      // มาสคอตใหม่ล่าสุด = active โดย default (เลือกเปลี่ยนทีหลังได้จากคลัง)
  m.lastDetail = detail; // จำไว้เป็น default ให้ครั้งถัดไป
  save(m);

  console.log(`  ✅ Mascot Ref ใหม่: ${outputPath} (${(bytes / 1024).toFixed(0)} KB)`);
  return { id, outputPath };
}

module.exports = { load, save, list, lastDetail, refPath, selectActive, remove, generateMascotRef };
