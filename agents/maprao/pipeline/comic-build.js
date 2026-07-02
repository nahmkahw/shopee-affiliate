'use strict';
/**
 * comic-build.js — ประกอบ 4 Panel stills → หน้าการ์ตูน grid 2×2 ขาวดำ
 * + Bubble คำพูด/ความคิดในช่อง (fixed corner, ADR-002) + Footer Caption ปิดเรื่อง
 * ใช้ @napi-rs/canvas (ไม่พึ่ง ffmpeg) — output รูปนิ่ง .png
 */

const fs = require('fs');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const PAGE   = parseInt(process.env.MAPRAO_COMIC_SIZE || '1080', 10);
const GUTTER = 18, PAD = 18, BORDER = 5;
const FONT_PATH = process.env.THAI_FONT || 'C:/Windows/Fonts/tahoma.ttf';
const FONT_BOLD = 'C:/Windows/Fonts/tahomabd.ttf';

let _fontReady = false;
function registerFont() {
  if (_fontReady) return;
  try { GlobalFonts.registerFromPath(FONT_PATH, 'Tahoma'); } catch {}
  try { if (fs.existsSync(FONT_BOLD)) GlobalFonts.registerFromPath(FONT_BOLD, 'TahomaBold'); } catch {}
  _fontReady = true;
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

function wrapText(ctx, text, maxW) {
  const lines = []; let cur = '';
  const toks = /\s/.test(text) ? text.split(/(\s+)/) : [...text];
  for (const tk of toks) {
    if (ctx.measureText(cur + tk).width > maxW && cur) { lines.push(cur.trimEnd()); cur = tk.trimStart(); }
    else cur += tk;
  }
  if (cur.trim() || !lines.length) lines.push(cur.trimEnd());
  return lines.slice(0, 2); // ≤2 บรรทัด/บอลลูน
}

// วาด panel image ลง cell แบบ cover + กรอบ + เลขช่อง
async function drawPanel(ctx, imgPath, cx, cy, cell, panelNum) {
  ctx.save();
  roundRect(ctx, cx, cy, cell, cell, 8); ctx.clip();
  try {
    const img = await loadImage(imgPath);
    const s = Math.max(cell / img.width, cell / img.height);
    const w = img.width * s, h = img.height * s;
    ctx.drawImage(img, cx + (cell - w) / 2, cy + (cell - h) / 2, w, h);
  } catch {
    ctx.fillStyle = '#e5e5e5'; ctx.fillRect(cx, cy, cell, cell);
  }
  ctx.restore();
  ctx.strokeStyle = '#000'; ctx.lineWidth = BORDER;
  roundRect(ctx, cx, cy, cell, cell, 8); ctx.stroke();

  // panel number badge
  const bs = Math.round(cell * 0.06);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.rect(cx + 6, cy + 6, bs, bs); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#000'; ctx.font = `bold ${Math.round(bs * 0.65)}px Tahoma`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(panelNum), cx + 6 + bs / 2, cy + 6 + bs / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}

// มุม cell → พิกัดกรอบ bubble (เว้นระยะจากขอบ panel)
function bubbleBox(corner, cx, cy, cell, w, h) {
  const m = Math.round(cell * 0.06);
  const left = corner.includes('left') ? cx + m : cx + cell - m - w;
  const top  = corner.includes('top')  ? cy + m : cy + cell - m - h;
  return { left, top };
}

// speech bubble: rounded rect เล็ก + หางแหลมชี้เข้ากลาง panel
function drawSpeechBubble(ctx, box, w, h, corner) {
  roundRect(ctx, box.left, box.top, w, h, 14);
  ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.stroke();
  const tailX = corner.includes('left') ? box.left + w * 0.28 : box.left + w * 0.72;
  const tailY = corner.includes('top') ? box.top + h : box.top;
  const dy = corner.includes('top') ? 16 : -16;
  ctx.beginPath();
  ctx.moveTo(tailX - 10, tailY);
  ctx.lineTo(tailX + 10, tailY);
  ctx.lineTo(tailX, tailY + dy);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
}

// thought bubble: รูปทรงมนกว่า (near-oval) + วงกลมเล็กไล่ระดับชี้เข้ากลาง panel
function drawThoughtBubble(ctx, box, w, h, corner) {
  roundRect(ctx, box.left, box.top, w, h, h / 2);
  ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.stroke();
  const baseX = corner.includes('left') ? box.left + w * 0.22 : box.left + w * 0.78;
  const baseY = corner.includes('top') ? box.top + h : box.top;
  const dir = corner.includes('top') ? 1 : -1;
  const sizes = [11, 7, 4];
  sizes.forEach((r, i) => {
    ctx.beginPath();
    ctx.arc(baseX + i * dir * 4, baseY + dir * (14 + i * 14), r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();
  });
}

// วาด Bubble (speech/thought) ในมุมที่กำหนด — คืนไม่มีค่า (สั่งวาดเท่านั้น)
function drawBubble(ctx, bubble, cx, cy, cell) {
  if (!bubble) return;
  const fontSize = Math.round(cell * 0.05);
  ctx.font = `${fontSize}px Tahoma`;
  const maxW = cell * 0.5;
  const lines = wrapText(ctx, bubble.text_th, maxW);
  const textW = Math.max(...lines.map(l => ctx.measureText(l).width));
  const w = Math.min(cell * 0.62, textW + 28);
  const h = lines.length * (fontSize * 1.3) + 20;
  const box = bubbleBox(bubble.corner, cx, cy, cell, w, h);

  if (bubble.type === 'thought') drawThoughtBubble(ctx, box, w, h, bubble.corner);
  else drawSpeechBubble(ctx, box, w, h, bubble.corner);

  ctx.fillStyle = '#000'; ctx.textAlign = 'center';
  lines.forEach((l, i) => {
    ctx.fillText(l, box.left + w / 2, box.top + 10 + fontSize * 0.9 + i * fontSize * 1.3);
  });
}

/**
 * ประกอบหน้าการ์ตูน 2×2
 * @param {Array}  panels      [{scene_setting_en, bubble:{type,corner,text_th}|null}]
 * @param {string[]} imagePaths  path รูป panel ตามลำดับ
 * @param {string} outPath      .png
 * @param {object} [opts]       { footerCaption }
 * @returns {Promise<string>}
 */
async function buildComicPage(panels, imagePaths, outPath, opts = {}) {
  registerFont();
  const cell   = (PAGE - 2 * PAD - GUTTER) / 2;
  const footerH = opts.footerCaption ? Math.round(PAGE * 0.05) : 0;
  const pageH  = 2 * PAD + 2 * cell + GUTTER + footerH;

  const canvas = createCanvas(PAGE, pageH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, PAGE, pageH);

  const cols = [PAD, PAD + cell + GUTTER];
  const rows = [PAD, PAD + cell + GUTTER];
  for (let i = 0; i < Math.min(4, panels.length); i++) {
    const cx = cols[i % 2], cy = rows[Math.floor(i / 2)];
    await drawPanel(ctx, imagePaths[i], cx, cy, cell, i + 1);
    drawBubble(ctx, panels[i].bubble, cx, cy, cell);
  }

  if (opts.footerCaption) {
    ctx.font = `italic ${Math.round(footerH * 0.55)}px Tahoma`;
    ctx.fillStyle = '#000'; ctx.textAlign = 'center';
    ctx.fillText(opts.footerCaption, PAGE / 2, PAD + 2 * cell + GUTTER + footerH * 0.68);
  }

  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  return outPath;
}

module.exports = { buildComicPage };
