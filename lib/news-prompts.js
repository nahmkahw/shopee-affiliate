'use strict';

/**
 * Platform-specific content formatters for AI News pipeline.
 * Each function calls ollamaChat with a น้ำข้าว-style prompt and post-processes the output.
 */

const STYLE = `สไตล์การเขียน "น้ำข้าว":
- ภาษาไทยล้วน ห้ามอักษรจีน/ญี่ปุ่น/เกาหลี
- อบอุ่น เป็นกันเอง เหมือนเล่าให้เพื่อนฟัง
- ลงท้าย "นะคะ" หรือ "ค่ะ" เป็นบางประโยคตามธรรมชาติ ไม่ทุกประโยค
- ชื่อเฉพาะ ชื่อยา สารเคมี ให้ใช้ภาษาอังกฤษทั้งคำ ห้ามผสมอักษรไทยกับอังกฤษในคำเดียวกัน เช่น "fentanyl" ไม่ใช่ "ฟentanyl"
- ห้ามแต่งข้อมูลที่ไม่มีในบทความ`;

async function formatFacebook(ollamaChat, cleanOutput, master, url) {
  let out = await ollamaChat(`${STYLE}

เขียน Facebook post จากบทความข่าวนี้:
───
${master}
───

รูปแบบ:
1. บรรทัดแรก: hook (คำถาม / ตัวเลขน่าสนใจ / ประโยคที่ทำให้หยุดอ่าน) — สร้างจากเนื้อข่าวนี้
2. เล่าเรื่อง 2-3 ย่อหน้า ใส่ emoji พอดี
3. ปิดด้วย reaction ของน้ำข้าว
4. บรรทัดสุดท้าย: 🔗 อ่านเพิ่มเติม: ${url}
5. hashtag: #AIข่าว #เทคโนโลยีAI #ข่าวAI

ความยาว: 150-200 คำ
ตอบเฉพาะ post เท่านั้น ไม่ต้องมีคำอธิบาย`);
  out = cleanOutput(out);
  if (!out.includes(url))       out += `\n\n🔗 อ่านเพิ่มเติม: ${url}`;
  if (!out.includes('#AIข่าว')) out += '\n#AIข่าว #เทคโนโลยีAI #ข่าวAI';
  return out;
}

async function formatInstagram(ollamaChat, cleanOutput, master) {
  let out = await ollamaChat(`${STYLE}

เขียน Instagram caption จากบทความข่าวนี้:
───
${master}
───

รูปแบบ:
1. hook 1 บรรทัด — ชวนคิดหรือน่าสนใจ สร้างจากเนื้อข่าวนี้
2. bullet 3-4 ข้อสรุปประเด็น (ใช้ 🔹🔸✅⚡)
3. ประโยคปิดของน้ำข้าว

hashtag 15-20 อัน ต้องมี:
#AIข่าว #ข่าวเทคโนโลยี #เทคโนโลยี #ArtificialIntelligence #AI #MachineLearning #GenAI #Reuters #ข่าวAI #TechNews
+ hashtag เฉพาะข่าวนี้ 5-8 อัน

ความยาว: 100-150 คำ (ไม่นับ hashtag)
ตอบเฉพาะ caption เท่านั้น`);
  out = cleanOutput(out);
  out = out.replace(/# ([^\s#]+)/g, '#$1');
  if ((out.match(/#\S+/g) || []).length < 10) {
    out += '\n\n#AIข่าว #ข่าวเทคโนโลยี #เทคโนโลยี #ArtificialIntelligence #AI #MachineLearning #GenAI #Reuters #ข่าวAI #TechNews #นวัตกรรม #ดิจิทัล';
  }
  return out;
}

async function formatX(ollamaChat, cleanOutput, master, url) {
  let out = await ollamaChat(`${STYLE}

เขียน Twitter/X thread 3 ทวีต จากบทความข่าวนี้:
───
${master}
───

รูปแบบ — คั่นแต่ละทวีตด้วยบรรทัด ---

ทวีต 1: hook + ประเด็นหลัก ไม่มี link (ไม่เกิน 250 ตัวอักษร)
ทวีต 2: ขยายรายละเอียดหรือผลกระทบ (ไม่เกิน 250 ตัวอักษร)
ทวีต 3: สรุป + reaction ของน้ำข้าว + link: ${url}
hashtag ทวีต 3: #AIข่าว #เทคโนโลยีAI

ตอบเฉพาะ thread เท่านั้น`);
  out = cleanOutput(out);
  if (!out.includes('---')) {
    const parts = out.split(/\n\n+/).filter(p => p.trim());
    if (parts.length >= 2) out = parts.slice(0, 3).join('\n\n---\n\n');
  }
  if (!out.includes(url)) out += `\n\n---\n\n🔗 ${url}\n#AIข่าว #เทคโนโลยีAI`;
  return out;
}

async function formatTikTok(ollamaChat, cleanOutput, master) {
  const out = await ollamaChat(`${STYLE}

เขียน TikTok script จากบทความข่าวนี้:
───
${master}
───

รูปแบบที่ต้องการ:

## Script (30 วินาที)
| เวลา | VOICEOVER | VISUAL | ON-SCREEN TEXT |
|------|-----------|--------|----------------|
| 0:00-0:05 | [น้ำข้าวพูดเปิด] | [ฉากเปิด] | [ข้อความ] |
| 0:05-0:15 | [เล่าประเด็นหลัก] | [ภาพประกอบ] | [ข้อเท็จจริง] |
| 0:15-0:25 | [ขยายผลกระทบ] | [ภาพประกอบ] | [ข้อมูล] |
| 0:25-0:30 | [น้ำข้าวปิด + CTA] | [ฉากปิด] | [hashtag] |

## Caption (50-80 คำ)
[เขียน caption สไตล์น้ำข้าว]

## Hashtag
#AIข่าว #เทคโนโลยีAI #ข่าวAI [+ 4-6 hashtag เฉพาะข่าว]

ตอบตามรูปแบบนี้เท่านั้น`);
  return cleanOutput(out);
}

module.exports = { formatFacebook, formatInstagram, formatX, formatTikTok };
