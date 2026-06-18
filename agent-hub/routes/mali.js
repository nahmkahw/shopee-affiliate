'use strict';
/**
 * agent-hub/routes/mali.js
 * exports register(req, res, url, rawUrl, method, deps)
 */

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { buildShopeeHTML } = require('../html/mali');

let ROOT = '';

function loadProducts() {
  const baseDir = path.join(ROOT, 'products');
  if (!fs.existsSync(baseDir)) return [];
  return fs.readdirSync(baseDir)
    .filter(id => fs.existsSync(path.join(baseDir, id, 'data.json')))
    .map(id => {
      try {
        const data   = JSON.parse(fs.readFileSync(path.join(baseDir, id, 'data.json'), 'utf8'));
        const cDir   = path.join(baseDir, id, 'content');
        const imgDir = path.join(baseDir, id, 'images');
        const hasFB  = fs.existsSync(path.join(cDir, 'facebook.md'));
        const hasIG  = fs.existsSync(path.join(cDir, 'instagram.md'));
        const hasX   = fs.existsSync(path.join(cDir, 'x.md'));
        const hasTT  = fs.existsSync(path.join(cDir, 'tiktok.md'));
        const imgFile  = ['1.jpg','2.jpg','3.jpg'].map(f => path.join(imgDir, f)).find(f => fs.existsSync(f));
        const videoFile = path.join(baseDir, id, 'video.mp4');
        const hasVideo  = fs.existsSync(videoFile);
        const videoSizeKB = hasVideo ? Math.round(fs.statSync(videoFile).size / 1024) : 0;
        const isPosted = data.status === 'posted';
        const postedPlatforms = Array.isArray(data.posted_platforms) ? data.posted_platforms : [];
        let postedAtStr = '';
        if (data.posted_at) {
          try { postedAtStr = new Date(data.posted_at).toLocaleString('th-TH', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); } catch {}
        }
        return {
          id,
          post_date: data.post_date || '',
          title: data.title || '',
          price: data.price || '',
          original_price: data.original_price || '',
          discount: data.discount || '',
          rating: data.rating || '',
          shop_name: data.shop_name || '',
          affiliate_link: data.affiliate_short_link || '',
          status: data.status || '',
          isPosted, postedPlatforms, postedAtStr,
          hasFB, hasIG, hasX, hasTT,
          hasAllContent: hasFB && hasIG && hasX && hasTT,
          hasImg: !!imgFile,
          imgPath: imgFile ? `/img/${id}/${path.basename(imgFile)}` : null,
          hasVideo, videoSizeKB,
        };
      } catch { return null; }
    })
    .filter(p => p && p.status !== 'placeholder')
    .sort((a, b) => a.post_date.localeCompare(b.post_date));
}

function readShopeeEnv() {
  try {
    const lines = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n');
    const env = {};
    for (const line of lines) {
      const m = line.match(/^\s*([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return env;
  } catch { return {}; }
}

// อัปโหลดวิดีโอ → Facebook Reels (3 ขั้นตอน: start → upload → finish)
async function uploadFBReels(itemId) {
  const https = require('https');
  const env = readShopeeEnv();
  const FB_PAGE_ID      = env.FB_PAGE_ID;
  const USER_TOKEN      = env.FB_ACCESS_TOKEN;
  if (!FB_PAGE_ID || !USER_TOKEN)
    throw new Error('ขาด FB_PAGE_ID หรือ FB_ACCESS_TOKEN ใน .env');

  // Reels API ต้องการ Page Access Token (ไม่ใช่ User Token)
  const pageTokenRes = await new Promise((resolve, reject) => {
    const qs = `fields=access_token&access_token=${encodeURIComponent(USER_TOKEN)}`;
    https.get({ hostname: 'graph.facebook.com', path: `/v19.0/${FB_PAGE_ID}?${qs}` }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error('Page token parse error')); } });
    }).on('error', reject);
  });
  if (pageTokenRes.error) throw new Error(`ดึง Page Token ไม่สำเร็จ: ${pageTokenRes.error.message}`);
  const FB_ACCESS_TOKEN = pageTokenRes.access_token || USER_TOKEN;

  const videoPath = path.join(ROOT, 'products', itemId, 'video.mp4');
  if (!fs.existsSync(videoPath))
    throw new Error(`ไม่พบ products/${itemId}/video.mp4 — สร้างวิดีโอก่อน`);

  const fbContentPath = path.join(ROOT, 'products', itemId, 'content', 'facebook.md');
  const description   = fs.existsSync(fbContentPath)
    ? fs.readFileSync(fbContentPath, 'utf8').trim().substring(0, 2200)
    : '';

  const videoData = fs.readFileSync(videoPath);
  const fileSize  = videoData.length;
  const sizeKB    = Math.round(fileSize / 1024);

  // helper: POST JSON to graph.facebook.com
  function graphPost(apiPath, bodyObj) {
    return new Promise((resolve, reject) => {
      const bodyStr = JSON.stringify(bodyObj);
      const req = https.request({
        hostname: 'graph.facebook.com',
        path: apiPath,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
      }, res => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error('Parse error: ' + buf.substring(0, 200))); } });
      });
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('graph.facebook.com timeout')); });
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });
  }

  // ── Step 1: Initialize Reel upload ─────────────────────────────────────────
  console.log(`[Hub] 🎬 Reels Step 1/3: initialize (${sizeKB}KB)`);
  const step1 = await graphPost(`/v19.0/${FB_PAGE_ID}/video_reels`, {
    upload_phase:    'start',
    video_file_size: fileSize,
    access_token:    FB_ACCESS_TOKEN,
  });
  if (step1.error) throw new Error(`Reels init: ${step1.error.message}`);
  const { video_id, upload_url } = step1;
  if (!video_id || !upload_url)
    throw new Error(`Reels init: ไม่ได้รับ video_id/upload_url — ${JSON.stringify(step1)}`);

  // ── Step 2: Upload video binary ────────────────────────────────────────────
  console.log(`[Hub] 🎬 Reels Step 2/3: uploading video binary...`);
  const uploadUrlObj = new URL(upload_url);
  await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: uploadUrlObj.hostname,
      path:     uploadUrlObj.pathname + uploadUrlObj.search,
      method:   'POST',
      headers: {
        'Authorization': `OAuth ${FB_ACCESS_TOKEN}`,
        'offset':        '0',
        'file_size':     String(fileSize),
        'Content-Type':  'application/octet-stream',
        'Content-Length': fileSize,
      },
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          if (j.success) resolve(j);
          else reject(new Error('Video upload failed: ' + JSON.stringify(j).substring(0, 200)));
        } catch { reject(new Error('Upload response error: ' + buf.substring(0, 200))); }
      });
    });
    req.setTimeout(10 * 60 * 1000, () => { req.destroy(); reject(new Error('Video upload timeout (10 min)')); });
    req.on('error', reject);
    req.write(videoData);
    req.end();
  });

  // ── Step 3: Publish Reel ───────────────────────────────────────────────────
  console.log(`[Hub] 🎬 Reels Step 3/3: publishing...`);
  const step3 = await graphPost(`/v19.0/${FB_PAGE_ID}/video_reels`, {
    upload_phase: 'finish',
    video_id,
    video_state:  'PUBLISHED',
    description,
    access_token: FB_ACCESS_TOKEN,
  });
  if (step3.error) throw new Error(`Reels publish: ${step3.error.message}`);
  if (!step3.success) throw new Error(`Reels publish ไม่สำเร็จ: ${JSON.stringify(step3)}`);

  return { id: video_id, sizeKB };
}

function serveProductImage(res, itemId, filename) {
  const filePath = path.join(ROOT, 'products', itemId, 'images', filename);
  if (!fs.existsSync(filePath)) { res.writeHead(404); res.end(); return; }
  const ext  = path.extname(filename).toLowerCase();
  const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  res.writeHead(200, { 'Content-Type': mime[ext] || 'image/jpeg' });
  fs.createReadStream(filePath).pipe(res);
}

function register(req, res, url, rawUrl, method, deps) {
  ROOT = deps.ROOT;

    // ── Product images (Shopee dashboard) ──────────────────────────────────────
    const imgMatch = url.match(/^\/img\/(\d+)\/(.+)$/);
    if (imgMatch) { serveProductImage(res, imgMatch[1], imgMatch[2]); return; }
  
    // ── Dashboard: มะลิ (Shopee) ────────────────────────────────────────────────
    if (url === '/dashboard/mali') {
      const products = loadProducts();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildShopeeHTML(products));
      return;
    }
  
    // ── Dashboard API: มะลิ products JSON ──────────────────────────────────────
    if (url === '/dashboard/mali/api/products') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(loadProducts(), null, 2));
      return;
    }
  
    // ── Dashboard API: มะลิ GET /api/content ───────────────────────────────────
    if (url.startsWith('/dashboard/mali/api/content') && method === 'GET') {
      const params   = new URLSearchParams(rawUrl.split('?')[1] || '');
      const itemId   = params.get('id');
      const platform = params.get('platform');
      const pfMap    = { fb: 'facebook', ig: 'instagram', tiktok: 'tiktok' };
      if (!itemId || !pfMap[platform]) { res.writeHead(400); return res.end('Missing id or invalid platform'); }
      const filePath = path.join(ROOT, 'products', itemId, 'content', pfMap[platform] + '.md');
      if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(fs.readFileSync(filePath, 'utf8'));
    }
  
    // ── Dashboard API: มะลิ POST /api/generate-force ──────────────────────────
    // สร้าง content (FB+IG+TikTok) ใหม่ทับของเดิม ด้วย generate-content.js --force
    if (url === '/dashboard/mali/api/generate-force' && method === 'POST') {
      let body = '';
      res._claimed = true;
      req.on('data', d => body += d);
      req.on('end', async () => {
        const { id } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        if (!id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Missing id' }));
        }
        const dataPath = path.join(ROOT, 'products', id, 'data.json');
        if (!fs.existsSync(dataPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: `ไม่พบ products/${id}/data.json` }));
        }
        try {
          const { execFileSync } = require('child_process');
          console.log(`[Hub] 🔄 Mali generate-force: ${id}`);
          const out = execFileSync(process.execPath,
            [path.join(ROOT, 'generate-content.js'), id, '--force'],
            { cwd: ROOT, encoding: 'utf8', timeout: 8 * 60 * 1000 }  // 8 นาที (Ollama × 3)
          );
          console.log(`[Hub] ✅ Mali generate-force complete: ${id}`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, log: out.substring(0, 1500) }));
        } catch (e) {
          const errMsg = (e.stdout || e.stderr || e.message || '').substring(0, 500);
          console.log(`[Hub] ❌ Mali generate-force failed: ${errMsg.substring(0, 80)}`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: errMsg }));
        }
      });
      return;
    }
  
    // ── Dashboard API: มะลิ POST /api/create-video ────────────────────────────
    // สร้างวิดีโอ TikTok: รูปสินค้า → ComfyUI img2img → FFmpeg → video.mp4
    if (url === '/dashboard/mali/api/create-video' && method === 'POST') {
      let body = '';
      res._claimed = true;
      req.on('data', d => body += d);
      req.on('end', async () => {
        const { id } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        if (!id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Missing id' }));
        }
        const dataPath = path.join(ROOT, 'products', id, 'data.json');
        const ttPath   = path.join(ROOT, 'products', id, 'content', 'tiktok.md');
        if (!fs.existsSync(dataPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: `ไม่พบ products/${id}/data.json` }));
        }
        if (!fs.existsSync(ttPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: `ไม่พบ tiktok.md — รัน Generate Content ก่อน` }));
        }
        // ใช้ spawn แทน execSync เพื่อไม่ block event loop ระหว่างสร้างวิดีโอ (อาจใช้เวลา 1-3 นาที)
        console.log(`[Hub] 🎬 Mali create-video: ${id}`);
        const videoProc = spawn(
          process.execPath,
          [path.join(ROOT, 'make-tiktok-video.js'), id, '--force'],
          { cwd: ROOT }
        );
        let stdout = '', stderr = '';
        videoProc.stdout.on('data', d => { stdout += d; });
        videoProc.stderr.on('data', d => { stderr += d; });
        videoProc.on('error', err => {
          console.log(`[Hub] ❌ Mali create-video spawn error: ${err.message}`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        });
        videoProc.on('close', code => {
          const videoPath = path.join(ROOT, 'products', id, 'video.mp4');
          const hasVideo  = fs.existsSync(videoPath);
          const sizeKB    = hasVideo ? Math.round(fs.statSync(videoPath).size / 1024) : 0;
          if (code === 0) {
            console.log(`[Hub] ✅ Mali create-video complete: ${id} size=${sizeKB}KB`);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: true, hasVideo, sizeKB, log: stdout.substring(0, 2000) }));
          } else {
            const errMsg = (stdout + '\n' + stderr).trim().substring(0, 600);
            console.log(`[Hub] ❌ Mali create-video failed (exit ${code}): ${errMsg.substring(0, 80)}`);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: errMsg }));
          }
        });
      });
      return;
    }
  
    // ── Dashboard API: มะลิ POST /api/post ────────────────────────────────────
    // โพสต์ FB / IG / X โดยใช้ post.js --force (โพสต์ได้เสมอ)
    if (url === '/dashboard/mali/api/post' && method === 'POST') {
      let body = '';
      res._claimed = true;
      req.on('data', d => body += d);
      req.on('end', async () => {
        const { id, platforms } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        if (!id || !Array.isArray(platforms) || !platforms.length) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Missing id or platforms' }));
        }
        const valid = platforms.filter(p => ['fb', 'ig', 'x'].includes(p));
        if (!valid.length) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Platform ต้องเป็น fb, ig หรือ x' }));
        }
        const platStr = valid.join(',');
        try {
          const { execFileSync } = require('child_process');
          console.log(`[Hub] 📤 Mali post: ${id} --platform ${platStr}`);
          const out = execFileSync(process.execPath,
            [path.join(ROOT, 'post.js'), id, '--platform', platStr],
            { cwd: ROOT, encoding: 'utf8', timeout: 5 * 60 * 1000 }
          );
          console.log(`[Hub] ✅ Mali post complete: ${id} platform=${platStr}`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, log: out.substring(0, 2000) }));
        } catch (e) {
          const errMsg = (e.stdout || e.stderr || e.message || '').substring(0, 500);
          console.log(`[Hub] ❌ Mali post failed: ${errMsg.substring(0, 80)}`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: errMsg }));
        }
      });
      return;
    }
  
    // ── Dashboard API: มะลิ POST /api/post-fb-clip ────────────────────────────
    // โพสต์ video.mp4 ไป Facebook Page พร้อม caption จาก facebook.md
    if (url === '/dashboard/mali/api/post-fb-clip' && method === 'POST') {
      let body = '';
      res._claimed = true;
      req.on('data', d => body += d);
      req.on('end', async () => {
        const { id } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        if (!id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Missing id' }));
        }
        const videoPath = path.join(ROOT, 'products', id, 'video.mp4');
        if (!fs.existsSync(videoPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: `ไม่พบ products/${id}/video.mp4 — กด 🎬 สร้างวิดีโอก่อน` }));
        }
        try {
          console.log(`[Hub] 📘▶ Mali post-fb-reels: ${id}`);
          const result = await uploadFBReels(id);
          // อัปเดต data.json: เพิ่ม fb-clip ใน posted_platforms ถ้าสำเร็จ
          try {
            const dataPath = path.join(ROOT, 'products', id, 'data.json');
            const dataJson = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            const platforms = Array.isArray(dataJson.posted_platforms) ? dataJson.posted_platforms : [];
            if (!platforms.includes('fb-clip')) platforms.push('fb-clip');
            dataJson.posted_platforms = platforms;
            dataJson.fb_clip_video_id  = result.id;
            dataJson.fb_clip_posted_at = new Date().toISOString();
            fs.writeFileSync(dataPath, JSON.stringify(dataJson, null, 2), 'utf8');
          } catch (e) { console.log(`[Hub] ⚠️ data.json update: ${e.message}`); }
          console.log(`[Hub] ✅ Mali post-fb-reels complete: ${id} video_id=${result.id} size=${result.sizeKB}KB`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, videoId: result.id, sizeKB: result.sizeKB }));
        } catch (e) {
          console.log(`[Hub] ❌ Mali post-fb-clip failed: ${e.message}`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
  

  return false;
}

module.exports = { register, loadProducts, readShopeeEnv, uploadFBReels, serveProductImage };
