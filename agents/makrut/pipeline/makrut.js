#!/usr/bin/env node
/**
 * makrut.js — มะกรูด Orchestrator (FIFA World Cup 2026 News)
 *
 * pipeline 4 agent เชิงเส้น:
 *   Agent 1: scrape.js                — ดึงข่าวบอลโลกจาก Google News RSS (makrut own)
 *   Agent 2: manao/filter-agent.js    — กรองข่าว (share + PIPELINE_ROOT=makrut)
 *   Agent 3: editor-agent.js          — เขียนบทความไทย (makrut own, football prompt)
 *   Agent 4: manao/formatter-agent.js — สร้าง content FB/IG (share + PIPELINE_ROOT=makrut)
 *   Publisher: manao/post.js          — โพสต์ FB (share + PIPELINE_ROOT=makrut)
 *
 * ใช้งาน:
 *   node makrut.js                    รัน pipeline เต็ม (ไม่รวม post)
 *   node makrut.js --post --schedule  pipeline + โพสต์ FB แบบ schedule
 *   node makrut.js --no-scrape        ข้าม Agent 1
 *   node makrut.js --dry-run          แสดงแผน ไม่รันจริง
 *   node makrut.js --force            สร้างใหม่ทับของเดิม
 */

const { spawnSync } = require('child_process');
const path = require('path');

const MAKRUT_DIR = __dirname;
const MANAO_DIR  = path.resolve(__dirname, '..', '..', 'manao', 'pipeline');

const args = process.argv.slice(2);
function hasFlag(f) { return args.includes(f); }
function getArg(f)  { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; }

const DATE_ARG  = getArg('--date');
const PLATFORM  = getArg('--platform') || 'fb';
const FORCE     = hasFlag('--force');
const DRY_RUN   = hasFlag('--dry-run');
const DO_POST   = hasFlag('--post');
const SCHEDULE  = hasFlag('--schedule');
const NO_SCRAPE = hasFlag('--no-scrape');
const NO_FILTER = hasFlag('--no-filter');
const NO_EDIT   = hasFlag('--no-edit');
const NO_FORMAT = hasFlag('--no-format');
const RESEND    = hasFlag('--resend');

// PIPELINE_ROOT → ทำให้ shared scripts (filter/formatter/post) ชี้มาที่ makrut's news/ + config.json
const sharedEnv = { ...process.env, PIPELINE_ROOT: MAKRUT_DIR };

console.log('\n' + '═'.repeat(58));
console.log('🍋  มะกรูด — FIFA World Cup 2026 News Orchestrator');
console.log('═'.repeat(58));
if (DATE_ARG) console.log(`📅 วันที่: ${DATE_ARG}`);
if (FORCE)    console.log('⚠️  mode: force');
if (DRY_RUN)  console.log('🔍 mode: dry-run');
console.log('');

const results = {};
const pipelineStart = Date.now();

function run(label, scriptPath, extraArgs = [], env = sharedEnv) {
  const baseArgs = [
    ...(DATE_ARG ? ['--date', DATE_ARG] : []),
    ...(FORCE    ? ['--force']           : []),
    ...extraArgs,
  ];
  console.log(`\n${'─'.repeat(58)}\n🤖  ${label}\n    $ node ${path.basename(scriptPath)} ${baseArgs.join(' ')}\n${'─'.repeat(58)}`);

  if (DRY_RUN) { results[label] = 'skipped (dry-run)'; return; }

  const start  = Date.now();
  const result = spawnSync(process.execPath, [scriptPath, ...baseArgs], {
    cwd:     path.dirname(scriptPath),
    stdio:   'inherit',
    env,
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (result.status !== 0) {
    results[label] = `❌ exit ${result.status}`;
    printSummary();
    process.exit(result.status || 1);
  }
  results[label] = `✅ (${elapsed}s)`;
}

if (!NO_SCRAPE) run('Agent 1 — ดึงข่าว',     path.join(MAKRUT_DIR, 'scrape.js'));
if (!NO_FILTER) run('Agent 2 — กรองข่าว',     path.join(MANAO_DIR, 'agents', 'filter-agent.js'));
if (!NO_EDIT)   run('Agent 3 — เขียนบทความ',  path.join(MAKRUT_DIR, 'agents', 'editor-agent.js'));
if (!NO_FORMAT) {
  const fmtArgs = ['--platform', PLATFORM];
  if (RESEND) fmtArgs.push('--resend');
  run('Agent 4 — สร้าง content', path.join(MANAO_DIR, 'agents', 'formatter-agent.js'), fmtArgs);
}
if (DO_POST) {
  const postArgs = ['--pending', '--platform', PLATFORM];
  if (SCHEDULE) postArgs.push('--schedule');
  run('Publisher — โพสต์', path.join(MANAO_DIR, 'post.js'), postArgs);
}

function printSummary() {
  const total = ((Date.now() - pipelineStart) / 1000).toFixed(1);
  console.log('\n' + '═'.repeat(58) + '\n📊  สรุป pipeline — มะกรูด\n' + '─'.repeat(58));
  for (const [l, s] of Object.entries(results)) console.log(`  ${s.padEnd(14)} ${l}`);
  console.log('─'.repeat(58) + `\n⏱  เวลารวม: ${total}s`);
}

printSummary();
if (!DO_POST) {
  console.log('\nขั้นตอนถัดไป:');
  console.log('  ตรวจ draft:  news/{slug}/content/');
  console.log('  โพสต์ FB:    PIPELINE_ROOT=<path> node manao/pipeline/post.js --pending');
  console.log('  หรือรันทุกอย่าง: node makrut.js --post --schedule');
}
console.log('═'.repeat(58) + '\n');
