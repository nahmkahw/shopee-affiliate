/**
 * anime-gen.js — สร้างตัวละครอนิเมะจากรูปคนต้นแบบ (IPAdapter FaceID Plus v2)
 *
 * Pipeline:
 *   1) upload รูปคนต้นแบบเข้า ComfyUI (/upload/image)
 *   2) workflow: AnythingXL + IPAdapterUnifiedLoaderFaceID(FACEID PLUS V2) + IPAdapterFaceID
 *   3) poll /history → ดาวน์โหลดรูปอนิเมะ
 *
 * ต้องมีบนเครื่อง ComfyUI (10.3.17.118):
 *   - checkpoint: AnythingXL_xl.safetensors            ✓ มีแล้ว
 *   - ipadapter : ip-adapter-faceid-plusv2_sdxl.bin     ✓ มีแล้ว
 *   - lora      : ip-adapter-faceid-plusv2_sdxl_lora.safetensors  ⚠️ ต้องติดตั้งเพิ่ม
 *   - insightface (buffalo_l) + CLIP-ViT-H              ✓ มีแล้ว
 *
 * ใช้เป็น module:
 *   const { generateAnime } = require('./anime-gen');
 *   await generateAnime(refImagePath, { prompt, outPath });
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const COMFYUI_HOST = process.env.COMFYUI_HOST || '10.3.17.118';
const COMFYUI_PORT = parseInt(process.env.COMFYUI_PORT || '8188', 10);

// ─── Prompt defaults (anime character) ──────────────────────────────────────────

const STYLE_BASE = [
  'masterpiece', 'best quality', 'highly detailed',
  'anime style', 'anime key visual', 'vibrant colors',
  'clean lineart', 'detailed face', 'beautiful detailed eyes',
  'studio anime', 'cel shading',
].join(', ');

const NEG_PROMPT = [
  'photorealistic', 'realistic', '3d', 'photograph',
  'lowres', 'bad anatomy', 'bad hands', 'extra fingers', 'fused fingers',
  'worst quality', 'low quality', 'jpeg artifacts', 'blurry',
  'watermark', 'signature', 'text', 'logo',
  'deformed', 'disfigured', 'mutated', 'extra limbs', 'nsfw',
].join(', ');

// ─── ComfyUI HTTP helpers ───────────────────────────────────────────────────────

function comfyPost(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = http.request(
      { hostname: COMFYUI_HOST, port: COMFYUI_PORT, path: urlPath, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      res => { let o = ''; res.on('data', d => o += d); res.on('end', () => {
        try { resolve(JSON.parse(o)); } catch (e) { reject(new Error('ComfyUI parse: ' + o.substring(0, 200))); }
      }); });
    req.on('error', reject); req.write(data); req.end();
  });
}

function comfyGet(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: COMFYUI_HOST, port: COMFYUI_PORT, path: urlPath }, res => {
      let o = ''; res.on('data', d => o += d);
      res.on('end', () => { try { resolve(JSON.parse(o)); } catch (e) { reject(new Error('ComfyUI parse error')); } });
    }).on('error', reject);
  });
}

function comfyGetBinary(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: COMFYUI_HOST, port: COMFYUI_PORT, path: urlPath }, res => {
      const chunks = []; res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

/** upload รูปเข้า ComfyUI input folder → คืนชื่อไฟล์ที่ LoadImage ใช้ได้ */
function comfyUploadImage(imagePath) {
  return new Promise((resolve, reject) => {
    const imgBuf   = fs.readFileSync(imagePath);
    const fileName = `anime_ref_${Date.now()}_${path.basename(imagePath)}`;
    const boundary = '----AnimeBoundary' + crypto.randomBytes(8).toString('hex');

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
        catch (e) { reject(new Error('upload parse: ' + o.substring(0, 200))); }
      }); });
    req.on('error', reject); req.write(payload); req.end();
  });
}

// ─── Workflow builder ───────────────────────────────────────────────────────────

function buildWorkflow({ refImageName, positive, seed, width, height, faceWeight, loraStrength, hiresScale }) {
  return {
    '1':  { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'AnythingXL_xl.safetensors' } },
    '2':  { class_type: 'LoadImage',              inputs: { image: refImageName } },
    '3':  { class_type: 'IPAdapterUnifiedLoaderFaceID', inputs: {
              model: ['1', 0], preset: 'FACEID PLUS V2', lora_strength: loraStrength, provider: 'CUDA' } },
    '4':  { class_type: 'IPAdapterFaceID', inputs: {
              model: ['3', 0], ipadapter: ['3', 1], image: ['2', 0],
              weight: faceWeight, weight_faceidv2: faceWeight, weight_type: 'linear',
              combine_embeds: 'concat', start_at: 0.0, end_at: 1.0, embeds_scaling: 'V only' } },
    '5':  { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: positive } },
    '6':  { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: NEG_PROMPT } },
    '7':  { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    // pass 1 — base 1024
    '8':  { class_type: 'KSampler', inputs: {
              model: ['4', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['7', 0],
              seed, steps: 30, cfg: 6.5, sampler_name: 'dpmpp_2m_sde', scheduler: 'karras', denoise: 1 } },
    // hires fix — อัปสเกล latent แล้ว refine อีกรอบ (รายละเอียดสูงขึ้น)
    '11': { class_type: 'LatentUpscaleBy', inputs: {
              samples: ['8', 0], upscale_method: 'nearest-exact', scale_by: hiresScale } },
    '12': { class_type: 'KSampler', inputs: {
              model: ['4', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['11', 0],
              seed, steps: 20, cfg: 6.5, sampler_name: 'dpmpp_2m_sde', scheduler: 'karras', denoise: 0.5 } },
    '9':  { class_type: 'VAEDecode', inputs: { samples: ['12', 0], vae: ['1', 2] } },
    '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'anime_char' } },
  };
}

// ─── Main generator ─────────────────────────────────────────────────────────────

async function generateAnime(refImagePath, options = {}) {
  const {
    prompt       = '1girl, solo, upper body, looking at viewer',
    outPath      = path.join(__dirname, 'gallery', `out_${Date.now()}.png`),
    width        = 1024,
    height       = 1024,
    faceWeight   = 1.1,
    loraStrength = 0.8,
    hiresScale   = 1.5,                 // hires fix: 1024 → ~1536px (รายละเอียดสูงขึ้น)
    timeoutMs    = 6 * 60 * 1000,       // เพิ่มเวลา เพราะ 2 pass
    pollInterval = 3000,
    onProgress   = () => {},
  } = options;

  if (!fs.existsSync(refImagePath)) throw new Error('ไม่พบรูปต้นแบบ: ' + refImagePath);

  onProgress('upload รูปต้นแบบเข้า ComfyUI...');
  const refImageName = await comfyUploadImage(refImagePath);

  const positive = `${STYLE_BASE}, ${prompt}`;
  const seed     = Math.floor(Math.random() * 9_999_999_999);
  const workflow = buildWorkflow({ refImageName, positive, seed, width, height, faceWeight, loraStrength, hiresScale });

  onProgress('ส่งงานเข้า ComfyUI...');
  const clientId = crypto.randomUUID();
  const result   = await comfyPost('/prompt', { client_id: clientId, prompt: workflow });
  if (!result.prompt_id) {
    throw new Error('ComfyUI ไม่ตอบ prompt_id: ' + JSON.stringify(result).substring(0, 300));
  }
  const promptId = result.prompt_id;
  onProgress(`กำลังเรนเดอร์ (job ${promptId.substring(0, 8)})...`);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollInterval));
    const history = await comfyGet('/history/' + promptId);
    const job     = history[promptId];
    if (!job) continue;

    if (job.status && job.status.status_str === 'error') {
      const msgs = JSON.stringify(job.status.messages || []).substring(0, 400);
      throw new Error('ComfyUI error: ' + msgs);
    }
    const save = (job.outputs || {})['10'];
    if (!save || !save.images || !save.images.length) continue;

    const img = save.images[0];
    const vp  = `/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'output')}`;
    onProgress('ดาวน์โหลดรูป...');
    const buf = await comfyGetBinary(vp);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buf);
    onProgress('เสร็จสิ้น');
    return outPath;
  }
  throw new Error(`ComfyUI timeout หลัง ${timeoutMs / 1000} วิ`);
}

module.exports = { generateAnime, STYLE_BASE, NEG_PROMPT };
