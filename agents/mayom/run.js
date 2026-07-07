'use strict';
/**
 * agents/mayom/run.js — entry point ของ Agent มะยม
 *
 *   node run.js --action process-slip --message-id <id> --user-id <uid> --group-id <gid> [--reply-token <t>]
 *   node run.js --action caption --user-id <uid> --text "<ข้อความ>"
 *
 * ถูก spawn โดย agent-hub/routes/mayom.js หลังรับ webhook (route ตอบ 200 ไปแล้ว)
 */

const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const store = require('./store');
const line  = require('../../lib/line-client');
const { readSlip } = require('../../lib/slip-ocr');

const TOKEN    = process.env.MAYOM_LINE_CHANNEL_ACCESS_TOKEN || '';
const GROUP_ID = process.env.MAYOM_LINE_GROUP_ID || '';

function arg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function notify(to, replyToken, text) {
  if (!TOKEN || !to) return;
  // ลอง reply ก่อน (ฟรี) ถ้าพลาด/หมดอายุ → push
  if (replyToken) {
    try { await line.replyMessage(replyToken, text, TOKEN); return; } catch {}
  }
  try { await line.pushMessage(to, text, TOKEN); } catch (e) { console.error('[mayom] push fail:', e.message); }
}

// ── parse ข้อความกำกับ: คำแรก=category (ถ้า match หมวด), ที่เหลือ=note ─────────────
function parseCaption(text) {
  const parts = String(text || '').trim().split(/\s+/);
  const first = parts[0] || '';
  const cat = store.matchCategory(first);
  if (cat) return { category: cat, note: parts.slice(1).join(' ') || '' };
  // คำแรกไม่ตรงหมวด → ทั้งข้อความเป็น note, category ปล่อยว่าง (→ อื่นๆ)
  return { category: null, note: String(text || '').trim() };
}

async function processSlip() {
  const messageId  = arg('--message-id');
  const lineUserId = arg('--user-id') || 'unknown';
  const groupId    = arg('--group-id') || GROUP_ID;
  const replyToken = arg('--reply-token');
  if (!messageId) { console.error('[mayom] missing --message-id'); process.exit(1); }
  if (!TOKEN)     { console.error('[mayom] missing MAYOM_LINE_CHANNEL_ACCESS_TOKEN'); process.exit(1); }

  const id = Date.now().toString();

  // 1) ดึงรูป + display name
  const imageBuffer = await line.getMessageContent(messageId, TOKEN);
  let displayName = lineUserId;
  try {
    const prof = await line.getGroupMemberProfile(groupId, lineUserId, TOKEN);
    displayName = prof.displayName || lineUserId;
  } catch {}

  // 2) OCR
  let ocr;
  try { ocr = await readSlip(imageBuffer); }
  catch (e) { console.error('[mayom] OCR error:', e.message); ocr = { is_slip: false }; }

  // 3) ไม่ใช่สลิป → เงียบ ไม่บันทึก
  if (!ocr.is_slip) { console.log('[mayom] not a slip — skip'); return; }

  const imageHash = store.hashImage(imageBuffer);

  // 4) เป็นสลิปแต่อ่านเงินไม่ได้ → บันทึก needs_review + แจ้งให้ส่งใหม่
  if (ocr.amount == null) {
    fs.writeFileSync(store.slipPath(id), imageBuffer);
    store.saveTx({
      id, created_at: new Date().toISOString(), line_user_id: lineUserId, line_display_name: displayName,
      group_id: groupId, amount: null, slip_datetime: ocr.slip_datetime, bank_from: ocr.bank_from,
      bank_to: ocr.bank_to, account_to: ocr.account_to, ref_no: ocr.ref_no, category: null, note: '',
      raw_ocr_text: ocr.raw, slip_image_path: store.slipPath(id), image_hash: imageHash,
      status: 'needs_review', duplicate: false, duplicate_of: null,
    });
    await notify(groupId, replyToken, '🧾 อ่านสลิปไม่ออก ลองส่งใหม่ให้ชัดๆ นะครับ (บันทึกไว้ให้ตรวจแล้ว)');
    return;
  }

  // 5) dedup B+C
  const dup = store.findDuplicate({
    image_hash: imageHash, ref_no: ocr.ref_no, amount: ocr.amount,
    slip_datetime: ocr.slip_datetime, bank_from: ocr.bank_from,
  });

  fs.writeFileSync(store.slipPath(id), imageBuffer);
  store.saveTx({
    id, created_at: new Date().toISOString(), line_user_id: lineUserId, line_display_name: displayName,
    group_id: groupId, amount: ocr.amount, slip_datetime: ocr.slip_datetime, bank_from: ocr.bank_from,
    bank_to: ocr.bank_to, account_to: ocr.account_to, ref_no: ocr.ref_no, category: null, note: '',
    raw_ocr_text: ocr.raw, slip_image_path: store.slipPath(id), image_hash: imageHash,
    status: 'recorded', duplicate: !!dup, duplicate_of: dup ? dup.id : null,
  });

  const baht = ocr.amount.toLocaleString('th-TH');
  if (dup) {
    await notify(groupId, replyToken,
      `⚠️ สลิปนี้บันทึกซ้ำ (${baht} บาท) — เคยบันทึกโดย ${store.displayFor(dup.line_user_id, dup.line_display_name)} แล้ว`);
  } else {
    await notify(groupId, replyToken, `✅ บันทึกแล้ว: ${baht} บาท โดยคุณ${displayName}`);
  }
  console.log(`[mayom] recorded ${id}: ${baht} บาท (dup=${!!dup})`);
}

async function caption() {
  const lineUserId = arg('--user-id');
  const text = arg('--text');
  if (!lineUserId || !text) return;
  const parsed = parseCaption(text);
  const updated = store.attachCaption(lineUserId, parsed);
  if (updated) console.log(`[mayom] caption → ${updated.id}: cat=${updated.category} note=${updated.note}`);
}

(async () => {
  const action = arg('--action', 'process-slip');
  try {
    if (action === 'process-slip') await processSlip();
    else if (action === 'caption') await caption();
    else { console.error('[mayom] unknown action:', action); process.exit(1); }
  } catch (e) {
    console.error('[mayom] fatal:', e.message);
    process.exit(1);
  }
})();
