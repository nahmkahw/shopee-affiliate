'use strict';
// scripts-pipeline.js — pipeline status tracker, agent hub
function getScriptsPipeline() {
  return `
  // ─── Pipeline Status Tracker ─────────────────────────────────────────────────

  let pipelineStatusPoll = null;
  let logPanelOpen = false;

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function togglePipelineLog() {
    logPanelOpen = !logPanelOpen;
    document.getElementById('pipeline-log-panel').style.display = logPanelOpen ? 'block' : 'none';
    document.getElementById('log-toggle-arrow').textContent = logPanelOpen ? '▴' : '▾';
  }

  const STATUS_ICON = {
    pending: '⬜', running: '⚙️', done: '✅', error: '❌', skipped: '⏭',
  };
  const STATUS_LABEL = {
    pending: 'รอ', running: 'กำลังรัน...', done: 'เสร็จ', error: 'ล้มเหลว', skipped: 'ข้าม',
  };

  function renderPipelineStatus(data) {
    if (!data) return;
    const panel = document.getElementById('pipeline-status-panel');
    // hide panel when server has no pipeline state (e.g. after restart)
    if (panel && !data.running && (!data.steps || !data.steps.length)) {
      panel.style.display = 'none';
      return;
    }
    if (panel && (data.running || (data.steps && data.steps.length))) {
      panel.style.display = 'block';
    }

    // Render steps
    const stepsEl = document.getElementById('pipeline-steps');
    if (stepsEl && data.steps && data.steps.length) {
      stepsEl.innerHTML = data.steps.map(step => {
        const isRunning = step.status === 'running';
        const iconEl = isRunning
          ? \`<span class="step-icon step-spin">⚙️</span>\`
          : \`<span class="step-icon">\${STATUS_ICON[step.status] || '⬜'}</span>\`;
        const elapsed = step.elapsed ? \` <span class="step-elapsed">(\${step.elapsed}s)</span>\` : '';
        const errHtml = step.error
          ? \`<div class="step-error-msg">⚠ \${escHtml(step.error.substring(0, 200))}</div>\`
          : '';
        return \`
          <div class="pipeline-step step-\${step.status}" id="step-row-\${step.id}">
            \${iconEl}
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:6px">
                <span class="step-name">\${escHtml(step.icon)} \${escHtml(step.name)}</span>
                \${elapsed}
              </div>
              \${errHtml}
            </div>
          </div>\`;
      }).join('');
    }

    // Update log panel
    if (data.log) {
      const logEl = document.getElementById('pipeline-log-content');
      if (logEl) {
        logEl.textContent = data.log;
        if (logPanelOpen) {
          const panel = document.getElementById('pipeline-log-panel');
          if (panel) panel.scrollTop = panel.scrollHeight;
        }
      }
    }
  }

  async function startPipelineStatusPolling() {
    if (pipelineStatusPoll) return;
    pipelineStatusPoll = setInterval(async () => {
      try {
        const r = await fetch('/api/pipeline-status');
        const data = await r.json();
        renderPipelineStatus(data);
        if (!data.running) {
          clearInterval(pipelineStatusPoll);
          pipelineStatusPoll = null;
          // restore run button
          const btn = document.getElementById('btn-run-pipeline');
          if (btn) { btn.disabled = false; btn.innerHTML = '🍋 รัน Pipeline ที่เลือก'; }
        }
      } catch {}
    }, 1500);
  }

  // ─── Agent Hub ───────────────────────────────────────────────────────────────

  let agentLogPolls = {};  // { agentId: intervalId }
  let selectedAgents = new Set(['scrape', 'filter', 'editor', 'formatter']);

  function updateAgentHub(hub) {
    if (!hub) return;

    // pipeline badge
    const badge = document.getElementById('pipeline-running-badge');
    if (badge) badge.style.display = hub.pipeline_running ? '' : 'none';

    const grid = document.getElementById('agent-hub-grid');
    if (!grid) return;

    // render agent cards
    let html = '';
    for (const agent of hub.agents) {
      const isRunning  = agent.running;
      const hasPending = agent.pending !== null;
      const pendingOk  = hasPending && agent.pending === 0;
      const pendingVal = hasPending ? agent.pending : '—';
      const pendingCls = pendingOk ? 'ok' : '';
      const pendingLabel = hasPending
        ? \`<span class="count \${pendingCls}">\${pendingVal}</span> รายการรอ\`
        : \`<span style="color:var(--text-dim)">publisher</span>\`;

      html += \`
        <div class="agent-card \${isRunning ? 'running' : ''}" id="agent-card-\${agent.id}">
          <div class="agent-card-header">
            <span class="agent-icon">\${agent.icon}</span>
            <span class="agent-name">\${agent.name}</span>
          </div>
          <div class="agent-pending">\${pendingLabel}</div>
          <button class="btn-run \${isRunning ? 'running-state' : ''}"
                  id="btn-run-\${agent.id}"
                  onclick="triggerAgent('\${agent.id}')"
                  \${isRunning ? 'disabled' : ''}>
            \${isRunning ? '<span class="spinner">⚙️</span> กำลังทำงาน...' : '▶ รัน'}
          </button>
          \${isRunning ? \`<div id="agent-log-\${agent.id}" style="font-family:monospace;font-size:9px;color:var(--text-dim);max-height:60px;overflow:hidden;margin-top:4px;white-space:pre-wrap;word-break:break-all"></div>\` : ''}
        </div>\`;
    }

    grid.innerHTML = html;

    // อัปเดต static pipeline button state
    const pipelineBtn = document.getElementById('btn-run-pipeline');
    if (pipelineBtn) {
      pipelineBtn.disabled = hub.pipeline_running;
      pipelineBtn.innerHTML = hub.pipeline_running
        ? '<span class="spinner">⚙️</span> มะนาว กำลังรัน pipeline...'
        : '🍋 รัน Pipeline ที่เลือก';
    }

    // start/stop log polling for running agents
    for (const agent of hub.agents) {
      if (agent.running && !agentLogPolls[agent.id]) {
        agentLogPolls[agent.id] = setInterval(() => pollAgentLog(agent.id), 2000);
      } else if (!agent.running && agentLogPolls[agent.id]) {
        clearInterval(agentLogPolls[agent.id]);
        delete agentLogPolls[agent.id];
      }
    }
  }

  async function triggerAgent(agentId) {
    const btn = document.getElementById('btn-run-' + agentId) || document.getElementById('btn-run-pipeline');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner">⚙️</span> เริ่มต้น...'; }
    try {
      const res  = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agentId }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(\`▶ \${agentId} เริ่มทำงาน (PID: \${data.pid})\`);
        setTimeout(() => loadData(false), 800);
      } else {
        showToast('❌ ' + (data.error || 'เกิดข้อผิดพลาด'));
        if (btn) { btn.disabled = false; btn.innerHTML = '▶ รัน'; }
      }
    } catch (e) {
      showToast('❌ เชื่อมต่อไม่ได้: ' + e.message);
      if (btn) { btn.disabled = false; btn.innerHTML = '▶ รัน'; }
    }
  }

  function toggleAgentCheck(agentId, checkbox) {
    const label = document.getElementById('check-' + agentId);
    if (checkbox.checked) {
      selectedAgents.add(agentId);
      label?.classList.add('checked');
    } else {
      selectedAgents.delete(agentId);
      label?.classList.remove('checked');
    }
  }

  function runPipeline() {
    const args = [];
    if (!selectedAgents.has('scrape'))    args.push('--no-scrape');
    if (!selectedAgents.has('filter'))    args.push('--no-filter');
    if (!selectedAgents.has('editor'))    args.push('--no-edit');
    if (!selectedAgents.has('formatter')) args.push('--no-format');
    if (selectedAgents.has('post'))       args.push('--post');
    triggerPipeline(args);
  }

  async function triggerPipeline(args = []) {
    const btn = document.getElementById('btn-run-pipeline');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner">⚙️</span> กำลังรัน...'; }

    // แสดง panel ทันที พร้อม pending steps
    const STEP_DEFS_FE = [
      { id: 'scrape',    icon: '📡', name: 'Agent 1 Scrape',    skipFlag: '--no-scrape'  },
      { id: 'filter',    icon: '🔍', name: 'Agent 2 Filter',    skipFlag: '--no-filter'  },
      { id: 'editor',    icon: '✍️', name: 'Agent 3 Editor',    skipFlag: '--no-edit'    },
      { id: 'formatter', icon: '📐', name: 'Agent 4 Formatter', skipFlag: '--no-format'  },
      { id: 'post',      icon: '🚀', name: 'Publisher Post',    skipFlag: null, runFlag: '--post' },
    ];
    const initSteps = STEP_DEFS_FE.map(s => ({
      ...s,
      status: (s.skipFlag && args.includes(s.skipFlag)) || (s.runFlag && !args.includes(s.runFlag))
        ? 'skipped' : 'pending',
      elapsed: null, error: null,
    }));
    renderPipelineStatus({ running: true, steps: initSteps, log: '' });

    try {
      const res  = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'pipeline', args }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast('▶ Pipeline เริ่มทำงาน...');
        startPipelineStatusPolling();
      } else {
        showToast('❌ ' + (data.error || 'เกิดข้อผิดพลาด'));
        if (btn) { btn.disabled = false; btn.innerHTML = '🍋 รัน Pipeline ที่เลือก'; }
      }
    } catch (e) {
      showToast('❌ เชื่อมต่อไม่ได้: ' + e.message);
      if (btn) { btn.disabled = false; btn.innerHTML = '🍋 รัน Pipeline ที่เลือก'; }
    }
  }

  async function pollAgentLog(agentId) {
    try {
      const res  = await fetch(\`/api/agent-log?agent=\${agentId}\`);
      const data = await res.json();
      const el   = document.getElementById('agent-log-' + agentId);
      if (el && data.log) {
        // show last 3 lines
        const lines = data.log.split('\n').filter(l => l.trim()).slice(-3);
        el.textContent = lines.join('\n');
      }
      if (!data.running) {
        clearInterval(agentLogPolls[agentId]);
        delete agentLogPolls[agentId];
        setTimeout(() => loadData(false), 500);
      }
    } catch { /* ignore */ }
  }
`;
}
module.exports = { getScriptsPipeline };
