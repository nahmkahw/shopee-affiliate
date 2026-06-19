#!/usr/bin/env node
/**
 * formatter-agent.js — Agent 4: สร้าง content ต่อ platform
 *
 * ทำงาน: อ่าน content/master.md → สร้าง facebook.md, instagram.md, x.md, tiktok.md
 * รัน:   node agents/formatter-agent.js [--platform fb,ig,x,tiktok] [--date YYYY-MM-DD] [--force]
 *
 * น้ำข้าว style ถูกใส่ที่นี่ — formatter รับข้อเท็จจริงจาก master.md
 * แล้วปรับเป็น content สไตล์น้ำข้าวตาม format ของแต่ละ platform
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { ollamaChat, checkOllama } = require('./ollama');

const PIPELINE_ROOT = process.env.PIPELINE_ROOT || path.join(__dirname, '..');
const { loadConfig } = require(path.join(PIPELINE_ROOT, 'config'));

const http = require('http');

// โหลดค่าตั้งจาก config.json (แก้ค่าได้ที่ pipeline/config.json)
const _cfg        = loadConfig();
const FMT_CFG     = _cfg.formatter;
const COMFY_CFG   = _cfg.comfyui || {};
const SKIP_STATUS = FMT_CFG.skipStatus || ['posted'];   // สถานะที่ข้าม
const FMT_MIN_SCORE = FMT_CFG.minScore || 0;            // ข้ามข่าว filter_score < ค่านี้ (0 = ไม่กรอง)
const SKIP_PLATFORMS = (FMT_CFG.skipPlatforms || []).map(s => String(s).trim().toLowerCase()); // platform ที่ไม่สร้าง

const NEWS_DIR = path.join(PIPELINE_ROOT, 'news');
const https    = require('https');
const args     = process.argv.slice(2);
const force    = args.includes('--force');
const dateIdx  = args.findIndex(a => a === '--date');
const dateArg  = dateIdx !== -1 ? args[dateIdx + 1] : null;
const slugArg  = args.find(a => !a.startsWith('--') && !/^\d{4}-\d{2}-\d{2}$/.test(a));
const platIdx  = args.findIndex(a => a === '--platform');
const platArg  = platIdx !== -1 ? args[platIdx + 1] : null;
const PLATFORMS = (platArg
  ? platArg.split(',').map(s => s.trim().toLowerCase())
  : ['fb', 'ig', 'x', 'tiktok'])
  // ตัด platform ที่ตั้งให้ข้ามใน config (ยกเว้นระบุ --platform มาเองตรงๆ)
  .filter(p => platArg || !SKIP_PLATFORMS.includes(p));

const PLATFORM_FILE = { fb: 'facebook.md', ig: 'instagram.md', x: 'x.md', tiktok: 'tiktok.md' };
const RETRY_LIMIT   = 3;   // สร้างซ้ำสูงสุดกี่ครั้งเมื่อ validate ไม่ผ่าน

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── ComfyUI image generation ─────────────────────────────────────────────────

const NEG_PROMPT = 'lowres, bad anatomy, text, watermark, signature, blurry, nsfw';

function _comfyPost(path_, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: COMFY_CFG.host || '10.3.17.118', port: COMFY_CFG.port || 8188,
      path: path_, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => { let out = ''; res.on('data', d => out += d); res.on('end', () => { try { resolve(JSON.parse(out)); } catch(e) { reject(e); } }); });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('comfy timeout')); });
    req.on('error', reject); req.write(data); req.end();
  });
}

function _comfyGet(path_) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: COMFY_CFG.host || '10.3.17.118', port: COMFY_CFG.port || 8188, path: path_ },
      res => { let out = ''; res.on('data', d => out += d); res.on('end', () => { try { resolve(JSON.parse(out)); } catch(e) { reject(e); } }); });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('comfy timeout')); });
    req.on('error', reject);
  });
}

function _comfyGetBinary(path_) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: COMFY_CFG.host || '10.3.17.118', port: COMFY_CFG.port || 8188, path: path_ },
      res => { const chunks = []; res.on('data', d => chunks.push(d)); res.on('end', () => resolve(Buffer.concat(chunks))); });
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('comfy binary timeout')); });
    req.on('error', reject);
  });
}

async function generateNewsImage(slug, title) {
  if (!COMFY_CFG.enabled) return false;

  const prompt = `news illustration, technology concept, artificial intelligence, futuristic digital world, glowing circuit, modern, clean, professional, photorealistic, ${title.substring(0, 80)}`;
  const seed = Math.floor(Math.random() * 99999999999);
  const clientId = crypto.randomUUID();
  const workflow = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'AnythingXL_xl.safetensors' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: prompt } },
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: NEG_PROMPT } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '5': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0], seed, steps: 20, cfg: 7, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1 } },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'news' } },
  };

  const { prompt_id } = await _comfyPost('/prompt', { client_id: clientId, prompt: workflow });
  if (!prompt_id) throw new Error('no prompt_id from ComfyUI');

  // poll ผล
  const timeout = COMFY_CFG.timeoutMs || 120000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await sleep(3000);
    const history = await _comfyGet('/history/' + prompt_id);
    const job = history[prompt_id];
    if (!job) continue;
    if (job.status?.status_str === 'error') throw new Error('ComfyUI job error');
    const img = job.outputs?.['7']?.images?.[0];
    if (!img) continue;
    // ดาวน์โหลดรูป
    const buf = await _comfyGetBinary(`/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder||'')}&type=${encodeURIComponent(img.type||'output')}`);
    fs.writeFileSync(imagePath, buf);
    return true;
  }
  throw new Error('ComfyUI timeout');
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/**
 * ตรวจหาตัวอักษรเสีย / encoding เพี้ยน
 * เช่น "ฝรั่งเ็ส" → sara-e (เ) ตามด้วย mai-taikhu (็) ที่ไม่ควรอยู่ตรงนั้น
 */
function hasGarbledChars(text) {
  // Thai leading vowels (เ แ โ ใ ไ) ตามด้วย combining marks ที่ควรอยู่หลังพยัญชนะ
  if (/[เแโใไ][็่้๊๋ัิีึืุู]/.test(text)) return true;
  // tone marks หรือ sara ซ้ำกัน
  if (/[็่้๊๋]{2,}/.test(text)) return true;
  // อักษร CJK แอบอยู่
  if (/[一-鿿぀-ヿ가-힯]/.test(text)) return true;
  return false;
}

/**
 * วัดความยาวเนื้อหา (ตัด hashtag + URL ออกก่อน)
 * ภาษาไทยไม่เว้นวรรคระหว่างคำ → นับด้วย split(/\s+/) จะได้น้อยผิดปกติ
 * จึงนับ "จำนวนตัวอักษรที่ไม่ใช่ช่องว่าง" แทน (เหมาะกับทั้งไทยและอังกฤษ)
 */
function contentLength(text) {
  return text
    .replace(/#\S+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, '')
    .length;
}

/**
 * ดึง "anchor" ที่ข้ามภาษาได้ = Latin tokens (ชื่อเฉพาะ/acronym เช่น AI, Claude, Anthropic)
 * + ตัวเลข (ปี/จำนวน) — ใช้เช็คว่า content (ไทย) อ้างถึงเรื่องเดียวกับต้นฉบับ
 */
function extractAnchors(text) {
  const latin = (text.match(/[A-Za-z][A-Za-z.\-]{1,}/g) || []).map(s => s.toLowerCase());
  const nums  = (text.match(/\d{2,}/g) || []);
  return new Set([...latin, ...nums].filter(Boolean));
}

/**
 * ตรวจ content สำหรับแต่ละ platform
 * คืน array ของ error strings (ว่าง = ผ่าน)
 * @param master บทความต้นฉบับ (ไทย) — ใช้หา anchor สำหรับ fact-check
 */
function validateContent(content, platform, data, master = '') {
  const errors = [];

  // 1. ตัวอักษรเสีย
  if (hasGarbledChars(content)) {
    errors.push('ตัวอักษรเสีย/encoding เพี้ยน');
  }

  // 2. content สั้น/ว่างผิดปกติ
  if (content.trim().length < 50) {
    errors.push(`content สั้นเกินไป (${content.trim().length} chars)`);
  }

  // 3. เริ่มต้นด้วย ---  หรือ hashtag หรือ URL (เริ่มแบบตัดกลาง)
  if (/^(---|#[^\s]|https?:\/\/)/.test(content.trim())) {
    errors.push('เริ่มต้นผิดปกติ (---, hashtag, หรือ URL)');
  }

  // 4. ตรวจความยาว / format ตาม platform (นับเป็นตัวอักษร — รองรับภาษาไทย)
  const len = contentLength(content);
  if (platform === 'fb') {
    if (len < 350)  errors.push(`Facebook สั้นเกิน (${len} ตัวอักษร, ต้องการ 350-3500)`);
    if (len > 3500) errors.push(`Facebook ยาวเกิน (${len} ตัวอักษร)`);
  } else if (platform === 'ig') {
    const htCount = (content.match(/#\S+/g) || []).length;
    if (len < 200)     errors.push(`Instagram สั้นเกิน (${len} ตัวอักษร, ต้องการ 200+)`);
    if (htCount < 10)  errors.push(`hashtag น้อยเกิน (${htCount} อัน, ต้องการ 15-20)`);
  } else if (platform === 'x') {
    if (!content.includes('---')) errors.push('X thread ไม่มีตัวคั่น (---)');
  }

  // 5. fact-check: content (ไทย) ต้องอ้างถึง entity/ตัวเลขจากต้นฉบับอย่างน้อย 1
  //    title เป็นอังกฤษ แต่ content แปลเป็นไทย → เทียบคำอังกฤษตรงๆ ไม่ได้
  //    ใช้ anchor ที่ข้ามภาษาได้ (ชื่อเฉพาะ/acronym/ตัวเลข) จาก master + title
  const anchors = new Set([
    ...extractAnchors(master || ''),
    ...extractAnchors(data.title || ''),
  ]);
  if (anchors.size > 0) {
    const lc = content.toLowerCase();
    const found = [...anchors].some(a => lc.includes(a));
    if (!found) errors.push('ไม่พบ entity/ตัวเลขจากข่าวต้นฉบับในเนื้อหา');
  }

  return errors;
}

// ─── Telegram Approval Notification ─────────────────────────────────────────

/**
 * ส่ง preview + inline keyboard [✅ อนุมัติ] [❌ ข้าม] ไปยัง Telegram
 * Telegram callback_data จำกัด 64 bytes — truncate slug ให้พอดี
 */
async function sendApprovalNotification(slug, data, master) {
  // แยก token: ส่ง approval ผ่านบอท manao (ตัวเดียวกับ telegram-bot.js ที่ poll)
  const token  = process.env.MANAO_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;   // ไม่มี config → ข้ามเงียบๆ

  // ลงทะเบียน shortId → queue เพื่อให้ telegram-bot.js resolve slug ได้
  const shortId    = crypto.createHash('md5').update(slug).digest('hex').substring(0, 12);
  const queueFile  = path.join(PIPELINE_ROOT, '_tg_queue.json');
  const queue      = (() => { try { return JSON.parse(fs.readFileSync(queueFile, 'utf8')); } catch { return {}; } })();
  queue[shortId]   = { slug, platform: 'fb' };
  try { fs.writeFileSync(queueFile, JSON.stringify(queue, null, 2), 'utf8'); } catch {}

  const title   = (data.title || slug).replace(/[<>&"]/g, '');
  const date    = (data.published_at || '').substring(0, 10);
  const preview = master.substring(0, 280).replace(/[<>&"]/g, '');
  const dots    = master.length > 280 ? '…' : '';

  const text = `📰 <b>ข่าวใหม่รอ Approve</b>\n\n` +
               `<b>${title}</b>\n📅 ${date}\n\n` +
               `<i>${preview}${dots}</i>`;

  const replyMarkup = {
    inline_keyboard: [[
      { text: '✅ อนุมัติ & โพสต์', callback_data: `approve:${shortId}` },
      { text: '🔄 สร้างใหม่',       callback_data: `regen:${shortId}`   },
      { text: '❌ ยกเลิก',           callback_data: `cancel:${shortId}`  },
    ]]
  };

  // ตรวจหารูปภาพ: image.jpg local → og_image URL → ไม่มีรูป (sendMessage)
  const imagePath    = path.join(NEWS_DIR, slug, 'image.jpg');
  const hasLocalImg  = fs.existsSync(imagePath);
  const ogImageUrl   = (data.og_image || '').trim();

  if (hasLocalImg) {
    return _sendPhotoMultipart(token, chatId, imagePath, text, replyMarkup);
  } else if (ogImageUrl) {
    return _sendPhotoUrl(token, chatId, ogImageUrl, text, replyMarkup);
  } else {
    return _sendTextMessage(token, chatId, text, replyMarkup);
  }
}

/** ส่งข้อความปกติ (ไม่มีรูป) */
function _sendTextMessage(token, chatId, text, replyMarkup) {
  const body = JSON.stringify({
    chat_id:      chatId,
    text:         text.substring(0, 4096),
    parse_mode:   'HTML',
    reply_markup: replyMarkup,
  });
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${token}/sendMessage`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => { res.on('data', () => {}); res.on('end', resolve); });
    req.setTimeout(15000, () => { req.destroy(); resolve(); });
    req.on('error', resolve);
    req.write(body); req.end();
  });
}

/** ส่งรูปผ่าน URL (JSON) */
function _sendPhotoUrl(token, chatId, photoUrl, caption, replyMarkup) {
  const body = JSON.stringify({
    chat_id:      chatId,
    photo:        photoUrl,
    caption:      caption.substring(0, 1024),
    parse_mode:   'HTML',
    reply_markup: replyMarkup,
  });
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${token}/sendPhoto`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => { res.on('data', () => {}); res.on('end', resolve); });
    req.setTimeout(15000, () => { req.destroy(); resolve(); });
    req.on('error', resolve);
    req.write(body); req.end();
  });
}

/** ส่งรูป local ผ่าน multipart/form-data */
function _sendPhotoMultipart(token, chatId, imagePath, caption, replyMarkup) {
  const boundary  = '----TGBoundary' + Math.random().toString(36).substring(2);
  const imgBuf    = fs.readFileSync(imagePath);
  const fileName  = path.basename(imagePath);

  // สร้าง text fields
  const fields = [
    ['chat_id',      chatId],
    ['caption',      caption.substring(0, 1024)],
    ['parse_mode',   'HTML'],
    ['reply_markup', JSON.stringify(replyMarkup)],
  ];
  let fieldStr = '';
  for (const [name, value] of fields) {
    fieldStr += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }

  const photoHeader = `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${fileName}"\r\nContent-Type: image/jpeg\r\n\r\n`;
  const photoFooter = `\r\n--${boundary}--\r\n`;

  const headerBuf   = Buffer.from(fieldStr + photoHeader, 'utf8');
  const footerBuf   = Buffer.from(photoFooter, 'utf8');
  const totalLen    = headerBuf.length + imgBuf.length + footerBuf.length;

  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${token}/sendPhoto`,
      method:   'POST',
      headers:  {
        'Content-Type':   `multipart/form-data; boundary=${boundary}`,
        'Content-Length': totalLen,
      },
    }, res => { res.on('data', () => {}); res.on('end', resolve); });
    req.setTimeout(30000, () => { req.destroy(); resolve(); });
    req.on('error', resolve);
    req.write(headerBuf);
    req.write(imgBuf);
    req.write(footerBuf);
    req.end();
  });
}

// สไตล์น้ำข้าว: ใส่ใน formatter ไม่ใช่ editor
const STYLE = `สไตล์การเขียน "น้ำข้าว":
- ภาษาไทยล้วน ห้ามอักษรจีน/ญี่ปุ่น/เกาหลี
- อบอุ่น เป็นกันเอง เหมือนเล่าให้เพื่อนฟัง
- ลงท้าย "นะคะ" หรือ "ค่ะ" เป็นบางประโยคตามธรรมชาติ ไม่ทุกประโยค
- ชื่อเฉพาะ ชื่อยา สารเคมี ให้ใช้ภาษาอังกฤษทั้งคำ ห้ามผสมอักษรไทยกับอังกฤษในคำเดียวกัน เช่น "fentanyl" ไม่ใช่ "ฟentanyl"
- ห้ามแต่งข้อมูลที่ไม่มีในบทความ`;

// ─── แก้ partial transliteration เช่น "ฟentanyl" → "fentanyl" ───────────────
const THAI_ONSET = {
  'ก':'k','ข':'kh','ค':'k','ง':'ng','จ':'j','ช':'ch','ซ':'s',
  'ญ':'y','ด':'d','ต':'t','ถ':'th','ท':'th','น':'n',
  'บ':'b','ป':'p','ผ':'ph','ฝ':'f','พ':'ph','ฟ':'f',
  'ม':'m','ย':'y','ร':'r','ล':'l','ว':'w','ส':'s',
  'ห':'h','ฮ':'h','อ':'',
  'เ':'e','แ':'ae','โ':'o','ใ':'i','ไ':'i',
};

function fixMixedThaiEng(text) {
  // ประมวลผล token ต่อ token เพื่อข้าม #hashtag และ URL
  return text.replace(/(\S+)/g, token => {
    if (token.startsWith('#') || token.startsWith('http')) return token;

    let t = token;

    // Step 1: Thai + uppercase English (3+ chars) → เพิ่ม space
    // "ประเทศSingapore" → "ประเทศ Singapore", "ที่Vatican" → "ที่ Vatican"
    t = t.replace(/([฀-๿]+)([A-Z][a-zA-Z]{2,})/g, '$1 $2');

    // Step 2: Thai 1 ตัว + lowercase English → phoneme reconstruction หรือ space
    // สำหรับ fresh LLM output: "ฟentanyl" → "fentanyl", "บattlefield" → "battlefield"
    // สระ/ตัวสะกดที่ไม่มี phoneme: "เราdream" → า+dream → "เรา dream"
    // dedup: "ดdigital" → "digital"
    t = t.replace(/([฀-๿])([a-z][a-zA-Z]{2,})/g, (_, thaiChar, engPart) => {
      const phoneme = THAI_ONSET[thaiChar] ?? '';
      if (!phoneme) return thaiChar + ' ' + engPart;
      if (engPart[0] === phoneme[0]) return engPart;
      return phoneme + engPart;
    });

    // Step 3: หลัง reconstruction Thai ยังติดกับ English → เพิ่ม space
    // "ขโมยfentanyl" → "ขโมย fentanyl" (จาก ขโมยฟentanyl ที่ถูก Step 2 แปลงแล้ว)
    t = t.replace(/([฀-๿])([a-zA-Z]{2,})/g, '$1 $2');

    return t;
  });
}

function cleanOutput(text) {
  return fixMixedThaiEng(
    text
      .split('\n')
      .filter(line => {
        const cjk = (line.match(/[一-鿿぀-ヿ가-힯]/g) || []).length;
        return cjk <= 2;
      })
      .join('\n')
      .replace(/^\[[^\]]+\]\s*/gm, '')
      .replace(/^\*{0,2}[\w฀-๿]+\*{0,2}:\s*/gm, '')
      .replace(/^-{3,}\s*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

// ─── Facebook ─────────────────────────────────────────────────────────────────

async function formatFacebook(master, url) {
  const prompt = `${STYLE}

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
ตอบเฉพาะ post เท่านั้น ไม่ต้องมีคำอธิบาย`;

  let out = await ollamaChat(prompt);
  out = cleanOutput(out);
  if (!out.includes(url))       out += `\n\n🔗 อ่านเพิ่มเติม: ${url}`;
  if (!out.includes('#AIข่าว')) out += '\n#AIข่าว #เทคโนโลยีAI #ข่าวAI';
  return out;
}

// ─── Instagram ────────────────────────────────────────────────────────────────

async function formatInstagram(master) {
  const prompt = `${STYLE}

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
ตอบเฉพาะ caption เท่านั้น`;

  let out = await ollamaChat(prompt);
  out = cleanOutput(out);
  // fix space in hashtag
  out = out.replace(/# ([^\s#]+)/g, '#$1');
  const count = (out.match(/#\S+/g) || []).length;
  if (count < 10) {
    out += '\n\n#AIข่าว #ข่าวเทคโนโลยี #เทคโนโลยี #ArtificialIntelligence #AI #MachineLearning #GenAI #Reuters #ข่าวAI #TechNews #นวัตกรรม #ดิจิทัล';
  }
  return out;
}

// ─── X (Twitter) ──────────────────────────────────────────────────────────────

async function formatX(master, url) {
  const prompt = `${STYLE}

เขียน Twitter/X thread 3 ทวีต จากบทความข่าวนี้:
───
${master}
───

รูปแบบ — คั่นแต่ละทวีตด้วยบรรทัด ---

ทวีต 1: hook + ประเด็นหลัก ไม่มี link (ไม่เกิน 250 ตัวอักษร)
ทวีต 2: ขยายรายละเอียดหรือผลกระทบ (ไม่เกิน 250 ตัวอักษร)
ทวีต 3: สรุป + reaction ของน้ำข้าว + link: ${url}
hashtag ทวีต 3: #AIข่าว #เทคโนโลยีAI

ตอบเฉพาะ thread เท่านั้น`;

  let out = await ollamaChat(prompt);
  out = cleanOutput(out);

  // ตรวจว่ามีตัวคั่น ---
  if (!out.includes('---')) {
    const parts = out.split(/\n\n+/).filter(p => p.trim());
    if (parts.length >= 2) {
      out = parts.slice(0, 3).join('\n\n---\n\n');
    }
  }
  if (!out.includes(url)) {
    out += `\n\n---\n\n🔗 ${url}\n#AIข่าว #เทคโนโลยีAI`;
  }
  return out;
}

// ─── TikTok ───────────────────────────────────────────────────────────────────

async function formatTikTok(master) {
  const prompt = `${STYLE}

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

ตอบตามรูปแบบนี้เท่านั้น`;

  const out = await ollamaChat(prompt);
  return cleanOutput(out);
}

// ─── Items ────────────────────────────────────────────────────────────────────

function getItems() {
  if (!fs.existsSync(NEWS_DIR)) return [];
  return fs.readdirSync(NEWS_DIR)
    .filter(d => fs.existsSync(path.join(NEWS_DIR, d, 'content', 'master.md')))
    .map(slug => {
      const data       = JSON.parse(fs.readFileSync(path.join(NEWS_DIR, slug, 'data.json'), 'utf8'));
      const contentDir = path.join(NEWS_DIR, slug, 'content');
      return { slug, data, contentDir };
    })
    .filter(({ slug, data, contentDir }) => {
      // ข้ามตามสถานะที่กำหนดใน config (เช่น posted, scheduled)
      if (SKIP_STATUS.includes(data.status)) return false;
      // ข้ามข่าวคะแนนต่ำกว่าเกณฑ์ (filter_score ต้องถูกให้คะแนนแล้ว)
      if (FMT_MIN_SCORE > 0 && typeof data.filter_score === 'number' && data.filter_score < FMT_MIN_SCORE)
        return false;
      if (slugArg && slug !== slugArg) return false;
      if (dateArg) {
        const pub = (data.published_at || data.scraped_at || '').substring(0, 10);
        if (pub !== dateArg) return false;
      }
      if (!force) {
        // ผ่านถ้ายังมี platform ที่ยังไม่ได้สร้าง
        return PLATFORMS.some(p => !fs.existsSync(path.join(contentDir, PLATFORM_FILE[p] || p + '.md')));
      }
      return true;
    });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async function main() {
  console.log(`\n📐 Agent 4 — สร้าง content (formatter-agent) [${PLATFORMS.join(', ')}]\n`);

  try {
    await checkOllama();
    console.log('✅ Ollama พร้อมใช้\n');
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }

  const items = getItems();
  if (!items.length) {
    console.log('✅ content ครบทุกข่าวแล้ว (ใช้ --force เพื่อสร้างใหม่)');
    process.exit(0);
  }

  console.log(`📋 ต้องสร้าง: ${items.length} รายการ\n`);
  let totalOk = 0, totalFail = 0;

  for (const { slug, data, contentDir } of items) {
    const title = (data.title || '').substring(0, 55);
    console.log(`  📰 ${title}`);

    const master = fs.readFileSync(path.join(contentDir, 'master.md'), 'utf8');
    let okForItem = 0;   // นับ platform ที่สร้างสำเร็จในข่าวนี้

    for (const platform of PLATFORMS) {
      const filename = PLATFORM_FILE[platform] || platform + '.md';
      const outPath  = path.join(contentDir, filename);

      if (fs.existsSync(outPath) && !force) continue;

      // รองรับ platform ที่ไม่รู้จัก
      if (!['fb', 'ig', 'x', 'tiktok'].includes(platform)) {
        process.stdout.write(`     [${platform}] ⚠️  ไม่รู้จัก platform\n`);
        continue;
      }

      let savedContent = null;
      let lastErrors   = [];

      for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
        const label = attempt === 1 ? 'กำลังสร้าง' : `⟳ retry ${attempt - 1}/${RETRY_LIMIT - 1}`;
        process.stdout.write(`     [${platform}] ${label}...`);

        try {
          let raw;
          switch (platform) {
            case 'fb':     raw = await formatFacebook(master, data.url); break;
            case 'ig':     raw = await formatInstagram(master);          break;
            case 'x':      raw = await formatX(master, data.url);        break;
            case 'tiktok': raw = await formatTikTok(master);             break;
          }

          lastErrors = validateContent(raw, platform, data, master);

          if (lastErrors.length === 0) {
            savedContent = raw;
            process.stdout.write(` ✓\n`);
            break;
          }

          // แสดง error แล้วลองใหม่
          process.stdout.write(` ⚠️  ${lastErrors.join(' | ')}\n`);

        } catch (e) {
          lastErrors = [e.message.substring(0, 80)];
          process.stdout.write(` ❌ ${lastErrors[0]}\n`);
        }

        await sleep(500);
      }

      if (savedContent) {
        fs.writeFileSync(outPath, savedContent, 'utf8');
        totalOk++;
        okForItem++;
      } else {
        console.log(`     ⛔ [${platform}] ล้มเหลวหลัง ${RETRY_LIMIT} ครั้ง: ${lastErrors.join(' | ')}`);
        totalFail++;
      }

      await sleep(300);
    }

    // อัปเดต status → draft (ถ้ายังไม่ได้โพสต์)
    if (data.status !== 'posted' && data.status !== 'scheduled') {
      data.status = 'draft';
      fs.writeFileSync(path.join(NEWS_DIR, slug, 'data.json'), JSON.stringify(data, null, 2), 'utf8');
    }

    // ส่ง Telegram preview รอ approve (เฉพาะข่าวที่สร้าง content สำเร็จอย่างน้อย 1 platform)
    if (okForItem > 0) {
      // generate รูปด้วย ComfyUI ถ้าไม่มี og_image และไม่มี image.jpg
      const imagePath   = path.join(NEWS_DIR, slug, 'image.jpg');
      const hasLocalImg = fs.existsSync(imagePath);
      const hasOgImage  = !!(data.og_image || '').trim();
      if (!hasLocalImg && !hasOgImage && COMFY_CFG.enabled) {
        process.stdout.write(`     🎨 generate รูปด้วย ComfyUI...`);
        try {
          await generateNewsImage(slug, data.title || '');
          process.stdout.write(` ✓\n`);
        } catch (e) {
          process.stdout.write(` ⚠️ ${e.message.substring(0, 60)} (ส่ง text-only)\n`);
        }
      }

      process.stdout.write(`     📲 ส่ง Telegram รอ approve...`);
      try {
        await sendApprovalNotification(slug, data, master);
        process.stdout.write(` ✓\n`);
      } catch (e) {
        process.stdout.write(` ⚠️ ${e.message.substring(0, 60)}\n`);
      }
    }

    console.log('');
    await sleep(300);
  }

  console.log(`✅ Formatter Agent เสร็จ: สร้าง ${totalOk} | ล้มเหลว ${totalFail}`);
})();
