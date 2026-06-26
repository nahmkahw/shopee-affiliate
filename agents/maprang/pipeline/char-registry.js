'use strict';
/**
 * char-registry.js — Character Registry สำหรับ Agent มะปราง
 * เก็บตัวละครประจำซีรีส์ที่ใช้ข้าม story ได้
 * Storage: agents/maprang/characters.json
 */

const fs   = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(__dirname, '..', 'characters.json');

function load() {
  if (!fs.existsSync(REGISTRY_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')); } catch { return {}; }
}

function save(chars) {
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(chars, null, 2));
}

function upsert(char) {
  if (!char.id) throw new Error('char.id required');
  const chars = load();
  chars[char.id] = { ...chars[char.id], ...char, updated_at: new Date().toISOString() };
  save(chars);
  return chars[char.id];
}

function remove(id) {
  const chars = load();
  delete chars[id];
  save(chars);
}

/**
 * สร้าง combined prompt สำหรับ scene ที่มีหลายตัวละคร
 * คืน string ที่ inject เข้า visual_prompt_en ของ scene นั้น
 */
function buildSceneCharPrompt(charIds, chars) {
  if (!charIds || !charIds.length) return '';
  const descs = charIds.map(id => chars[id]?.description).filter(Boolean);
  if (!descs.length) return '';
  if (descs.length === 1) return descs[0];
  // หลายตัว: แยกด้วย "; also " เพื่อให้ model รู้ว่าเป็นคนละตัว
  return descs.join('; also ');
}

/**
 * สร้าง character-specific negative จากทุกตัวละครใน scene
 */
// เพศของตัวละคร: structured field (gender) มาก่อน → fallback parse จาก description
function charGender(c) {
  const g = (c.gender || '').toLowerCase();
  if (g === 'male' || g === 'female') return g;
  const d = (c.description || '').toLowerCase();
  if (/\b(girl|woman|female|lady|she|her|princess|queen)\b/.test(d)) return 'female';
  if (/\b(boy|man|male|he|his|prince|king)\b/.test(d)) return 'male';
  return null;
}

function buildSceneCharNeg(charIds, chars) {
  const negParts = [];
  let hasMale = false, hasFemale = false;
  for (const id of (charIds || [])) {
    const c = chars[id];
    if (!c) continue;
    const hairMatch   = c.description.match(/(\w+)\s+hair/i);
    const outfitMatch = c.description.match(/(\w+)\s+(dress|shirt|jacket|uniform|outfit)/i);
    if (hairMatch)   negParts.push(`different hair color from ${c.name || id}`);
    if (outfitMatch) negParts.push(`wrong outfit for ${c.name || id}`);
    const g = charGender(c);
    if (g === 'male') hasMale = true;
    if (g === 'female') hasFemale = true;
  }
  // เพศ lock ชั้นที่ 2: ถ้าทุกตัวเพศเดียวกัน → ปฏิเสธเพศตรงข้ามใน scene (อาการ still_3 เพศหลุด)
  if (hasMale && !hasFemale) negParts.push('1girl, woman, female, feminine');
  if (hasFemale && !hasMale) negParts.push('1boy, man, male, masculine');
  return negParts.length
    ? `character inconsistency, wrong character design, ${negParts.join(', ')}`
    : 'character inconsistency, wrong character design';
}

module.exports = { load, save, upsert, remove, buildSceneCharPrompt, buildSceneCharNeg };
