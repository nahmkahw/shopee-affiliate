'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const {
  readEnvValue, daysUntil, inspectFbToken, decideAlert,
  loadState, saveState, alreadyReminded, expiryDateBKK,
} = require('../lib/ci/token-check');

const NOW = Date.UTC(2026, 6, 11, 0, 0, 0); // 2026-07-11
const inDays = n => Math.floor(NOW / 1000) + n * 86400;

describe('readEnvValue', () => {
  const tmp = path.join(os.tmpdir(), `envtest-${Date.now()}.env`);
  beforeAll(() => fs.writeFileSync(tmp,
    'FB_PAGE_ID=123\nFB_ACCESS_TOKEN="abc123"\n# comment\nEMPTY=\nSPACED = xyz \n'));
  afterAll(() => { try { fs.unlinkSync(tmp); } catch {} });

  test('อ่านค่า + strip quotes', () => {
    expect(readEnvValue(tmp, 'FB_ACCESS_TOKEN')).toBe('abc123');
    expect(readEnvValue(tmp, 'FB_PAGE_ID')).toBe('123');
  });
  test('trim ช่องว่างรอบ =', () => expect(readEnvValue(tmp, 'SPACED')).toBe('xyz'));
  test('key ไม่มี → null', () => expect(readEnvValue(tmp, 'NOPE')).toBeNull());
  test('ไฟล์ไม่มี → null (ไม่ throw)', () => expect(readEnvValue('/no/such', 'X')).toBeNull());
});

describe('daysUntil', () => {
  test('อนาคต 10 วัน', () => expect(daysUntil(inDays(10), NOW)).toBe(10));
  test('หมดไปแล้ว → ติดลบ', () => expect(daysUntil(inDays(-3), NOW)).toBe(-3));
  test('0 (ไม่มีวันหมด) → Infinity', () => expect(daysUntil(0, NOW)).toBe(Infinity));
});

describe('decideAlert', () => {
  test('valid เหลือเยอะ → ไม่เตือน', () => {
    const r = decideAlert({ valid: true, expiresAt: inDays(30) }, { thresholdDays: 7, now: NOW });
    expect(r.alert).toBe(false);
    expect(r.reason).toBe('ok');
    expect(r.daysLeft).toBe(30);
  });
  test('valid เหลือ ≤ threshold → เตือน', () => {
    const r = decideAlert({ valid: true, expiresAt: inDays(5) }, { thresholdDays: 7, now: NOW });
    expect(r.alert).toBe(true);
    expect(r.reason).toBe('expiring');
  });
  test('พอดี threshold → เตือน (ขอบเขต)', () => {
    expect(decideAlert({ valid: true, expiresAt: inDays(7) }, { thresholdDays: 7, now: NOW }).alert).toBe(true);
  });
  test('invalid → เตือนเสมอ', () => {
    const r = decideAlert({ valid: false, error: 'expired' }, { now: NOW });
    expect(r.alert).toBe(true);
    expect(r.reason).toBe('invalid');
  });
  test('never-expires → ไม่เตือน', () => {
    expect(decideAlert({ valid: true, expiresAt: 0 }, { now: NOW }).alert).toBe(false);
  });
});

describe('inspectFbToken', () => {
  const mkRes = obj => ({ json: async () => obj });
  test('token valid → expiresAt', async () => {
    const r = await inspectFbToken('tok', { fetchFn: async () => mkRes({ data: { is_valid: true, expires_at: 999 } }) });
    expect(r).toEqual({ valid: true, expiresAt: 999 });
  });
  test('token invalid', async () => {
    const r = await inspectFbToken('tok', { fetchFn: async () => mkRes({ data: { is_valid: false, expires_at: 5 } }) });
    expect(r.valid).toBe(false);
    expect(r.expiresAt).toBe(5);
  });
  test('graph error', async () => {
    const r = await inspectFbToken('tok', { fetchFn: async () => mkRes({ error: { message: 'bad' } }) });
    expect(r.valid).toBe(false);
    expect(r.error).toBe('bad');
  });
  test('ไม่มี token → ไม่ query', async () => {
    expect((await inspectFbToken('')).valid).toBe(false);
  });
  test('network error → จับได้', async () => {
    const r = await inspectFbToken('tok', { fetchFn: async () => { throw new Error('ETIMEDOUT'); } });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/ETIMEDOUT/);
  });
});

describe('idempotency state', () => {
  const tmp = path.join(os.tmpdir(), `tokstate-${Date.now()}.json`);
  afterAll(() => { try { fs.unlinkSync(tmp); } catch {} });

  test('save แล้ว alreadyReminded=true สำหรับ expiry เดิม', () => {
    saveState(tmp, { FB_ACCESS_TOKEN: { remindedFor: 111 } });
    const s = loadState(tmp);
    expect(alreadyReminded(s, 'FB_ACCESS_TOKEN', 111)).toBe(true);
  });
  test('expiry ใหม่ (ต่ออายุแล้ว) → เตือนได้อีก', () => {
    const s = loadState(tmp);
    expect(alreadyReminded(s, 'FB_ACCESS_TOKEN', 222)).toBe(false);
  });
  test('loadState ไฟล์ไม่มี → {} (ไม่ throw)', () => {
    expect(loadState('/no/such/state.json')).toEqual({});
  });
});

describe('expiryDateBKK', () => {
  test('unix sec → YYYY-MM-DD (BKK)', () => {
    // 2026-07-20 05:00 UTC = 12:00 BKK วันเดียวกัน
    const sec = Math.floor(Date.UTC(2026, 6, 20, 5, 0, 0) / 1000);
    expect(expiryDateBKK(sec)).toBe('2026-07-20');
  });
});
