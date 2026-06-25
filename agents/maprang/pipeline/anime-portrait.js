'use strict';
/**
 * anime-portrait.js — Stage-0: รูปถ่ายจริง → canonical anime portrait (anime_ref)
 *
 * ปัญหา: ref images เป็นรูปถ่ายจริง (photoreal) แต่ scene output เป็น anime
 *        → Flux Kontext แปลง+คงอัตลักษณ์พร้อมกันไม่ไหว (domain gap) → เพศ/อายุ/หน้าหลุด
 * วิธีแก้: แปลงรูปถ่าย → anime portrait ครั้งเดียวต่อตัวละคร (IPAdapterFaceID + AnythingXL)
 *        แล้ว Stage-1/2 ใช้ anime portrait เป็น anchor (domain เดียวกับ output → identity คงตัว)
 *
 * InsightFace ใน FaceID ครอป+align หน้าให้ในตัว → ตัด background/คนอื่นในรูปถ่ายทิ้งอัตโนมัติ
 * model บน ComfyUI: AnythingXL_xl.safetensors, ip-adapter-faceid-plusv2_sdxl.bin, InsightFace (CUDA)
 * ดู ADR: agents/maprang/docs/ADR-001-anime-ref-2stage.md
 */

const { submitImageWorkflow, uploadImageToComfy } = require('./comfy-client');
const { detectGenderEn } = require('./scene-gen');

const CHECKPOINT  = 'AnythingXL_xl.safetensors';
const PROVIDER    = process.env.MAPRANG_IPA_PROVIDER || 'CUDA';
const FACEID_W    = parseFloat(process.env.MAPRANG_FACEID_WEIGHT || '1.0');
const PORTRAIT_TIMEOUT = parseInt(process.env.PORTRAIT_TIMEOUT_MS || '300000', 10); // 5 นาที

// เพศ structured (char.gender) มาก่อน → fallback parse จาก description
function resolveGender(char) {
  const g = (char.gender || '').toLowerCase();
  if (g === 'male' || g === 'female') return g;
  const d = detectGenderEn(char.description || '');
  if (d === 'female') return 'female';
  if (d === 'child' || d === 'elder' || d === 'male') return 'male';
  return 'male'; // default — ตัวละครส่วนใหญ่ระบุชาย
}

// อายุ band หยาบ — กันออกมาเป็นเด็ก (อาการ still_1) โดยไม่ต้องเป๊ะปี
function resolveAgeBand(char) {
  if (char.age_band) return char.age_band;
  const m = (char.description || '').match(/(\d{1,3})\s*(?:year|yr|ปี)/i);
  const age = m ? parseInt(m[1], 10) : null;
  if (age == null) return null;
  if (age < 13) return 'child';
  if (age < 20) return 'teenager';
  if (age < 35) return 'young adult';
  if (age < 55) return 'middle-aged adult';
  return 'elderly';
}

const GENDER_POS = { male: '1man, male, masculine', female: '1woman, female, feminine' };
const AGE_POS = {
  child: 'child, young kid', teenager: 'teenager, youthful',
  'young adult': 'young adult', 'middle-aged adult': 'mature adult, middle-aged, some wrinkles',
  elderly: 'elderly, old, aged face, wrinkles',
};

function buildPortraitPrompt(char) {
  const gender = resolveGender(char);
  const band   = resolveAgeBand(char);
  const parts = [
    'masterpiece, best quality, anime style, anime key visual, character reference sheet',
    GENDER_POS[gender],
    band ? AGE_POS[band] : '',
    char.description || '',
    'solo, upper body portrait, facing viewer, neutral expression, clean lineart, detailed face, white background, studio anime',
  ].filter(Boolean);
  return parts.join(', ');
}

function buildPortraitNeg(char) {
  const gender = resolveGender(char);
  const band   = resolveAgeBand(char);
  // ล็อกเพศ: negative เพศตรงข้ามแรง ๆ (ชั้นที่ 1 ของ 2)
  const genderNeg = gender === 'male'
    ? '1girl, woman, female, feminine, breasts'
    : '1boy, man, male, masculine, beard';
  // กันออกมาเป็นเด็กถ้าตัวละครเป็นผู้ใหญ่ (อาการ still_1)
  const ageNeg = band && band !== 'child' && band !== 'teenager'
    ? 'child, kid, little boy, little girl, baby face, teenager'
    : '';
  return ['photorealistic, 3d, realistic, photo', genderNeg, ageNeg,
    'lowres, bad anatomy, extra fingers, worst quality, blurry, watermark, nsfw, multiple characters, crowd, text']
    .filter(Boolean).join(', ');
}

// IPAdapterFaceID (FACEID PLUS V2) + AnythingXL → anime portrait ที่คง identity จากรูปถ่าย
function buildAnimeRefWorkflow(photoFilename, char, seed) {
  return {
    '1':  { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: CHECKPOINT } },
    '2':  { class_type: 'IPAdapterUnifiedLoaderFaceID',
            inputs: { model: ['1', 0], preset: 'FACEID PLUS V2', lora_strength: 0.6, provider: PROVIDER } },
    '3':  { class_type: 'LoadImage', inputs: { image: photoFilename } },
    '4':  { class_type: 'IPAdapterFaceID',
            inputs: { model: ['2', 0], ipadapter: ['2', 1], image: ['3', 0],
                      weight: FACEID_W, weight_faceidv2: FACEID_W, weight_type: 'linear',
                      combine_embeds: 'concat', start_at: 0.0, end_at: 1.0, embeds_scaling: 'V only' } },
    '5':  { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: buildPortraitPrompt(char) } },
    '6':  { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: buildPortraitNeg(char) } },
    '7':  { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
    '8':  { class_type: 'KSampler',
            inputs: { model: ['4', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['7', 0],
                      seed: seed || Math.floor(Math.random() * 1e10),
                      steps: 28, cfg: 7.0, sampler_name: 'dpmpp_2m_sde', scheduler: 'karras', denoise: 1.0 } },
    '9':  { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['1', 2] } },
    '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'maprang_anime_ref' } },
  };
}

/**
 * แปลงรูปถ่าย → anime portrait (anime_ref)
 * @param {object} cfg        { host, port }
 * @param {object} char       { id, name, description, gender?, age_band? }
 * @param {string} photoPath  path รูปถ่ายต้นฉบับ (ref_image)
 * @param {string} outPath    path บันทึก anime portrait .png
 * @param {number} [seed]
 * @returns {Promise<string>} outPath
 */
async function generateAnimeRef(cfg, char, photoPath, outPath, seed) {
  const gender = resolveGender(char);
  const band   = resolveAgeBand(char);
  console.log(`  🎭 Stage-0 anime portrait: ${char.name || char.id} (${gender}${band ? ', ' + band : ''})`);
  const filename = await uploadImageToComfy(cfg, photoPath);
  const { outputPath, bytes } = await submitImageWorkflow(
    cfg, buildAnimeRefWorkflow(filename, char, seed), '10', outPath, PORTRAIT_TIMEOUT);
  console.log(`  ✅ anime_ref: ${outputPath} (${(bytes / 1024).toFixed(0)} KB)`);
  return outputPath;
}

module.exports = { generateAnimeRef, buildAnimeRefWorkflow, buildPortraitPrompt, buildPortraitNeg, resolveGender, resolveAgeBand };
