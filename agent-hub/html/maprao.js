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
.gcard .actions{display:flex;gap:4px;padding:0 10px 10px}
.gcard .actions button{flex:1;border:none;border-radius:6px;padding:5px 4px;font-size:11px;font-weight:600;cursor:pointer;background:#eee1cc;color:#8B5E3C}
.gcard .actions button:hover{opacity:.85}
.gcard .actions button.danger{background:#fecaca;color:#7f1d1d}
.badge{display:inline-block;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600}
.b-producing{background:#fde68a;color:#78350f}
.b-pending_approval{background:#bfdbfe;color:#1e3a8a}
.b-posted{background:#bbf7d0;color:#14532d}
.b-error{background:#fecaca;color:#7f1d1d}
.mcard{position:relative;border-radius:10px;overflow:hidden;border:2px solid #e5d5bd;background:#fff}
.mcard.active{border-color:#8B5E3C}
.mcard img{width:100%;aspect-ratio:2/3;object-fit:cover;display:block;background:#eee;cursor:pointer}
.mcard .active-tag{position:absolute;top:6px;left:6px;background:#8B5E3C;color:#fff;font-size:10px;padding:2px 6px;border-radius:8px}
.mcard .meta{padding:6px 8px;font-size:11px;color:#8B5E3C;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mcard .del-btn{position:absolute;top:6px;right:6px;background:rgba(0,0,0,.55);color:#fff;border:none;border-radius:50%;width:22px;height:22px;font-size:13px;line-height:22px;text-align:center;cursor:pointer;padding:0}
.mcard .del-btn:hover{background:#b91c1c}
#lb-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:9999;align-items:center;justify-content:center;cursor:zoom-out}
#lb-overlay.open{display:flex}
#lb-overlay img{max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.6);cursor:default}
`;

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function galleryCard(ROOT, job) {
  const status = job.status || 'producing';
  const latestLog = (status === 'producing' && job.logs?.length)
    ? job.logs[job.logs.length - 1].msg : '';
  let videoBtn;
  if (job.video_status === 'producing') {
    videoBtn = `<button disabled title="กำลังสร้างวิดีโอ...">⏳</button>`;
  } else if (job.story_video) {
    videoBtn = `<a href="/dashboard/maprao/video/${job.id}" download="story.mp4" style="flex:1;display:flex;align-items:center;justify-content:center;border:none;border-radius:6px;padding:5px 4px;font-size:11px;font-weight:600;cursor:pointer;background:#d1fae5;color:#065f46;text-decoration:none" title="ดาวน์โหลดวิดีโอ Reels/TikTok">🎬 ดาวน์</a>`;
  } else {
    videoBtn = `<button onclick="makeVideo('${job.id}')" title="สร้างวิดีโอ Reels/TikTok (Ken Burns + เสียงบรรยาย)">🎬</button>`;
  }
  return `<div class="gcard">
    <img src="/dashboard/maprao/comic/${job.id}" onerror="this.style.display='none'"
      style="cursor:zoom-in" onclick="openLightbox('/dashboard/maprao/comic/${job.id}')" title="คลิกเพื่อดูรูปขนาดใหญ่">
    <div class="meta">
      <span class="badge b-${status}">${status}</span>
      ${latestLog ? `<div style="margin-top:3px;font-size:10px;color:#92400e;overflow:hidden;white-space:nowrap;text-overflow:ellipsis" title="${esc(latestLog)}">${esc(latestLog)}</div>` : ''}
      <div style="margin-top:4px">${esc((job.prompt || '').substring(0, 60))}</div>
    </div>
    <div class="actions">
      <button onclick="postGallery('${job.id}')" title="โพสต์ Facebook ทันที">📤 โพสต์</button>
      <button onclick="resendGallery('${job.id}')" title="ส่ง Telegram approval ซ้ำ">✈️ ส่ง TG</button>
      ${videoBtn}
      <button class="danger" onclick="deleteGallery('${job.id}')" title="ลบรายการนี้">🗑️</button>
    </div>
  </div>`;
}

function mascotCard(item) {
  const title = item.detail ? `${esc(item.detail)} — คลิกเพื่อเลือกใช้` : 'คลิกเพื่อเลือกใช้';
  return `<div class="mcard ${item.active ? 'active' : ''}">
    ${item.active ? '<span class="active-tag">✓ ใช้อยู่</span>'
      : `<button class="del-btn" onclick="event.stopPropagation();deleteMascot('${item.id}')" title="ลบรูปนี้">×</button>`}
    <img src="/dashboard/maprao/mascot/${item.id}" onclick="selectMascot('${item.id}')" title="${title}">
    ${item.detail ? `<div class="meta">${esc(item.detail)}</div>` : ''}
  </div>`;
}

function renderDashboard(ROOT, { gallery, mascotList, lastDetail }) {
  const hasProducing = gallery.some(j => j.status === 'producing' || j.video_status === 'producing');
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
  <input id="mascot-detail" type="text" value="${esc(lastDetail)}"
    placeholder="รายละเอียดเสริม (ไม่บังคับ) เช่น ใส่หมวกเบเร่ต์, หูตั้ง"
    style="width:100%;margin-top:12px;background:#fdfaf5;color:#3b2a1a;border:1px solid #d9c4a3;border-radius:6px;padding:8px 10px;font-size:13px;font-family:inherit;outline:none">
  <div style="font-size:11px;color:#8B5E3C;margin-top:4px">จะต่อท้ายสไตล์ "กระต่าย chibi ขาวดำ" ที่ล็อกไว้เสมอ — ไม่ต้องพิมพ์สไตล์ซ้ำ</div>
  <button class="btn btn-ghost" id="mascot-btn" onclick="genMascot()" style="margin-top:10px">🎨 สร้าง Mascot Ref ใหม่</button>
  <div id="mascot-msg" style="font-size:12px;color:#8B5E3C;margin-top:6px"></div>
</div>

<div class="card">
  <details id="news-panel" style="margin-bottom:14px;border:1px solid #e5d5bd;border-radius:8px;padding:10px">
    <summary style="cursor:pointer;font-size:13px;font-weight:600;color:#8B5E3C;list-style:none">📰 สร้างจากข่าว (มะนาว / มะกรูด) ▾</summary>
    <div style="margin-top:10px">
      <select id="news-select" style="width:100%;padding:7px 8px;border:1px solid #d9c4a3;border-radius:6px;background:#fdfaf5;color:#3b2a1a;font-size:13px">
        <option value="">กำลังโหลดข่าว...</option>
      </select>
      <div style="display:flex;gap:16px;margin:8px 0 10px;font-size:13px">
        <label style="cursor:pointer"><input type="radio" name="news-mode" value="comic" checked> 🖼️ การ์ตูน</label>
        <label style="cursor:pointer"><input type="radio" name="news-mode" value="video"> 🎬 Video</label>
      </div>
      <button class="btn" id="news-gen-btn" onclick="genFromNews()" style="margin-top:0">📰 สร้างจากข่าวนี้</button>
      <div id="news-msg" style="font-size:12px;color:#8B5E3C;margin-top:6px;min-height:16px"></div>
    </div>
  </details>
  <textarea id="prompt" placeholder="หรือพิมพ์เรื่องเองตรงๆ เช่น วันนี้กระต่ายทำเค้กแครอทอร่อยๆ"></textarea>
  <br><button class="btn" id="gen-btn" onclick="genComic()">🥥 สร้างการ์ตูน 4 ช่อง</button>
  <div id="msg"></div>
</div>

<div class="card">
  <h2 style="font-size:15px;margin-bottom:10px">Gallery</h2>
  <div id="gallery-msg" style="font-size:12px;color:#8B5E3C;margin-bottom:8px;min-height:16px"></div>
  <div class="grid" id="gallery">${cards}</div>
</div>

<div id="lb-overlay" onclick="closeLightbox()">
  <img id="lb-img" src="" onclick="event.stopPropagation()" alt="preview">
</div>

<script>
${hasProducing ? 'setTimeout(() => location.reload(), 10000);' : ''}
function openLightbox(src) {
  document.getElementById('lb-img').src = src;
  document.getElementById('lb-overlay').classList.add('open');
}
function closeLightbox() {
  document.getElementById('lb-overlay').classList.remove('open');
  document.getElementById('lb-img').src = '';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

async function genMascot() {
  const detail = document.getElementById('mascot-detail').value.trim();
  const btn = document.getElementById('mascot-btn');
  btn.disabled = true;
  document.getElementById('mascot-msg').textContent = '⏳ กำลังสร้าง Mascot Ref ใหม่...';
  try {
    const r = await fetch('/api/maprao/mascot/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ detail }),
    });
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
async function deleteMascot(id) {
  if (!confirm('ลบ Mascot Ref รูปนี้ถาวร? กู้คืนไม่ได้')) return;
  document.getElementById('mascot-msg').textContent = '⏳ กำลังลบ...';
  try {
    const r = await fetch('/api/maprao/mascot/' + id, { method: 'DELETE' });
    const j = await r.json();
    document.getElementById('mascot-msg').textContent = j.ok ? '✅ ลบแล้ว' : '❌ ' + (j.error || 'error');
    if (j.ok) location.reload();
  } catch (e) { document.getElementById('mascot-msg').textContent = '❌ ' + e.message; }
}
async function postGallery(id) {
  if (!confirm('โพสต์การ์ตูนนี้ขึ้น Facebook Page ทันทีเลย? (ไม่ผ่าน Telegram approval)')) return;
  document.getElementById('gallery-msg').textContent = '⏳ กำลังโพสต์...';
  try {
    const r = await fetch('/api/maprao/gallery/' + id + '/post', { method: 'POST' });
    const j = await r.json();
    document.getElementById('gallery-msg').textContent = j.ok ? '✅ โพสต์แล้ว' : '❌ ' + (j.error || 'error');
    if (j.ok) setTimeout(() => location.reload(), 1500);
  } catch (e) { document.getElementById('gallery-msg').textContent = '❌ ' + e.message; }
}
async function resendGallery(id) {
  document.getElementById('gallery-msg').textContent = '⏳ กำลังส่งเข้า Telegram...';
  try {
    const r = await fetch('/api/maprao/gallery/' + id + '/resend', { method: 'POST' });
    const j = await r.json();
    document.getElementById('gallery-msg').textContent = j.ok ? '✅ ส่งแล้ว ดูที่ Telegram' : '❌ ' + (j.error || 'error');
  } catch (e) { document.getElementById('gallery-msg').textContent = '❌ ' + e.message; }
}
async function makeVideo(id) {
  document.getElementById('gallery-msg').textContent = '⏳ กำลังส่งคำสั่งสร้างวิดีโอ...';
  try {
    const r = await fetch('/api/maprao/gallery/' + id + '/video', { method: 'POST' });
    const j = await r.json();
    document.getElementById('gallery-msg').textContent = j.ok
      ? '✅ เริ่มสร้างวิดีโอแล้ว (ใช้เวลา ~5-10 นาที — รีเฟรชเพื่อดูผล)'
      : '❌ ' + (j.error || 'error');
  } catch (e) { document.getElementById('gallery-msg').textContent = '❌ ' + e.message; }
}
async function deleteGallery(id) {
  if (!confirm('ลบรายการนี้ถาวร? กู้คืนไม่ได้')) return;
  document.getElementById('gallery-msg').textContent = '⏳ กำลังลบ...';
  try {
    const r = await fetch('/api/maprao/gallery/' + id, { method: 'DELETE' });
    const j = await r.json();
    document.getElementById('gallery-msg').textContent = j.ok ? '✅ ลบแล้ว' : '❌ ' + (j.error || 'error');
    if (j.ok) location.reload();
  } catch (e) { document.getElementById('gallery-msg').textContent = '❌ ' + e.message; }
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
async function loadNews() {
  const sel = document.getElementById('news-select');
  try {
    const j = await (await fetch('/api/maprao/news')).json();
    if (!j.ok || !j.news.length) {
      sel.innerHTML = '<option value="">— ยังไม่มีข่าวล่าสุด —</option>';
      return;
    }
    sel.innerHTML = '<option value="">— เลือกข่าว —</option>' + j.news.map(n => {
      const tag = '[' + n.source + '] ';
      const title = (n.title || n.slug || '').substring(0, 55);
      return '<option value="' + n.source + ':' + n.slug + '">' + tag + title + '</option>';
    }).join('');
  } catch (e) { sel.innerHTML = '<option value="">❌ โหลดไม่ได้: ' + e.message + '</option>'; }
}
async function genFromNews() {
  const val = document.getElementById('news-select').value;
  if (!val) { alert('กรุณาเลือกข่าวก่อน'); return; }
  const [source, ...rest] = val.split(':');
  const slug = rest.join(':');
  const mode = document.querySelector('[name="news-mode"]:checked')?.value || 'comic';
  const btn = document.getElementById('news-gen-btn');
  const msg = document.getElementById('news-msg');
  btn.disabled = true;
  msg.textContent = '⏳ Typhoon2 สรุปข่าวเป็นเรื่องกระต่าย...';
  try {
    const r = await fetch('/api/maprao/generate-from-news', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, slug, mode }),
    });
    const j = await r.json();
    if (j.ok) {
      msg.textContent = '✅ เริ่มสร้างแล้ว ID: ' + j.id + ' | "' + (j.storyPrompt || '').substring(0, 50) + '"';
      setTimeout(() => location.reload(), 3500);
    } else {
      msg.textContent = '❌ ' + (j.error || 'error');
    }
  } catch (e) { msg.textContent = '❌ ' + e.message; }
  btn.disabled = false;
}
loadNews();
</script>
</body></html>`;
}

module.exports = { renderDashboard };
