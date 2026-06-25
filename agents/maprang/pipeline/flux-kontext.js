'use strict';
/**
 * flux-kontext.js — Character-consistent scene stills via Flux Kontext (image editing)
 *
 * ปัญหา: Wan2.1 T2V วาดตัวละครใหม่ทุก scene → หน้าตาเปลี่ยน
 * วิธีแก้: ใช้ char_ref.png เป็น anchor → Flux Kontext วางตัวละครเดิม (หน้า/ผม/ชุด คงที่)
 *         ลงในแต่ละฉาก → ได้ scene still ที่เป็นคนเดียวกันทุก scene
 *
 * model: flux1-dev-kontext_fp8_scaled.safetensors (~2.8 นาที/ภาพ บน RTX 3060 12GB)
 */

const { submitImageWorkflow, uploadImageToComfy } = require('./comfy-client');

const KONTEXT_MODEL = 'flux1-dev-kontext_fp8_scaled.safetensors';
const KONTEXT_TIMEOUT = parseInt(process.env.KONTEXT_TIMEOUT_MS || '600000', 10); // 10 นาที (multi-char ใช้นานกว่า)

/**
 * สร้าง editing instruction — คงตัวละครเดิมแล้วเปลี่ยนแค่ฉาก (รองรับ 1+ ตัวละคร)
 * @param {string} sceneSetting  คำบรรยายฉาก (อังกฤษ)
 * @param {string[]} [names]     ชื่อตัวละคร เรียงซ้าย→ขวา (multi-char)
 */
function buildInstruction(sceneSetting, names = []) {
  if (names.length > 1) {
    const order = names.map((n, i) => `${i === 0 ? 'on the left' : i === names.length - 1 ? 'on the right' : 'in the middle'} ${n}`).join(', ');
    return `Place these ${names.length} anime characters together into the scene, keeping EACH character ` +
      `identical to its reference (same face, hairstyle, hair color, outfit, body type, skin tone). ` +
      `From left to right in the reference: ${order}. Scene: ${sceneSetting}. ` +
      `They interact naturally in the same scene. Anime style, cinematic lighting, full body, detailed background.`;
  }
  return 'Place this exact same anime character, keeping the identical face, hairstyle, ' +
    'hair color, outfit, body type and skin tone, into the following scene: ' +
    `${sceneSetting}. Anime style, cinematic lighting, full body visible, detailed background.`;
}

// รองรับ 1..N ref: LoadImage แต่ละตัว → ImageStitch ต่อกัน (ซ้าย→ขวา) → Kontext
function buildKontextWorkflow(refFilenames, instruction, seed) {
  const refs = Array.isArray(refFilenames) ? refFilenames : [refFilenames];
  const wf = {
    '1': { class_type: 'UNETLoader',     inputs: { unet_name: KONTEXT_MODEL, weight_dtype: 'fp8_e4m3fn' } },
    '2': { class_type: 'DualCLIPLoader', inputs: { clip_name1: 'clip_l.safetensors', clip_name2: 't5xxl_fp8_e4m3fn.safetensors', type: 'flux' } },
    '3': { class_type: 'VAELoader',      inputs: { vae_name: 'ae.safetensors' } },
  };
  refs.forEach((fn, i) => { wf[`l${i}`] = { class_type: 'LoadImage', inputs: { image: fn } }; });
  // stitch chain → IMAGE เดียว
  let imageRef = ['l0', 0];
  for (let i = 1; i < refs.length; i++) {
    wf[`s${i}`] = { class_type: 'ImageStitch', inputs: { image1: imageRef, image2: [`l${i}`, 0],
      direction: 'right', match_image_size: true, spacing_width: 0, spacing_color: 'white' } };
    imageRef = [`s${i}`, 0];
  }
  Object.assign(wf, {
    '5':  { class_type: 'FluxKontextImageScale', inputs: { image: imageRef } },
    '6':  { class_type: 'VAEEncode',      inputs: { pixels: ['5', 0], vae: ['3', 0] } },
    '7':  { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: instruction } },
    '8':  { class_type: 'ReferenceLatent', inputs: { conditioning: ['7', 0], latent: ['6', 0] } },
    '9':  { class_type: 'FluxGuidance',   inputs: { conditioning: ['8', 0], guidance: 2.5 } },
    '10': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['7', 0] } },
    '11': { class_type: 'KSampler',       inputs: { model: ['1', 0], positive: ['9', 0], negative: ['10', 0],
              latent_image: ['6', 0], seed: seed || Math.floor(Math.random() * 1e10),
              steps: 20, cfg: 1.0, sampler_name: 'euler', scheduler: 'simple', denoise: 1.0 } },
    '12': { class_type: 'VAEDecode',      inputs: { samples: ['11', 0], vae: ['3', 0] } },
    '13': { class_type: 'SaveImage',      inputs: { images: ['12', 0], filename_prefix: 'maprang_kontext' } },
  });
  return wf;
}

/**
 * สร้าง scene still คงตัวละคร 1+ ตัว (multi-char ผ่าน ImageStitch)
 * @param {object} cfg            { host, port }
 * @param {string[]} refImagePaths  path ของ ref ตัวละคร (เรียงซ้าย→ขวา)
 * @param {string} sceneSetting   คำบรรยายฉาก (อังกฤษ)
 * @param {string} outPath        path บันทึก scene still .png
 * @param {object} [opts]         { seed, names }
 * @returns {Promise<string>}     outPath
 */
async function generateSceneStill(cfg, refImagePaths, sceneSetting, outPath, opts = {}) {
  const refs = (Array.isArray(refImagePaths) ? refImagePaths : [refImagePaths]).filter(Boolean);
  if (!refs.length) throw new Error('ไม่มี ref image');
  const filenames = [];
  for (const p of refs) filenames.push(await uploadImageToComfy(cfg, p));
  const instruction = buildInstruction(sceneSetting, opts.names || []);
  console.log(`  🎨 Flux Kontext (${refs.length} char): "${sceneSetting.substring(0, 45)}..."`);
  const { outputPath, bytes } = await submitImageWorkflow(
    cfg, buildKontextWorkflow(filenames, instruction, opts.seed), '13', outPath, KONTEXT_TIMEOUT);
  console.log(`  ✅ scene still: ${(bytes / 1024).toFixed(0)} KB`);
  return outputPath;
}

// single-char wrapper (backward compat)
function generateSceneImage(cfg, refImagePath, sceneSetting, outPath, seed) {
  return generateSceneStill(cfg, [refImagePath], sceneSetting, outPath, { seed });
}

module.exports = { generateSceneImage, generateSceneStill, buildKontextWorkflow, buildInstruction };
