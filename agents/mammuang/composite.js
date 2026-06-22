'use strict';
const fs   = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

async function compositeProductOnImage(baseImagePath, productImagePath, productRect, outPath) {
  const [base, prod] = await Promise.all([loadImage(baseImagePath), loadImage(productImagePath)]);
  const W = base.width, H = base.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(base, 0, 0, W, H);

  const bx = productRect.bxN * W, by = productRect.byN * H;
  const bw = productRect.bwN * W, bh = productRect.bhN * H;
  const border = Math.max(4, bw * 0.04);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = bw * 0.07;
  ctx.shadowOffsetX = bw * 0.025;
  ctx.shadowOffsetY = bw * 0.025;
  ctx.fillStyle = '#fff';
  ctx.fillRect(bx - border, by - border, bw + border * 2, bh + border * 2);
  ctx.restore();

  ctx.fillStyle = '#fff';
  ctx.fillRect(bx - border, by - border, bw + border * 2, bh + border * 2);
  ctx.drawImage(prod, bx, by, bw, bh);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  return outPath;
}

module.exports = { compositeProductOnImage };
