'use strict';
/**
 * mammuang-bot.js — Combined Telegram bot (มะม่วง + อนิเมะ)
 *
 * Commands:
 *   /mammuang <concept>  →  txt2img kawaii + balloon → โพสต์ FB
 *   /anime <text>        →  IPAdapter anime + balloon → โพสต์ FB + IG
 *   /help                →  แสดงคำสั่งทั้งหมด
 *
 * ต้องตั้งใน .env: MAMMUANG_TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 * (fallback: ANIME_TELEGRAM_BOT_TOKEN, ANIME_TELEGRAM_CHAT_ID)
 * รัน: node agents/mammuang/mammuang-bot.js
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

const ROOT = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const { generateMammuang }    = require('./mammuang-gen');
const { expandConcept }        = require('./concept-expander');
const { generateAnime }        = require('../anime/anime-gen');
const { renderBalloonOnImage } = require('../anime/balloon-canvas');
const { postFacebookImage, postInstagramImage } = require('../anime/post-anime');

const TOKEN    = process.env.MAMMUANG_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID  = process.env.TELEGRAM_CHAT_ID || process.env.ANIME_TELEGRAM_CHAT_ID;
const ANIME_TPL = path.join(__dirname, '..', 'anime', 'active-template.json');
const MAM_GAL   = path.join(__dirname, 'gallery');
const ANIME_GAL = path.join(__dirname, '..', 'anime', 'gallery');
const LOCK      = path.join(__dirname, '.mammuang-bot.lock');

if (!TOKEN || !CHAT_ID) {
  console.error('❌ ขาด MAMMUANG_TELEGRAM_BOT_TOKEN หรือ TELEGRAM_CHAT_ID ใน .env');
  process.exit(1);
}

// ─── Telegram helpers ────────────────────────────────────────────────────────
function tg(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params);
    const req  = https.request({
      hostname: 'api.telegram.org', path: `/bot${TOKEN}/${method}`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({}); } }); });
    req.on('error', reject); req.write(body); req.end();
  });
}

const send = text => tg('sendMessage', { chat_id: CHAT_ID, text });

function tgSendPhoto(imagePath, caption, replyMarkup) {
  return new Promise((resolve, reject) => {
    const boundary = '----TGBot' + Date.now();
    const parts = [];
    const field  = (n, v) => parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`));
    field('chat_id', CHAT_ID);
    if (caption)     field('caption', caption.substring(0, 1024));
    if (replyMarkup) field('reply_markup', JSON.stringify(replyMarkup));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="image.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`));
    parts.push(fs.readFileSync(imagePath));
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const payload = Buffer.concat(parts);
    https.request({
      hostname: 'api.telegram.org', path: `/bot${TOKEN}/sendPhoto`, method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': payload.length },
    }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({}); } }); })
      .on('error', reject).end(payload);
  });
}

function tgDownloadPhoto(fileId) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.telegram.org/bot${TOKEN}/getFile?file_id=${fileId}`, r => {
      let b = ''; r.on('data', d => b += d); r.on('end', () => {
        let fp; try { fp = JSON.parse(b).result.file_path; } catch { return reject(new Error('getFile fail')); }
        const out = path.join(os.tmpdir(), `tg_${Date.now()}.jpg`);
        const ws  = fs.createWriteStream(out);
        https.get(`https://api.telegram.org/file/bot${TOKEN}/${fp}`, fr => {
          fr.pipe(ws); ws.on('finish', () => { ws.close(); resolve(out); });
        }).on('error', reject);
      });
    }).on('error', reject);
  });
}

// ─── /mammuang handler ───────────────────────────────────────────────────────
let busy = false;

async function handleMammuang(concept) {
  if (busy) return send('⏳ กำลังสร้างรูปอยู่ รอสักครู่นะคะ');
  busy = true;
  try {
    await send(`🥭 กำลังขยาย concept… "${concept.substring(0, 40)}"`);
    let speech = concept, prompt_en = '';
    try {
      const refPath2 = path.join(__dirname, 'ref-character.png');
      const fluxMode = fs.existsSync(refPath2);
      const exp = await expandConcept([{ role: 'user', content: concept }], { fluxMode });
      speech    = exp.speech    || concept;
      prompt_en = exp.prompt_en || '';
    } catch (e) { console.warn('[mammuang] expandConcept failed:', e.message); }

    await send('🎨 กำลังสร้างรูป…');
    const id  = Date.now().toString();
    const dir = path.join(MAM_GAL, id);
    fs.mkdirSync(dir, { recursive: true });
    const imgPath   = path.join(dir, 'image.png');
    const finalPath = path.join(dir, 'final.jpg');

    const refPath = path.join(__dirname, 'ref-character.png');
    await generateMammuang({ prompt_en: prompt_en || concept, outPath: imgPath,
      model: fs.existsSync(refPath) ? 'flux-kontext' : undefined,
      onProgress: m => console.log(`  [mammuang ${id}] ${m}`) });
    await renderBalloonOnImage(imgPath, speech, { x: 0.46, y: 0.46 }, finalPath);
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ concept, speech, prompt_en, created: Number(id) }, null, 2));

    await tgSendPhoto(finalPath,
      `🥭 รูปใหม่พร้อมแล้ว\n💬 "${speech.substring(0, 80)}"\n\nโพสต์ Facebook?`, {
      inline_keyboard: [[
        { text: '✅ โพสต์ FB',    callback_data: `mam_ok__${id}` },
        { text: '🔄 สร้างใหม่',  callback_data: `mam_regen__${id}` },
        { text: '❌ ยกเลิก',      callback_data: `mam_no__${id}` },
      ]],
    });
  } catch (e) {
    await send('❌ สร้างรูปไม่สำเร็จ: ' + e.message.substring(0, 150));
  } finally { busy = false; }
}

// ─── /anime handler ──────────────────────────────────────────────────────────
let pendingAnimeSource = null;

async function handleAnime(text, overrideSource) {
  if (busy) return send('⏳ กำลังสร้างรูปอยู่ รอสักครู่นะคะ');
  let tpl; try { tpl = JSON.parse(fs.readFileSync(ANIME_TPL, 'utf8').replace(/^﻿/, '')); } catch { tpl = null; }
  const src = overrideSource || pendingAnimeSource || (tpl && tpl.sourceImage);
  if (!src || !fs.existsSync(src))
    return send('⚠️ ยังไม่มีรูปต้นแบบ anime — ส่งรูปเข้ามา หรือตั้ง template ที่ Dashboard ก่อน');
  pendingAnimeSource = null;
  busy = true;
  try {
    await send(`🎌 กำลังสร้างรูป anime… "${text.substring(0, 40)}"`);
    const id   = Date.now().toString();
    const dir  = path.join(ANIME_GAL, id);
    fs.mkdirSync(dir, { recursive: true });
    const animePath = path.join(dir, 'anime.png');
    const finalPath = path.join(dir, 'final.jpg');
    const faceWeight = (tpl && tpl.faceWeight) || 1.1;
    const tailFrac   = (tpl && tpl.tailFrac)   || { x: 0.46, y: 0.46 };

    await generateAnime(src, { prompt: (tpl && tpl.prompt) || '1person, upper body',
      faceWeight, loraStrength: Math.max(0.6, Math.min(1.0, faceWeight * 0.75)),
      outPath: animePath, onProgress: m => console.log(`  [anime ${id}] ${m}`) });
    await renderBalloonOnImage(animePath, text, tailFrac, finalPath);
    try { fs.copyFileSync(src, path.join(dir, 'source.jpg')); } catch {}
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ text, faceWeight, balloon: { tailFrac }, created: Number(id) }, null, 2));

    await tgSendPhoto(finalPath,
      `🎌 รูป anime พร้อมแล้ว\n💬 "${text.substring(0, 80)}"\n\nโพสต์ FB + IG?`, {
      inline_keyboard: [[
        { text: '✅ โพสต์ FB+IG', callback_data: `ani_ok__${id}` },
        { text: '❌ ยกเลิก',      callback_data: `ani_no__${id}` },
      ]],
    });
  } catch (e) {
    await send('❌ สร้างรูปไม่สำเร็จ: ' + e.message.substring(0, 150));
  } finally { busy = false; }
}

// ─── Callback handler ────────────────────────────────────────────────────────
async function handleCallback(cb) {
  const data  = cb.data || '';
  const msgId = cb.message && cb.message.message_id;
  await tg('answerCallbackQuery', { callback_query_id: cb.id });

  const [prefix, action, id] = data.split('__');  // e.g. mam_ok__12345
  const agent  = prefix === 'mam' ? 'mammuang' : 'anime';
  const galDir = agent === 'mammuang' ? MAM_GAL : ANIME_GAL;
  const dir    = path.join(galDir, String(id || '').replace(/[^\d]/g, ''));
  const finalPath = path.join(dir, 'final.jpg');
  const metaPath  = path.join(dir, 'meta.json');

  if (action === 'no') {
    if (msgId) await tg('editMessageCaption', { chat_id: CHAT_ID, message_id: msgId, caption: '❌ ยกเลิกแล้ว' });
    return;
  }
  if (action === 'regen' && agent === 'mammuang') {
    if (busy) { await send('⏳ กำลังสร้างรูปอยู่ รอสักครู่นะคะ'); return; }
    if (!fs.existsSync(metaPath)) { await send('⚠️ ไม่พบข้อมูลเดิม'); return; }
    let meta; try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { await send('⚠️ อ่าน meta ไม่ได้'); return; }
    if (msgId) await tg('editMessageCaption', { chat_id: CHAT_ID, message_id: msgId, caption: '🔄 กำลังสร้างใหม่…' });
    busy = true;
    try {
      const newId   = Date.now().toString();
      const newDir  = path.join(MAM_GAL, newId);
      fs.mkdirSync(newDir, { recursive: true });
      const imgPath    = path.join(newDir, 'image.png');
      const finalPath2 = path.join(newDir, 'final.jpg');
      const refPath = path.join(__dirname, 'ref-character.png');
      await generateMammuang({ prompt_en: meta.prompt_en || meta.concept, outPath: imgPath,
        model: fs.existsSync(refPath) ? 'flux-kontext' : undefined,
        onProgress: m => console.log(`  [mammuang regen ${newId}] ${m}`) });
      await renderBalloonOnImage(imgPath, meta.speech || meta.concept, { x: 0.46, y: 0.46 }, finalPath2);
      fs.writeFileSync(path.join(newDir, 'meta.json'), JSON.stringify({ ...meta, created: Number(newId) }, null, 2));
      await tgSendPhoto(finalPath2,
        `🔄 สร้างใหม่แล้ว\n💬 "${(meta.speech || meta.concept).substring(0, 80)}"\n\nโพสต์ Facebook?`, {
        inline_keyboard: [[
          { text: '✅ โพสต์ FB',    callback_data: `mam_ok__${newId}` },
          { text: '🔄 สร้างใหม่',  callback_data: `mam_regen__${newId}` },
          { text: '❌ ยกเลิก',      callback_data: `mam_no__${newId}` },
        ]],
      });
    } catch (e) {
      await send('❌ สร้างใหม่ไม่สำเร็จ: ' + e.message.substring(0, 150));
    } finally { busy = false; }
    return;
  }
  if (action === 'ok') {
    if (!fs.existsSync(finalPath)) return send('⚠️ ไม่พบรูป');
    let caption = '';
    try { const m = JSON.parse(fs.readFileSync(metaPath, 'utf8')); caption = m.speech || m.text || ''; } catch {}
    const results = [];
    try { await postFacebookImage(finalPath, caption); results.push('✅ Facebook'); } catch (e) { results.push('❌ FB: ' + e.message.substring(0, 60)); }
    if (agent === 'anime') {
      try { await postInstagramImage(finalPath, caption); results.push('✅ Instagram'); } catch (e) { results.push('❌ IG: ' + e.message.substring(0, 60)); }
    }
    await send(results.join('\n'));
    if (msgId) await tg('editMessageCaption', { chat_id: CHAT_ID, message_id: msgId, caption: '✅ โพสต์แล้ว' });
    try { const m = JSON.parse(fs.readFileSync(metaPath, 'utf8')); m.posted = { ts: Date.now() }; fs.writeFileSync(metaPath, JSON.stringify(m, null, 2)); } catch {}
  }
}

// ─── Long-poll loop ───────────────────────────────────────────────────────────
const HELP = `🥭 คำสั่งที่ใช้ได้:
/mammuang <concept> — สร้างรูปมะม่วง kawaii → โพสต์ FB
/anime <text>       — สร้างรูปอนิเมะ + balloon → โพสต์ FB+IG
/help               — แสดงคำสั่ง`;

async function poll() {
  let offset = 0;
  console.log('🥭🎌 combined-bot เริ่มทำงาน');
  await send('🥭🎌 Bot พร้อมแล้ว!\n' + HELP);
  while (true) {
    try {
      const res = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
      if (res.ok && res.result.length) {
        for (const u of res.result) {
          offset = u.update_id + 1;
          const m = u.message;
          if (m && String(m.chat.id) === String(CHAT_ID)) {
            if (m.photo && m.photo.length) {
              // รูปเข้ามา → เก็บเป็น anime source
              try {
                pendingAnimeSource = await tgDownloadPhoto(m.photo[m.photo.length - 1].file_id);
                if (m.caption) await handleAnime(m.caption, pendingAnimeSource);
                else await send('📷 รับรูป anime source แล้ว — พิมพ์ /anime <text> ได้เลยค่ะ');
              } catch (e) { await send('❌ ดาวน์โหลดรูปไม่สำเร็จ'); }
            } else if (m.text) {
              const txt = m.text.trim();
              if (txt.startsWith('/mammuang ')) await handleMammuang(txt.slice(10).trim());
              else if (txt.startsWith('/anime '))   await handleAnime(txt.slice(7).trim());
              else if (txt === '/help')              await send(HELP);
              else await send('❓ ไม่รู้จักคำสั่ง\n' + HELP);
            }
          } else if (u.callback_query && String(u.callback_query.message.chat.id) === String(CHAT_ID)) {
            await handleCallback(u.callback_query);
          }
        }
      }
    } catch (e) { console.error('poll error:', e.message); await new Promise(r => setTimeout(r, 3000)); }
  }
}

// ─── Single instance lock ─────────────────────────────────────────────────────
try {
  if (fs.existsSync(LOCK)) {
    const pid = parseInt(fs.readFileSync(LOCK, 'utf8'));
    try { process.kill(pid, 0); console.error('❌ bot รันอยู่แล้ว (PID ' + pid + ')'); process.exit(1); } catch {}
  }
  fs.writeFileSync(LOCK, String(process.pid));
  process.on('exit', () => { try { fs.unlinkSync(LOCK); } catch {} });
  process.on('SIGINT', () => process.exit(0));
} catch {}

poll();
