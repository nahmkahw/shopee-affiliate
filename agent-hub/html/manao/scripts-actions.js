'use strict';
// scripts-actions.js — live log, refresh, keyboard, config
function getScriptsActions() {
  return `
  // ─── Live Pipeline Log ───────────────────────────────────────────────────────

  let liveLogInterval = null;
  let liveLogPaused   = false;
  let liveLogLastContent = '';
  let liveLogActive = false;

  async function pollLiveLog() {
    if (liveLogPaused) return;
    try {
      const r    = await fetch('/api/log-live?t=' + Date.now());
      const data = await r.json();

      const badge = document.getElementById('live-log-badge');
      const mtime = document.getElementById('live-log-mtime');
      const body  = document.getElementById('live-log-body');

      const wasActive = liveLogActive;
      liveLogActive = !!data.active;

      if (data.active) {
        badge.className   = 'live-log-badge active';
        badge.textContent = '🔴 Active';
      } else {
        badge.className   = 'live-log-badge idle';
        badge.textContent = '⚫ Idle';
      }
      if (data.mtime) {
        const d = new Date(data.mtime);
        mtime.textContent = 'อัปเดต: ' + d.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' });
      }
      if (body && data.lines !== undefined) {
        const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
        body.textContent = data.lines || '';
        if (atBottom || data.active) body.scrollTop = body.scrollHeight;
      }
      liveLogLastContent = data.lines || '';

      // Adjust poll rate: 3s when active, 30s when idle
      if (wasActive !== liveLogActive) {
        clearInterval(liveLogInterval);
        liveLogInterval = setInterval(pollLiveLog, liveLogActive ? 3000 : 30000);
      }
    } catch { /* ignore */ }
  }

  function toggleLiveLog() {
    liveLogPaused = !liveLogPaused;
    const btn = document.getElementById('live-log-pause-btn');
    btn.textContent = liveLogPaused ? '▶ เล่น' : '⏸ หยุด';
    if (!liveLogPaused) pollLiveLog();
  }

  // ─── Auto-refresh every 30s ───────────────────────────────────────────────────

  function startAutoRefresh() {
    refreshCountdown = 30;
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(() => {
      refreshCountdown--;
      const btn = document.getElementById('refresh-btn');
      if (refreshCountdown <= 5) {
        btn.title = \`รีเฟรชใน \${refreshCountdown} วิ...\`;
      }
      if (refreshCountdown <= 0) {
        refreshCountdown = 30;
        btn.title = '';
        loadData(false);
      }
    }, 1000);
  }

  // ─── Keyboard shortcuts ────────────────────────────────────────────────────────

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closePreviewModal(); closeLogModal(); closeGenForceModal(); }
    if (e.key === 'r' && !e.ctrlKey && document.activeElement.tagName !== 'INPUT') loadData(true);
  });

  // ─── Config: Filter & Formatter ────────────────────────────────────────────────

  const $ = id => document.getElementById(id);

  async function loadConfigUI() {
    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();
      const f = cfg.filter || {};
      const fm = cfg.formatter || {};

      $('cfg-min-score').value = f.minScore ?? 30;
      $('cfg-w-high').value    = f.weights?.high   ?? 20;
      $('cfg-w-medium').value  = f.weights?.medium ?? 5;
      $('cfg-w-low').value     = f.weights?.low    ?? 10;
      $('cfg-l-tech').value    = f.labels?.ai_tech   ?? 80;
      $('cfg-l-biz').value     = f.labels?.ai_biz    ?? 50;
      $('cfg-l-policy').value  = f.labels?.ai_policy ?? 30;
      $('cfg-kw-high').value   = (f.keywords?.high   || []).join(', ');
      $('cfg-kw-medium').value = (f.keywords?.medium || []).join(', ');
      $('cfg-kw-low').value    = (f.keywords?.low    || []).join(', ');

      const skip = fm.skipStatus || [];
      $('cfg-skip-posted').checked    = skip.includes('posted');
      $('cfg-skip-scheduled').checked = skip.includes('scheduled');
      $('cfg-skip-draft').checked     = skip.includes('draft');
      $('cfg-fmt-min-score').value    = fm.minScore ?? 0;

      const skipP = fm.skipPlatforms || [];
      $('cfg-skip-fb').checked     = skipP.includes('fb');
      $('cfg-skip-ig').checked     = skipP.includes('ig');
      $('cfg-skip-x').checked      = skipP.includes('x');
      $('cfg-skip-tiktok').checked = skipP.includes('tiktok');

      $('config-msg').textContent = '';
    } catch (e) {
      $('config-msg').textContent = '❌ โหลดค่าตั้งไม่สำเร็จ: ' + e.message;
    }
  }

  // แปลง textarea → array (คั่นด้วย , หรือขึ้นบรรทัดใหม่)
  function parseKw(text) {
    return text.split(/[,\\n]/).map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  async function saveConfig() {
    const skipStatus = [];
    if ($('cfg-skip-posted').checked)    skipStatus.push('posted');
    if ($('cfg-skip-scheduled').checked) skipStatus.push('scheduled');
    if ($('cfg-skip-draft').checked)     skipStatus.push('draft');

    const skipPlatforms = [];
    if ($('cfg-skip-fb').checked)     skipPlatforms.push('fb');
    if ($('cfg-skip-ig').checked)     skipPlatforms.push('ig');
    if ($('cfg-skip-x').checked)      skipPlatforms.push('x');
    if ($('cfg-skip-tiktok').checked) skipPlatforms.push('tiktok');

    const payload = {
      filter: {
        minScore: +$('cfg-min-score').value,
        weights:  { high: +$('cfg-w-high').value, medium: +$('cfg-w-medium').value, low: +$('cfg-w-low').value },
        labels:   { ai_tech: +$('cfg-l-tech').value, ai_biz: +$('cfg-l-biz').value, ai_policy: +$('cfg-l-policy').value },
        keywords: { high: parseKw($('cfg-kw-high').value), medium: parseKw($('cfg-kw-medium').value), low: parseKw($('cfg-kw-low').value) },
      },
      formatter: { skipStatus, minScore: +$('cfg-fmt-min-score').value, skipPlatforms },
    };

    $('config-msg').textContent = '⏳ กำลังบันทึก...';
    try {
      const res  = await fetch('/api/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        $('config-msg').textContent = '';
        const badge = $('config-saved-badge');
        badge.style.display = 'inline-block';
        setTimeout(() => badge.style.display = 'none', 2500);
        loadConfigUI();
      } else {
        $('config-msg').textContent = '❌ ' + (data.error || 'บันทึกไม่สำเร็จ');
      }
    } catch (e) {
      $('config-msg').textContent = '❌ ' + e.message;
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────

  loadData(false);
  startAutoRefresh();
  loadConfigUI();
  pollLiveLog();
  liveLogInterval = setInterval(pollLiveLog, 30000); // starts idle; switches to 3s when active
`;
}
module.exports = { getScriptsActions };
