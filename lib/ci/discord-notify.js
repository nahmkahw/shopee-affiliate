'use strict';
/**
 * discord-notify.js — ยิงข้อความเข้า Discord Webhook (thin wrapper)
 *
 * ใช้ร่วม: ci.yml (แจ้ง build fail), worklog.yml (แจ้ง PR merged), deploy.yml (Phase 3)
 * No-op เงียบๆ ถ้าไม่มี DISCORD_WEBHOOK_URL — ให้ workflow ไม่พังตอน Discord ยังไม่ตั้งค่า
 *
 * CLI: node lib/ci/discord-notify.js "ข้อความ"   (อ่าน webhook จาก env)
 */

const DISCORD_MAX = 2000; // Discord จำกัด content 2000 ตัวอักษร

async function postDiscord(content, { webhookUrl = process.env.DISCORD_WEBHOOK_URL } = {}) {
  if (!webhookUrl) {
    console.log('[discord] DISCORD_WEBHOOK_URL ว่าง — ข้าม (no-op)');
    return { skipped: true };
  }
  const text = String(content).slice(0, DISCORD_MAX);
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text }),
  });
  // Discord ตอบ 204 No Content เมื่อสำเร็จ
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord webhook ${res.status}: ${body}`);
  }
  return { ok: true };
}

module.exports = { postDiscord };

if (require.main === module) {
  const text = process.argv.slice(2).join(' ') || '(empty)';
  postDiscord(text)
    .then(r => { if (r.ok) console.log('[discord] sent'); })
    .catch(e => { console.error('[discord] error:', e.message); process.exit(1); });
}
