'use strict';
/**
 * scene-gen.js — แตก story prompt ภาษาไทย → 5 scenes ด้วย Typhoon2
 * Output per scene: { scene_number, visual_prompt_en, subtitle_th }
 */

const http = require('http');
const fs   = require('fs');

const OLLAMA_HOST  = process.env.OLLAMA_HOST  || 'http://10.3.17.118:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'scb10x/llama3.1-typhoon2-8b-instruct:latest';

const SYSTEM_PROMPT = `คุณเป็น AI สร้างสคริปต์วิดีโอ Anime Story
รับ story prompt ภาษาไทย แล้วแตกออกเป็น 5 scenes ที่มีความต่อเนื่องของเนื้อเรื่อง
ตอบเป็น JSON array เท่านั้น ไม่มีข้อความอื่น ไม่มี markdown code block

format ที่ต้องการ:
[
  {
    "scene_number": 1,
    "visual_prompt_en": "anime style, [English description 20-40 words], cinematic lighting, detailed background",
    "subtitle_th": "[คำบรรยายกระชับ ไม่เกิน 12 คำ]",
    "narration_th": "[เสียงพากย์แบบผู้เล่านิทาน 2-3 ประโยค ภาษาไทย เชื่อมต่อจาก scene ก่อนหน้า]",
    "visual_action": "[English summary of key visual action 5-10 words, used as context for next scene]"
  },
  ...
]

กฎสำคัญ:
- visual_prompt_en ต้องเป็นภาษาอังกฤษ เริ่มด้วย "anime style,"
- subtitle_th กระชับ ไม่เกิน 12 คำ
- narration_th สไตล์นิทาน ลื่นไหล ต่อเนื่องจาก scene ก่อน (scene 1 เริ่มต้นเรื่อง)
- visual_action สั้น เพื่อใช้เป็น context ของ scene ถัดไป
- เนื้อหาต้องเป็น family-friendly
- ต้องมีครบ 5 scenes`;

function ollamaChat(prompt, systemPrompt = SYSTEM_PROMPT) {
  return new Promise((resolve, reject) => {
    const url  = new URL('/api/chat', OLLAMA_HOST);
    const body = JSON.stringify({
      model:    OLLAMA_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: prompt },
      ],
      stream: false,
    });
    const req = http.request({
      hostname: url.hostname,
      port:     url.port || 11434,
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          if (j.error) return reject(new Error('Ollama: ' + j.error));
          resolve(j.message?.content || j.response || '');
        } catch { reject(new Error('Ollama parse error: ' + buf.substring(0, 200))); }
      });
    });
    req.on('error', e => reject(new Error('Ollama connection: ' + e.message)));
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Ollama timeout (120s)')); });
    req.write(body); req.end();
  });
}

function parseScenes(raw) {
  // ลอง extract JSON array จาก response
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('ไม่พบ JSON array ใน response ของ Typhoon2');
  const scenes = JSON.parse(match[0]);
  if (!Array.isArray(scenes) || scenes.length === 0)
    throw new Error('scenes ต้องเป็น array ที่มีข้อมูล');
  return scenes.slice(0, 5).map((s, i) => ({
    scene_number:     s.scene_number     || i + 1,
    visual_prompt_en: s.visual_prompt_en || `anime style, scene ${i + 1}`,
    subtitle_th:      s.subtitle_th      || '',
    narration_th:     s.narration_th     || s.subtitle_th || '',
    visual_action:    s.visual_action    || '',
  }));
}

/**
 * @param {string} storyPromptTh  — story prompt ภาษาไทย
 * @returns {Promise<Array<{scene_number, visual_prompt_en, subtitle_th}>>}
 */
async function generateScenes(storyPromptTh) {
  console.log('🤖 Typhoon2 กำลังสร้าง scene breakdown...');
  const raw    = await ollamaChat(`สร้าง 5 scenes สำหรับ story นี้:\n\n${storyPromptTh}`);
  const scenes = parseScenes(raw);
  console.log(`✅ ได้ ${scenes.length} scenes`);
  scenes.forEach(s => console.log(`  [${s.scene_number}] ${s.subtitle_th}`));
  return scenes;
}

// Natural language format — UMT5 encoder (Wan2.1) understands full sentences better than Booru tags
// "a girl with long pink hair..." > "1girl, long pink hair,..." for T2V models
const CHAR_SYSTEM = `You are an Anime character design AI.
Given a Thai story prompt, write ONE SENTENCE in English describing the MAIN character's appearance.
Use natural language, not tags. Reply with only that one sentence. No preamble, no markdown.

Format: "a [age] [gender] with [hair color and style], [eye color] eyes, wearing [outfit], [skin tone], [1-2 notable features]"

Example output:
a 10-year-old girl with long wavy brown hair and side bangs, bright brown eyes, wearing a cobalt blue dress with a white collar and a small red ribbon, fair skin, and a curious bright expression`;

/**
 * @param {string} storyPromptTh
 * @returns {Promise<string>}  Natural language character description (for UMT5/Wan2.1)
 */
async function generateCharacterDescription(storyPromptTh) {
  console.log('🎨 Typhoon2 สร้าง character description (natural language for Wan2.1)...');
  const raw  = await ollamaChat(storyPromptTh, CHAR_SYSTEM);
  const desc = raw.trim().split('\n')[0].replace(/^[-*•"]\s*/, '').replace(/"$/, '').trim();
  console.log(`✅ Character description: ${desc}`);
  return desc;
}

/**
 * สร้าง character-specific negative prompt เพื่อล็อก appearance
 * @param {string} charDesc — Booru-tag character description
 * @returns {string}
 */
function buildCharacterNegative(charDesc) {
  // ดึง hair color + outfit color จาก charDesc เพื่อป้องกันการ drift
  const hairMatch    = charDesc.match(/(\w+)\s+hair/i);
  const outfitMatch  = charDesc.match(/(\w+)\s+(dress|shirt|jacket|uniform|outfit|clothes)/i);
  const extras = [
    hairMatch   ? `different hair color, not ${hairMatch[1]} hair`    : '',
    outfitMatch ? `different outfit color, not ${outfitMatch[1]} outfit` : '',
  ].filter(Boolean).join(', ');
  return [
    'character inconsistency, different character design, changing appearance',
    'multiple characters, different hair style, different face',
    extras,
  ].filter(Boolean).join(', ');
}

const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'llava';

/**
 * ลอง describe รูปตัวละครด้วย LLaVA vision — คืน Booru-tag string หรือ null ถ้าไม่มี model
 * @param {string} imagePath  path ของ char_ref.png
 * @returns {Promise<string|null>}
 */
async function describeCharacterImage(imagePath) {
  try {
    const imgB64 = fs.readFileSync(imagePath).toString('base64');
    const body   = JSON.stringify({
      model: VISION_MODEL,
      messages: [{ role: 'user', content:
        'Describe this anime character using Booru image-board tags only. ' +
        'One line, comma-separated. Include: gender, age, hair color and length, eye color, outfit color and type, skin tone, notable features.',
        images: [imgB64],
      }],
      stream: false,
    });
    const url    = new URL('/api/chat', OLLAMA_HOST);
    const result = await new Promise(resolve => {
      const req = http.request({
        hostname: url.hostname, port: url.port || 11434, path: url.pathname,
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, res => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => { try { resolve(JSON.parse(buf).message?.content || ''); } catch { resolve(''); } });
      });
      req.setTimeout(60000, () => { req.destroy(); resolve(''); });
      req.on('error', () => resolve(''));
      req.write(body); req.end();
    });
    const desc = result.trim().split('\n')[0].trim();
    if (desc.length > 10) { console.log(`🔍 Vision desc: ${desc}`); return desc; }
  } catch { /* vision model ไม่มี */ }
  return null;
}

/**
 * Scene breakdown แบบรู้จักหลายตัวละคร — แต่ละ scene ระบุ characters[]
 * @param {string} storyPromptTh
 * @param {object} characters  — { id: { name, description } } จาก char-registry
 * @returns {Promise<Array<{scene_number, visual_prompt_en, subtitle_th, characters}>>}
 */
async function generateScenesWithCharacters(storyPromptTh, characters) {
  const charIds = Object.keys(characters);
  if (!charIds.length) return generateScenes(storyPromptTh);

  const charList = charIds.map(id => `${id}(${characters[id].name || id})`).join(', ');
  const system = `คุณเป็น AI สร้างสคริปต์วิดีโอ Anime Story
ตัวละครที่มีในเรื่อง: ${charList}
แตก story ออกเป็น 5 scenes ที่มีความต่อเนื่อง ตอบเป็น JSON array เท่านั้น ไม่มีข้อความอื่น

format:
[{"scene_number":1,"visual_prompt_en":"anime style, [scene 20-40 words], cinematic lighting","subtitle_th":"[ไม่เกิน 12 คำ]","narration_th":"[เสียงพากย์นิทาน 2-3 ประโยค ต่อเนื่องจาก scene ก่อน]","visual_action":"[key action 5-10 words en]","characters":["id1"]}]

กฎ: visual_prompt_en เป็นภาษาอังกฤษ, narration_th สไตล์นิทานไทย, characters คือ array ของ id, family-friendly`;

  console.log(`🤖 Typhoon2 scene breakdown (${charIds.length} chars)...`);
  const raw    = await ollamaChat(`สร้าง 5 scenes:\n\n${storyPromptTh}`, system);
  const match  = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('ไม่พบ JSON array');
  const scenes = JSON.parse(match[0]);
  return scenes.slice(0, 5).map((s, i) => ({
    scene_number:     s.scene_number     || i + 1,
    visual_prompt_en: s.visual_prompt_en || `anime style, scene ${i + 1}`,
    subtitle_th:      s.subtitle_th      || '',
    narration_th:     s.narration_th     || s.subtitle_th || '',
    visual_action:    s.visual_action    || '',
    characters:       Array.isArray(s.characters) ? s.characters.filter(id => characters[id]) : [charIds[0]],
  }));
}

module.exports = { generateScenes, generateScenesWithCharacters, generateCharacterDescription, buildCharacterNegative, describeCharacterImage };
