'use strict';
/**
 * news-to-story.js — แปลงข่าว (title + body) → story prompt ภาษาไทยสำหรับ runComic
 * กระต่าย chibi เจอ/รู้สึก/ทำอะไรกับสถานการณ์จากข่าวนั้น
 */

const { ollamaChat } = require('../../../lib/ollama-chat');

async function summarizeNewsToStory(title, body) {
  const sys = [
    'คุณเป็นนักเขียนนิทานขำขำ แปลงข่าวเป็น story prompt ของกระต่าย chibi ขาวดำภาษาไทย',
    'เขียน 1-2 ประโยคสั้นๆ บอกว่ากระต่ายเจอ/รู้สึก/ทำอะไรกับเรื่องนี้ ให้เป็นมุกขำ',
    'ตอบเฉพาะ story prompt เท่านั้น ไม่มีคำนำ ไม่มีชื่อตัวละคร ใช้ภาษาพูดสบายๆ',
  ].join('\n');
  const bodySnip = (body || '').slice(0, 600);
  try {
    const raw = await ollamaChat(
      `ข่าว: ${title}${bodySnip ? '\nเนื้อหา: ' + bodySnip : ''}\nเขียน story prompt:`,
      sys
    );
    const cleaned = raw.trim().replace(/^["']+|["']+$/g, '');
    return cleaned.length > 5 ? cleaned.slice(0, 200) : title.slice(0, 100);
  } catch {
    return title.slice(0, 100);
  }
}

module.exports = { summarizeNewsToStory };
