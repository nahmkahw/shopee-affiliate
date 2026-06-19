'use strict';
/**
 * lib/namkhao-bot-news.js — จัดการ news approval callbacks สำหรับ namkhao bot
 */

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function loadQueue(tgQueueFile) {
  try { return JSON.parse(fs.readFileSync(tgQueueFile, 'utf8')); }
  catch { return {}; }
}

function resolveSlug(newsDir, prefix, log) {
  if (!fs.existsSync(newsDir)) {
    if (log) log(`⚠️ resolveSlug: ไม่พบ newsDir "${newsDir}"`);
    return null;
  }
  const dirs  = fs.readdirSync(newsDir, { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => e.name);
  if (log) log(`[resolveSlug] prefix="${prefix}" dirs(${dirs.length}): ${dirs.slice(0, 3).join(' | ')}`);
  const found = dirs.find(d => d === prefix || d.startsWith(prefix));
  if (!found && log) log(`⚠️ resolveSlug: ไม่พบ slug prefix="${prefix}"`);
  return found || null;
}

function setNewsStatus(newsDir, slug, status) {
  const dataPath = path.join(newsDir, slug, 'data.json');
  if (!fs.existsSync(dataPath)) return false;
  try {
    const data      = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    data.status     = status;
    data.approved_at = new Date().toISOString();
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch { return false; }
}

function schedulePost(aiNewsDir, slug, platform = 'fb', env = {}) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [path.join(aiNewsDir, 'post.js'), slug, '--schedule', '--platform', platform], {
      cwd:   aiNewsDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env:   { ...process.env, ...env },
    });
    let output = '', done = false;
    const finish = (code, out) => { if (done) return; done = true; resolve({ code, output: out.trim() }); };
    proc.stdout.on('data', d => { output += d.toString(); });
    proc.stderr.on('data', d => { output += d.toString(); });
    proc.on('close',  code => finish(code, output));
    proc.on('error',  err  => finish(-1, err.message));
    setTimeout(() => finish(-1, output + '\n[timeout 60s]'), 60000);
  });
}

async function handleNewsCallback(cbData, cbq, cbChat, { tgRequest, sendMsg, loadQueueFn, newsDir, aiNewsDir, env, log }) {
  // รูปแบบ generate.js: approve:shortId / cancel:shortId / regen:shortId
  if (cbData.startsWith('approve:') || cbData.startsWith('cancel:') || cbData.startsWith('regen:')) {
    const colonIdx = cbData.indexOf(':');
    const action   = cbData.substring(0, colonIdx);
    const shortId  = cbData.substring(colonIdx + 1);
    const queue    = loadQueueFn();
    const entry    = queue[shortId];

    if (!entry) {
      await tgRequest('answerCallbackQuery', { callback_query_id: cbq.id, text: '❓ ไม่พบข่าวนี้ใน queue' });
      return true;
    }

    const slug     = typeof entry === 'string' ? entry : entry.slug;
    const platform = (typeof entry === 'object' && entry.platform) ? entry.platform : 'fb,ig';
    if (log) log(`[queue] action=${action} shortId=${shortId} slug=${slug} platform=${platform}`);

    if (action === 'approve') {
      await tgRequest('answerCallbackQuery', { callback_query_id: cbq.id, text: '⏳ กำลัง schedule...' });
      await sendMsg(cbChat, `⏳ <b>กำลัง schedule...</b>\n<code>${slug}</code>`);
      if (log) log(`⏳ schedule (queue): ${slug} [${platform}]`);

      const { code, output } = await schedulePost(aiNewsDir, slug, platform, env);
      if (code === 0) {
        const timeMatch = output.match(/กำหนดโพสต์:\s*(.+)/);
        const timeStr   = timeMatch ? timeMatch[1].trim() : '';
        if (log) log(`✅ scheduled: ${slug}`);
        await sendMsg(cbChat, `✅ <b>Schedule สำเร็จ!</b>\n<code>${slug}</code>\n` + (timeStr ? `⏰ <b>กำหนดโพสต์:</b> ${timeStr}` : ''));
      } else {
        if (log) log(`❌ schedule ล้มเหลว: ${slug} (code=${code})`);
        const errSnip = output.slice(-200).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        await sendMsg(cbChat, `❌ <b>Schedule ล้มเหลว</b> (code=${code})\n<code>${slug}</code>\n` + (errSnip ? `<pre>${errSnip}</pre>` : ''));
      }
    } else if (action === 'cancel') {
      setNewsStatus(newsDir, slug, 'skipped');
      await tgRequest('answerCallbackQuery', { callback_query_id: cbq.id, text: '❌ ยกเลิกแล้ว' });
      if (log) log(`❌ cancelled: ${slug}`);
      await sendMsg(cbChat, `❌ <b>ยกเลิกแล้ว</b>\n<code>${slug}</code>`);
    } else {
      await tgRequest('answerCallbackQuery', { callback_query_id: cbq.id, text: '⚠️ ไม่รองรับ — ใช้ generate.js --force แทน' });
    }
    return true;
  }

  // รูปแบบ formatter-agent: approve__slug / skip__slug
  if (cbData.startsWith('approve__') || cbData.startsWith('skip__')) {
    const isApprove = cbData.startsWith('approve__');
    const prefix    = cbData.replace(/^(approve|skip)__/, '');
    if (log) log(`[approve] cbData="${cbData}" prefix="${prefix}"`);
    const slug      = resolveSlug(newsDir, prefix, log);

    if (!slug) {
      await tgRequest('answerCallbackQuery', { callback_query_id: cbq.id, text: '❓ ไม่พบข่าวนี้' });
      return true;
    }

    if (isApprove) {
      await tgRequest('answerCallbackQuery', { callback_query_id: cbq.id, text: '⏳ กำลัง schedule...' });
      await sendMsg(cbChat, `⏳ <b>กำลัง schedule...</b>\n<code>${slug}</code>`);
      if (log) log(`⏳ schedule: ${slug}`);

      const { code, output } = await schedulePost(aiNewsDir, slug, 'fb', env);
      if (code === 0) {
        const timeMatch = output.match(/กำหนดโพสต์:\s*(.+)/);
        if (log) log(`✅ scheduled: ${slug}`);
        await sendMsg(cbChat, `✅ <b>Schedule สำเร็จ!</b>\n<code>${slug}</code>\n` + (timeMatch ? `⏰ <b>กำหนดโพสต์:</b> ${timeMatch[1].trim()}` : ''));
      } else {
        if (log) log(`❌ schedule ล้มเหลว: ${slug} (code=${code})`);
        const errSnip = output.slice(-200).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        await sendMsg(cbChat, `❌ <b>Schedule ล้มเหลว</b> (code=${code})\n<code>${slug}</code>\n` + (errSnip ? `<pre>${errSnip}</pre>` : ''));
      }
    } else {
      setNewsStatus(newsDir, slug, 'skipped');
      await tgRequest('answerCallbackQuery', { callback_query_id: cbq.id, text: '❌ ข้ามแล้ว' });
      if (log) log(`❌ skipped: ${slug}`);
      await sendMsg(cbChat, `❌ <b>ข้ามแล้ว</b>\n<code>${slug}</code>`);
    }
    return true;
  }

  return false; // ไม่ใช่ news callback
}

module.exports = { loadQueue, resolveSlug, setNewsStatus, schedulePost, handleNewsCallback };
