'use strict';
/**
 * agents/mayom/summarize.js — aggregation สำหรับ dashboard
 * จัดกลุ่มตามวัน (created_at เวลาไทย), หมวด, และ user. รายการ duplicate ไม่นับยอด
 */

const store = require('./store');

function bkkDate(iso) {
  // คืน 'YYYY-MM-DD' ตามเวลา Asia/Bangkok
  const d = new Date(iso);
  const b = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const y = b.getFullYear(), m = String(b.getMonth() + 1).padStart(2, '0'), day = String(b.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * build — คำนวณสรุปทั้งหมดจาก transactions ทั้งชุด (+ ฟิลเตอร์ optional)
 * @param {{from?:string,to?:string,user?:string,category?:string}} filter
 */
function build(filter = {}) {
  const all = store.readAll();
  const cats = store.getCategories();
  const users = store.getUsers();
  const todayStr = bkkDate(new Date().toISOString());
  const monthPrefix = todayStr.slice(0, 7);

  // ── ฟิลเตอร์สำหรับตาราง/สรุปที่ผู้ใช้เลือก ──
  const filtered = all.filter(t => {
    const day = bkkDate(t.created_at);
    if (filter.from && day < filter.from) return false;
    if (filter.to && day > filter.to) return false;
    if (filter.user && t.line_user_id !== filter.user) return false;
    if (filter.category && (t.category || 'อื่นๆ') !== filter.category) return false;
    return true;
  });

  const counted = all.filter(t => !t.duplicate && t.status === 'recorded' && t.amount != null);
  const sum = arr => arr.reduce((s, t) => s + (t.amount || 0), 0);

  // ── การ์ดสรุป (นับจากทั้งชุด ไม่ตามฟิลเตอร์) ──
  const totals = {
    today: sum(counted.filter(t => bkkDate(t.created_at) === todayStr)),
    month: sum(counted.filter(t => bkkDate(t.created_at).startsWith(monthPrefix))),
    all: sum(counted),
    count: counted.length,
    needsReview: all.filter(t => t.status === 'needs_review').length,
    duplicates: all.filter(t => t.duplicate).length,
  };

  // ── กราฟรายวัน 30 วัน (stacked ตามหมวด) ──
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    days.push(bkkDate(d.toISOString()));
  }
  const catNames = cats.map(c => c.name);
  const daily = days.map(day => {
    const row = { day: day.slice(5), byCat: {} };
    for (const c of catNames) row.byCat[c] = 0;
    counted.filter(t => bkkDate(t.created_at) === day).forEach(t => {
      const c = catNames.includes(t.category) ? t.category : 'อื่นๆ';
      row.byCat[c] += t.amount || 0;
    });
    row.total = catNames.reduce((s, c) => s + row.byCat[c], 0);
    return row;
  });

  // ── แยกตาม user (นับจาก counted) ──
  const byUserMap = {};
  for (const t of counted) {
    const k = t.line_user_id;
    if (!byUserMap[k]) byUserMap[k] = { key: k, display: users[k] || t.line_display_name || k, count: 0, total: 0 };
    byUserMap[k].count++; byUserMap[k].total += t.amount || 0;
  }
  const byUser = Object.values(byUserMap).sort((a, b) => b.total - a.total);

  // ── รายการล่าสุด (ตามฟิลเตอร์) ──
  const rows = filtered
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 200)
    .map(t => ({ ...t, display: users[t.line_user_id] || t.line_display_name || t.line_user_id }));

  return { totals, daily, catNames, cats, byUser, rows, users };
}

module.exports = { build, bkkDate };
