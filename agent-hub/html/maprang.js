'use strict';
/**
 * agent-hub/html/maprang.js — Dashboard HTML สำหรับ Agent มะปราง (Movie Workflow)
 * Exports: renderDashboard(ROOT, { gallery, allChars, active })
 */

const fs   = require('fs');
const path = require('path');

const BGM_MOODS = ['adventure', 'calm', 'epic', 'emotional', 'action'];

function sceneStatusBadge(s) {
  if (s.skipped)              return '<span class="badge b-skip">⏭ Skip</span>';
  if (s.status === 'done')    return '<span class="badge b-done">✅ Done</span>';
  if (s.status === 'generating') return '<span class="badge b-gen">⏳ Gen…</span>';
  return '<span class="badge b-pend">• Pending</span>';
}

function renderPreProductionCard(active) {
  const scenes = (active.scenes || []);
  const moodOpts = BGM_MOODS.map(m =>
    `<option value="${m}"${active.bgm_mood === m ? ' selected' : ''}>${m}</option>`
  ).join('');

  const sceneRows = scenes.map(s => `
<tr id="sr-${s.scene_number}">
  <td style="padding:6px 8px;color:#888;font-size:12px">${s.scene_number}</td>
  <td style="padding:6px 8px">
    <input id="sub-${s.scene_number}" value="${(s.subtitle_th || '').replace(/"/g, '&quot;')}"
      style="background:#111;color:#eee;border:1px solid #444;border-radius:4px;padding:4px 6px;font-size:12px;width:100%"
      onchange="updateSub('${active.id}',${s.scene_number},this.value)">
  </td>
  <td style="padding:6px 8px">
    <textarea id="vp-${s.scene_number}" rows="2"
      style="background:#111;color:#eee;border:1px solid #444;border-radius:4px;padding:4px 6px;font-size:11px;width:100%;resize:vertical"
      onchange="updatePrompt('${active.id}',${s.scene_number},this.value)">${(s.visual_prompt_en || '').replace(/</g, '&lt;')}</textarea>
  </td>
</tr>`).join('');

  return `<div class="card" id="preproduction-card">
  <h3 style="margin:0 0 12px;color:#f59e0b">📋 Pre-production — Review Storyboard</h3>
  ${active.ref_image ? `<img src="/dashboard/maprang/refimage/${active.id}" style="height:120px;border-radius:6px;margin-bottom:12px;display:block">` : ''}
  <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
    <thead><tr>
      <th style="text-align:left;padding:6px 8px;color:#888;font-size:12px;border-bottom:1px solid #333">#</th>
      <th style="text-align:left;padding:6px 8px;color:#888;font-size:12px;border-bottom:1px solid #333">Subtitle TH</th>
      <th style="text-align:left;padding:6px 8px;color:#888;font-size:12px;border-bottom:1px solid #333">Visual Prompt EN (แก้ได้)</th>
    </tr></thead>
    <tbody>${sceneRows}</tbody>
  </table>
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <label style="font-size:13px;color:#888">🎵 BGM Mood:
      <select id="bgm-mood" style="background:#111;color:#eee;border:1px solid #444;border-radius:4px;padding:4px 8px;margin-left:4px">${moodOpts}</select>
    </label>
    <button onclick="approvePreProduction('${active.id}')" style="background:#f59e0b;color:#000;border:none;border-radius:8px;padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer">
      🎬 Approve & Start Production
    </button>
    <div id="approve-msg" style="font-size:13px;color:#a855f7"></div>
  </div>
</div>`;
}

function renderProductionCard(active) {
  const scenes = (active.scenes || []);
  const done   = scenes.filter(s => s.status === 'done').length;
  const total  = scenes.filter(s => !s.skipped).length;
  const pct    = total ? Math.round(done / total * 100) : 0;

  const sceneRows = scenes.map(s => {
    const hasClip = false; // clip path checking done client-side via API
    return `<tr id="sr-${s.scene_number}">
  <td style="padding:6px 8px;color:#888;font-size:12px">${s.scene_number}</td>
  <td style="padding:6px 8px">${sceneStatusBadge(s)}</td>
  <td style="padding:6px 8px;font-size:13px">${s.subtitle_th || ''}</td>
  <td style="padding:6px 8px">
    ${s.status === 'done' && !s.skipped
      ? `<a href="/dashboard/maprang/clip/${active.id}/${s.scene_number}" target="_blank" style="color:#a855f7;font-size:12px">▶ Preview</a>`
      : ''}
  </td>
  <td style="padding:6px 8px;display:flex;gap:4px;flex-wrap:nowrap">
    ${s.skipped ? `<button onclick="unSkip('${active.id}',${s.scene_number})" style="background:#333;color:#eee;border:none;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer">↩ Unskip</button>` :
      `<button onclick="regenScene('${active.id}',${s.scene_number})" style="background:#7c3aed;color:#fff;border:none;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer">🔄 Regen</button>
       <button onclick="skipScene('${active.id}',${s.scene_number})" style="background:#374151;color:#eee;border:none;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer">⏭ Skip</button>`
    }
  </td>
</tr>`;
  }).join('');

  return `<div class="card" id="production-card">
  <h3 style="margin:0 0 8px;color:#a855f7">🎬 Production — Director's Cut <span style="font-size:13px;color:#888">${done}/${total} scenes done</span></h3>
  <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
    <thead><tr>
      <th style="text-align:left;padding:6px 8px;color:#888;font-size:12px;border-bottom:1px solid #333">#</th>
      <th style="text-align:left;padding:6px 8px;color:#888;font-size:12px;border-bottom:1px solid #333">Status</th>
      <th style="text-align:left;padding:6px 8px;color:#888;font-size:12px;border-bottom:1px solid #333">Subtitle</th>
      <th style="padding:6px 8px;border-bottom:1px solid #333"></th>
      <th style="text-align:left;padding:6px 8px;color:#888;font-size:12px;border-bottom:1px solid #333">Actions</th>
    </tr></thead>
    <tbody id="scene-rows">${sceneRows}</tbody>
  </table>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
    <button onclick="triggerBuild('${active.id}')" style="background:#166534;color:#86efac;border:none;border-radius:8px;padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer">
      🎞️ Build Story (Post-production)
    </button>
    <div id="build-msg" style="font-size:13px;color:#a855f7"></div>
  </div>
</div>`;
}

function renderDashboard(ROOT, { gallery, allChars, active }) {
  const charCheckboxes = Object.values(allChars).map(c =>
    `<label style="display:inline-flex;align-items:center;gap:4px;background:#1a1a2e;border:1px solid #333;border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer">` +
    `<input type="checkbox" class="char-check" value="${c.id}" checked> ${c.name || c.id}</label>`
  ).join('');

  const rows = gallery.map(m => {
    const hasVideo  = fs.existsSync(path.join(ROOT, 'agents', 'maprang', 'gallery', m.id, 'story.mp4'));
    const hasRefImg = fs.existsSync(path.join(ROOT, 'agents', 'maprang', 'gallery', m.id, 'char_ref.png'));
    const emoji = { pre_production:'📋', producing:'🎬', building:'🎞️', pending_approval:'📱', posted:'✅', error:'❌' }[m.status] || '❓';
    const done  = (m.scenes || []).filter(s => s.status === 'done').length;
    const total = (m.scenes || []).length;
    return `<tr>
      <td style="padding:8px;font-size:12px;color:#888">${m.id}</td>
      <td style="padding:8px">${emoji} ${m.status}</td>
      <td style="padding:8px">${hasRefImg ? `<img src="/dashboard/maprang/refimage/${m.id}" style="width:32px;height:46px;object-fit:cover;border-radius:3px">` : ''}</td>
      <td style="padding:8px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.prompt || ''}</td>
      <td style="padding:8px;font-size:12px">${done}/${total}</td>
      <td style="padding:8px">${hasVideo ? `<a href="/dashboard/maprang/video/${m.id}" target="_blank">▶ ดู</a>` : '—'}</td>
    </tr>`;
  }).join('');

  // ─── Active stage card
  let stageCard = '';
  if (active) {
    if (active.status === 'pre_production') stageCard = renderPreProductionCard(active);
    else if (active.status === 'producing') stageCard = renderProductionCard(active);
    else if (active.status === 'building')
      stageCard = `<div class="card"><h3 style="color:#92400e">🎞️ Post-production กำลังสร้าง story.mp4...</h3></div>`;
  }

  return `<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8"><title>มะปราง</title>
<style>
  body{font-family:sans-serif;background:#0f0f0f;color:#eee;margin:0;padding:24px}
  h1{color:#a855f7;margin:0 0 4px}.sub{color:#888;font-size:14px;margin-bottom:24px}
  .card{background:#1a1a2e;border:1px solid #333;border-radius:12px;padding:20px;margin-bottom:20px}
  textarea,input,select{background:#111;color:#eee;border:1px solid #444;border-radius:8px;padding:8px;font-size:13px;box-sizing:border-box}
  textarea{width:100%;resize:vertical}
  button{background:#a855f7;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;cursor:pointer;margin-top:4px}
  button:disabled{background:#555;cursor:not-allowed}
  #msg{margin-top:12px;font-size:13px;color:#a855f7}
  table{width:100%;border-collapse:collapse}th{text-align:left;padding:8px;color:#888;font-size:12px;border-bottom:1px solid #333}
  tr:hover td{background:#1e1e3f}a{color:#a855f7}
  .badge{font-size:11px;padding:2px 7px;border-radius:10px;font-weight:500;white-space:nowrap}
  .b-pend{background:#333;color:#888}.b-gen{background:#7c3aed;color:#fff;animation:pulse 1s infinite}
  .b-done{background:#166534;color:#86efac}.b-skip{background:#374151;color:#9ca3af}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
  .progress-bar{height:5px;background:#333;border-radius:3px;overflow:hidden;margin-bottom:12px}
  .progress-fill{height:100%;background:#a855f7;border-radius:3px;transition:width .5s}
</style></head><body>
<h1>🎌 Agent มะปราง</h1>
<div class="sub">Anime Story Video — Movie Workflow (Pre-production → Director's Cut → Post-production)</div>

${stageCard}

<div class="card">
  <h3 style="margin:0 0 12px">สร้างวิดีโอใหม่</h3>
  <textarea id="prompt" rows="3" placeholder="ใส่ story prompt ภาษาไทย..."></textarea>
  ${charCheckboxes ? `<div style="margin-top:8px;font-size:12px;color:#888;margin-bottom:4px">ตัวละครในซีรีส์</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">${charCheckboxes}</div>` : ''}
  <textarea id="char-desc" rows="2" placeholder="คำอธิบายตัวละคร (ไม่บังคับ)" style="font-size:12px;margin-top:4px"></textarea><br>
  <button id="btn-gen" onclick="generate()">📋 เริ่ม Pre-production</button>
  <button onclick="checkComfy()" style="background:#333;margin-left:8px">🔍 ตรวจ ComfyUI</button>
  <div id="msg"></div>
</div>

<div class="card">
  <h3 style="margin:0 0 12px">ตัวละครประจำซีรีส์</h3>
  <div id="char-list" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px"></div>
  <details><summary style="cursor:pointer;color:#a855f7;font-size:13px">+ เพิ่ม / แก้ไข</summary>
  <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
    <input id="cn-id" placeholder="id (en)"><input id="cn-name" placeholder="ชื่อภาษาไทย">
    <textarea id="cn-desc" rows="2" placeholder="Booru tags: 1girl, 16 years old..." style="grid-column:1/-1"></textarea>
    <button onclick="saveChar()" style="grid-column:1/-1">💾 บันทึก</button>
  </div></details>
  <div id="char-msg" style="font-size:12px;color:#a855f7;margin-top:6px"></div>
</div>

<div class="card">
  <h3 style="margin:0 0 12px">Gallery (${gallery.length} รายการ)</h3>
  <table><thead><tr><th>ID</th><th>สถานะ</th><th>Ref</th><th>Prompt</th><th>Scenes</th><th>วิดีโอ</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="6" style="padding:16px;color:#555">ยังไม่มีวิดีโอ</td></tr>'}</tbody></table>
</div>

<script>
const ACTIVE_ID=${active ? `'${active.id}'` : 'null'};
const ACTIVE_STATUS=${active ? `'${active.status}'` : 'null'};

async function generate(){const prompt=document.getElementById('prompt').value.trim();if(!prompt){alert('กรุณาใส่ story prompt');return;}const btn=document.getElementById('btn-gen'),msg=document.getElementById('msg');btn.disabled=true;msg.textContent='⏳ กำลังส่งคำสั่ง...';try{const charDesc=document.getElementById('char-desc').value.trim();const charIds=[...document.querySelectorAll('.char-check:checked')].map(el=>el.value).join(',');const r=await fetch('/api/maprang/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,char_description:charDesc,char_ids:charIds||undefined})});const j=await r.json();if(j.ok){msg.textContent='✅ Pre-production เริ่มแล้ว! ID: '+j.id;setTimeout(()=>location.reload(),3000);}else{msg.textContent='❌ '+j.error;btn.disabled=false;}}catch(e){msg.textContent='❌ '+e.message;btn.disabled=false;}}

async function checkComfy(){const msg=document.getElementById('msg');msg.textContent='⏳ ตรวจสอบ...';const j=await fetch('/api/maprang/check').then(r=>r.json());msg.textContent=j.online?'✅ ComfyUI online'+(j.wan21?' | Wan2.1 ✅':' | Wan2.1 ❌'):'❌ ComfyUI ไม่ตอบสนอง';}

async function approvePreProduction(id){const mood=document.getElementById('bgm-mood').value;const msg=document.getElementById('approve-msg');msg.textContent='⏳ กำลัง approve...';const j=await fetch('/api/maprang/'+id+'/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bgm_mood:mood})}).then(r=>r.json());if(j.ok){msg.textContent='✅ Production เริ่มแล้ว!';setTimeout(()=>location.reload(),2000);}else{msg.textContent='❌ '+j.error;}}

async function updateSub(id,n,val){await fetch('/api/maprang/'+id+'/scenes/'+n+'/update-subtitle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subtitle:val})});}
async function updatePrompt(id,n,val){await fetch('/api/maprang/'+id+'/scenes/'+n+'/update-prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:val})});}

async function regenScene(id,n){if(!confirm('Regenerate scene '+n+'?'))return;const j=await fetch('/api/maprang/'+id+'/scenes/'+n+'/regen',{method:'POST'}).then(r=>r.json());if(j.ok){alert('✅ '+j.message);location.reload();}else alert('❌ '+j.error);}
async function skipScene(id,n){const j=await fetch('/api/maprang/'+id+'/scenes/'+n+'/skip',{method:'POST'}).then(r=>r.json());if(j.ok)location.reload();else alert('❌ '+j.error);}
async function unSkip(id,n){const j=await fetch('/api/maprang/'+id+'/scenes/'+n+'/regen',{method:'POST'}).then(r=>r.json());if(j.ok)location.reload();else alert('❌ '+j.error);}

async function triggerBuild(id){if(!confirm('เริ่ม Post-production (TTS + merge)?'))return;const msg=document.getElementById('build-msg');msg.textContent='⏳ กำลัง build...';const j=await fetch('/api/maprang/'+id+'/build',{method:'POST'}).then(r=>r.json());if(j.ok){msg.textContent='✅ Build เริ่มแล้ว ('+j.done_scenes+' scenes)';setTimeout(()=>location.reload(),3000);}else msg.textContent='❌ '+j.error;}

// Auto-poll ถ้าอยู่ใน producing stage
if(ACTIVE_STATUS==='producing'){setInterval(async()=>{const j=await fetch('/api/maprang/status/'+ACTIVE_ID).then(r=>r.json());if(!j.ok)return;const rows=document.getElementById('scene-rows');if(!rows)return;const done=j.scenes.filter(s=>s.status==='done').length;const total=j.scenes.filter(s=>!s.skipped).length;document.querySelector('.progress-fill').style.width=(total?Math.round(done/total*100):0)+'%';if(j.status==='pending_approval'||j.status==='building')setTimeout(()=>location.reload(),2000);},5000);}

async function loadChars(){const j=await fetch('/api/maprang/characters').then(r=>r.json());const el=document.getElementById('char-list');const chars=j.characters||{};if(!Object.keys(chars).length){el.innerHTML='<span style="color:#555;font-size:13px">ยังไม่มีตัวละคร</span>';return;}el.innerHTML=Object.values(chars).map(c=>'<div style="background:#111;border:1px solid #333;border-radius:8px;padding:8px;min-width:120px;max-width:160px">'+(c.ref_image?'<img src="/dashboard/maprang/charimg/'+c.id+'" style="width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:4px;margin-bottom:4px">':'')+'<div style="font-weight:600;font-size:12px">'+(c.name||c.id)+'</div><button onclick="editChar(\''+c.id+'\')" style="margin-top:4px;background:#333;color:#eee;border:none;border-radius:4px;padding:2px 6px;font-size:11px;cursor:pointer">แก้ไข</button><button onclick="delChar(\''+c.id+'\')" style="margin-left:3px;background:#7f1d1d;color:#eee;border:none;border-radius:4px;padding:2px 6px;font-size:11px;cursor:pointer">ลบ</button></div>').join('');}
function editChar(id){fetch('/api/maprang/characters').then(r=>r.json()).then(j=>{const c=j.characters[id];if(!c)return;document.getElementById('cn-id').value=c.id;document.getElementById('cn-name').value=c.name||'';document.getElementById('cn-desc').value=c.description||'';});}
async function saveChar(){const id=document.getElementById('cn-id').value.trim();const name=document.getElementById('cn-name').value.trim();const description=document.getElementById('cn-desc').value.trim();const msg=document.getElementById('char-msg');if(!id||!description){msg.textContent='⚠️ ต้องใส่ id และ description';return;}const j=await fetch('/api/maprang/characters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,name,description})}).then(r=>r.json());msg.textContent=j.ok?'✅ บันทึกแล้ว':'❌ '+j.error;if(j.ok){document.getElementById('cn-id').value=document.getElementById('cn-name').value=document.getElementById('cn-desc').value='';loadChars();}}
async function delChar(id){if(!confirm('ลบ '+id+'?'))return;const j=await fetch('/api/maprang/characters/'+id,{method:'DELETE'}).then(r=>r.json());document.getElementById('char-msg').textContent=j.ok?'✅ ลบแล้ว':'❌ '+j.error;if(j.ok)loadChars();}
loadChars();
</script></body></html>`;
}

module.exports = { renderDashboard };
