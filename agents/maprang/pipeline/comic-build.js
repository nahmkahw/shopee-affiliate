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

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// caption band (นอกภาพ ใต้ panel) — ไม่บังหน้าตัวละคร
const BAND_PAD = 16, BAND_BG = '#0f172a';
const SPEAKER_COLORS = ['#a855f7', '#38bdf8', '#f59e0b', '#34d399', '#f472b6', '#facc15'];
function colorFor(name, map) {
  if (!map[name]) map[name] = SPEAKER_COLORS[Object.keys(map).length % SPEAKER_COLORS.length];
  return map[name];
}
function bandFont() { return Math.round(PAGE * 0.024); }
function bandLineH() { return bandFont() * 1.42; }

// wrap ที่บรรทัดแรกกว้าง firstW (หลังชื่อ) ที่เหลือกว้าง restW
function wrapText2(ctx, text, firstW, restW) {
  const lines = []; let cur = '', w = firstW;
  const toks = /\s/.test(text) ? text.split(/(\s+)/) : [...text];
  for (const tk of toks) {
    if (ctx.measureText(cur + tk).width > w && cur) { lines.push(cur.trimEnd()); cur = tk.trimStart(); w = restW; }
    else cur += tk;
  }
  if (cur.trim() || !lines.length) lines.push(cur.trimEnd());
  return lines;
}

// วาด/วัด 1 บทพูด ("ชื่อ: ข้อความ") — คืนจำนวนบรรทัด (draw=false = วัดอย่างเดียว)
function layoutLine(ctx, x, topY, innerW, d, color, draw) {
  const fs = bandFont(), lineH = bandLineH();
  const prefix = d.name ? d.name + ': ' : '';
  ctx.font = `${fs}px TahomaBold, Tahoma`;
  const prefixW = prefix ? ctx.measureText(prefix).width : 0;
  ctx.font = `${fs}px Tahoma`;
  const segs = wrapText2(ctx, d.line_th, innerW - prefixW, innerW);
  if (draw) {
    ctx.textAlign = 'left';
    for (let i = 0; i < segs.length; i++) {
      const ly = topY + i * lineH + fs;
      let lx = x;
      if (i === 0 && prefix) {
        ctx.font = `${fs}px TahomaBold, Tahoma`; ctx.fillStyle = color;
        ctx.fillText(prefix, lx, ly); lx += prefixW;
      }
      ctx.font = `${fs}px Tahoma`; ctx.fillStyle = '#e2e8f0';
      ctx.fillText(segs[i], lx, ly);
    }
  }
  return segs.length;
}

// จำนวนบรรทัดรวมของแถบ panel (ใช้หาความสูงแถบที่เท่ากันทุกช่อง)
function bandLines(ctx, dialogue, innerW) {
  return (dialogue || []).slice(0, 2).reduce((n, d) => n + layoutLine(ctx, 0, 0, innerW, d, '', false), 0);
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
  const cell    = (PAGE - 2 * PAD - GUTTER) / 2;        // ภาพสี่เหลี่ยมจัตุรัส
  const innerW  = cell - 2 * BAND_PAD;
  const titleH  = opts.title ? Math.round(PAGE * 0.06) : 0;

  // วัดความสูงแถบที่เท่ากันทุกช่อง (= ช่องที่ข้อความมากสุด)
  const measure = createCanvas(10, 10).getContext('2d');
  let maxLines = 1;
  for (const p of panels.slice(0, 4)) maxLines = Math.max(maxLines, bandLines(measure, p.dialogue, innerW) || 1);
  const bandH   = 2 * BAND_PAD + maxLines * bandLineH();
  const rowH    = cell + 6 + bandH;                     // ภาพ + gap + แถบ
  const pageH   = 2 * PAD + titleH + 2 * rowH + GUTTER;

  const canvas = createCanvas(PAGE, pageH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, PAGE, pageH);

  if (opts.title) {
    ctx.font = `${Math.round(titleH * 0.6)}px TahomaBold, Tahoma`;
    ctx.fillStyle = '#f1f5f9'; ctx.textAlign = 'center';
    ctx.fillText(opts.title, PAGE / 2, titleH * 0.72);
  }

  const colorMap = {};
  const cols = [PAD, PAD + cell + GUTTER];
  const rows = [PAD + titleH, PAD + titleH + rowH + GUTTER];
  for (let i = 0; i < Math.min(4, panels.length); i++) {
    const cx = cols[i % 2], cy = rows[Math.floor(i / 2)];
    await drawPanel(ctx, imagePaths[i], cx, cy, cell);
    // caption band ใต้ภาพ (นอกรูป → ไม่บังหน้า)
    const by = cy + cell + 6;
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2; ctx.fillStyle = BAND_BG;
    roundRect(ctx, cx, by, cell, bandH, 8); ctx.fill(); ctx.stroke();
    let ty = by + BAND_PAD;
    for (const d of (panels[i].dialogue || []).slice(0, 2)) {
      const n = layoutLine(ctx, cx + BAND_PAD, ty, innerW, d, colorFor(d.name || '?', colorMap), true);
      ty += n * bandLineH();
    }
  }

  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  return outPath;
}

module.exports = { buildComicPage };
