'use strict';
// scripts-data.js — loadData, stats, bot, pipeline, chart, table
function getScriptsData() {
  return `
  let allNews = [];
  let currentFilter = 'all';
  let currentSlug = null;
  let currentTab = 'fb';
  let nextRunDate = null;
  let countdownInterval = null;
  let autoRefreshInterval = null;
  let refreshCountdown = 30;

  // ─── Load Data ───────────────────────────────────────────────────────────────

  async function loadData(manual = false) {
    if (manual) {
      document.getElementById('refresh-icon').textContent = '⏳';
      document.getElementById('refresh-btn').disabled = true;
    }
    try {
      const res = await fetch('/api/data?t=' + Date.now());
      const data = await res.json();
      allNews = data.news || [];
      updateStats(data.stats);
      updateBotStatus(data.bot);
      updatePipelineInfo(data.pipeline);
      updateAgentHub(data.hub);
      updateChart(data.stats);
      renderTable();
      const now = new Date();
      document.getElementById('last-updated').textContent =
        'อัปเดต: ' + now.toLocaleTimeString('th-TH');
      document.getElementById('info-updated').textContent =
        now.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      if (manual) showToast('✅ รีเฟรชแล้ว');
    } catch (e) {
      if (manual) showToast('❌ โหลดข้อมูลไม่สำเร็จ: ' + e.message);
      console.error(e);
    } finally {
      document.getElementById('refresh-icon').textContent = '🔄';
      document.getElementById('refresh-btn').disabled = false;
    }
  }

  // ─── Stats ───────────────────────────────────────────────────────────────────

  function updateStats(stats) {
    if (!stats) return;
    document.getElementById('stat-total').textContent     = stats.total || 0;
    document.getElementById('stat-pending').textContent   = stats.by_status?.pending_approval || 0;
    document.getElementById('stat-scheduled').textContent = stats.by_status?.scheduled || 0;
    document.getElementById('stat-posted').textContent    = stats.by_status?.posted || 0;
    document.getElementById('stat-draft').textContent     = stats.by_status?.draft || 0;
    document.getElementById('stat-scraped').textContent   = stats.by_status?.scraped || 0;
  }

  // ─── Bot status ──────────────────────────────────────────────────────────────

  function updateBotStatus(bot) {
    if (!bot) return;
    const dot  = document.getElementById('bot-dot');
    const text = document.getElementById('bot-status-text');
    const info = document.getElementById('info-bot');
    if (bot.running) {
      dot.className = 'dot dot-green dot-pulse';
      text.textContent = \`🤖 Bot กำลังทำงาน (PID: \${bot.pid})\`;
      info.textContent = \`✅ ทำงานปกติ (PID: \${bot.pid})\`;
      info.style.color = 'var(--green)';
    } else {
      dot.className = 'dot dot-red';
      text.textContent = bot.pid
        ? \`⚠️ Bot หยุดทำงาน (PID \${bot.pid} ตาย)\`
        : '⚠️ Bot ไม่ได้รัน';
      info.textContent = bot.pid
        ? \`❌ หยุดทำงาน (PID \${bot.pid} ตาย)\` : '❌ ไม่ได้รัน';
      info.style.color = 'var(--red)';
    }
  }

  // ─── Pipeline info ───────────────────────────────────────────────────────────

  function updatePipelineInfo(pipeline) {
    if (!pipeline) return;

    if (pipeline.last_run) {
      document.getElementById('last-run-text').textContent  = formatThaiDateTime(pipeline.last_run);
      document.getElementById('info-last-run').textContent  = formatThaiDateTime(pipeline.last_run);
    }
    if (pipeline.last_finish) {
      document.getElementById('info-last-finish').textContent = formatThaiDateTime(pipeline.last_finish);
    }
    if (pipeline.next_run_utc) {
      nextRunDate = new Date(pipeline.next_run_utc);
      const bkk = nextRunDate.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
      document.getElementById('next-run-text').textContent = bkk + ' น.';
      document.getElementById('info-next-run').textContent  = nextRunDate.toLocaleString('th-TH', {
        timeZone: 'Asia/Bangkok', year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
      startCountdown();
    }
  }

  function startCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      if (!nextRunDate) return;
      const diff = Math.max(0, nextRunDate - Date.now());
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      document.getElementById('info-countdown').textContent =
        \`อีก \${h}ชม. \${m}นาที \${s}วิ\`;
    }, 1000);
  }

  // ─── Chart ───────────────────────────────────────────────────────────────────

  function updateChart(stats) {
    if (!stats) return;
    const container = document.getElementById('bar-chart');
    const items = [
      { label: 'รอ Approve', key: 'pending_approval', color: 'var(--yellow)' },
      { label: 'Scheduled',  key: 'scheduled',        color: 'var(--blue)'   },
      { label: 'โพสต์แล้ว', key: 'posted',           color: 'var(--green)'  },
      { label: 'Draft',      key: 'draft',            color: 'var(--text-dim)' },
      { label: 'Scraped',    key: 'scraped',          color: 'var(--purple)' },
    ];
    const total = stats.total || 1;
    container.innerHTML = items.map(item => {
      const count = stats.by_status?.[item.key] || 0;
      const pct   = Math.round((count / total) * 100);
      return \`
        <div class="bar-row">
          <div class="bar-label">\${item.label}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:\${pct}%;background:\${item.color}">
              \${pct > 10 ? \`<span>\${pct}%</span>\` : ''}
            </div>
          </div>
          <div class="bar-count" style="color:\${item.color}">\${count}</div>
        </div>\`;
    }).join('');
  }

  // ─── Table ───────────────────────────────────────────────────────────────────

  function setFilter(f) {
    currentFilter = f;
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === f);
    });
    renderTable();
  }

  function renderTable() {
    const search  = (document.getElementById('search-input')?.value || '').toLowerCase();
    const filtered = allNews.filter(item => {
      if (currentFilter !== 'all' && item.status !== currentFilter) return false;
      if (search && !item.title.toLowerCase().includes(search) && !item.slug.toLowerCase().includes(search)) return false;
      return true;
    });

    const tbody = document.getElementById('news-tbody');
    if (!filtered.length) {
      tbody.innerHTML = \`<tr><td colspan="6" class="empty-state">
        <div class="empty-icon">🔍</div>
        <div>ไม่พบข่าวที่ตรงกับเงื่อนไข</div>
      </td></tr>\`;
      return;
    }

    tbody.innerHTML = filtered.map(item => {
      const badge   = statusBadge(item.status);
      const timeStr = getTimeStr(item);
      const msIcon  = item.hasMaster  ? '<span class="ci ci-ms">M</span>'  : '';
      const fbIcon  = item.hasFB      ? '<span class="ci ci-fb">FB</span>' : '';
      const igIcon  = item.hasIG      ? '<span class="ci ci-ig">IG</span>' : '';
      const xIcon   = item.hasX       ? '<span class="ci ci-x">X</span>'   : '';
      const ttIcon  = item.hasTikTok  ? '<span class="ci ci-tt">TT</span>' : '';
      const pubDate = item.published_at ? item.published_at.substring(0,10) : '—';
      const hasContent = item.hasFB || item.hasIG || item.hasX || item.hasTikTok;
      const canPost  = hasContent && item.status !== 'posted';
      const canRegen = item.status !== 'posted';
      const safeTitle = escHtml(item.title).replace(/'/g, '&#39;');
      const safeSlug  = item.slug.replace(/'/g, '');

      return \`
        <tr id="row-\${item.slug}">
          <td class="col-title">
            <a class="title-link" href="\${item.url}" target="_blank" title="\${escHtml(item.title)}">
              \${escHtml(item.title)}
            </a>
            <div class="slug-text">\${item.slug}</div>
          </td>
          <td class="col-status">\${badge}</td>
          <td class="col-date"><span class="time-text">\${pubDate}</span></td>
          <td class="col-content">
            <div class="content-icons">\${msIcon}\${fbIcon}\${igIcon}\${xIcon}\${ttIcon}</div>
          </td>
          <td class="col-time"><span class="time-text">\${timeStr}</span></td>
          <td class="col-action" style="white-space:nowrap">
            \${hasContent
              ? \`<button class="btn-preview" data-slug="\${item.slug}" data-title="\${escHtml(item.title)}" onclick="openPreviewFromEl(this)" title="ดู content">👁</button>\`
              : ''}
            \${canPost
              ? \`<button class="btn-post" data-slug="\${item.slug}" data-title="\${escHtml(item.title)}" data-fb="\${item.hasFB}" data-ig="\${item.hasIG}" onclick="openPostModalFromEl(this)" title="ส่งขอ Approve ผ่าน Telegram">📨</button>\`
              : ''}
            \${canRegen
              ? \`<button class="btn-regen" id="regen-row-\${item.slug}" data-slug="\${item.slug}" data-title="\${escHtml(item.title)}" onclick="openGenForceModalFromEl(this)" title="Generate content + รูป ใหม่ (--force)">🔄</button>\`
              : ''}
            \${!hasContent && !canRegen ? '<span style="color:var(--border)">—</span>' : ''}
          </td>
        </tr>\`;
    }).join('');
  }

  function statusBadge(status) {
    const map = {
      scraped:         ['badge-scraped',  '🔵 Scraped'],
      draft:           ['badge-draft',    '📝 Draft'],
      pending_approval:['badge-pending',  '⏳ รอ Approve'],
      scheduled:       ['badge-scheduled','📅 Scheduled'],
      posted:          ['badge-posted',   '✅ โพสต์แล้ว'],
    };
    const [cls, label] = map[status] || ['badge-draft', status];
    return \`<span class="badge \${cls}">\${label}</span>\`;
  }

  function getTimeStr(item) {
    if (item.status === 'posted' && item.posted_at) {
      return '✅ ' + formatRelative(item.posted_at);
    }
    if (item.status === 'scheduled' && item.posted_at) {
      return '📅 ' + formatRelative(item.posted_at);
    }
    if (item.pending_since) {
      return '📨 ' + formatRelative(item.pending_since);
    }
    if (item.scraped_at) {
      return '🕐 ดึงมา ' + formatRelative(item.scraped_at);
    }
    return '—';
  }
`;
}
module.exports = { getScriptsData };
