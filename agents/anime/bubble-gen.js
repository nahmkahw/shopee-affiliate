'use strict';
/**
 * bubble-gen.js — AI-powered bubble text summarizer สำหรับ anime single image
 * ใช้ Typhoon2 (Ollama) สรุป/rephrase ข้อความจาก user → bubble text + type ที่เหมาะสม
 * pattern เดียวกับ maprao comic-gen: isValid + normBubble + retry 3 ครั้ง → fallback raw text
 */

const { ollamaChat }     = require('../../lib/ollama-chat');
const { parseJsonArrayLenient } = require('../../lib/llm-json');

const MAX_CHARS = parseInt(process.env.ANIME_BUBBLE_MAXCHARS || '60', 10);
const VALID_TYPES   = ['speech', 'thought'];
const VALID_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const SYSTEM_PROMPT = `คุณเขียน bubble text สำหรับตัวละครอนิเมะในรูปภาพเดียว
ตอบ JSON array 1 item เท่านั้น ไม่มี markdown:
[{"text_th":"ข้อความภาษาไทยกระชับ","type":"speech","corner":"top-right"}]
type: "speech"|"thought"
corner: "top-right"|"top-left"|"bottom-right"|"bottom-left"

กฎ:
- text_th = ภาษาไทยล้วน ≤${MAX_CHARS} ตัวอักษร เป็นธรรมชาติ เหมือนบทพูด/ความคิดของตัวละคร
- ถ้า input สั้น → rephrase ให้เป็นธรรมชาติ น่ารัก หรือ punchy ขึ้น
- ถ้า input ยาว/เป็นข่าว → สรุปเป็น 1 ประโยคสั้น reaction ของตัวละครต่อเหตุการณ์นั้น
- type: speech=พูดออกเสียง, thought=คิดในใจ/ความรู้สึก
- corner: เลือกมุมที่เหมาะกับบทพูด — top-right เป็น default สำหรับ speech, bottom-left สำหรับ thought`;

function normBubble(text) {
  return (text || '').replace(/^["'""«»\s]+|["'""«»\s]+$/g, '').trim().slice(0, MAX_CHARS);
}

function isValidBubble(text, type, corner) {
  if (!text || text.length < 2) return false;
  if (!VALID_TYPES.includes(type)) return false;
  if (!VALID_CORNERS.includes(corner)) return false;
  const thaiCount = (text.match(/[฀-๿]/g) || []).length;
  if (text.length > 4 && thaiCount < 3) return false;
  if (/[຀-໿]/.test(text)) return false;
  if (text.split(/\s+/).filter(Boolean).length > 20) return false;
  return true;
}

/**
 * สรุป/rephrase raw text เป็น bubble text + type เหมาะกับรูปอนิเมะ
 * @param {string} rawText  ข้อความดิบจาก user (สั้นหรือยาว)
 * @returns {Promise<{text: string, type: string}>}
 */
async function summarizeBubble(rawText) {
  const input = (rawText || '').trim().slice(0, 500);
  // input ยาว/ภาษาอังกฤษ → wrap ด้วย instruction ภาษาไทยก่อน กัน Typhoon2 ตอบ prose แทน JSON
  const prompt = input.length > 80
    ? `สรุปเนื้อหาต่อไปนี้เป็น bubble text ภาษาไทย 1 ประโยคสั้นๆ ตอบ JSON array เท่านั้น:\n${input}`
    : input;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw  = await ollamaChat(prompt, SYSTEM_PROMPT);
      const items = parseJsonArrayLenient(raw);
      if (!items || !items.length) continue;
      const o    = items[0];
      const text   = normBubble(o?.text_th);
      const type   = (o?.type   || 'speech').toLowerCase().trim();
      const corner = (o?.corner || 'top-right').toLowerCase().trim();
      if (isValidBubble(text, type, corner)) return { text, type, corner };
    } catch {}
  }
  return { text: normBubble(input.slice(0, MAX_CHARS)), type: 'speech', corner: 'top-right' };
}

module.exports = { summarizeBubble };
