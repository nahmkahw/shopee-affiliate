'use strict';
/**
 * mascot.js — the single fixed chibi-bunny Mascot (no character registry, unlike มะปราง)
 * Storage: agents/maprao/mascot.json { ref_image, updated_at }
 * Mascot Ref generated once via AnythingXL T2I (B&W manga ink prompt), reused for every Comic Strip.
 */

const fs   = require('fs');
const path = require('path');
const { submitImageWorkflow } = require('../../../lib/comfy-client-core');

const MASCOT_JSON = path.join(__dirname, '..', 'mascot.json');
const MASCOT_PNG  = path.join(__dirname, '..', 'mascot-ref.png');

function load() {
  if (!fs.existsSync(MASCOT_JSON)) return {};
  try { return JSON.parse(fs.readFileSync(MASCOT_JSON, 'utf8')); } catch { return {}; }
}

function save(mascot) {
  fs.writeFileSync(MASCOT_JSON, JSON.stringify(mascot, null, 2));
}

function refPath() {
  const m = load();
  const p = m.ref_image ? path.join(__dirname, '..', '..', '..', m.ref_image) : MASCOT_PNG;
  return fs.existsSync(p) ? p : null;
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
 * สร้าง Mascot Ref ใหม่ (AnythingXL T2I, B&W manga ink) — เขียนทับ mascot-ref.png เดิม
 * @returns {Promise<string>} outputPath
 */
async function generateMascotRef(comfyCfg, seed) {
  console.log('  🎨 ComfyUI T2I: สร้าง Mascot Ref (B&W manga ink)...');
  const timeout = comfyCfg.imageTimeoutMs || comfyCfg.timeoutMs || 300000;
  const { outputPath, bytes } = await submitImageWorkflow(
    comfyCfg, buildMascotWorkflow(seed), '7', MASCOT_PNG, timeout, 'maprao-img');
  save({ ref_image: path.relative(path.join(__dirname, '..', '..', '..'), outputPath), updated_at: new Date().toISOString() });
  console.log(`  ✅ Mascot Ref: ${outputPath} (${(bytes / 1024).toFixed(0)} KB)`);
  return outputPath;
}

module.exports = { load, save, refPath, generateMascotRef, MASCOT_PNG };
