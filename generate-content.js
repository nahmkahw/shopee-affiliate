/**
 * generate-content.js — Shopee Affiliate Content Generator
 *
 * สร้าง content สำหรับ Facebook, Instagram, TikTok จาก data.json ของสินค้า
 * ใช้ Ollama (เหมือน Reuters pipeline)
 *
 * ใช้งาน:
 *   node generate-content.js {item_id}           ← สร้าง (ข้ามถ้ามีแล้ว)
 *   node generate-content.js {item_id} --force   ← สร้างใหม่ทับของเดิม
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const ROOT         = __dirname;
const PRODUCTS_DIR = path.join(ROOT, 'products');
const OLLAMA_HOST  = process.env.OLLAMA_HOST  || 'http://10.3.17.118:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:latest';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Ollama ────────────────────────────────────────────────────────────────────
function ollamaChat(prompt) {
  return new Promise((resolve, reject) => {
    const url  = new URL('/api/chat', OLLAMA_HOST);
    const body = JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    });
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;
    const req = mod.request({
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 11434),
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          if (j.error) return reject(new Error('Ollama error: ' + j.error));
          resolve(j.message?.content || j.response || '');
        } catch { reject(new Error('Ollama parse error: ' + buf.substring(0, 200))); }
      });
    });
    req.on('error', e => reject(new Error('Ollama connection: ' + e.message)));
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('Ollama timeout (3 min)')); });
    req.write(body);
    req.end();
  });
}

// ── Build product context ─────────────────────────────────────────────────────
function buildContext(data) {
  const features = [];
  if (data.description) {
    const bullets = data.description.split(/[\n\r]+/)
      .map(l => l.replace(/^[-•*]\s*/, '').trim())
      .filter(l => l.length > 5 && l.length < 150)
      .slice(0, 6);
    features.push(...bullets);
  }
  // reviews may be strings (from scrape.js) or objects with .comment
  const topReview = (data.reviews || []).slice(0, 1)
    .map(r => typeof r === 'string' ? r : (r.comment || ''))
    .filter(Boolean).join(' ');

  return `ข้อมูลสินค้า Shopee:
ชื่อสินค้า: ${data.title || ''}
ราคาปัจจุบัน: ${data.price || ''}
ราคาก่อนลด: ${data.original_price || ''}
ส่วนลด: ${data.discount || ''}
คะแนน: ${data.rating || ''} (${data.review_count || ''} รีวิว)
ร้านค้า: ${data.shop_name || ''}
Affiliate Link: ${data.affiliate_short_link || ''}
${features.length ? '\nจุดเด่น/Features:\n' + features.map(f => '- ' + f).join('\n') : ''}
${topReview ? '\nรีวิวจากลูกค้า: ' + topReview.substring(0, 200) : ''}`;
}

// ── Generators ────────────────────────────────────────────────────────────────
async function generateFacebook(data) {
  const ctx = buildContext(data);
  const prompt = `คุณคือผู้เชี่ยวชาญด้าน Shopee Affiliate Marketing ที่เขียน content ภาษาไทย

${ctx}

เขียนโพสต์ Facebook สำหรับ Shopee Affiliate ตามโครงสร้างนี้:

1. Hook (1 ประโยค) — ตั้งคำถาม / pain point ที่เกี่ยวข้องกับสินค้า ไม่ใช่ template เดิม
2. เล่าบริบท (2-3 ประโยค) — สินค้านี้เหมาะกับใคร แก้ปัญหาอะไร
3. แนะนำสินค้าจากร้าน ${data.shop_name || 'ร้านค้า'}
4. จุดเด่น 3-5 ข้อ (✅ แต่ละข้อ)
5. Social proof (rating + review count)
6. ราคา + urgency แบบสุภาพ
7. CTA: "สั่งซื้อ / ดูรายละเอียดเพิ่ม 👉 ${data.affiliate_short_link || ''}"
8. Hashtag 3-5 ตัว ต้องมี #Shopeeaffiliate

กฎสำคัญ:
- ภาษาไทยทั้งหมด เป็นกันเอง เหมือนเพื่อนแนะนำ
- ความยาว 150-300 คำ
- ห้ามแต่งข้อมูลที่ไม่อยู่ใน data
- ต้องใช้ affiliate link: ${data.affiliate_short_link || ''} เท่านั้น
- ตอบเฉพาะเนื้อหาโพสต์ ไม่ต้องมีคำอธิบาย`;

  return await ollamaChat(prompt);
}

async function generateInstagram(data) {
  const ctx = buildContext(data);
  const prompt = `คุณคือผู้เชี่ยวชาญด้าน Shopee Affiliate Marketing ที่เขียน caption Instagram ภาษาไทย

${ctx}

เขียน Instagram caption ตามโครงสร้างนี้:

1. Hook line (1 บรรทัด + emoji) — สั้น โดน
2. Brief body (2-3 ประโยค) — เหมาะกับใคร แก้ปัญหาอะไร
3. Key points (3-4 bullet + emoji)
4. Price tease: "💰 ${data.price || ''} บาท (ปกติ ${data.original_price || ''})"
5. CTA: "👉 ลิงก์ใน bio"
6. บรรทัดว่าง 3 บรรทัด แล้ว hashtag 15-20 ตัว (ต้องมี #Shopeeaffiliate)

กฎสำคัญ:
- ภาษาไทยทั้งหมด 100-150 คำ (ไม่นับ hashtag)
- ห้ามใส่ affiliate link ใน caption (IG กดไม่ได้)
- ห้ามแต่งข้อมูลที่ไม่อยู่ใน data
- ตอบเฉพาะ caption เท่านั้น`;

  return await ollamaChat(prompt);
}

async function generateTikTok(data) {
  const ctx = buildContext(data);
  const prompt = `คุณคือผู้เชี่ยวชาญด้าน TikTok สำหรับ Shopee Affiliate Marketing

${ctx}

สร้างสคริปต์วิดีโอ TikTok 45-60 วินาที:

**สคริปต์ (table format):**
| TIME | VOICEOVER | VISUAL | ON-SCREEN |
|------|-----------|--------|-----------|
(4-6 scenes)

กฎ scene:
- 0:00-0:03 Hook โดนใน 3 วินาทีแรก ห้ามเริ่ม "สวัสดีค่ะ"
- 0:03-0:10 Build-up แนะนำสินค้า
- 0:10-0:45 Key features 3-4 จุด แต่ละจุดมี visual demo
- 0:45-สุดท้าย CTA ราคา + "ลิงก์ใน bio"

**Caption (50-80 คำ, ต้องมี #Shopeeaffiliate + hashtag 5-8 ตัว)**

กฎสำคัญ:
- ภาษาไทยทั้งหมด เป็นกันเอง
- ห้ามแต่งข้อมูลที่ไม่อยู่ใน data
- ตอบเฉพาะสคริปต์และ caption เท่านั้น`;

  return await ollamaChat(prompt);
}

// ── Clean helpers ─────────────────────────────────────────────────────────────
function cleanText(text) {
  return text
    .replace(/^\[[^\]]+\]\s*/gm, '')
    .replace(/^\*{0,2}[\w ]+\*{0,2}:\s*/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(opts = {}) {
  const args   = opts.args !== undefined ? opts.args : process.argv.slice(2);
  const itemId = opts.itemId || args.find(a => !a.startsWith('--'));
  const force  = opts.force  !== undefined ? opts.force : args.includes('--force');

  if (!itemId) {
    console.error('Usage: node generate-content.js <item_id> [--force]');
    process.exit(1);
    return;
  }

  const productDir = path.join(PRODUCTS_DIR, itemId);
  const dataPath   = path.join(productDir, 'data.json');

  if (!fs.existsSync(dataPath)) {
    console.error(`❌ ไม่พบ products/${itemId}/data.json`);
    process.exit(1);
    return;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch (e) {
    console.error(`❌ อ่าน data.json ไม่ได้: ${e.message}`);
    process.exit(1);
    return;
  }

  const contentDir = path.join(productDir, 'content');
  fs.mkdirSync(contentDir, { recursive: true });

  const fbPath = path.join(contentDir, 'facebook.md');
  const igPath = path.join(contentDir, 'instagram.md');
  const ttPath = path.join(contentDir, 'tiktok.md');

  const needFB = force || !fs.existsSync(fbPath);
  const needIG = force || !fs.existsSync(igPath);
  const needTT = force || !fs.existsSync(ttPath);

  if (!needFB && !needIG && !needTT) {
    console.log(`✅ content ครบแล้ว (ใช้ --force เพื่อสร้างใหม่)`);
    process.exit(0);
    return;
  }

  console.log(`\n🛍️  Generate Content: ${itemId}`);
  console.log(`📦 ${(data.title || '').substring(0, 60)}`);
  console.log(`💰 ${data.price || '?'}  (${data.discount || 'ไม่มีส่วนลด'})\n`);

  // ตรวจ Ollama
  try {
    await new Promise((resolve, reject) => {
      const url = new URL('/api/tags', OLLAMA_HOST);
      const mod = url.protocol === 'https:' ? https : http;
      mod.get({ hostname: url.hostname, port: url.port || 11434, path: url.pathname }, res => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => {
          try {
            const j = JSON.parse(buf);
            const models = (j.models || []).map(m => m.name);
            if (!models.some(m => m.startsWith(OLLAMA_MODEL.split(':')[0]))) {
              console.error(`❌ ไม่พบ model "${OLLAMA_MODEL}" — รัน: ollama pull ${OLLAMA_MODEL}`);
              process.exit(1);
            }
            resolve();
          } catch { reject(new Error('parse error')); }
        });
      }).on('error', reject);
    });
    console.log(`✅ Ollama พร้อม (${OLLAMA_HOST})\n`);
  } catch (e) {
    console.error(`❌ เชื่อมต่อ Ollama ไม่ได้: ${e.message}`);
    process.exit(1);
    return;
  }

  // Facebook
  if (needFB) {
    process.stdout.write('  📘 Facebook...');
    const fb = cleanText(await generateFacebook(data));
    fs.writeFileSync(fbPath, fb, 'utf8');
    process.stdout.write(' ✓\n');
    await sleep(500);
  }

  // Instagram
  if (needIG) {
    process.stdout.write('  📸 Instagram...');
    const ig = cleanText(await generateInstagram(data));
    fs.writeFileSync(igPath, ig, 'utf8');
    process.stdout.write(' ✓\n');
    await sleep(500);
  }

  // TikTok
  if (needTT) {
    process.stdout.write('  🎵 TikTok...');
    const tt = cleanText(await generateTikTok(data));
    fs.writeFileSync(ttPath, tt, 'utf8');
    process.stdout.write(' ✓\n');
  }

  // อัปเดต status เป็น draft ถ้ายังเป็น scraped
  if (data.status === 'scraped' || !data.status) {
    data.status = 'draft';
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
  }

  console.log(`\n✅ เสร็จแล้ว → products/${itemId}/content/`);
  console.log(`   📘 facebook.md  📸 instagram.md  🎵 tiktok.md`);
}

/* istanbul ignore next */
if (require.main === module) {
  main().catch(e => { console.error('❌', e.message); process.exit(1); });
}

module.exports = { buildContext, cleanText, ollamaChat, generateFacebook, generateInstagram, generateTikTok, main };
