/**
 * auth.js — ระบบ login รหัสเดียวร่วม (shared password) สำหรับ Agent Hub
 *
 * - รหัสผ่านเก็บเป็น scrypt hash ใน .env → DASHBOARD_PASSWORD_HASH
 * - session แบบ cookie (HttpOnly) + เก็บ token ในไฟล์ .auth-sessions.json (อยู่รอด restart)
 * - ใช้ผ่าน gate(req, res): ถ้า return true = จัดการ response แล้ว (บล็อก/redirect/login) — ผู้เรียกต้อง return
 *
 * สร้าง hash: node gen-password-hash.js <password>
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const SESSION_FILE = path.join(__dirname, '.auth-sessions.json');
const SESSION_TTL  = 7 * 24 * 60 * 60 * 1000;   // 7 วัน
const COOKIE_NAME  = 'hub_sid';

// ─── Password hashing (scrypt) ──────────────────────────────────────────────────

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const calc = crypto.scryptSync(String(password), salt, 64);
    const ref  = Buffer.from(hash, 'hex');
    return calc.length === ref.length && crypto.timingSafeEqual(calc, ref);
  } catch { return false; }
}

// ─── Session store (file-backed) ────────────────────────────────────────────────

function loadSessions() {
  try {
    const obj = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

function saveSessions(sessions) {
  try { fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions), 'utf8'); } catch {}
}

function pruneExpired(sessions) {
  const now = Date.now();
  let changed = false;
  for (const [tok, exp] of Object.entries(sessions)) {
    if (exp < now) { delete sessions[tok]; changed = true; }
  }
  return changed;
}

function createSession() {
  const sessions = loadSessions();
  pruneExpired(sessions);
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = Date.now() + SESSION_TTL;
  saveSessions(sessions);
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const sessions = loadSessions();
  const exp = sessions[token];
  if (!exp) return false;
  if (exp < Date.now()) { delete sessions[token]; saveSessions(sessions); return false; }
  return true;
}

function destroySession(token) {
  if (!token) return;
  const sessions = loadSessions();
  if (sessions[token]) { delete sessions[token]; saveSessions(sessions); }
}

// ─── Cookie helpers ─────────────────────────────────────────────────────────────

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(pair => {
    const i = pair.indexOf('=');
    if (i === -1) return;
    out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
  });
  return out;
}

function getSessionToken(req) {
  return parseCookies(req)[COOKIE_NAME] || null;
}

// ─── Brute-force protection (ต่อ IP) ────────────────────────────────────────────

const failByIp = new Map();   // ip → { count, until }
const MAX_FAILS  = 5;
const LOCK_MS    = 5 * 60 * 1000;   // ล็อก 5 นาทีหลังพลาด 5 ครั้ง

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket?.remoteAddress || 'unknown';
}

function isLocked(ip) {
  const rec = failByIp.get(ip);
  if (!rec) return false;
  if (rec.until && rec.until > Date.now()) return true;
  if (rec.until && rec.until <= Date.now()) { failByIp.delete(ip); return false; }
  return false;
}

function recordFail(ip) {
  const rec = failByIp.get(ip) || { count: 0, until: 0 };
  rec.count++;
  if (rec.count >= MAX_FAILS) rec.until = Date.now() + LOCK_MS;
  failByIp.set(ip, rec);
}

function clearFails(ip) { failByIp.delete(ip); }

// ─── Login page HTML ────────────────────────────────────────────────────────────

function loginPage(error = '') {
  const errHtml = error
    ? `<div class="err">${error.replace(/[<>&]/g, '')}</div>` : '';
  return `<!DOCTYPE html><html lang="th"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>เข้าสู่ระบบ — Agent Hub</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f1117;color:#e2e8f0;font-family:'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .box{background:#1a1d27;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:36px 32px;width:340px;box-shadow:0 12px 40px rgba(0,0,0,.4)}
  h1{font-size:20px;margin-bottom:6px;text-align:center}
  .sub{font-size:12px;color:#8892a4;text-align:center;margin-bottom:24px}
  label{display:block;font-size:12px;color:#8892a4;margin-bottom:6px}
  input{width:100%;background:#0f1117;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:11px 14px;color:#e2e8f0;font-size:15px}
  input:focus{outline:none;border-color:#6c8aff}
  button{width:100%;margin-top:18px;background:#6c8aff;border:none;border-radius:8px;padding:11px;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
  button:hover{background:#5a78ee}
  .err{background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.3);color:#f87171;border-radius:8px;padding:9px 12px;font-size:13px;margin-bottom:16px;text-align:center}
</style></head><body>
<form class="box" method="POST" action="/login">
  <h1>🔐 Agent Hub</h1>
  <div class="sub">กรุณาใส่รหัสผ่านเพื่อเข้าใช้งาน</div>
  ${errHtml}
  <label>รหัสผ่าน</label>
  <input type="password" name="password" autofocus autocomplete="current-password" required>
  <button type="submit">เข้าสู่ระบบ</button>
</form>
</body></html>`;
}

// ─── Gate: เรียกบนสุดของ request handler ────────────────────────────────────────
// คืน true = จัดการ response เรียบร้อยแล้ว (ผู้เรียกต้อง return ทันที)
// คืน false = ผ่าน auth แล้ว ให้ทำ routing ต่อ

function gate(req, res) {
  const url    = (req.url || '').split('?')[0];
  const method = req.method;
  const hash   = process.env.DASHBOARD_PASSWORD_HASH;

  // ยังไม่ตั้งรหัสผ่าน → เตือนชัดเจน (กัน expose โดยไม่มี auth)
  if (!hash) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<p style="font-family:sans-serif;padding:24px">⚠️ ยังไม่ได้ตั้งรหัสผ่าน — รัน <code>node gen-password-hash.js &lt;รหัส&gt;</code> แล้วใส่ค่า DASHBOARD_PASSWORD_HASH ใน .env</p>');
    return true;
  }

  // ── POST /login ──
  if (url === '/login' && method === 'POST') {
    const ip = clientIp(req);
    if (isLocked(ip)) {
      res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(loginPage('พยายามผิดหลายครั้ง — กรุณารอ 5 นาที'));
      return true;
    }
    let body = '';
    req.on('data', d => { body += d; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const pw = params.get('password') || '';
      if (verifyPassword(pw, hash)) {
        clearFails(ip);
        const token = createSession();
        res.writeHead(302, {
          'Set-Cookie': `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL / 1000}; SameSite=Lax`,
          'Location': '/',
        });
        res.end();
      } else {
        recordFail(ip);
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(loginPage('รหัสผ่านไม่ถูกต้อง'));
      }
    });
    return true;
  }

  // ── GET /login ──
  if (url === '/login' && method === 'GET') {
    if (isValidSession(getSessionToken(req))) {
      res.writeHead(302, { 'Location': '/' }); res.end(); return true;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(loginPage());
    return true;
  }

  // ── /logout ──
  if (url === '/logout') {
    destroySession(getSessionToken(req));
    res.writeHead(302, {
      'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`,
      'Location': '/login',
    });
    res.end();
    return true;
  }

  // ── ยกเว้น LINE webhook (มะยม) — ตรวจ X-Line-Signature ใน route แทน session ──
  // LINE ยิงมาจาก IP ภายนอกไม่มี cookie; auth ทำผ่าน HMAC signature ที่ routes/mayom.js
  if (url === '/webhook/line/mayom') return false;

  // ── ยกเว้น internal calls จาก localhost (approval-bot, namkhao scheduler ฯลฯ) ──
  const remoteAddr = req.socket?.remoteAddress || '';
  if (remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1') {
    return false; // ผ่านโดยไม่ต้อง auth
  }

  // ── ตรวจ session สำหรับทุก request ที่เหลือ ──
  if (isValidSession(getSessionToken(req))) return false;   // ผ่าน → routing ต่อ

  // ไม่มี session: API/POST → 401 JSON, หน้าเว็บ → redirect ไป /login
  const isApi = url.startsWith('/api/') || url.includes('/api/') || method !== 'GET';
  if (isApi) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'unauthorized', login: '/login' }));
  } else {
    res.writeHead(302, { 'Location': '/login' });
    res.end();
  }
  return true;
}

module.exports = { gate, hashPassword, verifyPassword, COOKIE_NAME };
