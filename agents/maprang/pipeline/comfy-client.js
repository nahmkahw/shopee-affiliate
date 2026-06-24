'use strict';
/**
 * comfy-client.js — ComfyUI HTTP client สำหรับ Wan2.1 T2V video generation
 * API: checkHealth, checkWan21Model, generateClip
 */

const http      = require('http');
const fs        = require('fs');
const crypto    = require('crypto');
const WebSocket = require('ws');

const NEG_BASE = 'low quality, blurry, watermark, text overlay, nsfw, worst quality';

// 49 frames @ 16fps ≈ 3 วินาที — ปรับตาม VRAM (RTX 3060 12GB)
const DEFAULT_FRAMES = 49;
const DEFAULT_FPS    = 16;

function _request(cfg, method, path_, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req  = http.request({
      hostname: cfg.host || '10.3.17.118',
      port:     cfg.port || 8188,
      path:     path_,
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        try { resolve(JSON.parse(buf.toString())); } catch { resolve(buf); }
      });
    });
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('ComfyUI timeout')); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function _getBinary(cfg, path_, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: cfg.host || '10.3.17.118',
      port:     cfg.port || 8188,
      path:     path_,
    }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('download timeout')); });
    req.on('error', reject);
  });
}

async function checkHealth(cfg) {
  try {
    const r = await _request(cfg, 'GET', '/system_stats');
    return !!(r && r.system);
  } catch { return false; }
}

async function checkWan21Model(cfg) {
  try {
    // ใช้ /api/models/diffusion_models แทน /object_info/UNETLoader
    // เพราะ object_info เป็น cache ณ ตอน ComfyUI start — ไม่ refresh หลังติดตั้ง model ใหม่
    const models = await _request(cfg, 'GET', '/api/models/diffusion_models');
    const list   = Array.isArray(models) ? models : [];
    const found  = list.some(m => m.toLowerCase().includes('wan'));
    return { found, models: list.filter(m => m.toLowerCase().includes('wan')) };
  } catch (e) {
    return { found: false, models: [], error: e.message };
  }
}

function buildWan21Workflow(positivePrompt, modelName, seed, charNeg = '') {
  // ComfyUI โหลด model จาก models/diffusion_models/ → ต้องใส่ subfolder prefix
  const unetName  = modelName || 'Wan2.1\\wan2.1_t2v_1.3B_bf16.safetensors';
  const negPrompt = charNeg ? `${NEG_BASE}, ${charNeg}` : NEG_BASE;
  return {
    '1': { class_type: 'UNETLoader',
           inputs: { unet_name: unetName, weight_dtype: 'fp8_e4m3fn' } },
    '2': { class_type: 'CLIPLoader',
           inputs: { clip_name: 'umt5_xxl_fp16.safetensors', type: 'wan' } },
    '3': { class_type: 'CLIPTextEncode',
           inputs: { clip: ['2', 0], text: positivePrompt } },
    '4': { class_type: 'CLIPTextEncode',
           inputs: { clip: ['2', 0], text: negPrompt } },
    '5': { class_type: 'EmptyHunyuanLatentVideo',
           inputs: { width: 512, height: 512, length: DEFAULT_FRAMES, batch_size: 1 } },
    '6': { class_type: 'ModelSamplingSD3',
           inputs: { model: ['1', 0], shift: 8.0 } },
    '7': { class_type: 'KSampler',
           inputs: { model: ['6', 0], positive: ['3', 0], negative: ['4', 0],
                     latent_image: ['5', 0], seed: seed || Math.floor(Math.random() * 1e10),
                     steps: 20, cfg: 6.0, sampler_name: 'euler',
                     scheduler: 'simple', denoise: 1.0 } },
    '8': { class_type: 'VAELoader',
           inputs: { vae_name: 'wan_2.1_vae.safetensors' } }, // ✅ confirmed filename
    '9': { class_type: 'VAEDecodeLoopKJ',
           inputs: { samples: ['7', 0], vae: ['8', 0], overlap_latent_frames: 2 } },
   '10': { class_type: 'VHS_VideoCombine',
           inputs: { images: ['9', 0], frame_rate: DEFAULT_FPS, loop_count: 0,
                     filename_prefix: 'maprang', format: 'video/h264-mp4',
                     pingpong: false, save_output: true } },
  };
}

function buildCharImageWorkflow(charDesc, seed) {
  const pos = `masterpiece, best quality, anime style, anime key visual, ${charDesc}, full body, solo, white background, clean lineart, detailed face, studio anime`;
  const neg = 'photorealistic, 3d, lowres, bad anatomy, extra fingers, worst quality, blurry, watermark, nsfw, multiple characters, crowd';
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
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'char_ref' } },
  };
}

/**
 * สร้างรูปตัวละคร reference (AnythingXL T2I) — ใช้ anchor ทุก scene
 * @returns {Promise<string>} outputPath
 */
async function generateCharacterImage(cfg, charDesc, outputPath, seed) {
  const clientId = crypto.randomUUID();
  const workflow = buildCharImageWorkflow(charDesc, seed);
  console.log('  🎨 ComfyUI T2I: สร้าง character reference image...');
  const { prompt_id } = await _request(cfg, 'POST', '/prompt', { client_id: clientId, prompt: workflow });
  if (!prompt_id) throw new Error('ComfyUI ไม่ตอบ prompt_id (char image)');

  const start = Date.now();
  while (Date.now() - start < 180000) {
    await new Promise(r => setTimeout(r, 3000));
    const history = await _request(cfg, 'GET', `/history/${prompt_id}`);
    const job     = history[prompt_id];
    if (!job) continue;
    if (job.status?.status_str === 'error') throw new Error('ComfyUI char image error');
    const imgOut  = job.outputs?.['7']?.images?.[0];
    if (!imgOut) continue;

    const url = `/view?filename=${encodeURIComponent(imgOut.filename)}&subfolder=${encodeURIComponent(imgOut.subfolder || '')}&type=${encodeURIComponent(imgOut.type || 'output')}`;
    const buf = await _getBinary(cfg, url, 60000);
    fs.writeFileSync(outputPath, buf);
    console.log(`  ✅ ref image: ${outputPath} (${(buf.length / 1024).toFixed(0)} KB)`);
    return outputPath;
  }
  throw new Error('ComfyUI timeout (char image)');
}

/**
 * Generate a single video clip via ComfyUI Wan2.1
 * @param {object} cfg          { host, port, timeoutMs, modelName }
 * @param {string} prompt       English visual prompt
 * @param {string} outputPath   Path to save the downloaded .mp4
 * @returns {Promise<string>}   outputPath
 */
async function generateClip(cfg, prompt, outputPath, seed, charNeg = '') {
  const clientId     = crypto.randomUUID();
  const workflow     = buildWan21Workflow(prompt, cfg.modelName, seed, charNeg);
  const progressFile = outputPath.replace(/clip_(\d+)\.mp4$/, 'progress_$1.json');
  const previewFile  = outputPath.replace(/clip_(\d+)\.mp4$/, 'preview_$1.jpg');

  // WebSocket สำหรับ step progress + preview (best-effort — ไม่กระทบถ้า WS fail)
  let ws;
  try {
    ws = new WebSocket(`ws://${cfg.host || '10.3.17.118'}:${cfg.port || 8188}/ws?clientId=${clientId}`);
    ws.on('message', (data, isBinary) => {
      try {
        if (isBinary) {
          // ComfyUI binary frame: 4 bytes type + 4 bytes format + JPEG bytes
          if (data.length > 8) fs.writeFileSync(previewFile, data.slice(8));
          return;
        }
        const msg = JSON.parse(data.toString());
        if (msg.type === 'progress') {
          const { value, max } = msg.data || {};
          if (value != null && max) fs.writeFileSync(progressFile,
            JSON.stringify({ step: value, total: max, pct: Math.round(value / max * 100), t: Date.now() })
          );
        }
      } catch {}
    });
    ws.on('error', () => {});
  } catch {}

  console.log(`  🎬 ComfyUI: submit "${prompt.substring(0, 60)}..."`);
  const { prompt_id } = await _request(cfg, 'POST', '/prompt', { client_id: clientId, prompt: workflow });
  if (!prompt_id) { ws?.close(); throw new Error('ComfyUI ไม่ตอบ prompt_id'); }

  const timeout = cfg.timeoutMs || 600000;
  const start   = Date.now();

  while (Date.now() - start < timeout) {
    await new Promise(r => setTimeout(r, 5000));
    const history = await _request(cfg, 'GET', `/history/${prompt_id}`);
    const job     = history[prompt_id];
    if (!job) { process.stdout.write('.'); continue; }
    if (job.status?.status_str === 'error') { ws?.close(); throw new Error('ComfyUI job error'); }

    const videoOut = job.outputs?.['10']?.videos?.[0] || job.outputs?.['10']?.gifs?.[0];
    if (!videoOut) continue;

    process.stdout.write('\n');
    const url = `/view?filename=${encodeURIComponent(videoOut.filename)}&subfolder=${encodeURIComponent(videoOut.subfolder || '')}&type=${encodeURIComponent(videoOut.type || 'output')}`;
    const buf = await _getBinary(cfg, url);
    fs.writeFileSync(outputPath, buf);
    ws?.close();
    console.log(`  ✅ บันทึก ${outputPath} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
    return outputPath;
  }
  ws?.close();
  throw new Error(`ComfyUI timeout หลัง ${timeout / 60000} นาที`);
}

module.exports = { checkHealth, checkWan21Model, generateClip, generateCharacterImage };
