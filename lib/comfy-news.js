'use strict';

const fs   = require('fs');
const http = require('http');

const NEG_PROMPT = 'lowres, bad anatomy, text, watermark, signature, blurry, nsfw';

function _post(cfg, path_, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = http.request({
      hostname: cfg.host || '10.3.17.118', port: cfg.port || 8188,
      path: path_, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => { let out = ''; res.on('data', d => out += d); res.on('end', () => { try { resolve(JSON.parse(out)); } catch(e) { reject(e); } }); });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('comfy timeout')); });
    req.on('error', reject); req.write(data); req.end();
  });
}

function _get(cfg, path_) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: cfg.host || '10.3.17.118', port: cfg.port || 8188, path: path_ },
      res => { let out = ''; res.on('data', d => out += d); res.on('end', () => { try { resolve(JSON.parse(out)); } catch(e) { reject(e); } }); });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('comfy timeout')); });
    req.on('error', reject);
  });
}

function _getBinary(cfg, path_) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: cfg.host || '10.3.17.118', port: cfg.port || 8188, path: path_ },
      res => { const chunks = []; res.on('data', d => chunks.push(d)); res.on('end', () => resolve(Buffer.concat(chunks))); });
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('comfy binary timeout')); });
    req.on('error', reject);
  });
}

/**
 * Generate a news illustration via ComfyUI and save to imagePath.
 * @param {{ host, port, enabled, timeoutMs }} cfg  — comfyui section from config.json
 * @param {string} imagePath  — absolute path to write the output jpg
 * @param {string} title      — news title used in the prompt
 */
const { withGpuLock } = require('./gpu-lock');  // serialize ComfyUI submit ข้าม agent
async function generateNewsImage(cfg, imagePath, title) {
  return withGpuLock('news', () => generateNewsImageInner(cfg, imagePath, title));
}
async function generateNewsImageInner(cfg, imagePath, title) {
  if (!cfg.enabled) return false;

  const prompt   = `news illustration, technology concept, artificial intelligence, futuristic digital world, glowing circuit, modern, clean, professional, photorealistic, ${title.substring(0, 80)}`;
  const seed     = Math.floor(Math.random() * 99999999999);
  const clientId = require('crypto').randomUUID();
  const workflow = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'AnythingXL_xl.safetensors' } },
    '2': { class_type: 'CLIPTextEncode',  inputs: { clip: ['1', 1], text: prompt } },
    '3': { class_type: 'CLIPTextEncode',  inputs: { clip: ['1', 1], text: NEG_PROMPT } },
    '4': { class_type: 'EmptyLatentImage',inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '5': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0], seed, steps: 20, cfg: 7, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1 } },
    '6': { class_type: 'VAEDecode',  inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'news' } },
  };

  const { prompt_id } = await _post(cfg, '/prompt', { client_id: clientId, prompt: workflow });
  if (!prompt_id) throw new Error('no prompt_id from ComfyUI');

  const timeout = cfg.timeoutMs || 120000;
  const start   = Date.now();
  while (Date.now() - start < timeout) {
    await new Promise(r => setTimeout(r, 3000));
    const history = await _get(cfg, '/history/' + prompt_id);
    const job     = history[prompt_id];
    if (!job) continue;
    if (job.status?.status_str === 'error') throw new Error('ComfyUI job error');
    const img = job.outputs?.['7']?.images?.[0];
    if (!img) continue;
    const buf = await _getBinary(cfg, `/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder||'')}&type=${encodeURIComponent(img.type||'output')}`);
    fs.writeFileSync(imagePath, buf);
    return true;
  }
  throw new Error('ComfyUI timeout');
}

module.exports = { generateNewsImage };
