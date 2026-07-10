'use strict';
/**
 * slack-notify.js — ยิงข้อความเข้า Slack Incoming Webhook (thin wrapper)
 *
 * ใช้ร่วม: ci.yml (แจ้ง build fail), worklog.yml (แจ้ง PR merged), deploy.yml (Phase 3)
 * No-op เงียบๆ ถ้าไม่มี SLACK_WEBHOOK_URL — ให้ workflow ไม่พังตอน Slack ยังไม่ตั้งค่า
 *
 * CLI: node lib/ci/slack-notify.js "ข้อความ"   (อ่าน webhook จาก env)
 */

async function postSlack(text, { webhookUrl = process.env.SLACK_WEBHOOK_URL, blocks } = {}) {
  if (!webhookUrl) {
    console.log('[slack] SLACK_WEBHOOK_URL ว่าง — ข้าม (no-op)');
    return { skipped: true };
  }
  const payload = blocks ? { text, blocks } : { text };
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Slack webhook ${res.status}: ${body}`);
  }
  return { ok: true };
}

module.exports = { postSlack };

if (require.main === module) {
  const text = process.argv.slice(2).join(' ') || '(empty)';
  postSlack(text)
    .then(r => { if (r.ok) console.log('[slack] sent'); })
    .catch(e => { console.error('[slack] error:', e.message); process.exit(1); });
}
