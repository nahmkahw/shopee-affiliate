'use strict';
/**
 * balloon-canvas.js — วาด manga-style bubble บนรูปอนิเมะ (@napi-rs/canvas)
 * reuse drawBubble จาก lib/manga-bubble (shared with maprao comic grid)
 *
 * renderBalloonOnImage(baseImagePath, text, corner, outPath)
 *   corner = 'top-left'|'top-right'|'bottom-left'|'bottom-right'  (default: 'top-right')
 *   type   = 'speech'|'thought'  (default: 'speech')
 */

const fs   = require('fs');
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { drawBubble } = require('../../lib/manga-bubble');

let fontReady = false;
function ensureFont() {
  if (fontReady) return;
  const candidates = [process.env.THAI_FONT, 'C:/Windows/Fonts/tahoma.ttf', 'C:/Windows/Fonts/leelawui.ttf'];
  for (const f of candidates) { try { if (f && fs.existsSync(f)) { GlobalFonts.registerFromPath(f, 'Tahoma'); break; } } catch {} }
  fontReady = true;
}

/**
 * @param {string} baseImagePath  รูปต้นแบบ (anime.png)
 * @param {string} text           bubble text (ภาษาไทย)
 * @param {string} corner         ตำแหน่งมุม — 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
 * @param {string} outPath        path output (final.jpg)
 * @param {object} [opts]         { type: 'speech'|'thought' }
 */
async function renderBalloonOnImage(baseImagePath, text, corner, outPath, opts = {}) {
  ensureFont();
  const img = await loadImage(baseImagePath);
  const W = img.width, H = img.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);

  if (text && text.trim()) {
    const bubble = {
      text_th: text,
      type: opts.type || 'speech',
      corner: corner || 'top-right',
    };
    // ใช้ min(W,H) เป็น cell size — กัน bubble ใหญ่เกินเมื่อรูปไม่สี่เหลี่ยมจัตุรัส
    drawBubble(ctx, bubble, 0, 0, Math.min(W, H));
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, canvas.toBuffer('image/jpeg', 95));
  return outPath;
}

module.exports = { renderBalloonOnImage };
