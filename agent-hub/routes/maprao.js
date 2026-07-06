'use strict';
/**
 * agent-hub/routes/maprao.js
 * Routes: /dashboard/maprao | /api/maprao/* | /dashboard/maprao/comic/:id
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mascot = require('../../agents/maprao/pipeline/mascot');
const { renderDashboard } = require('../html/maprao');
const { sendApprovalNotification } = require('../../lib/tg-approval');
const { postNow } = require('../../lib/namkhao-bot-news');
const { summarizeNewsToStory } = require('../../agents/maprao/pipeline/news-to-story');

function reply(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function getBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve({}); } });
  });
}

function readMeta(ROOT, id) {
  const p = path.join(ROOT, 'agents', 'maprao', 'gallery', id, 'meta.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function getGallery(ROOT) {
  const dir = path.join(ROOT, 'agents', 'maprao', 'gallery');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().reverse().slice(0, 20)
    .map(id => { const m = readMeta(ROOT, id); return m ? { id, ...m } : null; })
    .filter(Boolean);
}

function spawnRun(ROOT, args) {
  const proc = spawn(process.execPath, [path.join(ROOT, 'agents', 'maprao', 'run.js'), ...args],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env } });
  proc.on('error', e => console.error(`[maprao] spawn error: ${e.message}`));
  proc.on('exit', code => console.log(`[maprao] run.js exit: ${code}`));
}

function register(req, res, url, rawUrl, method, deps) {
  const { ROOT } = deps;

  if (url === '/dashboard/maprao') {
    const gallery = getGallery(ROOT);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderDashboard(ROOT, { gallery }));
  }

  if (url === '/api/maprao/mascot/generate' && method === 'POST') {
    spawnRun(ROOT, ['--action', 'gen-mascot-ref']);
    return reply(res, 200, { ok: true, generating: true });
  }

  if (url === '/api/maprao/generate' && method === 'POST') {
    return getBody(req).then(body => {
      const prompt = (body.prompt || '').trim();
      if (!prompt) return reply(res, 400, { ok: false, error: 'ต้องระบุ prompt' });
      if (!mascot.refPath()) return reply(res, 409, { ok: false, error: 'ยังไม่มี Mascot Ref — กดสร้างก่อน' });
      const id = Date.now().toString();
      reply(res, 200, { ok: true, id });
      spawnRun(ROOT, ['--action', 'comic', '--id', id, '--prompt', prompt]);
    }).catch(e => { if (!res.headersSent) reply(res, 500, { ok: false, error: e.message }); });
  }

  // ── News feed (7 วันล่าสุด จาก manao + makrut) ─────────────────────────────
  if (url === '/api/maprao/news' && method === 'GET') {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const news = [];
    for (const [src, nd] of [
      ['manao',  path.join(ROOT, 'agents', 'manao',  'pipeline', 'news')],
      ['makrut', path.join(ROOT, 'agents', 'makrut', 'pipeline', 'news')],
    ]) {
      if (!fs.existsSync(nd)) continue;
      for (const slug of fs.readdirSync(nd)) {
        const dp = path.join(nd, slug, 'data.json');
        if (!fs.existsSync(dp)) continue;
        try {
          const d = JSON.parse(fs.readFileSync(dp, 'utf8'));
          const ts = new Date(d.scraped_at || d.published_at || 0).getTime();
          if (ts < cutoff) continue;
          news.push({ source: src, slug, title: d.title, published_at: d.published_at, scraped_at: d.scraped_at });
        } catch {}
      }
    }
    news.sort((a, b) => new Date(b.scraped_at || b.published_at) - new Date(a.scraped_at || a.published_at));
    return reply(res, 200, { ok: true, news: news.slice(0, 30) });
  }

  // ── สร้างการ์ตูน/วิดีโอ จากข่าว ─────────────────────────────────────────────
  if (url === '/api/maprao/generate-from-news' && method === 'POST') {
    return getBody(req).then(async body => {
      const { source, slug, mode } = body;
      if (!source || !slug) return reply(res, 400, { ok: false, error: 'ต้องระบุ source + slug' });
      if (!mascot.refPath()) return reply(res, 409, { ok: false, error: 'ยังไม่มี Mascot Ref — กดสร้างก่อน' });
      const dp = path.join(ROOT, 'agents', source, 'pipeline', 'news', slug, 'data.json');
      if (!fs.existsSync(dp)) return reply(res, 404, { ok: false, error: 'ไม่พบข้อมูลข่าว' });
      const data = JSON.parse(fs.readFileSync(dp, 'utf8'));
      const storyPrompt = await summarizeNewsToStory(data.title, data.body || '');
      const id = Date.now().toString();
      reply(res, 200, { ok: true, id, storyPrompt });
      const runArgs = ['--action', 'comic', '--id', id, '--prompt', storyPrompt];
      if (mode === 'video') runArgs.push('--mode', 'video');
      spawnRun(ROOT, runArgs);
    }).catch(e => { if (!res.headersSent) reply(res, 500, { ok: false, error: e.message }); });
  }

  const comicMatch = url.match(/^\/dashboard\/maprao\/comic\/([\w]+)$/);
  if (comicMatch) {
    const cp = path.join(ROOT, 'agents', 'maprao', 'gallery', comicMatch[1], 'comic.png');
    if (!fs.existsSync(cp)) { res.writeHead(404); return res.end('ไม่พบการ์ตูน'); }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache', 'Content-Length': fs.statSync(cp).size });
    return fs.createReadStream(cp).pipe(res);
  }

  const statusMatch = url.match(/^\/api\/maprao\/status\/([\w]+)$/);
  if (statusMatch && method === 'GET') {
    const m = readMeta(ROOT, statusMatch[1]);
    if (!m) return reply(res, 404, { ok: false, error: 'ไม่พบ' });
    return reply(res, 200, { ok: true, ...m });
  }

  if (url === '/api/maprao/status' && method === 'GET') {
    return reply(res, 200, { ok: true, gallery: getGallery(ROOT), mascotReady: !!mascot.refPath() });
  }

  // serve mascot PNG: /dashboard/maprao/mascot (default) or /dashboard/maprao/mascot/:id
  const mascotServeMatch = url.match(/^\/dashboard\/maprao\/mascot(?:\/([\w]+))?$/);
  if (mascotServeMatch && method === 'GET') {
    const id = mascotServeMatch[1];
    const mp = id
      ? path.join(ROOT, 'agents', 'maprao', 'mascot', id + '.png')
      : mascot.refPath();
    if (!mp || !fs.existsSync(mp)) { res.writeHead(404); return res.end('ไม่พบ mascot'); }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(mp).pipe(res);
  }

  // mascot list
  if (url === '/api/maprao/mascots' && method === 'GET') {
    const all = mascot.list();
    const defId = mascot.defaultId();
    return reply(res, 200, { ok: true, mascots: all.map(m => ({ id: m.id })), defaultId: defId });
  }

  // mascot set-default
  const mascotDefaultMatch = url.match(/^\/api\/maprao\/mascots\/([\w]+)\/default$/);
  if (mascotDefaultMatch && method === 'POST') {
    const id = mascotDefaultMatch[1];
    const p = path.join(ROOT, 'agents', 'maprao', 'mascot', id + '.png');
    if (!fs.existsSync(p)) return reply(res, 404, { ok: false, error: 'ไม่พบ mascot' });
    mascot.setDefault(id);
    return reply(res, 200, { ok: true });
  }

  // mascot delete
  const mascotDelMatch = url.match(/^\/api\/maprao\/mascots\/([\w]+)$/);
  if (mascotDelMatch && method === 'DELETE') {
    const id = mascotDelMatch[1];
    const p = path.join(ROOT, 'agents', 'maprao', 'mascot', id + '.png');
    if (!fs.existsSync(p)) return reply(res, 404, { ok: false, error: 'ไม่พบ mascot' });
    fs.unlinkSync(p);
    if (mascot.defaultId() === id) {
      const remaining = mascot.list();
      if (remaining.length) mascot.setDefault(remaining[remaining.length - 1].id);
    }
    return reply(res, 200, { ok: true });
  }

  // ── Gallery per-item actions ────────────────────────────────────────────────
  const galMatch = url.match(/^\/api\/maprao\/gallery\/([\w]+)(\/[\w]+)?$/);
  if (galMatch) {
    const id = galMatch[1].replace(/[^\w]/g, '');
    const sub = galMatch[2] || '';
    const galDir = path.join(ROOT, 'agents', 'maprao', 'gallery', id);
    const newsDir = path.join(ROOT, 'agents', 'maprao', 'pipeline', 'news');
    const pipelineRoot = path.join(ROOT, 'agents', 'maprao', 'pipeline');

    if (sub === '/post' && method === 'POST') {
      if (!fs.existsSync(path.join(galDir, 'comic.png'))) return reply(res, 404, { ok: false, error: 'ไม่พบรูป' });
      res._claimed = true;
      postNow(newsDir, id, 'fb').then(({ code, output }) => {
        if (code !== 0) {
          if (!res.headersSent) reply(res, 500, { ok: false, error: output.slice(-300) });
          return;
        }
        try {
          const dp = path.join(newsDir, id, 'data.json');
          const d = JSON.parse(fs.readFileSync(dp, 'utf8'));
          d.status = 'posted'; d.posted_at = new Date().toISOString();
          fs.writeFileSync(dp, JSON.stringify(d, null, 2));
        } catch {}
        if (!res.headersSent) reply(res, 200, { ok: true });
      }).catch(e => { if (!res.headersSent) reply(res, 500, { ok: false, error: e.message.substring(0, 200) }); });
      return;
    }

    if (sub === '/resend' && method === 'POST') {
      const dp = path.join(newsDir, id, 'data.json');
      const fp = path.join(newsDir, id, 'content', 'facebook.md');
      if (!fs.existsSync(dp) || !fs.existsSync(fp)) return reply(res, 404, { ok: false, error: 'ไม่พบข้อมูล pipeline' });
      const data = JSON.parse(fs.readFileSync(dp, 'utf8'));
      const master = fs.readFileSync(fp, 'utf8');
      res._claimed = true;
      sendApprovalNotification(id, data, master, { pipelineRoot, newsDir, mode: 'immediate', emoji: '🥥', kind: 'การ์ตูนใหม่' })
        .then(() => { if (!res.headersSent) reply(res, 200, { ok: true }); })
        .catch(e => { if (!res.headersSent) reply(res, 500, { ok: false, error: e.message.substring(0, 200) }); });
      return;
    }

    if (sub === '/video' && method === 'POST') {
      if (!fs.existsSync(path.join(galDir, 'comic.png'))) return reply(res, 404, { ok: false, error: 'ไม่พบรูป' });
      spawnRun(ROOT, ['--action', 'video', '--id', id]);
      return reply(res, 200, { ok: true, generating: true });
    }

    if (!sub && method === 'DELETE') {
      if (!fs.existsSync(galDir)) return reply(res, 404, { ok: false, error: 'ไม่พบรายการ' });
      fs.rmSync(galDir, { recursive: true, force: true });
      return reply(res, 200, { ok: true });
    }
  }
}

module.exports = { register };
