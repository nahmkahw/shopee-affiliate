'use strict';
/**
 * agent-hub/html/main.js
 * Exports: escHtml, statusBadge, buildMainPage, buildAgentPage
 */
const fs   = require('fs');
const path = require('path');

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function statusBadge(status) {
  const map = {
    running: ['🟡', 'กำลังทำงาน', '#F59E0B', '#FFFBEB'],
    error:   ['🔴', 'Error',       '#EF4444', '#FEF2F2'],
    idle:    ['🟢', 'พร้อม',       '#10B981', '#ECFDF5'],
    done:    ['✅', 'เสร็จแล้ว',   '#6366F1', '#EEF2FF'],
  };
  const [dot, label, color, bg] = map[status] || map.idle;
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;background:${bg};color:${color};font-size:12px;font-weight:600">${dot} ${label}</span>`;
}

function buildMainPage(status, AGENTS, ROOT) {
  const today = new Date().toLocaleDateString('th-TH', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  const cards = Object.entries(AGENTS).map(([name, cfg]) => {
    const st      = status[name] || {};
    const lastRun = st.lastRun ? new Date(st.lastRun).toLocaleTimeString('th-TH') : '—';
    const result  = (st.lastResult || '').substring(0, 42);
    const hasPng  = fs.existsSync(path.join(ROOT, 'agents', name, 'avatar.png'));

    // status chip
    const stMap = {
      running: { dot: '🟡', label: 'กำลังทำงาน', glow: '#F59E0B55' },
      error:   { dot: '🔴', label: 'Error',        glow: '#EF444455' },
      idle:    { dot: '🟢', label: 'พร้อม',        glow: cfg.color + '44' },
    };
    const stInfo = stMap[st.status] || stMap.idle;
    const isRunning = st.status === 'running';

    return `
    <div onclick="window.location='/agent/${name}'"
         class="agent-card" data-agent="${name}"
         style="cursor:pointer;border-radius:24px;overflow:hidden;position:relative;
                aspect-ratio:3/4;
                border:2px solid ${cfg.color};
                box-shadow:0 8px 40px ${stInfo.glow}, 0 2px 12px rgba(0,0,0,0.3);
                transition:all 0.35s ease;
                background:linear-gradient(160deg, ${cfg.color}22 0%, #0f172a 60%)">

      <!-- Avatar image — fills card -->
      <img src="/avatar/${name}?t=${Date.now()}"
           alt="${cfg.label}"
           style="position:absolute;inset:0;width:100%;height:100%;
                  object-fit:${hasPng ? 'cover' : 'contain'};
                  object-position:center top;
                  padding:${hasPng ? '0' : '18px'};
                  transition:transform 0.45s ease;pointer-events:none"
           class="card-avatar">

      <!-- Gradient scrim — bottom fade -->
      <div style="position:absolute;inset:0;
                  background:linear-gradient(to bottom,
                    transparent 30%,
                    rgba(10,14,26,0.55) 58%,
                    rgba(10,14,26,0.92) 80%,
                    rgba(10,14,26,0.98) 100%)">
      </div>

      <!-- Status chip — top right -->
      <div style="position:absolute;top:14px;right:14px;
                  padding:5px 12px;border-radius:999px;
                  background:rgba(0,0,0,0.55);
                  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
                  border:1px solid rgba(255,255,255,0.12);
                  font-size:12px;font-weight:700;color:white;
                  display:flex;align-items:center;gap:5px;
                  ${isRunning ? 'animation:pulse-badge 2s ease-in-out infinite' : ''}">
        ${stInfo.dot} ${stInfo.label}
      </div>

      <!-- Running action chip — top left -->
      ${isRunning ? `
      <div style="position:absolute;top:14px;left:14px;
                  padding:5px 12px;border-radius:999px;
                  background:${cfg.color}CC;
                  font-size:11px;font-weight:700;color:white;
                  display:flex;align-items:center;gap:4px">
        ⚙️ ${st.currentAction || ''}
      </div>` : `
      <!-- Avatar change button — top left (idle only) -->
      <div onclick="event.stopPropagation();openHubAvatarModal('${name}','${escHtml(cfg.label)}','${cfg.emoji}','${cfg.color}')"
           title="เปลี่ยนรูปโปรไฟล์"
           style="position:absolute;top:14px;left:14px;
                  width:32px;height:32px;border-radius:50%;
                  background:rgba(0,0,0,0.55);
                  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
                  border:1px solid rgba(255,255,255,0.18);
                  display:flex;align-items:center;justify-content:center;
                  font-size:15px;cursor:pointer;
                  transition:background 0.2s;opacity:0.85"
           onmouseover="this.style.background='${cfg.color}CC';this.style.opacity='1'"
           onmouseout="this.style.background='rgba(0,0,0,0.55)';this.style.opacity='0.85'">
        🎨
      </div>`}

      <!-- Name + info overlay — bottom center -->
      <div style="position:absolute;bottom:0;left:0;right:0;
                  padding:24px 20px 22px;text-align:center">

        <!-- Agent name -->
        <div style="font-size:28px;font-weight:900;color:white;
                    text-shadow:0 2px 16px rgba(0,0,0,0.9);
                    letter-spacing:-0.5px;line-height:1.15">
          ${cfg.emoji} ${cfg.label}
        </div>

        <!-- Role badge -->
        <div style="display:inline-flex;align-items:center;margin-top:6px;
                    padding:3px 12px;border-radius:999px;
                    background:${cfg.color}33;border:1px solid ${cfg.color}66;
                    font-size:12px;font-weight:600;color:${cfg.color};
                    backdrop-filter:blur(4px)">
          ${cfg.role}
        </div>

        <!-- Divider -->
        <div style="height:1px;background:rgba(255,255,255,0.12);margin:10px 0 8px"></div>

        <!-- Last run + result -->
        <div style="font-size:11.5px;color:rgba(255,255,255,0.55);
                    display:flex;flex-direction:column;gap:3px">
          <div>⏱ ${lastRun}</div>
          ${result ? `<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
                                  padding:0 4px" title="${escHtml(st.lastResult||'')}">
            📝 ${escHtml(result)}${(st.lastResult||'').length > 42 ? '…' : ''}
          </div>` : ''}
        </div>

        <!-- Enter arrow -->
        <div style="margin-top:12px;display:flex;align-items:center;justify-content:center;gap:6px;
                    font-size:13px;font-weight:700;color:${cfg.color}">
          เปิดหน้าควบคุม
          <span style="font-size:16px">→</span>
        </div>

      </div>
    </div>`;
  }).join('');

  const allCards = cards;

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Hub</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800;900&display=swap');
  *{font-family:'Sarabun',sans-serif;box-sizing:border-box;margin:0;padding:0}

  body {
    background: radial-gradient(ellipse at top, #1a2444 0%, #0d1117 60%);
    min-height: 100vh;
  }

  .agent-card:hover {
    transform: translateY(-8px) scale(1.02);
    box-shadow: 0 20px 60px var(--glow, rgba(0,0,0,0.4)), 0 4px 20px rgba(0,0,0,0.3) !important;
  }
  .agent-card:hover .card-avatar {
    transform: scale(1.06);
  }
  .agent-card:active {
    transform: translateY(-4px) scale(1.01);
  }

  @keyframes pulse-badge {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.65; }
  }
  @keyframes shimmer {
    0%   { background-position: -200% center; }
    100% { background-position:  200% center; }
  }

  /* Particle dots bg */
  .hub-bg {
    position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:0;
  }
  .hub-bg span {
    position:absolute;border-radius:50%;background:white;opacity:0.04;
    animation:float linear infinite;
  }

  @keyframes float {
    0%   { transform: translateY(100vh) rotate(0deg); opacity:0; }
    10%  { opacity:0.04; }
    90%  { opacity:0.04; }
    100% { transform: translateY(-20vh) rotate(720deg); opacity:0; }
  }
</style>
</head>
<body>

<!-- Floating bg particles -->
<div class="hub-bg">
  ${[...Array(12)].map((_,i) => {
    const size = 4 + Math.random()*8 | 0;
    const left = (i * 8.3 + Math.random()*5) | 0;
    const dur  = 12 + Math.random()*20 | 0;
    const del  = (Math.random()*15) | 0;
    return `<span style="width:${size}px;height:${size}px;left:${left}%;animation-duration:${dur}s;animation-delay:-${del}s"></span>`;
  }).join('')}
</div>

<!-- Header -->
<div style="position:relative;z-index:10;
            background:rgba(15,23,42,0.85);
            backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
            border-bottom:1px solid rgba(255,255,255,0.08);
            color:white;padding:18px 32px;
            display:flex;align-items:center;justify-content:space-between">
  <div style="display:flex;align-items:center;gap:14px">
    <div style="width:42px;height:42px;border-radius:12px;
                background:linear-gradient(135deg,#6366F1,#8B5CF6);
                display:flex;align-items:center;justify-content:center;font-size:22px">
      🤖
    </div>
    <div>
      <div style="font-size:20px;font-weight:900;letter-spacing:-0.3px">Agent Hub</div>
      <div style="font-size:11px;color:#64748B;margin-top:1px">${today}</div>
    </div>
  </div>
  <div style="display:flex;gap:10px">
    <button onclick="location.reload()"
      style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);
             color:#94A3B8;padding:8px 18px;border-radius:10px;cursor:pointer;
             font-size:13px;font-family:inherit;transition:all 0.2s"
      onmouseover="this.style.background='rgba(255,255,255,0.12)';this.style.color='white'"
      onmouseout="this.style.background='rgba(255,255,255,0.07)';this.style.color='#94A3B8'">
      🔄 รีเฟรช
    </button>
    <a href="/logout"
      style="background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.25);
             color:#f87171;padding:8px 18px;border-radius:10px;cursor:pointer;text-decoration:none;
             font-size:13px;font-family:inherit;transition:all 0.2s;display:inline-flex;align-items:center"
      onmouseover="this.style.background='rgba(248,113,113,0.2)'"
      onmouseout="this.style.background='rgba(248,113,113,0.1)'">
      🚪 ออกจากระบบ
    </a>
  </div>
</div>

<!-- ComfyUI GPU Queue -->
<div style="position:relative;z-index:10;max-width:1000px;margin:24px auto 0;padding:0 28px">
  <div style="background:rgba(15,23,42,0.7);border:1px solid rgba(255,255,255,0.08);border-radius:14px;
              padding:13px 18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px">
    <span style="font-weight:800;color:#e2e8f0">🎮 ComfyUI GPU</span>
    <span id="gpu-queue-body" style="color:#64748B">กำลังโหลด...</span>
  </div>
</div>

<!-- Cards -->
<div style="position:relative;z-index:10;max-width:1000px;margin:28px auto 44px;padding:0 28px">
  <div style="text-align:center;margin-bottom:36px">
    <h2 style="font-size:15px;font-weight:600;color:#475569;letter-spacing:.08em;text-transform:uppercase">
      เลือก Agent ที่ต้องการควบคุม
    </h2>
    <div style="width:40px;height:2px;background:linear-gradient(90deg,#6366F1,#8B5CF6);
                margin:10px auto 0;border-radius:999px"></div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;max-width:900px;margin:0 auto">
    ${allCards}
  </div>
</div>

<!-- ══ Hub Avatar Modal ══ -->
<div id="hub-avatar-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;overflow-y:auto;padding:20px">
  <div style="max-width:680px;margin:0 auto;background:#1E293B;border-radius:20px;overflow:hidden;box-shadow:0 25px 60px rgba(0,0,0,0.5)">

    <!-- Header -->
    <div id="hub-av-header" style="padding:20px 24px;display:flex;align-items:center;justify-content:space-between">
      <div>
        <div id="hub-av-title" style="font-size:18px;font-weight:800;color:white">🎨 Generate รูปโปรไฟล์ AI</div>
        <div id="hub-av-sub" style="font-size:12px;color:rgba(255,255,255,0.75);margin-top:2px"></div>
      </div>
      <button onclick="closeHubAvatarModal()" style="background:rgba(255,255,255,0.15);border:none;color:white;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center">✕</button>
    </div>

    <!-- Body -->
    <div style="padding:24px;display:flex;flex-direction:column;gap:20px">

      <!-- Step 1: Options -->
      <div id="hub-gen-options" style="display:flex;flex-direction:column;gap:16px">
        <div>
          <div style="font-size:13px;font-weight:600;color:#94A3B8;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">เพศตัวละคร</div>
          <div style="display:flex;gap:10px">
            <button id="hub-btn-f" onclick="hubSetGender('f')"
              style="flex:1;padding:12px;border-radius:12px;border:2px solid #6366F1;background:#6366F122;color:white;cursor:pointer;font-size:16px;font-family:inherit;font-weight:700;transition:all .2s">
              ♀ หญิง
            </button>
            <button id="hub-btn-m" onclick="hubSetGender('m')"
              style="flex:1;padding:12px;border-radius:12px;border:2px solid #475569;background:transparent;color:#94A3B8;cursor:pointer;font-size:16px;font-family:inherit;font-weight:700;transition:all .2s">
              ♂ ชาย
            </button>
          </div>
        </div>
        <div>
          <div style="font-size:13px;font-weight:600;color:#94A3B8;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">การแต่งตัว</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
            ${['นักเรียน','ออฟฟิศ','มิโค','บัตเลอร์/เมด','แนวต่อสู้'].map((o,i) => {
              const icons = ['🎒','💼','⛩️','🎩','⚔️'];
              return `<button id="hub-outfit-${i}" data-outfit="${o}" onclick="hubSetOutfit('${o}',${i})"
                style="padding:10px 8px;border-radius:10px;border:2px solid #475569;background:transparent;
                       color:#94A3B8;cursor:pointer;font-size:13px;font-family:inherit;font-weight:600;
                       transition:all .2s;display:flex;flex-direction:column;align-items:center;gap:4px">
                <span style="font-size:20px">${icons[i]}</span>${o}
              </button>`;
            }).join('')}
          </div>
        </div>
        <button id="hub-gen-btn" onclick="hubStartGenerate()"
          style="width:100%;padding:14px;border-radius:12px;border:none;background:linear-gradient(135deg,#6366F1,#6366F1CC);
                 color:white;font-size:16px;font-family:inherit;font-weight:700;cursor:pointer;transition:all .2s;
                 display:flex;align-items:center;justify-content:center;gap:8px"
          onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
          ✨ Generate 2 รูป
        </button>
      </div>

      <!-- Step 2: Loading -->
      <div id="hub-gen-loading" style="display:none;text-align:center;padding:20px 0">
        <div style="font-size:40px;margin-bottom:12px;animation:hub-spin 2s linear infinite;display:inline-block">⚙️</div>
        <div style="font-size:15px;color:#E2E8F0;font-weight:600" id="hub-load-text">กำลัง Generate รูป...</div>
        <div style="margin-top:12px;background:#0F172A;border-radius:999px;height:6px;overflow:hidden">
          <div id="hub-load-bar" style="height:6px;background:#6366F1;border-radius:999px;width:0%;transition:width .5s"></div>
        </div>
        <div style="font-size:12px;color:#64748B;margin-top:6px" id="hub-load-sub">ส่ง job ไป ComfyUI...</div>
      </div>

      <!-- Step 3: Results -->
      <div id="hub-gen-results" style="display:none;flex-direction:column;gap:16px">
        <div style="font-size:13px;font-weight:600;color:#94A3B8">คลิกเลือกรูปที่ต้องการ:</div>
        <div id="hub-img-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px"></div>
        <div style="display:flex;gap:10px;margin-top:4px">
          <button id="hub-save-btn" onclick="hubSaveSelectedAvatar()" disabled
            style="flex:2;padding:12px;border-radius:12px;border:none;background:#64748B;color:#94A3B8;
                   font-size:15px;font-family:inherit;font-weight:700;cursor:not-allowed;transition:all .2s">
            ✅ ใช้รูปที่เลือก
          </button>
          <button onclick="hubResetToGen()"
            style="flex:1;padding:12px;border-radius:12px;border:1px solid #475569;background:transparent;
                   color:#94A3B8;font-size:14px;font-family:inherit;cursor:pointer">
            🔄 Generate ใหม่
          </button>
        </div>
        <button onclick="hubResetSvgAvatar()"
          style="width:100%;padding:8px;border-radius:8px;border:1px solid #334155;
                 background:transparent;color:#64748B;font-size:12px;font-family:inherit;cursor:pointer">
          🗑 รีเซ็ตกลับเป็นรูป SVG เดิม
        </button>
      </div>

    </div>
  </div>
</div>

<style>
@keyframes hub-spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
</style>

<script>
let _hubReloadTimer = setTimeout(() => location.reload(), 30000);

// ══ Hub Avatar Modal ══════════════════════════════════════════════
let hubAgentName = '', hubColor = '#6366F1', hubGender = 'f', hubOutfit = 'นักเรียน';
let hubSelectedImg = null, hubPollTimers = [];

function openHubAvatarModal(name, label, emoji, color) {
  clearTimeout(_hubReloadTimer); // หยุด auto-reload ระหว่าง generate
  hubAgentName = name; hubColor = color;
  document.getElementById('hub-av-title').textContent = '🎨 Generate รูปโปรไฟล์ AI';
  document.getElementById('hub-av-sub').textContent   = emoji + ' ' + label + ' — AnythingXL Anime/Manga';
  document.getElementById('hub-av-header').style.background = 'linear-gradient(135deg,' + color + 'CC,' + color + '88)';
  document.getElementById('hub-gen-btn').style.background = 'linear-gradient(135deg,' + color + ',' + color + 'CC)';
  document.getElementById('hub-load-bar').style.background = color;
  hubResetToGen();
  document.getElementById('hub-avatar-modal').style.display = 'block';
  document.body.style.overflow = 'hidden';
}
function closeHubAvatarModal() {
  document.getElementById('hub-avatar-modal').style.display = 'none';
  document.body.style.overflow = '';
  hubPollTimers.forEach(clearInterval); hubPollTimers = [];
  _hubReloadTimer = setTimeout(() => location.reload(), 30000); // resume
}
document.getElementById('hub-avatar-modal').addEventListener('click', function(e) {
  if (e.target === this) closeHubAvatarModal();
});

function hubSetGender(g) {
  hubGender = g;
  ['f','m'].forEach(v => {
    const el = document.getElementById('hub-btn-' + v);
    if (!el) return;
    const active = v === g;
    el.style.borderColor = active ? hubColor : '#475569';
    el.style.background  = active ? hubColor + '33' : 'transparent';
    el.style.color       = active ? 'white' : '#94A3B8';
  });
}
function hubSetOutfit(outfit, idx) {
  hubOutfit = outfit;
  for (let i = 0; i < 5; i++) {
    const b = document.getElementById('hub-outfit-' + i);
    if (!b) continue;
    const active = i === idx;
    b.style.borderColor = active ? hubColor : '#475569';
    b.style.background  = active ? hubColor + '22' : 'transparent';
    b.style.color       = active ? 'white' : '#94A3B8';
  }
}
function hubResetToGen() {
  hubPollTimers.forEach(clearInterval); hubPollTimers = [];
  hubSelectedImg = null;
  document.getElementById('hub-gen-options').style.display  = 'flex';
  document.getElementById('hub-gen-loading').style.display  = 'none';
  document.getElementById('hub-gen-results').style.display  = 'none';
  document.getElementById('hub-load-bar').style.width = '0%';
  hubSetGender(hubGender);
  hubSetOutfit(hubOutfit, ['นักเรียน','ออฟฟิศ','มิโค','บัตเลอร์/เมด','แนวต่อสู้'].indexOf(hubOutfit));
}

async function hubStartGenerate() {
  document.getElementById('hub-gen-options').style.display  = 'none';
  document.getElementById('hub-gen-loading').style.display  = 'block';
  document.getElementById('hub-gen-results').style.display  = 'none';
  document.getElementById('hub-load-text').textContent = 'กำลัง Generate รูป...';
  document.getElementById('hub-load-sub').textContent  = 'ส่ง job ไป ComfyUI (AnythingXL)...';
  document.getElementById('hub-load-bar').style.width  = '8%';

  let promptIds;
  try {
    const r = await fetch('/api/generate-avatar', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ gender: hubGender, outfit: hubOutfit }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'ComfyUI error');
    promptIds = j.promptIds;
  } catch(e) {
    document.getElementById('hub-load-text').textContent = '❌ ' + e.message;
    document.getElementById('hub-load-sub').textContent  = 'ตรวจสอบ ComfyUI ที่ 10.3.17.118:8188';
    return;
  }

  document.getElementById('hub-load-sub').textContent = 'รอ ComfyUI render... (ประมาณ 30-90 วิ)';
  document.getElementById('hub-load-bar').style.width = '20%';

  document.getElementById('hub-gen-results').style.display = 'flex';
  document.getElementById('hub-img-grid').innerHTML = [0,1].map(i => \`
    <div id="hub-img-slot-\${i}"
         style="aspect-ratio:1;border-radius:12px;background:#0F172A;border:2px solid #334155;
                display:flex;align-items:center;justify-content:center;cursor:pointer;
                overflow:hidden;transition:all .2s;position:relative">
      <div style="text-align:center;color:#475569">
        <div style="font-size:28px;animation:hub-spin 2s linear infinite;display:inline-block">⚙️</div>
        <div style="font-size:12px;margin-top:6px">รูปที่ \${i+1}</div>
      </div>
    </div>\`).join('');

  let doneCount = 0;
  const startTime = Date.now();

  promptIds.forEach((pid, idx) => {
    const timer = setInterval(async () => {
      try {
        const j = await (await fetch('/api/avatar-job/' + pid)).json();
        if (j.status === 'done') {
          doneCount++;
          const slot = document.getElementById('hub-img-slot-' + idx);
          if (slot) {
            slot.setAttribute('data-filename',  j.filename  || '');
            slot.setAttribute('data-subfolder', j.subfolder || '');
            slot.setAttribute('data-type',      j.type      || 'output');
            slot.onclick = () => hubSelectImageSlot(idx);
            slot.innerHTML = \`<img src="\${j.viewUrl}?t=\${Date.now()}" style="width:100%;height:100%;object-fit:cover;border-radius:10px">\`;
          }
          const pct = 20 + Math.round(doneCount / 2 * 75);
          document.getElementById('hub-load-bar').style.width = pct + '%';
          document.getElementById('hub-load-sub').textContent = doneCount + '/2 รูปเสร็จแล้ว';
          if (doneCount === 2) document.getElementById('hub-gen-loading').style.display = 'none';
          clearInterval(timer);
        } else if (j.status === 'error') {
          const slot = document.getElementById('hub-img-slot-' + idx);
          if (slot) slot.innerHTML = '<div style="color:#EF4444;font-size:12px;text-align:center">❌ Error</div>';
          clearInterval(timer);
        }
        document.getElementById('hub-load-text').textContent = 'กำลัง Generate... (' + Math.round((Date.now()-startTime)/1000) + ' วิ)';
      } catch {}
    }, 2500);
    hubPollTimers.push(timer);
  });
}

function hubSelectImageSlot(idx) {
  const slot = document.getElementById('hub-img-slot-' + idx);
  if (!slot || !slot.querySelector('img')) return;
  hubSelectedImg = {
    filename:  slot.getAttribute('data-filename')  || '',
    subfolder: slot.getAttribute('data-subfolder') || '',
    type:      slot.getAttribute('data-type')      || 'output',
  };
  for (let i = 0; i < 2; i++) {
    const s = document.getElementById('hub-img-slot-' + i);
    if (s) { s.style.borderColor = '#334155'; s.style.boxShadow = 'none'; }
  }
  slot.style.borderColor = hubColor;
  slot.style.boxShadow   = '0 0 0 4px ' + hubColor + '55';
  const saveBtn = document.getElementById('hub-save-btn');
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.style.background = 'linear-gradient(135deg,' + hubColor + ',' + hubColor + 'CC)';
    saveBtn.style.color  = 'white';
    saveBtn.style.cursor = 'pointer';
  }
}

async function hubSaveSelectedAvatar() {
  if (!hubSelectedImg) return;
  const btn = document.getElementById('hub-save-btn');
  if (btn) { btn.textContent = '💾 กำลังบันทึก...'; btn.disabled = true; }
  try {
    const r = await fetch('/api/save-avatar', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ agentName: hubAgentName, ...hubSelectedImg }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'error');
    hubShowToast('✅ บันทึกรูปโปรไฟล์เรียบร้อย!');
    document.querySelectorAll('img.card-avatar').forEach(img => {
      if (img.closest('[data-agent="' + hubAgentName + '"]')) img.src = '/avatar/' + hubAgentName + '?t=' + Date.now();
    });
    setTimeout(() => { closeHubAvatarModal(); location.reload(); }, 1000);
  } catch(e) {
    hubShowToast('❌ ' + e.message, true);
    if (btn) { btn.textContent = '✅ ใช้รูปที่เลือก'; btn.disabled = false; }
  }
}

async function hubResetSvgAvatar() {
  if (!confirm('รีเซ็ตกลับเป็นรูป SVG เดิมใช่ไหม?')) return;
  await fetch('/api/reset-avatar', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ agentName: hubAgentName }),
  });
  hubShowToast('รีเซ็ตกลับ SVG เรียบร้อย');
  closeHubAvatarModal();
  location.reload();
}

function hubShowToast(msg, err=false) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:'+(err?'#EF4444':'#1a1d27')
    +';color:white;padding:12px 20px;border-radius:10px;font-size:14px;z-index:99999;border:1px solid rgba(255,255,255,0.15)';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

// ── ComfyUI GPU queue poll (ทุก 4s) ──
function fmtAgo(since){const s=Math.max(0,Math.round((Date.now()-since)/1000));return s>=60?Math.floor(s/60)+' นาที':s+' วิ';}
async function pollGpuQueue(){
  try{
    const q=await fetch('/api/gpu-queue').then(r=>r.json());
    const el=document.getElementById('gpu-queue-body');if(!el)return;
    if(!q.holder){el.innerHTML='<span style="color:#22c55e">● ว่าง</span>';return;}
    let h='<span style="color:#fbbf24">● รัน:</span> <b style="color:#e2e8f0">'+q.holder.agent+'</b> <span style="color:#64748B">('+fmtAgo(q.holder.since)+')</span>';
    if(q.waiters&&q.waiters.length){h+=' &nbsp;<span style="color:#64748B">รอ ('+q.waiters.length+'):</span> '+q.waiters.map(w=>'<span style="color:#a855f7">'+w.agent+'</span>').join(', ');}
    el.innerHTML=h;
  }catch{}
}
pollGpuQueue();setInterval(pollGpuQueue,4000);
</script>
</body>
</html>`;
}

function buildAgentPage(name, status, AGENTS, ROOT, readLog) {
  const cfg = AGENTS[name];
  if (!cfg) return '<h1>ไม่พบ Agent</h1>';
  const st   = status[name] || {};
  const logs = readLog(name, 80);

  const logsHtml = logs.length
    ? logs.map(l => {
        const color = l.includes('✅') ? '#10B981' : l.includes('❌') ? '#EF4444' : l.includes('⚠️') ? '#F59E0B' : '#374151';
        return `<div style="color:${color};font-size:12.5px;line-height:1.6;padding:1px 0">${escHtml(l)}</div>`;
      }).join('')
    : '<div style="color:#9CA3AF;font-size:13px">ยังไม่มี log</div>';

  const actionBtns = cfg.actions.map(a => `
    <button onclick="runAction('${name}','${a.id}')"
            style="background:${cfg.color};color:white;border:none;padding:10px 18px;border-radius:10px;
                   cursor:pointer;font-size:14px;font-family:inherit;font-weight:600;
                   display:flex;align-items:center;gap:6px;transition:opacity 0.2s"
            onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
      ${a.icon} ${a.label}
    </button>`).join('');

  const lastRun = st.lastRun ? new Date(st.lastRun).toLocaleString('th-TH') : '—';

  // Dashboard tab button (only for mali and manao)
  const dashTab = cfg.hasDashboard
    ? `<button id="tab-dashboard" onclick="switchTab('dashboard')"
         style="padding:12px 20px;border:none;background:transparent;cursor:pointer;font-size:14px;
                font-family:inherit;font-weight:600;color:#9CA3AF;border-bottom:3px solid transparent;transition:all 0.2s">
         📊 Dashboard
       </button>` : '';

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${cfg.label} — Agent Hub</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800&display=swap');
  *{font-family:'Sarabun',sans-serif;box-sizing:border-box;margin:0;padding:0}
  body{background:#F8FAFC;min-height:100vh}
  .log-box{background:#0F172A;border-radius:12px;padding:16px;height:380px;overflow-y:auto;font-family:'Courier New',monospace}
  .log-box::-webkit-scrollbar{width:6px}
  .log-box::-webkit-scrollbar-track{background:#1E293B}
  .log-box::-webkit-scrollbar-thumb{background:#475569;border-radius:3px}
</style>
</head>
<body>
<!-- Header -->
<div style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;padding:16px 28px;display:flex;align-items:center;gap:16px;box-shadow:0 4px 20px rgba(0,0,0,0.2)">
  <a href="/" style="color:white;text-decoration:none;font-size:22px;opacity:0.7" title="กลับ">←</a>
  <div style="position:relative;cursor:pointer" onclick="openAvatarModal()" title="เปลี่ยนรูปโปรไฟล์">
    <img id="agent-avatar" src="/avatar/${name}?t=${Date.now()}" style="width:44px;height:44px;border-radius:50%;border:2px solid ${cfg.color};object-fit:cover" onerror="this.style.display='none'">
    <div style="position:absolute;bottom:-2px;right:-2px;width:18px;height:18px;background:${cfg.color};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;border:2px solid #1a1a2e">🎨</div>
  </div>
  <div>
    <div style="font-size:18px;font-weight:800">${cfg.emoji} ${cfg.label}</div>
    <div style="font-size:12px;color:#94A3B8">${cfg.role}</div>
  </div>
  <div style="margin-left:auto;display:flex;align-items:center;gap:10px">
    ${statusBadge(st.status || 'idle')}
    <button onclick="openAvatarModal()"
      style="background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.25);color:white;
             padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-family:inherit;
             display:flex;align-items:center;gap:5px"
      onmouseover="this.style.background='rgba(255,255,255,0.2)'"
      onmouseout="this.style.background='rgba(255,255,255,0.12)'">
      🎨 เปลี่ยนรูป
    </button>
  </div>
</div>

<!-- ════ Avatar Generator Modal ════ -->
<div id="avatar-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;overflow-y:auto;padding:20px">
  <div style="max-width:680px;margin:0 auto;background:#1E293B;border-radius:20px;overflow:hidden;box-shadow:0 25px 60px rgba(0,0,0,0.5)">

    <!-- Modal Header -->
    <div style="background:linear-gradient(135deg,${cfg.color}CC,${cfg.color}88);padding:20px 24px;display:flex;align-items:center;justify-content:space-between">
      <div>
        <div style="font-size:18px;font-weight:800;color:white">🎨 Generate รูปโปรไฟล์ AI</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.75);margin-top:2px">${cfg.emoji} ${cfg.label} — AnythingXL Anime/Manga</div>
      </div>
      <button onclick="closeAvatarModal()" style="background:rgba(255,255,255,0.15);border:none;color:white;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center">✕</button>
    </div>

    <!-- Modal Body -->
    <div style="padding:24px;display:flex;flex-direction:column;gap:20px">

      <!-- Step 1: Options -->
      <div id="gen-options" style="display:flex;flex-direction:column;gap:16px">

        <!-- Gender -->
        <div>
          <div style="font-size:13px;font-weight:600;color:#94A3B8;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">เพศตัวละคร</div>
          <div style="display:flex;gap:10px">
            <button id="btn-gender-f" onclick="setGender('f')"
              style="flex:1;padding:12px;border-radius:12px;border:2px solid ${cfg.color};background:${cfg.color}22;
                     color:white;cursor:pointer;font-size:16px;font-family:inherit;font-weight:700;transition:all 0.2s">
              ♀ หญิง
            </button>
            <button id="btn-gender-m" onclick="setGender('m')"
              style="flex:1;padding:12px;border-radius:12px;border:2px solid #475569;background:transparent;
                     color:#94A3B8;cursor:pointer;font-size:16px;font-family:inherit;font-weight:700;transition:all 0.2s">
              ♂ ชาย
            </button>
          </div>
        </div>

        <!-- Outfit -->
        <div>
          <div style="font-size:13px;font-weight:600;color:#94A3B8;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">การแต่งตัว</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
            ${['นักเรียน','ออฟฟิศ','มิโค','บัตเลอร์/เมด','แนวต่อสู้'].map((outfit, i) => {
              const icons = ['🎒','💼','⛩️','🎩','⚔️'];
              return `<button id="btn-outfit-${i}" data-outfit="${outfit}" onclick="setOutfit('${outfit}',${i})"
                style="padding:10px 8px;border-radius:10px;border:2px solid ${i===0?cfg.color:'#475569'};
                       background:${i===0?cfg.color+'22':'transparent'};color:${i===0?'white':'#94A3B8'};
                       cursor:pointer;font-size:13px;font-family:inherit;font-weight:600;transition:all 0.2s;
                       display:flex;flex-direction:column;align-items:center;gap:4px">
                <span style="font-size:20px">${icons[i]}</span>${outfit}
              </button>`;
            }).join('')}
          </div>
        </div>

        <!-- Generate button -->
        <button id="gen-btn" onclick="startGenerate()"
          style="width:100%;padding:14px;border-radius:12px;border:none;
                 background:linear-gradient(135deg,${cfg.color},${cfg.color}CC);
                 color:white;font-size:16px;font-family:inherit;font-weight:700;
                 cursor:pointer;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:8px"
          onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
          ✨ Generate 2 รูป
        </button>
      </div>

      <!-- Step 2: Loading -->
      <div id="gen-loading" style="display:none;text-align:center;padding:20px 0">
        <div style="font-size:40px;margin-bottom:12px;animation:spin 2s linear infinite;display:inline-block">⚙️</div>
        <div style="font-size:15px;color:#E2E8F0;font-weight:600" id="load-text">กำลัง Generate รูป...</div>
        <div style="margin-top:12px;background:#0F172A;border-radius:999px;height:6px;overflow:hidden">
          <div id="load-bar" style="height:6px;background:${cfg.color};border-radius:999px;width:0%;transition:width 0.5s"></div>
        </div>
        <div style="font-size:12px;color:#64748B;margin-top:6px" id="load-sub">ส่ง job ไป ComfyUI...</div>
      </div>

      <!-- Step 3: Results grid -->
      <div id="gen-results" style="display:none;flex-direction:column;gap:16px">
        <div style="font-size:13px;font-weight:600;color:#94A3B8">คลิกเลือกรูปที่ต้องการ:</div>
        <div id="img-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px"></div>
        <div style="display:flex;gap:10px;margin-top:4px">
          <button id="save-btn" onclick="saveSelectedAvatar()" disabled
            style="flex:2;padding:12px;border-radius:12px;border:none;
                   background:#64748B;color:#94A3B8;
                   font-size:15px;font-family:inherit;font-weight:700;cursor:not-allowed;transition:all 0.2s">
            ✅ ใช้รูปที่เลือก
          </button>
          <button onclick="resetToGen()"
            style="flex:1;padding:12px;border-radius:12px;border:1px solid #475569;
                   background:transparent;color:#94A3B8;font-size:14px;font-family:inherit;cursor:pointer">
            🔄 Generate ใหม่
          </button>
        </div>
        <button onclick="resetSvgAvatar()"
          style="width:100%;padding:8px;border-radius:8px;border:1px solid #334155;
                 background:transparent;color:#64748B;font-size:12px;font-family:inherit;cursor:pointer">
          🗑 รีเซ็ตกลับเป็นรูป SVG เดิม
        </button>
      </div>

    </div>
  </div>
</div>

<style>
@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
@keyframes fadeIn { from{opacity:0;transform:scale(0.95)} to{opacity:1;transform:scale(1)} }
</style>

<!-- Tab bar -->
<div style="background:white;border-bottom:1px solid #E5E7EB;padding:0 28px;display:flex;gap:0">
  <button id="tab-control" onclick="switchTab('control')"
    style="padding:12px 20px;border:none;background:transparent;cursor:pointer;font-size:14px;
           font-family:inherit;font-weight:600;color:${cfg.color};border-bottom:3px solid ${cfg.color};transition:all 0.2s">
    ⚡ Control
  </button>
  ${dashTab}
</div>

<!-- Control Panel -->
<div id="panel-control" style="display:block">
  <div style="max-width:960px;margin:24px auto;padding:0 20px;display:grid;grid-template-columns:1fr 1fr;gap:20px">

    <!-- Left: Actions + Info -->
    <div style="display:flex;flex-direction:column;gap:16px">
      <div style="background:white;border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,0.06)">
        <h3 style="font-size:15px;font-weight:700;color:#374151;margin-bottom:14px">⚡ Actions</h3>
        <div style="display:flex;flex-wrap:wrap;gap:10px">${actionBtns}</div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button onclick="stopAgent('${name}')"
                  style="background:#FEF2F2;color:#EF4444;border:1px solid #FCA5A5;padding:8px 16px;
                         border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;font-weight:600">
            ⏹ หยุด
          </button>
          <button onclick="restartAgent('${name}')"
                  style="background:#FFFBEB;color:#F59E0B;border:1px solid #FCD34D;padding:8px 16px;
                         border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;font-weight:600">
            🔄 Restart
          </button>
          ${(name === 'namkhao') ? `
          <button onclick="restartTelegramBot()" id="tg-restart-btn"
                  style="background:#1565C0;color:white;border:none;padding:8px 16px;
                         border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;font-weight:600">
            🤖 Restart น้ำข้าว Bot
          </button>` : ''}
        </div>
      </div>
      <div style="background:white;border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,0.06)">
        <h3 style="font-size:15px;font-weight:700;color:#374151;margin-bottom:14px">📋 สถานะ</h3>
        <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;color:#6B7280">
          <div style="display:flex;justify-content:space-between"><span>สถานะ</span><span id="cur-status" style="font-weight:600">${st.status||'idle'}</span></div>
          <div style="display:flex;justify-content:space-between"><span>Action ปัจจุบัน</span><span id="cur-action">${st.currentAction||'—'}</span></div>
          <div style="display:flex;justify-content:space-between"><span>รันล่าสุด</span><span>${lastRun}</span></div>
          <div style="display:flex;justify-content:space-between"><span>ผลล่าสุด</span>
            <span style="max-width:180px;text-align:right;color:#374151" id="cur-result">${escHtml((st.lastResult||'—').substring(0,40))}</span></div>
          <div style="display:flex;justify-content:space-between"><span>PID</span><span id="cur-pid">${st.pid||'—'}</span></div>
        </div>
      </div>
    </div>

    <!-- Right: Live Log -->
    <div style="background:white;border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,0.06)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="font-size:15px;font-weight:700;color:#374151">📜 Live Log</h3>
        <span id="log-count" style="font-size:12px;color:#9CA3AF">${logs.length} บรรทัด</span>
      </div>
      <div class="log-box" id="log-container">${logsHtml}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
        <label style="font-size:12px;color:#9CA3AF;display:flex;align-items:center;gap:4px">
          <input type="checkbox" id="auto-scroll" checked> Auto scroll
        </label>
        <button onclick="clearLog()" style="font-size:12px;color:#9CA3AF;background:none;border:none;cursor:pointer">🗑 ล้าง log</button>
      </div>
    </div>
  </div>
</div>

<!-- Dashboard Panel (iframe) -->
<div id="panel-dashboard" style="display:none">
  <iframe id="dash-frame" src="" style="width:100%;height:calc(100vh - 110px);border:none;display:block"></iframe>
</div>

<script>
const agentName   = '${name}';
const agentColor  = '${cfg.color}';
const hasDash     = ${cfg.hasDashboard};
let lastLogCount  = ${logs.length};
let currentTab    = hasDash ? 'dashboard' : 'control';

function switchTab(tab) {
  currentTab = tab;
  // panels
  document.getElementById('panel-control').style.display   = tab === 'control' ? 'block' : 'none';
  document.getElementById('panel-dashboard').style.display = tab === 'dashboard' ? 'block' : 'none';
  // tab styles
  const tabs = ['control', 'dashboard'];
  tabs.forEach(t => {
    const el = document.getElementById('tab-' + t);
    if (!el) return;
    if (t === tab) {
      el.style.color = agentColor;
      el.style.borderBottom = '3px solid ' + agentColor;
    } else {
      el.style.color = '#9CA3AF';
      el.style.borderBottom = '3px solid transparent';
    }
  });
  // load iframe on first switch to dashboard
  if (tab === 'dashboard') {
    const iframe = document.getElementById('dash-frame');
    if (!iframe.src || iframe.src === window.location.href) {
      iframe.src = '/dashboard/' + agentName;
    }
  }
}

async function runAction(name, action) {
  const r = await fetch('/api/agent/'+name+'/start', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ action })
  });
  const j = await r.json();
  if (j.ok) showToast('เริ่ม action: '+action);
  else showToast('❌ '+j.error, true);
  setTimeout(refreshStatus, 800);
}

async function stopAgent(name) {
  await fetch('/api/agent/'+name+'/stop', { method:'POST' });
  showToast('⏹ หยุด Agent แล้ว');
  setTimeout(refreshStatus, 500);
}

async function restartAgent(name) {
  await fetch('/api/agent/'+name+'/stop', { method:'POST' });
  await new Promise(r => setTimeout(r, 600));
  await fetch('/api/agent/'+name+'/start', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ action: 'status' })
  });
  showToast('🔄 Restart สำเร็จ');
  setTimeout(refreshStatus, 800);
}

async function restartTelegramBot() {
  const btn = document.getElementById('tg-restart-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลัง restart...'; }
  try {
    const r = await fetch('/api/telegram/restart', { method: 'POST' });
    const j = await r.json();
    if (j.ok) showToast('🤖 Telegram Bot restart สำเร็จ (PID: ' + j.pid + ')');
    else      showToast('❌ ' + (j.error || 'เกิดข้อผิดพลาด'));
  } catch (e) {
    showToast('❌ ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 Restart Telegram Bot'; }
  }
}

async function clearLog() {
  await fetch('/api/agent/'+agentName+'/clear-log', { method:'POST' });
  document.getElementById('log-container').innerHTML = '<div style="color:#9CA3AF;font-size:13px">Log ถูกล้างแล้ว</div>';
}

async function refreshLog() {
  if (currentTab !== 'control') return;
  const r = await fetch('/api/agent/'+agentName+'/logs');
  const j = await r.json();
  if (!j.lines || j.lines.length === lastLogCount) return;
  lastLogCount = j.lines.length;
  const box = document.getElementById('log-container');
  box.innerHTML = j.lines.map(l => {
    const color = l.includes('✅') ? '#10B981' : l.includes('❌') ? '#EF4444' : l.includes('⚠️') ? '#F59E0B' : '#CBD5E1';
    return '<div style="color:'+color+';font-size:12.5px;line-height:1.6;padding:1px 0">'+escHtml(l)+'</div>';
  }).join('');
  document.getElementById('log-count').textContent = j.lines.length + ' บรรทัด';
  if (document.getElementById('auto-scroll')?.checked) box.scrollTop = box.scrollHeight;
}

async function refreshStatus() {
  const r = await fetch('/api/status');
  const j = await r.json();
  const st = j[agentName] || {};
  document.getElementById('cur-status').textContent = st.status || 'idle';
  document.getElementById('cur-action').textContent = st.currentAction || '—';
  document.getElementById('cur-result').textContent = (st.lastResult||'—').substring(0,40);
  document.getElementById('cur-pid').textContent = st.pid || '—';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showToast(msg, err=false) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;top:20px;right:20px;background:'+(err?'#EF4444':'#1a1a2e')
    +';color:white;padding:12px 20px;border-radius:10px;font-size:14px;z-index:9999;transition:opacity 0.5s';
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; setTimeout(() => t.remove(), 500); }, 2500);
}

window.addEventListener('load', () => {
  const box = document.getElementById('log-container');
  if (box) box.scrollTop = box.scrollHeight;
  // auto-open avatar modal ถ้า URL มี #avatar
  if (location.hash === '#avatar') openAvatarModal();
  // default tab: dashboard ถ้า hasDashboard, ไม่งั้น control
  switchTab(currentTab);
});
setInterval(refreshLog, 2000);
setInterval(refreshStatus, 3000);

// ══════════════════════════════════════════════
//  Avatar Generator Modal
// ══════════════════════════════════════════════

const AGENT_NAME_FOR_AVATAR = '${name}';
const AGENT_COLOR_VAR = '${cfg.color}';

let selectedGender  = 'f';
let selectedOutfit  = 'นักเรียน';
let selectedImgData = null;
let pollTimers      = [];
let _genResults     = [null, null, null, null];

function openAvatarModal() {
  document.getElementById('avatar-modal').style.display = 'block';
  document.body.style.overflow = 'hidden';
  resetToGen();
}
function closeAvatarModal() {
  document.getElementById('avatar-modal').style.display = 'none';
  document.body.style.overflow = '';
  pollTimers.forEach(clearInterval);
  pollTimers = [];
}
function setGender(g) {
  selectedGender = g;
  ['f','m'].forEach(v => {
    const el = document.getElementById('btn-gender-'+v);
    if (!el) return;
    const active = v === g;
    el.style.borderColor = active ? AGENT_COLOR_VAR : '#475569';
    el.style.background  = active ? AGENT_COLOR_VAR + '33' : 'transparent';
    el.style.color       = active ? 'white' : '#94A3B8';
  });
}
function setOutfit(outfit, idx) {
  selectedOutfit = outfit;
  for (let i = 0; i < 5; i++) {
    const b = document.getElementById('btn-outfit-'+i);
    if (!b) continue;
    const active = i === idx;
    b.style.borderColor = active ? AGENT_COLOR_VAR : '#475569';
    b.style.background  = active ? AGENT_COLOR_VAR + '33' : 'transparent';
    b.style.color       = active ? 'white' : '#94A3B8';
  }
}
function resetToGen() {
  pollTimers.forEach(clearInterval);
  pollTimers = [];
  selectedImgData = null;
  _genResults = [null, null, null, null];
  document.getElementById('gen-options').style.display  = 'flex';
  document.getElementById('gen-loading').style.display  = 'none';
  document.getElementById('gen-results').style.display  = 'none';
  document.getElementById('load-bar').style.width = '0%';
  // re-apply active states
  setGender(selectedGender);
}

async function startGenerate() {
  document.getElementById('gen-options').style.display  = 'none';
  document.getElementById('gen-loading').style.display  = 'block';
  document.getElementById('gen-results').style.display  = 'none';
  document.getElementById('load-text').textContent = 'กำลัง Generate รูป...';
  document.getElementById('load-sub').textContent  = 'ส่ง job ไป ComfyUI (AnythingXL)...';
  document.getElementById('load-bar').style.width  = '8%';

  let promptIds;
  try {
    const r = await fetch('/api/generate-avatar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gender: selectedGender, outfit: selectedOutfit }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'ComfyUI error');
    promptIds = j.promptIds;
  } catch(e) {
    document.getElementById('load-text').textContent = '❌ ' + e.message;
    document.getElementById('load-sub').textContent  = 'ตรวจสอบ ComfyUI ที่ 10.3.17.118:8188';
    return;
  }

  document.getElementById('load-sub').textContent = 'รอ ComfyUI render... (ประมาณ 30-90 วิ)';
  document.getElementById('load-bar').style.width = '20%';

  // Show grid with placeholders immediately
  document.getElementById('gen-results').style.display = 'flex';
  document.getElementById('img-grid').innerHTML = [0,1].map(i => \`
    <div id="img-slot-\${i}"
         style="aspect-ratio:1;border-radius:12px;background:#0F172A;border:2px solid #334155;
                display:flex;align-items:center;justify-content:center;cursor:pointer;
                overflow:hidden;transition:all 0.2s;position:relative">
      <div style="text-align:center;color:#475569">
        <div style="font-size:28px;animation:spin 2s linear infinite;display:inline-block">⚙️</div>
        <div style="font-size:12px;margin-top:6px">รูปที่ \${i+1}</div>
      </div>
    </div>\`).join('');

  let doneCount = 0;
  const startTime = Date.now();

  promptIds.forEach((pid, idx) => {
    const timer = setInterval(async () => {
      try {
        const j = await (await fetch('/api/avatar-job/' + pid)).json();
        if (j.status === 'done') {
          _genResults[idx] = j;
          doneCount++;
          const slot = document.getElementById('img-slot-'+idx);
          if (slot) {
            slot.setAttribute('data-filename',  j.filename  || '');
            slot.setAttribute('data-subfolder', j.subfolder || '');
            slot.setAttribute('data-type',      j.type      || 'output');
            slot.onclick = () => selectImageSlot(idx);
            slot.innerHTML = \`<img src="\${j.viewUrl}?t=\${Date.now()}" style="width:100%;height:100%;object-fit:cover;border-radius:10px">\`;
          }
          const pct = 20 + Math.round(doneCount / 2 * 75);
          document.getElementById('load-bar').style.width = pct + '%';
          document.getElementById('load-sub').textContent = doneCount + '/2 รูปเสร็จแล้ว';
          if (doneCount === 2) document.getElementById('gen-loading').style.display = 'none';
          clearInterval(timer);
        } else if (j.status === 'error') {
          const slot = document.getElementById('img-slot-'+idx);
          if (slot) slot.innerHTML = '<div style="color:#EF4444;font-size:12px;text-align:center">❌ Error</div>';
          clearInterval(timer);
        }
        const sec = Math.round((Date.now()-startTime)/1000);
        document.getElementById('load-text').textContent = 'กำลัง Generate... (' + sec + ' วิ)';
      } catch(e2) {}
    }, 2500);
    pollTimers.push(timer);
  });
}

function selectImageSlot(idx) {
  const slot = document.getElementById('img-slot-'+idx);
  if (!slot) return;
  const img = slot.querySelector('img');
  if (!img) { showToast('รูปยังโหลดไม่เสร็จ', true); return; }

  selectedImgData = {
    filename:  slot.getAttribute('data-filename')  || '',
    subfolder: slot.getAttribute('data-subfolder') || '',
    type:      slot.getAttribute('data-type')      || 'output',
  };

  // highlight selected
  for (let i = 0; i < 2; i++) {
    const s = document.getElementById('img-slot-'+i);
    if (s) { s.style.borderColor = '#334155'; s.style.boxShadow = 'none'; }
  }
  slot.style.borderColor = AGENT_COLOR_VAR;
  slot.style.boxShadow   = '0 0 0 4px ' + AGENT_COLOR_VAR + '55';

  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.style.background = 'linear-gradient(135deg,' + AGENT_COLOR_VAR + ',' + AGENT_COLOR_VAR + 'CC)';
    saveBtn.style.color  = 'white';
    saveBtn.style.cursor = 'pointer';
  }
}

async function saveSelectedAvatar() {
  if (!selectedImgData || !selectedImgData.filename) { showToast('เลือกรูปก่อน', true); return; }
  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) { saveBtn.textContent = '💾 กำลังบันทึก...'; saveBtn.disabled = true; }
  try {
    const r = await fetch('/api/save-avatar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: AGENT_NAME_FOR_AVATAR, ...selectedImgData }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Save error');
    showToast('✅ บันทึกรูปโปรไฟล์เรียบร้อย!');
    const av = document.getElementById('agent-avatar');
    if (av) av.src = '/avatar/' + AGENT_NAME_FOR_AVATAR + '?t=' + Date.now();
    setTimeout(closeAvatarModal, 1200);
  } catch(e) {
    showToast('❌ ' + e.message, true);
    if (saveBtn) { saveBtn.textContent = '✅ ใช้รูปที่เลือก'; saveBtn.disabled = false; }
  }
}

async function resetSvgAvatar() {
  if (!confirm('รีเซ็ตกลับเป็นรูป SVG เดิมใช่ไหม?')) return;
  await fetch('/api/reset-avatar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentName: AGENT_NAME_FOR_AVATAR }),
  });
  const av = document.getElementById('agent-avatar');
  if (av) av.src = '/avatar/' + AGENT_NAME_FOR_AVATAR + '?t=' + Date.now();
  showToast('รีเซ็ตกลับ SVG เรียบร้อย');
  closeAvatarModal();
}

// Close on backdrop click
document.getElementById('avatar-modal').addEventListener('click', function(e) {
  if (e.target === this) closeAvatarModal();
});
</script>
</body>
</html>`;
}
module.exports = { escHtml, statusBadge, buildMainPage, buildAgentPage };
