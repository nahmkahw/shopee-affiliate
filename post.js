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

// ─── CLI args parser ──────────────────────────────────────────────────────────

function parsePlatforms(args) {
  const platIdx = args.findIndex(a => a === '--platform' || a.startsWith('--platform='));
  if (platIdx === -1) return ['fb', 'ig', 'x'];
  if (args[platIdx].includes('='))
    return args[platIdx].split('=')[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return (args[platIdx + 1] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function httpsPost(hostname, urlPath, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = typeof data === 'string' ? data : JSON.stringify(data);
    const req = https.request(
      { hostname, path: urlPath, method: 'POST',
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

async function commentFacebook(postId, data) {
  const { FB_PAGE_ID, FB_ACCESS_TOKEN } = process.env;
  if (!FB_PAGE_ID || !FB_ACCESS_TOKEN) return null;
  const parts = [];
  if (data.title) parts.push(data.title);
  const price = data.price || '';
  const disc  = data.discount ? ` (${data.discount})` : (data.original_price ? ` (ลดจาก ${data.original_price})` : '');
  if (price) parts.push(`💰 ราคา: ${price}${disc}`);
  if (parts.length === 0) return null;
  const message = parts.join('\n');

  // แลก User Token → Page Token เพื่อ comment ในนามของ Page (ต้องการ pages_manage_engagement)
  let token = FB_ACCESS_TOKEN;
  try {
    const qs = `fields=access_token&access_token=${encodeURIComponent(FB_ACCESS_TOKEN)}`;
    const ptRes = await new Promise((resolve, reject) => {
      https.get({ hostname: 'graph.facebook.com', path: `/v19.0/${FB_PAGE_ID}?${qs}` }, res => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error('parse')); } });
      }).on('error', reject);
    });
    if (ptRes.access_token) token = ptRes.access_token;
    else if (ptRes.error) console.log(`  ⚠️ Page Token: ${ptRes.error.message}`);
  } catch (te) {
    console.log(`  ⚠️ Page Token exchange ล้มเหลว (ใช้ User Token แทน): ${te.message}`);
  }

  const res = await httpsPost('graph.facebook.com',
    `/v19.0/${postId}/comments`,
    { message, access_token: token }
  );
  if (res.error) throw new Error('FB comment: ' + res.error.message);
  return res.id;
}

// ─── imgBB upload ─────────────────────────────────────────────────────────────

function uploadImgBB(imagePath) {
  return new Promise((resolve, reject) => {
    const IMGBB_API_KEY = process.env.IMGBB_API_KEY;
    if (!IMGBB_API_KEY) {
      reject(new Error('ขาด IMGBB_API_KEY ใน .env'));
      return;
    }

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
  // แยก ### Tweet N/N sections — parts[0] is preamble, parts[1..] are tweet bodies
  const tweets = [];
  const parts = content.split(/^###\s+Tweet\s+\d+\/\d+[^\n]*/m);
  for (let i = 1; i < parts.length; i++) {
    const text = parts[i].replace(/^```[\s\S]*?```/gm, '').trim();
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

async function main(opts = {}) {
  const args      = opts.args !== undefined ? opts.args : process.argv.slice(2);
  const postDate  = opts.postDate  !== undefined ? opts.postDate  : args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const itemIdArg = opts.itemIdArg !== undefined ? opts.itemIdArg : args.find(a => /^\d{8,}$/.test(a));
  const platforms = opts.platforms !== undefined ? opts.platforms : parsePlatforms(args);

  if (!postDate && !itemIdArg) {
    console.error('❌ ระบุวันที่หรือ item_id ด้วย เช่น\n   node post.js 2026-05-18\n   node post.js 3991346022 --platform fb');
    process.exit(1);
    return;
  }

  if (!platforms.length) {
    console.error('❌ --platform ระบุไม่ถูกต้อง ตัวอย่าง: --platform fb,ig,x');
    process.exit(1);
    return;
  }

  // หาสินค้าของวันที่นั้น
  if (!fs.existsSync('products')) {
    console.log('❌ ไม่พบโฟลเดอร์ products/');
    process.exit(1);
    return;
  }

  const productDirs = fs.readdirSync('products')
    .filter(d => fs.existsSync(path.join('products', d, 'data.json')));

  const items = productDirs.map(id => {
    try {
      const d = JSON.parse(fs.readFileSync(path.join('products', id, 'data.json'), 'utf8'));
      return { id, data: d };
    } catch {
      return null;
    }
  }).filter(item => {
    if (!item) return false;
    const d = item.data;
    if (d.status === 'placeholder') return false;
    if (postDate) return d.post_date === postDate;
    return d.item_id === itemIdArg || item.id === itemIdArg;
  });

  if (!items.length) {
    const label = postDate ? `post_date = ${postDate}` : `item_id = ${itemIdArg}`;
    console.log(`❌ ไม่พบสินค้าที่มี ${label}`);
    process.exit(1);
    return;
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
        try {
          const commentId = await commentFacebook(postId, data);
          console.log(`  💬 Comment — comment_id: ${commentId}`);
        } catch (ce) {
          console.log(`  ⚠️ Comment ไม่สำเร็จ (โพสต์ยังสำเร็จ): ${ce.message}`);
        }
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
}

if (require.main === module) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = {
  parsePlatforms,
  readContent,
  parseTweets,
  uploadImgBB,
  uploadPhotoFB,
  buildMultipart,
  httpsPost,
  httpsPostBinary,
  postFacebook,
  commentFacebook,
  postInstagram,
  postX,
  main,
};
