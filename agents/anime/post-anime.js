/**
 * post-anime.js — โพสต์รูปอนิเมะ 1 รูป + caption ไป Facebook / Instagram
 * ใช้ credentials เดียวกับระบบเดิม (.env: FB_PAGE_ID, FB_ACCESS_TOKEN, IG_USER_ID, IG_ACCESS_TOKEN, IMGBB_API_KEY)
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

// ขนาดที่เหมาะกับแต่ละ platform (รูปต้นทางเป็นจัตุรัส → center-crop ให้พอดีถ้าไม่ใช่)
const PLATFORM_SIZE = {
  fb: 1200,   // Facebook square
  ig: 1080,   // Instagram feed square
};

/** ปรับขนาดรูปเป็นจัตุรัส size×size (center-crop ถ้าไม่จัตุรัส) → temp jpg คุณภาพสูง */
async function resizeSquare(srcPath, size) {
  const img = await loadImage(srcPath);
  const side = Math.min(img.width, img.height);     // center-crop เป็นจัตุรัส
  const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  const out = path.join(os.tmpdir(), `anime_post_${size}_${Date.now()}.jpg`);
  fs.writeFileSync(out, canvas.toBuffer('image/jpeg', 92));   // @napi-rs: quality 0–100
  return out;
}

/**
 * IG แนวตั้ง 4:5 (1080×1350) แบบ "ไม่ crop" — วางรูปเต็ม (fit) บนพื้นหลังเบลอ
 * → speech balloon และตัวละครอยู่ครบ ไม่ถูกตัด
 */
async function resizePortrait(srcPath, W = 1080, H = 1350) {
  const img = await loadImage(srcPath);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';

  // พื้นหลัง: scale to cover + เบลอ
  const cov = Math.max(W / img.width, H / img.height);
  const cw = img.width * cov, ch = img.height * cov;
  ctx.filter = 'blur(28px)';
  ctx.drawImage(img, (W - cw) / 2, (H - ch) / 2, cw, ch);
  ctx.filter = 'none';
  ctx.fillStyle = 'rgba(0,0,0,0.12)';   // ลดความสว่างพื้นหลังนิดหน่อย
  ctx.fillRect(0, 0, W, H);

  // รูปจริง: fit เต็มความกว้าง (ไม่ crop) จัดกลางแนวตั้ง
  const fw = W, fh = img.height * (W / img.width);
  ctx.drawImage(img, 0, (H - fh) / 2, fw, fh);

  const out = path.join(os.tmpdir(), `anime_post_portrait_${Date.now()}.jpg`);
  fs.writeFileSync(out, canvas.toBuffer('image/jpeg', 92));
  return out;
}

function httpsPost(hostname, urlPath, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = typeof data === 'string' ? data : JSON.stringify(data);
    const req = https.request(
      { hostname, path: urlPath, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers } },
      res => { let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(b); } }); });
    req.on('error', reject); req.write(body); req.end();
  });
}

function httpsPostBinary(hostname, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path: urlPath, method: 'POST', headers: { 'Content-Length': body.length, ...headers } },
      res => { let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(b); } }); });
    req.on('error', reject); req.write(body); req.end();
  });
}

function buildMultipart(fields, files, boundary) {
  const chunks = [];
  for (const [name, value] of Object.entries(fields))
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  for (const { name, filename, contentType, data } of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`));
    chunks.push(data); chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Facebook: โพสต์รูปเดี่ยว + caption (publish ทันที) ──────────────────────────
async function postFacebookImage(imagePath, caption) {
  const { FB_PAGE_ID, FB_ACCESS_TOKEN } = process.env;
  if (!FB_PAGE_ID || !FB_ACCESS_TOKEN) throw new Error('ขาด FB_PAGE_ID / FB_ACCESS_TOKEN ใน .env');
  if (!fs.existsSync(imagePath)) throw new Error('ไม่พบไฟล์รูป');

  const fbImg = await resizeSquare(imagePath, PLATFORM_SIZE.fb);   // ปรับขนาดให้เหมาะกับ FB
  try {
    const boundary = `----FBAnime${Date.now()}`;
    const body = buildMultipart(
      { caption: caption || '', access_token: FB_ACCESS_TOKEN },
      [{ name: 'source', filename: 'anime.jpg', contentType: 'image/jpeg', data: fs.readFileSync(fbImg) }],
      boundary
    );
    const res = await httpsPostBinary('graph.facebook.com', `/v19.0/${FB_PAGE_ID}/photos`, body,
      { 'Content-Type': `multipart/form-data; boundary=${boundary}` });
    if (res.error) throw new Error('FB: ' + res.error.message);
    return res.post_id || res.id;
  } finally { try { fs.unlinkSync(fbImg); } catch {} }
}

// ─── imgBB → public URL (จำเป็นสำหรับ IG) ───────────────────────────────────────
function uploadImgBB(imagePath) {
  return new Promise((resolve, reject) => {
    const KEY = process.env.IMGBB_API_KEY;
    if (!KEY) return reject(new Error('ขาด IMGBB_API_KEY ใน .env'));
    const b64  = fs.readFileSync(imagePath).toString('base64');
    const body = `key=${encodeURIComponent(KEY)}&image=${encodeURIComponent(b64)}`;
    const req = https.request({ hostname: 'api.imgbb.com', path: '/1/upload', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
      res => { let b = ''; res.on('data', d => b += d); res.on('end', () => {
        try { const j = JSON.parse(b); j.success ? resolve(j.data.url) : reject(new Error('imgBB: ' + JSON.stringify(j).substring(0,120))); }
        catch { reject(new Error('imgBB parse error')); } }); });
    req.on('error', reject); req.write(body); req.end();
  });
}

// ─── Instagram: โพสต์รูปเดี่ยว + caption ─────────────────────────────────────────
async function postInstagramImage(imagePath, caption) {
  const { IG_USER_ID, IG_ACCESS_TOKEN } = process.env;
  if (!IG_USER_ID || !IG_ACCESS_TOKEN) throw new Error('ขาด IG_USER_ID / IG_ACCESS_TOKEN ใน .env');
  if (!fs.existsSync(imagePath)) throw new Error('ไม่พบไฟล์รูป');

  const igImg = await resizePortrait(imagePath);   // IG แนวตั้ง 4:5 (1080×1350) ไม่ crop balloon
  try {
    const url = await uploadImgBB(igImg);
    const container = await httpsPost('graph.facebook.com', `/v19.0/${IG_USER_ID}/media`,
      { image_url: url, caption: caption || '', access_token: IG_ACCESS_TOKEN });
    if (container.error) throw new Error('IG container: ' + container.error.message);
    await sleep(2000);
    const publish = await httpsPost('graph.facebook.com', `/v19.0/${IG_USER_ID}/media_publish`,
      { creation_id: container.id, access_token: IG_ACCESS_TOKEN });
    if (publish.error) throw new Error('IG publish: ' + publish.error.message);
    return publish.id;
  } finally { try { fs.unlinkSync(igImg); } catch {} }
}

module.exports = { postFacebookImage, postInstagramImage };
