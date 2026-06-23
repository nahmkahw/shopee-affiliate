'use strict';
// layout-header.js — header, status bar, agent hub, chart
function getLayoutHeader() {
  return `
</head>
<body>

<!-- Header -->
<div class="header">
  <div class="header-left">
    <div>
      <div class="header-title">🍋 มะนาว — Agent Hub</div>
      <div class="header-subtitle">Reuters AI News Pipeline · 4 Agents</div>
    </div>
  </div>
  <div class="refresh-info">
    <span id="last-updated">กำลังโหลด...</span>
    <button class="btn" onclick="loadData(true)" id="refresh-btn">
      <span id="refresh-icon">🔄</span> รีเฟรช
    </button>
    <button class="btn" onclick="showLog()">📋 Log</button>
  </div>
</div>

<div class="main">

  <!-- Status bar -->
  <div class="status-bar" id="status-bar">
    <div class="status-pill">
      <div class="dot dot-yellow dot-pulse" id="bot-dot"></div>
      <span id="bot-status-text">กำลังโหลด...</span>
    </div>
    <div class="status-pill">
      <span>⏰ Pipeline ล่าสุด: <b id="last-run-text">—</b></span>
    </div>
    <div class="status-pill">
      <span>⏭ รันถัดไป: <b id="next-run-text">—</b></span>
    </div>
  </div>

  <!-- Stats cards -->
  <div class="stats-grid" id="stats-grid">
    <div class="stat-card">
      <div class="stat-label">ทั้งหมด</div>
      <div class="stat-value total" id="stat-total">—</div>
      <div class="stat-sub">ข่าวทั้งหมดในระบบ</div>
    </div>
    <div class="stat-card" style="cursor:pointer" onclick="setFilter('pending_approval')">
      <div class="stat-label">รอ Approve</div>
      <div class="stat-value pending" id="stat-pending">—</div>
      <div class="stat-sub">รอกด ✅ ใน Telegram</div>
    </div>
    <div class="stat-card" style="cursor:pointer" onclick="setFilter('scheduled')">
      <div class="stat-label">Scheduled</div>
      <div class="stat-value sched" id="stat-scheduled">—</div>
      <div class="stat-sub">รอโพสต์ตามเวลา</div>
    </div>
    <div class="stat-card" style="cursor:pointer" onclick="setFilter('posted')">
      <div class="stat-label">โพสต์แล้ว</div>
      <div class="stat-value posted" id="stat-posted">—</div>
      <div class="stat-sub">เผยแพร่บน Facebook</div>
    </div>
    <div class="stat-card" style="cursor:pointer" onclick="setFilter('draft')">
      <div class="stat-label">Draft</div>
      <div class="stat-value draft" id="stat-draft">—</div>
      <div class="stat-sub">Content พร้อม, ยังไม่ส่ง</div>
    </div>
    <div class="stat-card" style="cursor:pointer" onclick="setFilter('scraped')">
      <div class="stat-label">Scraped</div>
      <div class="stat-value scraped" id="stat-scraped">—</div>
      <div class="stat-sub">ดึงมาแล้ว ยังไม่สร้าง content</div>
    </div>
  </div>

  <!-- Agent Hub -->
  <div class="card" style="margin-bottom:24px">
    <div class="card-title">🍋 มะนาว — Agent Hub
      <span id="pipeline-running-badge" style="display:none;margin-left:8px;font-size:10px;background:rgba(108,138,255,0.15);border:1px solid var(--accent);border-radius:10px;padding:2px 8px;color:var(--accent);font-weight:700;animation:pulse 1.5s infinite">กำลังรัน...</span>
    </div>

    <!-- Pipeline Builder -->
    <div class="pipeline-builder">
      <div class="pipeline-builder-label">เลือก Agent ที่ต้องการรัน:</div>
      <div class="pipeline-checks">
        <label class="agent-check checked" id="check-scrape">
          <input type="checkbox" checked onchange="toggleAgentCheck('scrape',this)"> 📡 Agent 1 Scrape
        </label>
        <label class="agent-check checked" id="check-filter">
          <input type="checkbox" checked onchange="toggleAgentCheck('filter',this)"> 🔍 Agent 2 Filter
        </label>
        <label class="agent-check checked" id="check-editor">
          <input type="checkbox" checked onchange="toggleAgentCheck('editor',this)"> ✏️ Agent 3 Editor
        </label>
        <label class="agent-check checked" id="check-formatter">
          <input type="checkbox" checked onchange="toggleAgentCheck('formatter',this)"> 📐 Agent 4 Formatter
        </label>
        <label class="agent-check agent-check-post" id="check-post">
          <input type="checkbox" onchange="toggleAgentCheck('post',this)"> 🚀 Post (FB+IG)
        </label>
      </div>
      <button class="btn-run-pipeline" id="btn-run-pipeline" onclick="runPipeline()">
        🍋 รัน Pipeline ที่เลือก
      </button>
    </div>

    <!-- Pipeline Status Panel -->
    <div class="pipeline-status-panel" id="pipeline-status-panel" style="display:none">
      <!-- Step list -->
      <div class="pipeline-steps" id="pipeline-steps"></div>
      <!-- Log toggle + panel -->
      <div class="log-toggle-bar" id="log-toggle-bar" onclick="togglePipelineLog()">
        <span>📋 Log</span>
        <span id="log-toggle-arrow">▾</span>
      </div>
      <div class="pipeline-log-panel" id="pipeline-log-panel" style="display:none">
        <pre id="pipeline-log-content" style="margin:0;white-space:pre-wrap;word-break:break-all"></pre>
      </div>
    </div>

    <div class="pipeline-divider">รัน Agent แยกตัว</div>

    <!-- Individual Agent Cards -->
    <div class="agent-hub" id="agent-hub-grid">
      <!-- filled by JS -->
    </div>
  </div>

  <!-- 📋 Live Pipeline Log -->
  <div class="card" style="margin-bottom:24px">
    <div class="card-title">
      <div class="live-log-header">
        <span>📋 Live Pipeline Log</span>
        <span id="live-log-badge" class="live-log-badge idle">⚫ Idle</span>
        <span id="live-log-mtime" class="live-log-mtime">—</span>
        <button class="btn" id="live-log-pause-btn" onclick="toggleLiveLog()" style="margin-left:8px;font-size:11px;padding:3px 10px;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text-dim);border-radius:6px;cursor:pointer">⏸ หยุด</button>
      </div>
    </div>
    <div class="live-log-body" id="live-log-body"></div>
  </div>

  <!-- ⚙️ Config: Filter & Formatter -->
  <div class="card" style="margin-bottom:24px">
    <div class="card-title">⚙️ ตั้งค่า Filter &amp; Formatter
      <span id="config-saved-badge" style="display:none;margin-left:8px;font-size:10px;background:rgba(52,211,153,0.15);border:1px solid #34d399;border-radius:10px;padding:2px 8px;color:#34d399;font-weight:700">บันทึกแล้ว ✓</span>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">

      <!-- ── ส่วน Filter ── -->
      <div style="border:1px solid var(--border,#30363d);border-radius:10px;padding:16px">
        <div style="font-weight:700;margin-bottom:12px">🔍 Filter (การให้คะแนน)</div>

        <label class="cfg-label">เกณฑ์ผ่าน/ไม่ผ่าน (minScore)</label>
        <input type="number" id="cfg-min-score" class="cfg-input" min="0" max="100">

        <div class="cfg-label" style="margin-top:12px">น้ำหนักคะแนน keyword</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          <div><span class="cfg-sub">HIGH</span><input type="number" id="cfg-w-high"   class="cfg-input"></div>
          <div><span class="cfg-sub">MEDIUM</span><input type="number" id="cfg-w-medium" class="cfg-input"></div>
          <div><span class="cfg-sub">LOW (ลบ)</span><input type="number" id="cfg-w-low"  class="cfg-input"></div>
        </div>

        <div class="cfg-label" style="margin-top:12px">เส้นแบ่ง Label</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          <div><span class="cfg-sub">ai_tech ≥</span><input type="number" id="cfg-l-tech"   class="cfg-input"></div>
          <div><span class="cfg-sub">ai_biz ≥</span><input type="number" id="cfg-l-biz"    class="cfg-input"></div>
          <div><span class="cfg-sub">ai_policy ≥</span><input type="number" id="cfg-l-policy" class="cfg-input"></div>
        </div>

        <label class="cfg-label" style="margin-top:12px">Keywords HIGH (×น้ำหนัก HIGH) — คั่นด้วย , หรือขึ้นบรรทัดใหม่</label>
        <textarea id="cfg-kw-high" class="cfg-input cfg-area"></textarea>
        <label class="cfg-label">Keywords MEDIUM</label>
        <textarea id="cfg-kw-medium" class="cfg-input cfg-area"></textarea>
        <label class="cfg-label">Keywords LOW (ลดคะแนน)</label>
        <textarea id="cfg-kw-low" class="cfg-input cfg-area"></textarea>
      </div>

      <!-- ── ส่วน Formatter ── -->
      <div style="border:1px solid var(--border,#30363d);border-radius:10px;padding:16px">
        <div style="font-weight:700;margin-bottom:12px">📐 Formatter (ข้ามข่าว)</div>

        <label class="cfg-label">ข้ามข่าวที่มีสถานะ (skipStatus)</label>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px">
          <label class="cfg-check"><input type="checkbox" id="cfg-skip-posted">    posted (โพสต์แล้ว)</label>
          <label class="cfg-check"><input type="checkbox" id="cfg-skip-scheduled"> scheduled (ตั้งเวลาแล้ว)</label>
          <label class="cfg-check"><input type="checkbox" id="cfg-skip-draft">     draft (ร่างแล้ว)</label>
        </div>

        <label class="cfg-label" style="margin-top:14px">ข้ามข่าว filter_score ต่ำกว่า (minScore)</label>
        <input type="number" id="cfg-fmt-min-score" class="cfg-input" min="0" max="100">
        <div class="cfg-sub" style="margin-top:4px">ตั้ง 0 = ไม่กรองด้วยคะแนน</div>

        <label class="cfg-label" style="margin-top:14px">ข้าม Platform (ไม่สร้าง content)</label>
        <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:4px">
          <label class="cfg-check"><input type="checkbox" id="cfg-skip-fb">     📘 Facebook</label>
          <label class="cfg-check"><input type="checkbox" id="cfg-skip-ig">     📸 Instagram</label>
          <label class="cfg-check"><input type="checkbox" id="cfg-skip-x">      ✖ X</label>
          <label class="cfg-check"><input type="checkbox" id="cfg-skip-tiktok"> 🎵 TikTok</label>
        </div>
        <div class="cfg-sub" style="margin-top:4px">ติ๊ก = ข้าม (ไม่สร้างไฟล์ของ platform นั้น)</div>
      </div>
    </div>

    <div style="display:flex;gap:10px;margin-top:16px;align-items:center">
      <button class="btn-run-pipeline" style="max-width:200px" onclick="saveConfig()">💾 บันทึกค่าตั้ง</button>
      <button class="btn-run-pipeline" style="max-width:160px;background:var(--surface2,#21262d)" onclick="loadConfigUI()">↺ โหลดใหม่</button>
      <span id="config-msg" style="font-size:12px;color:var(--text-dim,#8892a4)"></span>
    </div>
  </div>

  <!-- Chart + Info -->
  <div class="row-2">
    <!-- Bar Chart -->
    <div class="card">
      <div class="card-title">📈 สัดส่วนสถานะ</div>
      <div class="bar-chart" id="bar-chart"></div>
    </div>

    <!-- Pipeline info -->
    <div class="card">
      <div class="card-title">⚙️ ข้อมูลระบบ</div>
      <div class="info-list" id="pipeline-info">
        <div class="info-row">
          <div class="info-key">Telegram Bot</div>
          <div class="info-val" id="info-bot">กำลังตรวจสอบ...</div>
        </div>
        <hr class="divider">
        <div class="info-row">
          <div class="info-key">Pipeline รันล่าสุด</div>
          <div class="info-val small" id="info-last-run">—</div>
        </div>
        <div class="info-row">
          <div class="info-key">Pipeline เสร็จล่าสุด</div>
          <div class="info-val small" id="info-last-finish">—</div>
        </div>
        <hr class="divider">
        <div class="info-row">
          <div class="info-key">รันถัดไป (ประมาณ)</div>
          <div class="info-val" id="info-next-run">—</div>
          <div class="info-val countdown" id="info-countdown">—</div>
        </div>
        <hr class="divider">
        <div class="info-row">
          <div class="info-key">อัปเดตล่าสุด</div>
          <div class="info-val small" id="info-updated">—</div>
        </div>
      </div>
    </div>
  </div>
`;
}
module.exports = { getLayoutHeader };
