'use strict';
/**
 * bubble-gen.js — AI-powered bubble + footer text generator สำหรับ anime single image
 * ใช้ Typhoon2 (Ollama) สรุป/rephrase ข้อความ → bubble text + type + corner + footer caption
 */

const { ollamaChat }            = require('../../lib/ollama-chat');
const { parseJsonArrayLenient } = require('../../lib/llm-json');

const MAX_CHARS    = parseInt(process.env.ANIME_BUBBLE_MAXCHARS  || '60',  10);
const FOOTER_MAX   = parseInt(process.env.ANIME_FOOTER_MAXCHARS  || '200', 10);
const VALID_TYPES   = ['speech', 'thought', 'shout', 'whisper'];
const VALID_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const SYSTEM_PROMPT = `คุณเขียน bubble text และ footer caption สำหรับรูปอนิเมะ
ตอบ JSON array 1 item เท่านั้น ไม่มี markdown:
[{"text_th":"ข้อความกระชับ","type":"speech","corner":"bottom-right","footer":"สรุปยาวกว่า"}]

type: "speech"|"thought"|"shout"|"whisper"
corner: "top-left"|"top-right"|"bottom-left"|"bottom-right"

กฎ:
- รับ input ภาษาอะไรก็ได้ (ไทย/อังกฤษ/อื่น) แต่ text_th และ footer ต้องเป็น**ภาษาไทยเสมอ**
- text_th = ภาษาไทยกระชับ ≤${MAX_CHARS} ตัวอักษร เหมือนบทพูด/ความคิดของตัวละครต่อเหตุการณ์
- footer = ภาษาไทย สรุปเนื้อหาหรือบริบทสำคัญ 1-3 ประโยค ≤${FOOTER_MAX} ตัวอักษร (ยาวกว่า text_th ได้)
- ถ้า input สั้น → text_th rephrase ให้น่ารัก/punchy; footer ขยายบริบทเล็กน้อย
- ถ้า input ยาว/เป็นข่าว → text_th = reaction 1 ประโยค; footer = สรุปใจความสำคัญ
- เลือก type: speech=พูดออกเสียง, thought=คิดในใจ, shout=ตะโกน/ตกใจ, whisper=กระซิบ
- เลือก corner: หน้าตัวละครมักอยู่ upper-center → ใช้ bottom-right หรือ bottom-left เพื่อไม่บังหน้า`;

function normBubble(text) {
  return (text || '').replace(/^["'""«»\s]+|["'""«»\s]+$/g, '').trim().slice(0, MAX_CHARS);
}

function normFooter(text) {
  return (text || '').replace(/^["'""«»\s]+|["'""«»\s]+$/g, '').trim().slice(0, FOOTER_MAX);
}

function isValidBubble(text, type) {
  if (!text || text.length < 2) return false;
  if (!VALID_TYPES.includes(type)) return false;
  if (/[຀-໿]/.test(text)) return false;
  if (text.split(/\s+/).filter(Boolean).length > 20) return false;
  return true;
}

/**
 * สรุป/rephrase raw text เป็น bubble + footer สำหรับรูปอนิเมะ
 * @returns {Promise<{text: string, type: string, corner: string, footer: string}>}
 */
async function summarizeBubble(rawText) {
  const input = (rawText || '').trim().slice(0, 800);
  const prompt = input.length > 80
    ? `สรุปเนื้อหาต่อไปนี้เป็น bubble text และ footer caption ภาษาไทย ตอบ JSON array เท่านั้น:\n${input}`
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
      const footer = normFooter(o?.footer);
      if (isValidBubble(text, type)) return { text, type, corner, footer };
    } catch {}
  }
  return { text: normBubble(input.slice(0, MAX_CHARS)), type: 'speech', corner: 'bottom-right', footer: '' };
}

module.exports = { summarizeBubble, VALID_CORNERS };
