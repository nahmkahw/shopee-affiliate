'use strict';

/**
 * Shared editor-agent logic for manao (Reuters AI) and makrut (FIFA football) pipelines.
 * Domain-specific prompt rules are injected via `domainRules` array.
 */

const fs   = require('fs');
const path = require('path');
const { fixMixedThaiEng } = require('./thai-text');

const MIN_SCORE   = 0;
const MIN_CHARS   = 80;
const RETRY_LIMIT = 2;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function clickCookieConsent(page) {
  const selectors = [
    '#onetrust-accept-btn-handler',
    'button#onetrust-accept-btn-handler',
    '[class*="onetrust"] button[class*="accept"]',
    'button[id*="accept"]',
    'button[class*="accept-all"]',
    'button[class*="acceptAll"]',
    '[data-testid*="cookie"] button',
    '[class*="cookie-banner"] button',
    '[class*="cookie-consent"] button',
    '[id*="cookie-consent"] button',
    'button:has-text("Accept all")',
    'button:has-text("Accept All")',
    'button:has-text("Accept cookies")',
    'button:has-text("Accept Cookies")',
    'button:has-text("I Accept")',
    'button:has-text("I agree")',
    'button:has-text("Agree and proceed")',
    'button:has-text("Got it")',
    'button:has-text("OK")',
  ];
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) { await el.click(); return true; }
    } catch { /* try next selector */ }
  }
  return false;
}

async function fetchBodyDirect(url) {
  if (!url) return '';
  let browser;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);
    const clicked = await clickCookieConsent(page);
    if (clicked) {
      process.stdout.write(' [cookie ✓]');
      await page.waitForTimeout(4000);
    } else {
      await page.waitForTimeout(7000);
    }
    const body = await page.evaluate(() => {
      const sels = ['[data-testid^="paragraph"]', '[class*="article-body"] p', 'article p', '.body-text p'];
      for (const s of sels) {
        const els = [...document.querySelectorAll(s)];
        if (els.length > 1) return els.map(p => p.textContent.trim()).filter(t => t.length > 30).slice(0, 8).join('\n\n');
      }
      return [...document.querySelectorAll('p')]
        .map(p => p.textContent.trim())
        .filter(t => t.length > 60)
        .slice(0, 6)
        .join('\n\n');
    });
    return body || '';
  } catch { return ''; }
  finally { if (browser) await browser.close(); }
}


function cleanText(text) {
  return fixMixedThaiEng(
    text
      .split('\n')
      .filter(line => {
        const cjk = (line.match(/[一-鿿぀-ヿ가-힯]/g) || []).length;
        if (cjk > 2) return false;
        if (/^[A-Z\s:()\-_]{15,}$/.test(line.trim())) return false;
        return true;
      })
      .join('\n')
      .replace(/^\[[^\]]+\]\s*/gm, '')
      .replace(/^-{3,}\s*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

function buildPrompt(data, domainRules) {
  const title = data.title || '';
  const date  = (data.published_at || '').substring(0, 10);
  const body  = (data.body || '').substring(0, 1500);
  const rules = domainRules.map(r => `- ${r}`).join('\n');

  return `สรุปข่าวต่อไปนี้เป็นภาษาไทย 180-220 คำ

ข่าว: ${title}
วันที่: ${date}
${body ? 'เนื้อหา:\n' + body : '(ไม่มีเนื้อหาเพิ่มเติม)'}

กฎ:
${rules}
- ห้ามมีอักษรจีน ญี่ปุ่น หรือเกาหลี
- รายงานข้อเท็จจริงตามข่าว ห้ามแต่งเอง
- ไม่ต้องมีหัวข้อ ไม่ต้องมี hashtag ไม่ต้องมี emoji
- ตอบเฉพาะบทความ ไม่ต้องมีคำอธิบายอื่น`;
}

function getItems(newsDir, { force, slugArg, dateArg }) {
  if (!fs.existsSync(newsDir)) return [];
  return fs.readdirSync(newsDir)
    .filter(d => fs.existsSync(path.join(newsDir, d, 'data.json')))
    .map(slug => {
      const data       = JSON.parse(fs.readFileSync(path.join(newsDir, slug, 'data.json'), 'utf8'));
      const masterPath = path.join(newsDir, slug, 'content', 'master.md');
      return { slug, data, hasMaster: fs.existsSync(masterPath) };
    })
    .filter(({ slug, data, hasMaster }) => {
      if (data.status === 'posted')                return false;
      if ((data.filter_score ?? 100) < MIN_SCORE)  return false;
      if (hasMaster && !force)                     return false;
      if (slugArg && slug !== slugArg)             return false;
      if (dateArg) {
        const pub = (data.published_at || data.scraped_at || '').substring(0, 10);
        return pub === dateArg;
      }
      return true;
    });
}

async function runEditorAgent({ newsDir, ollamaChat, checkOllama, domainRules }) {
  const args    = process.argv.slice(2);
  const force   = args.includes('--force');
  const dateIdx = args.findIndex(a => a === '--date');
  const dateArg = dateIdx !== -1 ? args[dateIdx + 1] : null;
  const slugArg = args.find(a => !a.startsWith('--') && !/^\d{4}-\d{2}-\d{2}$/.test(a));

  console.log('\n✏️  Agent 3 — เขียนบทความ (editor-agent)\n');

  try {
    await checkOllama();
    console.log('✅ Ollama พร้อมใช้\n');
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }

  const items = getItems(newsDir, { force, slugArg, dateArg });
  if (!items.length) {
    console.log('✅ master.md ครบทุกข่าวแล้ว (ใช้ --force เพื่อเขียนใหม่)');
    process.exit(0);
  }

  console.log(`📋 ต้องเขียน: ${items.length} รายการ\n`);
  let ok = 0, fail = 0;

  for (const { slug, data } of items) {
    const title    = (data.title || '').substring(0, 60);
    const dataPath = path.join(newsDir, slug, 'data.json');
    process.stdout.write(`  📰 ${title}\n`);

    if (!data.body || data.body.trim() === '') {
      const fetchUrl = data.google_url || data.url;
      process.stdout.write(`     ⟳ body ว่าง — ลอง fetch ผ่าน ${data.google_url ? 'Google News URL' : 'Reuters URL'}...\n`);
      const fetched = await fetchBodyDirect(fetchUrl);
      if (fetched && fetched.trim().length > 80) {
        data.body = fetched;
        try {
          const saved = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
          saved.body  = fetched;
          fs.writeFileSync(dataPath, JSON.stringify(saved, null, 2), 'utf8');
        } catch {}
        process.stdout.write(`     ✅ fetch ได้ ${fetched.length} ตัวอักษร\n`);
      } else {
        process.stdout.write(`     ❌ fetch ไม่ได้ (อาจเป็น paywall) — ข้าม\n`);
        fail++;
        continue;
      }
    }

    let master = '';
    for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
      process.stdout.write(`     [${attempt}/${RETRY_LIMIT}] กำลังเขียน...`);
      try {
        const raw = await ollamaChat(buildPrompt(data, domainRules));
        master    = cleanText(raw);
        if (master.length >= MIN_CHARS) {
          process.stdout.write(` ✓ (${master.length} chars)\n`);
          break;
        }
        process.stdout.write(` ⚠️  สั้นเกิน (${master.length} chars) ลองใหม่\n`);
        master = '';
      } catch (e) {
        process.stdout.write(` ❌ ${e.message.substring(0, 70)}\n`);
        master = '';
      }
      await sleep(1000);
    }

    if (!master) {
      console.log(`     ⛔ ข้ามข่าวนี้\n`);
      fail++;
      continue;
    }

    const contentDir = path.join(newsDir, slug, 'content');
    fs.mkdirSync(contentDir, { recursive: true });
    fs.writeFileSync(path.join(contentDir, 'master.md'), master, 'utf8');
    ok++;
    await sleep(500);
  }

  console.log(`\n✅ Editor Agent เสร็จ: สร้าง ${ok} | ล้มเหลว ${fail}`);
}

module.exports = { runEditorAgent };
