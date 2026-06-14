#!/usr/bin/env node
/**
 * fix-content.js — แก้ไข mixed Thai-English ในไฟล์ content ที่มีอยู่แล้ว
 * รัน: node fix-content.js
 *
 * จะแก้ไฟล์ facebook.md, instagram.md, x.md, tiktok.md ทุกข่าว
 * ไม่แตะ master.md
 */

const fs   = require('fs');
const path = require('path');

const NEWS_DIR = path.join(__dirname, 'news');

function fixMixedThaiEng(text) {
  // ประมวลผล token ต่อ token เพื่อข้าม #hashtag และ URL
  return text.replace(/(\S+)/g, token => {
    // ข้าม hashtag และ URL — ไม่แตะโครงสร้างพิเศษ
    if (token.startsWith('#') || token.startsWith('http')) return token;

    let t = token;

    // Step 1: Thai + uppercase English (3+ chars) → เพิ่ม space
    // "ประเทศSingapore" → "ประเทศ Singapore", "ที่Vatican" → "ที่ Vatican"
    t = t.replace(/([฀-๿]+)([A-Z][a-zA-Z]{2,})/g, '$1 $2');

    // NOTE: ไม่ทำ phoneme reconstruction (Step 2) เพราะไฟล์เก่าไม่มีรูปแบบ Thai-onset แล้ว
    // การทำ phoneme จะทำให้ "ขโมยfentanyl" → "ขโมyfentanyl" (ผิด)

    // Step 2: Thai ติดกับ English (2+ chars) → เพิ่ม space
    // "ขโมยfentanyl" → "ขโมย fentanyl"
    t = t.replace(/([฀-๿])([a-zA-Z]{2,})/g, '$1 $2');

    return t;
  });
}

console.log('\n🔧 fix-content.js — แก้ไข mixed Thai-English ในไฟล์ content\n');

if (!fs.existsSync(NEWS_DIR)) {
  console.log('❌ ไม่พบ news directory');
  process.exit(1);
}

let totalFiles = 0;
let totalFixed = 0;

for (const slug of fs.readdirSync(NEWS_DIR).sort()) {
  const contentDir = path.join(NEWS_DIR, slug, 'content');
  if (!fs.existsSync(contentDir)) continue;

  for (const file of fs.readdirSync(contentDir)) {
    if (!file.endsWith('.md') || file === 'master.md') continue;

    const filePath = path.join(contentDir, file);
    const original = fs.readFileSync(filePath, 'utf8');
    const fixed    = fixMixedThaiEng(original);
    totalFiles++;

    if (fixed !== original) {
      fs.writeFileSync(filePath, fixed, 'utf8');
      // แสดง diff ย่อ
      const lines = original.split('\n');
      const fixedLines = fixed.split('\n');
      const changedLines = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] !== fixedLines[i]) {
          changedLines.push(`    - ${lines[i].trim().substring(0, 90)}`);
          changedLines.push(`    + ${fixedLines[i].trim().substring(0, 90)}`);
        }
      }
      console.log(`  ✅ ${slug}/content/${file}`);
      changedLines.forEach(l => console.log(l));
      totalFixed++;
    }
  }
}

console.log(`\n✅ ตรวจสอบ ${totalFiles} ไฟล์ | แก้ไข ${totalFixed} ไฟล์`);
