'use strict';
/**
 * concept-expander.js — ส่ง concept ไปให้ Ollama Typhoon2 ขยายเป็น structured prompt
 *
 * คืน { character, elements, speech, prompt_en } หรือ throw
 */

const http  = require('http');
const https = require('https');

const OLLAMA_HOST  = process.env.OLLAMA_HOST  || 'http://10.3.17.118:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'scb10x/llama3.1-typhoon2-8b-instruct:latest';

// ใช้ format แบบแยก key ชัดเจน + ห้ามใช้ nested object
const SYSTEM_PROMPT = `คุณเป็น AI ออกแบบตัวละคร kawaii chibi สำหรับภาพ AI illustration

สไตล์ที่ต้องการ: ตัวละครเป็น anthropomorphic animal น่ารัก (กระต่าย แมว หมี หมาจิ้งจอก ฯลฯ) หรือตัวละคร chibi มนุษย์ขนาดเล็ก สีพาสเทลนุ่มนวล สไตล์ sticker illustration / mascot design

ตอบ JSON เท่านั้น ไม่มีข้อความอื่น ห้ามใช้ nested object — ทุก value ต้องเป็น string ธรรมดา:

{"character":"...","elements":"...","speech":"...","prompt_en":"..."}

- character: ประเภทสัตว์หรือ chibi, สี, ชุด, อุปกรณ์ประจำตัว (ภาษาไทย)
- elements: ฉากหลัง สิ่งของรอบข้าง แสง สีโทน บรรยากาศ (ภาษาไทย)
- speech: คำพูดสั้นๆ น่ารัก ให้กำลังใจ หรือตลก 1 ประโยค ภาษาไทย
- prompt_en: ComfyUI tags ภาษาอังกฤษ คั่นด้วย comma เริ่มด้วย style prefix ที่กำหนด

กฎ prompt_en:
1. เริ่มด้วย "masterpiece, best quality, chibi kawaii illustration, cute character design, pastel color palette, sharp lineart, highly detailed lineart, crisp clean lines, flat colors, clean art"
2. ระบุ animal type: เช่น "white bunny girl, fluffy ears, round body" หรือ "orange cat boy, tiny paws"
3. ระบุชุด: เช่น "pink frilly dress, white apron, pink bow on head"
4. ระบุ setting + props: เช่น "sitting at wooden desk, stationery, coffee mug, plants, warm lighting"
5. ห้ามใส่ "realistic, photorealistic, dark, gritty"

รูปแบบ output (แทนที่ด้วยค่าจริงตาม concept ของ user):
{"character":"[ประเภทสัตว์/chibi + สี + ชุด + อุปกรณ์ที่เกี่ยวข้องกับ concept]","elements":"[ฉาก + สิ่งของ + แสง + บรรยากาศที่เหมาะกับ concept]","speech":"[คำพูด 1 ประโยคที่เชื่อมกับ concept]","prompt_en":"[ComfyUI tags ภาษาอังกฤษที่ตรงกับ concept]"}`;

function ollamaChat(messages) {
  return new Promise((resolve, reject) => {
    const url  = new URL('/api/chat', OLLAMA_HOST);
    const mod  = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      // ไม่ใช้ format:'json' — บังคับ format ทำให้ model ส่ง nested object
      options: { temperature: 0.7, num_predict: 512 },
    });

    const req = mod.request(
      { hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      res => {
        let out = '';
        res.on('data', d => out += d);
        res.on('end', () => {
          try {
            const j = JSON.parse(out);
            resolve(j.message && j.message.content ? j.message.content : out);
          } catch { resolve(out); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** แปลง nested object → string (กรณี model ยังส่ง object มา) */
function flattenField(val) {
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val !== null) return Object.values(val).join(', ');
  return String(val || '');
}

// Flux Kontext mode: prompt ระบุเฉพาะ scene/pose/clothing/event — ไม่ระบุหน้าตาตัวละคร
const FLUX_SYSTEM_PROMPT = `คุณเป็น AI ช่วยเขียน prompt สำหรับ Flux Kontext image editing

ตัวละครหลักถูก lock ไว้แล้วจากรูปต้นแบบ — ห้ามระบุหน้าตา สีขน สีตา รูปร่าง หรือ species ของตัวละครใน prompt เด็ดขาด

ตอบ JSON เท่านั้น ไม่มีข้อความอื่น ทุก value ต้องเป็น string ธรรมดา:
{"elements":"...","speech":"...","prompt_en":"..."}

- elements: องค์ประกอบภาพ (ภาษาไทย) — เหตุการณ์, สิ่งของ, ท่าทาง, การแต่งกาย, ฉากหลัง, แสง, บรรยากาศ
- speech: คำพูดสั้นๆ น่ารัก 1 ประโยค ภาษาไทย
- prompt_en: ภาษาอังกฤษ natural language เท่านั้น ห้ามใช้ Danbooru tags หรือ comma-separated tags
  • เริ่มด้วย "the character is"
  • ระบุ: ท่าทาง/เหตุการณ์, การแต่งกาย (ถ้ามีการเปลี่ยน), สิ่งของ, ฉากหลัง, แสง, บรรยากาศ
  • ห้ามพูดถึง: หน้าตา สีขน หู ตา แก้ม รูปร่างตัวละครเด็ดขาด
  • ตัวอย่าง: "the character is sitting at a wooden desk writing in a notebook, wearing a white apron, warm desk lamp light, cozy room background with plants"`;

/**
 * @param {Array<{role,content}>} history  — รวม user message ล่าสุดแล้ว
 * @param {object} [opts]
 * @param {boolean} [opts.fluxMode]  — true → ใช้ FLUX_SYSTEM_PROMPT (scene-only, no character desc)
 * @returns {{ character?, elements, speech, prompt_en }}
 */
async function expandConcept(history, opts = {}) {
  const systemPrompt = opts.fluxMode ? FLUX_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const messages = [{ role: 'system', content: systemPrompt }, ...history];

  const raw = await ollamaChat(messages);

  const jsonMatch = raw.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) throw new Error('AI ไม่ตอบ JSON: ' + raw.substring(0, 300));

  let result;
  try { result = JSON.parse(jsonMatch[0]); }
  catch { throw new Error('JSON parse ล้มเหลว: ' + jsonMatch[0].substring(0, 300)); }

  const elements  = flattenField(result.elements);
  const speech    = flattenField(result.speech);
  let   prompt_en = flattenField(result.prompt_en);

  if (opts.fluxMode) {
    if (!prompt_en || prompt_en.length < 10) prompt_en = `the character is ${elements.substring(0, 200)}`;
    return { elements, speech, prompt_en };
  }

  const character = flattenField(result.character);
  if (!prompt_en || prompt_en.length < 10) {
    prompt_en = `masterpiece, best quality, anime style, highly detailed, ${character.substring(0, 120)}`;
  }
  return { character, elements, speech, prompt_en };
}

module.exports = { expandConcept };
