'use strict';
/**
 * agents/makrut/run.js — มะกรูด Agent (FIFA World Cup 2026 News)
 *
 * ใช้งาน:
 *   node agents/makrut/run.js --action status
 *   node agents/makrut/run.js --action scrape
 *   node agents/makrut/run.js --action generate
 *   node agents/makrut/run.js --action post
 *   node agents/makrut/run.js --action full
 */

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MAKRUT_ROOT  = __dirname;
const HUB_ROOT     = path.resolve(__dirname, '..', '..');
const PIPELINE_DIR = path.join(MAKRUT_ROOT, 'pipeline');
const STATUS_FILE  = path.join(HUB_ROOT, 'agent-status.json');
const LOG_FILE     = path.join(MAKRUT_ROOT, 'makrut.log');

const MANAO_DIR   = path.join(HUB_ROOT, 'agents', 'manao', 'pipeline');
// EXTRA_SCHEDULE_DIRS → post.js scan ทุก pipeline ก่อนจองเวลา ไม่ให้ชนกับมะนาว
const pipelineEnv = { ...process.env, PIPELINE_ROOT: PIPELINE_DIR, EXTRA_SCHEDULE_DIRS: MANAO_DIR };

function log(msg) {
  const line = `[${new Date().toLocaleTimeString('th-TH')}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

function updateStatus(fields) {
  try {
    const s = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    if (!s.makrut) s.makrut = {};
    Object.assign(s.makrut, fields);
    fs.writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2), 'utf8');
  } catch {}
}

function readNewsStats() {
  const newsDir = path.join(PIPELINE_DIR, 'news');
  if (!fs.existsSync(newsDir)) return { total: 0, posted: 0, draft: 0, todayCount: 0 };

  const today = new Date().toISOString().slice(0, 10);
  const slugs = fs.readdirSync(newsDir).filter(d => fs.existsSync(path.join(newsDir, d, 'data.json')));
  let total = 0, posted = 0, draft = 0, todayCount = 0;

  slugs.forEach(slug => {
    const d = JSON.parse(fs.readFileSync(path.join(newsDir, slug, 'data.json'), 'utf8'));
    total++;
    if (d.status === 'posted') posted++;
    if (d.status === 'draft' || d.status === 'pending_approval') draft++;
    if ((d.published_at || d.scraped_at || '').startsWith(today)) todayCount++;
  });
  return { total, posted, draft, todayCount };
}

function runScript(label, scriptPath, extraArgs = []) {
  log(`▷ ${label}`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...extraArgs], {
      cwd:   path.dirname(scriptPath),
      stdio: ['ignore', 'pipe', 'pipe'],
      env:   pipelineEnv,
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => d.split('\n').filter(l => l.trim()).forEach(l => log('  ' + l)));
    child.stderr.on('data', d => d.split('\n').filter(l => l.trim()).forEach(l => log('  ⚠️ ' + l)));
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${label} exit ${code}`)));
  });
}

function actionStatus() {
  log('📊 สถานะ มะกรูด');
  if (!fs.existsSync(PIPELINE_DIR)) { log(`❌ ไม่พบ pipeline: ${PIPELINE_DIR}`); return; }
  const stats = readNewsStats();
  log(`⚽ ข่าวบอลโลก: ${stats.total} รายการ | โพสต์แล้ว: ${stats.posted} | รอโพสต์: ${stats.draft} | วันนี้: ${stats.todayCount}`);
  updateStatus({ lastResult: `total:${stats.total} posted:${stats.posted} today:${stats.todayCount}` });
}

async function actionScrape(extraArgs = []) {
  log('🌐 มะกรูด → scrape.js (FIFA World Cup 2026 via Google RSS)');
  await runScript('scrape', path.join(PIPELINE_DIR, 'scrape.js'), extraArgs);
  const stats = readNewsStats();
  log(`✅ Scrape เสร็จ — ข่าว: ${stats.total} | วันนี้: ${stats.todayCount}`);
  updateStatus({ lastResult: `scrape สำเร็จ total:${stats.total}` });
}

async function actionGenerate(extraArgs = []) {
  log('✍️ มะกรูด → generate.js + Telegram Approve');
  await runScript('generate', path.join(MANAO_DIR, 'generate.js'), extraArgs);
  const stats = readNewsStats();
  log(`✅ Generate เสร็จ — draft/pending: ${stats.draft}`);
  updateStatus({ lastResult: `generate สำเร็จ draft:${stats.draft}` });
}

async function actionPost(extraArgs = []) {
  log('📤 มะกรูด → post.js (โพสต์ FB)');
  const a = extraArgs.length ? extraArgs : ['--pending', '--platform', 'fb'];
  await runScript('post', path.join(MANAO_DIR, 'post.js'), a);
  const stats = readNewsStats();
  log(`✅ Post เสร็จ — โพสต์แล้ว: ${stats.posted}`);
  updateStatus({ lastResult: `post สำเร็จ posted:${stats.posted}` });
}

async function actionFull() {
  log('🚀 มะกรูด → Full Pipeline: Scrape → Generate → Post');
  await actionScrape();
  await actionGenerate();
  await actionPost();
  log('✅ Full Pipeline เสร็จสิ้น');
  updateStatus({ lastResult: 'full pipeline สำเร็จ' });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
try {
  if (fs.existsSync(LOG_FILE)) {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
    if (lines.length > 500) fs.writeFileSync(LOG_FILE, lines.slice(-500).join('\n'), 'utf8');
  }
} catch {}

const cliArgs   = process.argv.slice(2);
const action    = cliArgs[cliArgs.indexOf('--action') + 1] || 'status';
const extraArgs = cliArgs.filter(a => a !== '--action' && a !== action);

updateStatus({ status: 'running', currentAction: action, lastRun: new Date().toISOString() });
log(`▶ มะกรูด เริ่มทำงาน action=${action}`);

(async () => {
  try {
    switch (action) {
      case 'status':   actionStatus();                     break;
      case 'scrape':   await actionScrape(extraArgs);      break;
      case 'generate': await actionGenerate(extraArgs);    break;
      case 'post':     await actionPost(extraArgs);        break;
      case 'full':     await actionFull();                 break;
      default:
        log(`❌ ไม่รู้จัก action: ${action}`);
        process.exit(1);
    }
    updateStatus({ status: 'idle' });
    log('▶ มะกรูด หยุดทำงาน');
  } catch (e) {
    log(`❌ Error: ${e.message}`);
    updateStatus({ status: 'error', lastResult: e.message.substring(0, 100) });
    process.exit(1);
  }
})();
