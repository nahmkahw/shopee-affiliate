/**
 * post.js — Shopee Affiliate Social Media Poster
 *
 * ใช้งาน:
 *   node post.js 2026-05-18                    โพสต์ทุก platform (fb, ig, x)
 *   node post.js 2026-05-18 --platform fb      โพสต์เฉพาะ Facebook
 *   node post.js 2026-05-18 --platform fb,ig   โพสต์ Facebook + Instagram
 */

require('dotenv').config();
const fs    = require('fs');
const path  = require('path');
const https = require('https');
const { TwitterApi } = require('twitter-api-v2');

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args      = process.argv.slice(2);
const postDate  = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
const itemIdArg = args.find(a => /^\d{8,}$/.test(a));   // ตัวเลข 8+ หลัก = item_id
const platIdx = args.findIndex(a => a === '--platform' || a.startsWith('--platform='));
let platforms;
if (platIdx === -1) {
  platforms = ['fb', 'ig', 'x'];
} else if (args[platIdx].includes('=')) {
  platforms = args[platIdx].split('=')[1].split(',').map(s => s.trim().toLowerCase());
} else {
  platforms = (args[platIdx + 1] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

if (!postDate && !itemIdArg) {
  console.error('❌ ระบุวันที่หรือ item_id ด้วย เช่น\n   node post.js 2026-05-18\n   node post.js 3991346022 --platform fb');
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function httpsPost(hostname, path, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = typeof data === 'string' ? data : JSON.stringify(data);
    const req = https.request(
      { hostname, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers } },
      res => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); } catch { resolve(buf); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsGet(hostname, urlPath) {
  return new Promise((resolve, reject) => {
    https.get({ hostname, path: urlPath }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(buf); } });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Read content file ────────────────────────────────────────────────────────

function readContent(itemId, platform) {
  const p = path.join('products', itemId, 'content', platform + '.md');
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').trim();
}

// ─── Facebook ─────────────────────────────────────────────────────────────────

/** สร้าง multipart/form-data body จาก fields (text) + files (binary) */
function buildMultipart(fields, files, boundary) {
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
    ));
  }
  for (const { name, filename, contentType, data } of files) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`
    ));
    chunks.push(data);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

function httpsPostBinary(hostname, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path: urlPath, method: 'POST',
        headers: { 'Content-Length': body.length, ...headers } },
      res => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(buf); } });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** อัปโหลดรูปไป Facebook โดยไม่ publish → คืน photo id สำหรับ attached_media */
async function uploadPhotoFB(imagePath, pageId, accessToken) {
  const boundary = `----FBBoundary${Date.now()}`;
  const imageData = fs.readFileSync(imagePath);
  const filename  = path.basename(imagePath);
  const body = buildMultipart(
    { published: 'false', access_token: accessToken },
    [{ name: 'source', filename, contentType: 'image/jpeg', data: imageData }],
    boundary
  );
  const res = await httpsPostBinary(
    'graph.facebook.com',
    `/v19.0/${pageId}/photos`,
    body,
    { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
  );
  if (res.error) throw new Error('FB photo upload: ' + res.error.message);
  return res.id;
}

async function postFacebook(itemId) {
  const { FB_PAGE_ID, FB_ACCESS_TOKEN } = process.env;
  if (!FB_PAGE_ID || !FB_ACCESS_TOKEN) throw new Error('ขาด FB_PAGE_ID หรือ FB_ACCESS_TOKEN ใน .env');

  const text = readContent(itemId, 'facebook');
  if (!text) throw new Error(`ไม่พบ products/${itemId}/content/facebook.md`);

  // หารูป 2.jpg – 6.jpg ที่มีขนาด > 50 KB
  const imgDir = path.join('products', itemId, 'images');
  const imgPaths = [];
  for (let i = 2; i <= 6; i++) {
    const p = path.join(imgDir, `${i}.jpg`);
    if (fs.existsSync(p) && fs.statSync(p).size > 50 * 1024) imgPaths.push(p);
  }

  // อัปโหลดรูปทีละรูป → เก็บ photo id
  const attachedMedia = [];
  if (imgPaths.length) {
    process.stdout.write(`    📤 อัปโหลด ${imgPaths.length} รูปไปยัง Facebook...`);
    for (const imgPath of imgPaths) {
      const photoId = await uploadPhotoFB(imgPath, FB_PAGE_ID, FB_ACCESS_TOKEN);
      attachedMedia.push({ media_fbid: photoId });
      await sleep(500);
    }
    process.stdout.write(` ✓\n`);
  }

  // โพสต์ feed พร้อมรูป
  const payload = { message: text, access_token: FB_ACCESS_TOKEN };
  if (attachedMedia.length) payload.attached_media = attachedMedia;

  const res = await httpsPost('graph.facebook.com',
    `/v19.0/${FB_PAGE_ID}/feed`,
    payload
  );

  if (res.error) throw new Error(res.error.message);
  return res.id;
}

// ─── imgBB upload ─────────────────────────────────────────────────────────────

function uploadImgBB(imagePath) {
  return new Promise((resolve, reject) => {
    const IMGBB_API_KEY = process.env.IMGBB_API_KEY;
    if (!IMGBB_API_KEY) throw new Error('ขาด IMGBB_API_KEY ใน .env');

    const imageData = fs.readFileSync(imagePath);
    const base64    = imageData.toString('base64');
    const body      = `key=${encodeURIComponent(IMGBB_API_KEY)}&image=${encodeURIComponent(base64)}`;

    const req = https.request({
      hostname: 'api.imgbb.com',
      path: '/1/upload',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          if (j.success) resolve(j.data.url);
          else reject(new Error('imgBB upload failed: ' + JSON.stringify(j)));
        } catch { reject(new Error('imgBB response parse error')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Instagram ────────────────────────────────────────────────────────────────

async function postInstagram(itemId) {
  const { IG_USER_ID, IG_ACCESS_TOKEN } = process.env;
  if (!IG_USER_ID || !IG_ACCESS_TOKEN) throw new Error('ขาด IG_USER_ID หรือ IG_ACCESS_TOKEN ใน .env');

  const caption = readContent(itemId, 'instagram');
  if (!caption) throw new Error(`ไม่พบ products/${itemId}/content/instagram.md`);

  // หารูปภาพ 2-6 ที่มีขนาด > 50 KB
  const imgDir = path.join('products', itemId, 'images');
  const images = [];
  for (let i = 2; i <= 6; i++) {
    const p = path.join(imgDir, `${i}.jpg`);
    if (fs.existsSync(p) && fs.statSync(p).size > 50 * 1024) images.push(p);
  }
  if (!images.length) throw new Error(`ไม่พบรูปภาพ > 50 KB ใน products/${itemId}/images/`);

  // อัปโหลดรูปไป imgBB → ได้ public URL
  console.log(`    📤 อัปโหลด ${images.length} รูปไป imgBB...`);
  const publicUrls = [];
  for (const img of images) {
    const url = await uploadImgBB(img);
    publicUrls.push(url);
    await sleep(500);
  }

  // สร้าง Instagram media container สำหรับแต่ละรูป
  console.log(`    📷 สร้าง carousel items บน Instagram...`);
  const mediaIds = [];
  for (const url of publicUrls) {
    const res = await httpsPost('graph.facebook.com',
      `/v19.0/${IG_USER_ID}/media`,
      { image_url: url, is_carousel_item: true, access_token: IG_ACCESS_TOKEN }
    );
    if (res.error) throw new Error('IG media item error: ' + res.error.message);
    mediaIds.push(res.id);
    await sleep(500);
  }

  // สร้าง carousel container
  const carouselRes = await httpsPost('graph.facebook.com',
    `/v19.0/${IG_USER_ID}/media`,
    { media_type: 'CAROUSEL', children: mediaIds.join(','), caption, access_token: IG_ACCESS_TOKEN }
  );
  if (carouselRes.error) throw new Error('IG carousel error: ' + carouselRes.error.message);

  await sleep(2000);

  // Publish
  const publishRes = await httpsPost('graph.facebook.com',
    `/v19.0/${IG_USER_ID}/media_publish`,
    { creation_id: carouselRes.id, access_token: IG_ACCESS_TOKEN }
  );
  if (publishRes.error) throw new Error('IG publish error: ' + publishRes.error.message);

  return publishRes.id;
}

// ─── X (Twitter) ─────────────────────────────────────────────────────────────

function parseTweets(content) {
  // แยก ### Tweet N/N sections
  const tweets = [];
  const sections = content.split(/^###\s+Tweet\s+\d+\/\d+/m).filter(s => s.trim());
  for (const s of sections) {
    const text = s.replace(/^```[\s\S]*?```/gm, '').trim(); // ลบ code block ถ้ามี
    if (text) tweets.push(text);
  }
  return tweets;
}

async function postX(itemId) {
  const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET } = process.env;
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET)
    throw new Error('ขาด X credentials ใน .env (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET)');

  const content = readContent(itemId, 'x');
  if (!content) throw new Error(`ไม่พบ products/${itemId}/content/x.md`);

  const tweets = parseTweets(content);
  if (!tweets.length) throw new Error('parse x.md ไม่พบ tweet ใดเลย');

  const client = new TwitterApi({
    appKey: X_API_KEY, appSecret: X_API_SECRET,
    accessToken: X_ACCESS_TOKEN, accessSecret: X_ACCESS_TOKEN_SECRET,
  });
  const rwClient = client.readWrite;

  // โพสต์ tweet แรก
  let lastId = null;
  for (let i = 0; i < tweets.length; i++) {
    const payload = i === 0 ? { text: tweets[i] } : { text: tweets[i], reply: { in_reply_to_tweet_id: lastId } };
    const res = await rwClient.v2.tweet(payload);
    lastId = res.data.id;
    if (i < tweets.length - 1) await sleep(1000);
  }

  return lastId;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async function main() {
  // หาสินค้าของวันที่นั้น
  const productDirs = fs.readdirSync('products')
    .filter(d => fs.existsSync(path.join('products', d, 'data.json')));

  const items = productDirs.map(id => {
    const d = JSON.parse(fs.readFileSync(path.join('products', id, 'data.json'), 'utf8'));
    return { id, data: d };
  }).filter(({ data: d }) => {
    if (d.status === 'placeholder') return false;
    if (postDate) return d.post_date === postDate;
    return d.item_id === itemIdArg;
  });

  if (!items.length) {
    const label = postDate ? `post_date = ${postDate}` : `item_id = ${itemIdArg}`;
    console.log(`❌ ไม่พบสินค้าที่มี ${label}`);
    process.exit(1);
  }

  const filterLabel = postDate ? `วันที่: ${postDate}` : `item_id: ${itemIdArg}`;
  console.log(`\n🚀 โพสต์ ${items.length} สินค้า | platform: ${platforms.join(', ')} | ${filterLabel}\n`);

  const results = {};

  for (const { id, data } of items) {
    const title = (data.title || '').substring(0, 40);
    console.log(`[${id}] ${title}`);
    results[id] = {};

    if (platforms.includes('fb')) {
      try {
        const postId = await postFacebook(id);
        console.log(`  ✅ Facebook — post_id: ${postId}`);
        results[id].fb = '✅';
      } catch (e) {
        console.log(`  ❌ Facebook — ${e.message}`);
        results[id].fb = '❌';
      }
    }

    if (platforms.includes('ig')) {
      try {
        const postId = await postInstagram(id);
        console.log(`  ✅ Instagram — media_id: ${postId}`);
        results[id].ig = '✅';
      } catch (e) {
        console.log(`  ❌ Instagram — ${e.message}`);
        results[id].ig = '❌';
      }
    }

    if (platforms.includes('x')) {
      try {
        const tweetId = await postX(id);
        console.log(`  ✅ X — tweet_id: ${tweetId}`);
        results[id].x = '✅';
      } catch (e) {
        console.log(`  ❌ X — ${e.message}`);
        results[id].x = '❌';
      }
    }

    // TikTok: แสดง caption เท่านั้น
    if (platforms.includes('tiktok') || platforms.includes('tt')) {
      const caption = readContent(id, 'tiktok');
      if (caption) {
        console.log(`\n  📱 TikTok caption (โพสต์เอง):\n${'─'.repeat(50)}`);
        // แสดงเฉพาะส่วน Caption (หลัง ## Caption)
        const match = caption.match(/##\s*Caption\s*\n([\s\S]+)/);
        console.log(match ? match[1].trim() : caption);
        console.log('─'.repeat(50));
        results[id].tiktok = '📱 manual';
      }
    }

    // ── อัปเดต status ใน data.json ───────────────────────────────────────────
    const anySuccess = Object.values(results[id]).some(v => v === '✅');
    if (anySuccess) {
      try {
        const dataPath = path.join('products', id, 'data.json');
        const dataJson = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        dataJson.status           = 'posted';
        dataJson.posted_at        = new Date().toISOString();
        dataJson.posted_platforms = Object.entries(results[id])
          .filter(([, v]) => v === '✅').map(([k]) => k);
        fs.writeFileSync(dataPath, JSON.stringify(dataJson, null, 2), 'utf8');
        console.log(`  💾 บันทึก status = posted`);
      } catch (e) {
        console.log(`  ⚠️ บันทึก status ไม่ได้: ${e.message}`);
      }
    }

    console.log('');
    await sleep(2000);
  }

  // สรุปผล
  console.log('\n' + '═'.repeat(55));
  console.log('📊 สรุปผลการโพสต์\n');
  const header = ['item_id'.padEnd(14), 'FB', 'IG', 'X'].join(' | ');
  console.log(header);
  console.log('─'.repeat(header.length));
  for (const [id, r] of Object.entries(results)) {
    console.log([id.padEnd(14), (r.fb||'—').padEnd(2), (r.ig||'—').padEnd(2), (r.x||'—')].join(' | '));
  }

  if (items.some(({ id }) => fs.existsSync(path.join('products', id, 'content', 'tiktok.md')))) {
    console.log('\n📱 TikTok: อัปโหลดวิดีโอเองที่ https://www.tiktok.com/creator-center');
    console.log('   แล้ว copy caption จาก products/{item_id}/content/tiktok.md');
  }
})();
