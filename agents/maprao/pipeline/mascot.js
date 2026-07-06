'use strict';
/**
 * mascot.js — multi-mascot registry สำหรับ Agent มะพร้าว
 * Storage: mascot/ folder (each PNG = one mascot), mascot.json { default_id, updated_at }
 * ทุก mascot สร้างใหม่ = เพิ่มเข้า folder ไม่แทนที่ตัวเดิม
 */

const fs   = require('fs');
const path = require('path');
const { submitImageWorkflow } = require('../../../lib/comfy-client-core');

const MASCOT_DIR  = path.join(__dirname, '..', 'mascot');
const MASCOT_JSON = path.join(__dirname, '..', 'mascot.json');

function load() {
  if (!fs.existsSync(MASCOT_JSON)) return {};
  try { return JSON.parse(fs.readFileSync(MASCOT_JSON, 'utf8')); } catch { return {}; }
}

function save(data) {
  fs.writeFileSync(MASCOT_JSON, JSON.stringify(data, null, 2));
}

/** รายชื่อ mascot ทั้งหมดใน folder (เรียงจากเก่า→ใหม่) */
function list() {
  if (!fs.existsSync(MASCOT_DIR)) return [];
  return fs.readdirSync(MASCOT_DIR)
    .filter(f => f.endsWith('.png'))
    .sort()
    .map(f => ({ id: path.basename(f, '.png'), path: path.join(MASCOT_DIR, f) }));
}

/** ID ของ default mascot ปัจจุบัน */
function defaultId() {
  const m = load();
  if (m.default_id) return m.default_id;
  // migration: ถ้าเป็น format เก่ายังไม่มี default_id → ใช้ตัวล่าสุดใน folder
  const all = list();
  return all.length ? all[all.length - 1].id : null;
}

function setDefault(id) {
  save({ default_id: id, updated_at: new Date().toISOString() });
}

/** absolute path ของ default mascot (ใช้เป็น anchor ใน Flux Kontext) */
function refPath() {
  const id = defaultId();
  if (id) {
    const p = path.join(MASCOT_DIR, id + '.png');
    if (fs.existsSync(p)) return p;
  }
  // legacy fallback: ref_image ใน mascot.json format เก่า
  const m = load();
  if (m.ref_image) {
    const p = path.join(__dirname, '..', '..', '..', m.ref_image);
    if (fs.existsSync(p)) return p;
  }
  return null;
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
 * สร้าง Mascot ใหม่ — บันทึกไปที่ mascot/{id}.png และ set เป็น default อัตโนมัติ
 * @returns {Promise<{id: string, path: string}>}
 */
async function generateMascotRef(comfyCfg, seed) {
  fs.mkdirSync(MASCOT_DIR, { recursive: true });
  const id     = Date.now().toString();
  const outPng = path.join(MASCOT_DIR, id + '.png');
  console.log(`  🎨 ComfyUI T2I: สร้าง Mascot ใหม่ (B&W manga ink) → ${id}.png`);
  const timeout = comfyCfg.imageTimeoutMs || comfyCfg.timeoutMs || 300000;
  const { bytes } = await submitImageWorkflow(
    comfyCfg, buildMascotWorkflow(seed), '7', outPng, timeout, 'maprao-img');
  setDefault(id);
  console.log(`  ✅ Mascot ${id}: ${outPng} (${(bytes / 1024).toFixed(0)} KB)`);
  return { id, path: outPng };
}

module.exports = { load, save, refPath, defaultId, setDefault, list, generateMascotRef };
