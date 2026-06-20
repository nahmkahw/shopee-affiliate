/**
 * agents/manao/run.js — มะนาว Agent (Reuters AI News)
 *
 * เชื่อมกับ C:\Users\MissT\ai-news\ — เรียก scripts เดิมที่มีอยู่แล้ว
 *
 * ใช้งาน:
 *   node agents/manao/run.js --action scrape
 *   node agents/manao/run.js --action generate
 *   node agents/manao/run.js --action post
 *   node agents/manao/run.js --action full
 *   node agents/manao/run.js --action status
 */

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ─── Paths ────────────────────────────────────────────────────────────────────

const MANAO_ROOT  = __dirname;                                    // agents/manao/
const HUB_ROOT    = path.resolve(__dirname, '..', '..');          // shopee-affiliate/
const AI_NEWS_DIR = path.join(MANAO_ROOT, 'pipeline');             // pipeline อยู่ใน agents/manao/
const STATUS_FILE = path.join(HUB_ROOT, 'agent-status.json');
const LOG_FILE    = path.join(MANAO_ROOT, 'manao.log');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toLocaleTimeString('th-TH')}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

function updateStatus(fields) {
  try {
    const s = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    Object.assign(s.manao, fields);
    fs.writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2), 'utf8');
  } catch {}
}

// รัน script ใน pipeline และ pipe output มาที่ log แบบ real-time (ไม่มี timeout ตายตัว)
function runAiNews(script, extraArgs = []) {
  const scriptPath = path.join(AI_NEWS_DIR, script);
  if (!fs.existsSync(scriptPath)) throw new Error(`ไม่พบ ${scriptPath}`);

  log(`▷ node ${script} ${extraArgs.join(' ')}`);

  return new Promise((resolve, reject) => {
    const nodeBin = process.execPath; // ใช้ node ตัวเดียวกับที่รัน run.js อยู่
    const makrutDir = path.join(HUB_ROOT, 'agents', 'makrut', 'pipeline');
    const child = spawn(nodeBin, [scriptPath, ...extraArgs], {
      cwd:  AI_NEWS_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env:  { ...process.env, EXTRA_SCHEDULE_DIRS: makrutDir },
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => d.split('\n').filter(l => l.trim()).forEach(l => log('  ' + l)));
    child.stderr.on('data', d => d.split('\n').filter(l => l.trim()).forEach(l => log('  ⚠️ ' + l)));

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exit code ${code}`));
    });
  });
}

// อ่านข้อมูล news จาก ai-news/news/
function readNewsStats() {
  const newsDir = path.join(AI_NEWS_DIR, 'news');
  if (!fs.existsSync(newsDir)) return { total: 0, posted: 0, draft: 0, scraped: 0 };

  const slugs = fs.readdirSync(newsDir).filter(d =>
    fs.existsSync(path.join(newsDir, d, 'data.json'))
  );

  let total = 0, posted = 0, draft = 0, scraped = 0;
  const today = new Date().toISOString().slice(0, 10);
  const todaySlugs = [];

  slugs.forEach(slug => {
    const d = JSON.parse(fs.readFileSync(path.join(newsDir, slug, 'data.json'), 'utf8'));
    total++;
    if (d.status === 'posted')  posted++;
    if (d.status === 'draft' || d.status === 'pending_approval') draft++;
    if (d.status === 'scraped') scraped++;
    if ((d.published_at || d.scraped_at || '').startsWith(today)) todaySlugs.push(slug);
  });

  return { total, posted, draft, scraped, todayCount: todaySlugs.length };
}

// ─── Actions ──────────────────────────────────────────────────────────────────

function actionStatus() {
  log('📊 สถานะ มะนาว → ai-news');

  // ตรวจ ai-news directory
  if (!fs.existsSync(AI_NEWS_DIR)) {
    log(`❌ ไม่พบ ${AI_NEWS_DIR}`);
    updateStatus({ lastResult: 'ไม่พบ ai-news directory' });
    return;
  }
  log(`✅ ai-news: ${AI_NEWS_DIR}`);

  // สถิติข่าว
  const stats = readNewsStats();
  log(`📰 ข่าวทั้งหมด: ${stats.total} | โพสต์แล้ว: ${stats.posted} | รอโพสต์: ${stats.draft} | วันนี้: ${stats.todayCount}`);

  // ตรวจ input.txt
  const inputFile = path.join(AI_NEWS_DIR, 'input.txt');
  if (fs.existsSync(inputFile)) {
    const lines = fs.readFileSync(inputFile, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#'));
    log(`📋 input.txt: ${lines.length} ข่าว`);
  }

  // ตรวจ Ollama
  try {
    const env = require('dotenv').config({ path: path.join(AI_NEWS_DIR, '.env') }).parsed || {};
    if (env.OLLAMA_HOST) {
      log(`🤖 Ollama: ${env.OLLAMA_HOST} (model: ${env.OLLAMA_MODEL || '-'})`);
    }
  } catch {}

  updateStatus({ lastResult: `total:${stats.total} posted:${stats.posted} today:${stats.todayCount}` });
}

async function actionScrape(extraArgs = []) {
  log('🌐 มะนาว → scrape.js (Reuters AI News via Google RSS + Playwright)');
  try {
    await runAiNews('scrape.js', extraArgs);
    const stats = readNewsStats();
    log(`✅ Scrape เสร็จ — ข่าวทั้งหมด: ${stats.total} | วันนี้: ${stats.todayCount}`);
    updateStatus({ lastResult: `scrape สำเร็จ total:${stats.total}` });
  } catch (e) {
    log(`❌ scrape ล้มเหลว: ${e.message.substring(0, 200)}`);
    updateStatus({ status: 'error', lastResult: 'scrape ล้มเหลว' });
    throw e;
  }
}

async function actionGenerate(extraArgs = []) {
  log('✍️ มะนาว → generate.js (สร้าง content ไทย + ส่ง Telegram Approve)');
  try {
    await runAiNews('generate.js', extraArgs);
    const stats = readNewsStats();
    log(`✅ Generate เสร็จ — draft/pending: ${stats.draft}`);
    updateStatus({ lastResult: `generate สำเร็จ draft:${stats.draft}` });
  } catch (e) {
    log(`❌ generate ล้มเหลว: ${e.message.substring(0, 200)}`);
    updateStatus({ status: 'error', lastResult: 'generate ล้มเหลว' });
    throw e;
  }
}

async function actionPost(extraArgs = []) {
  log('📤 มะนาว → post.js (โพสต์ FB + IG)');
  // ถ้าไม่มี args พิเศษ → โพสต์ทุกข่าวที่ draft/pending วันนี้
  const args = extraArgs.length ? extraArgs : ['--pending', '--platform', 'fb,ig'];
  try {
    await runAiNews('post.js', args);
    const stats = readNewsStats();
    log(`✅ Post เสร็จ — โพสต์แล้ว: ${stats.posted}`);
    updateStatus({ lastResult: `post สำเร็จ posted:${stats.posted}` });
  } catch (e) {
    log(`❌ post ล้มเหลว: ${e.message.substring(0, 200)}`);
    updateStatus({ status: 'error', lastResult: 'post ล้มเหลว' });
    throw e;
  }
}

async function actionFull() {
  log('🚀 มะนาว → Full Pipeline: Scrape → Generate → Post');
  try {
    await actionScrape();
    await actionGenerate();
    await actionPost();
    log('✅ Full Pipeline เสร็จสิ้น');
    updateStatus({ lastResult: 'full pipeline สำเร็จ' });
  } catch (e) {
    log(`❌ Full pipeline หยุดที่: ${e.message.substring(0, 100)}`);
    throw e;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// ล้าง log เก่า (เก็บ 500 บรรทัดล่าสุด)
try {
  if (fs.existsSync(LOG_FILE)) {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
    if (lines.length > 500) fs.writeFileSync(LOG_FILE, lines.slice(-500).join('\n'), 'utf8');
  }
} catch {}

const cliArgs    = process.argv.slice(2);
const action     = cliArgs[cliArgs.indexOf('--action') + 1] || 'status';
// args เพิ่มเติมที่จะส่งต่อให้ script (เช่น --force, --limit 5)
const extraArgs  = cliArgs.filter(a => a !== '--action' && a !== action);

updateStatus({ status: 'running', currentAction: action, lastRun: new Date().toISOString() });
log(`▶ มะนาว เริ่มทำงาน action=${action} (ai-news: ${AI_NEWS_DIR})`);

(async () => {
  try {
    switch (action) {
      case 'status':   actionStatus();                      break;
      case 'scrape':   await actionScrape(extraArgs);       break;
      case 'generate': await actionGenerate(extraArgs);     break;
      case 'post':     await actionPost(extraArgs);         break;
      case 'full':     await actionFull();                  break;
      default:
        log(`❌ ไม่รู้จัก action: ${action}`);
        process.exit(1);
    }
    updateStatus({ status: 'idle' });
    log('▶ มะนาว หยุดทำงาน');
  } catch (e) {
    log(`❌ Error: ${e.message}`);
    updateStatus({ status: 'error', lastResult: e.message.substring(0, 100) });
    process.exit(1);
  }
})();
