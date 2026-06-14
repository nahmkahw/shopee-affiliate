/**
 * scrape.js — Shopee Affiliate Product Scraper
 *
 * ใช้งาน:
 *   node scrape.js            ดึงสินค้าที่ยังไม่มี data.json ทุกรายการ
 *   node scrape.js --force    ดึงใหม่ทั้งหมด แม้มี data.json แล้ว
 *   node scrape.js --dry-run  แสดงรายการโดยไม่ดึงจริง
 */

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');
const https = require('https');

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isForce  = args.includes('--force');

// ─── Parse urls.txt ──────────────────────────────────────────────────────────

function parseUrlsFile(filePath) {
  const today = new Date().toISOString().split('T')[0];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map((line, i) => {
      const [rawUrl, rawShort, rawDate] = line.split('|').map(s => s.trim());
      const m = rawUrl.match(/shopee\.co\.th\/product\/(\d+)\/(\d+)/);
      if (!m) { console.warn(`[บรรทัด ${i+1}] parse URL ไม่ได้: ${rawUrl}`); return null; }
      return {
        product_url: rawUrl,
        short:       rawShort || null,
        shop_id:     m[1],
        item_id:     m[2],
        post_date:   rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : today,
      };
    })
    .filter(Boolean);
}

// ─── Image Downloader ─────────────────────────────────────────────────────────

function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => { res.pipe(file); file.on('finish', () => { file.close(); resolve(); }); })
         .on('error', e => { fs.unlink(dest, () => {}); reject(e); });
  });
}

async function downloadImages(images, dir) {
  let n = 0;
  for (let i = 0; i < images.length; i++) {
    try { await downloadImage(images[i], path.join(dir, `${i + 1}.jpg`)); n++; } catch { /* skip */ }
  }
  return n;
}

// ─── DOM Extraction (runs inside browser) ────────────────────────────────────

function extractProductData() {
  const all = [...document.querySelectorAll('*')];
  const title = (document.querySelector('h1') || {}).innerText || '';

  const priceEls = all
    .filter(e => {
      if (e.children.length > 0 || ['SCRIPT','STYLE','NOSCRIPT'].includes(e.tagName)) return false;
      return /^฿[\d,]+(\s*-\s*฿[\d,]+)?$/.test((e.innerText || '').trim());
    })
    .map(e => {
      const cs = window.getComputedStyle(e);
      const txt = (e.innerText || '').trim();
      const m = txt.match(/฿([\d,]+)/);
      return { num: m ? parseInt(m[1].replace(/,/g, '')) : 0,
               size: parseFloat(cs.fontSize) || 0,
               strike: (cs.textDecoration || '').indexOf('line-through') >= 0 };
    })
    .filter(p => p.size >= 12 && p.num > 0)
    .sort((a, b) => b.size - a.size);

  const priceEl    = priceEls.find(p => !p.strike);
  const originalEl = priceEls.find(p =>  p.strike);
  const price          = priceEl    ? '฿' + priceEl.num.toLocaleString()    : null;
  const original_price = originalEl ? '฿' + originalEl.num.toLocaleString() : null;

  const discEl = all.find(e => {
    if (e.children.length > 0) return false;
    const t = (e.innerText || '').trim();
    return /^-?\d{1,2}%/.test(t) && t.length < 15;
  });
  let discount = discEl ? discEl.innerText.trim() : null;
  if (!discount && price && original_price) {
    const c = parseInt(price.replace(/[฿,]/g, '')), o = parseInt(original_price.replace(/[฿,]/g, ''));
    if (o > c) discount = Math.round((1 - c / o) * 100) + '%';
  }

  const ratingEl = all.find(e => e.children.length === 0 && /^\d\.\d$/.test((e.innerText || '').trim()));
  const rating = ratingEl ? ratingEl.innerText.trim() : null;

  const rvEl = all.find(e => {
    if (e.children.length > 0 || e.tagName === 'SCRIPT') return false;
    const t = (e.innerText || '').trim();
    return /[\d,.k]+\s*(รีวิว|Ratings?)/i.test(t) && t.length < 40;
  });
  const review_count = rvEl ? rvEl.innerText.trim() : null;

  const soldEl = all.find(e => {
    if (e.children.length > 0 || e.tagName === 'SCRIPT') return false;
    const t = (e.innerText || '').trim();
    return /(ขายแล้ว|Sold)/i.test(t) && t.length < 60 && /[\d,.k]/.test(t);
  });
  const sold = soldEl ? soldEl.innerText.trim() : null;

  const shopLinks = [...document.querySelectorAll('a[href*="/shop/"]')].filter(a => {
    const txt = (a.innerText || '').trim();
    const rect = a.getBoundingClientRect();
    return txt.length > 1 && txt.length < 60 && !txt.includes('฿') && !/^\d+$/.test(txt) && rect.top > 100;
  });
  const shop_name = shopLinks[0] ? shopLinks[0].innerText.trim() : null;

  const descCands = all.filter(e => {
    if (['SCRIPT','STYLE'].includes(e.tagName) || e.children.length > 0) return false;
    const t = e.innerText || '';
    return t.length > 150 && !t.includes('window.__') && !t.includes('function(') && !/^[{\["']/.test(t.trim());
  }).sort((a, b) => (b.innerText || '').length - (a.innerText || '').length);
  const description = descCands[0] ? descCands[0].innerText.trim().slice(0, 1200) : null;

  const images = [...document.querySelectorAll('img')]
    .map(e => e.src || (e.dataset || {}).src || '')
    .filter(s => s && s.startsWith('http') && (
      s.includes('isekai.sea.com') || s.includes('down-th') ||
      s.includes('susercontent')   || s.includes('cf.shopee')))
    .filter((v, i, a) => a.indexOf(v) === i)
    .filter(s => !s.includes('icon') && !s.includes('avatar') && !s.includes('logo'))
    .slice(0, 6);

  let reviews = [];
  for (const sel of ['[class*="shopee-product-comment"] [class*="content"]',
                     '[class*="comment-list"] [class*="content"]', '[class*="review"] p']) {
    const els = [...document.querySelectorAll(sel)].filter(e => (e.innerText || '').trim().length > 10);
    if (els.length) { reviews = els.slice(0, 3).map(e => e.innerText.trim().slice(0, 250)); break; }
  }

  return { title: title.trim(), price, original_price, discount, rating,
           review_count, sold, shop_name, description, images, reviews };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async function main() {
  const urlsFile = path.join('input', 'urls.txt');
  if (!fs.existsSync(urlsFile)) { console.error('❌ ไม่พบ input/urls.txt'); process.exit(1); }

  const all     = parseUrlsFile(urlsFile);
  const pending = isForce ? all : all.filter(p => !fs.existsSync(path.join('products', p.item_id, 'data.json')));
  const skipped = all.length - pending.length;

  // Show list
  console.log(`\n📋 พบสินค้า ${all.length} รายการ (ดึงใหม่ ${pending.length}${skipped ? `, ข้าม ${skipped}` : ''}):\n`);
  all.forEach((p, i) => {
    const done = !isForce && fs.existsSync(path.join('products', p.item_id, 'data.json'));
    console.log(`  ${i+1}. [${p.post_date}] ${p.item_id}  ${p.short || ''}${done ? '  ⏭ ข้าม' : ''}`);
  });

  if (skipped) console.log(`\n  ใช้ --force เพื่อดึงใหม่ทั้งหมด`);
  if (!pending.length) { console.log('\n✓ ไม่มีสินค้าที่ต้องดึง'); return; }
  if (isDryRun) { console.log('\n✓ Dry-run เสร็จ ไม่ได้ดึงข้อมูลจริง'); return; }

  // Connect Chrome
  console.log('\n🔌 กำลัง connect Chrome ที่ port 9222...');
  let browser;
  try {
    browser = await chromium.connectOverCDP('http://localhost:9222');
  } catch (e) {
    console.error('❌ connect Chrome ไม่ได้:', e.message);
    console.error('   → เปิด Chrome พร้อม --remote-debugging-port=9222 ก่อน (ดู GUIDE.md)');
    process.exit(1);
  }
  const [ctx] = browser.contexts();
  const page  = ctx.pages()[0];
  console.log('✅ Connected!\n');

  let ok = 0, err = 0;

  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    console.log(`[${i+1}/${pending.length}] ${p.item_id}  (post_date: ${p.post_date})`);
    try {
      await page.goto(p.product_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => { const h = document.querySelector('h1'); return h && h.innerText.trim().length > 5; }, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(3000);
      await page.evaluate(() => window.scrollBy(0, 700));
      await page.waitForTimeout(1500);
      await page.evaluate(() => window.scrollBy(0, 700));
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);

      const data = await page.evaluate(extractProductData);

      const dir = path.join('products', p.item_id);
      fs.mkdirSync(path.join(dir, 'images'),  { recursive: true });
      fs.mkdirSync(path.join(dir, 'content'), { recursive: true });

      const result = { item_id: p.item_id, shop_id: p.shop_id,
                       affiliate_short_link: p.short, product_url: p.product_url,
                       post_date: p.post_date, ...data,
                       status: data.title ? 'scraped' : 'partial' };
      fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(result, null, 2), 'utf8');

      const imgCount = await downloadImages(data.images || [], path.join(dir, 'images'));

      console.log(`  ✅ ${String(data.title || '').substring(0, 55)}`);
      console.log(`     ราคา: ${data.price} | เดิม: ${data.original_price} | ลด: ${data.discount}`);
      console.log(`     ⭐ ${data.rating} | ร้าน: ${data.shop_name} | รูป: ${imgCount}`);
      ok++;
    } catch (e) {
      console.log(`  ❌ ${e.message.split('\n')[0]}`);
      err++;
    }
    if (i < pending.length - 1) await page.waitForTimeout(2000);
  }

  await browser.close();

  console.log(`\n✓ เสร็จสิ้น: สำเร็จ ${ok}/${pending.length}${err ? ` (ล้มเหลว ${err})` : ''}`);
  console.log('ขั้นตอนต่อไป: /สร้าง-content');
})();
