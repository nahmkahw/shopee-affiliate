/**
 * scrape-offers.js — ดึงสินค้าจาก Shopee Affiliate portal → บันทึกลง input/urls.txt
 *
 * ใช้งาน:
 *   node scrape-offers.js            ดึงทั้งหน้า ข้ามที่มีแล้วใน urls.txt
 *   node scrape-offers.js --dry-run  แสดงรายการที่จะเพิ่ม ไม่บันทึก
 *
 * ต้องการ:
 *   - Chrome เปิดด้วย --remote-debugging-port=9222
 *   - Login Shopee Affiliate และเปิดหน้า product_offer ไว้ใน Chrome แล้ว
 *   - ห้าม navigate ด้วย script (Shopee ตรวจจับเป็น bot)
 */

const { chromium } = require('playwright');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ─── CLI (resolved inside main so tests can control without reloading) ────────

// ─── Parse urls.txt ──────────────────────────────────────────────────────────

function parseUrlsFile() {
  const filePath = path.join('input', 'urls.txt');
  if (!fs.existsSync(filePath)) return { existingItemIds: new Set(), lastDate: null };

  const lines = fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  const existingItemIds = new Set();
  let lastDate = null;

  for (const line of lines) {
    const parts = line.split('|').map(s => s.trim());
    const m = parts[0] && parts[0].match(/shopee\.co\.th\/product\/(\d+)\/(\d+)/);
    if (m) existingItemIds.add(m[2]);
    if (parts[2] && /^\d{4}-\d{2}-\d{2}$/.test(parts[2])) {
      if (!lastDate || parts[2] > lastDate) lastDate = parts[2];
    }
  }

  return { existingItemIds, lastDate };
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

// ─── Follow HTTP redirect to resolve short link → full product URL ─────────

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

function resolveRedirect(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : require('http');
    try {
      const req = mod.get(url, { headers: { 'User-Agent': UA } }, (res) => {
        const loc = res.headers['location'];
        res.resume();
        if (loc) resolve(loc.split('?')[0]); // ตัด query string ออก
        else     resolve(url);
      });
      req.on('error', () => resolve(null));
      req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    } catch { resolve(null); }
  });
}

async function getProductUrl(shortLink) {
  let current = shortLink;
  for (let i = 0; i < 5; i++) {
    const next = await resolveRedirect(current);
    if (!next || next === current) break;
    // format 1: shopee.co.th/product/{shop_id}/{item_id}
    if (/shopee\.co\.th\/product\/\d+\/\d+/.test(next)) return next;
    // format 2: shopee.co.th/{name}/{shop_id}/{item_id}
    if (/shopee\.co\.th\/[^\/]+\/\d+\/\d+/.test(next)) return next;
    // format 3: shopee.co.th/name.i.{item_id}.{shop_id}
    if (/shopee\.co\.th\/.+\.i\.\d+\.\d+/.test(next))  return next;
    current = next;
  }
  return null;
}

function extractIds(url) {
  // format 1: shopee.co.th/product/{shop_id}/{item_id}
  let m = url.match(/shopee\.co\.th\/product\/(\d+)\/(\d+)/);
  if (m) return { shop_id: m[1], item_id: m[2] };
  // format 2: shopee.co.th/{any_name}/{shop_id}/{item_id}  (e.g. /opaanlp/1618596749/54256553392)
  m = url.match(/shopee\.co\.th\/[^\/]+\/(\d+)\/(\d+)/);
  if (m) return { shop_id: m[1], item_id: m[2] };
  // format 3: shopee.co.th/name.i.{item_id}.{shop_id}
  m = url.match(/\.i\.(\d+)\.(\d+)/);
  if (m) return { shop_id: m[2], item_id: m[1] };
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(opts = {}) {
  const args     = opts.args !== undefined ? opts.args : process.argv.slice(2);
  const isDryRun = opts.dryRun !== undefined ? opts.dryRun : args.includes('--dry-run');

  const { existingItemIds, lastDate } = parseUrlsFile();
  const baseDate = lastDate || new Date().toISOString().split('T')[0];

  // ── Connect Chrome ──────────────────────────────────────────────────────────
  console.log('\n🔌 กำลัง connect Chrome ที่ port 9222...');
  let browser;
  try {
    browser = await chromium.connectOverCDP('http://localhost:9222');
  } catch (e) {
    console.error('❌ connect Chrome ไม่ได้:', e.message);
    console.error('\n   วิธีเปิด Chrome debug mode:');
    console.error('   1. ปิด Chrome ทั้งหมดก่อน');
    console.error('   2. กด Win+R แล้วพิมพ์:');
    console.error('      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\\ChromeDebug"');
    console.error('   3. Login Shopee Affiliate ใน Chrome ที่เปิดขึ้นมา');
    console.error('   4. ไปที่ https://affiliate.shopee.co.th/offer/product_offer ด้วยตัวเอง');
    console.error('   5. รัน script ใหม่อีกครั้ง\n');
    process.exit(1);
  }

  try {
    const [ctx] = browser.contexts();
    if (!ctx) {
      console.error('❌ Chrome ไม่มี context — ตรวจสอบว่าเปิดแท็บอยู่');
      process.exit(1);
      return;
    }
    const pages  = ctx.pages();

    // ── หาแท็บที่มี affiliate portal เปิดอยู่แล้ว (ไม่ navigate เอง!) ─────────
    const page = pages.find(p =>
      p.url().includes('affiliate.shopee.co.th/offer/product_offer') &&
      !p.url().includes('captcha') &&
      !p.url().includes('verify')
    );

    if (!page) {
      const openTabs = pages.map((p, i) => `  [${i}] ${p.url().substring(0, 70)}`).join('\n');
      console.error('❌ ไม่พบแท็บที่เปิดหน้า affiliate product offer\n');
      console.error('   แท็บที่เปิดอยู่ตอนนี้:');
      console.error(openTabs || '   (ไม่มีแท็บ)');
      console.error('\n   ✅ วิธีแก้:');
      console.error('   1. เปิด Chrome ไปที่ https://affiliate.shopee.co.th/offer/product_offer ด้วยตัวเอง');
      console.error('   2. รอให้สินค้าโหลดครบ (เห็นรายการสินค้า)');
      console.error('   3. รัน script ใหม่อีกครั้ง\n');
      process.exit(1);
      return;
    }

    console.log('✅ พบแท็บ:', page.url().substring(0, 70));
    await page.waitForTimeout(1000);

    // ── Scan item_ids จากหน้าที่โหลดอยู่ ──────────────────────────────────────
    console.log('🔍 สแกนสินค้าบนหน้า...');
    const allProducts = await page.evaluate(
      /* istanbul ignore next -- browser DOM code, runs via page.evaluate() */
      () => {
        const seen = new Set();
        const results = [];
        for (const a of document.querySelectorAll('a[href*="/offer/product_offer/"]')) {
          const m = a.href.match(/product_offer\/(\d+)/);
          if (!m || seen.has(m[1])) continue;
          seen.add(m[1]);
          results.push({ item_id: m[1] });
        }
        return results;
      }
    );

    if (!allProducts.length) {
      console.error('❌ ไม่พบสินค้าบนหน้า');
      console.error('   → ลอง scroll หน้าลงแล้วรันใหม่ หรือตรวจสอบว่าหน้าโหลดครบแล้ว');
      process.exit(1);
      return;
    }

    // Filter ใหม่ vs มีแล้ว
    const newProducts     = allProducts.filter(p => !existingItemIds.has(p.item_id));
    const skippedProducts = allProducts.filter(p =>  existingItemIds.has(p.item_id));

    // Assign post_dates
    let dateOffset = 0;
    const pending = newProducts.map(p => {
      dateOffset++;
      return { ...p, post_date: addDays(baseDate, dateOffset) };
    });

    // ── Print Summary ───────────────────────────────────────────────────────────
    console.log(`\n📋 พบสินค้า ${allProducts.length} รายการ (ใหม่ ${newProducts.length}, ข้าม ${skippedProducts.length}):\n`);
    for (const p of pending) {
      console.log(`  [${p.post_date}] ${p.item_id}  (ใหม่)`);
    }
    for (const p of skippedProducts) {
      console.log(`  [---] ${p.item_id}  ⏭ มีแล้วใน urls.txt`);
    }

    if (!pending.length) {
      console.log('\n✓ ไม่มีสินค้าใหม่ที่ต้องเพิ่ม');
      return;
    }

    if (isDryRun) {
      console.log('\n✓ Dry-run — ไม่บันทึก');
      return;
    }

    // ── Get "เอา ลิงก์" buttons ─────────────────────────────────────────────────
    // ปุ่มบน Shopee Affiliate อาจมีชื่อต่างกัน — ลองทุก keyword
    const BTN_KEYWORDS = ['เอา ลิงก์', 'เอาลิงก์', 'เอาลิงค์', 'Get Link', 'รับลิงก์', 'รับลิงค์'];

    const { buttonCount, productOrder } = await page.evaluate(
      /* istanbul ignore next -- browser DOM code, runs via page.evaluate() */
      (keywords) => {
        const seen = new Set();
        const productOrder = [];
        for (const a of document.querySelectorAll('a[href*="/offer/product_offer/"]')) {
          const m = a.href.match(/product_offer\/(\d+)/);
          if (m && !seen.has(m[1])) { seen.add(m[1]); productOrder.push(m[1]); }
        }
        const btns = [...document.querySelectorAll('button,[role="button"]')]
          .filter(b => keywords.some(k => (b.innerText || '').trim().includes(k)));
        return { buttonCount: btns.length, productOrder };
      },
      BTN_KEYWORDS
    );

    console.log(`\n  🔢 ปุ่ม "เอา ลิงก์": ${buttonCount} ปุ่ม | สินค้า: ${productOrder.length} รายการ\n`);

    if (buttonCount === 0) {
      console.error('❌ ไม่พบปุ่ม "เอา ลิงก์" — ชื่อปุ่มอาจเปลี่ยนแปลง');
      console.error('   → เปิดหน้าใน Chrome แล้วดูชื่อปุ่มที่ใช้ดึง affiliate link');
      console.error('   → แจ้งชื่อปุ่มเพื่ออัปเดต BTN_KEYWORDS ใน scrape-offers.js');
      process.exit(1);
      return;
    }

    // ── คลิกปุ่มและดึง short link ─────────────────────────────────────────────
    const results = [];

    for (let i = 0; i < pending.length; i++) {
      const p = pending[i];
      const btnIndex = productOrder.indexOf(p.item_id);
      if (btnIndex === -1) {
        console.log(`  ⚠️  [${p.item_id}] ไม่พบใน DOM`);
        continue;
      }

      process.stdout.write(`  [${i+1}/${pending.length}] ${p.item_id} ... `);

      try {
        // คลิกปุ่มที่ index ตรงกับ product
        const clickOk = await page.evaluate(
          /* istanbul ignore next -- browser DOM code, runs via page.evaluate() */
          ({ keywords, idx }) => {
            const btns = [...document.querySelectorAll('button,[role="button"]')]
              .filter(b => keywords.some(k => (b.innerText || '').trim().includes(k)));
            if (idx < btns.length) {
              btns[idx].scrollIntoView({ block: 'center' });
              btns[idx].click();
              return true;
            }
            return false;
          },
          { keywords: BTN_KEYWORDS, idx: btnIndex }
        );

        if (!clickOk) { console.log('⚠️  คลิกปุ่มไม่ได้'); continue; }

        await page.waitForTimeout(2000);

        // อ่าน short link จาก modal input
        const shortLink = await page.evaluate(
          /* istanbul ignore next -- browser DOM code, runs via page.evaluate() */
          () => {
            const modalSels = ['[role="dialog"]', '[class*="modal"]', '[class*="popup"]', '[class*="dialog"]', '[class*="share"]'];
            let container = null;
            for (const sel of modalSels) {
              const el = document.querySelector(sel);
              if (el && el.getBoundingClientRect().width > 10) { container = el; break; }
            }
            const root = container || document;
            for (const inp of root.querySelectorAll('input,textarea')) {
              const v = (inp.value || inp.defaultValue || '').trim();
              if (v && (v.includes('s.shopee') || v.includes('shopee.co.th'))) return v;
            }
            // fallback: ทั้งหน้า
            for (const inp of document.querySelectorAll('input,textarea')) {
              const v = (inp.value || '').trim();
              if (v && v.includes('s.shopee')) return v;
            }
            return null;
          }
        );

        // ปิด modal
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        await page.evaluate(
          /* istanbul ignore next -- browser DOM code, runs via page.evaluate() */
          () => {
            for (const sel of ['[role="dialog"] [class*="close"]','[class*="modal"] [class*="close"]','[aria-label="Close"]']) {
              const btn = document.querySelector(sel);
              if (btn) { btn.click(); break; }
            }
          }
        );
        await page.waitForTimeout(400);

        if (!shortLink) { console.log('⚠️  อ่านลิงก์ไม่ได้'); continue; }

        // resolve short link → full URL (เพื่อหา shop_id)
        process.stdout.write(`${shortLink} → resolve... `);
        const fullUrl = await getProductUrl(shortLink);
        const ids     = fullUrl ? extractIds(fullUrl) : null;

        if (ids) {
          const productUrl = `https://shopee.co.th/product/${ids.shop_id}/${ids.item_id}`;
          console.log(`✅\n    ${productUrl}`);
          results.push({ ...p, short_link: shortLink, product_url: productUrl, ...ids });
        } else {
          // fallback: ใช้ short link เป็น product_url แต่แจ้งเตือน
          console.log('⚠️  resolve ไม่ได้ — บันทึก short link แทน');
          results.push({ ...p, short_link: shortLink, product_url: shortLink, item_id: p.item_id, shop_id: '' });
        }

      } catch (e) {
        console.log(`❌ ${e.message.split('\n')[0]}`);
      }

      await page.waitForTimeout(1200);
    }

    // ── Save to urls.txt ────────────────────────────────────────────────────────
    if (!results.length) {
      console.log('\n⚠️  ไม่ได้ affiliate link เลย');
      process.exit(1);
      return;
    }

    const urlsFile = path.join('input', 'urls.txt');
    let existing = fs.existsSync(urlsFile) ? fs.readFileSync(urlsFile, 'utf8') : '';
    if (existing && !existing.endsWith('\n')) existing += '\n';
    const newLines = results.map(r =>
      `${r.product_url}  | ${r.short_link}  | ${r.post_date}`
    ).join('\n');
    fs.writeFileSync(urlsFile, existing + newLines + '\n', 'utf8');

    // ── Summary ─────────────────────────────────────────────────────────────────
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`✅ เพิ่ม ${results.length} สินค้าลง input/urls.txt\n`);
    console.log('post_date   | item_id      | product_url');
    console.log('------------|--------------|' + '─'.repeat(40));
    for (const r of results) {
      console.log(`${r.post_date}  | ${r.item_id.padEnd(12)} | ${r.product_url}`);
    }

    if (pending.length > results.length) {
      const missed = pending.filter(p => !results.find(r => r.item_id === p.item_id));
      console.log(`\n⚠️  ดึงไม่ได้ ${missed.length} รายการ (post_date ถูกข้าม → เพิ่มด้วยมือได้):`);
      missed.forEach(p => console.log(`   - ${p.item_id}`));
    }

    console.log('\n📌 ขั้นตอนต่อไป:');
    console.log('   /ดึงสินค้า  — ดึงรายละเอียดสินค้าและรูปจาก Shopee');

  } finally {
    await browser.close();
  }
}

/* istanbul ignore next */
if (require.main === module) {
  main().catch(e => { console.error('❌', e.message); process.exit(1); });
}

module.exports = { parseUrlsFile, addDays, resolveRedirect, getProductUrl, extractIds, main };
