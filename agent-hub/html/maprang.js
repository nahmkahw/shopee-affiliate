'use strict';
/**
 * agent-hub/html/maprang.js — Dashboard HTML สำหรับ Agent มะปราง
 * Cinema dark theme | Scene cards | Inline video | Stage indicator
 */

const fs   = require('fs');
const path = require('path');

const BGM_MOODS = ['adventure', 'calm', 'epic', 'emotional', 'action'];

function fmtElapsed(s) {
  return s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`;
}

function timelineHtml(logs) {
  if (!logs || !logs.length) return '<span style="color:#475569;font-size:11px">รอเริ่ม...</span>';
  return logs.map(l =>
    `<div style="display:flex;gap:8px;padding:2px 0;border-bottom:1px solid #0f172a">` +
    `<span style="color:#475569;min-width:38px;flex-shrink:0;font-size:10px">+${fmtElapsed(l.elapsed||0)}</span>` +
    `<span style="font-size:11px">${l.msg}</span></div>`
  ).join('');
}

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#0a0a0a;color:#e2e8f0;padding:24px;min-height:100vh}
h1{font-size:22px;font-weight:700;letter-spacing:.5px}
.sub{color:#64748b;font-size:13px;margin-top:2px}
.card{background:#111827;border:1px solid #1e293b;border-radius:12px;padding:20px;margin-bottom:16px}
.stage-bar{display:flex;gap:8px;margin-bottom:20px}
.stage-pill{padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;border:1px solid #1e293b;color:#475569;background:#0f172a;flex:1;text-align:center}
.stage-pill.active-pre{background:#78350f;color:#fbbf24;border-color:#92400e}
.stage-pill.active-prod{background:#3b0764;color:#d8b4fe;border-color:#581c87}
.stage-pill.active-post{background:#14532d;color:#86efac;border-color:#166534}
.scene-card{background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:14px;margin-bottom:10px;transition:border-color .2s}
.scene-card:hover{border-color:#334155}
.scene-num{display:inline-block;width:26px;height:26px;background:#1e293b;border-radius:6px;text-align:center;line-height:26px;font-size:12px;font-weight:700;color:#94a3b8;margin-right:8px;flex-shrink:0}
.badge{display:inline-block;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600}
.b-pend{background:#1e293b;color:#64748b}
.b-gen{background:#3b0764;color:#d8b4fe;animation:pulse 1.2s infinite}
.b-done{background:#14532d;color:#86efac}
.b-skip{background:#1e293b;color:#475569;text-decoration:line-through}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.prog-wrap{background:#1e293b;border-radius:4px;height:4px;overflow:hidden;margin:12px 0}
.prog-fill{height:100%;border-radius:4px;transition:width .5s}
.fill-prod{background:#a855f7}
input,textarea,select{background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:6px 10px;font-size:13px;font-family:inherit;outline:none}
input:focus,textarea:focus{border-color:#a855f7}
.btn{display:inline-block;border:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer;transition:opacity .15s}
.btn:hover{opacity:.85}.btn:disabled{opacity:.4;cursor:not-allowed}
.btn-amber{background:#d97706;color:#000}
.btn-purple{background:#7c3aed;color:#fff}
.btn-green{background:#15803d;color:#86efac}
.btn-ghost{background:#1e293b;color:#94a3b8}
.btn-red{background:#7f1d1d;color:#fca5a5}
.btn-sm{padding:4px 10px;font-size:11px;border-radius:6px}
video{width:100%;max-height:160px;border-radius:6px;background:#000;margin-top:8px}
a{color:#a855f7;text-decoration:none}a:hover{text-decoration:underline}
details>summary{cursor:pointer;color:#64748b;font-size:12px;margin-top:6px;list-style:none}
details>summary::-webkit-details-marker{display:none}
.row{display:flex;gap:8px;align-items:flex-start}
.grow{flex:1}
#msg,#approve-msg,#build-msg,#char-msg{font-size:12px;color:#a855f7;margin-top:6px;min-height:16px}
`;

function stagePill(current) {
  const stages = [
    { key: 'pre_production', label: '📋 Pre-production', cls: 'active-pre' },
    { key: 'producing',      label: '🎬 Director\'s Cut',  cls: 'active-prod' },
    { key: 'building',       label: '🎞️ Post-production', cls: 'active-post' },
  ];
  return stages.map(s =>
    `<div class="stage-pill ${s.key === current ? s.cls : ''}">${s.label}</div>`
  ).join('');
}

function renderPreCard(job) {
  // ยังไม่มี scenes → loading state
  if (!job.scenes || job.scenes.length === 0) {
    return `<div class="card">
<div style="color:#fbbf24;font-weight:700;font-size:15px;margin-bottom:8px">📋 Pre-production กำลังทำงาน...</div>
<div class="prog-wrap"><div class="prog-fill fill-prod" style="width:100%;background:linear-gradient(90deg,#78350f,#d97706);animation:pulse 1.5s infinite"></div></div>
<div id="timeline" style="background:#0f172a;border-radius:6px;padding:10px;margin-top:10px;min-height:52px;font-family:monospace">${timelineHtml(job.logs)}</div>
<div style="color:#475569;font-size:12px;margin-top:8px">${job.prompt || ''}</div>
</div>`;
  }

  const moodOpts = BGM_MOODS.map(m =>
    `<option value="${m}"${job.bgm_mood === m ? ' selected' : ''}>${m}</option>`
  ).join('');
  const sceneCards = (job.scenes || []).map(s => `
<div class="scene-card">
  <div class="row">
    <span class="scene-num">${s.scene_number}</span>
    <div class="grow">
      <input value="${(s.subtitle_th || '').replace(/"/g, '&quot;')}" style="width:100%;margin-bottom:6px"
        onchange="updateSub('${job.id}',${s.scene_number},this.value)" placeholder="Subtitle TH">
      <details>
        <summary>✏️ Visual Prompt (คลิกแก้ไข)</summary>
        <textarea rows="2" style="width:100%;margin-top:6px;font-size:11px"
          onchange="updatePrompt('${job.id}',${s.scene_number},this.value)">${(s.visual_prompt_en || '').replace(/</g, '&lt;')}</textarea>
      </details>
    </div>
  </div>
</div>`).join('');

  return `<div class="card">
<div style="margin-bottom:14px"><span style="color:#fbbf24;font-weight:700;font-size:15px">📋 Storyboard</span>
  ${job.ref_image ? `<img src="/dashboard/maprang/refimage/${job.id}" style="height:80px;border-radius:6px;float:right;margin-left:12px">` : ''}
  <div style="color:#64748b;font-size:12px;margin-top:2px">${job.prompt || ''}</div>
</div>
${sceneCards}
<div style="display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap">
  <label style="font-size:12px;color:#64748b">🎵 BGM:
    <select id="bgm-mood" style="margin-left:4px">${moodOpts}</select>
  </label>
  <button class="btn btn-amber" onclick="approvePreProduction('${job.id}')">🎬 Approve &amp; Start Production</button>
  <div id="approve-msg"></div>
</div></div>`;
}

function renderProdCard(job) {
  const scenes  = job.scenes || [];
  const done    = scenes.filter(s => s.status === 'done').length;
  const total   = scenes.filter(s => !s.skipped).length;
  const pct     = total ? Math.round(done / total * 100) : 0;

  const sceneCards = scenes.map(s => {
    const badge = s.skipped ? '<span class="badge b-skip">⏭ Skip</span>'
      : s.status === 'done'       ? '<span class="badge b-done">✅ Done</span>'
      : s.status === 'generating' ? '<span class="badge b-gen">⏳…</span>'
      : '<span class="badge b-pend">• Pending</span>';
    const actions = s.skipped
      ? `<button class="btn btn-ghost btn-sm" onclick="safeClick(this,()=>regenScene('${job.id}',${s.scene_number}))">↩ Unskip</button>`
      : `<button class="btn btn-purple btn-sm" onclick="safeClick(this,()=>regenScene('${job.id}',${s.scene_number}))">🔄</button>
         <button class="btn btn-ghost btn-sm" onclick="skipScene('${job.id}',${s.scene_number},this)">⏭</button>`;
    const videoEl = (!s.skipped && s.status === 'done')
      ? `<video src="/dashboard/maprang/clip/${job.id}/${s.scene_number}" controls preload="none"></video>` : '';
    const genProgress = (s.status === 'generating' && s.started_at) ? `
<div style="margin-top:6px">
  <div class="prog-wrap" style="margin:4px 0"><div class="prog-fill fill-prod" style="width:0%" id="sp-fill-${s.scene_number}"></div></div>
  <div style="display:flex;gap:10px;font-size:11px;color:#94a3b8;margin-top:2px">
    <span id="sp-step-${s.scene_number}">รอ step...</span>
    <span id="sp-el-${s.scene_number}">0s</span>
  </div>
  <img id="sp-prev-${s.scene_number}" style="display:none;width:100%;max-height:80px;object-fit:cover;border-radius:4px;margin-top:4px">
</div>` : '';
    const narEl = `<div style="margin-top:6px">
  <div style="font-size:10px;color:#64748b;margin-bottom:2px">🎙 เสียงพากย์</div>
  <textarea id="nar-${s.scene_number}" rows="2" style="width:100%;font-size:11px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:4px;padding:4px;resize:vertical">${s.narration_th || s.subtitle_th || ''}</textarea>
  <button class="btn btn-ghost btn-sm" style="margin-top:2px" onclick="saveNarration('${job.id}',${s.scene_number})">💾 บันทึก</button>
</div>`;
    return `<div class="scene-card">
<div class="row" style="align-items:center">
  <span class="scene-num">${s.scene_number}</span>
  <span style="flex:1;font-size:13px">${s.subtitle_th || ''}</span>
  <span style="margin:0 8px">${badge}</span>
  <div style="display:flex;gap:4px">${actions}</div>
</div>
${genProgress}${narEl}${videoEl}</div>`;
  }).join('');

  const autoStartPoll = scenes
    .filter(s => s.status === 'generating' && s.started_at)
    .map(s => `startScenePoll('${job.id}',${s.scene_number},'${s.started_at}');`)
    .join('');

  return `<div class="card">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
  <span style="color:#d8b4fe;font-weight:700;font-size:15px">🎬 Director's Cut</span>
  <span style="color:#64748b;font-size:12px">${done}/${total} scenes</span>
</div>
<div class="prog-wrap"><div class="prog-fill fill-prod" style="width:${pct}%" id="prod-fill"></div></div>
<div id="timeline" style="background:#0f172a;border-radius:6px;padding:10px;margin-bottom:10px;font-family:monospace">${timelineHtml(job.logs)}</div>
<div id="scene-cards">${sceneCards}</div>
<div style="margin-top:14px;display:flex;gap:10px;align-items:center">
  <button class="btn btn-green" onclick="safeClick(this,()=>triggerBuild('${job.id}'))">🎞️ Build Story</button>
  <div id="build-msg"></div>
</div></div>${autoStartPoll ? `<script>${autoStartPoll}</script>` : ''}`;
}

function renderDashboard(ROOT, { gallery, allChars, active }) {
  const activeStatus = active?.status;
  let stageCard = '';
  if (active) {
    if (activeStatus === 'pre_production') stageCard = renderPreCard(active);
    else if (activeStatus === 'producing')  stageCard = renderProdCard(active);
    else if (activeStatus === 'building')
      stageCard = `<div class="card"><span style="color:#86efac;font-weight:700">🎞️ Post-production กำลังสร้าง story.mp4...</span></div>`;
  }

  const charCheckboxes = Object.values(allChars).map(c =>
    `<label style="display:inline-flex;align-items:center;gap:4px;background:#0f172a;border:1px solid #1e293b;border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer">` +
    `<input type="checkbox" class="char-check" value="${c.id}" checked> ${c.name || c.id}</label>`
  ).join('');

  // Gallery: เฉพาะ completed jobs (pending_approval / posted)
  const recentDone = gallery.filter(m => ['pending_approval','posted','error'].includes(m.status)).slice(0, 5);
  const doneCards  = recentDone.map(m => {
    const hasVideo = fs.existsSync(path.join(ROOT, 'agents', 'maprang', 'gallery', m.id, 'story.mp4'));
    const emoji    = m.status === 'posted' ? '✅' : m.status === 'error' ? '❌' : '📱';
    return `<div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:10px;font-size:12px">
  ${emoji} <span style="color:#94a3b8">${m.id}</span>
  <div style="color:#e2e8f0;margin:4px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px">${m.prompt || ''}</div>
  ${hasVideo ? `<a href="/dashboard/maprang/video/${m.id}" target="_blank" class="btn btn-ghost btn-sm" style="display:inline-block;margin-top:4px">▶ ดูวิดีโอ</a>` : ''}
</div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>มะปราง 🎌</title>
<style>${CSS}</style></head><body>
<div style="margin-bottom:20px">
  <h1>🎌 Agent มะปราง</h1>
  <div class="sub">Anime Story Video Generator — Movie Workflow</div>
</div>

${active ? `<div class="stage-bar">${stagePill(activeStatus)}</div>${stageCard}` : ''}

<div class="card">
  <div style="font-weight:600;margin-bottom:12px;color:#94a3b8">สร้างวิดีโอใหม่</div>
  <textarea id="prompt" rows="3" style="width:100%;margin-bottom:8px" placeholder="ใส่ story prompt ภาษาไทย..."></textarea>
  ${charCheckboxes ? `<div style="font-size:11px;color:#64748b;margin-bottom:4px">ตัวละครในซีรีส์</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">${charCheckboxes}</div>` : ''}
  <textarea id="char-desc" rows="1" style="width:100%;font-size:12px;margin-bottom:8px" placeholder="คำอธิบายตัวละคร (ไม่บังคับ)"></textarea>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <button class="btn btn-purple" id="btn-gen" onclick="generate()">📋 เริ่ม Pre-production</button>
    <button class="btn btn-ghost" onclick="checkComfy()">🔍 ComfyUI</button>
  </div>
  <div id="msg"></div>
</div>

${recentDone.length ? `<div class="card">
  <div style="font-weight:600;margin-bottom:10px;color:#94a3b8">วิดีโอล่าสุด</div>
  <div style="display:flex;flex-wrap:wrap;gap:10px">${doneCards}</div>
</div>` : ''}

<div class="card">
  <div style="font-weight:600;margin-bottom:10px;color:#94a3b8">ตัวละครประจำซีรีส์</div>
  <div id="char-list" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px"></div>
  <details><summary>+ เพิ่ม / แก้ไขตัวละคร</summary>
  <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px">
    <input id="cn-id" placeholder="id (en) เช่น hana">
    <input id="cn-name" placeholder="ชื่อภาษาไทย">
    <textarea id="cn-desc" rows="2" style="grid-column:1/-1" placeholder="Booru tags: 1girl, 16 years old, long pink hair..."></textarea>
    <button class="btn btn-purple btn-sm" style="grid-column:1/-1" onclick="saveChar()">💾 บันทึก</button>
  </div></details>
  <div id="char-msg"></div>
</div>

<script>
const ACTIVE_ID=${active ? `'${active.id}'` : 'null'};
const ACTIVE_STATUS=${active ? `'${active.status}'` : 'null'};
const ACTIVE_SCENES=${active ? (active.scenes || []).length : 0};

async function generate(){const p=document.getElementById('prompt').value.trim();if(!p){alert('กรุณาใส่ story prompt');return;}const btn=document.getElementById('btn-gen'),msg=document.getElementById('msg');btn.disabled=true;msg.textContent='⏳ กำลังสร้าง storyboard...';try{const cd=document.getElementById('char-desc').value.trim();const ci=[...document.querySelectorAll('.char-check:checked')].map(e=>e.value).join(',');const r=await fetch('/api/maprang/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:p,char_description:cd,char_ids:ci||undefined})});const j=await r.json();if(j.ok){msg.textContent='✅ Pre-production เริ่มแล้ว! รอสักครู่...';setTimeout(()=>location.reload(),4000);}else{msg.textContent='❌ '+j.error;btn.disabled=false;}}catch(e){msg.textContent='❌ '+e.message;btn.disabled=false;}}
async function checkComfy(){const msg=document.getElementById('msg');msg.textContent='⏳';const j=await fetch('/api/maprang/check').then(r=>r.json());msg.textContent=j.online?'✅ ComfyUI online'+(j.wan21?' | Wan2.1 ✅':' | Wan2.1 ❌'):'❌ ComfyUI offline';}
async function approvePreProduction(id){const mood=document.getElementById('bgm-mood').value;const msg=document.getElementById('approve-msg');msg.textContent='⏳';const j=await fetch('/api/maprang/'+id+'/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bgm_mood:mood})}).then(r=>r.json());if(j.ok){msg.textContent='✅ Production เริ่มแล้ว!';setTimeout(()=>location.reload(),2000);}else msg.textContent='❌ '+j.error;}
async function updateSub(id,n,v){await fetch('/api/maprang/'+id+'/scenes/'+n+'/update-subtitle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subtitle:v})});}
async function updatePrompt(id,n,v){await fetch('/api/maprang/'+id+'/scenes/'+n+'/update-prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:v})});}
async function saveNarration(id,n){const ta=document.getElementById('nar-'+n);if(!ta)return;const j=await fetch('/api/maprang/'+id+'/scenes/'+n+'/update-narration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({narration:ta.value})}).then(r=>r.json());ta.style.borderColor=j.ok?'#22c55e':'#ef4444';setTimeout(()=>{ta.style.borderColor='#334155';},2000);}
function safeClick(btn,fn){if(btn.dataset.c==='1'){fn();btn.dataset.c='';btn.textContent=btn.dataset.o||btn.textContent;}else{btn.dataset.o=btn.textContent;btn.dataset.c='1';btn.textContent='⚠️ ยืนยัน?';setTimeout(()=>{btn.dataset.c='';btn.textContent=btn.dataset.o;},3000);}}
async function regenScene(id,n){const j=await fetch('/api/maprang/'+id+'/scenes/'+n+'/regen',{method:'POST'}).then(r=>r.json());j.ok?location.reload():alert('❌ '+j.error);}
async function skipScene(id,n,btn){if(btn){btn.disabled=true;btn.textContent='⏳';}const j=await fetch('/api/maprang/'+id+'/scenes/'+n+'/skip',{method:'POST'}).then(r=>r.json());j.ok?location.reload():alert('❌ '+j.error);}
async function triggerBuild(id){const msg=document.getElementById('build-msg');msg.textContent='⏳';const j=await fetch('/api/maprang/'+id+'/build',{method:'POST'}).then(r=>r.json());if(j.ok){msg.textContent='✅ Building...';setTimeout(()=>location.reload(),3000);}else msg.textContent='❌ '+j.error;}
function fmtE(s){return s>=60?Math.floor(s/60)+'m'+(s%60)+'s':s+'s';}
function startScenePoll(id,n,startAt){const t0=new Date(startAt).getTime();setInterval(async()=>{const el=document.getElementById('sp-el-'+n);if(el)el.textContent=fmtE(Math.round((Date.now()-t0)/1000));try{const p=await fetch('/api/maprang/'+id+'/scene-progress/'+n).then(r=>r.json());if(p&&p.step){const f=document.getElementById('sp-fill-'+n),s=document.getElementById('sp-step-'+n);if(f)f.style.width=(p.pct||0)+'%';if(s)s.textContent='step '+p.step+'/'+p.total;if(p.has_preview){const i=document.getElementById('sp-prev-'+n);if(i){i.src='/api/maprang/'+id+'/scene-preview/'+n+'?t='+Date.now();i.style.display='block';}}}}catch{}},5000);}
function renderTL(logs){if(!logs||!logs.length)return'<span style="color:#475569;font-size:11px">รอเริ่ม...</span>';return logs.map(l=>'<div style="display:flex;gap:8px;padding:2px 0;border-bottom:1px solid #0f172a"><span style="color:#475569;min-width:38px;flex-shrink:0;font-size:10px">+'+fmtE(l.elapsed||0)+'</span><span style="font-size:11px">'+l.msg+'</span></div>').join('');}
if(ACTIVE_STATUS==='pre_production'&&ACTIVE_SCENES===0){setInterval(async()=>{try{const j=await fetch('/api/maprang/status/'+ACTIVE_ID).then(r=>r.json());if(!j.ok)return;const tl=document.getElementById('timeline');if(tl)tl.innerHTML=renderTL(j.logs);if(j.scenes&&j.scenes.length>0)setTimeout(()=>location.reload(),800);else if(j.status!=='pre_production')setTimeout(()=>location.reload(),800);}catch{}},5000);}
if(ACTIVE_STATUS==='producing'){setInterval(async()=>{try{const j=await fetch('/api/maprang/status/'+ACTIVE_ID).then(r=>r.json());if(!j.ok)return;const fill=document.getElementById('prod-fill');const done=j.scenes.filter(s=>s.status==='done').length;const total=j.scenes.filter(s=>!s.skipped).length;if(fill)fill.style.width=(total?Math.round(done/total*100):0)+'%';const tl=document.getElementById('timeline');if(tl)tl.innerHTML=renderTL(j.logs);if(['building','pending_approval'].includes(j.status))setTimeout(()=>location.reload(),1500);}catch{}},5000);}
async function loadChars(){const j=await fetch('/api/maprang/characters').then(r=>r.json());const el=document.getElementById('char-list');const chars=j.characters||{};if(!Object.keys(chars).length){el.innerHTML='<span style="color:#475569;font-size:12px">ยังไม่มีตัวละคร</span>';return;}el.innerHTML=Object.values(chars).map(c=>'<div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:8px;font-size:12px;min-width:120px">'+(c.ref_image?'<img src="/dashboard/maprang/charimg/'+c.id+'" style="width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:4px;margin-bottom:4px">':'')+'<div style="font-weight:600">'+(c.name||c.id)+'</div><div style="display:flex;gap:4px;margin-top:4px"><button class="btn btn-ghost btn-sm" data-id="'+c.id+'" onclick="editChar(this.dataset.id)">แก้ไข</button><button class="btn btn-red btn-sm" data-id="'+c.id+'" onclick="delChar(this.dataset.id)">ลบ</button></div></div>').join('');}
function editChar(id){fetch('/api/maprang/characters').then(r=>r.json()).then(j=>{const c=j.characters[id];if(!c)return;document.getElementById('cn-id').value=c.id;document.getElementById('cn-name').value=c.name||'';document.getElementById('cn-desc').value=c.description||'';});}
async function saveChar(){const id=document.getElementById('cn-id').value.trim();const name=document.getElementById('cn-name').value.trim();const description=document.getElementById('cn-desc').value.trim();const msg=document.getElementById('char-msg');if(!id||!description){msg.textContent='⚠️ id และ description required';return;}const j=await fetch('/api/maprang/characters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,name,description})}).then(r=>r.json());msg.textContent=j.ok?'✅ บันทึกแล้ว':'❌ '+j.error;if(j.ok){['cn-id','cn-name','cn-desc'].forEach(i=>document.getElementById(i).value='');loadChars();}}
async function delChar(id){if(!confirm('ลบ '+id+'?'))return;const j=await fetch('/api/maprang/characters/'+id,{method:'DELETE'}).then(r=>r.json());document.getElementById('char-msg').textContent=j.ok?'✅ ลบแล้ว':'❌ '+j.error;if(j.ok)loadChars();}
loadChars();
</script></body></html>`;
}

module.exports = { renderDashboard };
