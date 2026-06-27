'use strict';
/**
 * comic-gen.js — แตก story ไทย → 4 panel การ์ตูน (4-koma) ด้วย Typhoon2
 * แต่ละ panel: ฉาก (en) + ตัวละครในช่อง + บทพูด (บอลลูน)
 * ต่างจาก scene-gen (วิดีโอ): ไม่มี narration/motion/audio — เป็นภาพนิ่ง + ข้อความ
 */

const { ollamaChat } = require('./scene-gen');
const { parseJsonArrayLenient } = require('../../../lib/llm-json');

const N_PANELS = parseInt(process.env.MAPRANG_COMIC_PANELS || '4', 10);
const MAX_LINE = parseInt(process.env.MAPRANG_COMIC_MAXLINE || '40', 10); // บอลลูนพอดี

// ตัดบทพูดยาวเกินบอลลูน
function capLine(text) {
  const t = (text || '').trim();
  return t.length <= MAX_LINE ? t : t.slice(0, MAX_LINE - 1).trimEnd() + '…';
}

// story beats (4 ช่อง = ตั้ง-ขยาย-หักมุม-จบ) — ปรับตามจำนวน panel
const BEATS = ['เปิดเรื่อง ตั้งสถานการณ์', 'พัฒนาเหตุการณ์', 'จุดหักมุม/เกิดเรื่องไม่คาดคิด', 'มุกจบ/บทสรุปขำขัน'];
function beatFor(i, n) { return n === 4 ? BEATS[i] : i === 0 ? BEATS[0] : i === n - 1 ? BEATS[3] : BEATS[1]; }

// composition template ตายตัว: P1=c0, P2=c1(มิเรอร์), P3=[c0,c1], P4=ทุกตัวที่เลือก
function panelCharTemplate(charIds) {
  const c0 = charIds[0], c1 = charIds[1] || charIds[0];
  const uniq = a => a.filter((v, i, arr) => arr.indexOf(v) === i);
  return [[c0], [c1], uniq([c0, c1]), charIds.slice()];
}

// ตัด prefix ชื่อผู้พูดที่ LLM เผลอใส่ในบทพูด ("โหน่ง: ข้อความ" → "ข้อความ")
function stripSpeakerPrefix(line, name, id) {
  let t = (line || '').trim();
  for (const tag of [name, id].filter(Boolean)) {
    const re = new RegExp('^' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:：]\\s*', 'i');
    t = t.replace(re, '').trim();
  }
  return t;
}

// บังคับตัวละครในช่อง = template + remap ผู้พูดให้อยู่ในตัวที่โชว์ (P1 พูดโดย c0, P2 โดย c1)
function forcePanelChars(np, allowed, characters) {
  np.characters = allowed.slice();
  np.dialogue = np.dialogue.map(d => {
    const sp = allowed.includes(d.speaker) ? d.speaker : allowed[0];
    const name = characters[sp]?.name || sp;
    return { speaker: sp, line_th: stripSpeakerPrefix(d.line_th, name, sp), name };
  });
  return np;
}

// normalize 1 panel object → schema มาตรฐาน
function normPanel(p, idx, characters, charIds) {
  const chars = (Array.isArray(p?.characters) ? p.characters.filter(id => characters[id]) : []);
  const dlg = (Array.isArray(p?.dialogue) ? p.dialogue : [])
    .filter(d => d && d.line_th).slice(0, 2)
    .map(d => ({ speaker: d.speaker, line_th: capLine(d.line_th),
                 name: characters[d.speaker]?.name || d.speaker || '' }));
  return {
    panel: idx + 1,
    scene_setting_en: (p?.scene_setting_en || `scene ${idx + 1}`).replace(/^anime style,\s*/i, ''),
    characters: chars.length ? chars : charIds,
    dialogue: dlg,
  };
}

// derive ฉากร่วม (location+เวลา+บรรยากาศ) ครั้งเดียว → ใช้เป็น background เดียวกันทุกช่อง
async function deriveSharedSetting(storyPromptTh) {
  const sys = `คุณกำหนดฉากการ์ตูน ตอบภาษาอังกฤษบรรทัดเดียว ไม่มีอย่างอื่น ไม่มีวงเล็บ
บรรยายสถานที่+เวลา+บรรยากาศที่เรื่องเกิดขึ้น แบบละเอียดเจาะจง 10-18 คำ (ใช้เป็นฉากหลังเดียวกันทุกช่อง)
ตัวอย่าง: a cozy noodle restaurant with red paper lanterns, wooden tables and a steaming food counter at night`;
  try {
    const raw = await ollamaChat(`story: ${storyPromptTh}\nสถานที่หลักของเรื่องนี้คือที่ไหน`, sys);
    let s = (raw || '').trim().split('\n')[0].replace(/^["']|["']$/g, '').replace(/^anime style,\s*/i, '').trim();
    if (s && !/[\[\]]|อังกฤษ|ตัวอักษร/.test(s) && s.length >= 8) return s;
  } catch {}
  return 'a warmly lit indoor scene with simple background';
}

/**
 * gen ทีละ panel (โมเดล 8B ทำ multi-item JSON ไม่ครบ → ขอทีละช่องเชื่อถือได้กว่า)
 * background ทุกช่อง = ฉากร่วม (shared_setting) + action เฉพาะช่องตามบทพูด
 * @param {string} storyPromptTh
 * @param {object} characters  registry { id: {name, description} }
 * @returns {Promise<{sharedSetting:string, panels:Array}>}
 */
async function generateComicPanels(storyPromptTh, characters) {
  const charIds  = Object.keys(characters);
  const charList = charIds.map(id => `${id}(${characters[id].name || id})`).join(', ') || '(ไม่ระบุ)';
  const exId = charIds[0] || 'Teng';
  // ตัวอย่างจริง (ไม่ใช่ placeholder ในวงเล็บ) — ลดอาการโมเดลลอก template
  const sharedSetting = await deriveSharedSetting(storyPromptTh);
  console.log(`  📍 ฉากร่วม: ${sharedSetting}`);

  // scene_setting_en ของ LLM = "action ในช่อง" เท่านั้น (ไม่ใช่ทั้งฉาก) — location คงที่จาก sharedSetting
  const system = `คุณเป็นนักเขียนการ์ตูน 4 ช่อง ภาษาไทย ตัวละคร: ${charList}
ทุกช่องอยู่ที่เดียวกัน: ${sharedSetting}
ตอบเป็น JSON array ที่มี object เดียวเท่านั้น ไม่มีข้อความอื่น ไม่มี markdown ไม่มีวงเล็บเหลี่ยมในเนื้อหา
ตัวอย่าง: [{"scene_setting_en":"the friends pointing at the menu and laughing","characters":["${exId}"],"dialogue":[{"speaker":"${exId}","line_th":"วันนี้สนุกจริง ๆ เลย"}]}]
กฎ: scene_setting_en = ภาษาอังกฤษบรรยายแค่ "สิ่งที่ตัวละครกำลังทำ" ในช่องนี้ให้เข้ากับบทพูด (อย่าเปลี่ยนสถานที่), line_th บทพูดไทยสั้น ≤${MAX_LINE} ตัวอักษร, speaker = id ตัวละครจริง, family-friendly`;

  // panel ใช้ไม่ได้ถ้า: placeholder / ฉากว่าง-default / ไม่มีบทพูด / ซ้ำช่องก่อน
  const bad = s => !s || /[\[\]]|อังกฤษ|ตัวอักษร|≤|scene_setting/i.test(s) || s.trim().length < 6;
  const dlgKey = np => np.dialogue.map(d => d.line_th).join('|');
  const isValid = (np, prevKey) =>
    np && !bad(np.scene_setting_en) && !/^scene \d+$/i.test(np.scene_setting_en.trim()) &&
    np.dialogue.length >= 1 && np.dialogue.every(d => !bad(d.line_th)) &&
    dlgKey(np) !== prevKey;

  const template = panelCharTemplate(charIds);
  console.log(`🤖 Typhoon2 comic (${N_PANELS} panels ทีละช่อง, ${charIds.length} chars)...`);
  const panels = [];
  let recap = '', prevKey = '';
  for (let i = 0; i < N_PANELS; i++) {
    const allowed = template[i] || charIds;                       // ตัวละครที่โชว์/พูดได้ในช่องนี้
    const speakerNames = allowed.map(id => characters[id]?.name || id).join(', ');
    const user = `story: ${storyPromptTh}\n${recap ? 'เนื้อหาช่องก่อน (ห้ามซ้ำ): ' + recap + '\n' : ''}เขียนช่องที่ ${i + 1}/${N_PANELS} แบบ ${beatFor(i, N_PANELS)} ต่อเนื่องและแตกต่างจากช่องก่อน\nช่องนี้มีเฉพาะตัวละคร: ${speakerNames} (บทพูดต้องเป็นของตัวละครเหล่านี้เท่านั้น)`;
    let np = null;
    for (let attempt = 0; attempt < 3 && !np; attempt++) {
      try { const cand = normPanel(parseJsonArrayLenient(await ollamaChat(user, system))[0], i, characters, charIds);
            if (isValid(cand, prevKey)) np = cand; } catch {}
    }
    if (!np) {  // ทุก attempt ล้มเหลว → fallback ไม่ให้ panel ว่าง/ซ้ำ
      np = normPanel({ scene_setting_en: `the characters reacting in a scene about ${storyPromptTh}` }, i, characters, charIds);
      np.dialogue = [{ speaker: allowed[0], line_th: i === N_PANELS - 1 ? 'จบแบบนี้เลยเหรอ!' : 'เอ๊ะ เกิดอะไรขึ้น',
                       name: characters[allowed[0]]?.name || allowed[0] || '' }];
    }
    forcePanelChars(np, allowed, characters);                     // บังคับ layout ตาม template
    np.action_en = np.scene_setting_en;                           // เก็บ action ดิบ
    np.scene_setting_en = `${sharedSetting}. ${np.action_en}`;    // background ร่วม + action ตามบท
    panels.push(np);
    prevKey = dlgKey(np);
    recap = np.dialogue.map(d => `${d.name}:${d.line_th}`).join(' ');
    console.log(`  ✅ ช่อง ${i + 1}: ${np.dialogue.map(d => d.name + ':' + d.line_th).join(' / ')}`);
  }
  return { sharedSetting, panels };
}

module.exports = { generateComicPanels };
