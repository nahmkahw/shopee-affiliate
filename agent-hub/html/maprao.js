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
.badge{display:inline-block;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600}
.b-producing{background:#fde68a;color:#78350f}
.b-pending_approval{background:#bfdbfe;color:#1e3a8a}
.b-error{background:#fecaca;color:#7f1d1d}
.mcard{position:relative;border-radius:10px;overflow:hidden;border:2px solid #e5d5bd}
.mcard.active{border-color:#8B5E3C}
.mcard img{width:100%;aspect-ratio:2/3;object-fit:cover;display:block;background:#eee;cursor:pointer}
.mcard .active-tag{position:absolute;top:6px;left:6px;background:#8B5E3C;color:#fff;font-size:10px;padding:2px 6px;border-radius:8px}
`;

function galleryCard(ROOT, job) {
  const status = job.status || 'producing';
  return `<div class="gcard">
    <img src="/dashboard/maprao/comic/${job.id}" onerror="this.style.display='none'">
    <div class="meta">
      <span class="badge b-${status}">${status}</span>
      <div style="margin-top:4px">${(job.prompt || '').substring(0, 60)}</div>
    </div>
  </div>`;
}

function mascotCard(item) {
  return `<div class="mcard ${item.active ? 'active' : ''}">
    ${item.active ? '<span class="active-tag">✓ ใช้อยู่</span>' : ''}
    <img src="/dashboard/maprao/mascot/${item.id}" onclick="selectMascot('${item.id}')" title="คลิกเพื่อเลือกใช้">
  </div>`;
}

function renderDashboard(ROOT, { gallery, mascotList }) {
  const cards = gallery.length
    ? gallery.map(j => galleryCard(ROOT, j)).join('')
    : '<span style="color:#8B5E3C;font-size:13px">ยังไม่มีการ์ตูน</span>';
  const mascotReady = mascotList.some(it => it.active);
  const mascotCards = mascotList.length
    ? mascotList.map(mascotCard).join('')
    : '<span style="color:#8B5E3C;font-size:13px">ยังไม่มี Mascot Ref ในคลัง</span>';

  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
<title>มะพร้าว — B&W Manga Comic Strip</title><style>${CSS}</style></head><body>
<h1>🥥 มะพร้าว</h1>
<div class="sub">B&amp;W Manga Comic Strip — มาสคอตกระต่าย chibi</div>

<div class="card">
  <h2 style="font-size:15px;margin-bottom:10px">คลัง Mascot Ref</h2>
  ${mascotReady ? '' : `<div style="color:#b45309;font-size:12px;margin-bottom:10px">⚠️ ยังไม่ได้เลือก Mascot Ref — สร้างหรือเลือกก่อนเริ่มการ์ตูนช่องแรก</div>`}
  <div class="grid" id="mascot-gallery">${mascotCards}</div>
  <button class="btn btn-ghost" id="mascot-btn" onclick="genMascot()" style="margin-top:12px">🎨 สร้าง Mascot Ref ใหม่</button>
  <div id="mascot-msg" style="font-size:12px;color:#8B5E3C;margin-top:6px"></div>
</div>

<div class="card">
  <textarea id="prompt" placeholder="พิมพ์เรื่องที่อยากให้กระต่ายเล่า เช่น วันนี้กระต่ายทำเค้กแครอทอร่อยๆ"></textarea>
  <br><button class="btn" id="gen-btn" onclick="genComic()">🥥 สร้างการ์ตูน 4 ช่อง</button>
  <div id="msg"></div>
</div>

<div class="card">
  <h2 style="font-size:15px;margin-bottom:10px">Gallery</h2>
  <div class="grid" id="gallery">${cards}</div>
</div>

<script>
async function genMascot() {
  const btn = document.getElementById('mascot-btn');
  btn.disabled = true;
  document.getElementById('mascot-msg').textContent = '⏳ กำลังสร้าง Mascot Ref ใหม่...';
  try {
    const r = await fetch('/api/maprao/mascot/generate', { method: 'POST' });
    const j = await r.json();
    document.getElementById('mascot-msg').textContent = j.ok ? '✅ เริ่มสร้างแล้ว (ใช้เวลาสักครู่ แล้วรีเฟรชหน้า)' : '❌ ' + (j.error || 'error');
    if (j.ok) setTimeout(() => location.reload(), 60000);
  } catch (e) { document.getElementById('mascot-msg').textContent = '❌ ' + e.message; }
  btn.disabled = false;
}
async function selectMascot(id) {
  document.getElementById('mascot-msg').textContent = '⏳ กำลังเลือก...';
  try {
    const r = await fetch('/api/maprao/mascot/' + id + '/select', { method: 'POST' });
    const j = await r.json();
    document.getElementById('mascot-msg').textContent = j.ok ? '✅ เลือกแล้ว' : '❌ ' + (j.error || 'error');
    if (j.ok) location.reload();
  } catch (e) { document.getElementById('mascot-msg').textContent = '❌ ' + e.message; }
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
</script>
</body></html>`;
}

module.exports = { renderDashboard };
