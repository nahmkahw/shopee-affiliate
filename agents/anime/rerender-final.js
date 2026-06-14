/**
 * rerender-final.js — สร้าง final.jpg ใหม่จาก anime.png (PNG ต้นฉบับคมชัด)
 * สำหรับกู้รูปที่เบลอจากบั๊ก JPEG quality เก่า
 *
 * รัน: node agents/anime/rerender-final.js [--all]
 *   ไม่มี flag = เฉพาะ final.jpg ที่เล็กผิดปกติ (<60KB)
 *   --all     = ทำใหม่ทุกรูป
 */
const fs   = require('fs');
const path = require('path');
const { renderBalloonOnImage } = require('./balloon-canvas');

const GAL = path.join(__dirname, 'gallery');
const all = process.argv.includes('--all');
const THRESHOLD = 60 * 1024;   // final.jpg เล็กกว่านี้ = น่าจะเบลอจากบั๊ก

(async () => {
  if (!fs.existsSync(GAL)) { console.log('ไม่มี gallery'); return; }
  const dirs = fs.readdirSync(GAL).filter(d => fs.existsSync(path.join(GAL, d, 'anime.png')));
  let fixed = 0, skipped = 0;

  for (const id of dirs) {
    const dir   = path.join(GAL, id);
    const anime = path.join(dir, 'anime.png');
    const final = path.join(dir, 'final.jpg');
    const curKB = fs.existsSync(final) ? fs.statSync(final).size : 0;

    if (!all && curKB >= THRESHOLD) { skipped++; continue; }

    let text = '', tailFrac = { x: 0.46, y: 0.46 };
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8').replace(/^﻿/, ''));
      text = m.text || '';
      if (m.balloon && m.balloon.tailFrac) tailFrac = m.balloon.tailFrac;
    } catch {}

    try {
      await renderBalloonOnImage(anime, text, tailFrac, final);
      const newKB = Math.round(fs.statSync(final).size / 1024);
      console.log(`✓ ${id}: ${Math.round(curKB/1024)}KB → ${newKB}KB`);
      fixed++;
    } catch (e) { console.log(`✗ ${id}: ${e.message}`); }
  }
  console.log(`\nเสร็จ: แก้ ${fixed} รูป | ข้าม ${skipped} รูป`);
})();
