'use strict';
/**
 * llm-json.js — แยก JSON array จาก output ของ LLM (Typhoon2/Ollama) แบบทน
 * LLM มักส่ง JSON เพี้ยน (trailing comma, ตัดกลางคัน) โดยเฉพาะ schema ซับซ้อน
 */

/**
 * @param {string} raw  ข้อความดิบจาก LLM
 * @returns {Array}     parsed array (อย่างน้อย 1 element)
 */
function parseJsonArrayLenient(raw) {
  const m = (raw || '').match(/\[[\s\S]*\]/);
  if (!m) throw new Error('ไม่พบ JSON array ใน LLM output');
  let s = m[0];

  // 1. parse ตรงๆ
  try { const a = JSON.parse(s); if (Array.isArray(a) && a.length) return a; } catch {}

  // 2. ซ่อม trailing comma แล้วลองใหม่
  const repaired = s.replace(/,(\s*[}\]])/g, '$1');
  try { const a = JSON.parse(repaired); if (Array.isArray(a) && a.length) return a; } catch {}

  // 3. parse ทีละ object (รองรับ nested 1 ชั้น เช่น dialogue[]) — ข้ามตัวที่พัง
  const objs = [];
  const re = /\{(?:[^{}]|\{[^{}]*\})*\}/g;
  let mm;
  while ((mm = re.exec(repaired))) {
    try { objs.push(JSON.parse(mm[0].replace(/,(\s*[}\]])/g, '$1'))); } catch {}
  }
  if (objs.length) return objs;

  throw new Error('parse JSON array ไม่สำเร็จ');
}

module.exports = { parseJsonArrayLenient };
