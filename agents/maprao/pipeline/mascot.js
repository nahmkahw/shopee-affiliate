'use strict';
/**
 * mascot.js — คลัง Mascot Ref ของมะพร้าว (กระต่าย chibi) — เก็บได้หลายรูป เลือก 1 รูปเป็น "active"
 * Storage: agents/maprao/mascot.json { activeId, items: { id: { file, created_at } } }
 *          agents/maprao/mascot/{id}.png
 * Mascot Ref ที่ active คือ anchor ที่ใช้กับทุก Comic Strip (แม้จะมีหลายรูปในคลัง ใช้ทีละรูปเดียว)
 */

const fs   = require('fs');
const path = require('path');
const { submitImageWorkflow } = require('../../../lib/comfy-client-core');

const ROOT_DIR     = path.join(__dirname, '..', '..', '..');
const MASCOT_JSON  = path.join(__dirname, '..', 'mascot.json');
const MASCOT_DIR   = path.join(__dirname, '..', 'mascot');

function load() {
  if (!fs.existsSync(MASCOT_JSON)) return { activeId: null, items: {} };
  try {
    const m = JSON.parse(fs.readFileSync(MASCOT_JSON, 'utf8'));
    return { activeId: m.activeId || null, items: m.items || {} };
  } catch { return { activeId: null, items: {} }; }
}

function save(m) {
  fs.writeFileSync(MASCOT_JSON, JSON.stringify(m, null, 2));
}

// รายการ Mascot Ref ทั้งหมดในคลัง เรียงใหม่→เก่า พร้อม flag active
function list() {
  const { activeId, items } = load();
  return Object.entries(items)
    .map(([id, it]) => ({ id, file: it.file, created_at: it.created_at, active: id === activeId }))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

// path เต็มของ Mascot Ref ที่ active อยู่ (null ถ้ายังไม่มี/ไฟล์หาย)
function refPath() {
  const { activeId, items } = load();
  const it = activeId && items[activeId];
  if (!it) return null;
  const p = path.join(ROOT_DIR, it.file);
  return fs.existsSync(p) ? p : null;
}

// เลือกรูปในคลังให้เป็น active Mascot Ref
function selectActive(id) {
  const m = load();
  if (!m.items[id]) throw new Error(`ไม่พบ Mascot Ref id=${id}`);
  m.activeId = id;
  save(m);
  return m.items[id];
}

function buildMascotWorkflow(seed) {
  const pos = 'masterpiece, best quality, black and white manga ink drawing, chibi bunny character, ' +
    'simple ink linework, clean lineart, minimal shading, monochrome, no color, white background, ' +
    'full body, solo, cute, big round eyes, studio manga';
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
 * @returns {Promise<{id, outputPath}>}
 */
async function generateMascotRef(comfyCfg, seed) {
  console.log('  🎨 ComfyUI T2I: สร้าง Mascot Ref ใหม่ (B&W manga ink)...');
  fs.mkdirSync(MASCOT_DIR, { recursive: true });
  const id = Date.now().toString();
  const outputPath = path.join(MASCOT_DIR, `${id}.png`);
  const timeout = comfyCfg.imageTimeoutMs || comfyCfg.timeoutMs || 300000;
  const { bytes } = await submitImageWorkflow(
    comfyCfg, buildMascotWorkflow(seed), '7', outputPath, timeout, 'maprao-img');

  const m = load();
  m.items[id] = { file: path.relative(ROOT_DIR, outputPath), created_at: new Date().toISOString() };
  m.activeId = id; // มาสคอตใหม่ล่าสุด = active โดย default (เลือกเปลี่ยนทีหลังได้จากคลัง)
  save(m);

  console.log(`  ✅ Mascot Ref ใหม่: ${outputPath} (${(bytes / 1024).toFixed(0)} KB)`);
  return { id, outputPath };
}

module.exports = { load, save, list, refPath, selectActive, generateMascotRef };
