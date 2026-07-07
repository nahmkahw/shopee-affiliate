'use strict';
/**
 * comic-gen.js — แตก Story Prompt ไทย → 4 Panel (2x2) ด้วย Typhoon2
 * มาสคอตกระต่าย chibi ตัวเดียวคงที่ (ไม่มี character registry แบบมะปราง)
 * แต่ละ Panel: ฉาก (en) + Bubble (speech/thought/none, corner, ข้อความ ≤MAX_LINE) + Footer Caption ปิดเรื่อง
 */

const { ollamaChat } = require('../../../lib/ollama-chat');
const { parseJsonArrayLenient } = require('../../../lib/llm-json');

const N_PANELS  = 4;
const MAX_LINE  = parseInt(process.env.MAPRAO_COMIC_MAXLINE || '40', 10);
const CORNERS   = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const ROLES     = ['เปิดเรื่อง ตั้งสถานการณ์', 'พัฒนาเหตุการณ์', 'จุดหักมุม/เกิดเรื่องไม่คาดคิด', 'มุกจบ/บทสรุป'];

function capLine(text) {
  const t = (text || '').trim();
  return t.length <= MAX_LINE ? t : t.slice(0, MAX_LINE - 1).trimEnd() + '…';
}

// สรุป input ดิบ → concept {title, points[]}
async function summarizeConcept(storyPromptTh) {
  const sys = `คุณสรุปเรื่องสั้นเป็น concept การ์ตูน 4 ช่อง ตอบ JSON เดียวเท่านั้น ไม่มีอย่างอื่น ไม่มี markdown
{"title":"หัวข้อสั้นภาษาไทย","points":["ประเด็น 1","ประเด็น 2","ประเด็น 3"]}
สรุปใจความสำคัญ 3-4 ประเด็น เป็นภาษาไทยกระชับ family-friendly`;
  try {
    const raw = await ollamaChat(`เรื่อง:\n${storyPromptTh}\n\nสรุปเป็น title + 3-4 points`, sys);
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const o = JSON.parse(m[0]);
      const points = (Array.isArray(o.points) ? o.points : []).map(p => String(p).trim()).filter(Boolean).slice(0, 4);
      if (o.title && points.length) return { title: String(o.title).trim(), points };
    }
  } catch {}
  return { title: storyPromptTh.slice(0, 60).trim(), points: [storyPromptTh.slice(0, 80).trim()] };
}

async function deriveSharedSetting(conceptTitle) {
  const sys = `คุณกำหนดฉากการ์ตูนกระต่าย ตอบภาษาอังกฤษบรรทัดเดียว ไม่มีอย่างอื่น ไม่มีวงเล็บ
บรรยาย "สถานที่ที่กระต่ายทำเรื่องนี้" ละเอียด 8-15 คำ
ตัวอย่าง: a cozy kitchen with warm morning light and wooden counters`;
  try {
    const raw = await ollamaChat(`หัวข้อ: ${conceptTitle}\nกระต่ายอยู่ที่ไหน`, sys);
    const s = (raw || '').trim().split('\n')[0].replace(/^["']|["']$/g, '').trim();
    if (s && !/[\[\]]|อังกฤษ|ตัวอักษร/.test(s) && s.length >= 6) return s;
  } catch {}
  return 'a cozy kitchen with warm morning light';
}

function panelBrief(i, concept) {
  const pts = concept.points;
  switch (i) {
    case 0:  return { role: ROLES[0], focus: concept.title };
    case 1:  return { role: ROLES[1], focus: pts[0] || concept.title };
    case 2:  return { role: ROLES[2], focus: pts[1] || pts[0] || concept.title };
    default: return { role: ROLES[3], focus: pts.slice(2).join(' ') || pts[pts.length - 1] || concept.title };
  }
}

function normPanel(p, idx) {
  const b = p?.bubble;
  const hasBubble = b && (b.type === 'speech' || b.type === 'thought') && b.text_th;
  return {
    panel: idx + 1,
    scene_setting_en: (p?.scene_setting_en || `scene ${idx + 1}`).trim(),
    bubble: hasBubble
      ? { type: b.type, corner: CORNERS.includes(b.corner) ? b.corner : CORNERS[idx % 4], text_th: capLine(b.text_th) }
      : null,
  };
}

function isValid(np, prevText) {
  if (!np || !np.scene_setting_en || np.scene_setting_en.length < 6) return false;
  if (/^scene \d+$/i.test(np.scene_setting_en.trim())) return false;
  if (np.bubble && np.bubble.text_th === prevText) return false; // กันซ้ำช่องก่อน
  return true;
}

/**
 * gen ทีละ Panel (โมเดล 8B ทำ multi-item JSON ไม่ครบ → ขอทีละช่องเชื่อถือได้กว่า)
 * @returns {Promise<{concept, sharedSetting, panels, footerCaption}>}
 */
async function generateComicPanels(storyPromptTh) {
  const concept = await summarizeConcept(storyPromptTh);
  console.log(`  💡 Concept: ${concept.title} (${concept.points.length} points)`);
  const sharedSetting = await deriveSharedSetting(concept.title);
  console.log(`  📍 ฉากร่วม: ${sharedSetting}`);

  const system = `คุณเป็นนักเขียนการ์ตูนกระต่าย chibi 4 ช่อง ภาษาไทย ตัวละครมีแค่กระต่ายตัวเดียว
ทุกช่องอยู่ที่เดียวกัน: ${sharedSetting}
ตอบเป็น JSON array ที่มี object เดียวเท่านั้น ไม่มีข้อความอื่น ไม่มี markdown
ตัวอย่าง: [{"scene_setting_en":"the bunny mixing flour in a bowl, excited","bubble":{"type":"speech","corner":"top-left","text_th":"วันนี้จะทำเค้กอร่อยๆ!"}}]
กฎ: scene_setting_en = ภาษาอังกฤษบรรยาย "สิ่งที่กระต่ายกำลังทำ" ในช่องนี้ (อย่าเปลี่ยนสถานที่)
bubble ไม่บังคับต้องมีทุกช่อง (บางช่องไม่มีบทพูด/ความคิดก็ได้ ให้ตอบ "bubble":null)
type: "speech" (พูดออกเสียง) หรือ "thought" (คิดในใจ) เท่านั้น, corner หนึ่งใน top-left/top-right/bottom-left/bottom-right
text_th สั้น ≤${MAX_LINE} ตัวอักษร, family-friendly`;

  const panels = [];
  let recap = '', prevText = '';
  for (let i = 0; i < N_PANELS; i++) {
    const brief = panelBrief(i, concept);
    const user = `หัวข้อ: ${concept.title}\n${recap ? 'เนื้อหาช่องก่อน (ห้ามซ้ำ): ' + recap + '\n' : ''}เขียนช่องที่ ${i + 1}/${N_PANELS} — หน้าที่: ${brief.role}\nใจความ: ${brief.focus}`;
    let np = null;
    for (let attempt = 0; attempt < 3 && !np; attempt++) {
      try {
        const cand = normPanel(parseJsonArrayLenient(await ollamaChat(user, system))[0], i);
        if (isValid(cand, prevText)) np = cand;
      } catch {}
    }
    if (!np) {
      np = normPanel({ scene_setting_en: `the bunny reacting to a scene about ${storyPromptTh}` }, i);
      if (i === N_PANELS - 1) np.bubble = { type: 'speech', corner: CORNERS[i % 4], text_th: 'จบแบบนี้เลยเหรอ!' };
    }
    panels.push(np);
    prevText = np.bubble?.text_th || '';
    recap = np.bubble?.text_th || np.scene_setting_en;
    console.log(`  ✅ ช่อง ${i + 1}: ${np.scene_setting_en.slice(0, 40)}${np.bubble ? ' | ' + np.bubble.type + ': ' + np.bubble.text_th : ''}`);
  }

  const footerCaption = await deriveFooterCaption(concept);
  return { concept, sharedSetting, panels, footerCaption };
}

// footer 2 บรรทัด: title\nสรุปเนื้อเรื่อง 1 ประโยค
async function deriveFooterCaption(concept) {
  const sys = `ตอบภาษาไทยบรรทัดเดียว ไม่เกิน 50 ตัวอักษร ไม่มีเครื่องหมายคำพูด
สรุปเนื้อเรื่องของการ์ตูน 4 ช่องนี้เป็น 1 ประโยคกระชับ น่ารัก บอกว่าเกิดอะไรขึ้น
ตัวอย่าง: กระต่ายน้อยลองทำเค้กครั้งแรก แม้จะพังแต่ก็อร่อยในแบบของตัวเอง`;
  try {
    const raw = await ollamaChat(
      `หัวข้อ: ${concept.title}\nประเด็น: ${concept.points.join(', ')}`, sys);
    const s = (raw || '').trim().split('\n')[0].replace(/^["']|["']$/g, '').trim();
    if (s && s.length >= 5 && s.length <= 60) return `${concept.title}\n${s}`;
  } catch {}
  return `${concept.title}\nเรื่องราวน่ารักของกระต่ายน้อย`;
}

// caption สั้นๆ สำหรับโพสต์ FB (Typhoon2 แต่งจาก concept, ไม่มี #Shopeeaffiliate เพราะไม่ใช่สินค้า)
async function generateFbCaption(concept, storyPromptTh) {
  const sys = `คุณเขียน caption โพสต์ Facebook สั้นๆ 1-2 ประโยค ภาษาไทย น่ารัก เป็นกันเอง
ตอบข้อความ caption อย่างเดียว ไม่มี hashtag ไม่มีเครื่องหมายคำพูดครอบ ไม่เกิน 200 ตัวอักษร`;
  try {
    const raw = await ollamaChat(`หัวข้อ: ${concept.title}\nเรื่องย่อ: ${storyPromptTh}`, sys);
    const s = (raw || '').trim().replace(/^["']|["']$/g, '');
    if (s && s.length <= 300) return s;
  } catch {}
  return concept.title;
}

module.exports = { generateComicPanels, generateFbCaption };
