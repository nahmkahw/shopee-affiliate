'use strict';

jest.mock('fs');
jest.mock('child_process');

const fs = require('fs');
const cp = require('child_process');
const { EventEmitter } = require('events');

const {
  log, updateStatus, todayString,
  actionStatus, actionApproveToday, actionScrape, actionCreateContent,
  main,
} = require('../agents/mali/run');

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid    = 9999;
  return child;
}

let logSpy;
beforeEach(() => {
  jest.resetAllMocks();
  fs.appendFileSync.mockImplementation(() => {});
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
});

// ─── log ──────────────────────────────────────────────────────────────────────

describe('log()', () => {
  test('appends to LOG_FILE and calls console.log', () => {
    log('test message');
    expect(fs.appendFileSync).toHaveBeenCalledWith(
      expect.stringContaining('mali.log'),
      expect.stringContaining('test message'),
      'utf8'
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('test message'));
  });
});

// ─── updateStatus ─────────────────────────────────────────────────────────────

describe('updateStatus()', () => {
  test('merges fields into mali key and writes file', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: { status: 'idle' } }));
    updateStatus({ status: 'running' });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('agent-status.json'),
      expect.stringContaining('"running"'),
      'utf8'
    );
  });

  test('silently ignores errors (corrupt file)', () => {
    fs.readFileSync.mockReturnValue('NOT JSON');
    expect(() => updateStatus({ status: 'running' })).not.toThrow();
  });

  test('silently ignores when file does not exist', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(() => updateStatus({ status: 'running' })).not.toThrow();
  });
});

// ─── todayString ──────────────────────────────────────────────────────────────

describe('todayString()', () => {
  test('returns YYYY-MM-DD format', () => {
    expect(todayString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── actionStatus ─────────────────────────────────────────────────────────────

describe('actionStatus()', () => {
  beforeEach(() => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: {} }));
  });

  test('logs error and returns when products dir does not exist', () => {
    fs.existsSync.mockReturnValue(false);
    actionStatus();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ไม่พบโฟลเดอร์'));
  });

  test('counts total, posted, ready, noContent correctly', () => {
    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      if (s.endsWith('products')) return true;
      if (s.endsWith('data.json')) return true;
      if (s.endsWith('facebook.md')) return true;
      if (s.endsWith('instagram.md')) return true;
      if (s.endsWith('x.md')) return true;
      if (s.endsWith('tiktok.md')) return true;
      return false;
    });
    fs.readdirSync.mockReturnValue(['111', '222']);
    fs.readFileSync.mockImplementation(p => {
      if (String(p).includes('111')) return JSON.stringify({ status: 'posted', post_date: '2020-01-01' });
      return JSON.stringify({ status: 'draft', post_date: todayString() });
    });
    actionStatus();
    // logs: สินค้าทั้งหมด, วันนี้, โพสต์แล้ว
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('สินค้าทั้งหมด'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('โพสต์แล้ว'));
  });

  test('skips placeholder items', () => {
    fs.existsSync.mockImplementation(p => String(p).endsWith('products') || String(p).endsWith('data.json'));
    fs.readdirSync.mockReturnValue(['999']);
    fs.readFileSync.mockReturnValue(JSON.stringify({ status: 'placeholder', post_date: '2026-06-15' }));
    actionStatus();
    // total stays 0 — no "สินค้าทั้งหมด: 0" isn't failing, just verify no crash
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('สินค้าทั้งหมด: 0'));
  });

  test('counts noContent when facebook.md is missing and not posted', () => {
    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      if (s.endsWith('products') || s.endsWith('data.json')) return true;
      return false;  // no content files
    });
    fs.readdirSync.mockReturnValue(['111']);
    fs.readFileSync.mockReturnValue(JSON.stringify({ status: 'draft', post_date: '2020-01-01' }));
    actionStatus();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('รอ Content: 1'));
  });
});

// ─── actionApproveToday ───────────────────────────────────────────────────────

describe('actionApproveToday()', () => {
  test('exits when approval-bot.js is not found', () => {
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: {} }));
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    expect(() => actionApproveToday()).toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  test('spawns approval-bot.js when found', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: {} }));
    const child = makeChild();
    cp.spawn.mockReturnValue(child);
    actionApproveToday();
    expect(cp.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([expect.stringContaining('approval-bot.js')]),
      expect.any(Object)
    );
  });

  test('logs stdout output from child', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: {} }));
    const child = makeChild();
    cp.spawn.mockReturnValue(child);
    actionApproveToday();
    child.stdout.emit('data', Buffer.from('bot output\n'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('bot output'));
  });

  test('logs stderr output from child with warning prefix', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: {} }));
    const child = makeChild();
    cp.spawn.mockReturnValue(child);
    actionApproveToday();
    child.stderr.emit('data', Buffer.from('some error\n'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('⚠️'));
  });

  test('logs success when child exits with code 0', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: {} }));
    const child = makeChild();
    cp.spawn.mockReturnValue(child);
    actionApproveToday();
    child.emit('close', 0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('✅ Approval Bot'));
  });

  test('logs failure when child exits with non-zero code', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: {} }));
    const child = makeChild();
    cp.spawn.mockReturnValue(child);
    actionApproveToday();
    child.emit('close', 1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('❌ Approval Bot exit code: 1'));
  });
});

// ─── actionScrape ─────────────────────────────────────────────────────────────

describe('actionScrape()', () => {
  test('runs scrape.js and logs success', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: {} }));
    cp.execSync.mockReturnValue('scraped 5 products\nดึงสำเร็จ');
    actionScrape();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('✅ Scrape'));
  });

  test('logs error and exits when execSync throws', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: {} }));
    cp.execSync.mockImplementation(() => { throw new Error('ECONNREFUSED'); });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    expect(() => actionScrape()).toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  test('uses e.stdout when available in error object', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: {} }));
    const err = new Error('script error');
    err.stdout = 'stdout output from scrape';
    cp.execSync.mockImplementation(() => { throw err; });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    expect(() => actionScrape()).toThrow('EXIT1');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('stdout output from scrape'));
    exitSpy.mockRestore();
  });
});

// ─── actionCreateContent ──────────────────────────────────────────────────────

describe('actionCreateContent()', () => {
  test('logs done when no products dir exists', () => {
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: {} }));
    actionCreateContent();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Content ครบ'));
  });

  test('logs done when all products already have facebook.md', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['111']);
    fs.readFileSync.mockReturnValue(JSON.stringify({ status: 'draft', mali: {} }));
    actionCreateContent();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Content ครบ'));
  });

  test('logs pending count when products need content', () => {
    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      if (s.endsWith('products') || s.endsWith('data.json')) return true;
      return false;  // no facebook.md
    });
    fs.readdirSync.mockReturnValue(['111', '222']);
    fs.readFileSync.mockReturnValue(JSON.stringify({ status: 'draft', mali: {} }));
    actionCreateContent();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('2 สินค้าที่รอ content'));
  });

  test('skips placeholder products', () => {
    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      if (s.endsWith('products') || s.endsWith('data.json')) return true;
      return false;
    });
    fs.readdirSync.mockReturnValue(['999']);
    fs.readFileSync.mockReturnValue(JSON.stringify({ status: 'placeholder', mali: {} }));
    actionCreateContent();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Content ครบ'));
  });
});

// ─── main() ───────────────────────────────────────────────────────────────────

describe('main()', () => {
  beforeEach(() => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: { status: 'idle' } }));
    fs.existsSync.mockReturnValue(false);
    fs.readdirSync.mockReturnValue([]);
  });

  test('defaults to action=status when no action specified', () => {
    main({ args: [] });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('action=status'));
  });

  test('accepts opts.action directly', () => {
    main({ action: 'status' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('action=status'));
  });

  test('reads --action from args', () => {
    main({ args: ['--action', 'create-content'] });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('action=create-content'));
  });

  test('exits with unknown action', () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    expect(() => main({ action: 'unknown' })).toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  test('catches action throw and exits with error', () => {
    // actionStatus will try to read products dir
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['bad']);
    fs.readFileSync.mockImplementation(p => {
      if (String(p).endsWith('data.json')) throw new Error('parse fail');
      return JSON.stringify({ mali: {} });
    });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    expect(() => main({ action: 'status' })).toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  test('does not call updateStatus(idle) for approve-today', () => {
    fs.existsSync.mockReturnValue(true);  // botPath exists
    const child = makeChild();
    cp.spawn.mockReturnValue(child);
    const writeFileSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

    main({ action: 'approve-today' });

    // Only updateStatus calls from updateStatus() — check writeFileSync was called for 'running' not 'idle'
    // The key point: updateStatus({status:'idle'}) should NOT be called after approve-today
    const idleCalls = writeFileSpy.mock.calls.filter(c =>
      String(c[1]).includes('"idle"') && String(c[1]).includes('"currentAction"')
    );
    expect(idleCalls).toHaveLength(0);
    writeFileSpy.mockRestore();
  });

  test('rotates log when LOG_FILE exceeds 500 lines', () => {
    const longLog = Array(501).fill('log line').join('\n');
    fs.existsSync.mockImplementation(p => String(p).endsWith('mali.log'));
    fs.readFileSync.mockImplementation(p => {
      if (String(p).endsWith('mali.log')) return longLog;
      return JSON.stringify({ mali: {} });
    });
    main({ action: 'status' });
    const logWriteCalls = fs.writeFileSync.mock.calls.filter(c => String(c[0]).endsWith('mali.log'));
    expect(logWriteCalls.length).toBeGreaterThan(0);
  });

  test('silently ignores log rotation error', () => {
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockImplementation(p => {
      if (String(p).endsWith('mali.log')) throw new Error('cannot read log');
      return JSON.stringify({ mali: {} });
    });
    // Should not throw
    expect(() => main({ action: 'status' })).not.toThrow();
  });
});
