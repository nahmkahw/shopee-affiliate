'use strict';
/**
 * deploy-runner.js — CD 8 สเต็ป (รันบน self-hosted runner, เครื่อง Windows)
 *
 * ทำงานกับ **repo จริงที่ agent รันอยู่** (DEPLOY_PATH) ไม่ใช่ workspace ของ runner
 * นโยบายที่ตกลงไว้: GPU ไม่ว่าง → รอ (timeout 15 นาที) | health พัง → retry restart 1 ครั้ง
 *                   → ยังพัง = แจ้ง Discord, **ไม่แตะ git** (ไม่ auto-rollback)
 *
 * env: DEPLOY_PATH (บังคับ), DISCORD_WEBHOOK_URL, GCP_SA_KEY, GOOGLE_CALENDAR_ID
 */

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const { evaluate } = require('./deploy-precheck');
const { waitForGpuIdle } = require('./deploy-guard');
const { waitHealthy } = require('./health-check');
const { postDiscord } = require('./discord-notify');
const { logDeploy } = require('./gcal-log');

const ROOT = process.env.DEPLOY_PATH;
const BRANCH = process.env.DEPLOY_BRANCH || 'master';
const STATE_FILES = ['agent-status.json', 'agents/mayom/index.json', 'agents/mayom/users.json'];

const log = (...a) => console.log('[deploy]', ...a);
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const lines = s => s.split('\n').map(x => x.trim()).filter(Boolean);

/** 1. pre-check — เทียบ local vs upstream, หา conflict จริง (ไม่ abort เพราะ runtime file) */
function preCheck() {
  if (!ROOT || !fs.existsSync(path.join(ROOT, '.git'))) {
    throw new Error(`DEPLOY_PATH ไม่ใช่ git repo: ${ROOT}`);
  }
  const currentBranch = git('rev-parse', '--abbrev-ref', 'HEAD');
  git('fetch', 'origin', BRANCH);
  const behind = parseInt(git('rev-list', '--count', `HEAD..origin/${BRANCH}`), 10) || 0;
  const localModified = [
    ...lines(git('diff', '--name-only')),
    ...lines(git('diff', '--cached', '--name-only')),
  ];
  const upstreamChanged = behind > 0 ? lines(git('diff', '--name-only', `HEAD..origin/${BRANCH}`)) : [];
  const verdict = evaluate({ localModified, upstreamChanged, behind, currentBranch, targetBranch: BRANCH });
  return { ...verdict, upstreamChanged, currentBranch };
}

/** 3. backup state ที่ไม่ได้อยู่ใน git (กู้เองได้ถ้าพัง) */
function backupState() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(ROOT, 'backups', `deploy-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const rel of STATE_FILES) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(dir, rel.replace(/[/\\]/g, '_'));
    fs.copyFileSync(src, dst);
    n++;
  }
  log(`backup ${n} ไฟล์ → ${dir}`);
  return dir;
}

/**
 * 6. restart — ต้องรอดจากการที่ job จบ
 *
 * GitHub Actions runner ฆ่าโปรเซสตกค้างที่ถือ env `RUNNER_TRACKING_ID` เดียวกับ job
 * → agent-hub ที่เพิ่ง spawn สืบทอด env นี้มา เลยถูกเก็บไปด้วยตอน job จบ (ระบบดับค้าง)
 * แก้: ลบ RUNNER_TRACKING_ID ออกจาก env + ใช้ `start` เปิด console ใหม่ (หลุด process tree)
 */
function restart() {
  const bat = path.join(ROOT, 'start-all-agents.bat');
  if (!fs.existsSync(bat)) throw new Error(`ไม่พบ ${bat}`);
  const env = { ...process.env };
  delete env.RUNNER_TRACKING_ID;
  const p = spawn('cmd.exe', ['/c', 'start', '""', '/min', bat], {
    cwd: ROOT, detached: true, stdio: 'ignore', env, windowsHide: true,
  });
  p.unref();
  log('เรียก start-all-agents.bat (detached, ตัด RUNNER_TRACKING_ID)');
}

async function main() {
  const started = Date.now();
  const before = git('rev-parse', 'HEAD');
  let sha = before;

  // 1. pre-check
  const pre = preCheck();
  if (!pre.proceed) {
    const msgs = {
      'up-to-date': `ℹ️ Deploy ข้าม — ${BRANCH} ไม่มีอะไรใหม่ (HEAD ${before.slice(0, 7)})`,
      'wrong-branch': `❌ Deploy หยุด — DEPLOY_PATH อยู่ branch \`${pre.currentBranch}\` ไม่ใช่ \`${BRANCH}\`\n`
        + `รัน \`git -C "${ROOT}" checkout ${BRANCH}\` บนเครื่องก่อน แล้วกด Deploy ใหม่`,
      'conflict': `❌ Deploy หยุด — ไฟล์แก้ค้างชนกับ upstream:\n`
        + `${(pre.conflicts || []).map(c => `• ${c}`).join('\n')}\ncommit/stash ก่อนแล้วกดใหม่`,
    };
    const msg = msgs[pre.reason] || `❌ Deploy หยุด — ${pre.reason}`;
    log(msg);
    await postDiscord(msg).catch(e => console.error('[discord]', e.message));
    process.exitCode = pre.reason === 'up-to-date' ? 0 : 1;
    return;
  }
  log(`มี ${pre.behind} commit ใหม่ · npm ci = ${pre.npmCi}`);

  // 2. GPU guard — รอจนว่าง
  const gpu = await waitForGpuIdle({ log });
  if (!gpu.idle) {
    const who = gpu.holder ? `${gpu.holder.agent}` : 'unknown';
    const msg = `⏳ Deploy ยกเลิก — GPU ไม่ว่างเกิน ${Math.round(gpu.waitedMs / 60000)} นาที (ถือโดย ${who}) กดใหม่ทีหลัง`;
    log(msg);
    await postDiscord(msg).catch(e => console.error('[discord]', e.message));
    process.exitCode = 1;
    return;
  }
  log(`GPU ว่าง (รอ ${Math.round(gpu.waitedMs / 1000)}s)`);

  // 3-5. backup → pull → deps
  const backupDir = backupState();
  git('pull', '--ff-only', 'origin', BRANCH);
  sha = git('rev-parse', 'HEAD');
  log(`pull สำเร็จ → ${sha.slice(0, 7)}`);

  if (pre.npmCi) {
    log('package-lock เปลี่ยน → npm ci');
    execFileSync('npm', ['ci'], { cwd: ROOT, encoding: 'utf8', stdio: 'inherit', shell: true });
  }

  // 6-7. restart → health (soft-retry 1 ครั้ง, ไม่แตะ git)
  // initialDelayMs: bat มี timeout รวม ~6s + hub boot — อย่า probe ทับ hub ตัวเก่า
  const HEALTH_BOOT_MS = parseInt(process.env.DEPLOY_HEALTH_BOOT_MS || '10000', 10);
  restart();
  let health = await waitHealthy({ log, initialDelayMs: HEALTH_BOOT_MS });
  if (!health.healthy) {
    log('health ไม่ผ่าน — soft-retry restart อีก 1 ครั้ง');
    restart();
    health = await waitHealthy({ log, initialDelayMs: HEALTH_BOOT_MS });
  }

  const durationMin = Math.max(1, Math.round((Date.now() - started) / 60000));
  const ok = health.healthy;
  const summary = ok
    ? `🚀 Deploy สำเร็จ — ${sha.slice(0, 7)} (${pre.behind} commits, ${durationMin} นาที)`
    : `❌ Deploy ล้มเหลว — agent-hub ไม่ขึ้นหลัง restart 2 ครั้ง (${sha.slice(0, 7)})\n`
      + `git **ไม่ถูกแตะ** (ไม่ rollback) — เข้าไปดูเครื่องด่วน\nbackup: ${backupDir}\n`
      + `last: ${health.last?.error || 'HTTP ' + health.last?.status}`;

  log(summary);
  await postDiscord(summary).catch(e => console.error('[discord]', e.message));
  await logDeploy({ sha, ok, summary, details: `backup: ${backupDir}`, durationMin })
    .catch(e => console.error('[gcal]', e.message));

  process.exitCode = ok ? 0 : 1;
}

/**
 * ⚠️ ห้ามบังคับออกด้วย `process` + `.exit` ที่ไฟล์นี้ (มี regression test คุมอยู่)
 * deploy spawn child (detached) + เปิด socket → บังคับออกระหว่างที่ libuv กำลังปิด handle
 * ทำให้ crash: "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c:94"
 * → workflow แดงทั้งที่ deploy สำเร็จแล้ว (เกิดจริง run 29101467311)
 * ใช้ `process.exitCode` แล้วปล่อยให้ node ปิด handle เองจนจบ event loop
 */
if (require.main === module) {
  main().catch(async (e) => {
    console.error('[deploy] error:', e.message);
    await postDiscord(`❌ Deploy error: ${e.message}`).catch(() => {});
    process.exitCode = 1;
  });
}

module.exports = { preCheck, backupState, restart };
