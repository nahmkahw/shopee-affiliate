'use strict';
/**
 * agents/mayom/store.js — file-based data layer สำหรับ Agent มะยม
 *
 * layout:
 *   agents/mayom/transactions/{id}.json   — 1 ไฟล์/รายการ (source of truth)
 *   agents/mayom/index.json               — append-only ledger (สรุปเร็ว, mirror ของ transactions)
 *   agents/mayom/users.json               — { line_user_id: alias }
 *   agents/mayom/categories.json          — [{ name, color }]
 *   agents/mayom/slips/{id}.jpg           — รูปสลิปต้นฉบับ
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = __dirname;
const TX_DIR    = path.join(BASE, 'transactions');
const SLIP_DIR  = path.join(BASE, 'slips');
const INDEX     = path.join(BASE, 'index.json');
const USERS     = path.join(BASE, 'users.json');
const CATS      = path.join(BASE, 'categories.json');

const DEFAULT_CATS = [
  { name: 'อาหาร',        color: '#f97316' },
  { name: 'เดินทาง',      color: '#3b82f6' },
  { name: 'ของใช้',       color: '#10b981' },
  { name: 'บิล/ค่าบริการ', color: '#a855f7' },
  { name: 'บันเทิง',      color: '#ec4899' },
  { name: 'อื่นๆ',        color: '#94a3b8' },
];

function ensureDirs() {
  for (const d of [TX_DIR, SLIP_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJson(p, obj) {
  ensureDirs();
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

// ── categories ──────────────────────────────────────────────────────────────
function getCategories() {
  const c = readJson(CATS, null);
  if (!c) { writeJson(CATS, DEFAULT_CATS); return DEFAULT_CATS.slice(); }
  return c;
}
function setCategories(list) { writeJson(CATS, list); }
function categoryNames() { return getCategories().map(c => c.name); }

/** matchCategory — จับข้อความให้ตรงหมวด (exact/substring) ไม่ตรง → null */
function matchCategory(text) {
  if (!text) return null;
  const t = String(text).trim();
  const names = categoryNames();
  const exact = names.find(n => n === t);
  if (exact) return exact;
  const partial = names.find(n => n !== 'อื่นๆ' && (t.includes(n) || n.includes(t)));
  return partial || null;
}

// ── users (alias) ─────────────────────────────────────────────────────────────
function getUsers() { return readJson(USERS, {}); }
function setAlias(lineUserId, alias) {
  const u = getUsers();
  if (alias && alias.trim()) u[lineUserId] = alias.trim(); else delete u[lineUserId];
  writeJson(USERS, u);
}
function displayFor(lineUserId, fallback) {
  return getUsers()[lineUserId] || fallback || lineUserId;
}

// ── transactions ──────────────────────────────────────────────────────────────
function hashImage(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function txPath(id) { return path.join(TX_DIR, `${id}.json`); }
function slipPath(id) { return path.join(SLIP_DIR, `${id}.jpg`); }

function readAll() {
  ensureDirs();
  return fs.readdirSync(TX_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => readJson(path.join(TX_DIR, f), null))
    .filter(Boolean);
}

function getTx(id) { return readJson(txPath(id), null); }

/** logicalKey — composite ใช้เทียบ dedup เชิงตรรกะ (เมื่อไม่มี ref_no) */
function logicalKey(tx) {
  if (tx.ref_no) return `ref:${tx.ref_no}`;
  return `c:${tx.amount || ''}|${tx.slip_datetime || ''}|${tx.bank_from || ''}`;
}

/**
 * findDuplicate — คืน tx ต้นฉบับถ้าเจอซ้ำ (B: image hash, C: ref_no/composite) ไม่งั้น null
 */
function findDuplicate({ image_hash, ref_no, amount, slip_datetime, bank_from }) {
  const all = readAll().filter(t => !t.duplicate);   // เทียบกับตัวจริงเท่านั้น
  const byHash = all.find(t => image_hash && t.image_hash === image_hash);
  if (byHash) return byHash;
  const key = ref_no ? `ref:${ref_no}` : `c:${amount || ''}|${slip_datetime || ''}|${bank_from || ''}`;
  if (!ref_no && !amount) return null;              // composite ว่างเกินไป — ไม่ถือว่าซ้ำ
  return all.find(t => logicalKey(t) === key) || null;
}

function saveTx(tx) {
  writeJson(txPath(tx.id), tx);
  // sync index.json (mirror ย่อ)
  const idx = readJson(INDEX, []);
  const slim = {
    id: tx.id, created_at: tx.created_at, line_user_id: tx.line_user_id,
    line_display_name: tx.line_display_name, amount: tx.amount, category: tx.category,
    slip_datetime: tx.slip_datetime, status: tx.status, duplicate: !!tx.duplicate,
  };
  const pos = idx.findIndex(e => e.id === tx.id);
  if (pos === -1) idx.push(slim); else idx[pos] = slim;
  writeJson(INDEX, idx);
  return tx;
}

/** updateTx — patch fields ที่แก้ได้จาก dashboard (amount/category/note/status/duplicate) */
function updateTx(id, patch) {
  const tx = getTx(id);
  if (!tx) return null;
  const allowed = ['amount', 'category', 'note', 'status', 'duplicate'];
  for (const k of allowed) if (k in patch) tx[k] = patch[k];
  if ('amount' in patch) tx.amount = patch.amount == null ? null : parseFloat(patch.amount);
  tx.updated_at = new Date().toISOString();
  return saveTx(tx);
}

function deleteTx(id) {
  try { fs.rmSync(txPath(id), { force: true }); } catch {}
  try { fs.rmSync(slipPath(id), { force: true }); } catch {}
  const idx = readJson(INDEX, []).filter(e => e.id !== id);
  writeJson(INDEX, idx);
}

/** attachCaption — ผูก category/note เข้ากับสลิปล่าสุดของ user (ที่ยังไม่มี caption) */
function attachCaption(lineUserId, { category, note }, withinMs = 60000) {
  const now = Date.now();
  const cand = readAll()
    .filter(t => t.line_user_id === lineUserId && !t.note && (!t.category || t.category === 'อื่นๆ'))
    .filter(t => now - new Date(t.created_at).getTime() <= withinMs)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  if (!cand) return null;
  if (category) cand.category = category;
  if (note) cand.note = note;
  return saveTx(cand);
}

module.exports = {
  BASE, SLIP_DIR, slipPath, hashImage,
  getCategories, setCategories, categoryNames, matchCategory,
  getUsers, setAlias, displayFor,
  readAll, getTx, findDuplicate, saveTx, updateTx, deleteTx, attachCaption,
};
