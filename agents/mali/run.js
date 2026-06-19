/**
 * agents/mali/run.js — มะลิ Agent (Shopee Affiliate)
 *
 * ใช้งาน:
 *   node agents/mali/run.js --action approve-today
 *   node agents/mali/run.js --action scrape
 *   node agents/mali/run.js --action create-content
 *   node agents/mali/run.js --action status
 */

const fs          = require('fs');
const path        = require('path');
const { execSync, execFileSync, spawn } = require('child_process');

const ROOT        = path.resolve(__dirname, '..', '..');
const STATUS_FILE = path.join(ROOT, 'agent-status.json');
const LOG_FILE    = path.join(__dirname, 'mali.log');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toLocaleTimeString('th-TH')}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

function updateStatus(fields) {
  try {
    const s = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    Object.assign(s.mali, fields);
    fs.writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2), 'utf8');
  } catch {}
}

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

function actionStatus() {
  log('📊 ตรวจสอบสถานะ มะลิ (Shopee Affiliate)');
  const today = todayString();
  const prodDir = path.join(ROOT, 'products');

  if (!fs.existsSync(prodDir)) { log('ไม่พบโฟลเดอร์ products/'); return; }

  const dirs = fs.readdirSync(prodDir).filter(d => fs.existsSync(path.join(prodDir, d, 'data.json')));
  let total = 0, posted = 0, ready = 0, noContent = 0, todayCount = 0;

  dirs.forEach(id => {
    const d = JSON.parse(fs.readFileSync(path.join(prodDir, id, 'data.json'), 'utf8'));
    if (d.status === 'placeholder') return;
    total++;
    if (d.status === 'posted') posted++;
    if (d.post_date === today) todayCount++;
    const hasFB = fs.existsSync(path.join(prodDir, id, 'content', 'facebook.md'));
    const hasAll = hasFB &&
      fs.existsSync(path.join(prodDir, id, 'content', 'instagram.md')) &&
      fs.existsSync(path.join(prodDir, id, 'content', 'x.md')) &&
      fs.existsSync(path.join(prodDir, id, 'content', 'tiktok.md'));
    if (hasAll && d.status !== 'posted') ready++;
    if (!hasFB && d.status !== 'posted') noContent++;
  });

  log(`สินค้าทั้งหมด: ${total} รายการ`);
  log(`วันนี้ (${today}): ${todayCount} รายการ`);
  log(`โพสต์แล้ว: ${posted} | Content พร้อม: ${ready} | รอ Content: ${noContent}`);
  updateStatus({ lastResult: `total:${total} posted:${posted} ready:${ready} today:${todayCount}` });
}

function actionApproveToday() {
  const today = todayString();
  log(`🚀 เริ่ม Approval Bot — ${today}`);

  const botPath = path.join(ROOT, 'approval-bot.js');
  if (!fs.existsSync(botPath)) {
    log('❌ ไม่พบ approval-bot.js');
    process.exit(1);
    return;
  }

  const child = spawn(process.execPath, [botPath], {
    cwd: ROOT, shell: false,
    env: { ...process.env }
  });

  child.stdout.on('data', d => log(d.toString().trim()));
  child.stderr.on('data', d => log('⚠️ ' + d.toString().trim()));
  child.on('close', code => {
    log(code === 0 ? '✅ Approval Bot เสร็จสิ้น' : `❌ Approval Bot exit code: ${code}`);
    updateStatus({ status: 'idle', lastResult: code === 0 ? 'approve-today สำเร็จ' : `error code ${code}` });
  });

  updateStatus({ status: 'running', currentAction: 'approve-today', pid: child.pid, lastRun: new Date().toISOString() });
}

function actionScrape() {
  log('🔍 เริ่ม Scrape สินค้า Shopee');
  try {
    const out = execFileSync(process.execPath, ['scrape.js'], {
      cwd: ROOT, encoding: 'utf8', timeout: 5 * 60 * 1000
    });
    out.split('\n').filter(l => l.trim()).forEach(l => log(l));
    log('✅ Scrape เสร็จสิ้น');
    updateStatus({ status: 'idle', lastResult: 'scrape สำเร็จ', lastRun: new Date().toISOString() });
  } catch (e) {
    log(`❌ Scrape error: ${(e.stdout || e.message).substring(0, 200)}`);
    updateStatus({ status: 'error', lastResult: 'scrape ล้มเหลว' });
    process.exit(1);
  }
}

function actionCreateContent() {
  log('✍️ เริ่มสร้าง Content');
  const prodDir = path.join(ROOT, 'products');
  const dirs = fs.existsSync(prodDir)
    ? fs.readdirSync(prodDir).filter(d => fs.existsSync(path.join(prodDir, d, 'data.json')))
    : [];

  const pending = dirs.filter(id => {
    const d = JSON.parse(fs.readFileSync(path.join(prodDir, id, 'data.json'), 'utf8'));
    return d.status !== 'placeholder' && !fs.existsSync(path.join(prodDir, id, 'content', 'facebook.md'));
  });

  if (!pending.length) { log('✅ Content ครบทุกสินค้าแล้ว'); return; }
  log(`พบ ${pending.length} สินค้าที่รอ content`);
  log('⚠️ กรุณาใช้ Claude Code: /สร้าง-content เพื่อสร้าง content ด้วย AI');
  updateStatus({ status: 'idle', lastResult: `รอ content: ${pending.length} รายการ` });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(opts = {}) {
  const args   = opts.args !== undefined ? opts.args : process.argv.slice(2);
  const action = opts.action || args[args.indexOf('--action') + 1] || 'status';

  // ล้าง log เก่า (เก็บแค่ 500 บรรทัดล่าสุด)
  try {
    if (fs.existsSync(LOG_FILE)) {
      const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
      if (lines.length > 500) fs.writeFileSync(LOG_FILE, lines.slice(-500).join('\n'), 'utf8');
    }
  } catch {}

  updateStatus({ status: 'running', currentAction: action, lastRun: new Date().toISOString() });
  log(`▶ มะลิ เริ่มทำงาน action=${action}`);

  try {
    switch (action) {
      case 'status':         actionStatus();        break;
      case 'approve-today':  actionApproveToday();  break;
      case 'scrape':         actionScrape();         break;
      case 'create-content': actionCreateContent();  break;
      default:
        log(`❌ ไม่รู้จัก action: ${action}`);
        process.exit(1);
        return;
    }
    if (action !== 'approve-today') {
      updateStatus({ status: 'idle' });
    }
  } catch (e) {
    log(`❌ Error: ${e.message}`);
    updateStatus({ status: 'error', lastResult: e.message.substring(0, 100) });
    process.exit(1);
  }
}

/* istanbul ignore next */
if (require.main === module) { main(); }

module.exports = { log, updateStatus, todayString, actionStatus, actionApproveToday, actionScrape, actionCreateContent, main };
