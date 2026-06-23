'use strict';
/**
 * agent-hub/html/maprang.js — Dashboard HTML สำหรับ Agent มะปราง
 * Exports: renderDashboard(ROOT, { gallery, allChars, active })
 */

const fs   = require('fs');
const path = require('path');

function renderDashboard(ROOT, { gallery, allChars, active }) {
  const charCheckboxes = Object.values(allChars).map(c =>
    `<label style="display:inline-flex;align-items:center;gap:4px;background:#1a1a2e;border:1px solid #333;border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer">` +
    `<input type="checkbox" class="char-check" value="${c.id}" checked> ${c.name || c.id}</label>`
  ).join('');

  const rows = gallery.map(m => {
    const hasVideo  = fs.existsSync(path.join(ROOT, 'agents', 'maprang', 'gallery', m.id, 'story.mp4'));
    const hasRefImg = fs.existsSync(path.join(ROOT, 'agents', 'maprang', 'gallery', m.id, 'char_ref.png'));
    const emoji = { generating:'⏳', building:'🎞️', pending_approval:'📱', posted:'✅', error:'❌' }[m.status] || '❓';
    return `<tr>
      <td style="padding:8px;font-size:12px;color:#888">${m.id}</td>
      <td style="padding:8px">${emoji} ${m.status}</td>
      <td style="padding:8px">${hasRefImg ? `<img src="/dashboard/maprang/refimage/${m.id}" style="width:40px;height:56px;object-fit:cover;border-radius:4px;vertical-align:middle">` : ''}</td>
      <td style="padding:8px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.prompt || ''}</td>
      <td style="padding:8px">${m.scenes?.length || 0} scenes</td>
      <td style="padding:8px">${hasVideo ? `<a href="/dashboard/maprang/video/${m.id}" target="_blank">▶ ดู</a>` : '—'}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8"><title>มะปราง</title>
<style>
  body{font-family:sans-serif;background:#0f0f0f;color:#eee;margin:0;padding:24px}
  h1{color:#a855f7;margin:0 0 4px}.sub{color:#888;font-size:14px;margin-bottom:24px}
  .card{background:#1a1a2e;border:1px solid #333;border-radius:12px;padding:20px;margin-bottom:20px}
  textarea,input{background:#111;color:#eee;border:1px solid #444;border-radius:8px;padding:12px;font-size:14px;box-sizing:border-box}
  textarea{width:100%;resize:vertical}
  button{background:#a855f7;color:#fff;border:none;border-radius:8px;padding:10px 24px;font-size:15px;cursor:pointer;margin-top:8px}
  button:disabled{background:#555;cursor:not-allowed}
  #msg{margin-top:12px;font-size:13px;color:#a855f7}
  table{width:100%;border-collapse:collapse}th{text-align:left;padding:8px;color:#888;font-size:13px;border-bottom:1px solid #333}
  tr:hover td{background:#1e1e3f}a{color:#a855f7}
  .scene-row{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #222}.scene-row:last-child{border:none}
  .badge{font-size:11px;padding:2px 8px;border-radius:12px;font-weight:500}
  .b-pending{background:#333;color:#888}.b-generating{background:#7c3aed;color:#fff;animation:pulse 1s infinite}
  .b-done{background:#166534;color:#86efac}.b-error{background:#7f1d1d;color:#fca5a5}.b-building{background:#92400e;color:#fde68a}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
  .progress-bar{height:6px;background:#333;border-radius:3px;overflow:hidden;margin-bottom:12px}
  .progress-fill{height:100%;background:#a855f7;border-radius:3px;transition:width .5s}
</style></head><body>
<h1>🎌 Agent มะปราง</h1>
<div class="sub">Anime Story Video Generator — ComfyUI Wan2.1 T2V-1.3B</div>

${active ? `<div class="card" id="live-card">
  <h3 style="margin:0 0 8px;color:#a855f7">⏳ กำลังสร้างวิดีโอ... <span id="live-id" style="font-size:12px;color:#888">${active.id}</span></h3>
  <div class="progress-bar"><div class="progress-fill" id="prog-fill" style="width:0%"></div></div>
  <div id="scene-list"></div>
  <div id="live-status" style="margin-top:8px;font-size:12px;color:#888"></div>
</div>` : ''}

<div class="card">
  <h3 style="margin:0 0 12px">สร้างวิดีโอใหม่</h3>
  <textarea id="prompt" rows="4" placeholder="ใส่ story prompt ภาษาไทย..."></textarea>
  ${charCheckboxes ? `<div style="margin-top:10px;font-size:12px;color:#888;margin-bottom:6px">ตัวละครที่ใช้ใน story นี้</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">${charCheckboxes}</div>` : ''}
  <div style="font-size:12px;color:#888;margin-bottom:4px">คำอธิบายตัวละครหลัก (ไม่บังคับ — ถ้าไม่มีตัวละครในระบบจะใช้ค่านี้)</div>
  <textarea id="char-desc" rows="2" placeholder="เช่น: young girl around 10, long brown hair, blue dress" style="font-size:13px"></textarea><br>
  <button id="btn-gen" onclick="generate()">🎬 สร้างวิดีโอ (≈ 30–50 นาที)</button>
  <button onclick="checkComfy()" style="background:#333;margin-left:8px">🔍 ตรวจ ComfyUI</button>
  <div id="msg"></div>
</div>

<div class="card">
  <h3 style="margin:0 0 12px">ตัวละครประจำซีรีส์</h3>
  <div id="char-list" style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:12px"></div>
  <details><summary style="cursor:pointer;color:#a855f7;font-size:13px">+ เพิ่ม / แก้ไขตัวละคร</summary>
  <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
    <input id="cn-id" placeholder="id (en) เช่น hana" style="border-radius:6px;padding:8px;font-size:13px">
    <input id="cn-name" placeholder="ชื่อภาษาไทย" style="border-radius:6px;padding:8px;font-size:13px">
    <textarea id="cn-desc" rows="2" placeholder="Booru tags: 1girl, 16 years old, long pink hair..." style="font-size:13px;grid-column:1/-1"></textarea>
    <button onclick="saveChar()" style="border-radius:6px;padding:8px;grid-column:1/-1">💾 บันทึก</button>
  </div></details>
  <div id="char-msg" style="font-size:12px;color:#a855f7;margin-top:6px"></div>
</div>

<div class="card">
  <h3 style="margin:0 0 12px">Gallery (${gallery.length} รายการ)</h3>
  <table><thead><tr><th>ID</th><th>สถานะ</th><th>ตัวละคร</th><th>Prompt</th><th>Scenes</th><th>วิดีโอ</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="6" style="padding:16px;color:#555">ยังไม่มีวิดีโอ</td></tr>'}</tbody></table>
</div>

<script>
const BADGE={pending:'b-pending',generating:'b-generating',done:'b-done',error:'b-error',building:'b-building'};
async function pollLive(){const el=document.getElementById('live-card');if(!el)return;const id=document.getElementById('live-id').textContent.trim();try{const r=await fetch('/api/maprang/status/'+id);const m=await r.json();if(!m.ok)return;const scenes=m.scenes||[];const done=scenes.filter(s=>s.status==='done').length;const total=scenes.length;document.getElementById('prog-fill').style.width=(total?Math.round(done/total*100):0)+'%';document.getElementById('scene-list').innerHTML=scenes.map(s=>'<div class="scene-row"><span class="badge '+(BADGE[s.status]||'b-pending')+'">'+(({pending:'รอ',generating:'กำลัง…',done:'✓ เสร็จ',error:'error'})[s.status]||s.status)+'</span><span>'+s.scene_number+'. '+(s.subtitle_th||'')+'</span></div>').join('');document.getElementById('live-status').textContent=done+'/'+total+' scenes | '+m.status;if(m.status==='pending_approval'||m.status==='posted')setTimeout(()=>location.reload(),2000);}catch(e){}}
const activeId=${active ? `'${active.id}'` : 'null'};
if(activeId){pollLive();setInterval(pollLive,5000);}
async function generate(){const prompt=document.getElementById('prompt').value.trim();if(!prompt){alert('กรุณาใส่ story prompt');return;}const btn=document.getElementById('btn-gen'),msg=document.getElementById('msg');btn.disabled=true;msg.textContent='⏳ กำลังส่งคำสั่ง...';try{const charDesc=document.getElementById('char-desc').value.trim();const charIds=[...document.querySelectorAll('.char-check:checked')].map(el=>el.value).join(',');const r=await fetch('/api/maprang/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,char_description:charDesc,char_ids:charIds||undefined})});const j=await r.json();if(j.ok){msg.textContent='✅ เริ่มแล้ว! ID: '+j.id;setTimeout(()=>location.reload(),2000);}else{msg.textContent='❌ '+j.error;btn.disabled=false;}}catch(e){msg.textContent='❌ '+e.message;btn.disabled=false;}}
async function checkComfy(){const msg=document.getElementById('msg');msg.textContent='⏳ กำลังตรวจสอบ...';const j=await fetch('/api/maprang/check').then(r=>r.json());msg.textContent=j.online?('✅ ComfyUI online'+(j.wan21?' | Wan2.1 ✅':' | Wan2.1 ❌')):'❌ ComfyUI ไม่ตอบสนอง';}
async function loadChars(){const j=await fetch('/api/maprang/characters').then(r=>r.json());const el=document.getElementById('char-list');const chars=j.characters||{};if(!Object.keys(chars).length){el.innerHTML='<span style="color:#555;font-size:13px">ยังไม่มีตัวละคร</span>';return;}el.innerHTML=Object.values(chars).map(c=>'<div style="background:#111;border:1px solid #333;border-radius:8px;padding:10px;min-width:140px;max-width:180px">'+(c.ref_image?'<img src="/dashboard/maprang/charimg/'+c.id+'" style="width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:4px;margin-bottom:6px">':'')+'<div style="font-weight:600;font-size:13px">'+(c.name||c.id)+'</div><div style="font-size:10px;color:#666;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+c.description+'">'+c.description+'</div><button onclick="editChar(\''+c.id+'\')" style="margin-top:6px;background:#333;color:#eee;border:none;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer">แก้ไข</button><button onclick="delChar(\''+c.id+'\')" style="margin-left:4px;background:#7f1d1d;color:#eee;border:none;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer">ลบ</button></div>').join('');}
function editChar(id){fetch('/api/maprang/characters').then(r=>r.json()).then(j=>{const c=j.characters[id];if(!c)return;document.getElementById('cn-id').value=c.id;document.getElementById('cn-name').value=c.name||'';document.getElementById('cn-desc').value=c.description||'';});}
async function saveChar(){const id=document.getElementById('cn-id').value.trim();const name=document.getElementById('cn-name').value.trim();const description=document.getElementById('cn-desc').value.trim();const msg=document.getElementById('char-msg');if(!id||!description){msg.textContent='⚠️ ต้องใส่ id และ description';return;}const j=await fetch('/api/maprang/characters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,name,description})}).then(r=>r.json());msg.textContent=j.ok?'✅ บันทึกแล้ว':'❌ '+j.error;if(j.ok){document.getElementById('cn-id').value=document.getElementById('cn-name').value=document.getElementById('cn-desc').value='';loadChars();}}
async function delChar(id){if(!confirm('ลบตัวละคร '+id+' ?'))return;const j=await fetch('/api/maprang/characters/'+id,{method:'DELETE'}).then(r=>r.json());document.getElementById('char-msg').textContent=j.ok?'✅ ลบแล้ว':'❌ '+j.error;if(j.ok)loadChars();}
loadChars();
</script></body></html>`;
}

module.exports = { renderDashboard };
