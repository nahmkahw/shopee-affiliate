'use strict';
// layout-modals.js — table + preview/post/gen/log modals
function getLayoutModals() {
  return `
  <!-- Table -->
  <div class="card" style="margin-bottom:24px">
    <div class="table-header">
      <input class="search-box" type="text" id="search-input"
             placeholder="🔍 ค้นหาชื่อข่าว..." oninput="renderTable()">
      <div class="filter-row">
        <button class="filter-btn active" data-filter="all" onclick="setFilter('all')">ทั้งหมด</button>
        <button class="filter-btn" data-filter="pending_approval" onclick="setFilter('pending_approval')">รอ Approve</button>
        <button class="filter-btn" data-filter="scheduled" onclick="setFilter('scheduled')">Scheduled</button>
        <button class="filter-btn" data-filter="posted" onclick="setFilter('posted')">โพสต์แล้ว</button>
        <button class="filter-btn" data-filter="draft" onclick="setFilter('draft')">Draft</button>
        <button class="filter-btn" data-filter="scraped" onclick="setFilter('scraped')">Scraped</button>
      </div>
    </div>

    <div class="table-scroll">
      <table class="news-table">
        <thead>
          <tr>
            <th class="col-title">ข่าว</th>
            <th class="col-status">สถานะ</th>
            <th class="col-date">วันที่เผยแพร่</th>
            <th class="col-content" style="width:120px">Content</th>
            <th class="col-time">เวลา</th>
            <th class="col-action">Actions</th>
          </tr>
        </thead>
        <tbody id="news-tbody">
          <tr><td colspan="6" class="empty-state">
            <div class="empty-icon">⏳</div>
            <div>กำลังโหลด...</div>
          </td></tr>
        </tbody>
      </table>
    </div>
  </div>

</div><!-- /main -->

<!-- Preview Modal -->
<div class="modal-overlay" id="preview-modal" onclick="closeModal(event)">
  <div class="modal">
    <div class="modal-header">
      <div>
        <div class="modal-title" id="modal-title">Preview</div>
        <div class="modal-tabs">
          <button class="modal-tab active" id="tab-fb"     onclick="switchTab('fb')">📘 FB</button>
          <button class="modal-tab"        id="tab-ig"     onclick="switchTab('ig')">📸 IG</button>
          <button class="modal-tab"        id="tab-x"      onclick="switchTab('x')">✖ X</button>
          <button class="modal-tab"        id="tab-tiktok" onclick="switchTab('tiktok')">🎵 TikTok</button>
          <button class="modal-tab"        id="tab-master" onclick="switchTab('master')">📄 Master</button>
        </div>
      </div>
      <button class="modal-close" onclick="closePreviewModal()">✕</button>
    </div>
    <div class="modal-body">
      <!-- รูป ComfyUI — แสดงเมื่อมี image.jpg เท่านั้น -->
      <div id="modal-image-wrap" style="display:none;margin-bottom:14px">
        <img id="modal-image" src="" alt="AI News Image"
             style="width:100%;max-height:260px;object-fit:cover;border-radius:8px;border:1px solid var(--border)">
        <div style="font-size:10px;color:var(--text-dim);margin-top:5px;text-align:right">🖼 ComfyUI Generated Image</div>
      </div>
      <div id="modal-content" class="modal-loading">กำลังโหลด...</div>
    </div>
  </div>
</div>

<!-- Telegram Approval Modal -->
<div class="modal-overlay" id="post-modal" onclick="closePostModalOverlay(event)">
  <div class="modal" style="max-width:500px">
    <div class="modal-header">
      <div>
        <div class="modal-title">📨 ส่งขอ Approve ผ่าน Telegram</div>
        <div id="post-modal-subtitle" style="font-size:12px;color:var(--text-dim);margin-top:4px;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
      </div>
      <button class="modal-close" onclick="closePostModal()">✕</button>
    </div>
    <div class="modal-body">

      <!-- Info banner -->
      <div style="background:rgba(108,138,255,0.08);border:1px solid rgba(108,138,255,0.25);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:var(--text-dim);line-height:1.6">
        🤖 ระบบจะส่ง content preview ไปยัง Telegram<br>
        กด <b style="color:var(--text)">✅ อนุมัติ & โพสต์</b> ใน Telegram เพื่อโพสต์จริง
      </div>

      <!-- Platform selection -->
      <div style="margin-bottom:16px">
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">โพสต์ไปที่ Platform:</div>
        <div style="display:flex;gap:10px">
          <button id="pf-fb" class="pf-btn" onclick="togglePlatform('fb')">📘 Facebook</button>
          <button id="pf-ig" class="pf-btn ig" onclick="togglePlatform('ig')">📸 Instagram</button>
        </div>
      </div>

      <!-- 2-Step Section: Generate รูป (แสดงเมื่อเลือก platform ใดก็ได้) -->
      <div id="ig-generate-section" style="display:none;border:1px solid rgba(108,138,255,0.3);border-radius:10px;padding:14px;margin-bottom:16px;background:rgba(108,138,255,0.05)">
        <div style="font-size:11px;color:#6c8aff;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;font-weight:700">
          🎨 ขั้นตอนที่ 1: Generate รูป (จำเป็นสำหรับทุก Platform)
        </div>

        <!-- Before generate -->
        <div id="ig-before-gen">
          <div style="font-size:12px;color:var(--text-dim);margin-bottom:10px;line-height:1.5">
            Generate รูปผ่าน ComfyUI (photojournalism style)<br>
            <span style="opacity:0.7">⏱ ใช้เวลาประมาณ 1-3 นาที — รูปจะใช้กับทั้ง FB และ IG</span>
          </div>
          <button id="generate-btn" class="btn" onclick="generateImage()"
                  style="border-color:#6c8aff;color:#6c8aff;width:100%;justify-content:center">
            🎨 Generate รูป
          </button>
        </div>

        <!-- After generate success -->
        <div id="ig-after-gen" style="display:none">
          <div style="display:flex;gap:12px;align-items:flex-start">
            <img id="ig-preview-img" src="" alt="preview"
                 style="width:100px;height:100px;object-fit:cover;border-radius:8px;border:2px solid rgba(240,147,195,0.4);flex-shrink:0">
            <div style="flex:1">
              <div id="ig-gen-status" style="color:var(--green);font-size:13px;font-weight:600;margin-bottom:6px">✅ Generate สำเร็จ</div>
              <div id="ig-gen-size" style="font-size:11px;color:var(--text-dim);margin-bottom:10px"></div>
              <button id="regen-btn" class="btn" onclick="generateImage()"
                      style="font-size:11px;padding:4px 10px">
                🔄 Generate ใหม่
              </button>
            </div>
          </div>
        </div>

        <!-- Generate error -->
        <div id="ig-gen-error" style="display:none;margin-top:10px;padding:8px 12px;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:6px;font-size:12px;color:var(--red)"></div>
      </div>

      <!-- Result (after send) -->
      <div id="post-result" style="display:none;padding:12px;border-radius:8px;font-size:13px;margin-bottom:16px;line-height:1.6"></div>

      <!-- Actions -->
      <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center">
        <button class="btn" onclick="closePostModal()" id="post-cancel-btn">ยกเลิก</button>
        <button class="btn primary" onclick="confirmPost()" id="post-confirm-btn" disabled
                title="กด Generate รูปให้สำเร็จก่อน">
          📨 ส่งขอ Approve
        </button>
      </div>
      <div id="send-hint" style="text-align:right;font-size:11px;color:var(--text-dim);margin-top:6px;display:none">
        ⬆️ Generate รูปให้สำเร็จก่อน จึงจะส่ง Telegram ได้
      </div>
    </div>
  </div>
</div>

<!-- Generate Force Modal -->
<div class="modal-overlay" id="genforce-modal" onclick="closeGenForceModalOverlay(event)">
  <div class="modal" style="max-width:540px">
    <div class="modal-header">
      <div>
        <div class="modal-title">🔄 Generate Content (Force)</div>
        <div id="genforce-subtitle" style="font-size:12px;color:var(--text-dim);margin-top:4px;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
      </div>
      <button class="modal-close" id="genforce-close-btn" onclick="closeGenForceModal()">✕</button>
    </div>
    <div class="modal-body">

      <!-- Info banner -->
      <div style="background:rgba(167,139,250,0.07);border:1px solid rgba(167,139,250,0.25);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:var(--text-dim);line-height:1.6">
        🤖 สร้าง FB + IG content ใหม่ (Ollama) และรูป (ComfyUI)<br>
        <span style="opacity:0.8">⏱ ใช้เวลา 2–6 นาที — content เดิมจะถูกทับ, <b style="color:var(--text)">ไม่ส่ง Telegram อัตโนมัติ</b></span>
      </div>

      <!-- Progress -->
      <div id="genforce-progress" style="display:none;text-align:center;padding:20px 0">
        <div style="font-size:28px;animation:spin 1.2s linear infinite;display:inline-block">⚙️</div>
        <div style="margin-top:12px;font-size:13px;color:var(--text-dim)" id="genforce-progress-msg">กำลัง Generate...</div>
        <div style="margin-top:6px;font-size:11px;color:var(--text-dim)">อาจใช้เวลา 2–6 นาที</div>
      </div>

      <!-- Result -->
      <div id="genforce-result" style="display:none"></div>

      <!-- Log output -->
      <div id="genforce-log-wrap" style="display:none;margin-top:12px">
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Output</div>
        <div id="genforce-log" class="log-text" style="max-height:180px;font-size:10px"></div>
      </div>

      <!-- Actions -->
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button class="btn" id="genforce-cancel-btn" onclick="closeGenForceModal()">ยกเลิก</button>
        <button class="btn primary" id="genforce-start-btn" onclick="startGenForce()">
          🔄 Generate ใหม่
        </button>
      </div>
    </div>
  </div>
</div>

<!-- Log Modal -->
<div class="modal-overlay" id="log-modal" onclick="closeModal(event)">
  <div class="modal" style="max-width:800px">
    <div class="modal-header">
      <div class="modal-title">📋 Pipeline Log (ล่าสุด 100 บรรทัด)</div>
      <button class="modal-close" onclick="closeLogModal()">✕</button>
    </div>
    <div class="modal-body">
      <div id="log-content" class="log-text">กำลังโหลด...</div>
    </div>
  </div>
</div>

<!-- Toast -->
<div class="toast" id="toast"></div>
`;
}
module.exports = { getLayoutModals };
