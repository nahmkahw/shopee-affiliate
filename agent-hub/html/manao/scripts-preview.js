'use strict';
// scripts-preview.js — preview modal
function getScriptsPreview() {
  return `
  // ─── Preview Modal ────────────────────────────────────────────────────────────

  // helper: เปิด modal จาก data-* attribute (หลีกเลี่ยง JS injection จาก title มีอักขระพิเศษ)
  function openPreviewFromEl(el) {
    openPreview(el.dataset.slug, el.dataset.title);
  }
  function openPostModalFromEl(el) {
    openPostModal(el.dataset.slug, el.dataset.title,
      el.dataset.fb === 'true', el.dataset.ig === 'true');
  }
  function openGenForceModalFromEl(el) {
    openGenForceModal(el.dataset.slug, el.dataset.title);
  }

  async function openPreview(slug, title) {
    currentSlug = slug;
    currentTab  = 'fb';
    document.getElementById('modal-title').textContent = title;
    ALL_TABS.forEach(t => document.getElementById('tab-' + t)?.classList.toggle('active', t === 'fb'));

    // ─── โหลดรูป — probe ก่อน ถ้าไม่มีก็ซ่อน ─────────────────────────────
    const imgWrap = document.getElementById('modal-image-wrap');
    const imgEl   = document.getElementById('modal-image');
    imgWrap.style.display = 'none';
    imgEl.src = '';
    const imgUrl = '/dashboard/manao/news-image/' + encodeURIComponent(slug) + '?t=' + Date.now();
    const probe = new Image();
    probe.onload  = () => { imgEl.src = imgUrl; imgWrap.style.display = ''; };
    probe.onerror = () => { imgWrap.style.display = 'none'; };
    probe.src = imgUrl;

    document.getElementById('preview-modal').classList.add('open');
    await loadModalContent('fb');
  }

  const TAB_LABELS = { fb: 'Facebook', ig: 'Instagram', x: 'X (Twitter)', tiktok: 'TikTok', master: 'Master (ภาษาไทย)' };
  const ALL_TABS   = ['fb', 'ig', 'x', 'tiktok', 'master'];

  async function switchTab(tab) {
    currentTab = tab;
    ALL_TABS.forEach(t => document.getElementById('tab-' + t)?.classList.toggle('active', t === tab));
    await loadModalContent(tab);
  }

  async function loadModalContent(platform) {
    const content = document.getElementById('modal-content');
    content.className = 'modal-loading';
    content.textContent = 'กำลังโหลด...';
    try {
      const res = await fetch(\`/api/content?slug=\${encodeURIComponent(currentSlug)}&platform=\${platform}\`);
      if (res.ok) {
        content.className = 'modal-content-text';
        content.textContent = await res.text();
      } else {
        content.className = 'modal-loading';
        content.textContent = \`❌ ยังไม่มี content สำหรับ \${TAB_LABELS[platform] || platform}\`;
      }
    } catch (e) {
      content.className = 'modal-loading';
      content.textContent = '❌ โหลดไม่สำเร็จ: ' + e.message;
    }
  }

  function closePreviewModal() {
    document.getElementById('preview-modal').classList.remove('open');
  }

  // ─── Log Modal ────────────────────────────────────────────────────────────────

  async function showLog() {
    document.getElementById('log-modal').classList.add('open');
    document.getElementById('log-content').textContent = 'กำลังโหลด...';
    try {
      const res = await fetch('/api/log?t=' + Date.now());
      const text = await res.text();
      const el = document.getElementById('log-content');
      el.textContent = text;
      el.scrollTop = el.scrollHeight;
    } catch (e) {
      document.getElementById('log-content').textContent = '❌ โหลด log ไม่สำเร็จ: ' + e.message;
    }
  }

  function closeLogModal() {
    document.getElementById('log-modal').classList.remove('open');
  }

  function closeModal(event) {
    if (event.target === document.getElementById('preview-modal')) closePreviewModal();
    if (event.target === document.getElementById('log-modal')) closeLogModal();
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function formatRelative(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso.replace(' ', 'T'));
      const diff = Date.now() - d.getTime();
      if (diff < 60000)    return 'เมื่อกี้';
      if (diff < 3600000)  return \`\${Math.floor(diff/60000)} นาทีที่แล้ว\`;
      if (diff < 86400000) return \`\${Math.floor(diff/3600000)} ชม.ที่แล้ว\`;
      const days = Math.floor(diff/86400000);
      if (days < 7)        return \`\${days} วันที่แล้ว\`;
      return d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', month: 'short', day: 'numeric' });
    } catch { return iso.substring(0,10); }
  }

  function formatThaiDateTime(str) {
    if (!str) return '—';
    try {
      const d = new Date(str.replace(' ', 'T'));
      return d.toLocaleString('th-TH', {
        timeZone: 'Asia/Bangkok',
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch { return str; }
  }

  function escHtml(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
  }
`;
}
module.exports = { getScriptsPreview };
