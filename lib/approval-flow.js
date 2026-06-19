'use strict';
/**
 * lib/approval-flow.js — Approval loop + old-products menu + content regeneration
 *
 * ใช้งาน:
 *   const { createApprovalFlow } = require('./lib/approval-flow');
 *   const flow = createApprovalFlow({ sendMsg, editMsg, answerCb, waitForCallback, waitForDecision, sleep, postAllPlatforms, ROOT });
 */

const fs   = require('fs');
const path = require('path');

const HOOKS = [
  (title) => `ใครกำลังมองหา "${title.substring(0, 30)}" อยู่บ้าง? 🙋\n\nบอกเลยว่าเจอของตรงปกแล้ว!`,
  ()      => `รู้สึกเสียดายเงินกับของที่ซื้อแล้วไม่คุ้มไหม? 💸\n\nครั้งนี้ขอแนะนำตัวเลือกที่น่าสนใจมากกว่านั้น`,
  ()      => `ของดีราคาคุ้ม หายากแค่ไหน? 🔍\n\nไม่ต้องตามหาอีกต่อไป เจอแล้ว!`,
  ()      => `ช้อปออนไลน์แล้วผิดหวังบ่อยไหม? 😅\n\nรายการนี้รีวิวดีมาก บอกต่อเลย`,
  ()      => `ของที่ใช้แล้วชอบ อยากแชร์ให้เพื่อน ๆ รู้จัก 📢`,
];

function regenerateFromTemplate(data, attempt) {
  const hook     = HOOKS[(attempt - 1) % HOOKS.length](data.title || '');
  const features = [];
  if (data.rating)    features.push(`⭐ รีวิว ${data.rating}/5 — ผู้ซื้อให้คะแนนสูง`);
  if (data.discount)  features.push(`🏷️ ลดราคา ${data.discount} จากราคาปกติ`);
  if (data.shop_name) features.push(`🏪 จากร้าน ${data.shop_name} ที่เชื่อถือได้`);
  features.push(`✅ สินค้าพร้อมส่ง ของแท้ 100%`);

  const priceSection = data.original_price
    ? `~~${data.original_price} บาท~~ → เหลือแค่ **${data.price} บาท** เท่านั้น!`
    : `ราคา **${data.price} บาท** เท่านั้น!`;

  return `${hook}\n\nขอแนะนำ ${data.title}\n\n${features.join('\n')}\n\n${priceSection}\n\nสั่งซื้อ / ดูรายละเอียดเพิ่ม 👉 ${data.affiliate_short_link}\n.\n.\n#Shopeeaffiliate #รีวิวของดี #Shopeeไทย #ของน่าซื้อ`;
}

function createApprovalFlow({ sendMsg, editMsg, answerCb, waitForCallback, waitForDecision, sleep, postAllPlatforms, ROOT }) {

  async function approveLoop(itemId, data) {
    const title       = (data.title || '').substring(0, 35);
    const contentPath = path.join('products', itemId, 'content', 'facebook.md');

    if (!fs.existsSync(contentPath)) {
      await sendMsg(`⚠️ ไม่พบ facebook.md สำหรับ\n<b>${title}</b> (${itemId})\nกรุณารัน /สร้าง-content ก่อน`);
      return false;
    }

    let attempt = 0;
    while (true) {
      attempt++;
      const content = fs.readFileSync(contentPath, 'utf8').trim();
      const preview = content.length > 3200 ? content.substring(0, 3200) + '\n...' : content;
      const header  =
        `📝 <b>รอ Approve (ครั้งที่ ${attempt})</b>\n` +
        `🛍 ${title}\n💰 ${data.price} บาท | ⭐ ${data.rating}\n` +
        `${'─'.repeat(28)}\n`;
      const apData = `ap_${itemId}_${attempt}`;
      const rgData = `rg_${itemId}_${attempt}`;

      const msg   = await sendMsg(header + preview, [[
        { text: '✅ โพสต์เลย',           callback_data: apData },
        { text: '🔄 สร้าง Content ใหม่', callback_data: rgData }
      ]]);
      const msgId = msg.result?.message_id;
      const { decision, cbId } = await waitForDecision(apData, rgData);

      if (decision === 'timeout') {
        if (msgId) await editMsg(msgId, header + preview + '\n\n⏰ <b>หมดเวลา — ข้ามสินค้านี้</b>');
        return false;
      }
      if (decision === 'approve') {
        await answerCb(cbId, '✅ กำลังโพสต์...');
        if (msgId) await editMsg(msgId, header + preview + '\n\n✅ <b>Approved — กำลังโพสต์...</b>');
        return true;
      }

      await answerCb(cbId, '🔄 กำลังสร้าง content ใหม่...');
      try { if (msgId) await editMsg(msgId, header + preview + '\n\n🔄 <b>กำลังสร้าง content ใหม่...</b>'); } catch {}
      try {
        fs.writeFileSync(contentPath, regenerateFromTemplate(data, attempt), 'utf8');
        console.log(`  ✓ สร้าง content ใหม่สำเร็จ (รอบที่ ${attempt})`);
      } catch (e) {
        await sendMsg(`❌ สร้าง content ใหม่ไม่สำเร็จ: ${e.message.substring(0, 200)}\nกรุณาสร้างเองแล้วรัน approval-bot.js ใหม่`);
        return false;
      }
      await sendMsg(`🔄 สร้าง content ใหม่เรียบร้อยแล้ว!\nกำลังส่ง content รอบที่ ${attempt + 1} ให้ Approve 👇`);
      await sleep(500);
    }
  }

  async function postAndReport(id, title) {
    await sendMsg(`⏳ กำลังโพสต์ <b>${title}</b> ไปยัง FB Schedule + FB Clip...`);
    const r = await postAllPlatforms(id, ROOT);
    const summary =
      `📘 Facebook: ${r.fb}\n📸 Instagram: ⏭ ข้าม\n🎬 FB Reels: ${r.fbClip}` +
      (r.error ? `\n\n⚠️ Error: ${r.error}` : '');
    const allOk = r.fb.startsWith('✅');
    await sendMsg((allOk ? '✅' : '⚠️') + ` <b>โพสต์เสร็จแล้ว</b>\n🛍 ${title}\n\n${summary}`);
    return allOk;
  }

  async function handleOldProducts(oldProducts) {
    const PAGE = 8;
    let page = 0;
    while (true) {
      const slice   = oldProducts.slice(page * PAGE, page * PAGE + PAGE);
      const totalPg = Math.ceil(oldProducts.length / PAGE);
      const hasNext = (page + 1) * PAGE < oldProducts.length;
      const hasPrev = page > 0;

      const keyboard = slice.map(({ id, data }) => [{
        text: `${data.post_date} | ${(data.title || '').substring(0, 22)}`,
        callback_data: `os_${id}`
      }]);
      const nav = [];
      if (hasPrev) nav.push({ text: '⬅️ ก่อนหน้า', callback_data: `op_${page - 1}` });
      nav.push({ text: '✅ เสร็จแล้ว', callback_data: 'old_done' });
      if (hasNext) nav.push({ text: 'ถัดไป ➡️', callback_data: `op_${page + 1}` });
      keyboard.push(nav);

      const msg   = await sendMsg(
        `📦 <b>สินค้าเก่า</b> — เลือกรายการที่ต้องการโพสต์\nหน้า ${page + 1}/${totalPg} (${oldProducts.length} รายการ)`,
        keyboard
      );
      const msgId = msg.result?.message_id;
      const validCbs = [
        ...slice.map(({ id }) => `os_${id}`), 'old_done',
        ...(hasPrev ? [`op_${page - 1}`] : []),
        ...(hasNext ? [`op_${page + 1}`] : [])
      ];

      const { data, cbId } = await waitForCallback(validCbs, 10 * 60 * 1000);
      if (cbId) await answerCb(cbId, '');

      if (data === 'timeout' || data === 'old_done') {
        if (msgId) await editMsg(msgId, `📦 สินค้าเก่า — ✅ เสร็จแล้ว`);
        return;
      }
      if (data.startsWith('op_')) {
        page = parseInt(data.slice(3));
        if (msgId) await editMsg(msgId, `📦 กำลังโหลดหน้า ${page + 1}...`);
        continue;
      }
      if (data.startsWith('os_')) {
        const selPrd = oldProducts.find(p => p.id === data.slice(3));
        if (!selPrd) continue;
        const selTitle = (selPrd.data.title || '').substring(0, 35);
        if (msgId) await editMsg(msgId, `📝 กำลังแสดง content ของ\n<b>${(selPrd.data.title || '').substring(0, 40)}</b>...`);
        const approved = await approveLoop(selPrd.id, selPrd.data);
        if (approved) await postAndReport(selPrd.id, selTitle);
      }
    }
  }

  return { approveLoop, handleOldProducts, postAndReport };
}

module.exports = { createApprovalFlow, regenerateFromTemplate };
