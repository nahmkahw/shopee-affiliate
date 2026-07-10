'use strict';
/**
 * worklog-parse.js — pure helpers สำหรับ worklog (ไม่มี I/O, เทสต์ได้ล้วน)
 *
 * derive หมวดงาน (feat/fix/perf/…) + agent จาก PR title / branch
 * และรวมยอด daily rollup จากรายการ per-PR
 */

const CATEGORIES = [
  'feat', 'fix', 'perf', 'chore', 'docs',
  'refactor', 'test', 'ci', 'build', 'style', 'revert',
];

// agent ที่รู้จัก (ตรงกับ agents/* ใน repo) — ใช้ normalize scope/branch
const KNOWN_AGENTS = [
  'mali', 'manao', 'makrut', 'namkhao', 'maprang',
  'maprao', 'mayom', 'anime', 'mammuang', 'cicd',
];

/** '<type>(scope): ...' → 'feat' | 'other' */
function deriveCategory(title = '') {
  const m = String(title).trim().match(/^([a-z]+)(\([a-z0-9-]+\))?!?:/i);
  const type = m && m[1] ? m[1].toLowerCase() : '';
  return CATEGORIES.includes(type) ? type : 'other';
}

/**
 * หา agent จาก scope ใน title ก่อน ('feat(mayom): ...' → mayom)
 * ไม่มี scope → เดาจาก branch ('feat/mayom-xxx' → mayom)
 * ไม่รู้จัก → คืนค่าที่เจอ (raw) หรือ '' ถ้าหาไม่ได้
 */
function deriveAgent(title = '', branch = '') {
  const scope = String(title).match(/^[a-z]+\(([a-z0-9-]+)\)/i);
  if (scope && scope[1]) return normalizeAgent(scope[1]);
  const seg = String(branch).split('/').pop() || '';
  const first = seg.split('-')[0];
  return first ? normalizeAgent(first) : '';
}

function normalizeAgent(raw) {
  const v = String(raw).toLowerCase();
  return KNOWN_AGENTS.includes(v) ? v : v;
}

/** แถว per-PR (array ตามลำดับคอลัมน์ของ tab "PRs") */
function prRow(pr) {
  return [
    pr.mergedDate,                       // วันที่ merge (YYYY-MM-DD)
    pr.number,                           // PR#
    pr.title,                            // หัวข้อ
    pr.author,                           // ผู้ทำ
    deriveCategory(pr.title),            // หมวด
    deriveAgent(pr.title, pr.branch),    // agent
    pr.commits ?? 0,                     // #commits
    pr.changedFiles ?? 0,                // ไฟล์เปลี่ยน
    pr.additions ?? 0,                   // +บรรทัด
    pr.deletions ?? 0,                   // -บรรทัด
    pr.ciStatus || '',                   // CI status
    pr.deployStatus || 'pending',        // deploy status
    pr.url || '',                        // ลิงก์ PR
  ];
}

const PR_HEADER = [
  'merge_date', 'pr', 'title', 'author', 'category', 'agent',
  'commits', 'files', 'additions', 'deletions',
  'ci_status', 'deploy_status', 'url',
];

const DAILY_HEADER = [
  'date', 'prs', 'commits', 'additions', 'deletions',
  'feat', 'fix', 'perf', 'other',
];

/**
 * รวมยอด 1 วัน จาก rows per-PR (array ของ prRow) ที่ merge วันเดียวกัน
 * คืน array ตามลำดับ DAILY_HEADER
 */
function dailyRow(date, rows) {
  const sameDay = rows.filter(r => r[0] === date);
  const sum = (i) => sameDay.reduce((a, r) => a + (Number(r[i]) || 0), 0);
  const countCat = (c) => sameDay.filter(r => r[4] === c).length;
  const other = sameDay.length - countCat('feat') - countCat('fix') - countCat('perf');
  return [
    date,
    sameDay.length,   // prs
    sum(6),           // commits
    sum(8),           // additions
    sum(9),           // deletions
    countCat('feat'),
    countCat('fix'),
    countCat('perf'),
    other,
  ];
}

module.exports = {
  CATEGORIES, KNOWN_AGENTS, PR_HEADER, DAILY_HEADER,
  deriveCategory, deriveAgent, prRow, dailyRow,
};
