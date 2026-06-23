'use strict';
// scripts-log.js — log modal, helpers, formatters
function getScriptsLog() {
  return `
  // ─── Post Modal ──────────────────────────────────────────────────────────────

  let postSlug = null;
  let postPlatforms = new Set();
  let imageReady = false;   // Step 1 ผ่านแล้ว (Generate สำเร็จ)

  function openPostModal(slug, title, hasFB, hasIG) {
    postSlug = slug;
    postPlatforms = new Set();
    imageReady = false;

    if (hasFB) postPlatforms.add('fb');
    if (hasIG) postPlatforms.add('ig');

    document.getElementById('post-modal-subtitle').textContent = title;
    document.getElementById('post-result').style.display = 'none';
    document.getElementById('post-cancel-btn').textContent = 'ยกเลิก';

    const fbBtn = document.getElementById('pf-fb');
    const igBtn = document.getElementById('pf-ig');
    fbBtn.classList.toggle('active', postPlatforms.has('fb'));
    fbBtn.style.display = hasFB ? '' : 'none';
    igBtn.classList.toggle('active', postPlatforms.has('ig'));
    igBtn.style.display = hasIG ? '' : 'none';

    resetGenerateSection();
    updateIgSection();
    updateSendBtn();
    document.getElementById('post-modal').classList.add('open');
  }

  function closePostModal() {
    document.getElementById('post-modal').classList.remove('open');
  }

  function closePostModalOverlay(e) {
    if (e.target === document.getElementById('post-modal')) closePostModal();
  }

  function togglePlatform(p) {
    if (postPlatforms.has(p)) {
      postPlatforms.delete(p);
      document.getElementById('pf-' + p).classList.remove('active');
      // ถ้าไม่เหลือ platform ใดเลย → reset generate state
      if (postPlatforms.size === 0) {
        imageReady = false;
        resetGenerateSection();
      }
    } else {
      postPlatforms.add(p);
      document.getElementById('pf-' + p).classList.add('active');
    }
    updateIgSection();
    updateSendBtn();
  }

  function updateIgSection() {
    // แสดง generate section เมื่อเลือก platform ใดก็ได้
    const sec = document.getElementById('ig-generate-section');
    if (sec) sec.style.display = postPlatforms.size > 0 ? '' : 'none';
  }

  function updateSendBtn() {
    const btn  = document.getElementById('post-confirm-btn');
    const hint = document.getElementById('send-hint');
    const noPlatform = postPlatforms.size === 0;
    // Generate รูปจำเป็นสำหรับทุก platform
    const needGen = !imageReady;

    btn.disabled = noPlatform || needGen;
    if (hint) hint.style.display = (!noPlatform && needGen) ? 'block' : 'none';
  }

  function resetGenerateSection() {
    const before = document.getElementById('ig-before-gen');
    const after  = document.getElementById('ig-after-gen');
    const errDiv = document.getElementById('ig-gen-error');
    const genBtn = document.getElementById('generate-btn');
    if (before)  before.style.display = '';
    if (after)   after.style.display  = 'none';
    if (errDiv)  { errDiv.style.display = 'none'; errDiv.textContent = ''; }
    if (genBtn)  { genBtn.disabled = false; genBtn.textContent = '🎨 Generate รูป'; }
  }

  async function generateImage() {
    if (!postSlug) return;
    const genBtn  = document.getElementById('generate-btn');
    const regenBtn = document.getElementById('regen-btn');
    const before  = document.getElementById('ig-before-gen');
    const after   = document.getElementById('ig-after-gen');
    const errDiv  = document.getElementById('ig-gen-error');
    const statusEl = document.getElementById('ig-gen-status');
    const sizeEl   = document.getElementById('ig-gen-size');
    const previewImg = document.getElementById('ig-preview-img');

    // reset error
    errDiv.style.display = 'none';
    errDiv.textContent = '';

    // set generating state
    if (genBtn)   { genBtn.disabled = true;   genBtn.textContent = '⏳ กำลัง Generate...'; }
    if (regenBtn) { regenBtn.disabled = true; regenBtn.textContent = '⏳ กำลัง Generate...'; }
    imageReady = false;
    updateSendBtn();

    try {
      const res  = await fetch('/dashboard/manao/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: postSlug }),
      });
      const data = await res.json();

      if (!data.ok) throw new Error(data.error || 'Generate ไม่สำเร็จ');

      // Success
      imageReady = true;
      before.style.display = 'none';
      after.style.display  = '';
      if (statusEl)  statusEl.textContent = '✅ Generate สำเร็จ';
      if (sizeEl)    sizeEl.textContent   = data.sizeKB ? \`ขนาด: \${data.sizeKB} KB\` : '';
      if (previewImg) {
        previewImg.src = '/dashboard/manao/news-image/' + postSlug + '?t=' + Date.now();
        previewImg.style.display = '';
      }
      if (regenBtn) { regenBtn.disabled = false; regenBtn.textContent = '🔄 Generate ใหม่'; }
      updateSendBtn();

    } catch (e) {
      // Reset to before-gen state with error shown
      if (genBtn)   { genBtn.disabled = false;  genBtn.textContent = '🎨 Generate รูป IG'; }
      if (regenBtn) { regenBtn.disabled = false; regenBtn.textContent = '🔄 Generate ใหม่'; }
      errDiv.style.display = '';
      errDiv.textContent   = '❌ ' + e.message;
      imageReady = false;
      updateSendBtn();
    }
  }

  async function confirmPost() {
    if (!postSlug || postPlatforms.size === 0) {
      showToast('❌ เลือก platform อย่างน้อย 1 อย่าง');
      return;
    }
    if (!imageReady) {
      showToast('❌ กรุณา Generate รูปให้สำเร็จก่อน');
      return;
    }

    const confirmBtn = document.getElementById('post-confirm-btn');
    const resultDiv  = document.getElementById('post-result');

    confirmBtn.disabled = true;
    resultDiv.style.display = 'none';

    const platform = [...postPlatforms].join(',');
    const pfLabel  = platform === 'fb' ? 'Facebook' : platform === 'ig' ? 'Instagram' : 'Facebook + Instagram';
    confirmBtn.textContent = '⏳ กำลังส่ง Telegram...';

    try {
      const res = await fetch('/dashboard/manao/api/request-approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: postSlug, platform }),
      });
      const data = await res.json();
      resultDiv.style.display = 'block';
      if (data.ok) {
        resultDiv.style.cssText = 'display:block;padding:12px;border-radius:8px;font-size:13px;margin-bottom:16px;line-height:1.6;background:rgba(52,211,153,0.1);border:1px solid rgba(52,211,153,0.3);color:var(--green)';
        const imgNote = imageReady ? ' 🖼 แนบรูปแล้ว' : '';
        resultDiv.innerHTML = \`✅ ส่งไปยัง Telegram แล้ว!\${imgNote}<br><span style="color:var(--text-dim);font-size:12px">รอกด ✅ อนุมัติ & โพสต์ ใน Telegram เพื่อโพสต์ไปที่ \${pfLabel}</span>\`;
        document.getElementById('post-cancel-btn').textContent = 'ปิด';
        confirmBtn.textContent = '✅ ส่งแล้ว';
        loadData(false);
      } else {
        resultDiv.style.cssText = 'display:block;padding:12px;border-radius:8px;font-size:13px;margin-bottom:16px;line-height:1.6;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);color:var(--red)';
        resultDiv.textContent = '❌ ' + (data.error || 'เกิดข้อผิดพลาด');
        confirmBtn.disabled = false;
        confirmBtn.textContent = '📨 ลองใหม่';
      }
    } catch (e) {
      resultDiv.style.cssText = 'display:block;padding:12px;border-radius:8px;font-size:13px;margin-bottom:16px;line-height:1.6;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);color:var(--red)';
      resultDiv.textContent = '❌ เชื่อมต่อไม่สำเร็จ: ' + e.message;
      confirmBtn.disabled = false;
      confirmBtn.textContent = '📨 ลองใหม่';
    }
  }
`;
}
module.exports = { getScriptsLog };
