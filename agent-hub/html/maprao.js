'use strict';
/**
 * agent-hub/html/maprao.js — Dashboard HTML สำหรับ Agent มะพร้าว
 * เรียบง่าย: form พิมพ์ Story Prompt + ปุ่ม generate + gallery การ์ตูนที่เคยสร้าง
 */

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#F5EBDD;color:#3b2a1a;padding:24px;min-height:100vh}
h1{font-size:22px;font-weight:700}
.sub{color:#8B5E3C;font-size:13px;margin-top:2px}
.card{background:#fff;border:1px solid #e5d5bd;border-radius:12px;padding:20px;margin-bottom:16px}
textarea{width:100%;min-height:70px;background:#fdfaf5;color:#3b2a1a;border:1px solid #d9c4a3;border-radius:6px;padding:8px 10px;font-size:14px;font-family:inherit;outline:none;resize:vertical}
textarea:focus{border-color:#8B5E3C}
.btn{display:inline-block;border:none;border-radius:8px;padding:9px 20px;font-size:13px;font-weight:600;cursor:pointer;background:#8B5E3C;color:#fff;margin-top:10px}
.btn:hover{opacity:.85}.btn:disabled{opacity:.4;cursor:not-allowed}
.btn-ghost{background:#eee1cc;color:#8B5E3C}
#msg{font-size:12px;color:#8B5E3C;margin-top:6px;min-height:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.gcard{background:#fff;border:1px solid #e5d5bd;border-radius:10px;overflow:hidden}
.gcard img{width:100%;display:block;background:#eee}
.gcard .meta{padding:8px 10px;font-size:12px}
.gcard .btns{display:flex;gap:4px;padding:0 8px 8px;flex-wrap:wrap}
.gcard .btns button{flex:1;border:none;border-radius:6px;padding:5px 4px;font-size:11px;cursor:pointer;background:#eee1cc;color:#8B5E3C;font-weight:600}
.gcard .btns button:hover{opacity:.8}.gcard .btns button.danger{background:#fee2e2;color:#7f1d1d}
.badge{display:inline-block;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600}
.b-producing{background:#fde68a;color:#78350f}
.b-pending_approval{background:#bfdbfe;color:#1e3a8a}
.b-posted{background:#bbf7d0;color:#14532d}
.b-error{background:#fecaca;color:#7f1d1d}
.mascot-grid{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px}
.mcard{border:2px solid #e5d5bd;border-radius:8px;overflow:hidden;width:100px;text-align:center;background:#fdfaf5}
.mcard.active{border-color:#8B5E3C;box-shadow:0 0 0 2px #c49a6c}
.mcard img{width:100px;height:100px;object-fit:cover;display:block}
.mcard .mbtn{display:flex;gap:2px;padding:4px}
.mcard .mbtn button{flex:1;border:none;border-radius:4px;padding:3px 2px;font-size:10px;cursor:pointer;background:#eee1cc;color:#8B5E3C;font-weight:600}
.mcard .mbtn button.danger{background:#fee2e2;color:#7f1d1d}
.mcard .badge-active{font-size:9px;background:#8B5E3C;color:#fff;padding:2px 6px;display:block}
#gal-msg{font-size:12px;color:#8B5E3C;margin-bottom:8px;min-height:16px}
#lightbox{display:none;position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:1000;align-items:center;justify-content:center;cursor:zoom-out}
#lightbox.open{display:flex}
#lightbox img{max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;box-shadow:0 4px 40px #0008}
.gcard img,.mcard img{cursor:zoom-in}
`;

function galleryCard(ROOT, job) {
  const status = job.status || 'producing';
  const done = status === 'pending_approval' || status === 'posted';
  const btns = done ? `
    <div class="btns">
      <button onclick="galAction('${job.id}','post')" title="โพสต์ Facebook ทันที">📤 โพสต์</button>
      <button onclick="galAction('${job.id}','resend')" title="ส่ง Telegram approval ซ้ำ">✈️ TG</button>
      <button onclick="galAction('${job.id}','video')" title="สร้างวิดีโอ Reels">🎥 Video</button>
      <button class="danger" onclick="galAction('${job.id}','delete')" title="ลบ">🗑️</button>
    </div>` : '';
  return `<div class="gcard">
    <img src="/dashboard/maprao/comic/${job.id}" onclick="openPreview(this.src)" onerror="this.style.display='none'">
    <div class="meta">
      <span class="badge b-${status}">${status}</span>
      <div style="margin-top:4px">${(job.prompt || '').substring(0, 60)}</div>
    </div>
    ${btns}
  </div>`;
}

function renderDashboard(ROOT, { gallery }) {
  const cards = gallery.length
    ? gallery.map(j => galleryCard(ROOT, j)).join('')
    : '<span style="color:#8B5E3C;font-size:13px">ยังไม่มีการ์ตูน</span>';

  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
<title>มะพร้าว — B&W Manga Comic Strip</title><style>${CSS}</style></head><body>
<h1>🥥 มะพร้าว</h1>
<div class="sub">B&amp;W Manga Comic Strip — มาสคอตกระต่าย chibi</div>

<div class="card">
  <h2 style="font-size:14px;margin-bottom:8px">Mascot Gallery</h2>
  <div class="mascot-grid" id="mascots"><span style="color:#8B5E3C;font-size:12px">กำลังโหลด...</span></div>
  <div id="mascot-msg" style="font-size:12px;color:#8B5E3C;margin-bottom:6px"></div>
  <button class="btn btn-ghost" id="mascot-btn" onclick="genMascot()">🎨 สร้าง Mascot ใหม่</button>
  <hr style="margin:16px 0;border:none;border-top:1px solid #e5d5bd">
  <textarea id="prompt" placeholder="พิมพ์เรื่องที่อยากให้กระต่ายเล่า เช่น วันนี้กระต่ายทำเค้กแครอทอร่อยๆ"></textarea>
  <br><button class="btn" id="gen-btn" onclick="genComic()">🥥 สร้างการ์ตูน 4 ช่อง</button>
  <div id="msg"></div>
</div>

<div class="card">
  <h2 style="font-size:15px;margin-bottom:10px">Gallery</h2>
  <div id="gal-msg"></div>
  <div class="grid" id="gallery">${cards}</div>
</div>

<div id="lightbox" onclick="closeLightbox()"><img src="" alt="preview"></div>
<script>
function openPreview(src) {
  const lb = document.getElementById('lightbox');
  lb.querySelector('img').src = src;
  lb.classList.add('open');
}
function closeLightbox() { document.getElementById('lightbox').classList.remove('open'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });
async function loadMascots() {
  try {
    const j = await (await fetch('/api/maprao/mascots')).json();
    const div = document.getElementById('mascots');
    if (!j.mascots || !j.mascots.length) {
      div.innerHTML = '<span style="color:#b45309;font-size:12px">⚠️ ยังไม่มี Mascot — กดสร้างก่อน</span>';
      return;
    }
    div.innerHTML = j.mascots.map(m => {
      const isActive = m.id === j.defaultId;
      return '<div class="mcard ' + (isActive ? 'active' : '') + '">' +
        (isActive ? '<span class="badge-active">✓ Default</span>' : '') +
        '<img src="/dashboard/maprao/mascot/' + m.id + '?t=' + Date.now() + '" onclick="openPreview(this.src)" loading="lazy">' +
        '<div class="mbtn">' +
        '<button onclick="setMascotDefault(String(' + m.id + '))">⭐</button>' +
        '<button class="danger" onclick="delMascot(String(' + m.id + '))">🗑️</button>' +
        '</div></div>';
    }).join('');
  } catch (e) { document.getElementById('mascots').textContent = '❌ ' + e.message; }
}
async function setMascotDefault(id) {
  const msg = document.getElementById('mascot-msg');
  msg.textContent = '⏳ กำลัง set default...';
  try {
    const j = await (await fetch('/api/maprao/mascots/' + id + '/default', { method: 'POST' })).json();
    msg.textContent = j.ok ? '✅ เปลี่ยน default แล้ว' : '❌ ' + (j.error || 'error');
    if (j.ok) loadMascots();
  } catch (e) { msg.textContent = '❌ ' + e.message; }
}
async function delMascot(id) {
  if (!confirm('ลบ Mascot นี้?')) return;
  const msg = document.getElementById('mascot-msg');
  try {
    const j = await (await fetch('/api/maprao/mascots/' + id, { method: 'DELETE' })).json();
    msg.textContent = j.ok ? '✅ ลบแล้ว' : '❌ ' + (j.error || 'error');
    if (j.ok) loadMascots();
  } catch (e) { msg.textContent = '❌ ' + e.message; }
}
async function genMascot() {
  const btn = document.getElementById('mascot-btn');
  btn.disabled = true;
  document.getElementById('mascot-msg').textContent = '⏳ กำลังสร้าง Mascot ใหม่...';
  try {
    const r = await fetch('/api/maprao/mascot/generate', { method: 'POST' });
    const j = await r.json();
    document.getElementById('mascot-msg').textContent = j.ok ? '✅ เริ่มสร้างแล้ว (ใช้เวลาสักครู่) — reload หน้าเพื่อดูผล' : '❌ ' + (j.error || 'error');
  } catch (e) { document.getElementById('mascot-msg').textContent = '❌ ' + e.message; }
  btn.disabled = false;
}
async function genComic() {
  const prompt = document.getElementById('prompt').value.trim();
  if (!prompt) return;
  const btn = document.getElementById('gen-btn');
  btn.disabled = true;
  document.getElementById('msg').textContent = '⏳ กำลังส่ง...';
  try {
    const r = await fetch('/api/maprao/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const j = await r.json();
    document.getElementById('msg').textContent = j.ok
      ? '✅ เริ่มสร้างแล้ว ID: ' + j.id + ' (ดูผลได้ที่ Telegram)'
      : '❌ ' + (j.error || 'error');
    if (j.ok) setTimeout(() => location.reload(), 3000);
  } catch (e) { document.getElementById('msg').textContent = '❌ ' + e.message; }
  btn.disabled = false;
}
loadMascots();
async function galAction(id, action) {
  const msg = document.getElementById('gal-msg');
  const labels = { post: 'โพสต์ Facebook', resend: 'ส่ง Telegram', video: 'สร้าง Video', delete: 'ลบ' };
  if (action === 'delete' && !confirm('ลบการ์ตูนนี้ออกจาก Gallery?')) return;
  msg.textContent = '⏳ ' + (labels[action] || action) + '...';
  try {
    const method = action === 'delete' ? 'DELETE' : 'POST';
    const url = action === 'delete' ? '/api/maprao/gallery/' + id : '/api/maprao/gallery/' + id + '/' + action;
    const j = await (await fetch(url, { method })).json();
    msg.textContent = j.ok ? '✅ สำเร็จ' : '❌ ' + (j.error || 'error');
    if (j.ok && action === 'delete') setTimeout(() => location.reload(), 1000);
  } catch (e) { msg.textContent = '❌ ' + e.message; }
}
</script>
</body></html>`;
}

module.exports = { renderDashboard };
