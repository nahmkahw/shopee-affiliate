'use strict';
/**
 * bubble-gen.js — AI-powered bubble text summarizer สำหรับ anime single image
 * ใช้ Typhoon2 (Ollama) สรุป/rephrase ข้อความ → bubble text + type + corner ที่เหมาะสม
 */

const { ollamaChat }            = require('../../lib/ollama-chat');
const { parseJsonArrayLenient } = require('../../lib/llm-json');

const MAX_CHARS = parseInt(process.env.ANIME_BUBBLE_MAXCHARS || '60', 10);
const VALID_TYPES   = ['speech', 'thought', 'shout', 'whisper'];
const VALID_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const SYSTEM_PROMPT = `คุณเขียน bubble text สำหรับตัวละครอนิเมะในรูปภาพเดียว
ตอบ JSON array 1 item เท่านั้น ไม่มี markdown:
[{"text_th":"ข้อความภาษาไทยกระชับ","type":"speech","corner":"bottom-right"}]
type: "speech"|"thought"|"shout"|"whisper"
corner: "top-left"|"top-right"|"bottom-left"|"bottom-right"

กฎ:
- text_th = ภาษาไทยล้วน ≤${MAX_CHARS} ตัวอักษร เป็นธรรมชาติ เหมือนบทพูด/ความคิดของตัวละคร
- ถ้า input สั้น → rephrase ให้เป็นธรรมชาติ น่ารัก หรือ punchy ขึ้น
- ถ้า input ยาว/เป็นข่าว → สรุปเป็น 1 ประโยคสั้น reaction ของตัวละครต่อเหตุการณ์นั้น
- เลือก type: speech=พูดออกเสียง, thought=คิดในใจ, shout=ตะโกน/ตกใจ/เน้นย้ำ, whisper=กระซิบ/ลึกลับ
- เลือก corner: หน้าตัวละครมักอยู่ upper-center → ใช้ bottom-right หรือ bottom-left เพื่อไม่บังหน้า`;

function normBubble(text) {
  return (text || '').replace(/^["'""«»\s]+|["'""«»\s]+$/g, '').trim().slice(0, MAX_CHARS);
}

function isValidBubble(text, type) {
  if (!text || text.length < 2) return false;
  if (!VALID_TYPES.includes(type)) return false;
  const thaiCount = (text.match(/[฀-๿]/g) || []).length;
  if (text.length > 4 && thaiCount < 3) return false;
  if (/[຀-໿]/.test(text)) return false;
  if (text.split(/\s+/).filter(Boolean).length > 20) return false;
  return true;
}

/**
 * สรุป/rephrase raw text เป็น bubble text + type + corner เหมาะกับรูปอนิเมะ
 * @returns {Promise<{text: string, type: string, corner: string}>}
 */
async function summarizeBubble(rawText) {
  const input = (rawText || '').trim().slice(0, 500);
  const prompt = input.length > 80
    ? `สรุปเนื้อหาต่อไปนี้เป็น bubble text ภาษาไทย 1 ประโยคสั้นๆ ตอบ JSON array เท่านั้น:\n${input}`
    : input;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw   = await ollamaChat(prompt, SYSTEM_PROMPT);
      const items = parseJsonArrayLenient(raw);
      if (!items || !items.length) continue;
      const o      = items[0];
      const text   = normBubble(o?.text_th);
      const type   = (o?.type || 'speech').toLowerCase().trim();
      const corner = VALID_CORNERS.includes(o?.corner) ? o.corner : 'bottom-right';
      if (isValidBubble(text, type)) return { text, type, corner };
    } catch {}
  }
  return { text: normBubble(input.slice(0, MAX_CHARS)), type: 'speech', corner: 'bottom-right' };
}

module.exports = { summarizeBubble, VALID_CORNERS };
