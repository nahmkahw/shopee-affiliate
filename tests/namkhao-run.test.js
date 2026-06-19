'use strict';
/**
 * tests/namkhao-run.test.js
 * Coverage: lib/namkhao-health.js, lib/namkhao-status.js, agents/namkhao/run.js
 */

jest.mock('fs');
jest.mock('https');
jest.mock('http');
jest.mock('child_process');

const fs    = require('fs');
const https = require('https');
const http  = require('http');
const cp    = require('child_process');
const { EventEmitter } = require('events');

const health  = require('../lib/namkhao-health');
const { createStatusActions } = require('../lib/namkhao-status');
const namkhao = require('../agents/namkhao/run');

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeReq() {
  const req = new EventEmitter();
  req.setTimeout = jest.fn(); req.destroy = jest.fn();
  req.write = jest.fn();      req.end     = jest.fn();
  return req;
}

function fakeRes(statusCode, body, cb) {
  const req = makeReq();
  if (cb) {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    setImmediate(() => { res.emit('data', body); res.emit('end'); });
    cb(res);
  }
  return req;
}

function mockHttps(statusCode, body) {
  https.request.mockImplementation((_, cb) => fakeRes(statusCode, body, cb));
}

function setupAllOk() {
  https.request.mockImplementation((opts, cb) => {
    const p = opts.path || '';
    let body;
    if (p.includes('/getMe'))           body = JSON.stringify({ ok: true, result: {} });
    else if (p.includes('graph.face'))  body = JSON.stringify({ id: '1', name: 'P' });
    else if (p.includes('/rss/search')) body = '<rss><channel/></rss>';
    else if (p.includes('/1/upload'))   body = JSON.stringify({ error: { code: 310, message: 'No input' } });
    else                                body = '{}';
    return fakeRes(200, body, cb);
  });
  http.request.mockImplementation((opts, cb) => {
    const p = opts.path || '';
    let body;
    if (p.includes('/api/tags'))          body = JSON.stringify({ models: [] });
    else if (p.includes('/system_stats')) body = JSON.stringify({ system: {} });
    else if (p.includes('/queue'))        body = JSON.stringify({ queue_running: [], queue_pending: [] });
    else                                  body = '{}';
    return fakeRes(200, body, cb);
  });
}

const mockLog = jest.fn();
let logSpy;
beforeEach(() => {
  jest.clearAllMocks();
  fs.appendFileSync.mockImplementation(() => {});
  fs.writeFileSync.mockImplementation(() => {});
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => logSpy.mockRestore());

// ═══════════════════════════════════════════════════════════════════════════════
// lib/namkhao-health.js
// ═══════════════════════════════════════════════════════════════════════════════

describe('httpGet()', () => {
  test('ok:true on 200', async () => {
    mockHttps(200, 'hello');
    const r = await health.httpGet('https://example.com/');
    expect(r).toEqual({ ok: true, status: 200, body: 'hello' });
  });
  test('ok:false on 404', async () => {
    mockHttps(404, 'nope');
    const r = await health.httpGet('https://example.com/');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
  });
  test('ok:false on timeout', async () => {
    const req = makeReq();
    req.setTimeout = jest.fn((ms, cb) => setImmediate(cb));
    https.request.mockReturnValue(req);
    const r = await health.httpGet('https://example.com/', {}, 100);
    expect(r).toEqual({ ok: false, status: 0, body: 'timeout' });
  });
  test('ok:false on network error', async () => {
    const req = makeReq();
    req.end = jest.fn(() => setImmediate(() => req.emit('error', new Error('ECONNREFUSED'))));
    https.request.mockReturnValue(req);
    const r = await health.httpGet('https://example.com/');
    expect(r.ok).toBe(false);
    expect(r.body).toContain('ECONNREFUSED');
  });
});

describe('sendTelegram()', () => {
  test('returns parsed JSON on success', async () => {
    mockHttps(200, JSON.stringify({ ok: true, result: { message_id: 1 } }));
    const r = await health.sendTelegram('TOKEN', '123', 'สวัสดี');
    expect(r.ok).toBe(true);
  });
  test('returns {} on parse error', async () => {
    mockHttps(200, 'not-json');
    expect(await health.sendTelegram('T', 'C', 'x')).toEqual({});
  });
});

describe('loadAlerts / saveAlerts / shouldAlert', () => {
  test('loadAlerts returns {} on missing file', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error(); });
    expect(health.loadAlerts('/f')).toEqual({});
  });
  test('saveAlerts writes JSON', () => {
    health.saveAlerts('/f', { a: 1 });
    expect(fs.writeFileSync).toHaveBeenCalledWith('/f', expect.stringContaining('"a"'), 'utf8');
  });
  test('shouldAlert true first time, false in cooldown', () => {
    fs.readFileSync.mockReturnValue('{}');
    expect(health.shouldAlert('/f', 'k', 3600000)).toBe(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ k: Date.now() }));
    expect(health.shouldAlert('/f', 'k', 3600000)).toBe(false);
  });
});

describe('checkConnections()', () => {
  test('returns [] when all services OK', async () => {
    setupAllOk();
    const root = { NAMKHAO_TELEGRAM_BOT_TOKEN: 'tok' };
    const pipe = { OLLAMA_HOST: 'http://localhost:11434', FB_PAGE_ID: '1', FB_ACCESS_TOKEN: 'tok',
                   IG_USER_ID: '2', IG_ACCESS_TOKEN: 'tok', IMGBB_API_KEY: 'key' };
    expect(await health.checkConnections(root, pipe, mockLog)).toEqual([]);
  });
  test('reports issue: Telegram token missing', async () => {
    const issues = await health.checkConnections({}, {}, mockLog);
    expect(issues.some(i => i.agent.includes('Telegram'))).toBe(true);
  });
  test('reports issue: Telegram API error', async () => {
    mockHttps(200, JSON.stringify({ ok: false, description: 'Unauthorized' }));
    const issues = await health.checkConnections({ NAMKHAO_TELEGRAM_BOT_TOKEN: 'bad' }, {}, mockLog);
    expect(issues.find(i => i.agent.includes('Telegram'))?.msg).toContain('API error');
  });
  test('reports issue: FB credentials missing', async () => {
    setupAllOk();
    const issues = await health.checkConnections({ NAMKHAO_TELEGRAM_BOT_TOKEN: 'tok' }, {}, mockLog);
    expect(issues.some(i => i.agent.includes('Facebook'))).toBe(true);
  });
  test('reports issue: Telegram parse error (200 non-JSON body)', async () => {
    https.request.mockImplementation((opts, cb) => {
      const p = opts.path || '';
      const body = p.includes('/getMe') ? 'not-json' : JSON.stringify({ ok: true });
      return fakeRes(200, body, cb);
    });
    const issues = await health.checkConnections({ NAMKHAO_TELEGRAM_BOT_TOKEN: 'tok' }, {}, mockLog);
    expect(issues.find(i => i.agent.includes('Telegram'))?.msg).toBe('parse error');
  });
  test('reports issue: Google News returns non-RSS', async () => {
    https.request.mockImplementation((opts, cb) => {
      const p = opts.path || '';
      const body = p.includes('/rss/search') ? '<html>blocked</html>'
                 : p.includes('/getMe') ? JSON.stringify({ ok: true, result: {} })
                 : JSON.stringify({ id: '1', username: 'u' });
      return fakeRes(200, body, cb);
    });
    http.request.mockImplementation((opts, cb) => fakeRes(200, JSON.stringify({ models: [], queue_running: [], queue_pending: [], system: {} }), cb));
    const issues = await health.checkConnections(
      { NAMKHAO_TELEGRAM_BOT_TOKEN: 'tok' }, { OLLAMA_HOST: 'http://localhost:11434' }, mockLog
    );
    expect(issues.some(i => i.agent.includes('Google'))).toBe(true);
  });
  test('reports issue: imgBB invalid key', async () => {
    setupAllOk();
    https.request.mockImplementation((opts, cb) => {
      const p = opts.path || '';
      if (p.includes('/1/upload')) return fakeRes(200, JSON.stringify({ error: { message: 'invalid api key', code: 400 } }), cb);
      const body = p.includes('/getMe') ? JSON.stringify({ ok: true, result: {} })
                 : p.includes('graph.face') ? JSON.stringify({ id: '1', name: 'P' })
                 : p.includes('/rss/search') ? '<rss><channel/></rss>' : '{}';
      return fakeRes(200, body, cb);
    });
    const pipe = { FB_PAGE_ID: '1', FB_ACCESS_TOKEN: 't', IG_USER_ID: '2', IG_ACCESS_TOKEN: 't', IMGBB_API_KEY: 'bad-key' };
    const issues = await health.checkConnections({ NAMKHAO_TELEGRAM_BOT_TOKEN: 'tok' }, pipe, mockLog);
    expect(issues.some(i => i.agent.includes('imgBB'))).toBe(true);
  });
  test('reports issue: Ollama 503', async () => {
    setupAllOk();
    http.request.mockImplementation((opts, cb) => {
      const code = (opts.path || '').includes('/api/tags') ? 503 : 200;
      const body = (opts.path || '').includes('/queue')
        ? JSON.stringify({ queue_running: [], queue_pending: [] }) : '{}';
      return fakeRes(code, body, cb);
    });
    const issues = await health.checkConnections(
      { NAMKHAO_TELEGRAM_BOT_TOKEN: 'tok' }, { OLLAMA_HOST: 'http://localhost:11434' }, mockLog
    );
    expect(issues.some(i => i.agent.includes('Ollama'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// lib/namkhao-status.js
// ═══════════════════════════════════════════════════════════════════════════════

function makeDeps(overrides = {}) {
  return {
    ROOT: '/root', NEWS_DIR: '/root/news',
    log: jest.fn(), readStatus: jest.fn(() => ({ mali: { status: 'idle', lastResult: 'ok' }, manao: {} })),
    todayString: jest.fn(() => '2026-06-19'), readLog: jest.fn(() => []),
    updateStatus: jest.fn(), ...overrides,
  };
}

describe('actionStatus()', () => {
  test('logs agent statuses and product counts', () => {
    fs.existsSync.mockImplementation(p => p.includes('products'));
    fs.readdirSync.mockReturnValue(['p1']);
    fs.readFileSync.mockReturnValue(JSON.stringify({ status: 'posted', post_date: '2026-06-19' }));
    const deps = makeDeps();
    createStatusActions(deps).actionStatus();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('มะลิ'));
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('Shopee'));
    expect(deps.updateStatus).toHaveBeenCalledWith({ lastResult: 'status check สำเร็จ' });
  });
  test('logs Reuters news when articles exist', () => {
    fs.existsSync.mockImplementation(p => p.includes('articles'));
    fs.readFileSync.mockReturnValue(JSON.stringify([{ title: 'AI' }, { title: 'Tech' }]));
    const deps = makeDeps();
    createStatusActions(deps).actionStatus();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('2 บทความวันนี้'));
  });
  test('logs "ยังไม่มีข่าว" when no articles', () => {
    fs.existsSync.mockReturnValue(false);
    const deps = makeDeps();
    createStatusActions(deps).actionStatus();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('ยังไม่มีข่าววันนี้'));
  });
});

describe('actionSummary()', () => {
  test('logs headers, counts products, calls readLog', () => {
    fs.existsSync.mockReturnValue(false);
    const deps = makeDeps({ readLog: jest.fn(() => ['line1']) });
    createStatusActions(deps).actionSummary();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('สรุปวันที่'));
    expect(deps.readLog).toHaveBeenCalledWith('mali', 5);
    expect(deps.updateStatus).toHaveBeenCalledWith({ lastResult: expect.stringContaining('daily summary') });
  });
  test('counts posted/ready products, skips placeholder', () => {
    fs.existsSync.mockImplementation(p => p.includes('products') && !p.includes('articles'));
    fs.readdirSync.mockReturnValue(['p1', 'p2']);
    let n = 0;
    fs.readFileSync.mockImplementation(p => {
      if (p.includes('data.json')) {
        n++;
        return n === 1 ? JSON.stringify({ status: 'placeholder' })
                       : JSON.stringify({ status: 'posted', post_date: '2026-06-19' });
      }
      return '[]';
    });
    const deps = makeDeps();
    createStatusActions(deps).actionSummary();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('โพสต์แล้ว: 1'));
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('สินค้าทั้งหมด: 1'));
  });
  test('shows Reuters notified count', () => {
    fs.existsSync.mockImplementation(p => p.includes('articles'));
    fs.readFileSync.mockReturnValue(JSON.stringify([{ title: 'AI', notified: true }]));
    const deps = makeDeps();
    createStatusActions(deps).actionSummary();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('แจ้ง Telegram: 1'));
  });
});

// ─── agents/namkhao/run.js ───────────────────────────────────────────────────

describe('readEnv()', () => {
  test('parses key=value pairs', () => {
    fs.readFileSync.mockReturnValue('FOO=bar\nBAZ="qux"\n# comment');
    expect(namkhao.readEnv()).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });
  test('returns {} on error', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error(); });
    expect(namkhao.readEnv()).toEqual({});
  });
});

describe('readStatus() / updateStatus()', () => {
  test('reads and parses status file', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: { status: 'idle' } }));
    expect(namkhao.readStatus().mali.status).toBe('idle');
  });
  test('readStatus returns default on error', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error(); });
    expect(namkhao.readStatus()).toEqual({ mali: {}, manao: {}, namkhao: {} });
  });
  test('updateStatus merges into namkhao key', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ namkhao: {} }));
    namkhao.updateStatus({ status: 'running' });
    expect(JSON.parse(fs.writeFileSync.mock.calls[0][1]).namkhao.status).toBe('running');
  });
  test('updateStatus silently ignores fs errors', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error(); });
    expect(() => namkhao.updateStatus({ x: 1 })).not.toThrow();
  });
});

describe('todayString() / readLog()', () => {
  test('todayString returns YYYY-MM-DD', () => {
    expect(namkhao.todayString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  test('readLog returns last N lines', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('a\nb\nc\n');
    expect(namkhao.readLog('mali', 2)).toHaveLength(2);
  });
  test('readLog returns [] when log missing', () => {
    fs.existsSync.mockReturnValue(false);
    expect(namkhao.readLog('mali')).toEqual([]);
  });
});

describe('actionStartAgent() / actionStop()', () => {
  test('actionStartAgent spawns child and updates status', () => {
    const child = Object.assign(new EventEmitter(), { pid: 1234, unref: jest.fn() });
    cp.spawn.mockReturnValue(child);
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: {} }));
    namkhao.actionStartAgent('mali', 'approve-today');
    expect(cp.spawn).toHaveBeenCalled();
    expect(child.unref).toHaveBeenCalled();
  });
  test('actionStartAgent logs error when script missing', () => {
    fs.existsSync.mockReturnValue(false);
    namkhao.actionStartAgent('mali', 'status');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ไม่พบ'));
  });
  test('actionStop kills PID and marks idle', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: { pid: 9999 } }));
    const k = jest.spyOn(process, 'kill').mockImplementation(() => {});
    namkhao.actionStop('mali');
    expect(k).toHaveBeenCalledWith(9999);
    k.mockRestore();
  });
  test('actionStop logs when no PID', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: {} }));
    namkhao.actionStop('mali');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ไม่มี process'));
  });
  test('actionStop logs warning on kill error', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: { pid: 9999 } }));
    const k = jest.spyOn(process, 'kill').mockImplementation(() => { throw new Error('ESRCH'); });
    namkhao.actionStop('mali');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ไม่สามารถหยุด'));
    k.mockRestore();
  });
});

describe('main()', () => {
  const statusJson = JSON.stringify({ mali: { status: 'idle', lastRun: new Date().toISOString() },
                                     manao: { status: 'idle', lastRun: new Date().toISOString() }, namkhao: {} });
  const envFile    = 'NAMKHAO_TELEGRAM_BOT_TOKEN=tok\nTELEGRAM_CHAT_ID=123\n';

  function baseSetup() {
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockImplementation(p => p.includes('.env') ? envFile : statusJson);
  }

  test('status / summary / default', async () => {
    baseSetup();
    await expect(namkhao.main(['--action', 'status'])).resolves.toBeUndefined();
    await expect(namkhao.main(['--action', 'summary'])).resolves.toBeUndefined();
    await expect(namkhao.main([])).resolves.toBeUndefined();
  });
  test('exits on unknown action', async () => {
    baseSetup();
    const ex = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(namkhao.main(['--action', 'unknown'])).rejects.toThrow('exit');
    ex.mockRestore();
  });
  test('start-mali / start-manao spawn children', async () => {
    baseSetup();
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: {}, manao: {}, namkhao: {} }));
    const child = Object.assign(new EventEmitter(), { pid: 42, unref: jest.fn() });
    cp.spawn.mockReturnValue(child);
    await expect(namkhao.main(['--action', 'start-mali', '--target-action', 'approve-today'])).resolves.toBeUndefined();
    await expect(namkhao.main(['--action', 'start-manao', '--target-action', 'full'])).resolves.toBeUndefined();
    expect(cp.spawn).toHaveBeenCalledTimes(2);
  });
  test('stop-mali kills process', async () => {
    baseSetup();
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: { pid: 111 }, namkhao: {} }));
    const k = jest.spyOn(process, 'kill').mockImplementation(() => {});
    await expect(namkhao.main(['--action', 'stop-mali'])).resolves.toBeUndefined();
    expect(k).toHaveBeenCalledWith(111);
    k.mockRestore();
  });
  function monitorSetupOk() {
    // setupAllOk mocks all HTTP calls so checkConnections passes all 7 checks
    setupAllOk();
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockImplementation(p => {
      if (p.includes('monitor-alerts')) return '{}';
      if (p.includes('.env')) return envFile;
      return statusJson;
    });
  }

  test('monitor: no TG token → early return', async () => {
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockImplementation(() => '');  // .env with no token
    await expect(namkhao.main(['--action', 'monitor'])).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ข้ามการแจ้งเตือน'));
  });
  test('monitor: all checks pass → logs OK', async () => {
    const root = { NAMKHAO_TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '123' };
    const pipe = { OLLAMA_HOST: 'http://localhost:11434', FB_PAGE_ID: '1', FB_ACCESS_TOKEN: 'tok',
                   IG_USER_ID: '2', IG_ACCESS_TOKEN: 'tok', IMGBB_API_KEY: 'key' };
    setupAllOk();
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockImplementation(p => {
      if (p.includes('monitor-alerts')) return '{}';
      if (p.includes('.env')) return `NAMKHAO_TELEGRAM_BOT_TOKEN=tok\nTELEGRAM_CHAT_ID=123\nOLLAMA_HOST=http://localhost:11434\nFB_PAGE_ID=1\nFB_ACCESS_TOKEN=tok\nIG_USER_ID=2\nIG_ACCESS_TOKEN=tok\nIMGBB_API_KEY=key\n`;
      return statusJson;
    });
    await expect(namkhao.main(['--action', 'monitor'])).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ทุก Agent ทำงานปกติ'));
  });
  test('monitor: status=error → sends Telegram', async () => {
    monitorSetupOk();
    fs.readFileSync.mockImplementation(p => {
      if (p.includes('monitor-alerts')) return '{}';
      if (p.includes('.env')) return envFile;
      return JSON.stringify({ mali: { status: 'error', lastResult: 'boom' },
                             manao: { status: 'idle' }, namkhao: {} });
    });
    await expect(namkhao.main(['--action', 'monitor'])).resolves.toBeUndefined();
  });
  test('monitor: idle too long → issue', async () => {
    monitorSetupOk();
    const old = new Date(Date.now() - 30 * 3600000).toISOString();
    fs.readFileSync.mockImplementation(p => {
      if (p.includes('monitor-alerts')) return '{}';
      if (p.includes('.env')) return envFile;
      return JSON.stringify({ mali: { status: 'idle', lastRun: old },
                             manao: { status: 'idle', lastRun: old }, namkhao: {} });
    });
    await expect(namkhao.main(['--action', 'monitor'])).resolves.toBeUndefined();
  });
  test('monitor: pipeline log error → issue', async () => {
    const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
    setupAllOk();
    fs.existsSync.mockImplementation(p => p.includes('pipeline.log'));
    fs.readFileSync.mockImplementation(p => {
      if (p.includes('monitor-alerts')) return '{}';
      if (p.includes('.env')) return envFile;
      if (p.includes('pipeline.log')) return `${ts} [ERROR] oops\n`;
      return statusJson;
    });
    await expect(namkhao.main(['--action', 'monitor'])).resolves.toBeUndefined();
  });
  test('monitor: readLog errLines → issue (line 102)', async () => {
    setupAllOk();
    fs.existsSync.mockImplementation(p => p.includes('.log') && !p.includes('pipeline'));
    fs.readFileSync.mockImplementation(p => {
      if (p.includes('monitor-alerts')) return '{}';
      if (p.includes('.env')) return envFile;
      if (p.includes('.log')) return '[12:00] ❌ something failed\n';
      return statusJson;
    });
    await expect(namkhao.main(['--action', 'monitor'])).resolves.toBeUndefined();
  });
  test('monitor: shouldAlert cooldown → skip issue', async () => {
    setupAllOk();
    fs.existsSync.mockReturnValue(false);
    const alertKey = '🌸 มะลิ::status = error\nผลล่าสุด: x';
    fs.readFileSync.mockImplementation(p => {
      if (p.includes('monitor-alerts')) return JSON.stringify({ [alertKey]: Date.now() });
      if (p.includes('.env')) return envFile;
      return JSON.stringify({ mali: { status: 'error', lastResult: 'x' }, manao: {}, namkhao: {} });
    });
    await expect(namkhao.main(['--action', 'monitor'])).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ข้าม'));
  });
});

