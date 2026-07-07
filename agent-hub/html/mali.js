'use strict';
/**
 * agent-hub/html/mali.js
 * Exports: buildShopeeHTML
 * Depends on: escHtml from html/main.js (passed as dep or imported)
 */

const { escHtml } = require('./main');

function buildShopeeHTML(products) {
  const today     = new Date().toISOString().slice(0, 10);
  const total     = products.length;
  const posted    = products.filter(p => p.isPosted).length;
  const ready     = products.filter(p => p.hasAllContent && !p.isPosted).length;
  const noContent = products.filter(p => !p.hasFB && !p.isPosted).length;
  const fbCount   = products.filter(p => p.hasFB).length;
  const igCount   = products.filter(p => p.hasIG).length;
  const xCount    = products.filter(p => p.hasX).length;
  const ttCount   = products.filter(p => p.hasTT).length;
  const todayPrd  = products.filter(p => p.post_date === today).length;

  const dates = [...new Set(products.map(p => p.post_date))];

  const rows = products.map(p => {
    const isPast  = p.post_date < today;
    const isToday = p.post_date === today;
    const dateClass = isToday ? 'color:#1D4ED8;font-weight:bold' : isPast ? 'color:#9CA3AF' : 'color:#374151';
    const badge = isToday ? '<span style="margin-left:4px;padding:1px 6px;background:#3B82F6;color:white;font-size:11px;border-radius:999px">วันนี้</span>' : '';
    const icon = v => v
      ? '<span style="color:#10B981;font-size:16px">✅</span>'
      : '<span style="color:#D1D5DB;font-size:16px">○</span>';
    const img = p.imgPath
      ? `<img src="${p.imgPath}" style="width:48px;height:48px;object-fit:cover;border-radius:8px" loading="lazy" onerror="this.style.display='none'">`
      : `<div style="width:48px;height:48px;background:#F3F4F6;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#9CA3AF">ไม่มีรูป</div>`;
    const discBadge = p.discount
      ? `<span style="margin-left:4px;font-size:11px;background:#FEE2E2;color:#DC2626;padding:1px 5px;border-radius:4px">${p.discount}</span>` : '';
    const statusBadge = p.isPosted
      ? `<div><span style="padding:2px 8px;background:#F3E8FF;color:#7C3AED;font-size:11px;border-radius:999px;font-weight:600">✅ โพสต์แล้ว</span>
         ${p.postedPlatforms.length ? `<div style="font-size:11px;color:#A78BFA;margin-top:2px">${p.postedPlatforms.join(', ')}</div>` : ''}
         ${p.postedAtStr ? `<div style="font-size:11px;color:#9CA3AF">${p.postedAtStr}</div>` : ''}</div>`
      : p.hasAllContent ? '<span style="padding:2px 8px;background:#D1FAE5;color:#065F46;font-size:11px;border-radius:999px">พร้อม</span>'
      : p.hasFB ? '<span style="padding:2px 8px;background:#FEF3C7;color:#92400E;font-size:11px;border-radius:999px">บางส่วน</span>'
      : '<span style="padding:2px 8px;background:#FEE2E2;color:#991B1B;font-size:11px;border-radius:999px">รอ content</span>';
    const rowBg = p.isPosted ? 'background:#FAF5FF' : isToday ? 'background:#EFF6FF' : '';
    const canView  = p.hasFB || p.hasIG || p.hasTT;
    const canVideo = p.hasTT; // ต้องมี tiktok.md ก่อน
    const btnStyle = 'background:none;border:1px solid #D1D5DB;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:13px;transition:all 0.15s;margin:0 2px';
    return `<tr style="border-bottom:1px solid #F3F4F6;${rowBg}" data-date="${p.post_date}" data-status="${p.isPosted ? 'posted' : p.hasAllContent ? 'ready' : p.hasFB ? 'partial' : 'none'}">
      <td style="padding:10px 12px;white-space:nowrap;font-size:13px;${dateClass}">${p.post_date}${badge}</td>
      <td style="padding:10px 12px">${img}</td>
      <td style="padding:10px 12px;white-space:nowrap">
        <span style="font-size:11px;font-family:monospace;color:#6B7280;background:#F3F4F6;padding:2px 6px;border-radius:4px;user-select:all" title="คลิกเพื่อเลือก">${escHtml(p.id)}</span>
      </td>
      <td style="padding:10px 12px;max-width:240px">
        <a href="${p.affiliate_link}" target="_blank" style="font-size:13px;font-weight:500;color:#1F2937;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(p.title)}">${escHtml(p.title.substring(0,60))}${p.title.length>60?'…':''}</a>
        <div style="font-size:11px;color:#9CA3AF;margin-top:2px">${escHtml(p.shop_name)}</div>
      </td>
      <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#1F2937;white-space:nowrap">
        ${escHtml(p.price)}${discBadge}
        ${p.original_price ? `<div style="font-size:11px;color:#9CA3AF;text-decoration:line-through">${escHtml(p.original_price)}</div>` : ''}
      </td>
      <td style="padding:10px 12px;text-align:center">${p.rating ? `<span style="font-size:13px;font-weight:500;color:#D97706">⭐ ${p.rating}</span>` : '<span style="color:#D1D5DB">—</span>'}</td>
      <td style="padding:10px 12px;text-align:center">${icon(p.hasFB)}</td>
      <td style="padding:10px 12px;text-align:center">${icon(p.hasIG)}</td>
      <td style="padding:10px 12px;text-align:center">${icon(p.hasX)}</td>
      <td style="padding:10px 12px;text-align:center">${icon(p.hasTT)}</td>
      <td style="padding:10px 12px">${statusBadge}</td>
      <td style="padding:10px 12px;text-align:center;white-space:nowrap">
        ${canView ? `<button style="${btnStyle}" data-id="${p.id}" data-title="${escHtml(p.title)}" onclick="openViewFromEl(this)" title="ดู content" onmouseover="this.style.background='#EFF6FF';this.style.borderColor='#3B82F6'" onmouseout="this.style.background='none';this.style.borderColor='#D1D5DB'">👁</button>` : ''}
        <button style="${btnStyle}" data-id="${p.id}" data-title="${escHtml(p.title)}" onclick="openRegenFromEl(this)" title="Generate content ใหม่ (--force)" onmouseover="this.style.background='#FFF7ED';this.style.borderColor='#F97316'" onmouseout="this.style.background='none';this.style.borderColor='#D1D5DB'">🔄</button>
        ${canVideo ? `<button style="${btnStyle}${p.hasVideo ? ';border-color:#10B981' : ''}" data-id="${p.id}" data-title="${escHtml(p.title)}" data-has-video="${p.hasVideo}" data-video-kb="${p.videoSizeKB}" onclick="openVideoFromEl(this)" title="${p.hasVideo ? 'วิดีโอมีแล้ว '+p.videoSizeKB+'KB — คลิกเพื่อสร้างใหม่' : 'สร้างวิดีโอ TikTok (ComfyUI + FFmpeg)'}" onmouseover="this.style.background='#F0FDF4';this.style.borderColor='#10B981'" onmouseout="this.style.background='none';this.style.borderColor='${p.hasVideo ? '#10B981' : '#D1D5DB'}'">🎬${p.hasVideo ? '✅' : ''}</button>` : ''}
        ${(p.hasFB || p.hasIG || p.hasVideo) ? `<button style="${btnStyle};border-color:#7C3AED" data-id="${p.id}" data-title="${escHtml(p.title)}" data-has-fb="${p.hasFB}" data-has-ig="${p.hasIG}" data-has-video="${p.hasVideo}" data-video-kb="${p.videoSizeKB}" onclick="openPostFromEl(this)" title="โพสต์ไปยัง Facebook / FB Clip / Instagram" onmouseover="this.style.background='#F5F3FF';this.style.borderColor='#6D28D9'" onmouseout="this.style.background='none';this.style.borderColor='#7C3AED'">📤</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  const pBar = (count, color) => `<div style="height:8px;background:#F3F4F6;border-radius:999px;margin-top:4px">
    <div style="height:8px;border-radius:999px;background:${color};width:${total ? Math.round(count/total*100) : 0}%;transition:width 0.8s"></div></div>`;

  const timeline = dates.map(date => {
    const dayP      = products.filter(p => p.post_date === date);
    const dayPosted = dayP.filter(p => p.isPosted).length;
    const dayReady  = dayP.filter(p => p.hasAllContent).length;
    const isToday   = date === today;
    const allPosted = dayPosted === dayP.length && dayP.length > 0;
    const pct       = dayP.length ? Math.round(dayReady/dayP.length*100) : 0;
    const dotColor  = allPosted ? '#8B5CF6' : pct===100 ? '#10B981' : pct>0 ? '#FBBF24' : '#E5E7EB';
    const barColor  = allPosted ? '#8B5CF6' : pct===100 ? '#10B981' : '#F97316';
    const textColor = isToday ? '#1D4ED8' : allPosted ? '#7C3AED' : date<today ? '#9CA3AF' : '#374151';
    const label     = allPosted ? ' ✅' : isToday ? ' 📍' : '';
    return `<div style="display:flex;align-items:center;gap:10px;padding:4px 0${isToday ? ';background:#EFF6FF;border-radius:8px;padding:4px 6px;margin:0 -6px' : allPosted ? ';background:#FAF5FF;border-radius:8px;padding:4px 6px;margin:0 -6px' : ''}">
      <div style="width:10px;height:10px;border-radius:50%;background:${dotColor};flex-shrink:0"></div>
      <span style="font-size:12px;color:${textColor};width:100px;flex-shrink:0">${date}${label}</span>
      <div style="flex:1;background:#F3F4F6;border-radius:999px;height:6px">
        <div style="height:6px;border-radius:999px;background:${barColor};width:${pct}%"></div></div>
      <span style="font-size:11px;color:${allPosted?'#7C3AED':'#9CA3AF'};width:68px;text-align:right">${dayPosted>0?dayPosted+'โพสต์/':''}${dayReady}/${dayP.length}</span>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>🌸 Shopee Affiliate Dashboard</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap');
*{font-family:'Sarabun',sans-serif;box-sizing:border-box;margin:0;padding:0}
body{background:#F9FAFB;min-height:100vh}
table{width:100%;border-collapse:collapse}
thead th{padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;background:#F9FAFB}
tbody tr:hover{background:#F9FAFB!important}
::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:#F3F4F6}::-webkit-scrollbar-thumb{background:#D1D5DB;border-radius:3px}
.filter-btn{padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:none;font-family:inherit;transition:all 0.15s}
</style>
</head>
<body>
<div style="background:linear-gradient(135deg,#FF6B35,#FF8C42);color:white;padding:16px 24px;display:flex;align-items:center;justify-content:space-between">
  <div style="display:flex;align-items:center;gap:10px">
    <span style="font-size:22px">🛍️</span>
    <div>
      <div style="font-size:17px;font-weight:700">Shopee Affiliate Dashboard</div>
      <div style="font-size:12px;opacity:0.85">วันนี้: ${today}</div>
    </div>
  </div>
  <button onclick="location.reload()" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);color:white;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-family:inherit">🔄 รีเฟรช</button>
</div>

<div style="max-width:1200px;margin:20px auto;padding:0 20px;display:flex;flex-direction:column;gap:16px">

  <!-- Stats -->
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px">
    <div style="background:white;border-radius:16px;padding:16px;border:1px solid #E5E7EB">
      <div style="font-size:28px;font-weight:700;color:#1F2937">${total}</div>
      <div style="font-size:12px;color:#6B7280;margin-top:2px">สินค้าทั้งหมด</div>
      <div style="font-size:11px;color:#3B82F6;margin-top:2px">วันนี้ ${todayPrd} รายการ</div>
    </div>
    <div style="background:white;border-radius:16px;padding:16px;border:2px solid #E9D5FF">
      <div style="font-size:28px;font-weight:700;color:#7C3AED">${posted}</div>
      <div style="font-size:12px;color:#6B7280;margin-top:2px">โพสต์แล้ว</div>
      <div style="font-size:11px;color:#A78BFA;margin-top:2px">${total ? Math.round(posted/total*100) : 0}% ของทั้งหมด</div>
    </div>
    <div style="background:white;border-radius:16px;padding:16px;border:1px solid #E5E7EB">
      <div style="font-size:28px;font-weight:700;color:#059669">${ready}</div>
      <div style="font-size:12px;color:#6B7280;margin-top:2px">Content พร้อม</div>
      <div style="font-size:11px;color:#10B981;margin-top:2px">รอโพสต์</div>
    </div>
    <div style="background:white;border-radius:16px;padding:16px;border:1px solid #E5E7EB">
      <div style="font-size:28px;font-weight:700;color:#EF4444">${noContent}</div>
      <div style="font-size:12px;color:#6B7280;margin-top:2px">รอสร้าง Content</div>
      <div style="font-size:11px;color:#FCA5A5;margin-top:2px">ยังไม่มี facebook.md</div>
    </div>
    <div style="background:white;border-radius:16px;padding:16px;border:1px solid #E5E7EB">
      <div style="font-size:28px;font-weight:700;color:#F97316">${total-posted-ready-noContent}</div>
      <div style="font-size:12px;color:#6B7280;margin-top:2px">Content บางส่วน</div>
      <div style="font-size:11px;color:#FDBA74;margin-top:2px">มีบาง platform</div>
    </div>
  </div>

  <!-- Platform + Timeline -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    <div style="background:white;border-radius:16px;padding:18px;border:1px solid #E5E7EB">
      <div style="font-size:14px;font-weight:600;color:#374151;margin-bottom:14px">📊 สถิติ Content แต่ละ Platform</div>
      ${[['📘 Facebook',fbCount,'#3B82F6'],['📷 Instagram',igCount,'#EC4899'],['🐦 X',xCount,'#1F2937'],['🎵 TikTok',ttCount,'#EF4444']].map(([name,count,color])=>`
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-size:13px;color:#6B7280">${name}</span>
          <span style="font-size:13px;font-weight:600;color:#1F2937">${count} / ${total}</span>
        </div>${pBar(count,color)}</div>`).join('')}
    </div>
    <div style="background:white;border-radius:16px;padding:18px;border:1px solid #E5E7EB">
      <div style="font-size:14px;font-weight:600;color:#374151;margin-bottom:14px">📅 Timeline โพสต์</div>
      <div style="display:flex;flex-direction:column;gap:2px;max-height:200px;overflow-y:auto">${timeline}</div>
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid #F3F4F6;display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:#9CA3AF">
        <span>🟣 โพสต์แล้ว</span><span>🟢 ครบ</span><span>🟡 บางส่วน</span><span>⚪ รอ</span>
      </div>
    </div>
  </div>

  <!-- Table -->
  <div style="background:white;border-radius:16px;border:1px solid #E5E7EB;overflow:hidden">
    <div style="padding:14px 20px;border-bottom:1px solid #F3F4F6;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px">
      <div style="font-size:14px;font-weight:600;color:#374151">📋 รายการสินค้าทั้งหมด</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        <button class="filter-btn" id="btn-all"    onclick="filterTable('all')"    style="background:#FF6B35;color:white">ทั้งหมด (${total})</button>
        <button class="filter-btn" id="btn-today"  onclick="filterTable('today')"  style="background:#F3F4F6;color:#6B7280">วันนี้ (${todayPrd})</button>
        <button class="filter-btn" id="btn-ready"  onclick="filterTable('ready')"  style="background:#F3F4F6;color:#6B7280">✅ พร้อม (${ready})</button>
        <button class="filter-btn" id="btn-posted" onclick="filterTable('posted')" style="background:#F3F4F6;color:#6B7280">🟣 โพสต์แล้ว (${posted})</button>
        <button class="filter-btn" id="btn-none"   onclick="filterTable('none')"   style="background:#F3F4F6;color:#6B7280">⚠️ รอ Content (${noContent})</button>
      </div>
    </div>
    <div style="overflow-x:auto">
      <table id="product-table">
        <thead><tr>
          <th>วันที่โพสต์</th><th>รูป</th><th>ID</th><th>ชื่อสินค้า</th><th>ราคา</th>
          <th style="text-align:center">คะแนน</th><th style="text-align:center">FB</th>
          <th style="text-align:center">IG</th><th style="text-align:center">X</th>
          <th style="text-align:center">TikTok</th><th>สถานะ</th>
          <th style="text-align:center;min-width:76px">Actions</th>
        </tr></thead>
        <tbody id="table-body">${rows}</tbody>
      </table>
    </div>
    <div style="padding:10px 20px;background:#F9FAFB;border-top:1px solid #F3F4F6;font-size:11px;color:#9CA3AF">
      รีเฟรชล่าสุด: ${new Date().toLocaleString('th-TH')} — <span id="visible-count">${total}</span> รายการ
    </div>
  </div>
</div>

<script>
const today = '${today}';
function filterTable(filter) {
  const rows = document.querySelectorAll('#table-body tr');
  let visible = 0;
  rows.forEach(r => {
    const show = filter==='all' ? true : filter==='today' ? r.dataset.date===today
      : filter==='posted' ? r.dataset.status==='posted' : filter==='ready' ? r.dataset.status==='ready'
      : r.dataset.status==='none';
    r.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  document.getElementById('visible-count').textContent = visible;
  document.querySelectorAll('.filter-btn').forEach(b => { b.style.background='#F3F4F6'; b.style.color='#6B7280'; });
  const a = document.getElementById('btn-'+filter);
  if (a) { a.style.background='#FF6B35'; a.style.color='white'; }
}
setTimeout(() => location.reload(), 60000);

// ══════════════════════════════════════════════
//  มะลิ: View Content Modal
// ══════════════════════════════════════════════
let _maliViewId   = '';
let _maliRegenId  = '';
let _maliVideoId  = '';
let _maliRegenBusy  = false;
let _maliVideoBusy  = false;
let _maliPostId     = '';
let _maliPostBusy   = false;

function openViewFromEl(el) { openMaliView(el.dataset.id, el.dataset.title); }
function openRegenFromEl(el) { openMaliRegen(el.dataset.id, el.dataset.title); }
function openPostFromEl(el) {
  openMaliPost(el.dataset.id, el.dataset.title,
    el.dataset.hasFb === 'true', el.dataset.hasIg === 'true',
    el.dataset.hasVideo === 'true', parseInt(el.dataset.videoKb) || 0);
}

function openMaliView(id, title) {
  _maliViewId = id;
  document.getElementById('mali-view-title').textContent = title;
  document.getElementById('mali-view-modal').style.display = 'block';
  document.body.style.overflow = 'hidden';
  switchMaliTab('fb');
}
function closeMaliView() {
  document.getElementById('mali-view-modal').style.display = 'none';
  document.body.style.overflow = '';
}
async function switchMaliTab(tab) {
  ['fb','ig','tiktok'].forEach(t => {
    const el = document.getElementById('mali-vtab-'+t);
    if (!el) return;
    const active = t === tab;
    el.style.borderBottom = active ? '3px solid #FF6B35' : '3px solid transparent';
    el.style.color = active ? '#FF6B35' : '#6B7280';
    el.style.fontWeight = active ? '700' : '500';
    el.style.background = active ? 'white' : 'transparent';
  });
  const pre = document.getElementById('mali-view-pre');
  pre.textContent = 'กำลังโหลด...';
  try {
    const r = await fetch('/dashboard/mali/api/content?id=' + encodeURIComponent(_maliViewId) + '&platform=' + tab);
    if (!r.ok) { pre.textContent = '⚠️ ไม่พบไฟล์ content สำหรับ platform นี้'; return; }
    pre.textContent = await r.text();
  } catch(e) { pre.textContent = '❌ ' + e.message; }
}

// ══════════════════════════════════════════════
//  มะลิ: Generate Force Modal
// ══════════════════════════════════════════════
function openMaliRegen(id, title) {
  if (_maliRegenBusy) return;
  _maliRegenId = id;
  document.getElementById('mali-regen-item-title').textContent = title;
  document.getElementById('mali-regen-modal').style.display = 'block';
  document.body.style.overflow = 'hidden';
  // reset state
  document.getElementById('mali-regen-spinner').style.display = 'none';
  document.getElementById('mali-regen-result').style.display = 'none';
  document.getElementById('mali-regen-start-btn').style.display = 'inline-block';
  document.getElementById('mali-regen-close-btn').disabled = false;
}
function closeMaliRegen() {
  if (_maliRegenBusy) return;
  document.getElementById('mali-regen-modal').style.display = 'none';
  document.body.style.overflow = '';
}
async function startMaliRegen() {
  _maliRegenBusy = true;
  document.getElementById('mali-regen-start-btn').style.display = 'none';
  document.getElementById('mali-regen-spinner').style.display = 'block';
  document.getElementById('mali-regen-result').style.display = 'none';
  document.getElementById('mali-regen-close-btn').disabled = true;

  const steps = [
    'กำลังส่งคำสั่งไปยัง Ollama...',
    '🤖 Ollama กำลัง Generate Facebook content...',
    '📸 Ollama กำลัง Generate Instagram content...',
    '🎵 Ollama กำลัง Generate TikTok script...',
    '⏳ รอ Ollama ทำงาน (อาจใช้เวลา 2-5 นาที)...',
  ];
  let si = 0;
  const stepEl = document.getElementById('mali-regen-step');
  if (stepEl) stepEl.textContent = steps[0];
  const stepTimer = setInterval(() => {
    si = (si + 1) % steps.length;
    if (stepEl) stepEl.textContent = steps[si];
  }, 35000);

  try {
    const r = await fetch('/dashboard/mali/api/generate-force', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: _maliRegenId }),
    });
    const j = await r.json();
    clearInterval(stepTimer);
    document.getElementById('mali-regen-spinner').style.display = 'none';
    document.getElementById('mali-regen-result').style.display = 'block';
    if (j.ok) {
      document.getElementById('mali-regen-result').innerHTML =
        '<div style="color:#10B981;font-weight:700;margin-bottom:8px;font-size:14px">✅ Generate สำเร็จ!</div>' +
        (j.log ? '<pre style="background:#F0FFF4;border:1px solid #A7F3D0;border-radius:8px;padding:10px;font-size:11px;max-height:180px;overflow-y:auto;white-space:pre-wrap;font-family:monospace">' + j.log.replace(/</g,'&lt;') + '</pre>' : '');
      showMaliToast('✅ Generate content (FB+IG+TikTok) สำเร็จ!');
      setTimeout(() => location.reload(), 2000);
    } else {
      document.getElementById('mali-regen-result').innerHTML =
        '<div style="color:#EF4444;font-weight:700;margin-bottom:8px;font-size:14px">❌ เกิดข้อผิดพลาด</div>' +
        '<pre style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:10px;font-size:11px;max-height:180px;overflow-y:auto;white-space:pre-wrap;font-family:monospace">' + (j.error||'').replace(/</g,'&lt;') + '</pre>';
    }
  } catch(e) {
    clearInterval(stepTimer);
    document.getElementById('mali-regen-spinner').style.display = 'none';
    document.getElementById('mali-regen-result').style.display = 'block';
    document.getElementById('mali-regen-result').innerHTML = '<div style="color:#EF4444;font-weight:700">❌ ' + e.message + '</div>';
  }
  _maliRegenBusy = false;
  document.getElementById('mali-regen-start-btn').style.display = 'inline-block';
  document.getElementById('mali-regen-close-btn').disabled = false;
}

// ══════════════════════════════════════════════
//  มะลิ: Create Video Modal (ComfyUI + FFmpeg)
// ══════════════════════════════════════════════
function openVideoFromEl(el) { openMaliVideo(el.dataset.id, el.dataset.title, el.dataset.hasVideo === 'true', parseInt(el.dataset.videoKb)||0); }

function openMaliVideo(id, title, hasVideo, videoKb) {
  if (_maliVideoBusy) return;
  _maliVideoId = id;
  document.getElementById('mali-video-item-title').textContent = title;
  document.getElementById('mali-video-modal').style.display = 'block';
  document.body.style.overflow = 'hidden';
  // reset
  document.getElementById('mali-video-spinner').style.display = 'none';
  document.getElementById('mali-video-result').style.display = 'none';
  const startBtn = document.getElementById('mali-video-start-btn');
  startBtn.style.display = 'inline-block';
  startBtn.textContent = hasVideo ? '🔄 สร้างวิดีโอใหม่ (--force)' : '🎬 สร้างวิดีโอ';
  document.getElementById('mali-video-close-btn').disabled = false;
  // existing video indicator
  const existEl = document.getElementById('mali-video-existing');
  if (hasVideo && videoKb > 0) {
    const kb = videoKb; const mb = (kb/1024).toFixed(1);
    existEl.innerHTML = '✅ มีวิดีโออยู่แล้ว (' + (kb < 1024 ? kb+'KB' : mb+'MB') + ') — กด "สร้างใหม่" เพื่อทับของเดิม';
    existEl.style.display = 'block';
  } else { existEl.style.display = 'none'; }
}
function closeMaliVideo() {
  if (_maliVideoBusy) return;
  document.getElementById('mali-video-modal').style.display = 'none';
  document.body.style.overflow = '';
}
async function startMaliVideo() {
  _maliVideoBusy = true;
  document.getElementById('mali-video-start-btn').style.display = 'none';
  document.getElementById('mali-video-spinner').style.display = 'block';
  document.getElementById('mali-video-result').style.display = 'none';
  document.getElementById('mali-video-close-btn').disabled = true;

  const steps = [
    '🔍 ตรวจสอบ ComfyUI + FFmpeg...',
    '🖼️  อัปโหลดรูปสินค้าไป ComfyUI...',
    '🤖 ComfyUI img2img scene 1...',
    '🤖 ComfyUI img2img scene 2...',
    '🤖 ComfyUI img2img scene 3...',
    '🎞️  FFmpeg สร้าง clip แต่ละ scene...',
    '🔗 Concat clips → video.mp4...',
    '⏳ ใกล้เสร็จแล้ว กรุณารอ...',
  ];
  let si = 0;
  const stepEl = document.getElementById('mali-video-step');
  const progEl = document.getElementById('mali-video-prog');
  if (stepEl) stepEl.textContent = steps[0];
  const stepTimer = setInterval(() => {
    si = Math.min(si + 1, steps.length - 1);
    if (stepEl) stepEl.textContent = steps[si];
    if (progEl) progEl.style.width = Math.min(10 + si * 12, 90) + '%';
  }, 30000);

  try {
    const r = await fetch('/dashboard/mali/api/create-video', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: _maliVideoId }),
    });
    const j = await r.json();
    clearInterval(stepTimer);
    if (progEl) progEl.style.width = '100%';
    document.getElementById('mali-video-spinner').style.display = 'none';
    document.getElementById('mali-video-result').style.display = 'block';

    if (j.ok) {
      const szTxt = j.sizeKB < 1024 ? j.sizeKB+'KB' : (j.sizeKB/1024).toFixed(1)+'MB';
      document.getElementById('mali-video-result').innerHTML =
        '<div style="color:#10B981;font-weight:700;font-size:14px;margin-bottom:8px">✅ สร้างวิดีโอสำเร็จ! (' + szTxt + ')</div>' +
        '<div style="font-size:12px;color:#6B7280;margin-bottom:8px">📁 products/' + _maliVideoId + '/video.mp4</div>' +
        (j.log ? '<pre style="background:#F0FFF4;border:1px solid #A7F3D0;border-radius:8px;padding:10px;font-size:11px;max-height:160px;overflow-y:auto;white-space:pre-wrap;font-family:monospace">' + j.log.replace(/</g,'&lt;') + '</pre>' : '');
      showMaliToast('✅ สร้างวิดีโอ TikTok สำเร็จ! (' + szTxt + ')');
      setTimeout(() => location.reload(), 2000);
    } else {
      document.getElementById('mali-video-result').innerHTML =
        '<div style="color:#EF4444;font-weight:700;font-size:14px;margin-bottom:8px">❌ เกิดข้อผิดพลาด</div>' +
        '<pre style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:10px;font-size:11px;max-height:180px;overflow-y:auto;white-space:pre-wrap;font-family:monospace">' + (j.error||'').replace(/</g,'&lt;') + '</pre>';
    }
  } catch(e) {
    clearInterval(stepTimer);
    document.getElementById('mali-video-spinner').style.display = 'none';
    document.getElementById('mali-video-result').style.display = 'block';
    document.getElementById('mali-video-result').innerHTML = '<div style="color:#EF4444;font-weight:700">❌ ' + e.message + '</div>';
  }
  _maliVideoBusy = false;
  document.getElementById('mali-video-start-btn').style.display = 'inline-block';
  document.getElementById('mali-video-close-btn').disabled = false;
}

// ══════════════════════════════════════════════
//  มะลิ: Post Platform Modal (FB / FB-Clip / IG)
// ══════════════════════════════════════════════
function _postOptStyle(checked) {
  return checked
    ? 'display:flex;align-items:center;gap:10px;padding:10px 14px;border:2px solid #7C3AED;border-radius:10px;cursor:pointer;background:#F5F3FF'
    : 'display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #E5E7EB;border-radius:10px;cursor:pointer;background:white';
}
function togglePostChk(key) {
  const chk = document.getElementById('post-chk-' + key);
  if (!chk || chk.disabled) return;
  chk.checked = !chk.checked;
  document.getElementById('post-opt-' + key).style.cssText = _postOptStyle(chk.checked).replace('style:','');
  document.getElementById('post-opt-' + key).setAttribute('style', _postOptStyle(chk.checked));
}
function openMaliPost(id, title, hasFB, hasIG, hasVideo, videoKb) {
  if (_maliPostBusy) return;
  _maliPostId = id;
  document.getElementById('mali-post-item-title').textContent = title;
  document.getElementById('mali-post-modal').style.display = 'block';
  document.body.style.overflow = 'hidden';
  document.getElementById('mali-post-spinner').style.display = 'none';
  document.getElementById('mali-post-result').style.display = 'none';
  document.getElementById('mali-post-start-btn').style.display = 'inline-block';
  document.getElementById('mali-post-close-btn').disabled = false;

  // FB option
  const chkFB = document.getElementById('post-chk-fb');
  chkFB.disabled = !hasFB;
  chkFB.checked = hasFB;
  const optFB = document.getElementById('post-opt-fb');
  optFB.setAttribute('style', _postOptStyle(hasFB) + (hasFB ? '' : ';opacity:0.4;cursor:not-allowed'));
  document.getElementById('post-lbl-fb').textContent = hasFB ? 'มี facebook.md ✓' : 'ไม่มี facebook.md';

  // FB-Clip option
  const chkClip = document.getElementById('post-chk-fbclip');
  chkClip.disabled = !hasVideo;
  chkClip.checked = hasVideo;
  const optClip = document.getElementById('post-opt-fbclip');
  optClip.setAttribute('style', _postOptStyle(hasVideo) + (hasVideo ? '' : ';opacity:0.4;cursor:not-allowed'));
  const szTxt = videoKb < 1024 ? videoKb + 'KB' : (videoKb / 1024).toFixed(1) + 'MB';
  document.getElementById('post-lbl-fbclip').textContent = hasVideo ? 'video.mp4 (' + szTxt + ') ✓' : 'ไม่มี video.mp4';

  // IG option
  const chkIG = document.getElementById('post-chk-ig');
  chkIG.disabled = !hasIG;
  chkIG.checked = hasIG;
  const optIG = document.getElementById('post-opt-ig');
  optIG.setAttribute('style', _postOptStyle(hasIG) + (hasIG ? '' : ';opacity:0.4;cursor:not-allowed'));
  document.getElementById('post-lbl-ig').textContent = hasIG ? 'มี instagram.md ✓' : 'ไม่มี instagram.md';
}
function closeMaliPost() {
  if (_maliPostBusy) return;
  document.getElementById('mali-post-modal').style.display = 'none';
  document.body.style.overflow = '';
}
async function startMaliPost() {
  const fbChecked     = document.getElementById('post-chk-fb')?.checked;
  const igChecked     = document.getElementById('post-chk-ig')?.checked;
  const clipChecked   = document.getElementById('post-chk-fbclip')?.checked;
  if (!fbChecked && !igChecked && !clipChecked) {
    showMaliToast('⚠️ เลือกอย่างน้อย 1 platform', true); return;
  }
  _maliPostBusy = true;
  document.getElementById('mali-post-start-btn').style.display = 'none';
  document.getElementById('mali-post-spinner').style.display = 'block';
  document.getElementById('mali-post-result').style.display = 'none';
  document.getElementById('mali-post-close-btn').disabled = true;

  const results = {};

  // ── FB + IG via post.js ──────────────────────────────────────────────────
  const regularPlatforms = [];
  if (fbChecked)   regularPlatforms.push('fb');
  if (igChecked)   regularPlatforms.push('ig');
  if (regularPlatforms.length > 0) {
    try {
      const r = await fetch('/dashboard/mali/api/post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: _maliPostId, platforms: regularPlatforms }),
      });
      const j = await r.json();
      regularPlatforms.forEach(p => {
        results[p] = j.ok ? { ok: true } : { ok: false, error: j.error };
      });
    } catch(e) {
      regularPlatforms.forEach(p => { results[p] = { ok: false, error: e.message }; });
    }
  }

  // ── FB Video Clip ────────────────────────────────────────────────────────
  if (clipChecked) {
    try {
      const r = await fetch('/dashboard/mali/api/post-fb-clip', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: _maliPostId }),
      });
      const j = await r.json();
      results['fb-clip'] = j.ok
        ? { ok: true, extra: j.videoId ? 'Video ID: ' + j.videoId : '' }
        : { ok: false, error: j.error };
    } catch(e) {
      results['fb-clip'] = { ok: false, error: e.message };
    }
  }

  // ── Show results ─────────────────────────────────────────────────────────
  document.getElementById('mali-post-spinner').style.display = 'none';
  document.getElementById('mali-post-result').style.display = 'block';
  const allOk = Object.values(results).every(r => r.ok);
  const labels = { fb: '📘 Facebook', ig: '📸 Instagram', 'fb-clip': '🎬 FB Reels' };
  const hColor = allOk ? '#10B981' : '#F59E0B';
  const hMsg   = allOk ? '✅ โพสต์สำเร็จทุก platform!' : '⚠️ เสร็จแล้ว (ตรวจผลด้านล่าง)';
  let html = '<div style="font-weight:700;font-size:14px;margin-bottom:10px;color:' + hColor + '">' + hMsg + '</div>';
  for (const [plat, r] of Object.entries(results)) {
    const lbl = labels[plat] || plat;
    if (r.ok) {
      html += '<div style="color:#10B981;font-size:13px;padding:3px 0">✅ ' + lbl + (r.extra ? ' — ' + r.extra : '') + '</div>';
    } else {
      html += '<div style="color:#EF4444;font-size:13px;padding:3px 0">❌ ' + lbl + '</div>' +
        '<pre style="background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;padding:8px;font-size:11px;max-height:100px;overflow-y:auto;white-space:pre-wrap;margin:2px 0 6px;font-family:monospace">' + (r.error||'').replace(/</g,'&lt;').substring(0,300) + '</pre>';
    }
  }
  document.getElementById('mali-post-result').innerHTML = html;
  if (allOk) { showMaliToast('✅ โพสต์สำเร็จ!'); setTimeout(() => location.reload(), 2500); }
  _maliPostBusy = false;
  document.getElementById('mali-post-start-btn').style.display = 'inline-block';
  document.getElementById('mali-post-close-btn').disabled = false;
}

function showMaliToast(msg, err=false) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;top:20px;right:20px;background:'+(err?'#EF4444':'#10B981')+';color:white;padding:12px 20px;border-radius:10px;font-size:14px;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,0.2)';
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity 0.5s'; setTimeout(() => t.remove(), 500); }, 3000);
}
</script>

<!-- ══ View Content Modal ══ -->
<div id="mali-view-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9990;overflow-y:auto;padding:24px">
  <div style="max-width:720px;margin:0 auto;background:white;border-radius:20px;overflow:hidden;box-shadow:0 25px 60px rgba(0,0,0,0.3)">
    <div style="background:linear-gradient(135deg,#FF6B35,#FF8C42);padding:18px 24px;display:flex;align-items:center;justify-content:space-between">
      <div style="overflow:hidden;flex:1">
        <div style="font-size:16px;font-weight:700;color:white">📄 ดู Content สินค้า</div>
        <div id="mali-view-title" style="font-size:12px;color:rgba(255,255,255,0.85);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
      </div>
      <button onclick="closeMaliView()" style="background:rgba(255,255,255,0.2);border:none;color:white;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px;flex-shrink:0;margin-left:12px">✕</button>
    </div>
    <div style="display:flex;border-bottom:2px solid #F3F4F6;background:#F9FAFB">
      <button id="mali-vtab-fb"     onclick="switchMaliTab('fb')"     style="flex:1;padding:12px;border:none;background:white;cursor:pointer;font-size:13px;font-family:inherit;font-weight:700;color:#FF6B35;border-bottom:3px solid #FF6B35;transition:all 0.15s">📘 Facebook</button>
      <button id="mali-vtab-ig"     onclick="switchMaliTab('ig')"     style="flex:1;padding:12px;border:none;background:transparent;cursor:pointer;font-size:13px;font-family:inherit;font-weight:500;color:#6B7280;border-bottom:3px solid transparent;transition:all 0.15s">📸 Instagram</button>
      <button id="mali-vtab-tiktok" onclick="switchMaliTab('tiktok')" style="flex:1;padding:12px;border:none;background:transparent;cursor:pointer;font-size:13px;font-family:inherit;font-weight:500;color:#6B7280;border-bottom:3px solid transparent;transition:all 0.15s">🎵 TikTok</button>
    </div>
    <div style="padding:20px;max-height:520px;overflow-y:auto">
      <pre id="mali-view-pre" style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:#374151;font-family:'Sarabun',sans-serif;margin:0">กำลังโหลด...</pre>
    </div>
    <div style="padding:14px 20px;border-top:1px solid #F3F4F6;text-align:right">
      <button onclick="closeMaliView()" style="background:#F3F4F6;border:none;padding:8px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;color:#374151">ปิด</button>
    </div>
  </div>
</div>

<!-- ══ Generate Force Modal ══ -->
<div id="mali-regen-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9990;overflow-y:auto;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:20px;overflow:hidden;box-shadow:0 25px 60px rgba(0,0,0,0.3)">
    <div style="background:linear-gradient(135deg,#F97316,#FB923C);padding:18px 24px;display:flex;align-items:center;justify-content:space-between">
      <div style="overflow:hidden;flex:1">
        <div style="font-size:16px;font-weight:700;color:white">🔄 Generate Content (--force)</div>
        <div id="mali-regen-item-title" style="font-size:12px;color:rgba(255,255,255,0.85);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
      </div>
      <button id="mali-regen-close-btn" onclick="closeMaliRegen()" style="background:rgba(255,255,255,0.2);border:none;color:white;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px;flex-shrink:0;margin-left:12px">✕</button>
    </div>
    <div style="padding:20px;display:flex;flex-direction:column;gap:16px">
      <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:10px;padding:12px 14px;font-size:13px;color:#92400E">
        <b>สร้าง content ใหม่ทับของเดิม</b> สำหรับ 📘 Facebook + 📸 Instagram + 🎵 TikTok<br>
        <span style="font-size:12px;color:#B45309">ใช้ Ollama — อาจใช้เวลา 2-5 นาที (ไม่ส่ง Telegram)</span>
      </div>

      <div id="mali-regen-spinner" style="display:none;text-align:center;padding:16px 0">
        <div style="font-size:36px;animation:maliSpin 1.5s linear infinite;display:inline-block">⚙️</div>
        <div id="mali-regen-step" style="font-size:13px;color:#6B7280;margin-top:10px">กำลังส่งคำสั่ง...</div>
        <div style="background:#F3F4F6;border-radius:999px;height:4px;margin-top:12px;overflow:hidden">
          <div style="height:4px;background:#F97316;border-radius:999px;width:100%;animation:maliBar 2s ease-in-out infinite"></div>
        </div>
      </div>

      <div id="mali-regen-result" style="display:none"></div>

      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="mali-regen-start-btn" onclick="startMaliRegen()"
          style="background:linear-gradient(135deg,#F97316,#FB923C);color:white;border:none;padding:10px 24px;border-radius:10px;cursor:pointer;font-size:14px;font-family:inherit;font-weight:700">
          🔄 เริ่ม Generate
        </button>
        <button onclick="closeMaliRegen()" style="background:#F3F4F6;border:none;padding:10px 18px;border-radius:10px;cursor:pointer;font-size:13px;font-family:inherit;color:#374151">ยกเลิก</button>
      </div>
    </div>
  </div>
</div>
<!-- ══ Create Video Modal ══ -->
<div id="mali-video-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9990;overflow-y:auto;padding:24px">
  <div style="max-width:580px;margin:0 auto;background:white;border-radius:20px;overflow:hidden;box-shadow:0 25px 60px rgba(0,0,0,0.35)">
    <div style="background:linear-gradient(135deg,#10B981,#059669);padding:18px 24px;display:flex;align-items:center;justify-content:space-between">
      <div style="overflow:hidden;flex:1">
        <div style="font-size:16px;font-weight:700;color:white">🎬 สร้างวิดีโอ TikTok</div>
        <div id="mali-video-item-title" style="font-size:12px;color:rgba(255,255,255,0.85);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
      </div>
      <button id="mali-video-close-btn" onclick="closeMaliVideo()" style="background:rgba(255,255,255,0.2);border:none;color:white;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px;flex-shrink:0;margin-left:12px">✕</button>
    </div>
    <div style="padding:20px;display:flex;flex-direction:column;gap:14px">

      <!-- info banner -->
      <div style="background:#F0FDF4;border:1px solid #A7F3D0;border-radius:10px;padding:12px 14px;font-size:13px;color:#065F46">
        <b>Pipeline:</b> รูปสินค้า → <b>ComfyUI img2img</b> (AnythingXL, upscale → portrait 768×1344) → FFmpeg 1080×1920 → <b>video.mp4</b><br>
        <span style="font-size:12px;color:#047857">ระยะเวลา: ~2-5 นาที ต่อ scene × จำนวน scene ใน TikTok script</span>
      </div>

      <!-- pipeline steps visual -->
      <div style="display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;color:#6B7280;flex-wrap:wrap">
        <span style="background:#F0FDF4;border:1px solid #A7F3D0;border-radius:20px;padding:3px 10px">🖼️ รูปสินค้า</span>
        <span>→</span>
        <span style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:20px;padding:3px 10px">🤖 ComfyUI img2img</span>
        <span>→</span>
        <span style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:20px;padding:3px 10px">🎞️ FFmpeg 9:16</span>
        <span>→</span>
        <span style="background:#F5F3FF;border:1px solid #DDD6FE;border-radius:20px;padding:3px 10px">🎬 video.mp4</span>
      </div>

      <!-- existing video badge -->
      <div id="mali-video-existing" style="display:none;background:#F0FDF4;border:1px solid #6EE7B7;border-radius:8px;padding:8px 12px;font-size:12px;color:#065F46"></div>

      <!-- spinner -->
      <div id="mali-video-spinner" style="display:none;text-align:center;padding:16px 0">
        <div style="font-size:38px;animation:maliSpin 1.5s linear infinite;display:inline-block">🎬</div>
        <div id="mali-video-step" style="font-size:13px;color:#6B7280;margin-top:10px">กำลังเตรียม...</div>
        <div style="background:#E5E7EB;border-radius:999px;height:5px;margin-top:12px;overflow:hidden">
          <div id="mali-video-prog" style="height:5px;background:linear-gradient(90deg,#10B981,#059669);border-radius:999px;width:5%;transition:width 1s ease"></div>
        </div>
        <div style="font-size:11px;color:#9CA3AF;margin-top:6px">ปิดหน้าต่างนี้ไม่ได้ระหว่างสร้างวิดีโอ</div>
      </div>

      <!-- result -->
      <div id="mali-video-result" style="display:none"></div>

      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="mali-video-start-btn" onclick="startMaliVideo()"
          style="background:linear-gradient(135deg,#10B981,#059669);color:white;border:none;padding:10px 24px;border-radius:10px;cursor:pointer;font-size:14px;font-family:inherit;font-weight:700">
          🎬 สร้างวิดีโอ
        </button>
        <button onclick="closeMaliVideo()" style="background:#F3F4F6;border:none;padding:10px 18px;border-radius:10px;cursor:pointer;font-size:13px;font-family:inherit;color:#374151">ยกเลิก</button>
      </div>
    </div>
  </div>
</div>

<!-- ══ Post Platform Modal (FB / FB-Clip / IG) ══ -->
<div id="mali-post-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9990;overflow-y:auto;padding:24px">
  <div style="max-width:500px;margin:0 auto;background:white;border-radius:20px;overflow:hidden;box-shadow:0 25px 60px rgba(0,0,0,0.35)">
    <div style="background:linear-gradient(135deg,#7C3AED,#A78BFA);padding:18px 24px;display:flex;align-items:center;justify-content:space-between">
      <div style="overflow:hidden;flex:1">
        <div style="font-size:16px;font-weight:700;color:white">📤 โพสต์สินค้า</div>
        <div id="mali-post-item-title" style="font-size:12px;color:rgba(255,255,255,0.85);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
      </div>
      <button id="mali-post-close-btn" onclick="closeMaliPost()" style="background:rgba(255,255,255,0.2);border:none;color:white;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px;flex-shrink:0;margin-left:12px">✕</button>
    </div>
    <div style="padding:20px;display:flex;flex-direction:column;gap:12px">

      <!-- Platform options -->
      <div style="font-size:12px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.05em">เลือก Platform ที่จะโพสต์</div>
      <div id="post-opt-fb" onclick="togglePostChk('fb')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #E5E7EB;border-radius:10px;cursor:pointer">
        <input type="checkbox" id="post-chk-fb" style="width:18px;height:18px;cursor:pointer;accent-color:#1877F2;flex-shrink:0" onclick="event.stopPropagation();togglePostChk('fb')">
        <div style="flex:1">
          <div style="font-size:14px;font-weight:600">📘 Facebook</div>
          <div id="post-lbl-fb" style="font-size:11px;color:#9CA3AF;margin-top:1px"></div>
        </div>
      </div>
      <div id="post-opt-fbclip" onclick="togglePostChk('fbclip')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #E5E7EB;border-radius:10px;cursor:pointer">
        <input type="checkbox" id="post-chk-fbclip" style="width:18px;height:18px;cursor:pointer;accent-color:#1877F2;flex-shrink:0" onclick="event.stopPropagation();togglePostChk('fbclip')">
        <div style="flex:1">
          <div style="font-size:14px;font-weight:600">🎬 FB Reels</div>
          <div id="post-lbl-fbclip" style="font-size:11px;color:#9CA3AF;margin-top:1px"></div>
        </div>
      </div>
      <div id="post-opt-ig" onclick="togglePostChk('ig')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #E5E7EB;border-radius:10px;cursor:pointer">
        <input type="checkbox" id="post-chk-ig" style="width:18px;height:18px;cursor:pointer;accent-color:#EC4899;flex-shrink:0" onclick="event.stopPropagation();togglePostChk('ig')">
        <div style="flex:1">
          <div style="font-size:14px;font-weight:600">📸 Instagram</div>
          <div id="post-lbl-ig" style="font-size:11px;color:#9CA3AF;margin-top:1px"></div>
        </div>
      </div>

      <!-- force warning -->
      <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:9px 12px;font-size:12px;color:#92400E">
        ⚠️ <b>--force</b> — โพสต์ทันทีโดยไม่สนใจว่าเคยโพสต์แล้วหรือไม่
      </div>

      <!-- spinner -->
      <div id="mali-post-spinner" style="display:none;text-align:center;padding:16px 0">
        <div style="font-size:36px;animation:maliSpin 1.5s linear infinite;display:inline-block">📤</div>
        <div id="mali-post-step" style="font-size:13px;color:#6B7280;margin-top:8px">กำลังโพสต์...</div>
      </div>

      <!-- result -->
      <div id="mali-post-result" style="display:none;background:#F9FAFB;border-radius:10px;padding:14px;border:1px solid #E5E7EB"></div>

      <!-- buttons -->
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:2px">
        <button id="mali-post-start-btn" onclick="startMaliPost()"
          style="background:linear-gradient(135deg,#7C3AED,#A78BFA);color:white;border:none;padding:10px 24px;border-radius:10px;cursor:pointer;font-size:14px;font-family:inherit;font-weight:700">
          📤 โพสต์ที่เลือก
        </button>
        <button onclick="closeMaliPost()" style="background:#F3F4F6;border:none;padding:10px 18px;border-radius:10px;cursor:pointer;font-size:13px;font-family:inherit;color:#374151">ยกเลิก</button>
      </div>
    </div>
  </div>
</div>

<style>
@keyframes maliSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
@keyframes maliBar  { 0%{transform:translateX(-100%)} 50%{transform:translateX(0%)} 100%{transform:translateX(100%)} }
</style>

</body>
</html>`;
}

module.exports = { buildShopeeHTML };
