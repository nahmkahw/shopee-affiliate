'use strict';
const { conflictingPaths, needsNpmCi, evaluate } = require('../lib/ci/deploy-precheck');
const { waitForGpuIdle } = require('../lib/ci/deploy-guard');
const { probe, waitHealthy } = require('../lib/ci/health-check');

const noop = () => {};

describe('deploy-precheck', () => {
  test('runtime file ที่แก้ค้างแต่ upstream ไม่แตะ → ไม่ใช่ conflict (ไม่งั้น abort ทุกครั้ง)', () => {
    const local = ['agents/manao/pipeline/_tg_queue.json', 'agents/namkhao/telegram-bot.pid'];
    const upstream = ['lib/ci/deploy-runner.js', 'README.md'];
    expect(conflictingPaths(local, upstream)).toEqual([]);
  });

  test('ไฟล์เดียวกันทั้งสองฝั่ง → conflict', () => {
    expect(conflictingPaths(['post.js', 'a.js'], ['post.js', 'b.js'])).toEqual(['post.js']);
  });

  test('needsNpmCi เฉพาะตอน lock/package เปลี่ยน', () => {
    expect(needsNpmCi(['package-lock.json'])).toBe(true);
    expect(needsNpmCi(['package.json'])).toBe(true);
    expect(needsNpmCi(['lib/ci/x.js'])).toBe(false);
  });

  test('behind=0 → ไม่ deploy (up-to-date)', () => {
    const r = evaluate({ behind: 0 });
    expect(r.proceed).toBe(false);
    expect(r.reason).toBe('up-to-date');
  });

  test('conflict → หยุด พร้อมรายชื่อไฟล์', () => {
    const r = evaluate({ localModified: ['post.js'], upstreamChanged: ['post.js'], behind: 2 });
    expect(r.proceed).toBe(false);
    expect(r.reason).toBe('conflict');
    expect(r.conflicts).toEqual(['post.js']);
  });

  test('ทางปกติ: มี commit ใหม่ + ไม่ชน → proceed', () => {
    const r = evaluate({
      localModified: ['agents/namkhao/telegram-bot.pid'],
      upstreamChanged: ['lib/x.js', 'package-lock.json'],
      behind: 3,
    });
    expect(r.proceed).toBe(true);
    expect(r.npmCi).toBe(true);
    expect(r.behind).toBe(3);
  });
});

describe('deploy-guard waitForGpuIdle', () => {
  test('ว่างอยู่แล้ว → คืนทันที ไม่ต้องรอ', async () => {
    const readStatus = () => ({ holder: null, waiters: [] });
    const r = await waitForGpuIdle({ readStatus, sleep: noop, log: noop });
    expect(r.idle).toBe(true);
  });

  test('ไม่ว่างแล้วว่าง → รอจนว่าง', async () => {
    const seq = [
      { holder: { agent: 'maprao', pid: 1 }, waiters: [] },
      { holder: null, waiters: [{ agent: 'maprang' }] },
      { holder: null, waiters: [] },
    ];
    let i = 0;
    const readStatus = () => seq[Math.min(i++, seq.length - 1)];
    const r = await waitForGpuIdle({ readStatus, sleep: async () => {}, log: noop });
    expect(r.idle).toBe(true);
    expect(i).toBe(3);
  });

  test('ไม่ว่างเกิน timeout → timedOut พร้อม holder', async () => {
    const readStatus = () => ({ holder: { agent: 'maprang', pid: 9 }, waiters: [] });
    let t = 0;
    const now = () => t;
    const sleep = async () => { t += 5000; };
    const r = await waitForGpuIdle({ readStatus, sleep, now, timeoutMs: 10000, log: noop });
    expect(r.idle).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(r.holder.agent).toBe('maprang');
  });
});

describe('health-check', () => {
  const okRes = { ok: true, status: 200, json: async () => ({ ok: true, uptime: 5 }) };

  test('probe สำเร็จ', async () => {
    const r = await probe({ fetchFn: async () => okRes });
    expect(r.ok).toBe(true);
    expect(r.body.uptime).toBe(5);
  });

  test('probe เมื่อ connection refused', async () => {
    const r = await probe({ fetchFn: async () => { throw new Error('ECONNREFUSED'); } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ECONNREFUSED/);
  });

  test('probe เมื่อ server ตอบ 503', async () => {
    const r = await probe({ fetchFn: async () => ({ ok: false, status: 503 }) });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
  });

  test('waitHealthy: ขึ้นช้า → retry จนผ่าน', async () => {
    let n = 0;
    const fetchFn = async () => { if (++n < 3) throw new Error('ECONNREFUSED'); return okRes; };
    const r = await waitHealthy({ fetchFn, sleep: async () => {}, log: noop, attempts: 5 });
    expect(r.healthy).toBe(true);
    expect(r.attempts).toBe(3);
  });

  test('waitHealthy: ไม่ขึ้นเลย → healthy=false ครบจำนวนครั้ง', async () => {
    const fetchFn = async () => { throw new Error('ECONNREFUSED'); };
    const r = await waitHealthy({ fetchFn, sleep: async () => {}, log: noop, attempts: 3 });
    expect(r.healthy).toBe(false);
    expect(r.attempts).toBe(3);
  });
});
