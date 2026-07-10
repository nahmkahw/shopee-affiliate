'use strict';
/**
 * worklog-runner.js — orchestrator ที่ worklog.yml เรียก (thin, อ่าน env → ทำงาน)
 *
 * อ่าน metadata ของ PR ที่ merge จาก env → append Google Sheet → แจ้ง Slack
 * env: PR_NUMBER, PR_TITLE, PR_AUTHOR, PR_BRANCH, PR_URL, PR_MERGED_AT,
 *      PR_COMMITS, PR_CHANGED_FILES, PR_ADDITIONS, PR_DELETIONS, CI_STATUS
 */

const { appendWorklog } = require('./gsheet-worklog');
const { postSlack } = require('./slack-notify');

function mergedDateBKK(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }); // YYYY-MM-DD
}

function buildPr(env = process.env) {
  return {
    number: env.PR_NUMBER,
    title: env.PR_TITLE || '',
    author: env.PR_AUTHOR || '',
    branch: env.PR_BRANCH || '',
    url: env.PR_URL || '',
    mergedDate: mergedDateBKK(env.PR_MERGED_AT),
    commits: Number(env.PR_COMMITS) || 0,
    changedFiles: Number(env.PR_CHANGED_FILES) || 0,
    additions: Number(env.PR_ADDITIONS) || 0,
    deletions: Number(env.PR_DELETIONS) || 0,
    ciStatus: env.CI_STATUS || '',
    deployStatus: 'pending',
  };
}

async function main() {
  const pr = buildPr();
  let logged;
  try {
    logged = await appendWorklog(pr);
  } catch (e) {
    // worklog ล้มเหลวไม่ควรทำให้ workflow แดง (best-effort) — แจ้งแล้วไปต่อ
    console.error('[worklog] append error:', e.message);
    logged = { error: e.message };
  }

  const cat = logged.category || '';
  const agent = logged.agent || '';
  const tag = [cat, agent].filter(Boolean).join('/');
  const sheetNote = logged.skipped ? ' (sheet: ยังไม่ตั้งค่า)'
    : logged.error ? ` (sheet error: ${logged.error})` : '';
  const text = `✅ merged #${pr.number} — ${pr.title}`
    + `\n${tag ? `[${tag}] ` : ''}by ${pr.author} · `
    + `${pr.commits} commits · +${pr.additions}/-${pr.deletions}${sheetNote}`
    + `\n${pr.url}`;

  try {
    await postSlack(text);
  } catch (e) {
    console.error('[slack] error:', e.message);
  }
  console.log('[worklog] done:', tag || '(no tag)');
}

if (require.main === module) main();

module.exports = { buildPr, mergedDateBKK };
