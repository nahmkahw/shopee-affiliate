'use strict';
/**
 * comfy-client.js — ComfyUI HTTP client สำหรับ Wan2.1 T2V video generation
 * API: checkHealth, checkWan21Model, generateClip
 */

const http   = require('http');
const fs     = require('fs');
const crypto = require('crypto');

const NEG_PROMPT = 'low quality, blurry, watermark, text overlay, nsfw, worst quality';

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

async function checkWan21Model(cfg, modelName) {
  try {
    const info = await _request(cfg, 'GET', '/object_info/UNETLoader');
    const models = info?.input?.required?.unet_name?.[0] || [];
    const found  = models.some(m => m.toLowerCase().includes('wan'));
    if (!found) {
      console.warn('⚠️  ไม่พบ Wan2.1 model ใน ComfyUI');
      console.warn('   วิธีติดตั้ง:');
      console.warn('   1. เปิด ComfyUI Manager → Install Models');
      console.warn('   2. หรือรัน: huggingface-cli download Wan-AI/Wan2.1-T2V-1.3B --local-dir ComfyUI/models/diffusion_models/Wan2.1/');
      console.warn('   3. T5 encoder: huggingface-cli download google/umt5-xxl --local-dir ComfyUI/models/clip/');
    }
    return { found, models: models.filter(m => m.toLowerCase().includes('wan')) };
  } catch (e) {
    return { found: false, models: [], error: e.message };
  }
}

function buildWan21Workflow(positivePrompt, modelName, seed) {
  // ComfyUI โหลด model จาก models/diffusion_models/ → ต้องใส่ subfolder prefix
  const unetName = modelName || 'Wan2.1/wan2.1_t2v_1.3B_bf16.safetensors';
  return {
    '1': { class_type: 'UNETLoader',
           inputs: { unet_name: unetName, weight_dtype: 'fp8_e4m3fn' } },
    '2': { class_type: 'CLIPLoader',
           inputs: { clip_name: 'umt5-xxl-enc-bf16.safetensors', type: 'wan' } },
    '3': { class_type: 'CLIPTextEncode',
           inputs: { clip: ['2', 0], text: positivePrompt } },
    '4': { class_type: 'CLIPTextEncode',
           inputs: { clip: ['2', 0], text: NEG_PROMPT } },
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
           inputs: { vae_name: 'wan_2.1_vae.safetensors' } },
    '9': { class_type: 'VAEDecodeVideo',
           inputs: { vae: ['8', 0], samples: ['7', 0] } },
   '10': { class_type: 'VHS_VideoCombine',
           inputs: { images: ['9', 0], frame_rate: DEFAULT_FPS, loop_count: 0,
                     filename_prefix: 'maprang', format: 'video/h264-mp4',
                     pingpong: false, save_output: true } },
  };
}

/**
 * Generate a single video clip via ComfyUI Wan2.1
 * @param {object} cfg          { host, port, timeoutMs, modelName }
 * @param {string} prompt       English visual prompt
 * @param {string} outputPath   Path to save the downloaded .mp4
 * @returns {Promise<string>}   outputPath
 */
async function generateClip(cfg, prompt, outputPath) {
  const clientId = crypto.randomUUID();
  const workflow = buildWan21Workflow(prompt, cfg.modelName);

  console.log(`  🎬 ComfyUI: submit "${prompt.substring(0, 60)}..."`);
  const { prompt_id } = await _request(cfg, 'POST', '/prompt', { client_id: clientId, prompt: workflow });
  if (!prompt_id) throw new Error('ComfyUI ไม่ตอบ prompt_id');

  const timeout = cfg.timeoutMs || 600000; // 10 นาที / clip
  const start   = Date.now();

  while (Date.now() - start < timeout) {
    await new Promise(r => setTimeout(r, 5000));
    const history = await _request(cfg, 'GET', `/history/${prompt_id}`);
    const job     = history[prompt_id];
    if (!job) { process.stdout.write('.'); continue; }
    if (job.status?.status_str === 'error') throw new Error('ComfyUI job error');

    // VHS_VideoCombine output อยู่ใน node '10'
    const videoOut = job.outputs?.['10']?.videos?.[0] || job.outputs?.['10']?.gifs?.[0];
    if (!videoOut) continue;

    process.stdout.write('\n');
    const url = `/view?filename=${encodeURIComponent(videoOut.filename)}&subfolder=${encodeURIComponent(videoOut.subfolder || '')}&type=${encodeURIComponent(videoOut.type || 'output')}`;
    const buf = await _getBinary(cfg, url);
    fs.writeFileSync(outputPath, buf);
    console.log(`  ✅ บันทึก ${outputPath} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
    return outputPath;
  }
  throw new Error(`ComfyUI timeout หลัง ${timeout / 60000} นาที`);
}

module.exports = { checkHealth, checkWan21Model, generateClip };
