/**
 * agents/manao/scrape-reuters.js — ดึงข่าว Reuters Technology/AI
 *
 * ใช้งาน: node agents/manao/scrape-reuters.js
 * Output: news/YYYY-MM-DD/articles.json
 */

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');

const ROOT     = path.resolve(__dirname, '..', '..');
const NEWS_DIR = path.join(ROOT, 'news');

// Reuters RSS feeds (ลองตามลำดับ)
const RSS_FEEDS = [
  'https://feeds.reuters.com/reuters/technologyNews',
  'https://feeds.reuters.com/reuters/scienceNews',
  'https://rss.app/feeds/reuters-technology.xml',
];

// Keywords สำหรับกรองข่าว AI
const AI_KEYWORDS = [
  'artificial intelligence', 'AI', 'machine learning', 'ChatGPT', 'GPT',
  'deep learning', 'neural network', 'generative AI', 'LLM', 'OpenAI',
  'Google AI', 'Meta AI', 'Anthropic', 'robotics', 'automation',
  'algorithm', 'data science', 'computer vision', 'NLP'
];

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => resolve(buf));
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

function parseRSS(xml) {
  const items = [];
  const itemRx = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRx.exec(xml)) !== null) {
    const block = m[1];
    const get = tag => {
      const r = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
      const mm = r.exec(block);
      return mm ? mm[1].replace(/<[^>]+>/g, '').trim() : '';
    };
    const title       = get('title');
    const link        = get('link') || get('guid');
    const description = get('description').substring(0, 400);
    const pubDate     = get('pubDate');

    if (!title || !link) continue;
    items.push({ title, link, description, pubDate, source: 'Reuters' });
  }
  return items;
}

function isAIRelated(article) {
  const text = (article.title + ' ' + article.description).toLowerCase();
  return AI_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
}

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function main() {
  console.log('🌐 มะนาว — กำลังดึงข่าว Reuters AI/Tech');
  const today = todayString();
  const outDir = path.join(NEWS_DIR, today);
  fs.mkdirSync(outDir, { recursive: true });

  let allArticles = [];

  for (const feed of RSS_FEEDS) {
    try {
      console.log(`  📡 ดึง: ${feed}`);
      const xml = await fetchUrl(feed);
      const articles = parseRSS(xml);
      console.log(`  พบ ${articles.length} บทความ`);
      allArticles.push(...articles);
      if (articles.length > 0) break; // ได้แล้วหยุด
    } catch (e) {
      console.log(`  ⚠️ feed ล้มเหลว: ${e.message}`);
    }
  }

  // ถ้า RSS ไม่ได้เลย — fallback: scrape Reuters Tech page
  if (!allArticles.length) {
    console.log('  🔄 ลอง scrape หน้า Reuters Technology...');
    try {
      const html = await fetchUrl('https://www.reuters.com/technology/');
      const titleRx = /"headline":"([^"]+)"/g;
      const linkRx  = /"canonical_url":"([^"]+)"/g;
      const titles = [], links = [];
      let tm, lm;
      while ((tm = titleRx.exec(html)) !== null) titles.push(tm[1]);
      while ((lm = linkRx.exec(html))  !== null) links.push('https://www.reuters.com' + lm[1]);
      for (let i = 0; i < Math.min(titles.length, links.length, 15); i++) {
        allArticles.push({
          title: titles[i], link: links[i],
          description: '', pubDate: new Date().toUTCString(), source: 'Reuters'
        });
      }
    } catch (e) {
      console.log(`  ❌ fallback ล้มเหลว: ${e.message}`);
    }
  }

  // กรอง AI-related
  const aiArticles = allArticles.filter(isAIRelated);
  console.log(`\n🤖 ข่าว AI: ${aiArticles.length} / ${allArticles.length} รายการ`);

  // ตรวจซ้ำกับที่มีอยู่แล้ว
  const existingFile = path.join(outDir, 'articles.json');
  const existing = fs.existsSync(existingFile)
    ? JSON.parse(fs.readFileSync(existingFile, 'utf8'))
    : [];
  const existingLinks = new Set(existing.map(a => a.link));
  const newArticles = aiArticles.filter(a => !existingLinks.has(a.link));

  const all = [...existing, ...newArticles];
  fs.writeFileSync(existingFile, JSON.stringify(all, null, 2), 'utf8');

  console.log(`✅ ใหม่: ${newArticles.length} | รวมวันนี้: ${all.length} บทความ`);
  console.log(`📁 บันทึกที่: ${existingFile}`);

  return { total: all.length, newCount: newArticles.length, articles: newArticles };
}

module.exports = { main };

if (require.main === module) {
  main().catch(e => { console.error('❌', e.message); process.exit(1); });
}
