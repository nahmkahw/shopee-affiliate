'use strict';
// scripts-post.js — post modal, generate-force modal
function getScriptsPost() {
  return `
  // ─── Generate Force Modal ─────────────────────────────────────────────────────

  let genForceSlug  = null;
  let genForceRunning = false;

  function openGenForceModal(slug, title) {
    genForceSlug = slug;
    genForceRunning = false;
    document.getElementById('genforce-subtitle').textContent = title || slug;
    document.getElementById('genforce-progress').style.display  = 'none';
    document.getElementById('genforce-result').style.display    = 'none';
    document.getElementById('genforce-log-wrap').style.display  = 'none';
    document.getElementById('genforce-log').textContent         = '';
    document.getElementById('genforce-start-btn').disabled      = false;
    document.getElementById('genforce-start-btn').textContent   = '🔄 Generate ใหม่';
    document.getElementById('genforce-cancel-btn').textContent  = 'ยกเลิก';
    document.getElementById('genforce-close-btn').disabled      = false;
    document.getElementById('genforce-modal').classList.add('open');
  }

  function closeGenForceModal() {
    if (genForceRunning) return; // ป้องกันปิดระหว่าง generate
    document.getElementById('genforce-modal').classList.remove('open');
    genForceSlug = null;
  }

  function closeGenForceModalOverlay(e) {
    if (e.target === document.getElementById('genforce-modal')) closeGenForceModal();
  }

  async function startGenForce() {
    if (!genForceSlug || genForceRunning) return;
    genForceRunning = true;

    // Lock UI
    const startBtn  = document.getElementById('genforce-start-btn');
    const cancelBtn = document.getElementById('genforce-cancel-btn');
    const closeBtn  = document.getElementById('genforce-close-btn');
    const progress  = document.getElementById('genforce-progress');
    const resultDiv = document.getElementById('genforce-result');
    const progMsg   = document.getElementById('genforce-progress-msg');

    startBtn.disabled  = true;
    startBtn.textContent = '⏳ กำลัง Generate...';
    cancelBtn.disabled = true;
    closeBtn.disabled  = true;
    resultDiv.style.display   = 'none';
    document.getElementById('genforce-log-wrap').style.display = 'none';
    progress.style.display    = 'block';
    progMsg.textContent = 'กำลังสร้าง content ด้วย Ollama...';

    // simulate step labels (เปลี่ยนทุก 30s เพื่อให้รู้สึกว่าทำงานอยู่)
    const stepMsgs = [
      'กำลังสร้าง content ด้วย Ollama...',
      'กำลัง Generate รูปผ่าน ComfyUI...',
      'รอผลลัพธ์จาก ComfyUI...',
      'ใกล้เสร็จแล้ว...',
    ];
    let stepIdx = 0;
    const stepTimer = setInterval(() => {
      stepIdx = Math.min(stepIdx + 1, stepMsgs.length - 1);
      progMsg.textContent = stepMsgs[stepIdx];
    }, 30000);

    try {
      const res = await fetch('/api/generate-force', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: genForceSlug }),
      });
      clearInterval(stepTimer);
      const data = await res.json();

      progress.style.display = 'none';
      closeBtn.disabled      = false;
      cancelBtn.disabled     = false;
      cancelBtn.textContent  = 'ปิด';
      genForceRunning        = false;

      if (data.ok) {
        resultDiv.style.cssText = 'display:block;padding:12px;border-radius:8px;font-size:13px;margin-bottom:0;line-height:1.6;background:rgba(52,211,153,0.1);border:1px solid rgba(52,211,153,0.3);color:var(--green)';
        const imgNote = data.hasImage ? \` 🖼 รูป \${data.sizeKB} KB\` : ' (ไม่มีรูป — ComfyUI อาจออฟไลน์)';
        resultDiv.innerHTML = \`✅ Generate สำเร็จ!\${imgNote}<br><span style="color:var(--text-dim);font-size:12px">status เปลี่ยนเป็น <b>Draft</b> — กดปุ่ม 📨 เพื่อส่ง Telegram</span>\`;
        startBtn.textContent = '✅ เสร็จแล้ว';
        // แสดง log output
        if (data.log) {
          document.getElementById('genforce-log-wrap').style.display = '';
          document.getElementById('genforce-log').textContent = data.log;
        }
        // Refresh table
        loadData(false);
        // Disable regen button in row
        const rowBtn = document.getElementById('regen-row-' + genForceSlug);
        if (rowBtn) { rowBtn.textContent = '✅'; rowBtn.disabled = true; }
        showToast('✅ Generate สำเร็จ: ' + genForceSlug);
      } else {
        resultDiv.style.cssText = 'display:block;padding:12px;border-radius:8px;font-size:13px;margin-bottom:0;line-height:1.6;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);color:var(--red)';
        resultDiv.textContent = '❌ ' + (data.error || 'Generate ไม่สำเร็จ');
        startBtn.disabled    = false;
        startBtn.textContent = '🔄 ลองใหม่';
        // แสดง error log
        if (data.error) {
          document.getElementById('genforce-log-wrap').style.display = '';
          document.getElementById('genforce-log').textContent = data.error;
        }
        showToast('❌ Generate ไม่สำเร็จ');
      }

    } catch (e) {
      clearInterval(stepTimer);
      progress.style.display = 'none';
      closeBtn.disabled      = false;
      cancelBtn.disabled     = false;
      cancelBtn.textContent  = 'ปิด';
      genForceRunning        = false;
      resultDiv.style.cssText = 'display:block;padding:12px;border-radius:8px;font-size:13px;line-height:1.6;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);color:var(--red)';
      resultDiv.textContent  = '❌ เชื่อมต่อไม่สำเร็จ: ' + e.message;
      startBtn.disabled    = false;
      startBtn.textContent = '🔄 ลองใหม่';
      showToast('❌ เชื่อมต่อ agent-hub ไม่สำเร็จ');
    }
  }
`;
}
module.exports = { getScriptsPost };
