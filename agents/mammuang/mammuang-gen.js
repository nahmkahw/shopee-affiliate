'use strict';
/**
 * mammuang-gen.js — สร้างภาพ anime จาก text prompt ด้วย ComfyUI (txt2img, ไม่ต้องการรูปต้นแบบ)
 *
 * ใช้ AnythingXL checkpoint เดียวกับ anime agent แต่เป็น workflow txt2img ล้วน
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const COMFYUI_HOST = process.env.COMFYUI_HOST || '10.3.17.118';
const COMFYUI_PORT = parseInt(process.env.COMFYUI_PORT || '8188', 10);

const DEFAULT_NEG = [
  'photorealistic', 'realistic', '3d render', 'photograph', 'hyperrealistic',
  'dark skin', 'dark colors', 'dark background', 'dark theme', 'gritty', 'horror', 'scary', 'violent',
  'sharp shadows', 'harsh lighting', 'dramatic lighting', 'neon colors', 'saturated colors',
  'lowres', 'worst quality', 'low quality', 'jpeg artifacts', 'blurry', 'grainy', 'soft focus', 'out of focus', 'hazy', 'foggy', 'smeared', 'smudged',
  'sketch', 'rough lines', 'messy lineart', 'scratchy lines',
  'watermark', 'signature', 'username', 'text',
  'bad anatomy', 'deformed', 'disfigured', 'mutated', 'extra limbs', 'extra fingers',
  'adult', 'nsfw', 'mature',
].join(', ');

const POSITIVE_PREFIX = [
  'masterpiece', 'best quality', 'anime style', 'highly detailed',
  'chibi', 'kawaii', 'cute',
  'pastel color palette',
].join(', ');

function comfyPost(path_, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = http.request(
      { hostname: COMFYUI_HOST, port: COMFYUI_PORT, path: path_, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      res => { let o = ''; res.on('data', d => o += d); res.on('end', () => {
        try { resolve(JSON.parse(o)); } catch { reject(new Error('ComfyUI parse: ' + o.substring(0, 200))); }
      }); });
    req.on('error', reject); req.write(data); req.end();
  });
}

function comfyGet(path_) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: COMFYUI_HOST, port: COMFYUI_PORT, path: path_ }, res => {
      let o = ''; res.on('data', d => o += d);
      res.on('end', () => { try { resolve(JSON.parse(o)); } catch { reject(new Error('parse error')); } });
    }).on('error', reject);
  });
}

function comfyGetBinary(path_) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: COMFYUI_HOST, port: COMFYUI_PORT, path: path_ }, res => {
      const chunks = []; res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

/** upload รูปต้นแบบเข้า ComfyUI input folder → คืนชื่อไฟล์ที่ LoadImage ใช้ได้ */
function comfyUploadImage(imagePath) {
  return new Promise((resolve, reject) => {
    const imgBuf   = fs.readFileSync(imagePath);
    const fileName = `mammuang_ref_${Date.now()}${path.extname(imagePath)}`;
    const boundary = '----MammuangBoundary' + crypto.randomBytes(8).toString('hex');
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${fileName}"\r\n` +
      `Content-Type: image/jpeg\r\n\r\n`, 'utf8');
    const tail = Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--${boundary}--\r\n`, 'utf8');
    const payload = Buffer.concat([head, imgBuf, tail]);
    const req = http.request(
      { hostname: COMFYUI_HOST, port: COMFYUI_PORT, path: '/upload/image', method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': payload.length } },
      res => { let o = ''; res.on('data', d => o += d); res.on('end', () => {
        try { const j = JSON.parse(o); resolve(j.subfolder ? `${j.subfolder}/${j.name}` : j.name); }
        catch { reject(new Error('upload parse: ' + o.substring(0, 200))); }
      }); });
    req.on('error', reject); req.write(payload); req.end();
  });
}

const REF_CHARACTER_PATH = path.join(__dirname, 'ref-character.png');

// Flux Kontext local inference — edit ref-character.png ตาม prompt (ไม่ generate จากศูนย์)
// denoise 0.80 = เปลี่ยน scene/background แต่รักษาหน้าตาตัวละครไว้
function buildWorkflowFluxKontext({ refImageName, positive, seed, width, height }) {
  return {
    '1': { class_type: 'UNETLoader',      inputs: { unet_name: 'flux1-dev-kontext_fp8_scaled.safetensors', weight_dtype: 'fp8_e4m3fn' } },
    '2': { class_type: 'DualCLIPLoader',  inputs: { clip_name1: 't5xxl_fp8_e4m3fn.safetensors', clip_name2: 'clip_l.safetensors', type: 'flux' } },
    '3': { class_type: 'CLIPTextEncodeFlux', inputs: { clip: ['2', 0], clip_l: positive, t5xxl: positive, guidance: 2.5 } },
    '4': { class_type: 'VAELoader',       inputs: { vae_name: 'ae.safetensors' } },
    '5': { class_type: 'LoadImage',       inputs: { image: refImageName } },
    '6': { class_type: 'VAEEncode',       inputs: { pixels: ['5', 0], vae: ['4', 0] } },
    '7': { class_type: 'ReferenceLatent', inputs: { conditioning: ['3', 0], latent: ['6', 0] } },
    '8': { class_type: 'FluxKontextMultiReferenceLatentMethod', inputs: { conditioning: ['7', 0], reference_latents_method: 'index' } },
    '9': { class_type: 'FluxGuidance',    inputs: { conditioning: ['8', 0], guidance: 2.5 } },
    '10': { class_type: 'ModelSamplingFlux', inputs: { model: ['1', 0], max_shift: 1.15, base_shift: 0.5, width, height } },
    // ref latent เป็น input ของ KSampler + denoise 0.80 → edit ไม่ใช่ generate ใหม่
    '11': { class_type: 'KSampler',       inputs: {
      model: ['10', 0], positive: ['9', 0], negative: ['9', 0],
      latent_image: ['6', 0], seed, steps: 20, cfg: 1.0,
      sampler_name: 'euler', scheduler: 'simple', denoise: 0.80,
    } },
    '12': { class_type: 'VAEDecode',      inputs: { samples: ['11', 0], vae: ['4', 0] } },
    '13': { class_type: 'SaveImage',      inputs: { images: ['12', 0], filename_prefix: 'mammuang_kontext' } },
  };
}

function buildWorkflow({ positive, negative, seed, width, height }) {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'AnythingXL_xl.safetensors' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: positive } },
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: negative } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '5': { class_type: 'KSampler', inputs: {
             model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0],
             seed, steps: 30, cfg: 7.0, sampler_name: 'dpmpp_2m_sde', scheduler: 'karras', denoise: 1 } },
    // hi-res fix: latent upscale → KSampler รอบ 2 สร้าง detail จริงที่ resolution สูงขึ้น
    '6': { class_type: 'LatentUpscaleBy', inputs: { samples: ['5', 0], upscale_method: 'bislerp', scale_by: 1.5 } },
    '7': { class_type: 'KSampler', inputs: {
             model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['6', 0],
             seed, steps: 20, cfg: 7.0, sampler_name: 'dpmpp_2m_sde', scheduler: 'karras', denoise: 0.5 } },
    '8': { class_type: 'VAEDecode',  inputs: { samples: ['7', 0], vae: ['1', 2] } },
    // ImageSharpen เป็นแค่ polish สุดท้าย ไม่ใช่ตัวหลัก
    '9': { class_type: 'ImageSharpen', inputs: { image: ['8', 0], sharpen_radius: 2, sigma: 0.8, alpha: 2.0 } },
    '10': { class_type: 'SaveImage',  inputs: { images: ['9', 0], filename_prefix: 'mammuang' } },
  };
}

// workflow + IPAdapter FaceID Plus v2 สำหรับล็อคหน้าตาจากรูปต้นแบบ
function buildWorkflowWithRef({ refImageName, positive, negative, seed, width, height }) {
  return {
    '1':  { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'AnythingXL_xl.safetensors' } },
    '2':  { class_type: 'LoadImage', inputs: { image: refImageName } },
    '3':  { class_type: 'IPAdapterUnifiedLoaderFaceID', inputs: {
              model: ['1', 0], preset: 'FACEID PLUS V2', lora_strength: 0.6, provider: 'CUDA' } },
    '4':  { class_type: 'IPAdapterFaceID', inputs: {
              model: ['3', 0], ipadapter: ['3', 1], image: ['2', 0],
              weight: 0.9, weight_faceidv2: 0.9, weight_type: 'linear',
              combine_embeds: 'concat', start_at: 0.0, end_at: 1.0, embeds_scaling: 'V only' } },
    '5':  { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: positive } },
    '6':  { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: negative } },
    '7':  { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '8':  { class_type: 'KSampler', inputs: {
              model: ['4', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['7', 0],
              seed, steps: 35, cfg: 8.5, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1 } },
    '9':  { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['1', 2] } },
    '10': { class_type: 'ImageScaleBy', inputs: { image: ['9', 0], upscale_method: 'lanczos', scale_by: 1.5 } },
    '11': { class_type: 'ImageSharpen', inputs: { image: ['10', 0], sharpen_radius: 2, sigma: 0.5, alpha: 2.5 } },
    '12': { class_type: 'SaveImage', inputs: { images: ['11', 0], filename_prefix: 'mammuang' } },
  };
}

async function generateMammuang(options = {}) {
  const {
    prompt_en    = '1girl, bunny ears, sitting, holding flower, pink dress, cream background, soft smile',
    neg_prompt,
    model,                  // 'flux-kontext' → ใช้ Flux Kontext local inference
    refImagePath,           // ถ้ามี → ใช้ IPAdapter FaceID (SDXL mode)
    outPath,
    width        = 832,
    height       = 1216,
    timeoutMs    = 7 * 60 * 1000,
    pollInterval = 3000,
    onProgress   = () => {},
  } = options;

  const positive = prompt_en.startsWith('masterpiece') ? prompt_en
    : POSITIVE_PREFIX + ', ' + prompt_en;
  const negative = (neg_prompt && neg_prompt.trim()) ? neg_prompt.trim() : DEFAULT_NEG;

  const seed = Math.floor(Math.random() * 9_999_999_999);
  let workflow, saveNodeId;

  let usingRef = false;
  if (model === 'flux-kontext') {
    if (!fs.existsSync(REF_CHARACTER_PATH)) {
      throw new Error(`ไม่พบ ref-character.jpg ที่ ${REF_CHARACTER_PATH} — วางรูปตัวละครอ้างอิงก่อนใช้ flux-kontext`);
    }
    onProgress('upload ref-character เข้า ComfyUI...');
    const refImageName = await comfyUploadImage(REF_CHARACTER_PATH);
    workflow   = buildWorkflowFluxKontext({ refImageName, positive, seed, width, height });
    saveNodeId = '13';
  } else if (refImagePath && fs.existsSync(refImagePath)) {
    onProgress('upload รูปต้นแบบเข้า ComfyUI...');
    const refImageName = await comfyUploadImage(refImagePath);
    workflow   = buildWorkflowWithRef({ refImageName, positive, negative, seed, width, height });
    saveNodeId = '12';
    usingRef   = true;
  } else {
    workflow   = buildWorkflow({ positive, negative, seed, width, height });
    saveNodeId = '10';
  }

  onProgress('ส่งงานเข้า ComfyUI...');
  const clientId = crypto.randomUUID();
  let submitResult = await comfyPost('/prompt', { client_id: clientId, prompt: workflow });
  if (!submitResult.prompt_id) throw new Error('ComfyUI ไม่ตอบ prompt_id: ' + JSON.stringify(submitResult).substring(0, 200));

  let promptId = submitResult.prompt_id;
  onProgress(`กำลังเรนเดอร์ (${promptId.substring(0, 8)})...`);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollInterval));
    const history = await comfyGet('/history/' + promptId);
    const job     = history[promptId];
    if (!job) continue;
    if (job.status && job.status.status_str === 'error') {
      const msgs = job.status.messages || [];
      const errEvent = msgs.find(m => Array.isArray(m) && m[0] === 'execution_error');
      const detail = errEvent ? errEvent[1] : {};
      const msg = detail.exception_message || JSON.stringify(detail).substring(0, 400);
      // auto-fallback: ถ้า InsightFace หาหน้าไม่เจอ ให้ลองใหม่แบบ txt2img
      if (usingRef && msg.includes('No face detected')) {
        onProgress('⚠️ InsightFace หาหน้าไม่เจอ — ใช้ txt2img แทน...');
        workflow   = buildWorkflow({ positive, negative, seed, width, height });
        saveNodeId = '10';
        usingRef   = false;
        const r2 = await comfyPost('/prompt', { client_id: clientId, prompt: workflow });
        if (!r2.prompt_id) throw new Error('ComfyUI ไม่ตอบ prompt_id (fallback): ' + JSON.stringify(r2).substring(0, 200));
        promptId = r2.prompt_id;
        onProgress(`กำลังเรนเดอร์ txt2img (${promptId.substring(0, 8)})...`);
        continue;
      }
      throw new Error(`ComfyUI node ${detail.node_id||'?'} (${detail.node_type||'?'}): ${msg}`);
    }
    const save = (job.outputs || {})[saveNodeId];
    if (!save || !save.images || !save.images.length) continue;

    const img = save.images[0];
    const vp  = `/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'output')}`;
    onProgress('ดาวน์โหลดรูป...');
    const buf = await comfyGetBinary(vp);
    if (outPath) { fs.mkdirSync(path.dirname(outPath), { recursive: true }); fs.writeFileSync(outPath, buf); }
    onProgress('เสร็จสิ้น');
    return { buf, outPath };
  }
  throw new Error(`ComfyUI timeout หลัง ${timeoutMs / 1000} วิ`);
}

module.exports = { generateMammuang };
