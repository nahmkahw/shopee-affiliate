/**
 * post.js — AI News Social Media Poster
 *
 * ใช้งาน:
 *   node post.js {slug}                         โพสต์ทันที (fb + ig)
 *   node post.js {slug} --platform fb           โพสต์เฉพาะ Facebook
 *   node post.js --date 2026-05-27              โพสต์ทุกข่าวของวันนั้น (fb + ig)
 *   node post.js --date 2026-05-27 --schedule   โพสต์ schedule ทุก 2 ชั่วโมง
 *   node post.js --pending --schedule           โพสต์ทุกข่าวที่ status=draft แบบ schedule
 */

require('dotenv').config();
const fs    = require('fs');
const path  = require('path');
const https = require('https');
const { sleep } = require('../../../lib/utils');

const PIPELINE_ROOT = process.env.PIPELINE_ROOT || __dirname;
const NEWS_DIR = path.join(PIPELINE_ROOT, 'news');

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const pending    = args.includes('--pending');
const schedule   = args.includes('--schedule');

const dateIdx    = args.findIndex(a => a === '--date');
const dateArg    = dateIdx !== -1 ? args[dateIdx + 1] : null;

const platIdx    = args.findIndex(a => a === '--platform' || a.startsWith('--platform='));
let platforms;
if (platIdx === -1) {
  platforms = ['fb', 'ig'];
} else if (args[platIdx].includes('=')) {
  platforms = args[platIdx].split('=')[1].split(',').map(s => s.trim().toLowerCase());
} else {
  platforms = (args[platIdx + 1] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

// ค่าที่ตามหลัง flags (ไม่ใช่ slug)
const flagValues = new Set([
  dateArg,
  platIdx !== -1 && !args[platIdx].includes('=') ? args[platIdx + 1] : null,
].filter(Boolean));

const slugArg = args.find(a => !a.startsWith('--') && !flagValues.has(a) && !/^\d{4}-\d{2}-\d{2}$/.test(a));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function httpsPost(hostname, urlPath, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = https.request(
      { hostname, path: urlPath, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
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

function httpsPostBinary(hostname, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path: urlPath, method: 'POST', headers: { 'Content-Length': body.length, ...headers } },
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

// ─── หาเวลา schedule ล่าสุดที่ยังอยู่ในอนาคต (scan ทุก pipeline) ───────────────
// EXTRA_SCHEDULE_DIRS = path1:path2 → scan เพิ่มเติม เพื่อไม่ให้ชนกับ pipeline อื่น
function getLastScheduledTime() {
  const nowUnix = Math.floor(Date.now() / 1000);
  let maxTime = null;

  const dirsToScan = [NEWS_DIR];
  const extra = (process.env.EXTRA_SCHEDULE_DIRS || '').split(':').map(s => s.trim()).filter(Boolean);
  for (const d of extra) dirsToScan.push(path.join(d, 'news'));

  for (const newsDir of dirsToScan) {
    if (!fs.existsSync(newsDir)) continue;
    for (const d of fs.readdirSync(newsDir)) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(newsDir, d, 'data.json'), 'utf8'));
        if (data.status === 'scheduled' && data.scheduled_publish_time) {
          const t = parseInt(data.scheduled_publish_time);
          // นับเฉพาะที่ยังเป็นอนาคต (Meta API ต้องการ > now + 10 นาที)
          if (t > nowUnix + 600 && (!maxTime || t > maxTime)) maxTime = t;
        }
      } catch { /* ข้ามถ้าอ่านไม่ได้ */ }
    }
  }
  return maxTime;
}

function readContent(slug, platform) {
  const p = path.join(NEWS_DIR, slug, 'content', platform + '.md');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null;
}

// ─── Facebook ─────────────────────────────────────────────────────────────────

async function postFacebook(slug, scheduledUnix) {
  const { FB_PAGE_ID, FB_ACCESS_TOKEN } = process.env;
  if (!FB_PAGE_ID || !FB_ACCESS_TOKEN) throw new Error('ขาด FB_PAGE_ID หรือ FB_ACCESS_TOKEN ใน .env');

  const text = readContent(slug, 'facebook');
  if (!text) throw new Error(`ไม่พบ news/${slug}/content/facebook.md`);

  const payload = { message: text, access_token: FB_ACCESS_TOKEN };

  if (scheduledUnix) {
    payload.published = false;
    payload.scheduled_publish_time = scheduledUnix;
  }

  const res = await httpsPost('graph.facebook.com', `/v19.0/${FB_PAGE_ID}/feed`, payload);
  if (res.error) throw new Error(res.error.message);
  return res.id;
}

// ─── imgBB upload (shared helper) ────────────────────────────────────────────

// อัปโหลดไฟล์รูป local → imgBB → คืน public URL
function uploadImgBBFile(imgPath) {
  return new Promise((resolve, reject) => {
    const { IMGBB_API_KEY } = process.env;
    if (!IMGBB_API_KEY) return reject(new Error('ขาด IMGBB_API_KEY ใน .env'));
    const base64 = fs.readFileSync(imgPath).toString('base64');
    const body   = `key=${encodeURIComponent(IMGBB_API_KEY)}&image=${encodeURIComponent(base64)}`;
    const req = https.request({
      hostname: 'api.imgbb.com', path: '/1/upload', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          if (j.success) resolve(j.data.url);
          else reject(new Error('imgBB failed: ' + JSON.stringify(j).substring(0, 120)));
        } catch { reject(new Error('imgBB parse error')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// อัปโหลดจาก public URL → imgBB (fallback เก่า)
function uploadImgBB(imageUrl) {
  return new Promise((resolve, reject) => {
    const { IMGBB_API_KEY } = process.env;
    if (!IMGBB_API_KEY) return reject(new Error('ขาด IMGBB_API_KEY ใน .env'));
    const body = `key=${encodeURIComponent(IMGBB_API_KEY)}&image=${encodeURIComponent(imageUrl)}`;
    const req = https.request({
      hostname: 'api.imgbb.com', path: '/1/upload', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          if (j.success) resolve(j.data.url);
          else reject(new Error('imgBB failed: ' + JSON.stringify(j)));
        } catch { reject(new Error('imgBB parse error')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// หา public URL สำหรับรูป: 1) local image.jpg → imgBB  2) og_image  3) DEFAULT_IMAGE_URL
async function resolveImageUrl(slug) {
  const imgPath = path.join(NEWS_DIR, slug, 'image.jpg');
  if (fs.existsSync(imgPath)) {
    const url = await uploadImgBBFile(imgPath);
    console.log(`  🖼 อัปโหลดรูปไปยัง imgBB สำเร็จ`);
    return url;
  }
  try {
    const data = JSON.parse(fs.readFileSync(path.join(NEWS_DIR, slug, 'data.json'), 'utf8'));
    if (data.og_image) { console.log(`  🖼 ใช้ OG image`); return data.og_image; }
  } catch {}
  if (process.env.DEFAULT_IG_IMAGE_URL) {
    console.log(`  🖼 ใช้ DEFAULT_IG_IMAGE_URL`);
    return process.env.DEFAULT_IG_IMAGE_URL;
  }
  return null;
}

// ─── Facebook ─────────────────────────────────────────────────────────────────

async function postFacebook(slug, scheduledUnix) {
  const { FB_PAGE_ID, FB_ACCESS_TOKEN } = process.env;
  if (!FB_PAGE_ID || !FB_ACCESS_TOKEN) throw new Error('ขาด FB_PAGE_ID หรือ FB_ACCESS_TOKEN ใน .env');

  const text = readContent(slug, 'facebook');
  if (!text) throw new Error(`ไม่พบ news/${slug}/content/facebook.md`);

  // ลอง get public URL ของรูป
  let publicUrl = null;
  try { publicUrl = await resolveImageUrl(slug); } catch (e) {
    console.log(`  ⚠️ หารูปไม่ได้: ${e.message} — โพสต์แบบ text only`);
  }

  if (publicUrl) {
    // ─── Photo post (รูป + caption) ───────────────────────────────────────────
    const payload = { url: publicUrl, caption: text, access_token: FB_ACCESS_TOKEN };
    if (scheduledUnix) { payload.published = false; payload.scheduled_publish_time = scheduledUnix; }
    const res = await httpsPost('graph.facebook.com', `/v19.0/${FB_PAGE_ID}/photos`, payload);
    if (res.error) throw new Error(res.error.message);
    console.log(`  📸 Facebook photo post สำเร็จ`);
    return res.id;
  } else {
    // ─── Fallback: text-only post ────────────────────────────────────────────
    console.log(`  📝 Facebook text-only post (ไม่พบรูป)`);
    const payload = { message: text, access_token: FB_ACCESS_TOKEN };
    if (scheduledUnix) { payload.published = false; payload.scheduled_publish_time = scheduledUnix; }
    const res = await httpsPost('graph.facebook.com', `/v19.0/${FB_PAGE_ID}/feed`, payload);
    if (res.error) throw new Error(res.error.message);
    return res.id;
  }
}

// ─── Instagram ────────────────────────────────────────────────────────────────

async function postInstagram(slug, scheduledUnix) {
  const { IG_USER_ID, IG_ACCESS_TOKEN } = process.env;
  if (!IG_USER_ID || !IG_ACCESS_TOKEN) throw new Error('ขาด IG_USER_ID หรือ IG_ACCESS_TOKEN ใน .env');

  const caption = readContent(slug, 'instagram');
  if (!caption) throw new Error(`ไม่พบ news/${slug}/content/instagram.md`);

  // หา public URL ของรูป (ต้องมี — IG ไม่มีรูปไม่ได้)
  const publicUrl = await resolveImageUrl(slug);
  if (!publicUrl) {
    throw new Error(`ไม่พบรูปภาพ: ไม่มี news/${slug}/image.jpg, og_image, หรือ DEFAULT_IG_IMAGE_URL ใน .env`);
  }

  // สร้าง Instagram media container
  const mediaPayload = {
    image_url: publicUrl,
    caption,
    access_token: IG_ACCESS_TOKEN,
  };
  if (scheduledUnix) {
    mediaPayload.published = false;
    mediaPayload.scheduled_publish_time = scheduledUnix;
  }

  const mediaRes = await httpsPost('graph.facebook.com', `/v19.0/${IG_USER_ID}/media`, mediaPayload);
  if (mediaRes.error) throw new Error('IG media error: ' + mediaRes.error.message);

  await sleep(2000);

  // Publish
  const publishPayload = { creation_id: mediaRes.id, access_token: IG_ACCESS_TOKEN };
  const publishRes = await httpsPost('graph.facebook.com', `/v19.0/${IG_USER_ID}/media_publish`, publishPayload);
  if (publishRes.error) throw new Error('IG publish error: ' + publishRes.error.message);

  return publishRes.id;
}

// ─── Find items ───────────────────────────────────────────────────────────────

function findItems() {
  if (!fs.existsSync(NEWS_DIR)) return [];

  const dirs = fs.readdirSync(NEWS_DIR)
    .filter(d => fs.existsSync(path.join(NEWS_DIR, d, 'data.json')));

  return dirs.map(slug => {
    const data = JSON.parse(fs.readFileSync(path.join(NEWS_DIR, slug, 'data.json'), 'utf8'));
    const contentDir = path.join(NEWS_DIR, slug, 'content');
    return {
      slug,
      data,
      hasFB: fs.existsSync(path.join(contentDir, 'facebook.md')),
      hasIG: fs.existsSync(path.join(contentDir, 'instagram.md')),
    };
  }).filter(({ slug, data, hasFB }) => {
    if (!hasFB) return false; // ยังไม่มี content
    if (slugArg)  return slug === slugArg;
    if (dateArg) {
      const pubDate = (data.published_at || data.scraped_at || '').substring(0, 10);
      return pubDate === dateArg;
    }
    if (pending) return data.status === 'approved';
    return false;
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async function main() {
  if (!slugArg && !dateArg && !pending) {
    console.error('❌ ระบุ slug / --date YYYY-MM-DD / --pending ด้วย');
    process.exit(1);
  }

  const items = findItems();

  if (!items.length) {
    const label = slugArg || dateArg || 'pending';
    console.log(`ℹ️  ไม่พบข่าวที่พร้อมโพสต์ (${label})`);
    process.exit(0);  // ออกปกติ — ไม่มีข่าวรอโพสต์ไม่ใช่ error
  }

  const modeLabel = schedule ? 'schedule (ต่อจาก post ล่าสุด +1 ชม.)' : 'โพสต์ทันที';
  console.log(`\n🚀 โพสต์ ${items.length} ข่าว | platform: ${platforms.join(', ')} | mode: ${modeLabel}\n`);

  // คำนวณ baseTime: ต่อจาก schedule ล่าสุดที่ยังอยู่ในอนาคต +1 ชม.
  // ถ้าไม่มี post ที่ schedule ไว้ → ใช้ now +1 ชม.
  const nowUnix       = Math.floor(Date.now() / 1000);
  const lastScheduled = schedule ? getLastScheduledTime() : null;
  const baseTime      = lastScheduled ? lastScheduled + 3600 : nowUnix + 3600;

  if (schedule) {
    const baseDate = new Date(baseTime * 1000);
    const baseStr  = baseDate.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    if (lastScheduled) {
      console.log(`  📌 ต่อจาก post ล่าสุด → เริ่มที่ ${baseStr}\n`);
    } else {
      console.log(`  📌 ไม่มี post ที่รอ → เริ่มที่ ${baseStr}\n`);
    }
  }

  const results = {};

  for (let i = 0; i < items.length; i++) {
    const { slug, data } = items[i];
    const title = (data.title || '').substring(0, 50);
    console.log(`[${i + 1}/${items.length}] ${title}`);

    const scheduledUnix = schedule ? baseTime + i * 3600 : null;
    if (scheduledUnix) {
      const scheduledDate = new Date(scheduledUnix * 1000);
      console.log(`  ⏰ กำหนดโพสต์: ${scheduledDate.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`);
    }

    results[slug] = {};

    if (platforms.includes('fb')) {
      try {
        const postId = await postFacebook(slug, scheduledUnix);
        console.log(`  ✅ Facebook — post_id: ${postId}`);
        results[slug].fb = '✅';
      } catch (e) {
        console.log(`  ❌ Facebook — ${e.message}`);
        results[slug].fb = '❌';
      }
    }

    if (platforms.includes('ig')) {
      try {
        const mediaId = await postInstagram(slug, scheduledUnix);
        console.log(`  ✅ Instagram — media_id: ${mediaId}`);
        results[slug].ig = '✅';
      } catch (e) {
        console.log(`  ❌ Instagram — ${e.message}`);
        results[slug].ig = '❌';
      }
    }

    // อัปเดต status
    if (results[slug].fb === '✅' || results[slug].ig === '✅') {
      data.status   = schedule ? 'scheduled' : 'posted';
      data.posted_at = new Date().toISOString();
      // บันทึก Unix timestamp ของ post ที่ schedule ไว้ → ใช้โดย getLastScheduledTime()
      if (schedule && scheduledUnix) data.scheduled_publish_time = scheduledUnix;
      fs.writeFileSync(path.join(NEWS_DIR, slug, 'data.json'), JSON.stringify(data, null, 2), 'utf8');
    }

    console.log('');
    await sleep(2000);
  }

  // สรุปผล
  console.log('═'.repeat(55));
  console.log('📊 สรุปผล\n');
  const header = 'slug'.padEnd(40) + ' | FB | IG';
  console.log(header);
  console.log('─'.repeat(header.length));
  for (const [slug, r] of Object.entries(results)) {
    console.log(slug.padEnd(40) + ' | ' + (r.fb || '—').padEnd(2) + ' | ' + (r.ig || '—'));
  }
})();
