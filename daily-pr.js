'use strict';
/**
 * daily-pr.js — สร้าง PR สรุปงานประจำวันอัตโนมัติ
 *
 * รัน: node daily-pr.js [--date YYYY-MM-DD]
 * - ตรวจ uncommitted changes → ถ้าไม่มี ออกทันที
 * - สร้าง branch daily/YYYY-MM-DD
 * - commit ทุก changes พร้อม message สรุป
 * - push + เปิด PR เข้า master
 * - PR description = commit messages วันนี้ + git diff --stat
 */

const { execSync, execFileSync } = require('child_process');
const path = require('path');

const ROOT    = __dirname;
const args    = process.argv.slice(2);
const dateIdx = args.findIndex(a => a === '--date');
const TODAY   = dateIdx !== -1
  ? args[dateIdx + 1]
  : new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });

const BRANCH  = `daily/${TODAY}`;

function git(cmd, opts = {}) {
  return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();
}

function hasChanges() {
  const status = git('status --porcelain');
  return status.length > 0;
}

function todayCommits() {
  try {
    const since = `${TODAY} 00:00:00`;
    const logs = git(`log --oneline --after="${since}" --format="- %s" origin/master..HEAD`);
    return logs || '';
  } catch { return ''; }
}

function diffStat() {
  try { return git('diff --stat HEAD'); } catch { return ''; }
}

function branchExists(branch) {
  try { git(`rev-parse --verify ${branch}`); return true; } catch { return false; }
}

(async function main() {
  console.log(`\n📦 Daily PR — ${TODAY}\n`);

  if (!hasChanges()) {
    console.log('✅ ไม่มี uncommitted changes — ข้าม');
    process.exit(0);
  }

  // ตรวจว่า branch มีอยู่แล้วไหม
  if (branchExists(BRANCH)) {
    console.log(`⚠️  branch ${BRANCH} มีอยู่แล้ว — switch แล้ว commit เพิ่ม`);
    git(`checkout ${BRANCH}`);
  } else {
    git(`checkout -b ${BRANCH}`);
    console.log(`🌿 สร้าง branch: ${BRANCH}`);
  }

  // commit ทุก changes
  git('add -A');
  const commitMsg = `daily(${TODAY}): สรุปงานประจำวัน`;
  git(`commit -m "${commitMsg}"`);
  console.log(`✅ commit: ${commitMsg}`);

  // push
  git(`push -u origin ${BRANCH}`);
  console.log(`🚀 push → origin/${BRANCH}`);

  // สร้าง PR description
  const commits = todayCommits();
  const stat    = diffStat();

  const body = [
    `## สรุปงานวันที่ ${TODAY}`,
    '',
    commits ? `### Commits\n${commits}` : '',
    '',
    stat ? `### Files changed\n\`\`\`\n${stat}\n\`\`\`` : '',
    '',
    '---',
    `🤖 สร้างอัตโนมัติโดย daily-pr.js เวลา 00:00 น.`,
  ].filter(l => l !== null).join('\n');

  // เปิด PR ผ่าน gh CLI
  try {
    const result = execFileSync('gh', [
      'pr', 'create',
      '--title', `daily: ${TODAY}`,
      '--body', body,
      '--base', 'master',
      '--head', BRANCH,
    ], { cwd: ROOT, encoding: 'utf8' });
    console.log(`\n✅ PR เปิดแล้ว: ${result.trim()}`);
  } catch (e) {
    console.error('❌ gh pr create ล้มเหลว:', e.message);
    process.exit(1);
  }

  // กลับ master
  git('checkout master');
  console.log('↩️  กลับ branch master\n');
})();
