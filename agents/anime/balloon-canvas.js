'use strict';
/**
 * balloon-canvas.js — server-side balloon renderer (@napi-rs/canvas)
 * renderBalloonOnImage(baseImagePath, text, tailFrac, outPath, opts?)
 *   opts.template = 'speech'|'thought'|'shout'|'whisper'  (default: 'speech')
 *   opts.rect     = {bx,by,bw,bh} normalized 0-1          (default: fixed bottom-right)
 */

const fs   = require('fs');
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

let fontReady = false;
function ensureFont() {
  if (fontReady) return;
  const candidates = [process.env.THAI_FONT, 'C:/Windows/Fonts/tahoma.ttf', 'C:/Windows/Fonts/leelawui.ttf'];
  for (const f of candidates) { try { if (f && fs.existsSync(f)) { GlobalFonts.registerFromPath(f, 'Sarabun'); break; } } catch {} }
  fontReady = true;
}

// corner → bubble origin + tail target (tail points toward face zone = upper-center)
const CORNER_GEOM = {
  'top-left':     (W, H) => ({ bx: 0.05*W, by: 0.04*H, tx: 0.55*W, ty: 0.62*H }),
  'top-right':    (W, H) => ({ bx: 0.35*W, by: 0.04*H, tx: 0.45*W, ty: 0.62*H }),
  'bottom-left':  (W, H) => ({ bx: 0.05*W, by: 0.68*H, tx: 0.55*W, ty: 0.38*H }),
  'bottom-right': (W, H) => ({ bx: 0.35*W, by: 0.68*H, tx: 0.45*W, ty: 0.38*H }),
};
const VALID_CORNERS = Object.keys(CORNER_GEOM);

function geom(W, H, tailFrac, corner) {
  const pad = 0.026 * W;
  const bw = 0.60 * W, bh = 0.26 * H;
  let bx, by, tailCx, tailCy;
  if (corner && CORNER_GEOM[corner]) {
    const c = CORNER_GEOM[corner](W, H);
    bx = c.bx; by = c.by; tailCx = c.tx; tailCy = c.ty;
  } else {
    // legacy: use tailFrac if no corner specified
    bx = 0.05 * W; by = 0.04 * H;
    tailCx = (tailFrac?.x ?? 0.46) * W; tailCy = (tailFrac?.y ?? 0.46) * H;
  }
  const fontSize = 0.038 * W;
  return {
    bx, by, bw, bh, pad,
    r: 0.035 * W, border: Math.max(2, 0.006 * W),
    fontSize, lineH: fontSize * 1.25,
    tail: { cx: tailCx, cy: tailCy },
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

function drawText(ctx, text, bx, by, bw, bh, pad, fontSize, lineH) {
  const txt = { x: bx + pad, y: by + pad, w: bw - 2 * pad, h: bh - 2 * pad };
  const lines = wrapLines(ctx, text, txt.w);
  const maxLines = Math.floor(txt.h / lineH);
  const shown = lines.slice(0, maxLines);
  let y = txt.y + Math.max(0, (txt.h - shown.length * lineH) / 2);
  ctx.fillStyle = '#111'; ctx.textAlign = 'center';
  for (const ln of shown) { ctx.fillText(ln, bx + bw / 2, y); y += lineH; }
}

function drawSpeech(ctx, bx, by, bw, bh, tail, pad, r, border, fontSize, lineH, text) {
  ctx.beginPath();
  ctx.moveTo(bx + 0.10 * bw, by + 1);
  ctx.lineTo(bx + 0.30 * bw, by + 1);
  ctx.lineTo(tail.cx, tail.cy);
  ctx.closePath();
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.lineWidth = border; ctx.strokeStyle = '#111'; ctx.stroke();

  roundRect(ctx, bx, by, bw, bh, r);
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.lineWidth = border; ctx.strokeStyle = '#111'; ctx.stroke();

  ctx.font = `700 ${fontSize}px Sarabun, Tahoma, sans-serif`;
  ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
  drawText(ctx, text, bx, by, bw, bh, pad, fontSize, lineH);
}

function drawThought(ctx, bx, by, bw, bh, tail, pad, border, fontSize, lineH, text) {
  const cx = bx + bw / 2, cy = by + bh / 2;
  const rx = bw / 2, ry = bh / 2;
  const bumps = 9, bumpR = Math.min(rx, ry) * 0.28;

  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = border;
  for (let i = 0; i < bumps; i++) {
    const a = (i / bumps) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(cx + rx * 0.78 * Math.cos(a), cy + ry * 0.78 * Math.sin(a), bumpR, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 0.72, ry * 0.72, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();

  const dots = [0.7, 0.5];
  for (const s of dots) {
    ctx.beginPath();
    ctx.arc(cx + (tail.cx - cx) * (1 - s), cy + (tail.cy - cy) * (1 - s), bumpR * s * 0.7, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }

  ctx.font = `700 ${fontSize}px Sarabun, Tahoma, sans-serif`;
  ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
  drawText(ctx, text, bx + bw * 0.14, by + bh * 0.14, bw * 0.72, bh * 0.72, pad * 0.5, fontSize, lineH);
}

function drawShout(ctx, bx, by, bw, bh, tail, pad, border, fontSize, lineH, text) {
  const cx = bx + bw / 2, cy = by + bh / 2;
  const inner = Math.min(bw, bh) * 0.38, outer = Math.min(bw, bh) * 0.55;
  const pts = 16;

  ctx.beginPath();
  for (let i = 0; i < pts * 2; i++) {
    const a = (i / (pts * 2)) * Math.PI * 2 - Math.PI / 2;
    const rx2 = (i % 2 === 0 ? outer : inner) * (bw / Math.min(bw, bh));
    const ry2 = (i % 2 === 0 ? outer : inner) * (bh / Math.min(bw, bh));
    i === 0 ? ctx.moveTo(cx + rx2 * Math.cos(a), cy + ry2 * Math.sin(a))
            : ctx.lineTo(cx + rx2 * Math.cos(a), cy + ry2 * Math.sin(a));
  }
  ctx.closePath();
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.lineWidth = border; ctx.strokeStyle = '#111'; ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(bx + 0.15 * bw, by + 1);
  ctx.lineTo(bx + 0.35 * bw, by + 1);
  ctx.lineTo(tail.cx, tail.cy);
  ctx.closePath();
  ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();

  ctx.font = `900 ${fontSize * 1.05}px Sarabun, Tahoma, sans-serif`;
  ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
  drawText(ctx, text, bx + bw * 0.1, by + bh * 0.1, bw * 0.8, bh * 0.8, pad * 0.5, fontSize, lineH);
}

function drawWhisper(ctx, bx, by, bw, bh, tail, pad, r, border, fontSize, lineH, text) {
  const tailW = 0.06 * bw;
  ctx.save();
  ctx.setLineDash([border * 2, border * 2]);
  ctx.beginPath();
  ctx.moveTo(bx + 0.12 * bw, by + 1);
  ctx.lineTo(bx + 0.12 * bw + tailW, by + 1);
  ctx.lineTo(tail.cx, tail.cy);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill();
  ctx.lineWidth = border; ctx.strokeStyle = '#666'; ctx.stroke();

  roundRect(ctx, bx, by, bw, bh, r * 1.5);
  ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill();
  ctx.lineWidth = border; ctx.strokeStyle = '#666'; ctx.stroke();
  ctx.restore();

  ctx.font = `400 ${fontSize * 0.9}px Sarabun, Tahoma, sans-serif`;
  ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
  drawText(ctx, text, bx, by, bw, bh, pad, fontSize * 0.9, lineH * 0.9);
}

function drawBalloon(ctx, W, H, text, tailFrac, opts = {}) {
  const template = opts.template || 'speech';
  let bx, by, bw, bh, tail;
  if (opts.rect) {
    bx = opts.rect.bx * W; by = opts.rect.by * H;
    bw = opts.rect.bw * W; bh = opts.rect.bh * H;
    tail = { cx: (tailFrac?.x ?? 0.46) * W, cy: (tailFrac?.y ?? 0.46) * H };
  } else {
    const g = geom(W, H, tailFrac, opts.corner);
    bx = g.bx; by = g.by; bw = g.bw; bh = g.bh; tail = g.tail;
  }
  const pad = 0.026 * W, r = 0.035 * W, border = Math.max(2, 0.006 * W);
  const fontSize = 0.038 * W * Math.min(1.2, bw / (0.56 * W));
  const lineH = fontSize * 1.25;
  ctx.lineJoin = 'round';

  if (template === 'thought') drawThought(ctx, bx, by, bw, bh, tail, pad, border, fontSize, lineH, text);
  else if (template === 'shout') drawShout(ctx, bx, by, bw, bh, tail, pad, border, fontSize, lineH, text);
  else if (template === 'whisper') drawWhisper(ctx, bx, by, bw, bh, tail, pad, r, border, fontSize, lineH, text);
  else drawSpeech(ctx, bx, by, bw, bh, tail, pad, r, border, fontSize, lineH, text);
}

function drawFooter(ctx, footerCaption, W, imgH) {
  const footerH = Math.round(W * 0.08);
  const fontSize = Math.round(footerH * 0.28);
  const lineH = fontSize * 1.4;
  const maxW = W * 0.9;

  ctx.font = `italic ${fontSize}px Sarabun, Tahoma, sans-serif`;

  // word-wrap: split on spaces for latin, char-by-char for Thai
  const words = footerCaption.replace(/\s+/g, ' ').trim();
  const lines = [];
  let cur = '';
  for (const ch of words) {
    if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur.trimEnd()); cur = ch; }
    else cur += ch;
  }
  if (cur) lines.push(cur.trimEnd());

  const textBlockH = lines.length * lineH;
  const y0 = imgH + (footerH - textBlockH) / 2 + fontSize;

  ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * lineH));
}

async function renderBalloonOnImage(baseImagePath, text, tailFrac, outPath, opts = {}) {
  ensureFont();
  const img = await loadImage(baseImagePath);
  const W = img.width, H = img.height;
  const footerH = opts.footerCaption ? Math.round(W * 0.08) : 0;
  const canvas = createCanvas(W, H + footerH);
  const ctx = canvas.getContext('2d');

  // white background (visible in footer area)
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H + footerH);
  ctx.drawImage(img, 0, 0, W, H);
  if (text && text.trim()) drawBalloon(ctx, W, H, text, tailFrac, opts);
  if (opts.footerCaption) drawFooter(ctx, opts.footerCaption, W, H);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, canvas.toBuffer('image/jpeg', 95));
  return outPath;
}

module.exports = { renderBalloonOnImage };
