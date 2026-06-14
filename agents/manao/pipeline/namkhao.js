#!/usr/bin/env node
/**
 * namkhao.js — น้ำข้าว Orchestrator
 *
 * ควบคุม pipeline 4 agent เชิงเส้น:
 *   Agent 1: scrape.js         — ดึงข่าวจาก Reuters
 *   Agent 2: filter-agent.js   — กรองและให้คะแนนข่าว
 *   Agent 3: editor-agent.js   — เขียนบทความภาษาไทย (master.md)
 *   Agent 4: formatter-agent.js — สร้าง content ต่อ platform
 *   Publisher: post.js         — โพสต์ FB+IG (ถ้าใส่ --post)
 *
 * ใช้งาน:
 *   node namkhao.js                          รัน pipeline เต็ม (ไม่รวม post)
 *   node namkhao.js --date 2026-06-01        ประมวลข่าวของวันนั้น
 *   node namkhao.js --post --schedule        pipeline + โพสต์ FB+IG แบบ schedule
 *   node namkhao.js --no-scrape              ข้าม Agent 1
 *   node namkhao.js --dry-run                แสดงแผน ไม่รันจริง
 *   node namkhao.js --force                  สร้างใหม่ทับของเดิม
 *   node namkhao.js --platform fb,ig         สร้างเฉพาะ platform ที่ระบุ
 */

const { spawnSync } = require('child_process');
const path          = require('path');
const ROOT          = __dirname;

const args = process.argv.slice(2);

function hasFlag(f)  { return args.includes(f); }
function getArg(f)   { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; }

const DATE_ARG  = getArg('--date');
const PLATFORM  = getArg('--platform') || 'fb,ig,x,tiktok';
const FORCE     = hasFlag('--force');
const DRY_RUN   = hasFlag('--dry-run');
const DO_POST   = hasFlag('--post');
const SCHEDULE  = hasFlag('--schedule');

const NO_SCRAPE = hasFlag('--no-scrape');
const NO_FILTER = hasFlag('--no-filter');
const NO_EDIT   = hasFlag('--no-edit');
const NO_FORMAT = hasFlag('--no-format');

// ─── Banner ───────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(58));
console.log('🌾  น้ำข้าว — AI News Orchestrator');
console.log('═'.repeat(58));
if (DATE_ARG) console.log(`📅 วันที่:  ${DATE_ARG}`);
if (PLATFORM !== 'fb,ig,x,tiktok') console.log(`📱 platform: ${PLATFORM}`);
if (FORCE)    console.log('⚠️  mode: force (สร้างใหม่ทับของเดิม)');
if (DRY_RUN)  console.log('🔍 mode: dry-run (ไม่รันจริง)');
console.log('');

// ─── Runner ───────────────────────────────────────────────────────────────────

const results = {};

function run(agentLabel, script, extraArgs = []) {
  const baseArgs  = [
    ...(DATE_ARG ? ['--date', DATE_ARG] : []),
    ...(FORCE    ? ['--force']           : []),
  ];
  const cmdArgs   = ['node', script, ...baseArgs, ...extraArgs];
  const shortArgs = cmdArgs.slice(1).join(' ');

  console.log(`\n${'─'.repeat(58)}`);
  console.log(`🤖  ${agentLabel}`);
  console.log(`    $ node ${shortArgs}`);
  console.log('─'.repeat(58));

  if (DRY_RUN) {
    console.log('    [dry-run: ข้าม]');
    results[agentLabel] = 'skipped (dry-run)';
    return;
  }

  const start  = Date.now();
  const result = spawnSync(cmdArgs[0], cmdArgs.slice(1), {
    cwd:    ROOT,
    stdio:  'inherit',
    encoding: 'utf8',
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (result.status !== 0) {
    results[agentLabel] = `❌ exit ${result.status}`;
    console.error(`\n❌ ${agentLabel} ล้มเหลว (exit ${result.status}) — หยุด pipeline`);
    printSummary(elapsed);
    process.exit(result.status || 1);
  }

  results[agentLabel] = `✅ (${elapsed}s)`;
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

const pipelineStart = Date.now();

if (!NO_SCRAPE) {
  run('Agent 1 — ดึงข่าว', 'scrape.js');
}

if (!NO_FILTER) {
  run('Agent 2 — กรองข่าว', 'agents/filter-agent.js');
}

if (!NO_EDIT) {
  run('Agent 3 — เขียนบทความ', 'agents/editor-agent.js');
}

if (!NO_FORMAT) {
  run('Agent 4 — สร้าง content', 'agents/formatter-agent.js', ['--platform', PLATFORM]);
}

if (DO_POST) {
  const postArgs = ['--pending', '--platform', 'fb,ig'];
  if (SCHEDULE) postArgs.push('--schedule');
  run('Publisher — โพสต์', 'post.js', postArgs);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function printSummary(extraNote) {
  const total = ((Date.now() - pipelineStart) / 1000).toFixed(1);
  console.log('\n' + '═'.repeat(58));
  console.log('📊  สรุป pipeline');
  console.log('─'.repeat(58));
  for (const [label, status] of Object.entries(results)) {
    console.log(`  ${status.padEnd(14)} ${label}`);
  }
  console.log('─'.repeat(58));
  console.log(`⏱  เวลารวม: ${total}s`);
  if (extraNote) console.log(`   ${extraNote}`);
}

printSummary();

if (!DO_POST) {
  console.log('\nขั้นตอนถัดไป:');
  console.log('  ตรวจ draft:  news/{slug}/content/');
  console.log('  โพสต์ FB+IG: node post.js --pending --schedule');
  console.log('  หรือรันทุกอย่าง: node namkhao.js --post --schedule');
}
console.log('═'.repeat(58) + '\n');
