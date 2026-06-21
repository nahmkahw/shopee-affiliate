'use strict';

/**
 * Shared RSS news scraper for manao (AI News) and makrut (Sport News) pipelines.
 * Pipeline-specific config injected via { rssUrl, label }.
 */

const https    = require('https');
const http     = require('http');
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

function todayBangkok() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    lib.get({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml,text/xml,text/html' },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return resolve(httpsGet(res.headers.location));
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => resolve({ status: res.statusCode, body: buf, headers: res.headers }));
    }).on('error', reject);
  });
}

function resolveRedirect(url) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'HEAD' }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
          resolve(res.headers.location);
        else resolve(url);
      });
      req.setTimeout(8000, () => { req.destroy(); resolve(url); });
      req.on('error', () => resolve(url));
      req.end();
    } catch { resolve(url); }
  });
}

function slugify(title, date) {
  const d = date ? date.substring(0, 10) : '';
  const s = title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
  return d ? `${d}-${s}` : s;
}

function parseRSS(xml) {
  const items = [];
  const itemMatches = [...xml.matchAll(/<item>([\s\S]+?)<\/item>/g)];
  for (const m of itemMatches) {
    const block = m[1];
    const title   = (block.match(/<title><!\[CDATA\[(.+?)\]\]>/)?.[1] || block.match(/<title>(.+?)<\/title>/)?.[1] || '').trim();
    const link    = (block.match(/<link>([^<]+)<\/link>/)?.[1] || '').trim();
    const pubDate = (block.match(/<pubDate>(.+?)<\/pubDate>/)?.[1] || '').trim();
    const desc    = (block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] || '').replace(/<[^>]+>/g, '').trim();
    if (!title || title.length < 15) continue;
    items.push({ title: title.replace(/\s*[-|]\s*[A-Z][A-Za-z0-9 ]{1,25}$/, '').trim(), link, pubDate, desc });
  }
  return items;
}

function loadSeenUrls(inputFile) {
  if (!fs.existsSync(inputFile)) return new Set();
  return new Set(
    fs.readFileSync(inputFile, 'utf8').split('\n')
      .filter(l => l.trim() && !l.startsWith('#'))
      .map(l => l.split(' | ')[2]?.trim())
      .filter(Boolean)
  );
}

function appendToInput(inputFile, articles) {
  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).replace(' ', 'T');
  const lines = articles.map(a => `${a.published_at} | ${a.title} | ${a.url}`);
  fs.appendFileSync(inputFile, `\n# ดึงข้อมูลเมื่อ ${now} (${articles.length} ข่าวใหม่)\n` + lines.join('\n') + '\n', 'utf8');
}

async function fetchArticleDetail(page, googleUrl) {
  try {
    await page.goto(googleUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(2000);
    const finalUrl = page.url();
    const { body, ogImage } = await page.evaluate(() => {
      const sel = ['[data-testid^="paragraph"]', '[class*="article-body"] p', 'article p', '.body-text p'];
      let body = '';
      for (const s of sel) {
        const els = [...document.querySelectorAll(s)];
        if (els.length > 1) { body = els.map(p => p.textContent.trim()).filter(t => t.length > 30).slice(0, 8).join('\n\n'); break; }
      }
      if (!body) {
        body = [...document.querySelectorAll('p')]
          .map(p => p.textContent.trim()).filter(t => t.length > 60).slice(0, 6).join('\n\n');
      }
      const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
      return { body, ogImage };
    });
    return { url: finalUrl, body, ogImage };
  } catch { return { url: googleUrl, body: '', ogImage: '' }; }
}

async function runScraper({ rssUrl, label, pipelineDir }) {
  const NEWS_DIR   = path.join(pipelineDir, 'news');
  const INPUT_FILE = path.join(pipelineDir, 'input.txt');

  const args     = process.argv.slice(2);
  const force    = args.includes('--force');
  const dryRun   = args.includes('--dry-run');
  const limitIdx = args.findIndex(a => a === '--limit');
  const limit    = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) || 6 : 6;

  console.log(`\n📡 ${label} (Google News RSS)\n`);

  process.stdout.write('🌐 ดึง RSS feed...');
  let rssBody;
  try {
    const res = await httpsGet(rssUrl);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    rssBody = res.body;
    process.stdout.write(' ✓\n');
  } catch (e) {
    console.error('\n❌ ดึง RSS ไม่สำเร็จ:', e.message);
    process.exit(1);
  }

  const today = todayBangkok();
  console.log(`📅 กรองเฉพาะวันที่: ${today} (Asia/Bangkok)\n`);

  const allItems = parseRSS(rssBody);
  const todayItems = allItems.filter(item => {
    if (!item.pubDate) return false;
    const pub = new Date(item.pubDate).toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    return pub === today;
  });
  const items = todayItems.slice(0, limit);

  if (!allItems.length) { console.log('⚠️  ไม่พบข่าวใน RSS'); process.exit(0); }
  if (!items.length) {
    console.log(`⚠️  ไม่พบข่าวในวันที่ ${today} (RSS มี ${allItems.length} ข่าวแต่เป็นวันอื่น)`);
    process.exit(0);
  }
  console.log(`📋 พบข่าวทั้งหมด ${allItems.length} รายการ → วันนี้ ${todayItems.length} รายการ (แสดง ${items.length})\n`);

  const seenUrls = loadSeenUrls(INPUT_FILE);
  const toProcess = [];

  for (const item of items) {
    process.stdout.write('  🔗 resolve URL...');
    const realUrl = await resolveRedirect(item.link);
    process.stdout.write(' ✓\n');

    const pubDate = item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString();
    const slug    = slugify(item.title, pubDate);
    const dataFile = path.join(NEWS_DIR, slug, 'data.json');

    if (!force && (fs.existsSync(dataFile) || seenUrls.has(realUrl))) {
      console.log(`  ⏭  ข้าม: ${item.title.substring(0, 60)}`);
      continue;
    }
    toProcess.push({ slug, title: item.title, url: realUrl, googleUrl: item.link, published_at: pubDate, desc: item.desc, dataFile });
    seenUrls.add(realUrl);
  }

  if (!toProcess.length) { console.log('\n✅ ไม่มีข่าวใหม่ ทุกรายการดึงไปแล้ว'); process.exit(0); }
  console.log(`\n📰 ดึงเนื้อหา ${toProcess.length} ข่าวใหม่...\n`);

  let browser, page;
  if (!dryRun) {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    });
    page = await context.newPage();
  }

  const saved = [];
  for (const art of toProcess) {
    console.log(`📰 ${art.title.substring(0, 70)}`);
    console.log(`   URL: ${art.url}`);

    let body = art.desc || '', resolvedUrl = art.url, ogImage = '';
    if (!dryRun && page) {
      process.stdout.write('   📄 resolve URL + ดึงเนื้อหา...');
      const detail = await fetchArticleDetail(page, art.googleUrl);
      resolvedUrl = detail.url;
      body = detail.body || art.desc || '';
      ogImage = detail.ogImage || '';
      process.stdout.write(` ✓ ${body.length > 50 ? '(มีเนื้อหา)' : '(ใช้ desc)'}${ogImage ? ' 🖼' : ''}\n`);
      console.log(`   → ${resolvedUrl}`);
    }

    const existing = fs.existsSync(art.dataFile) ? JSON.parse(fs.readFileSync(art.dataFile, 'utf8')) : {};
    const data = {
      news_id: art.slug, title: art.title, url: resolvedUrl, google_url: art.googleUrl,
      published_at: art.published_at, scraped_at: new Date().toISOString(),
      body, og_image: ogImage || existing.og_image || '',
      status: existing.status && existing.status !== 'scraped' ? existing.status : 'scraped',
      ...(existing.posted_at ? { posted_at: existing.posted_at } : {}),
    };

    if (!dryRun) {
      fs.mkdirSync(path.join(NEWS_DIR, art.slug), { recursive: true });
      fs.writeFileSync(art.dataFile, JSON.stringify(data, null, 2), 'utf8');
    }
    saved.push(data);
    console.log('');
  }

  if (browser) await browser.close();
  if (!dryRun && saved.length) appendToInput(INPUT_FILE, saved);

  ['_test_fetch.js', '_test_rss.js'].forEach(f => {
    const fp = path.join(pipelineDir, f);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  });

  console.log('═'.repeat(55));
  console.log(`✅ เสร็จแล้ว: บันทึก ${saved.length} ข่าวใหม่`);
  if (!dryRun && saved.length) {
    console.log('📝 input.txt อัปเดตแล้ว');
    console.log('📁 ดูข้อมูลได้ที่: news/{slug}/data.json');
    console.log('\nขั้นตอนถัดไป: node generate.js');
  }
  if (dryRun) console.log('⚠️  dry-run mode: ไม่ได้บันทึกจริง');
}

module.exports = { runScraper };
