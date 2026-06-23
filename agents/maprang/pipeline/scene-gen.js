'use strict';
/**
 * scene-gen.js — แตก story prompt ภาษาไทย → 5 scenes ด้วย Typhoon2
 * Output per scene: { scene_number, visual_prompt_en, subtitle_th }
 */

const http = require('http');

const OLLAMA_HOST  = process.env.OLLAMA_HOST  || 'http://10.3.17.118:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'scb10x/llama3.1-typhoon2-8b-instruct:latest';

const SYSTEM_PROMPT = `คุณเป็น AI สร้างสคริปต์วิดีโอ Anime Story
รับ story prompt ภาษาไทย แล้วแตกออกเป็น 5 scenes
ตอบเป็น JSON array เท่านั้น ไม่มีข้อความอื่น ไม่มี markdown code block

format ที่ต้องการ:
[
  {
    "scene_number": 1,
    "visual_prompt_en": "anime style, [English description of the scene, 20-40 words], cinematic lighting, detailed background",
    "subtitle_th": "[คำบรรยายภาษาไทย ไม่เกิน 15 คำ]"
  },
  ...
]

กฎสำคัญ:
- visual_prompt_en ต้องเป็นภาษาอังกฤษ เริ่มด้วย "anime style,"
- subtitle_th ต้องเป็นภาษาไทย กระชับ ไม่เกิน 15 คำ
- ต้องมีครบ 5 scenes เสมอ
- เนื้อหาต้องเป็น family-friendly`;

function ollamaChat(prompt) {
  return new Promise((resolve, reject) => {
    const url  = new URL('/api/chat', OLLAMA_HOST);
    const body = JSON.stringify({
      model:    OLLAMA_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
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
    scene_number:     s.scene_number    || i + 1,
    visual_prompt_en: s.visual_prompt_en || `anime style, scene ${i + 1}`,
    subtitle_th:      s.subtitle_th      || '',
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

module.exports = { generateScenes };
