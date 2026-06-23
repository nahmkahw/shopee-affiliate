'use strict';

const { fixMixedThaiEng } = require('./thai-text');

function hasGarbledChars(text) {
  if (/[เแโใไ][็่้๊๋ัิีึืุู]/.test(text)) return true;
  if (/[็่้๊๋]{2,}/.test(text)) return true;
  if (/[一-鿿぀-ヿ가-힯]/.test(text)) return true;
  return false;
}

function contentLength(text) {
  return text
    .replace(/#\S+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, '')
    .length;
}

function extractAnchors(text) {
  const latin = (text.match(/[A-Za-z][A-Za-z.\-]{1,}/g) || []).map(s => s.toLowerCase());
  const nums  = (text.match(/\d{2,}/g) || []);
  return new Set([...latin, ...nums].filter(Boolean));
}

function validateContent(content, platform, data, master = '') {
  const errors = [];

  if (hasGarbledChars(content)) errors.push('ตัวอักษรเสีย/encoding เพี้ยน');
  if (content.trim().length < 50) errors.push(`content สั้นเกินไป (${content.trim().length} chars)`);
  if (/^(---|#[^\s]|https?:\/\/)/.test(content.trim())) errors.push('เริ่มต้นผิดปกติ (---, hashtag, หรือ URL)');

  const len = contentLength(content);
  if (platform === 'fb') {
    if (len < 350)  errors.push(`Facebook สั้นเกิน (${len} ตัวอักษร, ต้องการ 350-3500)`);
    if (len > 3500) errors.push(`Facebook ยาวเกิน (${len} ตัวอักษร)`);
  } else if (platform === 'ig') {
    const htCount = (content.match(/#\S+/g) || []).length;
    if (len < 200)    errors.push(`Instagram สั้นเกิน (${len} ตัวอักษร, ต้องการ 200+)`);
    if (htCount < 10) errors.push(`hashtag น้อยเกิน (${htCount} อัน, ต้องการ 15-20)`);
  } else if (platform === 'x') {
    if (!content.includes('---')) errors.push('X thread ไม่มีตัวคั่น (---)');
  }

  const anchors = new Set([
    ...extractAnchors(master || ''),
    ...extractAnchors(data.title || ''),
  ]);
  if (anchors.size > 0) {
    const lc = content.toLowerCase();
    if (![...anchors].some(a => lc.includes(a))) {
      errors.push('ไม่พบ entity/ตัวเลขจากข่าวต้นฉบับในเนื้อหา');
    }
  }

  return errors;
}


function cleanOutput(text) {
  return fixMixedThaiEng(
    text
      .split('\n')
      .filter(line => {
        const cjk = (line.match(/[一-鿿぀-ヿ가-힯]/g) || []).length;
        return cjk <= 2;
      })
      .join('\n')
      .replace(/^\[[^\]]+\]\s*/gm, '')
      .replace(/^\*{0,2}[\w฀-๿]+\*{0,2}:\s*/gm, '')
      .replace(/^-{3,}\s*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

module.exports = { hasGarbledChars, contentLength, extractAnchors, validateContent, fixMixedThaiEng, cleanOutput };
