'use strict';

jest.mock('fs');

// Set env vars before module load (constants are computed at require time)
process.env.GPU_LOCK_FILE        = '/tmp/test-comfyui-gpu.lock';
process.env.GPU_LOCK_MAX_HOLD_MS = '900000';
process.env.GPU_LOCK_POLL_MS     = '1';  // 1ms so acquire() waits don't hang

const fs = require('fs');
const { withGpuLock, acquire, release, readLock, readQueueStatus } = require('../lib/gpu-lock');

const LOCK_FILE     = '/tmp/test-comfyui-gpu.lock';
const WAITER_PREFIX = '/tmp/test-comfyui-gpu.waiter.';
const MY_PID        = process.pid;
const OTHER_PID     = MY_PID + 999;

let killSpy;
beforeAll(() => {
  killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {});
});
afterAll(() => killSpy.mockRestore());

beforeEach(() => {
  jest.clearAllMocks();
  // Default happy-path fs stubs
  fs.openSync.mockImplementation(() => 3);
  fs.writeSync.mockImplementation(() => {});
  fs.closeSync.mockImplementation(() => {});
  fs.readFileSync.mockImplementation(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
  fs.unlinkSync.mockImplementation(() => {});
  fs.writeFileSync.mockImplementation(() => {});
  fs.readdirSync.mockImplementation(() => []);
});

// ─── readLock ────────────────────────────────────────────────────────────────

describe('readLock', () => {
  test('returns parsed object when lock file exists', () => {
    const payload = { pid: 42, agent: 'test', since: 1000 };
    fs.readFileSync.mockReturnValue(JSON.stringify(payload));
    expect(readLock()).toEqual(payload);
  });

  test('returns null when lock file is missing', () => {
    fs.readFileSync.mockImplementation(() => { throw Object.assign(new Error(), { code: 'ENOENT' }); });
    expect(readLock()).toBeNull();
  });

  test('returns null on invalid JSON', () => {
    fs.readFileSync.mockReturnValue('not-json{{');
    expect(readLock()).toBeNull();
  });
});

// ─── release ─────────────────────────────────────────────────────────────────

describe('release', () => {
  test('removes lock file when owned by this process', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ pid: MY_PID, agent: 'me', since: Date.now() }));
    release();
    expect(fs.unlinkSync).toHaveBeenCalledWith(LOCK_FILE);
  });

  test('does not remove lock file when owned by another process', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ pid: OTHER_PID, agent: 'other', since: Date.now() }));
    release();
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  test('does nothing when no lock file exists', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(() => release()).not.toThrow();
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });
});

// ─── readQueueStatus ─────────────────────────────────────────────────────────

describe('readQueueStatus', () => {
  test('returns null holder and empty waiters when lock file is absent', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const { holder, waiters } = readQueueStatus();
    expect(holder).toBeNull();
    expect(waiters).toEqual([]);
  });

  test('returns holder when lock file held by live process', () => {
    const since = Date.now() - 1000;
    fs.readFileSync.mockReturnValue(JSON.stringify({ pid: OTHER_PID, agent: 'mammuang', since }));
    killSpy.mockImplementation(() => {}); // OTHER_PID is alive
    const { holder } = readQueueStatus();
    expect(holder).toMatchObject({ agent: 'mammuang', pid: OTHER_PID, since });
  });

  test('returns null holder when holder PID is dead', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ pid: OTHER_PID, agent: 'mammuang', since: Date.now() }));
    killSpy.mockImplementation(() => { throw new Error('ESRCH'); }); // dead
    const { holder } = readQueueStatus();
    expect(holder).toBeNull();
  });

  test('lists live waiters sorted by since', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); }); // no holder
    const base = require('path').basename(WAITER_PREFIX);
    const waiterA = `${base}${MY_PID}.json`;
    const waiterB = `${base}${OTHER_PID}.json`;
    fs.readdirSync.mockReturnValue([waiterB, waiterA]); // unsorted
    const sinceOlder = Date.now() - 5000; // 5s ago = smaller timestamp = first in asc sort
    const sinceNewer = Date.now() - 2000; // 2s ago = larger timestamp = second in asc sort
    // waiterB (OTHER_PID) = anime (older), waiterA (MY_PID) = maprang (newer)
    fs.readFileSync
      .mockImplementationOnce(() => { throw new Error('ENOENT'); })             // readLock → no holder
      .mockImplementationOnce(() => JSON.stringify({ agent: 'anime',   since: sinceOlder })) // waiterB
      .mockImplementationOnce(() => JSON.stringify({ agent: 'maprang', since: sinceNewer })); // waiterA
    killSpy.mockImplementation(() => {}); // both alive
    const { waiters } = readQueueStatus();
    expect(waiters.length).toBe(2);
    // sorted ascending by since: older (smaller timestamp) first
    expect(waiters[0].agent).toBe('anime');   // sinceOlder comes first
    expect(waiters[1].agent).toBe('maprang');
  });

  test('prunes dead waiter files', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); }); // no holder
    const base = require('path').basename(WAITER_PREFIX);
    const deadPid = OTHER_PID + 1;
    fs.readdirSync.mockReturnValue([`${base}${deadPid}.json`]);
    // kill throws for dead PID
    killSpy.mockImplementation((pid, sig) => {
      if (pid === deadPid) throw new Error('ESRCH');
    });
    const { waiters } = readQueueStatus();
    expect(waiters).toEqual([]);
    expect(fs.unlinkSync).toHaveBeenCalled();
  });
});

// ─── withGpuLock — happy path ─────────────────────────────────────────────────

describe('withGpuLock', () => {
  test('calls fn and returns its result when lock is free', async () => {
    const result = await withGpuLock('test', async () => 'gpu-done');
    expect(result).toBe('gpu-done');
  });

  test('acquires and releases lock around fn', async () => {
    const order = [];
    fs.openSync.mockImplementation(() => { order.push('acquired'); return 3; });
    fs.readFileSync.mockReturnValue(JSON.stringify({ pid: MY_PID, agent: 'test', since: Date.now() }));
    fs.unlinkSync.mockImplementation(() => order.push('released'));
    await withGpuLock('test', async () => { order.push('fn'); });
    expect(order).toEqual(['acquired', 'fn', 'released']);
  });

  test('releases lock even when fn throws', async () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ pid: MY_PID, agent: 'test', since: Date.now() }));
    await expect(withGpuLock('test', async () => { throw new Error('gpu error'); }))
      .rejects.toThrow('gpu error');
    expect(fs.unlinkSync).toHaveBeenCalled();
  });
});

// ─── tryAcquireOnce — edge branches ──────────────────────────────────────────

describe('tryAcquireOnce — edge branches', () => {
  test('propagates non-EEXIST error from openSync', async () => {
    fs.openSync.mockImplementation((p, flag) => {
      if (flag === 'wx') { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; }
      return 3;
    });
    await expect(withGpuLock('eperm', async () => {})).rejects.toThrow('EPERM');
  });

  test('handles race: EEXIST then lock file gone (null lock → stale)', async () => {
    let callN = 0;
    fs.openSync.mockImplementation((p, flag) => {
      if (flag !== 'wx') return 3;
      callN++;
      if (callN === 1) { const e = Object.assign(new Error('EEXIST'), { code: 'EEXIST' }); throw e; }
      return 3;
    });
    // readFileSync throws → readLock returns null → isStale(null) = true → unlink → retry succeeds
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const result = await withGpuLock('race', async () => 'recovered');
    expect(result).toBe('recovered');
  });

  test('handles unlinkSync throwing during stale cleanup', async () => {
    let callN = 0;
    fs.openSync.mockImplementation((p, flag) => {
      if (flag !== 'wx') return 3;
      callN++;
      if (callN === 1) { const e = Object.assign(new Error('EEXIST'), { code: 'EEXIST' }); throw e; }
      return 3;
    });
    // Dead PID lock → stale, but unlinkSync throws (another process already cleaned it)
    fs.readFileSync.mockReturnValue(JSON.stringify({ pid: OTHER_PID, agent: 'ghost', since: Date.now() }));
    killSpy.mockImplementation((pid, sig) => { if (pid === OTHER_PID) throw new Error('ESRCH'); });
    fs.unlinkSync.mockImplementation(() => { throw new Error('ENOENT'); }); // throws but caught
    // After unlink throws, recursive tryAcquireOnce still succeeds on next openSync call
    const result = await withGpuLock('cleanup-throw', async () => 'ok');
    expect(result).toBe('ok');
  });

  test('isStale treats lock with missing since as stale (since||0 branch)', async () => {
    let callN = 0;
    fs.openSync.mockImplementation((p, flag) => {
      if (flag !== 'wx') return 3;
      callN++;
      if (callN === 1) { const e = Object.assign(new Error('EEXIST'), { code: 'EEXIST' }); throw e; }
      return 3;
    });
    // Lock without `since` field: Date.now() - 0 >> MAX_HOLD → stale
    fs.readFileSync.mockReturnValue(JSON.stringify({ pid: OTHER_PID, agent: 'nosince' }));
    killSpy.mockImplementation(() => {}); // alive, but stale by age (since=undefined → 0)
    const result = await withGpuLock('since-fallback', async () => 'ok');
    expect(result).toBe('ok');
  });
});

// ─── readQueueStatus — edge branches ─────────────────────────────────────────

describe('readQueueStatus — edge branches', () => {
  test('skips waiter when readFileSync throws (JSON unreadable)', () => {
    const base = require('path').basename(WAITER_PREFIX);
    fs.readdirSync.mockReturnValue([`${base}${OTHER_PID}.json`]);
    fs.readFileSync
      .mockImplementationOnce(() => { throw new Error('ENOENT'); }) // readLock → null
      .mockImplementationOnce(() => { throw new Error('gone'); });  // waiter file unreadable
    killSpy.mockImplementation(() => {}); // PID alive
    const { waiters } = readQueueStatus();
    expect(waiters).toEqual([]);
  });
});

// ─── acquire — stale lock path ────────────────────────────────────────────────

describe('acquire — stale lock', () => {
  test('steals stale lock (dead PID) and acquires', async () => {
    let callN = 0;
    fs.openSync.mockImplementation((p, flag) => {
      if (flag !== 'wx') return 3;
      callN++;
      if (callN === 1) {
        const e = Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
        throw e;
      }
      return 3;
    });
    // Lock held by a dead process
    fs.readFileSync.mockReturnValue(JSON.stringify({ pid: OTHER_PID, agent: 'zombie', since: Date.now() }));
    killSpy.mockImplementation((pid, sig) => {
      if (pid === OTHER_PID && sig === 0) throw new Error('ESRCH'); // dead
    });
    const result = await withGpuLock('stealer', async () => 'ok');
    expect(result).toBe('ok');
    expect(fs.unlinkSync).toHaveBeenCalled(); // stale lock removed
  });

  test('steals lock older than MAX_HOLD_MS', async () => {
    let callN = 0;
    fs.openSync.mockImplementation((p, flag) => {
      if (flag !== 'wx') return 3;
      callN++;
      if (callN === 1) { const e = Object.assign(new Error('EEXIST'), { code: 'EEXIST' }); throw e; }
      return 3;
    });
    const oldSince = Date.now() - 901000; // 901s > 900s MAX_HOLD
    fs.readFileSync.mockReturnValue(JSON.stringify({ pid: OTHER_PID, agent: 'slow', since: oldSince }));
    killSpy.mockImplementation(() => {}); // PID is alive but lock is stale by age
    const result = await withGpuLock('stealer-age', async () => 'stolen');
    expect(result).toBe('stolen');
  });
});

// ─── acquire — waiter / listener cleanup (bug fix) ───────────────────────────

describe('acquire — listener cleanup', () => {
  test('does not leak exit listeners after waiting for lock', async () => {
    const countBefore = process.listenerCount('exit');

    // Must fail the 1st call (line 62 fast-path) AND the 1st while-check (line 66)
    // so the loop body (line 67 await) actually executes before 3rd call succeeds.
    let openCalls = 0;
    fs.openSync.mockImplementation((p, flag) => {
      if (flag !== 'wx') return 3;
      openCalls++;
      if (openCalls <= 2) {
        const e = Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
        throw e;
      }
      return 3;
    });
    // Lock held by live OTHER_PID → not stale → must actually poll
    fs.readFileSync.mockReturnValue(JSON.stringify({ pid: OTHER_PID, agent: 'holder', since: Date.now() }));
    killSpy.mockImplementation(() => {}); // OTHER_PID alive

    await acquire('waiter-agent');
    // Cleanup: release the lock we acquired (readLock returns OTHER_PID so unlinkSync won't fire, that's fine)
    release();

    const countAfter = process.listenerCount('exit');
    expect(countAfter).toBe(countBefore);
  });

  test('exit listener count stays stable across multiple sequential lock acquisitions', async () => {
    const countBefore = process.listenerCount('exit');
    for (let i = 0; i < 3; i++) {
      await withGpuLock('multi', async () => {});
    }
    expect(process.listenerCount('exit')).toBe(countBefore);
  });
});
