'use strict';
/**
 * agent-hub/routes/anime.js
 * exports register(req, res, url, rawUrl, method, deps) — /dashboard/anime/*
 */

const fs   = require('fs');
const path = require('path');

function parseMultipart(buffer, contentType) {
  const m = /boundary=(.+)$/.exec(contentType || '');
  if (!m) return null;
  const boundary = '--' + m[1].trim().replace(/^"|"$/g, '');
  const bBuf = Buffer.from(boundary);
  const fields = {};
  let file = null;

  let start = buffer.indexOf(bBuf);
  while (start !== -1) {
    const next = buffer.indexOf(bBuf, start + bBuf.length);
    if (next === -1) break;
    // ส่วนของ part (ข้าม \r\n หลัง boundary)
    let part = buffer.slice(start + bBuf.length + 2, next - 2);  // -2 ตัด \r\n ท้าย
    const headEnd = part.indexOf('\r\n\r\n');
    if (headEnd !== -1) {
      const header = part.slice(0, headEnd).toString('utf8');
      const body   = part.slice(headEnd + 4);
      const nameM  = /name="([^"]*)"/.exec(header);
      const fileM  = /filename="([^"]*)"/.exec(header);
      if (nameM) {
        if (fileM && fileM[1]) {
          file = { field: nameM[1], filename: fileM[1], data: body };
        } else {
          fields[nameM[1]] = body.toString('utf8');
        }
      }
    }
    start = next;
  }
  return { fields, file };
}

function handleAnimeGenerate(req, res) {
  const chunks = [];
  let size = 0;
  req.on('data', d => { chunks.push(d); size += d.length; if (size > 20 * 1024 * 1024) req.destroy(); });
  req.on('end', async () => {
    const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
    try {
      const parsed = parseMultipart(Buffer.concat(chunks), req.headers['content-type']);
      const fields = (parsed && parsed.fields) || {};

      // โหลด active template (ใช้เป็น default — override ได้)
      let tpl = null;
      try { tpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'agents', 'anime', 'active-template.json'), 'utf8').replace(/^﻿/, '')); } catch {}

      const id     = Date.now().toString();
      const dir    = path.join(ROOT, 'agents', 'anime', 'gallery', id);
      fs.mkdirSync(dir, { recursive: true });

      const srcPath   = path.join(dir, 'source.jpg');
      const animePath = path.join(dir, 'anime.png');
      const finalPath = path.join(dir, 'final.jpg');

      // รูปต้นแบบ: ถ้าอัปโหลดมา = override, ถ้าไม่ = ใช้ของ template
      if (parsed && parsed.file) {
        fs.writeFileSync(srcPath, parsed.file.data);
      } else if (tpl && tpl.sourceImage && fs.existsSync(tpl.sourceImage)) {
        fs.copyFileSync(tpl.sourceImage, srcPath);
      } else {
        return reply(400, { ok: false, error: 'ไม่พบรูปต้นแบบ — อัปโหลดรูป หรือ ตั้ง template ก่อน' });
      }

      // prompt / faceWeight: ใช้ค่าที่ส่งมา > template > default
      const prompt = (fields.prompt || (tpl && tpl.prompt) || '1girl, solo, upper body').trim();
      const text   = fields.text || '';
      let faceWeight = parseFloat(fields.faceWeight);
      if (isNaN(faceWeight)) faceWeight = (tpl && tpl.faceWeight) || 1.1;
      faceWeight = Math.max(0.6, Math.min(1.6, faceWeight));
      const loraStrength = Math.max(0.6, Math.min(1.0, faceWeight * 0.75));

      console.log(`[Hub] 🎨 anime generate: ${id} — face=${faceWeight} "${prompt.substring(0, 40)}"`);
      await generateAnime(srcPath, { prompt, outPath: animePath, faceWeight, loraStrength,
        onProgress: msg => console.log(`  [anime ${id}] ${msg}`) });

      // final.jpg เริ่มต้น = สำเนา anime (กรณียังไม่ได้วาด balloon)
      // balloon + ข้อความจะถูกวาดฝั่งเบราว์เซอร์แล้วส่งมาบันทึกผ่าน /api/finalize
      fs.copyFileSync(animePath, finalPath);

      fs.writeFileSync(path.join(dir, 'meta.json'),
        JSON.stringify({ prompt, text, faceWeight, created: Number(id) }, null, 2), 'utf8');

      console.log(`[Hub] ✅ anime generate เสร็จ: ${id}`);
      reply(200, { ok: true, id });
    } catch (e) {
      console.log(`[Hub] ❌ anime generate error: ${e.message}`);
      reply(200, { ok: false, error: e.message.substring(0, 300) });
    }
  });
}

module.exports = {
  readStatus, writeStatus, readLog,
  startAgent, stopAgent,
  buildComfyWorkflow,
  comfyPost, comfyGet, comfyGetBinary,
  spawnStep, runPipelineSequential,
  parseSchedCSV,
  escHtml, statusBadge, tgEscape,
  buildMainPage, buildAgentPage, buildShopeeHTML,
  serveNamkhaoHTML, serveNewsHTML,
  loadProducts, readShopeeEnv, readNewsEnv,
  getNewsItems, getNewsBotStatus, getNewsPipelineInfo, buildNewsApiData,
  getScheduleStatus, editScheduleTimes, toggleScheduleTask, runScheduleNow,
  parseMultipart,
  server,
};

if (require.main === module) server.listen(PORT, () => {
  console.log('\n🤖 Agent Hub — Single Server');
  console.log(`🌐 http://localhost:${PORT}`);
  console.log('');
  console.log('Agents:');
  Object.entries(AGENTS).forEach(([n, c]) => console.log(`  ${c.emoji} ${c.label} → http://localhost:${PORT}/agent/${n}`));
  console.log('');
  console.log('Dashboards:');
  console.log(`  🌸 Shopee  → http://localhost:${PORT}/dashboard/mali`);
  console.log(`  🍋 AI News → http://localhost:${PORT}/dashboard/manao`);
  console.log('');

  // ── Auto-start น้ำข้าว Telegram Bot ────────────────────────────────────────
  (() => {
    const botScript = path.join(ROOT, 'agents', 'namkhao', 'telegram-bot.js');
    const pidFile   = path.join(ROOT, 'agents', 'namkhao', 'telegram-bot.pid');

    // ตรวจว่า bot กำลังรันอยู่แล้วไหม
    let alreadyRunning = false;
    if (fs.existsSync(pidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
        process.kill(pid, 0); // ถ้าไม่ throw = ยังรันอยู่
        alreadyRunning = true;
        console.log(`🍚 น้ำข้าว Telegram Bot กำลังรันอยู่แล้ว (PID: ${pid})`);
      } catch {
        fs.unlinkSync(pidFile); // process ตายแล้ว ลบ pid เก่า
      }
    }

    if (!alreadyRunning && fs.existsSync(botScript)) {
      const bot = spawn(process.execPath, [botScript], {
        cwd: ROOT, detached: true, stdio: 'ignore'
      });
      bot.unref();
      console.log(`🍚 น้ำข้าว Telegram Bot เริ่มแล้ว (PID: ${bot.pid})`);
    }
  })();

  // ── Auto-start อนิเมะ Telegram Bot (ถ้าตั้ง token แล้ว) ─────────────────────
  (() => {
    if (!process.env.ANIME_TELEGRAM_BOT_TOKEN || !process.env.ANIME_TELEGRAM_CHAT_ID) {
      console.log('🎨 anime-bot: ข้าม (ยังไม่ตั้ง ANIME_TELEGRAM_BOT_TOKEN/CHAT_ID ใน .env)');
      return;
    }
    const botScript = path.join(ROOT, 'agents', 'anime', 'anime-bot.js');
    const lock      = path.join(ROOT, 'agents', 'anime', '.anime-bot.lock');
    let running = false;
    if (fs.existsSync(lock)) {
      try { process.kill(parseInt(fs.readFileSync(lock, 'utf8').trim()), 0); running = true; console.log('🎨 anime-bot กำลังรันอยู่แล้ว'); }
      catch { try { fs.unlinkSync(lock); } catch {} }
    }
    if (!running && fs.existsSync(botScript)) {
      const bot = spawn(process.execPath, [botScript], { cwd: ROOT, detached: true, stdio: 'ignore' });
      bot.unref();
      console.log(`🎨 anime-bot เริ่มแล้ว (PID: ${bot.pid})`);
    }
  })();

  // ── Auto-start AI-News (manao) Telegram Bot — handle approve callback ──────
  // เช็ค MANAO_TELEGRAM_BOT_TOKEN จาก pipeline/.env (bot โหลด .env นั้นเองตอนรัน)
  (() => {
    const envFile = path.join(AI_NEWS_DIR, '.env');
    let hasToken = false;
    try { hasToken = /^\s*MANAO_TELEGRAM_BOT_TOKEN\s*=\s*\S+/m.test(fs.readFileSync(envFile, 'utf8')); } catch {}
    if (!hasToken) {
      console.log('🍋 manao-bot: ข้าม (ยังไม่ตั้ง MANAO_TELEGRAM_BOT_TOKEN ใน agents/manao/pipeline/.env)');
      return;
    }
    const botScript = path.join(AI_NEWS_DIR, 'telegram-bot.js');
    const pidFile   = path.join(AI_NEWS_DIR, 'telegram-bot.pid');
    let running = false;
    if (fs.existsSync(pidFile)) {
      try { process.kill(parseInt(fs.readFileSync(pidFile, 'utf8').trim()), 0); running = true; console.log('🍋 manao-bot กำลังรันอยู่แล้ว'); }
      catch { try { fs.unlinkSync(pidFile); } catch {} }
    }
    if (!running && fs.existsSync(botScript)) {
      // cwd = AI_NEWS_DIR → bot โหลด pipeline/.env (ได้ MANAO token)
      const bot = spawn(process.execPath, [botScript], { cwd: AI_NEWS_DIR, detached: true, stdio: 'ignore' });
      bot.unref();
      console.log(`🍋 manao-bot (AI-News) เริ่มแล้ว (PID: ${bot.pid})`);
    }
  })();
});


function register(req, res, url, rawUrl, method, deps) {
  const { ROOT } = deps;

    // ── Dashboard: อนิเมะ (Anime Character Generator) ───────────────────────────
    if (url === '/dashboard/anime') {
      const htmlFile = path.join(ROOT, 'agents', 'anime', 'dashboard.html');
      if (!fs.existsSync(htmlFile)) { res.writeHead(404); return res.end('ไม่พบ dashboard.html ของ anime'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(htmlFile, 'utf8'));
    }
  
    // serve รูปในแกลเลอรี: /dashboard/anime/image/{id}/{file}
    const animeImg = url.match(/^\/dashboard\/anime\/image\/([\w.-]+)\/([\w.-]+)$/);
    if (animeImg) {
      const fp = path.join(ROOT, 'agents', 'anime', 'gallery', animeImg[1], animeImg[2]);
      if (!fs.existsSync(fp)) { res.writeHead(404); return res.end('Not found'); }
      const ext = path.extname(fp).toLowerCase();
      res.writeHead(200, { 'Content-Type': ext === '.png' ? 'image/png' : 'image/jpeg', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(fp).pipe(res);
    }
  
    // list แกลเลอรี
    if (url === '/dashboard/anime/api/list' && method === 'GET') {
      const galDir = path.join(ROOT, 'agents', 'anime', 'gallery');
      let items = [];
      try {
        items = fs.readdirSync(galDir)
          .filter(d => fs.existsSync(path.join(galDir, d, 'meta.json')))
          .map(id => { try { return { id, ...JSON.parse(fs.readFileSync(path.join(galDir, id, 'meta.json'), 'utf8')) }; } catch { return null; } })
          .filter(Boolean)
          .sort((a, b) => (b.created || 0) - (a.created || 0));
      } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(items));
    }
  
    // ดึง active template (Dashboard ใช้ prefill — template เป็น default)
    if (url === '/dashboard/anime/api/template' && method === 'GET') {
      let tpl = null;
      try { tpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'agents', 'anime', 'active-template.json'), 'utf8').replace(/^﻿/, '')); } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(JSON.stringify(tpl ? {
        templateId: tpl.templateId, prompt: tpl.prompt, faceWeight: tpl.faceWeight,
        tailFrac: tpl.tailFrac, time: tpl.time,
      } : null));
    }
  
    // สร้างรูป: รับ multipart (image + prompt + text + faceWeight)
    if (url === '/dashboard/anime/api/generate' && method === 'POST') {
      handleAnimeGenerate(req, res);
      return;
    }
  
    // บันทึกรูปที่วาด balloon แล้ว (จากเบราว์เซอร์) → final.jpg + อัปเดต meta
    if (url === '/dashboard/anime/api/finalize' && method === 'POST') {
      let body = '';
      req.on('data', d => { body += d; if (body.length > 256 * 1024) req.destroy(); });
      req.on('end', async () => {
        const reply = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
        try {
          // วาดลูกโป่งฝั่ง server (balloon-canvas.js) — ชุดเดียวกับ Telegram bot
          const { id, text = '', balloon } = JSON.parse(body || '{}');
          if (!id) return reply(400, { ok: false, error: 'missing id' });
          const dir = path.join(ROOT, 'agents', 'anime', 'gallery', String(id).replace(/[^\d]/g, ''));
          const animePath = path.join(dir, 'anime.png');
          if (!fs.existsSync(animePath)) return reply(404, { ok: false, error: 'ไม่พบรูป id นี้' });
  
          const tailFrac = (balloon && balloon.tailFrac) || { x: 0.46, y: 0.46 };
          await renderBalloonOnImage(animePath, text, tailFrac, path.join(dir, 'final.jpg'));
  
          try {
            const metaPath = path.join(dir, 'meta.json');
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8').replace(/^﻿/, ''));
            meta.text = text;
            meta.balloon = { tailFrac };
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
          } catch {}
  
          reply(200, { ok: true });
        } catch (e) { reply(200, { ok: false, error: e.message.substring(0, 200) }); }
      });
      return;
    }
  
    // โพสต์รูปอนิเมะไป FB/IG: { id, platforms:['fb','ig'], caption }
    if (url === '/dashboard/anime/api/post' && method === 'POST') {
      let body = '';
      req.on('data', d => { body += d; if (body.length > 1024 * 1024) req.destroy(); });
      req.on('end', async () => {
        const reply = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
        try {
          const { id, platforms = [], caption = '' } = JSON.parse(body || '{}');
          const cleanId = String(id).replace(/[^\d]/g, '');
          const imgPath = path.join(ROOT, 'agents', 'anime', 'gallery', cleanId, 'final.jpg');
          if (!cleanId || !fs.existsSync(imgPath)) return reply(404, { ok: false, error: 'ไม่พบรูป' });
  
          const results = {};
          if (platforms.includes('fb')) {
            try { const pid = await postFacebookImage(imgPath, caption); results.fb = { ok: true, id: pid }; console.log(`[Hub] 🎨→FB ${cleanId}: ${pid}`); }
            catch (e) { results.fb = { ok: false, error: e.message }; console.log(`[Hub] ❌ FB: ${e.message}`); }
          }
          if (platforms.includes('ig')) {
            try { const pid = await postInstagramImage(imgPath, caption); results.ig = { ok: true, id: pid }; console.log(`[Hub] 🎨→IG ${cleanId}: ${pid}`); }
            catch (e) { results.ig = { ok: false, error: e.message }; console.log(`[Hub] ❌ IG: ${e.message}`); }
          }
  
          // อัปเดต meta: posted platforms
          try {
            const mp = path.join(ROOT, 'agents', 'anime', 'gallery', cleanId, 'meta.json');
            const meta = JSON.parse(fs.readFileSync(mp, 'utf8').replace(/^﻿/, ''));
            meta.posted = meta.posted || {};
            for (const p of ['fb', 'ig']) if (results[p] && results[p].ok) meta.posted[p] = Date.now();
            if (caption) meta.caption = caption;
            fs.writeFileSync(mp, JSON.stringify(meta, null, 2), 'utf8');
          } catch {}
  
          reply(200, { ok: true, results });
        } catch (e) { reply(200, { ok: false, error: e.message.substring(0, 200) }); }
      });
      return;
    }
  
    // ตั้ง active template สำหรับ Telegram bot: { id, time }
    if (url === '/dashboard/anime/api/schedule' && method === 'POST') {
      let body = '';
      req.on('data', d => { body += d; if (body.length > 64 * 1024) req.destroy(); });
      req.on('end', () => {
        const reply = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
        try {
          const { id, time } = JSON.parse(body || '{}');
          const cleanId = String(id).replace(/[^\d]/g, '');
          const dir = path.join(ROOT, 'agents', 'anime', 'gallery', cleanId);
          const metaPath = path.join(dir, 'meta.json');
          const srcPath  = path.join(dir, 'source.jpg');
          if (!cleanId || !fs.existsSync(srcPath) || !fs.existsSync(metaPath))
            return reply(404, { ok: false, error: 'ไม่พบรูป/ต้นแบบ' });
          if (time && !/^\d{1,2}:\d{2}$/.test(time)) return reply(400, { ok: false, error: 'เวลาต้องเป็น HH:MM' });
  
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8').replace(/^﻿/, ''));
          const template = {
            templateId: cleanId,
            sourceImage: srcPath,
            prompt: meta.prompt || '1girl, solo, upper body',
            faceWeight: meta.faceWeight || 1.1,
            tailFrac: (meta.balloon && meta.balloon.tailFrac) || { x: 0.46, y: 0.46 },
            time: time || null,
            setAt: Date.now(),
          };
          fs.writeFileSync(path.join(ROOT, 'agents', 'anime', 'active-template.json'),
            JSON.stringify(template, null, 2), 'utf8');
          console.log(`[Hub] 📌 anime active template = ${cleanId}${time ? ' @ ' + time : ''}`);
          reply(200, { ok: true });
        } catch (e) { reply(200, { ok: false, error: e.message.substring(0, 200) }); }
      });
      return;
    }
  

  return false;
}

module.exports = { register, parseMultipart, handleAnimeGenerate };
