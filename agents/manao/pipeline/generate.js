/**
 * generate.js — AI News Content Generator (Thai)
 *
 * ใช้ Ollama สร้าง content ภาษาไทยสำหรับ Facebook และ Instagram
 *
 * ใช้งาน:
 *   node generate.js                        ← สร้างทุกข่าวที่ยังไม่มี content
 *   node generate.js {slug}                 ← สร้างเฉพาะ news_id นั้น
 *   node generate.js --date 2026-05-27      ← สร้างเฉพาะข่าวของวันนั้น
 *   node generate.js --force                ← สร้างใหม่ทุกข่าว (แม้มี content แล้ว)
 *   node generate.js {slug} --force        ← สร้างใหม่เฉพาะข่าวนั้น
 *   node generate.js --resend              ← ส่ง Telegram ซ้ำให้ข่าวที่ pending_approval/draft
 *   node generate.js --resend --date 2026-05-28 ← resend เฉพาะวันนั้น
 */

require('dotenv').config();
const http   = require('http');
const https  = require('https');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// queue file สำหรับ map shortId → slug (Telegram callback_data จำกัด 64 bytes)
const PIPELINE_ROOT = process.env.PIPELINE_ROOT || __dirname;
const TG_QUEUE_FILE = path.join(PIPELINE_ROOT, '_tg_queue.json');
function loadQueue() {
  try { return JSON.parse(fs.readFileSync(TG_QUEUE_FILE, 'utf8')); } catch { return {}; }
}
function saveQueue(q) {
  fs.writeFileSync(TG_QUEUE_FILE, JSON.stringify(q, null, 2), 'utf8');
}
function makeShortId(slug) {
  return crypto.createHash('md5').update(slug).digest('hex').substring(0, 12);
}

// ─── Telegram helper (ส่งขอ approve หลังสร้าง content) ──────────────────────
const TG_TOKEN   = (process.env.MANAO_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').replace(/"/g, '').trim();
const TG_CHAT_ID = (process.env.TELEGRAM_CHAT_ID   || '').replace(/"/g, '').trim();
const TG_ENABLED = !!(TG_TOKEN && TG_CHAT_ID);

function tgRequest(method, body) {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TG_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) },
      // บางเครือข่าย (เช่น proxy ของมหาวิทยาลัย) ทำ SSL inspection
      // ทำให้ certificate ของ api.telegram.org ไม่ตรง → ต้อง bypass TLS check
      rejectUnauthorized: false,
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error(buf)); } });
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Telegram timeout')); });
    req.on('error', reject);
    req.write(json);
    req.end();
  });
}

function escapeHtml(t = '') {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ส่งรูปภาพพร้อม caption + inline keyboard ผ่าน Telegram sendPhoto (multipart/form-data)
function sendTelegramPhoto(chatId, imagePath, caption, keyboard) {
  return new Promise((resolve, reject) => {
    const imageData = fs.readFileSync(imagePath);
    const boundary  = `----TGBoundary${Date.now()}`;

    const fieldPart = (name, value) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}`;

    const preamble = [
      fieldPart('chat_id',      chatId),
      fieldPart('caption',      caption),
      fieldPart('parse_mode',   'HTML'),
      fieldPart('reply_markup', JSON.stringify(keyboard)),
    ].join('\r\n') + '\r\n';

    const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="image.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`;
    const epilogue   = `\r\n--${boundary}--\r\n`;

    const bodyBuf = Buffer.concat([
      Buffer.from(preamble,    'utf8'),
      Buffer.from(fileHeader,  'utf8'),
      imageData,
      Buffer.from(epilogue,    'utf8'),
    ]);

    const req = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${TG_TOKEN}/sendPhoto`,
      method:   'POST',
      headers: {
        'Content-Type':   `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuf.length,
      },
      rejectUnauthorized: false,
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error(buf)); } });
    });
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Telegram photo timeout')); });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

async function sendTelegramApproval(slug, data, fbContent) {
  if (!TG_ENABLED) return false;
  const title   = escapeHtml(data.title || slug);
  const date    = (data.published_at || '').substring(0, 10);
  const preview = escapeHtml(fbContent.substring(0, 800)) + (fbContent.length > 800 ? '...' : '');

  // ใช้ short ID เพราะ Telegram จำกัด callback_data ไม่เกิน 64 bytes
  const shortId = makeShortId(slug);
  const queue = loadQueue();
  queue[shortId] = { slug, platform: 'fb' };   // ← โพสต์เฉพาะ FB (schedule); IG ข้าม
  saveQueue(queue);

  const keyboard = {
    inline_keyboard: [[
      { text: '✅ อนุมัติ',   callback_data: `approve:${shortId}` },
      { text: '🔄 สร้างใหม่', callback_data: `regen:${shortId}`   },
    ]],
  };

  const msgLines = [
    `📰 <b>รอ Approve</b>`,
    `─────────────────────────`,
    `🗞 ${title}`,
    `📅 ${date}`,
    ``,
    `📱 <b>Facebook + Instagram:</b>`,
    preview,
    `─────────────────────────`,
  ].join('\n');

  // ─── ส่งพร้อมรูปถ้ามี image.jpg ──────────────────────────────────────────
  const imagePath = path.join(NEWS_DIR, slug, 'image.jpg');
  if (fs.existsSync(imagePath)) {
    try {
      const res = await sendTelegramPhoto(TG_CHAT_ID, imagePath, msgLines, keyboard);
      if (res.ok) { console.log(`  📨 ส่ง Telegram ขอ approve (พร้อมรูป) แล้ว`); return true; }
      console.error(`  ⚠️  Telegram sendPhoto ไม่สำเร็จ:`, res.description, '— fallback ส่ง text');
    } catch (e) {
      console.error(`  ⚠️  Telegram sendPhoto error:`, e.message, '— fallback ส่ง text');
    }
  }

  // ─── fallback: ส่งแบบ text ────────────────────────────────────────────────
  try {
    const res = await tgRequest('sendMessage', { chat_id: TG_CHAT_ID, text: msgLines, parse_mode: 'HTML', reply_markup: keyboard });
    if (res.ok) { console.log(`  📨 ส่ง Telegram ขอ approve แล้ว`); return true; }
    console.error(`  ⚠️  Telegram ส่งไม่สำเร็จ:`, res.description);
    return false;
  } catch (e) {
    console.error(`  ⚠️  Telegram error:`, e.message);
    return false;
  }
}

const NEWS_DIR   = path.join(PIPELINE_ROOT, 'news');
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://10.3.17.118:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:latest';

const args    = process.argv.slice(2);
const slugArg = args.find(a => !a.startsWith('--'));
const dateIdx = args.findIndex(a => a === '--date');
const dateArg = dateIdx !== -1 ? args[dateIdx + 1] : null;
const force      = args.includes('--force');
const resend     = args.includes('--resend');      // ส่ง Telegram ซ้ำโดยไม่ regenerate
const noTelegram = args.includes('--no-telegram'); // สร้าง content + รูป แต่ไม่ส่ง Telegram

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getPendingItems() {
  if (!fs.existsSync(NEWS_DIR)) return [];

  const dirs = fs.readdirSync(NEWS_DIR)
    .filter(d => fs.existsSync(path.join(NEWS_DIR, d, 'data.json')));

  return dirs
    .map(slug => {
      const data = JSON.parse(fs.readFileSync(path.join(NEWS_DIR, slug, 'data.json'), 'utf8'));
      const contentDir = path.join(NEWS_DIR, slug, 'content');
      const hasFB = fs.existsSync(path.join(contentDir, 'facebook.md'));
      return { slug, data, hasFB };
    })
    .filter(({ slug, data, hasFB }) => {
      // ── resend mode: ส่ง Telegram ซ้ำให้ข่าวที่มี content แต่ยังไม่ approve ────
      if (resend) {
        if (!hasFB) return false;                                              // ยังไม่มี content ข้าม
        if (data.status !== 'pending_approval' && data.status !== 'draft') return false; // ข้าม posted/scheduled
        // ข้ามถ้าส่ง Telegram ไปล่าสุดไม่นานมานี้ (< 5 นาที) เพื่อป้องกันส่งซ้ำในรอบ pipeline เดียวกัน
        if (data.pending_since) {
          const ageMin = (Date.now() - new Date(data.pending_since).getTime()) / 60000;
          if (ageMin < 5) return false;
        }
        if (slugArg && slug !== slugArg) return false;
        if (dateArg) {
          const pubDate = (data.published_at || data.scraped_at || '').substring(0, 10);
          if (pubDate !== dateArg) return false;
        }
        return true;
      }
      // ── generate mode (ปกติ) ──────────────────────────────────────────────────
      if (hasFB && !force) return false;            // ข้ามถ้ามี content แล้ว (ยกเว้น --force)
      if (data.status === 'posted') return false;                          // ไม่แตะข่าวที่โพสต์แล้ว เด็ดขาด
      if (data.status === 'scheduled' && !noTelegram) return false;       // pipeline ปกติข้าม scheduled; --no-telegram (dashboard) อนุญาต
      if (slugArg && slug !== slugArg) return false;
      if (dateArg) {
        const pubDate = (data.published_at || data.scraped_at || '').substring(0, 10);
        if (pubDate !== dateArg) return false;
      }
      return true;
    });
}

function ollamaChat(prompt) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/chat', OLLAMA_HOST);
    const body = JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    });

    const options = {
      hostname: url.hostname,
      port: url.port || 11434,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };

    const req = http.request(options, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          if (j.error) return reject(new Error('Ollama error: ' + j.error));
          resolve(j.message?.content || j.response || '');
        } catch {
          reject(new Error('Ollama response parse error: ' + buf.substring(0, 200)));
        }
      });
    });

    req.on('error', e => reject(new Error('Ollama connection error: ' + e.message)));
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Ollama timeout (120s)')); });
    req.write(body);
    req.end();
  });
}

function buildNewsContext(data) {
  return `ข่าวต้นฉบับ (Reuters):
หัวข้อ: ${data.title}
วันที่: ${data.published_at?.substring(0, 10)}
เนื้อหา: ${data.body || '(ไม่มีเนื้อหาเพิ่มเติม สรุปจากหัวข้อได้เลย)'}`;
}

// ─── สำนวน "น้ำข้าว" ──────────────────────────────────────────────────────
// ผู้รายงานข่าว AI สไตล์: อบอุ่น เป็นกันเอง พูดตรง ข้อมูลแน่น
// ใช้ "นะคะ" "ค่ะ" เป็นธรรมชาติ ไม่แข็ง / เล่าเหมือนพูดกับเพื่อน
// มี personal reaction เล็กน้อย ("น่าสนใจมากเลยค่ะ" "อันนี้สำคัญนะคะ")
// ประโยคกระชับ ฟังแล้วเห็นภาพ ไม่ใช้ศัพท์เทคนิคโดยไม่อธิบาย
// ────────────────────────────────────────────────────────────────────────────

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

// กรองอักษรจีน/ญี่ปุ่น/เกาหลี ที่ qwen model อาจแทรกมา
function stripCJK(text) {
  return text.split('\n').filter(line => {
    const cjkCount = (line.match(/[一-鿿㐀-䶿　-〿＀-￯぀-ゟ゠-ヿ가-힯]/g) || []).length;
    return cjkCount <= 3;
  }).join('\n');
}

// ลบ header ภาษาอังกฤษที่ model สร้างเอง เช่น "NIGHTLY NEWS FROM..." "MACHINE TRANSLATION:"
// บรรทัดที่ไม่มีอักษรไทยเลย และมีลักษณะเป็น header (uppercase, มีคำว่า NEWS/REPORTER/TRANSLATION)
function stripEnglishHeaders(text) {
  const headerPattern = /^[A-Z\s"':()\-_!?.]+$|NIGHTLY|BREAKING|MACHINE\s+TRANSLATION|AI\s+REPORTER|NUALKHAI|QWEN|BY\s+[A-Z]/i;
  return text.split('\n').filter(line => {
    const hasThai = /[฀-๿]/.test(line);
    if (hasThai) return true;                    // มีภาษาไทย → เก็บไว้
    if (!line.trim()) return true;               // บรรทัดว่าง → เก็บไว้
    if (headerPattern.test(line.trim())) return false; // header อังกฤษ → ลบทิ้ง
    return true;
  }).join('\n');
}

function cleanFacebook(text, url) {
  let t = stripEnglishHeaders(stripCJK(text)).trim();

  // ลบบรรทัดที่เป็นแค่ --- (ทั้งหมด ไม่ว่าจะอยู่ตรงไหน)
  t = t.replace(/^-{3,}\s*$/gm, '').trim();

  // ลบ [label] นำหน้าบรรทัด เช่น "[hook]" "[ย่อหน้า 1]"
  t = t.replace(/^\[[^\]]+\]\s*/gm, '').trim();
  // ลบ label นำหน้าบรรทัด (ASCII, ไทย, markdown bold) เช่น "hook:" "QUESTION:" "คำถามที่ชวนคิด:" "**hook:**"
  t = t.replace(/^\*{0,2}[\w฀-๿-]+\*{0,2}:\s*/gm, '').trim();
  // ลบ "หมายเหตุ" และ "Note" ท้ายโพสต์
  t = t.replace(/\n\*?หมายเหตุ[^]*$/m, '').trim();
  t = t.replace(/\n\*?Note:[^]*$/im, '').trim();
  t = t.replace(/\n\*หมายเหตุ[^]*$/m, '').trim();
  t = t.replace(/\n\*Note:[^]*$/im, '').trim();

  // ตัดบรรทัดว่างซ้อนกันเกิน 2 บรรทัด
  t = t.replace(/\n{3,}/g, '\n\n').trim();

  // ตรวจ link และ hashtag
  if (!t.includes(url)) t += `\n\n🔗 อ่านเพิ่มเติม: ${url}`;
  if (!t.includes('#AIข่าว')) t += '\n#AIข่าว #เทคโนโลยีAI #ข่าวAI';
  return t.trim();
}

function cleanInstagram(text) {
  let t = stripEnglishHeaders(stripCJK(text)).trim();
  // ลบบรรทัดที่เป็นแค่ --- (ทั้งหมด)
  t = t.replace(/^-{3,}\s*$/gm, '').trim();
  // ลบ [label] นำหน้าบรรทัด เช่น "[คำถามที่ชวนคิด]" "[ข้อเท็จจริงฉับพลัน]"
  t = t.replace(/^\[[^\]]+\]\s*/gm, '').trim();
  // ลบ label นำหน้าบรรทัด (ASCII, ไทย, markdown bold) เช่น "HOOK:" "QUESTION:" "คำถามที่ชวนคิด:"
  t = t.replace(/^\*{0,2}[\w฀-๿-]+\*{0,2}:\s*/gm, '').trim();
  // กรอง hashtag ให้เป็นภาษาไทย/อังกฤษที่ถูกต้อง (ลบช่องว่างใน hashtag)
  t = t.replace(/# ([^\s#]+)/g, '#$1');
  // เพิ่ม hashtag ถ้ายังมีน้อยกว่า 10
  const count = (t.match(/#\S+/g) || []).length;
  if (count < 10) {
    t += '\n\n#AIข่าว #ข่าวเทคโนโลยี #เทคโนโลยี #ArtificialIntelligence #AI #MachineLearning #GenAI #Reuters #ข่าวAI #TechNews #นวัตกรรม #ดิจิทัล';
  }
  return t.trim();
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

(async function main() {
  // ── resend mode: ไม่ต้องใช้ Ollama ─────────────────────────────────────────
  if (resend) {
    if (!TG_ENABLED) {
      console.error('❌ ต้องตั้งค่า TELEGRAM_BOT_TOKEN และ TELEGRAM_CHAT_ID ใน .env ก่อน');
      process.exit(1);
    }
    console.log('\n📨 Resend mode — ส่ง Telegram ซ้ำสำหรับข่าวที่ยังไม่ approve\n');
    const pending = getPendingItems();
    if (!pending.length) {
      console.log('✅ ไม่มีข่าว pending_approval/draft ที่ต้องส่งซ้ำ');
      process.exit(0);
    }
    console.log(`📋 พบ ${pending.length} รายการที่ยังรอ approve:\n`);
    let sentCount = 0;
    for (const { slug, data } of pending) {
      const fbPath = path.join(NEWS_DIR, slug, 'content', 'facebook.md');
      const fbContent = fs.readFileSync(fbPath, 'utf8');
      const hasImage = fs.existsSync(path.join(NEWS_DIR, slug, 'image.jpg'));
      console.log(`  📰 ${data.title?.substring(0, 60)}${hasImage ? ' 🖼' : ''}`);
      const sent = await sendTelegramApproval(slug, data, fbContent);
      if (sent) {
        data.status = 'pending_approval';
        data.pending_since = new Date().toISOString(); // อัปเดตเวลาส่ง เพื่อป้องกันส่งซ้ำ
        fs.writeFileSync(path.join(NEWS_DIR, slug, 'data.json'), JSON.stringify(data, null, 2), 'utf8');
        sentCount++;
      }
      await sleep(500);
    }
    console.log(`\n✅ ส่ง Telegram สำเร็จ ${sentCount}/${pending.length} รายการ`);
    process.exit(0);
  }

  // ── generate mode ────────────────────────────────────────────────────────────
  console.log(`\n🤖 AI News Content Generator (Ollama: ${OLLAMA_MODEL})\n`);

  // ตรวจสอบว่า Ollama พร้อมใช้
  try {
    await new Promise((resolve, reject) => {
      const url = new URL('/api/tags', OLLAMA_HOST);
      http.get({ hostname: url.hostname, port: url.port || 11434, path: url.pathname }, res => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => {
          try {
            const j = JSON.parse(buf);
            const models = (j.models || []).map(m => m.name);
            if (!models.some(m => m.startsWith(OLLAMA_MODEL.split(':')[0]))) {
              console.error(`❌ ไม่พบ model "${OLLAMA_MODEL}" ใน Ollama`);
              console.error(`   models ที่มี: ${models.join(', ') || '(ไม่มี)'}`);
              console.error(`   รัน: ollama pull ${OLLAMA_MODEL}`);
              process.exit(1);
            }
            resolve();
          } catch { reject(new Error('parse error')); }
        });
      }).on('error', reject);
    });
    console.log(`✅ Ollama พร้อมใช้ที่ ${OLLAMA_HOST}\n`);
  } catch (e) {
    console.error(`❌ เชื่อมต่อ Ollama ไม่ได้: ${OLLAMA_HOST}`);
    console.error(`   ${e.message}`);
    process.exit(1);
  }

  if (force) console.log('⚠️  --force mode: สร้าง content ใหม่ทับของเดิม\n');

  const pending = getPendingItems();

  if (!pending.length) {
    const msg = force
      ? '✅ ไม่มีข่าวที่ต้องสร้างใหม่ (ข่าวที่ status=posted ไม่แตะ)'
      : '✅ content ครบทุกข่าวแล้ว ใช้ --force เพื่อสร้างใหม่';
    console.log(msg);
    process.exit(0);
  }

  console.log(`📋 ข่าวที่ต้องสร้าง content: ${pending.length} รายการ\n`);
  pending.forEach(({ slug, data }) => {
    console.log(`  • ${data.published_at?.substring(0, 10) || '?'} | ${data.title?.substring(0, 60)}`);
  });
  console.log('');

  for (const { slug, data } of pending) {
    console.log(`\n[${slug}]`);
    console.log(`📰 ${data.title}`);

    process.stdout.write('  🤖 กำลังสร้าง content ภาษาไทย...');
    const content = await generateContent(data);
    process.stdout.write(' ✓\n');

    const contentDir = path.join(NEWS_DIR, slug, 'content');
    fs.mkdirSync(contentDir, { recursive: true });

    fs.writeFileSync(path.join(contentDir, 'facebook.md'),  content.facebook,  'utf8');
    fs.writeFileSync(path.join(contentDir, 'instagram.md'), content.instagram, 'utf8');

    // ─── Generate รูปผ่าน ComfyUI (ก่อนส่ง Telegram เพื่อแนบรูปใน approve message) ────
    process.stdout.write('  🎨 กำลัง Generate รูปผ่าน ComfyUI...');
    try {
      const { generateNewsImage } = require('./comfy-gen');
      await generateNewsImage(slug, data.title || slug);
      process.stdout.write(' ✓\n');
    } catch (e) {
      process.stdout.write(` ⚠️ ข้าม (${e.message.substring(0, 80)})\n`);
    }

    // ส่ง Telegram ขอ approve (ถ้า configured และไม่ได้ใช้ --no-telegram)
    const sent = noTelegram ? false : await sendTelegramApproval(slug, data, content.facebook);
    if (noTelegram) console.log('  ⏭️  ข้ามการส่ง Telegram (--no-telegram)');

    // อัปเดต status
    if (data.status !== 'posted') {
      data.status = sent ? 'pending_approval' : 'draft';
      if (sent) data.pending_since = new Date().toISOString(); // บันทึกเวลาส่ง Telegram
    }
    fs.writeFileSync(path.join(NEWS_DIR, slug, 'data.json'), JSON.stringify(data, null, 2), 'utf8');

    const statusLabel = sent ? '📨 รอ approve ใน Telegram' : '📝 draft';
    console.log(`  ✅ บันทึกแล้ว: news/${slug}/content/ [${statusLabel}]`);

    await sleep(1000); // rate limit buffer
  }

  console.log('\n' + '═'.repeat(55));
  console.log(`✅ สร้าง content เสร็จ: ${pending.length} ข่าว`);
  console.log('📁 ดู draft ได้ที่ news/{slug}/content/');
  console.log('⚠️  กรุณาตรวจสอบก่อนโพสต์');
})();
