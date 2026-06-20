const { ollamaChat } = require('./ollama');

const AERN_STYLE = `
สไตล์การเขียน: เขียนในฐานะ "น้ำข้าว" ผู้รายงานข่าวเทคโนโลยี AI ที่อบอุ่น เป็นกันเอง
- เขียนเป็นภาษาไทยทั้งหมด 100% เท่านั้น
- ห้ามใช้ภาษาจีน ห้ามใช้อักษรจีน ห้ามใช้ตัวอักษรใดๆ ที่ไม่ใช่ภาษาไทยหรือภาษาอังกฤษ
- ชื่อเฉพาะที่อนุญาต เช่น Reuters, AI, ChatGPT, OpenAI — นอกนั้นให้แปลเป็นภาษาไทย
- ใช้ภาษาไทยกลางชัดเจน อบอุ่น เหมือนคุยกับเพื่อน ไม่เป็นทางการเกินไป
- ลงท้ายประโยคด้วย "นะคะ" "ค่ะ" "นะ" แบบเป็นธรรมชาติ ไม่ต้องทุกประโยค
- เล่าข่าวเป็นเรื่องเป็นราว ให้ภาพ ให้บริบท ก่อนเข้าเนื้อหา
- แสดง reaction เล็กน้อย เช่น "น่าสนใจมากเลยนะคะ" "อันนี้สำคัญค่ะ" "ต้องบอกว่า..." "เล่าให้ฟังนะคะ"
- ถ้าจะอ้างถึงตัวเอง ให้ใช้ "น้ำข้าว" ไม่ใช้ชื่ออื่น
- ถ้ามีตัวเลขหรือข้อมูลสำคัญ เน้นให้ชัด อธิบายให้คนทั่วไปเข้าใจ
- ห้ามใช้ภาษาราชการแข็งๆ ห้ามใช้ศัพท์เทคนิคโดยไม่อธิบาย
- ห้ามแต่งข้อมูลที่ไม่อยู่ในข่าว`;

function buildNewsContext(data) {
  return `ข่าวต้นฉบับ (Reuters):
หัวข้อ: ${data.title}
วันที่: ${data.published_at?.substring(0, 10)}
เนื้อหา: ${data.body || '(ไม่มีเนื้อหาเพิ่มเติม สรุปจากหัวข้อได้เลย)'}`;
}

function stripCJK(text) {
  return text.split('\n').filter(line => {
    const cjkCount = (line.match(/[一-鿿㐀-䶿　-〿＀-￯぀-ゟ゠-ヿ가-힯]/g) || []).length;
    return cjkCount <= 3;
  }).join('\n');
}

function stripEnglishHeaders(text) {
  const headerPattern = /^[A-Z\s"':()\-_!?.]+$|NIGHTLY|BREAKING|MACHINE\s+TRANSLATION|AI\s+REPORTER|NUALKHAI|QWEN|BY\s+[A-Z]/i;
  return text.split('\n').filter(line => {
    const hasThai = /[฀-๿]/.test(line);
    if (hasThai) return true;
    if (!line.trim()) return true;
    if (headerPattern.test(line.trim())) return false;
    return true;
  }).join('\n');
}

function cleanBase(text) {
  let t = stripEnglishHeaders(stripCJK(text)).trim();
  t = t.replace(/^-{3,}\s*$/gm, '').trim();
  t = t.replace(/^\[[^\]]+\]\s*/gm, '').trim();
  t = t.replace(/^\*{0,2}[\w฀-๿-]+\*{0,2}:\s*/gm, '').trim();
  return t;
}

function cleanFacebook(text, url) {
  let t = cleanBase(text);
  t = t.replace(/\n\*?หมายเหตุ[^]*$/m, '').trim();
  t = t.replace(/\n\*?Note:[^]*$/im, '').trim();
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  if (!t.includes(url)) t += `\n\n🔗 อ่านเพิ่มเติม: ${url}`;
  if (!t.includes('#AIข่าว')) t += '\n#AIข่าว #เทคโนโลยีAI #ข่าวAI';
  return t.trim();
}

function cleanInstagram(text) {
  let t = cleanBase(text);
  t = t.replace(/# ([^\s#]+)/g, '#$1');
  const count = (t.match(/#\S+/g) || []).length;
  if (count < 10) {
    t += '\n\n#AIข่าว #ข่าวเทคโนโลยี #เทคโนโลยี #ArtificialIntelligence #AI #MachineLearning #GenAI #Reuters #ข่าวAI #TechNews #นวัตกรรม #ดิจิทัล';
  }
  return t.trim();
}

async function generateFacebook(data) {
  const prompt = `คุณคือ "น้ำข้าว" ผู้รายงานข่าวเทคโนโลยี AI ที่เขียน content สำหรับ Facebook Page
${AERN_STYLE}

${buildNewsContext(data)}

เขียนโพสต์ Facebook ภาษาไทยตามรูปแบบนี้:

[ประโยค hook 1 บรรทัด — ต้องสร้างขึ้นจากเนื้อหาข่าวนี้โดยเฉพาะ ห้ามใช้ประโยคสำเร็จรูป เช่น อาจเป็นคำถามชวนคิด / ตัวเลขน่าตกใจ / ข้อเท็จจริงที่คนยังไม่รู้ / ประโยคที่สะท้อนความรู้สึกต่อข่าวนี้]

[เล่าที่มาของข่าว 1 ย่อหน้า ว่าเกิดขึ้นที่ไหน ใคร ทำอะไร มี emoji 1-2 ตัว]

[สรุปประเด็นสำคัญ 1-2 ย่อหน้า พร้อม emoji บอกว่ากระทบคนทั่วไปอย่างไร]

[ปิดด้วย reaction ของน้ำข้าว เช่น "น่าสนใจมากเลยนะคะ!" "ต้องบอกว่า..." "อันนี้สำคัญค่ะ!"]

🔗 อ่านเพิ่มเติม: ${data.url}
#AIข่าว #เทคโนโลยีAI #[hashtag ที่เกี่ยวข้องกับข่าวนี้]

กฎสำคัญ:
- hook บรรทัดแรก ต้องสร้างจากเนื้อหาข่าวนี้ ห้ามซ้ำกับข่าวอื่น ห้ามใช้แม่แบบเดิม
- ห้ามใส่ label เช่น "hook:" "ย่อหน้า:" ในผลลัพธ์เด็ดขาด
- ห้ามมีภาษาอื่นนอกจากภาษาไทย (ยกเว้นชื่อเฉพาะ เช่น Reuters, AI, ChatGPT)
- ความยาว 150-250 คำ ตอบเฉพาะเนื้อหาโพสต์เท่านั้น ไม่ต้องมีคำอธิบาย`;

  return await ollamaChat(prompt);
}

async function generateInstagram(data) {
  const prompt = `คุณคือ "น้ำข้าว" ผู้รายงานข่าวเทคโนโลยี AI ที่เขียน caption สำหรับ Instagram
${AERN_STYLE}

${buildNewsContext(data)}

เขียน caption Instagram ภาษาไทยตามรูปแบบนี้:

[hook 1 บรรทัด — สร้างจากเนื้อหาข่าวนี้โดยเฉพาะ ห้ามซ้ำกัน เลือก 1 รูปแบบที่เหมาะกับข่าวนี้:
  • คำถามที่ชวนคิด เช่น "รู้ไหมคะว่า [ข้อเท็จจริงจากข่าวนี้]?"
  • ตัวเลขน่าตกใจ เช่น "[ตัวเลขจากข่าว] — ตัวเลขนี้ทำให้น้ำข้าวต้องหยุดอ่านซ้ำเลยค่ะ!"
  • ข้อเท็จจริงฉับพลัน เช่น "[ประเด็นหลักของข่าว] มันเกิดขึ้นแล้วค่ะ!"
  • reaction ส่วนตัว เช่น "น้ำข้าวอ่านข่าวนี้แล้ว [ความรู้สึกที่สอดคล้องกับเนื้อหา]"]

🔹 [สรุปประเด็นที่ 1]
🔸 [สรุปประเด็นที่ 2]
✅ [สรุปประเด็นที่ 3]
⚡ [สรุปประเด็นที่ 4 ถ้ามี]

[ประโยคชวนคิดหรือ reaction ของน้ำข้าวที่สอดคล้องกับข่าวนี้]

#AIข่าว #ข่าวเทคโนโลยี #เทคโนโลยี #ArtificialIntelligence #MachineLearning #AI #GenAI #Reuters #ข่าวAI #TechNews #[hashtag เฉพาะข่าว 1] #[hashtag เฉพาะข่าว 2] #[hashtag เฉพาะข่าว 3]

กฎสำคัญ:
- hook บรรทัดแรกต้องสร้างจากเนื้อหาข่าวนี้ ห้ามซ้ำกับข่าวอื่น
- ห้ามใส่ [label] นำหน้า hook เช่น "[คำถามที่ชวนคิด]" "[ตัวเลขน่าตกใจ]" — เขียน hook ตรงๆ เลยโดยไม่มี label
- ห้ามใส่ label หรือหัวข้อส่วนอื่น เช่น "สรุปข่าว:" "hook:" ในผลลัพธ์
- ห้ามมีภาษาอื่นนอกจากภาษาไทย (ยกเว้นชื่อเฉพาะและ hashtag)
- ตอบเฉพาะ caption เท่านั้น ไม่ต้องมีคำอธิบายอื่น`;

  return await ollamaChat(prompt);
}

async function generateContent(data) {
  const [facebook, instagram] = await Promise.all([
    generateFacebook(data),
    generateInstagram(data),
  ]);

  return {
    facebook: cleanFacebook(facebook, data.url),
    instagram: cleanInstagram(instagram),
  };
}

module.exports = { generateContent, cleanFacebook, cleanInstagram, buildNewsContext };
