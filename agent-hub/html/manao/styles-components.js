'use strict';
// styles-components.js — CSS table, modals, pipeline, toast
function getStylesComponents() {
  return `
  /* ── Table ── */
  .table-header {
    display: flex; gap: 10px; align-items: center;
    margin-bottom: 14px; flex-wrap: wrap;
  }
  .search-box {
    flex: 1; min-width: 200px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 14px;
    color: var(--text);
    font-size: 13px;
    outline: none;
    transition: border-color 0.2s;
  }
  .search-box:focus { border-color: var(--accent); }
  .search-box::placeholder { color: var(--text-dim); }
  .filter-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .filter-btn {
    padding: 5px 12px;
    border-radius: 20px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-dim);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }
  .filter-btn:hover { border-color: var(--accent); color: var(--text); }
  .filter-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }

  /* ── Table scroll container — ทำให้ sticky th ทำงานถูกต้อง ── */
  .table-scroll {
    overflow: auto;          /* ทั้ง x และ y ใน container เดียวกัน */
    max-height: 620px;       /* ถ้าข่าวเยอะ ให้ scroll ภายใน card */
    border-radius: 0 0 var(--radius) var(--radius);
  }

  .news-table { width: 100%; border-collapse: collapse; min-width: 700px; }
  .news-table th {
    text-align: left;
    padding: 10px 12px;
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 2px solid var(--border);
    background: var(--surface);   /* ต้องมี background ไม่ใส หรือ sticky จะโปร่งแสง */
    position: sticky;
    top: 0;                  /* ติดกับ .table-scroll container — ไม่ใช่ viewport */
    z-index: 10;
  }
  .news-table td {
    padding: 12px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  .news-table tbody tr { transition: background 0.15s; }
  .news-table tbody tr:hover { background: var(--surface2); }
  .news-table tbody tr:last-child td { border-bottom: none; }

  .col-title  { min-width: 260px; }
  .col-status { width: 140px; }
  .col-date   { width: 110px; white-space: nowrap; }
  .col-content{ width: 90px; text-align: center; }
  .col-time   { width: 150px; }
  .col-action { width: 150px; text-align: center; }

  /* ── Post button ── */
  .btn-post {
    background: none; border: 1px solid var(--green);
    border-radius: 6px; padding: 4px 8px; cursor: pointer;
    color: var(--green); font-size: 11px; transition: all 0.2s;
    margin-left: 4px;
  }
  .btn-post:hover { background: rgba(52,211,153,0.15); }
  .btn-post:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── Platform toggle buttons ── */
  .pf-btn {
    flex: 1; padding: 10px 14px; border-radius: 8px; font-size: 13px;
    cursor: pointer; border: 2px solid var(--border);
    background: var(--bg); color: var(--text-dim); transition: all 0.2s;
    font-weight: 600; text-align: center;
  }
  .pf-btn.active { border-color: var(--accent); color: var(--text); background: rgba(108,138,255,0.12); }
  .pf-btn.active.ig { border-color: #f093c3; color: #f093c3; background: rgba(193,53,132,0.1); }

  .title-link { color: var(--text); font-weight: 500; font-size: 13px; line-height: 1.4; }
  .title-link:hover { color: var(--accent); text-decoration: none; }
  .slug-text { font-size: 10px; color: var(--text-dim); margin-top: 2px; font-family: monospace; }

  /* Status badges */
  .badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 9px; border-radius: 12px;
    font-size: 11px; font-weight: 600; white-space: nowrap;
  }
  .badge-scraped   { background: rgba(167,139,250,0.15); color: var(--purple); border: 1px solid rgba(167,139,250,0.3); }
  .badge-draft     { background: rgba(136,146,164,0.15); color: var(--text-dim); border: 1px solid var(--border); }
  .badge-pending   { background: rgba(251,191,36,0.15);  color: var(--yellow); border: 1px solid rgba(251,191,36,0.3); }
  .badge-scheduled { background: rgba(56,189,248,0.15);  color: var(--blue);   border: 1px solid rgba(56,189,248,0.3); }
  .badge-posted    { background: rgba(52,211,153,0.15);  color: var(--green);  border: 1px solid rgba(52,211,153,0.3); }

  /* Content indicators */
  .content-icons { display: flex; gap: 4px; justify-content: center; }
  .ci { padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; }
  .ci-fb  { background: rgba(66,103,178,0.3);  color: #7ca7ff; }
  .ci-ig  { background: rgba(193,53,132,0.3);  color: #f093c3; }
  .ci-x   { background: rgba(255,255,255,0.1); color: #e2e8f0; }
  .ci-tt  { background: rgba(105,201,208,0.2); color: #69c9d0; }
  .ci-ms  { background: rgba(52,211,153,0.15); color: var(--green); }
  .ci-no  { color: var(--border); }

  /* Action buttons */
  .btn-preview {
    background: none; border: 1px solid var(--border);
    border-radius: 6px; padding: 4px 8px; cursor: pointer;
    color: var(--text-dim); font-size: 11px; transition: all 0.2s;
  }
  .btn-preview:hover { border-color: var(--accent); color: var(--accent); }

  .btn-regen {
    background: none; border: 1px solid rgba(167,139,250,0.4);
    border-radius: 6px; padding: 4px 8px; cursor: pointer;
    color: var(--purple); font-size: 11px; transition: all 0.2s;
    margin-left: 4px;
  }
  .btn-regen:hover { background: rgba(167,139,250,0.12); border-color: var(--purple); }
  .btn-regen:disabled { opacity: 0.4; cursor: not-allowed; }

  .time-text { font-size: 12px; color: var(--text-dim); }
  .time-text.soon { color: var(--yellow); }
  .time-text.done { color: var(--green); }

  .empty-state {
    text-align: center; padding: 48px; color: var(--text-dim);
    font-size: 14px;
  }
  .empty-icon { font-size: 36px; margin-bottom: 10px; }

  /* ── Preview Modal ── */
  .modal-overlay {
    display: none; position: fixed; inset: 0;
    background: rgba(0,0,0,0.7); z-index: 1000;
    align-items: center; justify-content: center;
  }
  .modal-overlay.open { display: flex; }
  .modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: min(680px, 95vw);
    max-height: 85vh;
    display: flex; flex-direction: column;
    box-shadow: 0 20px 60px rgba(0,0,0,0.6);
  }
  .modal-header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
  }
  .modal-title { font-weight: 600; font-size: 14px; }
  /* Config form */
  .cfg-label { display:block; font-size:11px; color:var(--text-dim,#8892a4); margin-bottom:4px; font-weight:600; }
  .cfg-sub { display:block; font-size:10px; color:var(--text-dim,#8892a4); margin-bottom:2px; }
  .cfg-input { width:100%; background:var(--surface2,#161b22); border:1px solid var(--border,#30363d); border-radius:6px; padding:7px 10px; color:var(--text,#e2e8f0); font-size:13px; font-family:inherit; }
  .cfg-input:focus { outline:none; border-color:var(--accent,#6c8aff); }
  .cfg-area { min-height:70px; resize:vertical; margin-bottom:10px; font-family:monospace; font-size:12px; line-height:1.5; }
  .cfg-check { display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer; }
  .cfg-check input { width:16px; height:16px; cursor:pointer; }

  .modal-tabs { display: flex; gap: 4px; margin-top: 10px; }
  .modal-tab {
    padding: 5px 14px; border-radius: 6px; font-size: 12px;
    cursor: pointer; border: 1px solid var(--border);
    background: var(--bg); color: var(--text-dim); transition: all 0.2s;
  }
  .modal-tab.active { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  .modal-close {
    background: none; border: none; color: var(--text-dim); font-size: 20px;
    cursor: pointer; padding: 4px 8px; border-radius: 6px; transition: all 0.2s;
    line-height: 1;
  }
  .modal-close:hover { color: var(--text); background: var(--border); }
  .modal-body { padding: 20px; overflow-y: auto; flex: 1; }
  .modal-content-text {
    white-space: pre-wrap; font-size: 13px; line-height: 1.7;
    color: var(--text); background: var(--bg); border-radius: 8px;
    padding: 16px; border: 1px solid var(--border);
    font-family: 'Segoe UI', system-ui, sans-serif;
  }
  .modal-loading { color: var(--text-dim); text-align: center; padding: 20px; }

  /* ── Log Modal ── */
  .log-text {
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 11px; line-height: 1.5;
    white-space: pre-wrap; word-break: break-all;
    color: #a3e6b5; background: #0a0e15;
    padding: 16px; border-radius: 8px; border: 1px solid var(--border);
    max-height: 400px; overflow-y: auto;
  }

  /* ── Loading overlay ── */
  .loading { opacity: 0.5; pointer-events: none; }
  .spinner { display: inline-block; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Scrollbar ── */
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: var(--bg); }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }

  /* ── Pipeline Builder ── */
  .pipeline-builder {
    background: var(--bg);
    border-radius: 8px;
    padding: 14px 16px;
    margin-bottom: 14px;
    border: 1px solid var(--border);
  }
  .pipeline-builder-label {
    font-size: 11px; color: var(--text-dim);
    text-transform: uppercase; letter-spacing: 0.5px;
    margin-bottom: 10px; font-weight: 600;
  }
  .pipeline-checks { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  .agent-check {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 12px; border-radius: 6px;
    border: 1px solid var(--border); background: var(--surface2);
    cursor: pointer; font-size: 12px; color: var(--text-dim);
    transition: all 0.2s; user-select: none;
  }
  .agent-check.checked {
    border-color: var(--accent); color: var(--text);
    background: rgba(108,138,255,0.08);
  }
  .agent-check input[type=checkbox] {
    width: 14px; height: 14px; cursor: pointer; accent-color: var(--accent);
  }
  .agent-check-post { border-color: rgba(52,211,153,0.25); color: var(--green); }
  .agent-check-post.checked { border-color: var(--green); background: rgba(52,211,153,0.08); }
  .pipeline-divider {
    display: flex; align-items: center; gap: 8px;
    font-size: 10px; color: var(--border); margin: 0 0 12px 0;
  }
  .pipeline-divider::before,.pipeline-divider::after {
    content:''; flex:1; border-top: 1px solid var(--border);
  }

  /* ── Live Log ── */
  .live-log-header { display:flex; align-items:center; gap:8px; }
  .live-log-badge { font-size:10px; padding:2px 8px; border-radius:10px; font-weight:700; }
  .live-log-badge.active  { background:rgba(248,113,113,0.15); border:1px solid rgba(248,113,113,0.4); color:#f87171; }
  .live-log-badge.idle    { background:rgba(255,255,255,0.06); border:1px solid var(--border); color:var(--text-dim); }
  .live-log-mtime { font-size:10px; color:var(--text-dim); margin-left:auto; }
  .live-log-body {
    font-family: monospace; font-size: 11px; color: var(--text-dim);
    background: rgba(0,0,0,0.25); border: 1px solid var(--border); border-radius: 8px;
    padding: 10px 12px; max-height: 260px; overflow-y: auto;
    white-space: pre-wrap; word-break: break-all; line-height: 1.6;
    margin-top: 10px;
  }
  .live-log-body:empty::before { content: '— ยังไม่มี log —'; opacity: 0.4; }

  /* ── Toast ── */
  .toast {
    position: fixed; bottom: 24px; right: 24px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 10px 16px;
    font-size: 13px; box-shadow: var(--shadow);
    opacity: 0; transition: opacity 0.3s; pointer-events: none;
    z-index: 9999;
  }
  .toast.show { opacity: 1; }
`;
}
module.exports = { getStylesComponents };
