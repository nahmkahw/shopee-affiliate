'use strict';
/**
 * comic-build.js — ประกอบ 4 panel stills → หน้าการ์ตูน grid 2×2 + บอลลูนคำพูดไทย
 * ใช้ @napi-rs/canvas (ไม่พึ่ง ffmpeg) — output รูปนิ่ง .png
 */

const fs = require('fs');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const PAGE   = parseInt(process.env.MAPRANG_COMIC_SIZE || '1080', 10);
const GUTTER = 18, PAD = 18, BORDER = 5;
const FONT_PATH = process.env.THAI_FONT || 'C:/Windows/Fonts/tahoma.ttf';
const FONT_BOLD = 'C:/Windows/Fonts/tahomabd.ttf';

let _fontReady = false;
function registerFont() {
  if (_fontReady) return 'Tahoma';
  try { GlobalFonts.registerFromPath(FONT_PATH, 'Tahoma'); } catch {}
  try { if (fs.existsSync(FONT_BOLD)) GlobalFonts.registerFromPath(FONT_BOLD, 'TahomaBold'); } catch {}
  _fontReady = true;
  return 'Tahoma';
}

// ตัดบรรทัดไทย (ไม่มีช่องว่าง → wrap ทีละตัวอักษร), อังกฤษ wrap ทีละคำ
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let cur = '';
  const hasSpace = /\s/.test(text);
  const tokens = hasSpace ? text.split(/(\s+)/) : [...text];
  for (const tk of tokens) {
    const test = cur + tk;
    if (ctx.measureText(test).width > maxWidth && cur) { lines.push(cur.trimEnd()); cur = tk.trimStart(); }
    else cur = test;
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines.length ? lines : [text];
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

// บอลลูนคำพูด: กล่องโค้งขาว + ขอบดำ + หางชี้ลง + ชื่อผู้พูด
function drawBubble(ctx, cx, topY, maxW, line, speakerName) {
  const fontSize = Math.round(PAGE * 0.026);
  ctx.font = `${fontSize}px Tahoma`;
  const innerW = maxW - 36;
  const textLines = wrapText(ctx, line, innerW);
  const lineH = fontSize * 1.35;
  const nameH = speakerName ? fontSize * 1.1 : 0;
  const boxW = Math.min(maxW, Math.max(...textLines.map(l => ctx.measureText(l).width)) + 36);
  const boxH = textLines.length * lineH + nameH + 24;
  const x = cx - boxW / 2;
  const y = topY;

  // เงา
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x, y, boxW, boxH, 16); ctx.fill();
  ctx.restore();
  // ขอบ + หาง
  ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
  roundRect(ctx, x, y, boxW, boxH, 16); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath();
  ctx.moveTo(cx - 12, y + boxH - 1); ctx.lineTo(cx + 12, y + boxH - 1); ctx.lineTo(cx, y + boxH + 18);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.beginPath();
  ctx.moveTo(cx - 12, y + boxH - 1); ctx.lineTo(cx, y + boxH + 18); ctx.lineTo(cx + 12, y + boxH - 1); ctx.stroke();

  let ty = y + 14;
  if (speakerName) {
    ctx.font = `${Math.round(fontSize * 0.82)}px TahomaBold, Tahoma`;
    ctx.fillStyle = '#a855f7'; ctx.textAlign = 'center';
    ctx.fillText(speakerName, cx, ty + fontSize * 0.7); ty += nameH;
  }
  ctx.font = `${fontSize}px Tahoma`; ctx.fillStyle = '#111'; ctx.textAlign = 'center';
  for (const l of textLines) { ctx.fillText(l, cx, ty + fontSize); ty += lineH; }
  return boxH + 18;
}

// วาด panel image ลง cell แบบ cover + กรอบ
async function drawPanel(ctx, imgPath, cx, cy, cell) {
  ctx.save();
  roundRect(ctx, cx, cy, cell, cell, 8); ctx.clip();
  try {
    const img = await loadImage(imgPath);
    const s = Math.max(cell / img.width, cell / img.height);
    const w = img.width * s, h = img.height * s;
    ctx.drawImage(img, cx + (cell - w) / 2, cy + (cell - h) / 2, w, h);
  } catch {
    ctx.fillStyle = '#1e293b'; ctx.fillRect(cx, cy, cell, cell);
  }
  ctx.restore();
  ctx.strokeStyle = '#111'; ctx.lineWidth = BORDER;
  roundRect(ctx, cx, cy, cell, cell, 8); ctx.stroke();
}

/**
 * ประกอบหน้าการ์ตูน 2×2
 * @param {Array}  panels      [{dialogue:[{line_th,name}]}]
 * @param {string[]} imagePaths  path รูป panel ตามลำดับ
 * @param {string} outPath      .png
 * @param {object} [opts]       { title }
 * @returns {Promise<string>}
 */
async function buildComicPage(panels, imagePaths, outPath, opts = {}) {
  registerFont();
  const titleH = opts.title ? Math.round(PAGE * 0.06) : 0;
  const canvas = createCanvas(PAGE, PAGE + titleH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, PAGE, PAGE + titleH);

  if (opts.title) {
    ctx.font = `${Math.round(titleH * 0.6)}px TahomaBold, Tahoma`;
    ctx.fillStyle = '#f1f5f9'; ctx.textAlign = 'center';
    ctx.fillText(opts.title, PAGE / 2, titleH * 0.72);
  }

  const cell = (PAGE - 2 * PAD - GUTTER) / 2;
  const cells = [
    [PAD, PAD + titleH], [PAD + cell + GUTTER, PAD + titleH],
    [PAD, PAD + cell + GUTTER + titleH], [PAD + cell + GUTTER, PAD + cell + GUTTER + titleH],
  ];

  for (let i = 0; i < Math.min(4, panels.length); i++) {
    const [cx, cy] = cells[i];
    await drawPanel(ctx, imagePaths[i], cx, cy, cell);
    // บอลลูน: stack จากบนลงล่างในช่อง
    let by = cy + 14;
    for (const d of (panels[i].dialogue || []).slice(0, 2)) {
      const consumed = drawBubble(ctx, cx + cell / 2, by, cell - 28, d.line_th, d.name);
      by += consumed + 10;
    }
  }

  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  return outPath;
}

module.exports = { buildComicPage, wrapText };
