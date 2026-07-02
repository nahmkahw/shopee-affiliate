'use strict';
/**
 * comfy-client-core.js — generic ComfyUI HTTP client shared across agents
 * (moved out of agents/maprang/pipeline/comfy-client.js so มะพร้าว can reuse it — Gate 2)
 * API: checkHealth, submitImageWorkflow, uploadImageToComfy
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { withGpuLock } = require('./gpu-lock');

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

/**
 * Shared: submit an image workflow → poll → download. ใช้ทั้ง T2I และ Flux Kontext
 * @param {string} [lockLabel]  agent label สำหรับ GPU queue dashboard (default 'comfy-img')
 * @returns {Promise<{outputPath, bytes}>}
 */
async function submitImageWorkflow(cfg, workflow, outNodeId, outputPath, timeoutMs = 180000, lockLabel = 'comfy-img') {
  return withGpuLock(lockLabel, async () => {
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

module.exports = { checkHealth, submitImageWorkflow, uploadImageToComfy };
