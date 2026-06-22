'use strict';
/**
 * agent-hub/routes/mammuang.js
 * exports register(req, res, url, rawUrl, method, deps) — /dashboard/mammuang/*
 */

const fs   = require('fs');
const path = require('path');
const { expandConcept }    = require('../../agents/mammuang/concept-expander');
const { generateMammuang } = require('../../agents/mammuang/mammuang-gen');
const { renderBalloonOnImage } = require('../../agents/anime/balloon-canvas');
const { compositeProductOnImage } = require('../../agents/mammuang/composite');
const http = require('http');

function reply(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req, maxBytes = 512 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', d => { chunks.push(d); size += d.length; if (size > maxBytes) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

function callOllama(prompt) {
  const base  = process.env.OLLAMA_HOST || 'http://10.3.17.118:11434';
  const model = process.env.OLLAMA_MODEL || 'scb10x/llama3.1-typhoon2-8b-instruct:latest';
  const body  = JSON.stringify({ model, prompt, stream: false });
  return new Promise((resolve, reject) => {
    const u = new URL(base + '/api/generate');
    const req = http.request({ hostname: u.hostname, port: parseInt(u.port||'80'), path: '/api/generate',
      method:'POST', headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)} },
      res2 => { let o=''; res2.on('data',d=>o+=d); res2.on('end',()=>{ try{resolve(JSON.parse(o).response||'');}catch{reject(new Error('parse'));} }); });
    req.on('error',reject); req.setTimeout(60000,()=>{req.destroy();reject(new Error('timeout'));});
    req.write(body); req.end();
  });
}

function register(req, res, url, rawUrl, method, deps) {
  const { ROOT } = deps;
  const GAL_DIR    = path.join(ROOT, 'agents', 'mammuang', 'gallery');
  const UPLOAD_DIR = path.join(ROOT, 'agents', 'mammuang', 'uploads');
  const REF_PATH   = path.join(ROOT, 'agents', 'mammuang', 'ref-image.png');

  // ── Dashboard HTML ─────────────────────────────────────────────────────────
  if (url === '/dashboard/mammuang') {
    const htmlFile = path.join(ROOT, 'agents', 'mammuang', 'dashboard.html');
    if (!fs.existsSync(htmlFile)) { res.writeHead(404); return res.end('ไม่พบ dashboard.html'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(htmlFile, 'utf8'));
  }

  // ── Serve uploaded product images ─────────────────────────────────────────
  const uploadMatch = url.match(/^\/dashboard\/mammuang\/uploads\/([\w.-]+)$/);
  if (uploadMatch) {
    const fp = path.join(UPLOAD_DIR, uploadMatch[1]);
    if (!fs.existsSync(fp)) { res.writeHead(404); return res.end('Not found'); }
    const ct = {'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'}[path.extname(fp).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-cache' });
    return fs.createReadStream(fp).pipe(res);
  }

  // ── Upload product image (base64 JSON) ────────────────────────────────────
  if (url === '/dashboard/mammuang/api/upload-product' && method === 'POST') {
    res._claimed = true;
    readBody(req, 20*1024*1024).then(async body => {
      try {
        const { filename, data } = body;
        if (!data || !filename) return reply(res, 400, { ok:false, error:'Missing data' });
        const ext = path.extname(filename).toLowerCase() || '.jpg';
        const safeName = Date.now() + ext;
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        fs.writeFileSync(path.join(UPLOAD_DIR, safeName), Buffer.from(data.replace(/^data:[^;]+;base64,/,''), 'base64'));
        reply(res, 200, { ok: true, filename: safeName });
      } catch(e) { reply(res, 200, { ok:false, error:e.message }); }
    }).catch(e => reply(res, 500, { ok:false, error:e.message }));
    return;
  }

  // ── AI review speech via Ollama ───────────────────────────────────────────
  if (url === '/dashboard/mammuang/api/review-speech' && method === 'POST') {
    res._claimed = true;
    readBody(req).then(async body => {
      try {
        const { productName, character, concept } = body;
        if (!productName) return reply(res, 400, { ok:false, error:'Missing productName' });
        const prompt = `สร้างประโยครีวิวสินค้าภาษาไทย สั้น กระชับ น่ารัก สำหรับตัวละครการ์ตูน\nตัวละคร: ${character||'น่ารัก'}\nสินค้า: ${productName}\nคอนเซ็ปต์: ${concept||''}\nตอบเฉพาะประโยครีวิว 1 ประโยค ไม่เกิน 25 คำ ไม่ต้องอธิบายเพิ่ม`;
        const speech = await callOllama(prompt);
        reply(res, 200, { ok:true, speech: speech.trim() });
      } catch(e) { reply(res, 200, { ok:false, error:e.message }); }
    }).catch(e => reply(res, 500, { ok:false, error:e.message }));
    return;
  }

  // ── Serve JS overlay files ────────────────────────────────────────────────
  if (url === '/dashboard/mammuang/product-overlay.js') {
    const fp = path.join(ROOT, 'agents', 'mammuang', 'product-overlay.js');
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '');
  }

  if (url === '/dashboard/mammuang/balloon-editor.js') {
    const fp = path.join(ROOT, 'agents', 'mammuang', 'balloon-editor.js');
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '');
  }

  // ── Ref image: GET info ───────────────────────────────────────────────────
  if (url === '/dashboard/mammuang/api/ref-image' && method === 'GET') {
    const exists = fs.existsSync(REF_PATH);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ exists, url: exists ? `/dashboard/mammuang/ref-image?t=${Date.now()}` : null }));
  }

  // ── Ref image: serve file ─────────────────────────────────────────────────
  if (url.startsWith('/dashboard/mammuang/ref-image') && method === 'GET') {
    if (!fs.existsSync(REF_PATH)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(REF_PATH).pipe(res);
  }

  // ── Ref image: upload (base64 JSON) ──────────────────────────────────────
  if (url === '/dashboard/mammuang/api/upload-ref' && method === 'POST') {
    res._claimed = true;
    readBody(req, 20 * 1024 * 1024).then(body => {
      try {
        const { data } = body;
        if (!data) return reply(res, 400, { ok: false, error: 'Missing data' });
        fs.writeFileSync(REF_PATH, Buffer.from(data.replace(/^data:[^;]+;base64,/, ''), 'base64'));
        reply(res, 200, { ok: true });
      } catch(e) { reply(res, 200, { ok: false, error: e.message }); }
    }).catch(e => reply(res, 500, { ok: false, error: e.message }));
    return;
  }

  // ── Ref image: delete ────────────────────────────────────────────────────
  if (url === '/dashboard/mammuang/api/ref-image' && method === 'DELETE') {
    try { if (fs.existsSync(REF_PATH)) fs.unlinkSync(REF_PATH); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // ── Re-render balloon with new params ─────────────────────────────────────
  if (url === '/dashboard/mammuang/api/rerender-balloon' && method === 'POST') {
    res._claimed = true;
    readBody(req).then(async body => {
      try {
        const { id, speech, bxN, byN, bwN, bhN, txN, tyN, template, pxN, pyN, pwN, phN, productFilename } = body;
        if (!id) return reply(res, 400, { ok: false, error: 'Missing id' });
        const dir     = path.join(GAL_DIR, id);
        const srcPath = path.join(dir, 'image.png');
        if (!fs.existsSync(srcPath)) return reply(res, 400, { ok: false, error: 'ไม่พบ image.png' });
        const finalPath = path.join(dir, 'final.jpg');
        let basePath = srcPath;
        if (productFilename && pxN !== undefined) {
          const prodPath = path.join(UPLOAD_DIR, productFilename);
          if (fs.existsSync(prodPath)) {
            const compPath = path.join(dir, 'composited.png');
            await compositeProductOnImage(srcPath, prodPath, { bxN: pxN, byN: pyN, bwN: pwN, bhN: phN }, compPath);
            basePath = compPath;
          }
        }
        const tailFrac  = { x: txN ?? 0.46, y: tyN ?? 0.46 };
        const opts      = { template: template || 'speech', rect: { bx: bxN, by: byN, bw: bwN, bh: bhN } };
        await renderBalloonOnImage(basePath, speech || '', tailFrac, finalPath, opts);
        const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
        meta.speech = speech; meta.template = template;
        meta.balloonRect = { bxN: bxN??0.04, byN: byN??0.65, bwN: bwN??0.56, bhN: bhN??0.30, txN: txN??0.46, tyN: tyN??0.46 };
        if (pxN !== undefined) meta.productRect = { pxN, pyN, pwN, phN };
        fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
        reply(res, 200, { ok: true });
      } catch (e) {
        console.error('[mammuang] rerender error:', e.message);
        reply(res, 200, { ok: false, error: e.message.substring(0, 300) });
      }
    }).catch(e => reply(res, 500, { ok: false, error: e.message }));
    return;
  }

  // ── Serve gallery images: /dashboard/mammuang/image/{id}/{file} ────────────
  const imgMatch = url.match(/^\/dashboard\/mammuang\/image\/([\w.-]+)\/([\w.-]+)$/);
  if (imgMatch) {
    const fp = path.join(GAL_DIR, imgMatch[1], imgMatch[2]);
    if (!fs.existsSync(fp)) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { 'Content-Type': ext === '.png' ? 'image/png' : 'image/jpeg', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(fp).pipe(res);
  }

  // ── Gallery list ───────────────────────────────────────────────────────────
  if (url === '/dashboard/mammuang/api/list' && method === 'GET') {
    let items = [];
    try {
      items = fs.readdirSync(GAL_DIR)
        .filter(d => fs.existsSync(path.join(GAL_DIR, d, 'meta.json')))
        .map(id => { try { return { id, ...JSON.parse(fs.readFileSync(path.join(GAL_DIR, id, 'meta.json'), 'utf8')) }; } catch { return null; } })
        .filter(Boolean)
        .sort((a, b) => (b.created || 0) - (a.created || 0));
    } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(items));
  }

  // ── Chat: ขยาย concept ด้วย AI ─────────────────────────────────────────────
  if (url === '/dashboard/mammuang/api/chat' && method === 'POST') {
    res._claimed = true;
    readBody(req).then(async body => {
      try {
        const { history = [] } = body;
        if (!history.length) return reply(res, 400, { ok: false, error: 'ไม่มี history' });
        const result = await expandConcept(history);
        reply(res, 200, { ok: true, ...result });
      } catch (e) {
        console.error('[mammuang] chat error:', e.message);
        reply(res, 200, { ok: false, error: e.message.substring(0, 300) });
      }
    }).catch(e => reply(res, 500, { ok: false, error: e.message }));
    return;
  }

  // ── Generate image ─────────────────────────────────────────────────────────
  if (url === '/dashboard/mammuang/api/generate' && method === 'POST') {
    res._claimed = true;
    readBody(req).then(async body => {
      try {
        const { prompt_en, character = '', elements = '', speech = '', concept = '',
                neg_prompt, width, height, template = 'speech' } = body;
        if (!prompt_en) return reply(res, 400, { ok: false, error: 'ต้องมี prompt_en' });

        const id  = Date.now().toString();
        const dir = path.join(GAL_DIR, id);
        fs.mkdirSync(dir, { recursive: true });
        const outPath = path.join(dir, 'image.png');

        const refImagePath = fs.existsSync(REF_PATH) ? REF_PATH : undefined;
        console.log(`[mammuang] 🥭 generate ${id} ${width||832}×${height||1216}${refImagePath?' +ref':''}: "${prompt_en.substring(0, 60)}"`);

        await generateMammuang({ prompt_en, neg_prompt,
          refImagePath,
          width:  width  || 832,
          height: height || 1216,
          outPath,
          onProgress: msg => console.log(`  [mammuang ${id}] ${msg}`) });

        fs.writeFileSync(path.join(dir, 'meta.json'),
          JSON.stringify({ concept, character, elements, speech, prompt_en, template,
            neg_prompt: neg_prompt || '', width: width || 832, height: height || 1216,
            created: Number(id) }, null, 2));

        console.log(`[mammuang] ✅ generate เสร็จ: ${id}`);
        reply(res, 200, { ok: true, id });
      } catch (e) {
        console.error('[mammuang] generate error:', e.message);
        reply(res, 200, { ok: false, error: e.message.substring(0, 300) });
      }
    }).catch(e => reply(res, 500, { ok: false, error: e.message }));
    return;
  }

  return false;
}

module.exports = { register };
