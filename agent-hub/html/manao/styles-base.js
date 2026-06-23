'use strict';
// styles-base.js — CSS base, header, layout, stat cards
function getStylesBase() {
  return `
  :root {
    --bg:        #0f1117;
    --surface:   #1a1d27;
    --surface2:  #222636;
    --border:    #2e3347;
    --text:      #e2e8f0;
    --text-dim:  #8892a4;
    --accent:    #6c8aff;
    --green:     #34d399;
    --yellow:    #fbbf24;
    --red:       #f87171;
    --purple:    #a78bfa;
    --blue:      #38bdf8;
    --orange:    #fb923c;
    --radius:    10px;
    --shadow:    0 4px 20px rgba(0,0,0,0.4);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Segoe UI', 'Noto Sans Thai', system-ui, sans-serif;
    font-size: 14px;
    min-height: 100vh;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* ── Header ── */
  .header {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 16px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: 0;
    z-index: 100;
    box-shadow: var(--shadow);
  }
  .header-left { display: flex; align-items: center; gap: 12px; }
  .header-title { font-size: 18px; font-weight: 700; color: var(--text); }
  .header-subtitle { font-size: 12px; color: var(--text-dim); }
  .refresh-info {
    display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--text-dim);
  }
  .btn {
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.2s;
    display: flex; align-items: center; gap: 6px;
  }
  .btn:hover { background: var(--border); }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn.primary:hover { filter: brightness(1.15); }

  /* ── Layout ── */
  .main { padding: 24px; max-width: 1400px; margin: 0 auto; }

  /* ── Status Bar ── */
  .status-bar {
    display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap;
  }
  .status-pill {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 6px 14px;
    font-size: 12px;
    display: flex; align-items: center; gap: 6px;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .dot-green  { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .dot-red    { background: var(--red); }
  .dot-yellow { background: var(--yellow); }
  .dot-pulse  { animation: pulse 1.5s infinite; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }

  /* ── Stat Cards ── */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 14px;
    margin-bottom: 24px;
  }
  .stat-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 18px 20px;
    transition: transform 0.2s, box-shadow 0.2s;
    cursor: default;
  }
  .stat-card:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
  .stat-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
  .stat-value { font-size: 32px; font-weight: 700; line-height: 1; }
  .stat-value.total   { color: var(--text); }
  .stat-value.pending { color: var(--yellow); }
  .stat-value.sched   { color: var(--blue); }
  .stat-value.posted  { color: var(--green); }
  .stat-value.draft   { color: var(--text-dim); }
  .stat-value.scraped { color: var(--purple); }
  .stat-sub { font-size: 11px; color: var(--text-dim); margin-top: 4px; }

  /* ── Agent Hub ── */
  .agent-hub {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
    margin-bottom: 24px;
  }
  .agent-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: transform 0.2s, box-shadow 0.2s;
  }
  .agent-card:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
  .agent-card.running {
    border-color: var(--accent);
    box-shadow: 0 0 12px rgba(108,138,255,0.25);
  }
  .agent-card-header { display: flex; align-items: center; gap: 8px; }
  .agent-icon { font-size: 20px; line-height: 1; }
  .agent-name { font-size: 12px; font-weight: 600; color: var(--text); flex: 1; }
  .agent-pending {
    font-size: 11px; color: var(--text-dim);
    display: flex; align-items: center; gap: 4px;
  }
  .agent-pending .count { font-weight: 700; color: var(--yellow); }
  .agent-pending .count.ok { color: var(--green); }
  .btn-run {
    width: 100%; padding: 7px 0; border-radius: 6px;
    border: 1px solid var(--border); background: var(--surface2);
    color: var(--text); font-size: 12px; cursor: pointer;
    transition: all 0.2s; font-weight: 500;
  }
  .btn-run:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); background: rgba(108,138,255,0.08); }
  .btn-run:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-run.running-state { border-color: var(--accent); color: var(--accent); }
  .btn-run-pipeline {
    width: 100%; padding: 10px 0; border-radius: 8px;
    border: 2px solid var(--accent); background: rgba(108,138,255,0.1);
    color: var(--accent); font-size: 13px; cursor: pointer;
    transition: all 0.2s; font-weight: 700; letter-spacing: 0.3px;
    grid-column: 1 / -1;
  }
  .btn-run-pipeline:hover:not(:disabled) { background: rgba(108,138,255,0.2); }
  .btn-run-pipeline:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ── Pipeline Status Panel ── */
  .pipeline-status-panel {
    margin-top: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--surface2);
  }
  .pipeline-steps {
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .pipeline-step {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 8px;
    transition: background 0.2s;
    font-size: 13px;
  }
  .pipeline-step.step-done    { background: rgba(52,211,153,0.07); }
  .pipeline-step.step-running { background: rgba(108,138,255,0.1); }
  .pipeline-step.step-error   { background: rgba(248,113,113,0.1); }
  .pipeline-step.step-skipped { opacity: 0.45; }
  .step-icon  { font-size: 15px; width: 22px; text-align: center; flex-shrink: 0; }
  .step-spin  { display: inline-block; animation: spin 1.2s linear infinite; }
  .step-name  { flex: 1; font-weight: 600; color: var(--text); }
  .step-elapsed { font-size: 11px; color: var(--text-dim); white-space: nowrap; }
  .step-error-msg {
    font-size: 11px; color: var(--red);
    margin-top: 2px; padding-left: 32px;
    word-break: break-all;
  }
  /* Log toggle bar */
  .log-toggle-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 14px;
    cursor: pointer;
    border-top: 1px solid var(--border);
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
    user-select: none;
    transition: background 0.15s;
  }
  .log-toggle-bar:hover { background: var(--surface); }
  /* Log panel */
  .pipeline-log-panel {
    border-top: 1px solid var(--border);
    background: #0d1117;
    padding: 10px 14px;
    max-height: 220px;
    overflow-y: auto;
    font-family: 'Courier New', monospace;
    font-size: 11px;
    line-height: 1.55;
    color: #cdd9e5;
  }
  .pipeline-log-panel::-webkit-scrollbar { width: 5px; }
  .pipeline-log-panel::-webkit-scrollbar-track { background: #161b22; }
  .pipeline-log-panel::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }

  /* ── Row (chart + pipeline info) ── */
  .row-2 {
    display: grid;
    grid-template-columns: 1fr 300px;
    gap: 14px;
    margin-bottom: 24px;
  }
  @media (max-width: 900px) { .row-2 { grid-template-columns: 1fr; } }

  /* ── Chart ── */
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
  }
  .card-title {
    font-size: 13px; font-weight: 600; color: var(--text-dim);
    text-transform: uppercase; letter-spacing: 0.5px;
    margin-bottom: 16px;
    display: flex; align-items: center; gap: 8px;
  }
  .bar-chart { display: flex; flex-direction: column; gap: 10px; }
  .bar-row { display: flex; align-items: center; gap: 10px; }
  .bar-label { width: 110px; font-size: 12px; color: var(--text-dim); flex-shrink: 0; text-align: right; }
  .bar-track { flex: 1; background: var(--bg); border-radius: 4px; height: 20px; overflow: hidden; }
  .bar-fill  { height: 100%; border-radius: 4px; transition: width 0.6s ease; display: flex; align-items: center; padding: 0 8px; }
  .bar-fill span { font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.9); white-space: nowrap; }
  .bar-count { width: 32px; font-size: 12px; font-weight: 700; text-align: right; }

  /* ── Pipeline info ── */
  .info-list { display: flex; flex-direction: column; gap: 12px; }
  .info-row  { display: flex; flex-direction: column; gap: 3px; }
  .info-key  { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.4px; }
  .info-val  { font-size: 13px; color: var(--text); font-weight: 500; }
  .info-val.small { font-size: 12px; }
  .divider   { border: none; border-top: 1px solid var(--border); margin: 4px 0; }
  .countdown { color: var(--accent); font-weight: 600; }
`;
}
module.exports = { getStylesBase };
