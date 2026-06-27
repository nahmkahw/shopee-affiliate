'use strict';
/**
 * comfy-client.js — ComfyUI HTTP client สำหรับ Wan2.1 T2V video generation
 * API: checkHealth, checkWan21Model, generateClip
 */

const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const crypto    = require('crypto');
const WebSocket = require('ws');
const { withGpuLock } = require('../../../lib/gpu-lock');  // serialize ComfyUI submit ข้าม agent

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
    '1': { class_type: 'UNETLoader',  inputs: { unet_name: unetName, weight_dtype: 'fp8_e4m3fn' } },
    '2': { class_type: 'CLIPLoader',  inputs: { clip_name: 'umt5_xxl_fp16.safetensors', type: 'wan' } },
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: positivePrompt } },
    '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: negPrompt } },
    '5': { class_type: 'EmptyHunyuanLatentVideo', inputs: { width: 512, height: 512, length: DEFAULT_FRAMES, batch_size: 1 } },
    '6': { class_type: 'ModelSamplingSD3', inputs: { model: ['1', 0], shift: 8.0 } },
    '7': { class_type: 'KSampler', inputs: { model: ['6', 0], positive: ['3', 0], negative: ['4', 0],
             latent_image: ['5', 0], seed: seed || Math.floor(Math.random() * 1e10),
             steps: 20, cfg: 6.0, sampler_name: 'euler', scheduler: 'simple', denoise: 1.0 } },
    '8': { class_type: 'VAELoader', inputs: { vae_name: 'wan_2.1_vae.safetensors' } },
    '9': { class_type: 'VAEDecodeLoopKJ', inputs: { samples: ['7', 0], vae: ['8', 0], overlap_latent_frames: 2 } },
   '10': { class_type: 'VHS_VideoCombine', inputs: { images: ['9', 0], frame_rate: DEFAULT_FPS, loop_count: 0,
             filename_prefix: 'maprang', format: 'video/h264-mp4', pingpong: false, save_output: true } },
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
 * Shared: submit image workflow → poll → download. ใช้ทั้ง T2I และ Flux Kontext
 * @returns {Promise<{outputPath, bytes}>}
 */
async function submitImageWorkflow(cfg, workflow, outNodeId, outputPath, timeoutMs = 180000) {
  return withGpuLock('maprang-img', async () => {
    const clientId = crypto.randomUUID();
    const { prompt_id } = await _request(cfg, 'POST', '/prompt', { client_id: clientId, prompt: workflow });
    if (!prompt_id) throw new Error('ComfyUI ไม่ตอบ prompt_id (image)');
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 3000));
      const history = await _request(cfg, 'GET', `/history/${prompt_id}`);
      const job     = history[prompt_id];
      if (!job) { process.stdout.write('.'); continue; }
      if (job.status?.status_str === 'error') throw new Error('ComfyUI image job error');
      const imgOut  = job.outputs?.[outNodeId]?.images?.[0];
      if (!imgOut) continue;
      const url = `/view?filename=${encodeURIComponent(imgOut.filename)}&subfolder=${encodeURIComponent(imgOut.subfolder || '')}&type=${encodeURIComponent(imgOut.type || 'output')}`;
      const buf = await _getBinary(cfg, url, 60000);
      fs.writeFileSync(outputPath, buf);
      return { outputPath, bytes: buf.length };
    }
    throw new Error('ComfyUI timeout (image)');
  });
}

/**
 * สร้างรูปตัวละคร reference (AnythingXL T2I) — ใช้ anchor ทุก scene
 * @returns {Promise<string>} outputPath
 */
async function generateCharacterImage(cfg, charDesc, outputPath, seed) {
  console.log('  🎨 ComfyUI T2I: สร้าง character reference image...');
  const imageTimeout = cfg.imageTimeoutMs || cfg.timeoutMs || 300000;
  const { outputPath: out, bytes } = await submitImageWorkflow(cfg, buildCharImageWorkflow(charDesc, seed), '7', outputPath, imageTimeout);
  console.log(`  ✅ ref image: ${out} (${(bytes / 1024).toFixed(0)} KB)`);
  return out;
}

/**
 * Shared: submit workflow → WS progress → poll → download mp4
 * Used by both T2V and I2V paths
 */
async function _runClipWorkflow(cfg, workflow, outputPath) {
  return withGpuLock('maprang-clip', () => _runClipWorkflowInner(cfg, workflow, outputPath));
}
async function _runClipWorkflowInner(cfg, workflow, outputPath) {
  const clientId = crypto.randomUUID();
  const progM    = outputPath.match(/clip_(\d+)\.mp4$/);
  const progFile = progM ? outputPath.replace(/clip_(\d+)\.mp4$/, 'progress_$1.json') : null;
  const prevFile = progM ? outputPath.replace(/clip_(\d+)\.mp4$/, 'preview_$1.jpg')  : null;
  let ws;
  try {
    ws = new WebSocket(`ws://${cfg.host||'10.3.17.118'}:${cfg.port||8188}/ws?clientId=${clientId}`);
    ws.on('message', (data, isBinary) => {
      try {
        if (isBinary) { if (prevFile && data.length > 8) fs.writeFileSync(prevFile, data.slice(8)); return; }
        const msg = JSON.parse(data.toString());
        if (msg.type === 'progress' && progFile) {
          const { value, max } = msg.data || {};
          if (value != null && max)
            fs.writeFileSync(progFile, JSON.stringify({ step: value, total: max, pct: Math.round(value/max*100), t: Date.now() }));
        }
      } catch {}
    });
    ws.on('error', () => {});
  } catch {}
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
    let videoOut = null;
    for (const nid of Object.keys(job.outputs || {})) {
      const out = job.outputs[nid];
      videoOut = out.videos?.[0] || out.gifs?.[0];
      if (videoOut) break;
    }
    if (!videoOut) continue;
    process.stdout.write('\n');
    const url = `/view?filename=${encodeURIComponent(videoOut.filename)}&subfolder=${encodeURIComponent(videoOut.subfolder||'')}&type=${encodeURIComponent(videoOut.type||'output')}`;
    const buf = await _getBinary(cfg, url);
    fs.writeFileSync(outputPath, buf);
    ws?.close();
    console.log(`  ✅ บันทึก ${outputPath} (${(buf.length/1024/1024).toFixed(1)} MB)`);
    return outputPath;
  }
  ws?.close();
  throw new Error(`ComfyUI timeout หลัง ${timeout/60000} นาที`);
}

async function generateClip(cfg, prompt, outputPath, seed, charNeg = '') {
  console.log(`  🎬 ComfyUI T2V: "${prompt.substring(0, 60)}..."`);
  return _runClipWorkflow(cfg, buildWan21Workflow(prompt, cfg.modelName, seed, charNeg), outputPath);
}

// ─── I2V ─────────────────────────────────────────────────────────────────────

async function checkI2VCapability(cfg) {
  try {
    const [diff, cv] = await Promise.all([
      _request(cfg, 'GET', '/api/models/diffusion_models').catch(() => []),
      _request(cfg, 'GET', '/api/models/clip_vision').catch(() => []),
    ]);
    const i2vModel = (Array.isArray(diff) ? diff : []).find(m => m.toLowerCase().includes('i2v'));
    // actual filename: CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors — match ViT-H
    const cvModel  = (Array.isArray(cv)   ? cv   : []).find(m => /vit[-_]h/i.test(m));
    return { available: !!(i2vModel && cvModel), i2vModel: i2vModel || null, clipVisionModel: cvModel || null };
  } catch { return { available: false, i2vModel: null, clipVisionModel: null }; }
}

const I2V_FRAMES = 25;  // 14B model หนัก — ลดจาก 49 เพื่อ speed
const I2V_STEPS  = 10;  // ลดจาก 20

function buildWan21I2VWorkflow(prompt, i2vModel, clipVisionModel, imageFilename, seed, charNeg = '') {
  const neg = charNeg ? `${NEG_BASE}, ${charNeg}` : NEG_BASE;
  return {
    '1':  { class_type: 'UNETLoader',        inputs: { unet_name: i2vModel, weight_dtype: 'fp8_e4m3fn' } },
    '2':  { class_type: 'CLIPLoader',        inputs: { clip_name: 'umt5_xxl_fp16.safetensors', type: 'wan' } },
    '3':  { class_type: 'VAELoader',         inputs: { vae_name: 'wan_2.1_vae.safetensors' } },
    '4':  { class_type: 'CLIPVisionLoader',  inputs: { clip_name: clipVisionModel } },
    '5':  { class_type: 'LoadImage',         inputs: { image: imageFilename } },
    '6':  { class_type: 'CLIPVisionEncode',  inputs: { clip_vision: ['4',0], image: ['5',0], crop: 'center' } },
    '7':  { class_type: 'CLIPTextEncode',    inputs: { clip: ['2',0], text: prompt } },
    '8':  { class_type: 'CLIPTextEncode',    inputs: { clip: ['2',0], text: neg } },
    '9':  { class_type: 'WanImageToVideo',   inputs: { positive: ['7',0], negative: ['8',0], vae: ['3',0],
                                                        clip_vision_output: ['6',0], start_image: ['5',0],
                                                        width: 512, height: 512, length: I2V_FRAMES, batch_size: 1 } },
    '10': { class_type: 'ModelSamplingSD3',  inputs: { model: ['1',0], shift: 8.0 } },
    '11': { class_type: 'KSampler',          inputs: { model: ['10',0],
                                                        positive: ['9',0], negative: ['9',1], latent_image: ['9',2],
                                                        seed: seed||Math.floor(Math.random()*1e10),
                                                        steps: I2V_STEPS, cfg: 6.0, sampler_name: 'euler',
                                                        scheduler: 'simple', denoise: 1.0 } },
    '12': { class_type: 'VAEDecodeLoopKJ',   inputs: { samples: ['11',0], vae: ['3',0], overlap_latent_frames: 2 } },
    '13': { class_type: 'VHS_VideoCombine',  inputs: { images: ['12',0], frame_rate: DEFAULT_FPS, loop_count: 0,
                                                        filename_prefix: 'maprang_i2v', format: 'video/h264-mp4',
                                                        pingpong: false, save_output: true } },
  };
}

function uploadImageToComfy(cfg, imagePath) {
  return new Promise((resolve, reject) => {
    const boundary = '----CF' + Math.random().toString(36).slice(2);
    const imgBuf   = fs.readFileSync(imagePath);
    const fname    = path.basename(imagePath);
    const head     = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${fname}"\r\nContent-Type: image/jpeg\r\n\r\n`);
    const body     = Buffer.concat([head, imgBuf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const req      = http.request({
      hostname: cfg.host||'10.3.17.118', port: cfg.port||8188,
      path: '/upload/image', method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => { try { resolve(JSON.parse(buf).name || fname); } catch { resolve(fname); } });
    });
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('upload timeout')); });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function generateClipI2V(cfg, prompt, refImagePath, outputPath, seed, charNeg = '') {
  let filename;
  try { filename = await uploadImageToComfy(cfg, refImagePath); }
  catch (e) {
    console.warn(`  ⚠️ I2V upload failed (${e.message}) — fallback T2V`);
    return generateClip(cfg, prompt, outputPath, seed, charNeg);
  }
  console.log(`  🎬 ComfyUI I2V: "${prompt.substring(0, 50)}..." ref=${filename}`);
  const workflow = buildWan21I2VWorkflow(prompt, cfg.i2vModelName, cfg.clipVisionModel, filename, seed, charNeg);
  try { return await _runClipWorkflow(cfg, workflow, outputPath); }
  catch (e) {
    console.warn(`  ⚠️ I2V workflow failed (${e.message}) — fallback T2V`);
    return generateClip(cfg, prompt, outputPath, seed, charNeg);
  }
}

module.exports = { checkHealth, checkWan21Model, generateClip, generateClipI2V, checkI2VCapability,
  generateCharacterImage, submitImageWorkflow, uploadImageToComfy };
