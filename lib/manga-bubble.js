'use strict';
/**
 * lib/manga-bubble.js — manga-style speech/thought bubble renderer (@napi-rs/canvas)
 * shared by agents/maprao (comic grid panels) and agents/anime (single image overlay)
 *
 * drawBubble(ctx, bubble, cx, cy, cell)
 *   bubble = { type:'speech'|'thought', corner:'top-left'|'top-right'|'bottom-left'|'bottom-right', text_th:'...' }
 *   cx, cy = top-left of the cell/image area; cell = width (assumed square-ish)
 */

function charSplit(ctx, token, maxW, out) {
  let seg = '';
  for (const ch of token) {
    if (ctx.measureText(seg + ch).width > maxW && seg) { out.push(seg); seg = ch; }
    else seg += ch;
  }
  return seg;
}

function wrapText(ctx, text, maxW, maxLines = 2) {
  const lines = []; let cur = '';
  for (const tk of text.split(/(\s+)/).filter(s => s !== '')) {
    if (/^\s+$/.test(tk)) { if (cur) cur += ' '; continue; }
    if (!cur) {
      cur = tk;
      if (ctx.measureText(cur).width > maxW) cur = charSplit(ctx, cur, maxW, lines);
    } else if (ctx.measureText(cur + tk).width <= maxW) {
      cur += tk;
    } else {
      lines.push(cur.trimEnd()); cur = tk;
      if (ctx.measureText(cur).width > maxW) cur = charSplit(ctx, cur, maxW, lines);
    }
  }
  if (cur.trim() || !lines.length) lines.push(cur.trimEnd());
  return lines.slice(0, maxLines);
}

function bubbleBox(corner, cx, cy, cell, w, h) {
  const m = Math.round(cell * 0.06);
  const left = corner.includes('left') ? cx + m : cx + cell - m - w;
  const top  = corner.includes('top')  ? cy + m : cy + cell - m - h;
  return { left, top };
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

/**
 * วาด bubble (speech/thought) ใน corner ที่กำหนด — auto-shrink font จนพอดี ≤2 บรรทัด
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ type:string, corner:string, text_th:string }} bubble
 * @param {number} cx   top-left x ของ cell/image area
 * @param {number} cy   top-left y ของ cell/image area
 * @param {number} cell ความกว้างของ cell (ใช้คำนวณขนาด bubble)
 */
function drawBubble(ctx, bubble, cx, cy, cell) {
  if (!bubble || !bubble.text_th) return;
  const MAX_BUBBLE_W = cell * 0.65;
  const BUBBLE_PAD   = 28;
  const MAX_FONT     = Math.round(cell * 0.055);
  const MIN_FONT     = Math.round(cell * 0.03);

  let fontSize = MAX_FONT;
  let lines;
  for (; fontSize >= MIN_FONT; fontSize--) {
    ctx.font = `${fontSize}px Tahoma`;
    const allLines = wrapText(ctx, bubble.text_th, MAX_BUBBLE_W - BUBBLE_PAD, 99);
    lines = allLines.slice(0, 2);
    if (allLines.length <= 2) break;
  }

  const textW = Math.max(...lines.map(l => ctx.measureText(l).width));
  const w = Math.min(MAX_BUBBLE_W, textW + BUBBLE_PAD);
  const h = lines.length * (fontSize * 1.35) + 20;
  const corner = bubble.corner || 'top-right';
  const box = bubbleBox(corner, cx, cy, cell, w, h);

  if (bubble.type === 'thought') drawThoughtBubble(ctx, box, w, h, corner);
  else drawSpeechBubble(ctx, box, w, h, corner);

  ctx.save();
  roundRect(ctx, box.left + 2, box.top + 2, w - 4, h - 4, 10);
  ctx.clip();
  ctx.fillStyle = '#000'; ctx.textAlign = 'center';
  lines.forEach((l, i) => {
    ctx.fillText(l, box.left + w / 2, box.top + 10 + fontSize * 0.9 + i * fontSize * 1.35);
  });
  ctx.restore();
}

const VALID_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

module.exports = { drawBubble, drawSpeechBubble, drawThoughtBubble, wrapText, charSplit, bubbleBox, VALID_CORNERS };
