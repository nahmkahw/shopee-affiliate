'use strict';
/**
 * agent-hub/routes/mayom.js — Agent มะยม (LINE Money Slip Logger)
 * Routes:
 *   POST /webhook/line/mayom        ← LINE webhook (ยกเว้น auth, verify X-Line-Signature)
 *   GET  /dashboard/mayom           ← dashboard (สรุป + ตาราง)
 *   GET  /dashboard/mayom/slip/:id  ← รูปสลิป
 *   PATCH  /api/mayom/tx/:id         ← แก้รายการ
 *   DELETE /api/mayom/tx/:id         ← ลบรายการ
 *   POST   /api/mayom/alias          ← ตั้งชื่อเล่น user
 */

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { verifySignature } = require('../../lib/line-client');
const store     = require('../../agents/mayom/store');
const summarize = require('../../agents/mayom/summarize');
const { renderDashboard } = require('../html/mayom');

function reply(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function rawBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function spawnRun(ROOT, args) {
  const proc = spawn(process.execPath, [path.join(ROOT, 'agents', 'mayom', 'run.js'), ...args],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env } });
  proc.on('error', e => console.error('[mayom] spawn error:', e.message));
}

// ── แปลง event LINE → spawn run.js (image=process-slip, text=caption) ──────────
function dispatchEvents(ROOT, events, allowedGroup) {
  for (const ev of events) {
    if (ev.type !== 'message') continue;
    const src = ev.source || {};
    const groupId = src.groupId || src.roomId || '';
    if (allowedGroup && groupId !== allowedGroup) {
      console.log('[mayom] ข้าม event จากกลุ่มอื่น:', groupId);
      continue;
    }
    const userId = src.userId || 'unknown';
    if (ev.message.type === 'image') {
      spawnRun(ROOT, ['--action', 'process-slip', '--message-id', ev.message.id,
        '--user-id', userId, '--group-id', groupId, ...(ev.replyToken ? ['--reply-token', ev.replyToken] : [])]);
    } else if (ev.message.type === 'text' && ev.message.text) {
      spawnRun(ROOT, ['--action', 'caption', '--user-id', userId, '--text', ev.message.text]);
    }
  }
}

function parseQuery(rawUrl) {
  const q = {};
  const qs = rawUrl.split('?')[1];
  if (qs) new URLSearchParams(qs).forEach((v, k) => { if (v) q[k] = v; });
  return q;
}

async function register(req, res, url, rawUrl, method, deps) {
  const { ROOT } = deps;

  // ── LINE webhook (ต้องยกเว้น auth ใน auth.js แล้ว) ──
  if (url === '/webhook/line/mayom' && method === 'POST') {
    const buf = await rawBody(req);
    const secret = process.env.MAYOM_LINE_CHANNEL_SECRET || '';
    const sig = req.headers['x-line-signature'];
    if (!verifySignature(buf, sig, secret)) {
      console.warn('[mayom] webhook signature ไม่ผ่าน');
      res.writeHead(401); return res.end('bad signature');
    }
    // ตอบ 200 ทันที แล้วค่อยประมวลผล (LINE บังคับตอบเร็ว)
    res.writeHead(200); res.end('OK');
    try {
      const body = JSON.parse(buf.toString() || '{}');
      dispatchEvents(ROOT, body.events || [], process.env.MAYOM_LINE_GROUP_ID || '');
    } catch (e) { console.error('[mayom] webhook parse:', e.message); }
    return;
  }

  // ── Dashboard ──
  if (url === '/dashboard/mayom' && method === 'GET') {
    const q = parseQuery(rawUrl);
    const filter = { from: q.from, to: q.to, user: q.user, category: q.category };
    const summary = summarize.build(filter);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderDashboard(summary, filter));
  }

  // ── รูปสลิป ──
  const slipMatch = url.match(/^\/dashboard\/mayom\/slip\/(\w+)$/);
  if (slipMatch && method === 'GET') {
    const p = store.slipPath(slipMatch[1]);
    if (!fs.existsSync(p)) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': fs.statSync(p).size });
    return fs.createReadStream(p).pipe(res);
  }

  // ── แก้รายการ ──
  const txMatch = url.match(/^\/api\/mayom\/tx\/(\w+)$/);
  if (txMatch && method === 'PATCH') {
    const buf = await rawBody(req);
    let patch = {};
    try { patch = JSON.parse(buf.toString() || '{}'); } catch {}
    const updated = store.updateTx(txMatch[1], patch);
    return updated ? reply(res, 200, { ok: true }) : reply(res, 404, { ok: false, error: 'ไม่พบรายการ' });
  }
  if (txMatch && method === 'DELETE') {
    if (!store.getTx(txMatch[1])) return reply(res, 404, { ok: false, error: 'ไม่พบรายการ' });
    store.deleteTx(txMatch[1]);
    return reply(res, 200, { ok: true });
  }

  // ── ตั้งชื่อเล่น user ──
  if (url === '/api/mayom/alias' && method === 'POST') {
    const buf = await rawBody(req);
    let body = {};
    try { body = JSON.parse(buf.toString() || '{}'); } catch {}
    if (!body.user) return reply(res, 400, { ok: false, error: 'ต้องระบุ user' });
    store.setAlias(body.user, body.alias || '');
    return reply(res, 200, { ok: true });
  }
}

module.exports = { register };
