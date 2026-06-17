'use strict';
/**
 * agent-hub/comfy.js
 * Exports: buildComfyWorkflow, comfyPost, comfyGet, comfyGetBinary,
 *          submitComfyJob, getComfyJobResult, NEG_PROMPT, OUTFIT_PROMPTS, GENDER_BASE, STYLE_BASE
 */

const http   = require('http');
const crypto = require('crypto');

const NEG_PROMPT = 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, nsfw, nude, naked';

const OUTFIT_PROMPTS = {
  'นักเรียน': {
    f: 'serafuku, school uniform, white shirt, pleated skirt, red neckerchief, student',
    m: 'school uniform, blazer, student, necktie, school boy',
  },
  'ออฟฟิศ': {
    f: 'office lady, white shirt, pencil skirt, blazer, professional, business attire',
    m: 'business suit, white dress shirt, necktie, office worker, formal',
  },
  'มิโค': {
    f: 'miko, shrine maiden, red hakama, white haori, japanese traditional, shinto',
    m: 'shinto priest, white robe, hakama, japanese traditional, shrine priest',
  },
  'บัตเลอร์/เมด': {
    f: 'maid outfit, maid headdress, white apron, maid dress, frills',
    m: 'butler, black tailcoat, white gloves, formal butler uniform, bow tie',
  },
  'แนวต่อสู้': {
    f: 'fantasy armor, warrior girl, battle outfit, pauldrons, heroine, sword',
    m: 'fantasy armor, warrior, battle outfit, pauldrons, knight, sword',
  },
};

const GENDER_BASE = {
  f: '1girl, solo, female, portrait, upper body, looking at viewer, beautiful face, detailed eyes',
  m: '1boy, solo, male, portrait, upper body, looking at viewer, handsome, detailed eyes',
};

const STYLE_BASE = 'masterpiece, best quality, anime style, manga, vibrant colors, sharp details, professional illustration';

function buildComfyWorkflow(positivePrompt, seed, COMFYUI_HOST, COMFYUI_PORT) {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'AnythingXL_xl.safetensors' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: positivePrompt } },
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: NEG_PROMPT } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0],
        seed, steps: 25, cfg: 7, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1,
      },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'agentavatar' } },
  };
}

function _makeComfyOpts(COMFYUI_HOST, COMFYUI_PORT, urlPath) {
  return { hostname: COMFYUI_HOST, port: COMFYUI_PORT, path: urlPath };
}

function comfyPost(COMFYUI_HOST, COMFYUI_PORT, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { ..._makeComfyOpts(COMFYUI_HOST, COMFYUI_PORT, urlPath), method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      res => {
        let out = '';
        res.on('data', d => out += d);
        res.on('end', () => { try { resolve(JSON.parse(out)); } catch(e) { reject(e); } });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function comfyGet(COMFYUI_HOST, COMFYUI_PORT, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(_makeComfyOpts(COMFYUI_HOST, COMFYUI_PORT, urlPath), res => {
      let out = '';
      res.on('data', d => out += d);
      res.on('end', () => { try { resolve(JSON.parse(out)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function comfyGetBinary(COMFYUI_HOST, COMFYUI_PORT, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(_makeComfyOpts(COMFYUI_HOST, COMFYUI_PORT, urlPath), res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ data: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'image/png' }));
    }).on('error', reject);
  });
}

async function submitComfyJob(COMFYUI_HOST, COMFYUI_PORT, positivePrompt) {
  const seed     = Math.floor(Math.random() * 99999999999);
  const clientId = crypto.randomUUID();
  const workflow = buildComfyWorkflow(positivePrompt, seed, COMFYUI_HOST, COMFYUI_PORT);
  const result   = await comfyPost(COMFYUI_HOST, COMFYUI_PORT, '/prompt', { client_id: clientId, prompt: workflow });
  return result.prompt_id;
}

async function getComfyJobResult(COMFYUI_HOST, COMFYUI_PORT, promptId) {
  const history = await comfyGet(COMFYUI_HOST, COMFYUI_PORT, '/history/' + promptId);
  const job     = history[promptId];
  if (!job) return { status: 'pending' };
  if (job.status && job.status.status_str === 'error') return { status: 'error' };
  const outputs  = job.outputs || {};
  const saveNode = outputs['7'];
  if (!saveNode || !saveNode.images || saveNode.images.length === 0) return { status: 'pending' };
  const img = saveNode.images[0];
  return {
    status: 'done',
    filename: img.filename,
    subfolder: img.subfolder || '',
    type: img.type || 'output',
    viewUrl: `/api/comfy-image?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder||'')}&type=${encodeURIComponent(img.type||'output')}`,
  };
}

module.exports = {
  NEG_PROMPT, OUTFIT_PROMPTS, GENDER_BASE, STYLE_BASE,
  buildComfyWorkflow, comfyPost, comfyGet, comfyGetBinary,
  submitComfyJob, getComfyJobResult,
};
