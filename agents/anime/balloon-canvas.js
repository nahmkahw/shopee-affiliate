/**
 * balloon-canvas.js — วาดลูกโป่งคำพูดฝั่ง server (@napi-rs/canvas)
 * โครงสร้าง geom/wrap/draw ตรงกับฝั่งเบราว์เซอร์ (dashboard.html) ให้ผลเหมือนกัน
 *
 * renderBalloonOnImage(baseImagePath, text, tailFrac, outPath) → outPath (jpg)
 */

const fs   = require('fs');
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

// ลงทะเบียนฟอนต์ไทย (ครั้งเดียว)
let fontReady = false;
function ensureFont() {
  if (fontReady) return;
  const candidates = [process.env.THAI_FONT, 'C:/Windows/Fonts/tahoma.ttf', 'C:/Windows/Fonts/leelawui.ttf'];
  for (const f of candidates) { try { if (f && fs.existsSync(f)) { GlobalFonts.registerFromPath(f, 'Sarabun'); break; } } catch {} }
  fontReady = true;
}

// geom เดียวกับเบราว์เซอร์: ขวาล่าง, ฟอนต์ 0.038W, หางชี้ตาม tailFrac
function geom(W, H, tailFrac) {
  const pad = 0.026 * W;
  const bw = 0.56 * W, bh = 0.30 * H;
  const bx = W - bw - 0.04 * W;
  const by = H - bh - 0.05 * H;
  const fontSize = 0.038 * W;
  return {
    bx, by, bw, bh, pad,
    r: 0.035 * W, border: Math.max(2, 0.006 * W),
    fontSize, lineH: fontSize * 1.25,
    tail: { cx: (tailFrac?.x ?? 0.46) * W, cy: (tailFrac?.y ?? 0.46) * H },
    txt: { x: bx + pad, y: by + pad, w: bw - 2 * pad, h: bh - 2 * pad },
  };
}

function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    if (para === '') { out.push(''); continue; }
    let line = '';
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; }
      else line += ch;
    }
    out.push(line);
  }
  return out;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBalloon(ctx, W, H, text, tailFrac) {
  const g = geom(W, H, tailFrac);
  ctx.font = `700 ${g.fontSize}px Sarabun, Tahoma, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';

  // หาง (ฐานบนขอบบน-ซ้าย ปลายชี้ตาม tailFrac)
  ctx.beginPath();
  ctx.moveTo(g.bx + 0.10 * g.bw, g.by + 1);
  ctx.lineTo(g.bx + 0.30 * g.bw, g.by + 1);
  ctx.lineTo(g.tail.cx, g.tail.cy);
  ctx.closePath();
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.lineWidth = g.border; ctx.strokeStyle = '#111'; ctx.stroke();

  // กล่องมน
  roundRect(ctx, g.bx, g.by, g.bw, g.bh, g.r);
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.lineWidth = g.border; ctx.strokeStyle = '#111'; ctx.stroke();

  // ข้อความ (กึ่งกลางแนวตั้ง)
  const lines = wrapLines(ctx, text, g.txt.w);
  const maxLines = Math.floor(g.txt.h / g.lineH);
  const shown = lines.slice(0, maxLines);
  let y = g.txt.y + Math.max(0, (g.txt.h - shown.length * g.lineH) / 2);
  ctx.fillStyle = '#111'; ctx.textAlign = 'center';
  for (const ln of shown) { ctx.fillText(ln, g.bx + g.bw / 2, y); y += g.lineH; }
}

async function renderBalloonOnImage(baseImagePath, text, tailFrac, outPath) {
  ensureFont();
  const img = await loadImage(baseImagePath);
  const W = img.width, H = img.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);
  if (text && text.trim()) drawBalloon(ctx, W, H, text, tailFrac);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // @napi-rs/canvas: quality เป็น 0–100 (ไม่ใช่ 0–1 เหมือน browser) — 0.95 จะปัดเป็น ~1 = พังหนัก!
  fs.writeFileSync(outPath, canvas.toBuffer('image/jpeg', 95));
  return outPath;
}

module.exports = { renderBalloonOnImage };
