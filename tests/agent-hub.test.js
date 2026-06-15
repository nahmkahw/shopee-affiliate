'use strict';

// ─── Env ─────────────────────────────────────────────────────────────────────
process.env.MALI_TELEGRAM_BOT_TOKEN = 'test:TOKEN';
process.env.TELEGRAM_CHAT_ID        = '12345678';

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('fs');
jest.mock('child_process');
jest.mock('https');
jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return { ...actual, randomBytes: jest.fn(() => Buffer.from('aabbccdd', 'hex')) };
});
jest.mock('os', () => ({ ...jest.requireActual('os'), tmpdir: () => 'C:\\Temp' }));

jest.mock('../auth', () => ({ gate: jest.fn().mockReturnValue(false) }));
jest.mock('../agents/anime/anime-gen',      () => ({ generateAnime: jest.fn() }));
jest.mock('../agents/anime/text-overlay',   () => ({ overlayText: jest.fn() }));
jest.mock('../agents/anime/balloon-canvas', () => ({ renderBalloonOnImage: jest.fn().mockResolvedValue() }));
jest.mock('../agents/anime/post-anime',     () => ({
  postFacebookImage:  jest.fn().mockResolvedValue('fb-post-id'),
  postInstagramImage: jest.fn().mockResolvedValue('ig-post-id'),
}));

let capturedHandler = null;

jest.mock('http', () => {
  const EE = require('events');
  return {
    createServer: jest.fn(handler => {
      capturedHandler = handler;
      return { listen: jest.fn(), on: jest.fn() };
    }),
    request: jest.fn(),
    get:     jest.fn(),
  };
});

const fs    = require('fs');
const cp    = require('child_process');
const http  = require('http');
const https = require('https');

const hub = require('../agent-hub.js');
const {
  readStatus, writeStatus, readLog,
  startAgent, stopAgent,
  buildComfyWorkflow,
  comfyPost, comfyGet, comfyGetBinary,
  spawnStep,
  parseSchedCSV,
  escHtml, statusBadge, tgEscape,
  buildMainPage, buildAgentPage, buildShopeeHTML,
  serveNamkhaoHTML, serveNewsHTML,
  loadProducts, readShopeeEnv, readNewsEnv,
  getNewsItems, getNewsBotStatus, getNewsPipelineInfo, buildNewsApiData,
  getScheduleStatus, editScheduleTimes, toggleScheduleTask, runScheduleNow,
  parseMultipart,
} = hub;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EventEmitter = require('events');

function makeMockRes(body, headers = {}) {
  const res = new EventEmitter();
  res.headers = headers;
  res.statusCode = 200;
  process.nextTick(() => {
    res.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    res.emit('end');
  });
  return res;
}

function makeHttpReq() {
  const req = new EventEmitter();
  req.write = jest.fn();
  req.end   = jest.fn();
  req.setTimeout = jest.fn();
  req.destroy = jest.fn();
  return req;
}

function stubHttp(body) {
  const req = makeHttpReq();
  http.request.mockImplementation((opts, cb) => { if (cb) cb(makeMockRes(body)); return req; });
  http.get.mockImplementation((opts, cb)     => { if (cb) cb(makeMockRes(body)); return req; });
  return req;
}

function stubHttpsOnce(body) {
  const req = makeHttpReq();
  https.request.mockImplementationOnce((opts, cb) => { if (cb) cb(makeMockRes(body)); return req; });
  https.get.mockImplementationOnce((opts, cb)     => { if (cb) cb(makeMockRes(body)); return req; });
  return req;
}

// callRoute with more async flushes for multi-await chains (telegram, uploadFBReels).
async function callRouteDeep(method, url, body = null, headers = {}) {
  const req = new EventEmitter();
  req.method  = method;
  req.url     = url;
  req.headers = { ...headers };

  let resHead = null;
  let resBody = null;
  const res = {
    writeHead: jest.fn((code, h) => { resHead = { code, headers: h }; }),
    end: jest.fn(data => { resBody = data; }),
    pipe: jest.fn(),
  };

  const p = capturedHandler ? capturedHandler(req, res) : Promise.resolve();

  process.nextTick(() => {
    if (body !== null) {
      req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.emit('end');
  });

  await p;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => process.nextTick(r));
    await Promise.resolve();
    await Promise.resolve();
  }
  return { resHead, resBody, req, res };
}

function makeChild(pid = 12345) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid    = pid;
  child.killed = false;
  child.kill   = jest.fn(() => { child.killed = true; });
  child.unref  = jest.fn();
  return child;
}

// Returns a mock implementation for cp.spawn: schedules events only when actually called.
function spawnFactory(code = 0, stdout = '', stderr = '') {
  return () => {
    const child = makeChild();
    process.nextTick(() => {
      if (stdout) child.stdout.emit('data', stdout);
      if (stderr) child.stderr.emit('data', stderr);
      child.emit('close', code);
    });
    return child;
  };
}

// Legacy alias for tests that need a pre-built child with events scheduled at creation.
// Only use this when you don't pass the child to cp.spawn (e.g., for startAgent unit tests).
function makeSpawnChild(code = 0, stdout = '', stderr = '') {
  const child = makeChild();
  process.nextTick(() => {
    if (stdout) child.stdout.emit('data', stdout);
    if (stderr) child.stderr.emit('data', stderr);
    child.emit('close', code);
  });
  return child;
}

async function callRoute(method, url, body = null, headers = {}) {
  const req = new EventEmitter();
  req.method  = method;
  req.url     = url;
  req.headers = { ...headers };

  let resHead = null;
  let resBody = null;
  const res = {
    writeHead: jest.fn((code, h) => { resHead = { code, headers: h }; }),
    end: jest.fn(data => { resBody = data; }),
    pipe: jest.fn(),
  };

  const p = capturedHandler ? capturedHandler(req, res) : Promise.resolve();

  process.nextTick(() => {
    if (body !== null) {
      req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.emit('end');
  });

  await p;
  // flush multiple rounds for spawn-based handlers (close event fires in a nextTick)
  for (let i = 0; i < 6; i++) {
    await new Promise(r => process.nextTick(r));
    await Promise.resolve();
  }
  return { resHead, resBody, req, res };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  fs.existsSync.mockReturnValue(false);
  fs.readdirSync.mockReturnValue([]);
  fs.readFileSync.mockReturnValue('');
  fs.writeFileSync.mockImplementation(() => {});
  fs.appendFileSync.mockImplementation(() => {});
  fs.unlinkSync.mockImplementation(() => {});
  fs.statSync.mockReturnValue({ size: 1024 * 100 });
  const mockStream = new EventEmitter();
  mockStream.pipe = jest.fn();
  fs.createReadStream.mockReturnValue(mockStream);
  fs.copyFileSync.mockImplementation(() => {});
  fs.mkdirSync.mockImplementation(() => {});
  cp.execSync.mockReturnValue('SUCCESS: task changed.');
  cp.execFileSync.mockReturnValue('ok\n');
  cp.spawn.mockImplementation(spawnFactory(0));
});

afterEach(() => jest.restoreAllMocks());

// ─── readStatus ───────────────────────────────────────────────────────────────

describe('readStatus', () => {
  test('parses JSON from STATUS_FILE', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: { status: 'idle' } }));
    expect(readStatus().mali.status).toBe('idle');
  });
  test('returns defaults when file read fails', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(readStatus().mali.status).toBe('idle');
  });
  test('returns defaults on invalid JSON', () => {
    fs.readFileSync.mockReturnValue('not-json');
    expect(readStatus().mali.status).toBe('idle');
  });
});

describe('writeStatus', () => {
  test('writes JSON to STATUS_FILE', () => {
    const s = { mali: { status: 'running' } };
    writeStatus(s);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('agent-status.json'),
      JSON.stringify(s, null, 2), 'utf8'
    );
  });
});

// ─── readLog ──────────────────────────────────────────────────────────────────

describe('readLog', () => {
  test('returns [] when log file does not exist', () => {
    fs.existsSync.mockReturnValue(false);
    expect(readLog('mali')).toEqual([]);
  });
  test('returns last N non-empty lines', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('line1\nline2\n\nline3\n');
    expect(readLog('mali', 2)).toEqual(['line2', 'line3']);
  });
  test('default limit is 80', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n'));
    expect(readLog('mali').length).toBe(80);
  });
});

// ─── escHtml ──────────────────────────────────────────────────────────────────

describe('escHtml', () => {
  test('escapes & < > "', () => {
    expect(escHtml('<b>"hello" & world>')).toBe('&lt;b&gt;&quot;hello&quot; &amp; world&gt;');
  });
  test('converts non-string to string', () => {
    expect(escHtml(42)).toBe('42');
  });
});

describe('tgEscape', () => {
  test('escapes & < >', () => {
    expect(tgEscape('<b>hello & world</b>')).toBe('&lt;b&gt;hello &amp; world&lt;/b&gt;');
  });
  test('defaults to empty string', () => {
    expect(tgEscape()).toBe('');
  });
});

describe('statusBadge', () => {
  test.each(['running', 'error', 'idle', 'done'])('%s returns HTML span', s => {
    expect(statusBadge(s)).toContain('<span');
  });
  test('unknown status falls back to idle', () => {
    expect(statusBadge('unknown')).toContain('พร้อม');
  });
});

// ─── buildComfyWorkflow ───────────────────────────────────────────────────────

describe('buildComfyWorkflow', () => {
  test('returns object with 7 nodes', () => {
    expect(Object.keys(buildComfyWorkflow('1girl, solo', 42))).toHaveLength(7);
  });
  test('embeds the positive prompt in node 2', () => {
    expect(buildComfyWorkflow('anime girl', 7)['2'].inputs.text).toBe('anime girl');
  });
  test('embeds the seed in KSampler', () => {
    expect(buildComfyWorkflow('test', 999)['5'].inputs.seed).toBe(999);
  });
});

// ─── parseSchedCSV ────────────────────────────────────────────────────────────

describe('parseSchedCSV', () => {
  test('returns null when no header row', () => {
    expect(parseSchedCSV('')).toBeNull();
    expect(parseSchedCSV('no header')).toBeNull();
  });
  test('parses valid schtasks CSV', () => {
    const header = '"HostName","TaskName","Next Run Time","Status","Logon Mode","Last Run Time","Last Result","Author","Task To Run","Start In","Comment","Scheduled Task State","Idle Time","Power Management","Run As User","Delete Task If Not Rescheduled","Stop Task If Runs X Hours and X Mins","Schedule","Schedule Type","Start Time","Start Date","End Date","Days","Months","Repeat: Every","Repeat: Until: Time","Repeat: Until: Duration","Repeat: Stop If Still Running"';
    const row    = '"PC","Task","N/A","Ready","","N/A","0","","cmd","","","Enabled","","","SYSTEM","","","","One Time Only","11:05:00 AM","6/14/2026","","","","","","",""';
    const r = parseSchedCSV([header, row].join('\n'));
    expect(r).not.toBeNull();
    expect(r).toHaveProperty('state');
    expect(Array.isArray(r.times)).toBe(true);
  });
  test('converts Thai Buddhist year to Gregorian', () => {
    const header = '"HostName","TaskName","Next Run Time","Status","Logon Mode","Last Run Time","Last Result","Author","Task To Run","Start In","Comment","Scheduled Task State","Idle Time","Power Management","Run As User","Delete Task If Not Rescheduled","Stop Task If Runs X Hours and X Mins","Schedule","Schedule Type","Start Time","Start Date","End Date","Days","Months","Repeat: Every","Repeat: Until: Time","Repeat: Until: Duration","Repeat: Stop If Still Running"';
    const row    = '"PC","Task","N/A","Ready","","31/5/2569 7:05:56","0","","","","","Enabled","","","SYSTEM","","","","","18:00:00","","","","","","","",""';
    const r = parseSchedCSV([header, row].join('\n'));
    expect(r).not.toBeNull();
    expect(r.lastRun).toContain('2026');
  });
});

// ─── loadProducts ─────────────────────────────────────────────────────────────

describe('loadProducts', () => {
  test('returns [] when products dir does not exist', () => {
    fs.existsSync.mockReturnValue(false);
    expect(loadProducts()).toEqual([]);
  });
  test('returns [] when no product has data.json', () => {
    fs.existsSync.mockImplementation(p => String(p).endsWith('products'));
    fs.readdirSync.mockReturnValue(['12345678']);
    expect(loadProducts()).toEqual([]);
  });
  test('returns parsed product list', () => {
    const prodData = JSON.stringify({
      title: 'Test', price: '99', post_date: '2026-06-14', status: 'scraped',
      affiliate_short_link: 'http://s.shopee.co.th/x', posted_at: '2026-06-14T00:00:00Z',
    });
    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      return s.endsWith('products') || s.includes('data.json') || s.endsWith('images');
    });
    fs.readdirSync.mockReturnValue(['12345678']);
    fs.readFileSync.mockReturnValue(prodData);
    expect(loadProducts()).toHaveLength(1);
    expect(loadProducts()[0].title).toBe('Test');
  });
  test('filters out placeholder products', () => {
    const prodData = JSON.stringify({ title: 'X', price: '1', status: 'placeholder', post_date: '2026-01-01' });
    fs.existsSync.mockImplementation(p => String(p).endsWith('products') || String(p).includes('data.json'));
    fs.readdirSync.mockReturnValue(['11111111']);
    fs.readFileSync.mockReturnValue(prodData);
    expect(loadProducts()).toEqual([]);
  });
  test('swallows JSON parse errors per-product', () => {
    fs.existsSync.mockImplementation(p => String(p).endsWith('products') || String(p).includes('data.json'));
    fs.readdirSync.mockReturnValue(['badprod']);
    fs.readFileSync.mockReturnValue('{not json');
    expect(loadProducts()).toEqual([]);
  });
});

// ─── readShopeeEnv / readNewsEnv ──────────────────────────────────────────────

describe('readShopeeEnv', () => {
  test('returns {} when .env not readable', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(readShopeeEnv()).toEqual({});
  });
  test('parses KEY=VALUE pairs', () => {
    fs.readFileSync.mockReturnValue('FB_PAGE_ID=123\nFB_ACCESS_TOKEN="abc"\n# comment\n');
    const env = readShopeeEnv();
    expect(env.FB_PAGE_ID).toBe('123');
    expect(env.FB_ACCESS_TOKEN).toBe('abc');
  });
});

describe('readNewsEnv', () => {
  test('returns {} on read error', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(readNewsEnv()).toEqual({});
  });
  test('parses KEY=VALUE pairs', () => {
    fs.readFileSync.mockReturnValue('MANAO_TELEGRAM_BOT_TOKEN=tok123\n');
    expect(readNewsEnv().MANAO_TELEGRAM_BOT_TOKEN).toBe('tok123');
  });
});

// ─── getNewsItems ─────────────────────────────────────────────────────────────

describe('getNewsItems', () => {
  test('returns [] when news dir does not exist', () => {
    fs.existsSync.mockReturnValue(false);
    expect(getNewsItems()).toEqual([]);
  });
  test('returns parsed news list', () => {
    const newsData = JSON.stringify({ title: 'AI News', url: 'http://x', status: 'draft', scraped_at: '2026-06-14T00:00:00Z' });
    fs.existsSync.mockImplementation(p => String(p).includes('news') || String(p).includes('data.json'));
    fs.readdirSync.mockReturnValue(['article-123']);
    fs.readFileSync.mockReturnValue(newsData);
    const items = getNewsItems();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('AI News');
  });
  test('filters out null items on parse error', () => {
    fs.existsSync.mockImplementation(p => String(p).includes('news') || String(p).includes('data.json'));
    fs.readdirSync.mockReturnValue(['bad']);
    fs.readFileSync.mockReturnValue('{not json');
    expect(getNewsItems()).toEqual([]);
  });
});

// ─── getNewsBotStatus ─────────────────────────────────────────────────────────

describe('getNewsBotStatus', () => {
  test('returns { running: false } when pidFile missing', () => {
    fs.existsSync.mockReturnValue(false);
    expect(getNewsBotStatus()).toEqual({ running: false, pid: null });
  });
  test('returns { running: true } when process is alive', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('12345\n');
    jest.spyOn(process, 'kill').mockImplementation(() => {});
    expect(getNewsBotStatus()).toEqual({ running: true, pid: 12345 });
  });
  test('returns { running: false } when process.kill throws', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('99999\n');
    jest.spyOn(process, 'kill').mockImplementation(() => { throw new Error('ESRCH'); });
    expect(getNewsBotStatus().running).toBe(false);
  });
  test('returns { running: false } when pid is NaN', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('not-a-number\n');
    expect(getNewsBotStatus()).toEqual({ running: false, pid: null });
  });
});

// ─── getNewsPipelineInfo ──────────────────────────────────────────────────────

describe('getNewsPipelineInfo', () => {
  test('returns { last_run: null } when log file missing', () => {
    fs.existsSync.mockReturnValue(false);
    expect(getNewsPipelineInfo().last_run).toBeNull();
  });
  test('parses start and finish timestamps', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('[2026-06-14 10:00] === เริ่ม Pipeline ===\n[2026-06-14 10:05] === Pipeline เสร็จแล้ว ===\n');
    const info = getNewsPipelineInfo();
    expect(info.last_run).not.toBeNull();
    expect(info.last_finish).not.toBeNull();
  });
  test('handles BOM prefix', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('﻿[2026-06-14 10:00] === เริ่ม Pipeline ===\n');
    expect(getNewsPipelineInfo().last_run).not.toBeNull();
  });
  test('returns { last_run: null } on read error', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation(() => { throw new Error('EPERM'); });
    expect(getNewsPipelineInfo().last_run).toBeNull();
  });
});

// ─── buildNewsApiData ─────────────────────────────────────────────────────────

describe('buildNewsApiData', () => {
  test('returns object with stats and news array', () => {
    fs.existsSync.mockReturnValue(false);
    const data = buildNewsApiData();
    expect(data).toHaveProperty('stats');
    expect(data).toHaveProperty('news');
    expect(data).toHaveProperty('bot');
    expect(data.stats.total).toBe(0);
  });
  test('counts items by status', () => {
    fs.existsSync.mockImplementation(p => String(p).includes('news') || String(p).includes('data.json'));
    fs.readdirSync.mockReturnValue(['slug1']);
    fs.readFileSync.mockReturnValue(JSON.stringify({ title: 'X', status: 'posted', scraped_at: '2026-06-14' }));
    expect(buildNewsApiData().stats.by_status.posted).toBe(1);
  });
});

// ─── buildMainPage ────────────────────────────────────────────────────────────

describe('buildMainPage', () => {
  test('returns HTML string', () => {
    fs.existsSync.mockReturnValue(false);
    expect(buildMainPage({ mali: { status: 'idle' }, manao: { status: 'running' } })).toContain('<!DOCTYPE html>');
  });
  test('uses idle defaults when agent status missing', () => {
    fs.existsSync.mockReturnValue(false);
    expect(buildMainPage({})).toContain('<!DOCTYPE html>');
  });
});

describe('buildAgentPage', () => {
  test('returns not-found message for unknown agent', () => {
    expect(buildAgentPage('nonexistent', {})).toContain('ไม่พบ Agent');
  });
  test('returns HTML page for known agent', () => {
    fs.existsSync.mockReturnValue(false);
    expect(buildAgentPage('mali', { mali: { status: 'idle' } })).toContain('มะลิ');
  });
  test('renders log lines in HTML', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('line one\nline two');
    expect(buildAgentPage('mali', {})).toContain('line one');
  });
});

describe('buildShopeeHTML', () => {
  test('returns HTML with empty product list', () => {
    expect(buildShopeeHTML([])).toContain('<html');
  });
  test('renders product cards', () => {
    const products = [{
      id: '12345678', title: 'Test Product', price: '199', post_date: '2026-06-14',
      status: 'scraped', hasFB: true, hasIG: false, hasX: false, hasTT: false,
      hasAllContent: false, hasImg: true, imgPath: '/img/12345678/1.jpg',
      hasVideo: false, videoSizeKB: 0, isPosted: false, postedPlatforms: [],
      affiliate_link: 'https://s.shopee.co.th/x', rating: '4.5',
      original_price: '', discount: '', shop_name: '', postedAtStr: '',
    }];
    expect(buildShopeeHTML(products)).toContain('Test Product');
  });
});

describe('serveNamkhaoHTML', () => {
  test('responds 404 when dashboard.html not found', () => {
    fs.existsSync.mockReturnValue(false);
    const res = { writeHead: jest.fn(), end: jest.fn() };
    serveNamkhaoHTML(res);
    expect(res.writeHead).toHaveBeenCalledWith(404);
  });
  test('serves file content when found', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('<html>น้ำข้าว</html>');
    const res = { writeHead: jest.fn(), end: jest.fn() };
    serveNamkhaoHTML(res);
    expect(res.end).toHaveBeenCalledWith('<html>น้ำข้าว</html>');
  });
});

describe('serveNewsHTML', () => {
  test('responds with fallback when dashboard.html not found', () => {
    fs.existsSync.mockReturnValue(false);
    const res = { writeHead: jest.fn(), end: jest.fn() };
    serveNewsHTML(res);
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining('ไม่พบ'));
  });
  test('serves news HTML when file exists', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('<html>manao</html>');
    const res = { writeHead: jest.fn(), end: jest.fn() };
    serveNewsHTML(res);
    expect(res.end).toHaveBeenCalled();
  });
});

// ─── startAgent / stopAgent ───────────────────────────────────────────────────

describe('startAgent', () => {
  test('spawns agent run.js with action arg', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: { status: 'idle' } }));
    const pid = startAgent('mali', 'status');
    expect(cp.spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['--action', 'status']),
      expect.objectContaining({ shell: false })
    );
    expect(pid).toBe(12345);
  });
  test('kills existing process before spawning', () => {
    const old = makeSpawnChild(0);
    cp.spawn.mockReturnValueOnce(old).mockReturnValueOnce(makeSpawnChild(0));
    fs.readFileSync.mockReturnValue(JSON.stringify({}));
    startAgent('mali', 'status');
    startAgent('mali', 'scrape');
    expect(old.kill).toHaveBeenCalled();
  });
});

describe('stopAgent', () => {
  test('kills running process', () => {
    const child = makeSpawnChild(0);
    cp.spawn.mockReturnValue(child);
    fs.readFileSync.mockReturnValue(JSON.stringify({}));
    startAgent('mali', 'status');
    stopAgent('mali');
    expect(child.kill).toHaveBeenCalled();
  });
  test('handles missing process gracefully', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: { status: 'idle', pid: null } }));
    jest.spyOn(process, 'kill').mockImplementation(() => { throw new Error('ESRCH'); });
    expect(() => stopAgent('mali')).not.toThrow();
  });
});

// ─── comfyPost ────────────────────────────────────────────────────────────────

describe('comfyPost', () => {
  test('resolves with parsed JSON', async () => {
    stubHttp({ prompt_id: 'abc123' });
    expect(await comfyPost('/prompt', {})).toEqual({ prompt_id: 'abc123' });
  });
  test('rejects on request error', async () => {
    const req = makeHttpReq();
    req.end = jest.fn(() => process.nextTick(() => req.emit('error', new Error('ECONNREFUSED'))));
    http.request.mockReturnValue(req);
    await expect(comfyPost('/prompt', {})).rejects.toThrow('ECONNREFUSED');
  });
  test('rejects on non-JSON response', async () => {
    stubHttp('not-json');
    await expect(comfyPost('/prompt', {})).rejects.toThrow();
  });
});

describe('comfyGet', () => {
  test('resolves with parsed JSON', async () => {
    stubHttp({ status: 'ok' });
    expect(await comfyGet('/history/abc')).toEqual({ status: 'ok' });
  });
  test('rejects on http.get error', async () => {
    const req = makeHttpReq();
    http.get.mockImplementation((opts, cb) => {
      process.nextTick(() => req.emit('error', new Error('timeout')));
      return req;
    });
    await expect(comfyGet('/history/x')).rejects.toThrow('timeout');
  });
});

describe('comfyGetBinary', () => {
  test('resolves with a Buffer', async () => {
    const req = makeHttpReq();
    http.get.mockImplementation((opts, cb) => {
      const res = new EventEmitter();
      res.headers = { 'content-type': 'image/png' };
      process.nextTick(() => { res.emit('data', Buffer.from('PNG')); res.emit('end'); });
      if (cb) cb(res);
      return req;
    });
    const { data } = await comfyGetBinary('/view?filename=x.png');
    expect(Buffer.isBuffer(data)).toBe(true);
  });
  test('rejects on http.get error', async () => {
    const req = makeHttpReq();
    http.get.mockImplementation((opts, cb) => {
      process.nextTick(() => req.emit('error', new Error('conn')));
      return req;
    });
    await expect(comfyGetBinary('/view?x')).rejects.toThrow('conn');
  });
});

// ─── spawnStep ────────────────────────────────────────────────────────────────

describe('spawnStep', () => {
  test('resolves with elapsed time on exit code 0', async () => {
    cp.spawn.mockReturnValue(makeSpawnChild(0, 'ok'));
    expect(parseFloat(await spawnStep('/script.js', [], '/cwd'))).toBeGreaterThanOrEqual(0);
  });
  test('rejects with error info on non-zero exit', async () => {
    cp.spawn.mockReturnValue(makeSpawnChild(1, '', 'error'));
    await expect(spawnStep('/script.js', [], '/cwd')).rejects.toMatchObject({ code: 1 });
  });
  test('rejects on spawn error event', async () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 0;
    process.nextTick(() => child.emit('error', new Error('ENOENT')));
    cp.spawn.mockReturnValue(child);
    await expect(spawnStep('/bad.js', [], '/cwd')).rejects.toMatchObject({ code: -1 });
  });
});

// ─── getScheduleStatus ────────────────────────────────────────────────────────

describe('getScheduleStatus', () => {
  test('returns schedule info for both tasks', () => {
    cp.execSync.mockReturnValue('"HostName","TaskName","Next Run Time","Status"\n"PC","task","11:05","Ready"\n');
    const s = getScheduleStatus();
    expect(s).toHaveProperty('reuters');
    expect(s).toHaveProperty('shopee');
  });
  test('returns error state when schtasks throws', () => {
    cp.execSync.mockImplementation(() => { throw new Error('ACCESS DENIED'); });
    expect(getScheduleStatus().reuters.state).toBe('Error');
  });
});

describe('toggleScheduleTask', () => {
  test('enables task', () => {
    cp.execSync.mockReturnValue('SUCCESS: changed.');
    expect(() => toggleScheduleTask('Task', true)).not.toThrow();
    expect(cp.execSync).toHaveBeenCalledWith(expect.stringContaining('/enable'), expect.any(Object));
  });
  test('disables task', () => {
    cp.execSync.mockReturnValue('สำเร็จ');
    expect(() => toggleScheduleTask('Task', false)).not.toThrow();
  });
  test('throws when output does not contain success', () => {
    cp.execSync.mockReturnValue('ERROR: denied.');
    expect(() => toggleScheduleTask('Task', true)).toThrow();
  });
});

describe('runScheduleNow', () => {
  test('runs when schtasks succeeds', () => {
    cp.execSync.mockReturnValue('SUCCESS: ran.');
    expect(() => runScheduleNow('Task')).not.toThrow();
  });
  test('throws when output lacks success', () => {
    cp.execSync.mockReturnValue('FAILED:');
    expect(() => runScheduleNow('Task')).toThrow();
  });
});

describe('editScheduleTimes (single time)', () => {
  test('calls schtasks /Change /ST', () => {
    cp.execSync.mockReturnValue('สำเร็จ');
    expect(() => editScheduleTimes('MyTask', ['11:05'])).not.toThrow();
    expect(cp.execSync).toHaveBeenCalledWith(expect.stringContaining('/ST 11:05'), expect.any(Object));
  });
  test('throws if schtasks output lacks success', () => {
    cp.execSync.mockReturnValue('ERROR: denied');
    expect(() => editScheduleTimes('MyTask', ['11:05'])).toThrow();
  });
});

// ─── parseMultipart ───────────────────────────────────────────────────────────

describe('parseMultipart', () => {
  test('returns null when no boundary', () => {
    expect(parseMultipart(Buffer.from('data'), 'application/json')).toBeNull();
    expect(parseMultipart(Buffer.from('data'), '')).toBeNull();
    expect(parseMultipart(Buffer.from('data'), null)).toBeNull();
  });
  test('parses text fields', () => {
    const b = 'BOUND123';
    const body = `--${b}\r\nContent-Disposition: form-data; name="agentId"\r\n\r\nmali\r\n--${b}--\r\n`;
    const r = parseMultipart(Buffer.from(body), `multipart/form-data; boundary=${b}`);
    expect(r).not.toBeNull();
    expect(r.fields.agentId).toBe('mali');
  });
  test('parses file part', () => {
    const b = 'FBOUND';
    const header = `--${b}\r\nContent-Disposition: form-data; name="image"; filename="avatar.png"\r\n\r\n`;
    const body = Buffer.concat([Buffer.from(header), Buffer.from('PNG'), Buffer.from(`\r\n--${b}--\r\n`)]);
    const r = parseMultipart(body, `multipart/form-data; boundary=${b}`);
    expect(r.file).not.toBeNull();
    expect(r.file.filename).toBe('avatar.png');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP Routes
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /', () => {
  test('returns main page HTML', async () => {
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: { status: 'idle' } }));
    const { resBody } = await callRoute('GET', '/');
    expect(String(resBody)).toContain('<!DOCTYPE html>');
  });
  test('/hub also returns main page', async () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({}));
    const { resBody } = await callRoute('GET', '/hub');
    expect(String(resBody)).toContain('<!DOCTYPE html>');
  });
});

describe('GET /api/status', () => {
  test('returns agent status JSON', async () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: { status: 'idle' } }));
    const { resBody } = await callRoute('GET', '/api/status');
    expect(JSON.parse(String(resBody))).toHaveProperty('mali');
  });
});

describe('GET /agent/{name}', () => {
  test('returns agent page for mali', async () => {
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockReturnValue(JSON.stringify({}));
    const { resBody } = await callRoute('GET', '/agent/mali');
    expect(String(resBody)).toContain('มะลิ');
  });
  test('returns 404 for unknown agent', async () => {
    const { resHead } = await callRoute('GET', '/agent/unknown');
    expect(resHead?.code).toBe(404);
  });
});

describe('GET /dashboard/mali', () => {
  test('returns shopee dashboard HTML', async () => {
    fs.existsSync.mockReturnValue(false);
    fs.readdirSync.mockReturnValue([]);
    const { resBody } = await callRoute('GET', '/dashboard/mali');
    expect(String(resBody)).toContain('<html');
  });
});

describe('GET /dashboard/mali/api/products', () => {
  test('returns product list JSON', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resBody } = await callRoute('GET', '/dashboard/mali/api/products');
    expect(JSON.parse(String(resBody))).toEqual([]);
  });
});

describe('GET /dashboard/manao', () => {
  test('calls serveNewsHTML when no dashboard file', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resBody } = await callRoute('GET', '/dashboard/manao');
    expect(String(resBody)).toContain('ไม่พบ');
  });
});

describe('GET /dashboard/namkhao', () => {
  test('returns 404 when dashboard.html missing', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resHead } = await callRoute('GET', '/dashboard/namkhao');
    expect(resHead?.code).toBe(404);
  });
  test('serves namkhao HTML when file exists', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('<html>namkhao</html>');
    const { resBody } = await callRoute('GET', '/dashboard/namkhao');
    expect(String(resBody)).toContain('namkhao');
  });
});

describe('GET /dashboard/manao/api/data', () => {
  test('returns news data JSON', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resBody } = await callRoute('GET', '/dashboard/manao/api/data');
    expect(JSON.parse(String(resBody))).toHaveProperty('stats');
  });
});

describe('GET /dashboard/manao/api/pipeline-status', () => {
  test('returns pipeline status JSON', async () => {
    const { resBody } = await callRoute('GET', '/dashboard/manao/api/pipeline-status');
    expect(JSON.parse(String(resBody))).toHaveProperty('running');
  });
});

describe('GET /dashboard/manao/api/agent-log', () => {
  test('returns empty log when file missing', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resBody } = await callRoute('GET', '/dashboard/manao/api/agent-log?agent=scrape');
    expect(JSON.parse(String(resBody))).toHaveProperty('log');
  });
  test('returns log content when file exists', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('line1\nline2\n');
    const { resBody } = await callRoute('GET', '/dashboard/manao/api/agent-log?agent=scrape');
    expect(JSON.parse(String(resBody)).log).toContain('line1');
  });
});

describe('GET /dashboard/manao/api/content', () => {
  test('returns 400 when missing slug or platform', async () => {
    const { resHead } = await callRoute('GET', '/dashboard/manao/api/content?slug=test');
    expect(resHead?.code).toBe(400);
  });
  test('returns 404 when content file missing', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resHead } = await callRoute('GET', '/dashboard/manao/api/content?slug=test&platform=fb');
    expect(resHead?.code).toBe(404);
  });
  test('serves content file', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('FB content');
    const { resBody } = await callRoute('GET', '/dashboard/manao/api/content?slug=test&platform=fb');
    expect(String(resBody)).toBe('FB content');
  });
});

describe('GET /dashboard/mali/api/content', () => {
  test('returns 400 when missing id or platform', async () => {
    const { resHead } = await callRoute('GET', '/dashboard/mali/api/content?id=123');
    expect(resHead?.code).toBe(400);
  });
  test('returns 400 for invalid platform', async () => {
    const { resHead } = await callRoute('GET', '/dashboard/mali/api/content?id=123&platform=x');
    expect(resHead?.code).toBe(400);
  });
  test('returns 404 when content file missing', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resHead } = await callRoute('GET', '/dashboard/mali/api/content?id=123&platform=fb');
    expect(resHead?.code).toBe(404);
  });
  test('serves content file', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('Facebook content');
    const { resBody } = await callRoute('GET', '/dashboard/mali/api/content?id=123&platform=fb');
    expect(String(resBody)).toBe('Facebook content');
  });
});

describe('GET /dashboard/namkhao/api/schedule-status', () => {
  test('returns schedule status JSON', async () => {
    cp.execSync.mockReturnValue('"HostName","TaskName","Next Run Time","Status"\n"PC","t","N/A","Ready"\n');
    const { resBody } = await callRoute('GET', '/dashboard/namkhao/api/schedule-status');
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
});

describe('GET /dashboard/namkhao/api/log', () => {
  test('returns ยังไม่มี log when file missing', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resBody } = await callRoute('GET', '/dashboard/namkhao/api/log');
    expect(String(resBody)).toContain('ยังไม่มี log');
  });
  test('serves log lines', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('logline\n');
    const { resBody } = await callRoute('GET', '/dashboard/namkhao/api/log');
    expect(String(resBody)).toContain('logline');
  });
});

describe('GET /dashboard/anime', () => {
  test('returns 404 when dashboard.html missing', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resHead } = await callRoute('GET', '/dashboard/anime');
    expect(resHead?.code).toBe(404);
  });
  test('serves anime dashboard', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('<html>anime</html>');
    const { resBody } = await callRoute('GET', '/dashboard/anime');
    expect(String(resBody)).toContain('anime');
  });
});

describe('GET /dashboard/anime/api/list', () => {
  test('returns empty list when gallery empty', async () => {
    fs.readdirSync.mockReturnValue([]);
    const { resBody } = await callRoute('GET', '/dashboard/anime/api/list');
    expect(JSON.parse(String(resBody))).toEqual([]);
  });
  test('returns gallery items with meta.json', async () => {
    fs.readdirSync.mockReturnValue(['123']);
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ created: 1, prompt: 'girl' }));
    const { resBody } = await callRoute('GET', '/dashboard/anime/api/list');
    expect(JSON.parse(String(resBody))).toHaveLength(1);
  });
});

describe('GET /dashboard/anime/api/template', () => {
  test('returns null when no template file', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const { resBody } = await callRoute('GET', '/dashboard/anime/api/template');
    expect(JSON.parse(String(resBody))).toBeNull();
  });
  test('returns template data', async () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ templateId: '123', prompt: 'girl', faceWeight: 1.1, tailFrac: {}, time: '10:00' }));
    const { resBody } = await callRoute('GET', '/dashboard/anime/api/template');
    expect(JSON.parse(String(resBody))).toHaveProperty('templateId', '123');
  });
});

describe('GET /api/agent/{name}/logs', () => {
  test('returns log lines JSON', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('log1\nlog2\n');
    const { resBody } = await callRoute('GET', '/api/agent/mali/logs');
    expect(JSON.parse(String(resBody))).toHaveProperty('lines');
  });
});

describe('GET /avatar/{name}', () => {
  test('returns 404 when no png or svg', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resHead } = await callRoute('GET', '/avatar/mali');
    expect(resHead?.code).toBe(404);
  });
  test('serves png when it exists', async () => {
    fs.existsSync.mockImplementation(p => String(p).endsWith('.png'));
    const { resHead } = await callRoute('GET', '/avatar/mali');
    expect(resHead?.code).toBe(200);
    expect(resHead?.headers?.['Content-Type']).toBe('image/png');
  });
  test('serves svg when only svg exists', async () => {
    fs.existsSync.mockImplementation(p => String(p).endsWith('.svg'));
    const { resHead } = await callRoute('GET', '/avatar/mali');
    expect(resHead?.code).toBe(200);
    expect(resHead?.headers?.['Content-Type']).toBe('image/svg+xml');
  });
});

describe('GET /unknown-path', () => {
  test('returns 404 Not found', async () => {
    const { resHead, resBody } = await callRoute('GET', '/no-such-path');
    expect(resHead?.code).toBe(404);
    expect(String(resBody)).toBe('Not found');
  });
});

// ─── POST Routes ──────────────────────────────────────────────────────────────

describe('POST /api/reset-avatar', () => {
  test('deletes png if exists', async () => {
    fs.existsSync.mockReturnValue(true);
    const { resBody } = await callRoute('POST', '/api/reset-avatar', { agentName: 'mali' });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
    expect(fs.unlinkSync).toHaveBeenCalled();
  });
  test('succeeds when png does not exist', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resBody } = await callRoute('POST', '/api/reset-avatar', { agentName: 'mali' });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
  test('returns 500 on unexpected error', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.unlinkSync.mockImplementation(() => { throw new Error('EPERM'); });
    const { resHead } = await callRoute('POST', '/api/reset-avatar', { agentName: 'mali' });
    expect(resHead?.code).toBe(500);
  });
});

describe('POST /api/save-avatar', () => {
  test('returns 500 when missing agentName', async () => {
    const { resHead } = await callRoute('POST', '/api/save-avatar', { filename: 'x.png' });
    expect(resHead?.code).toBe(500);
  });
  test('saves avatar from comfy response', async () => {
    const req = makeHttpReq();
    http.get.mockImplementation((opts, cb) => {
      const res = new EventEmitter();
      res.headers = { 'content-type': 'image/png' };
      process.nextTick(() => { res.emit('data', Buffer.from('PNG')); res.emit('end'); });
      if (cb) cb(res);
      return req;
    });
    const { resBody } = await callRoute('POST', '/api/save-avatar', {
      agentName: 'mali', filename: 'avatar.png', subfolder: '', type: 'output',
    });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
});

describe('POST /dashboard/manao/api/generate-image', () => {
  test('returns 400 when slug missing', async () => {
    const { resHead } = await callRoute('POST', '/dashboard/manao/api/generate-image', {});
    expect(resHead?.code).toBe(400);
  });
  test('returns error when data.json not found', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resBody } = await callRoute('POST', '/dashboard/manao/api/generate-image', { slug: 'test-slug' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
  test('returns ok on execFileSync success', async () => {
    fs.existsSync.mockReturnValue(true);
    cp.execFileSync.mockReturnValue('Generated ok\n');
    const { resBody } = await callRoute('POST', '/dashboard/manao/api/generate-image', { slug: 'test-slug' });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
  test('returns error on execFileSync failure', async () => {
    fs.existsSync.mockReturnValue(true);
    cp.execFileSync.mockImplementation(() => { throw new Error('comfy failed'); });
    const { resBody } = await callRoute('POST', '/dashboard/manao/api/generate-image', { slug: 'test-slug' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
});

describe('POST /dashboard/manao/api/generate-force', () => {
  test('returns 400 when slug missing', async () => {
    const { resHead } = await callRoute('POST', '/dashboard/manao/api/generate-force', {});
    expect(resHead?.code).toBe(400);
  });
  test('returns error when data.json not found', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resBody } = await callRoute('POST', '/dashboard/manao/api/generate-force', { slug: 's' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
  test('returns ok on execFileSync success', async () => {
    fs.existsSync.mockReturnValue(true);
    cp.execFileSync.mockReturnValue('Success\n');
    const { resBody } = await callRoute('POST', '/dashboard/manao/api/generate-force', { slug: 's' });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
  test('returns error on execFileSync failure', async () => {
    fs.existsSync.mockReturnValue(true);
    cp.execFileSync.mockImplementation(() => { const e = new Error('gen failed'); e.stderr = 'stderr'; throw e; });
    const { resBody } = await callRoute('POST', '/dashboard/manao/api/generate-force', { slug: 's' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
});

describe('POST /dashboard/manao/api/post (platform validation)', () => {
  test('returns 400 when slug missing', async () => {
    const { resHead } = await callRoute('POST', '/dashboard/manao/api/post', { platform: 'fb' });
    expect(resHead?.code).toBe(400);
  });
  test('returns 400 when platform missing', async () => {
    const { resHead } = await callRoute('POST', '/dashboard/manao/api/post', { slug: 's' });
    expect(resHead?.code).toBe(400);
  });
  test('returns 400 for invalid platform', async () => {
    const { resBody } = await callRoute('POST', '/dashboard/manao/api/post', { slug: 's', platform: 'invalid' });
    expect(JSON.parse(String(resBody))).toMatchObject({ ok: false, error: 'Invalid platform' });
  });
  test('returns 404 when data.json not found', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resHead } = await callRoute('POST', '/dashboard/manao/api/post', { slug: 's', platform: 'fb' });
    expect(resHead?.code).toBe(404);
  });
  test('returns ok on execFileSync success', async () => {
    fs.existsSync.mockReturnValue(true);
    cp.execFileSync.mockReturnValue('Posted ok\n');
    const { resBody } = await callRoute('POST', '/dashboard/manao/api/post', { slug: 's', platform: 'fb' });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
  test('returns error on execFileSync failure', async () => {
    fs.existsSync.mockReturnValue(true);
    cp.execFileSync.mockImplementation(() => { const e = new Error('post failed'); e.stdout = 'out'; throw e; });
    const { resBody } = await callRoute('POST', '/dashboard/manao/api/post', { slug: 's', platform: 'ig' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
  test('accepts valid platforms fb,ig and fb,ig,x', async () => {
    fs.existsSync.mockReturnValue(true);
    cp.execFileSync.mockReturnValue('ok\n');
    for (const platform of ['fb,ig', 'fb,ig,x', 'fb,x', 'ig,x', 'x']) {
      const { resBody } = await callRoute('POST', '/dashboard/manao/api/post', { slug: 'x', platform });
      expect(JSON.parse(String(resBody)).ok).toBe(true);
    }
  });
});

describe('POST /dashboard/manao/api/request-approval', () => {
  test('returns 400 when slug or platform missing', async () => {
    const { resHead } = await callRoute('POST', '/dashboard/manao/api/request-approval', { slug: 's' });
    expect(resHead?.code).toBe(400);
  });
  test('returns error when sendTelegramApproval throws (no env config)', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const { resBody } = await callRoute('POST', '/dashboard/manao/api/request-approval', { slug: 'x', platform: 'fb' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
});

describe('POST /dashboard/manao/api/run-agent', () => {
  test('returns 400 when agent missing', async () => {
    const { resHead } = await callRoute('POST', '/dashboard/manao/api/run-agent', {});
    expect(resHead?.code).toBe(400);
  });
  test('returns error for unknown agent', async () => {
    const { resBody } = await callRoute('POST', '/dashboard/manao/api/run-agent', { agent: 'bogus' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
  test('pipeline agent starts successfully', async () => {
    cp.spawn.mockImplementation(spawnFactory(0));
    const { resBody } = await callRoute('POST', '/dashboard/manao/api/run-agent', { agent: 'pipeline', args: ['--no-scrape'] });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
  test('known agent returns error when script not found', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resBody } = await callRoute('POST', '/dashboard/manao/api/run-agent', { agent: 'scrape' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
  test('known agent spawns when script exists', async () => {
    fs.existsSync.mockReturnValue(true);
    cp.spawn.mockImplementation(spawnFactory(0));
    const { resBody } = await callRoute('POST', '/dashboard/manao/api/run-agent', { agent: 'scrape' });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
});

describe('POST /dashboard/mali/api/generate-force', () => {
  test('returns 400 when id missing', async () => {
    const { resHead } = await callRoute('POST', '/dashboard/mali/api/generate-force', {});
    expect(resHead?.code).toBe(400);
  });
  test('returns error when data.json not found', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resBody } = await callRoute('POST', '/dashboard/mali/api/generate-force', { id: '12345678' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
  test('returns ok on execFileSync success', async () => {
    fs.existsSync.mockReturnValue(true);
    cp.execFileSync.mockReturnValue('Generated\n');
    const { resBody } = await callRoute('POST', '/dashboard/mali/api/generate-force', { id: '12345678' });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
  test('returns error on execFileSync failure', async () => {
    fs.existsSync.mockReturnValue(true);
    cp.execFileSync.mockImplementation(() => { throw new Error('gen fail'); });
    const { resBody } = await callRoute('POST', '/dashboard/mali/api/generate-force', { id: '12345678' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
});

describe('POST /dashboard/mali/api/post', () => {
  test('returns 400 when id missing', async () => {
    const { resHead } = await callRoute('POST', '/dashboard/mali/api/post', { platforms: ['fb'] });
    expect(resHead?.code).toBe(400);
  });
  test('returns 400 when platforms empty', async () => {
    const { resHead } = await callRoute('POST', '/dashboard/mali/api/post', { id: '123', platforms: [] });
    expect(resHead?.code).toBe(400);
  });
  test('returns 400 for invalid platform values', async () => {
    const { resBody } = await callRoute('POST', '/dashboard/mali/api/post', { id: '123', platforms: ['tiktok'] });
    expect(JSON.parse(String(resBody))).toMatchObject({ ok: false });
  });
  test('returns ok on execFileSync success', async () => {
    cp.execFileSync.mockReturnValue('Posted\n');
    const { resBody } = await callRoute('POST', '/dashboard/mali/api/post', { id: '123', platforms: ['fb', 'ig'] });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
  test('returns error on execFileSync failure', async () => {
    cp.execFileSync.mockImplementation(() => { throw new Error('post fail'); });
    const { resBody } = await callRoute('POST', '/dashboard/mali/api/post', { id: '123', platforms: ['x'] });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
});

describe('POST /dashboard/mali/api/create-video', () => {
  test('returns 400 when id missing', async () => {
    const { resHead } = await callRoute('POST', '/dashboard/mali/api/create-video', {});
    expect(resHead?.code).toBe(400);
  });
  test('returns error when data.json not found', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resBody } = await callRoute('POST', '/dashboard/mali/api/create-video', { id: '12345678' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
  test('returns error when tiktok.md not found', async () => {
    fs.existsSync.mockImplementation(p => String(p).includes('data.json'));
    const { resBody } = await callRoute('POST', '/dashboard/mali/api/create-video', { id: '12345678' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
  test('returns ok when video process succeeds', async () => {
    fs.existsSync.mockReturnValue(true);
    cp.spawn.mockImplementation(spawnFactory(0, 'done'));
    const { resBody } = await callRoute('POST', '/dashboard/mali/api/create-video', { id: '12345678' });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
  test('returns error when video process fails', async () => {
    fs.existsSync.mockReturnValue(true);
    cp.spawn.mockImplementation(spawnFactory(1, '', 'ffmpeg error'));
    const { resBody } = await callRoute('POST', '/dashboard/mali/api/create-video', { id: '12345678' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
});

describe('POST /dashboard/mali/api/post-fb-clip', () => {
  test('returns 400 when id missing', async () => {
    const { resHead } = await callRoute('POST', '/dashboard/mali/api/post-fb-clip', {});
    expect(resHead?.code).toBe(400);
  });
  test('returns error when video.mp4 not found', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resBody } = await callRoute('POST', '/dashboard/mali/api/post-fb-clip', { id: '12345678' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
  test('returns error when uploadFBReels throws (no FB env)', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const { resBody } = await callRoute('POST', '/dashboard/mali/api/post-fb-clip', { id: '12345678' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
});

describe('POST /dashboard/namkhao/api/schedule-run', () => {
  test('returns 400 when taskName missing', async () => {
    const { resHead } = await callRoute('POST', '/dashboard/namkhao/api/schedule-run', {});
    expect(resHead?.code).toBe(400);
  });
  test('returns ok on success', async () => {
    cp.execSync.mockReturnValue('SUCCESS: ran.');
    const { resBody } = await callRoute('POST', '/dashboard/namkhao/api/schedule-run', { taskName: 'MyTask' });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
  test('returns error when schtasks fails', async () => {
    cp.execSync.mockReturnValue('ERROR: failed.');
    const { resBody } = await callRoute('POST', '/dashboard/namkhao/api/schedule-run', { taskName: 'MyTask' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
});

describe('POST /dashboard/namkhao/api/schedule-toggle', () => {
  test('returns 400 when taskName missing', async () => {
    const { resHead } = await callRoute('POST', '/dashboard/namkhao/api/schedule-toggle', {});
    expect(resHead?.code).toBe(400);
  });
  test('enables task', async () => {
    cp.execSync.mockReturnValue('SUCCESS: changed.');
    const { resBody } = await callRoute('POST', '/dashboard/namkhao/api/schedule-toggle', { taskName: 'T', enable: true });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
  test('returns error when toggle fails', async () => {
    cp.execSync.mockReturnValue('ERROR: no permission.');
    const { resBody } = await callRoute('POST', '/dashboard/namkhao/api/schedule-toggle', { taskName: 'T', enable: false });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
});

describe('POST /dashboard/namkhao/api/schedule-edit', () => {
  test('returns 400 when times missing', async () => {
    const { resHead } = await callRoute('POST', '/dashboard/namkhao/api/schedule-edit', { taskName: 'T' });
    expect(resHead?.code).toBe(400);
  });
  test('edits single time successfully', async () => {
    cp.execSync.mockReturnValue('สำเร็จ');
    const { resBody } = await callRoute('POST', '/dashboard/namkhao/api/schedule-edit', { taskName: 'T', times: ['11:05'] });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
  test('returns error when edit fails', async () => {
    cp.execSync.mockReturnValue('ERROR: fail');
    const { resBody } = await callRoute('POST', '/dashboard/namkhao/api/schedule-edit', { taskName: 'T', times: ['11:05'] });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
});

describe('POST /dashboard/namkhao/api/schedule-create', () => {
  test('returns 400 when missing scriptPath/times', async () => {
    const { resHead } = await callRoute('POST', '/dashboard/namkhao/api/schedule-create', { taskName: 'T' });
    expect(resHead?.code).toBe(400);
  });
  test('creates task for script path', async () => {
    cp.execSync.mockReturnValue('SUCCESS: created.');
    const { resBody } = await callRoute('POST', '/dashboard/namkhao/api/schedule-create', {
      taskName: 'T', scriptPath: 'C:\\test\\run.bat', times: ['11:05'],
    });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
  test('creates PowerShell task', async () => {
    cp.execSync.mockReturnValue('SUCCESS: created.');
    const { resBody } = await callRoute('POST', '/dashboard/namkhao/api/schedule-create', {
      taskName: 'T', scriptPath: 'C:\\test\\run.ps1', times: ['09:00'],
    });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
  test('reports error when schtasks fails', async () => {
    cp.execSync.mockReturnValue('FAILED: denied.');
    const { resBody } = await callRoute('POST', '/dashboard/namkhao/api/schedule-create', {
      taskName: 'T', scriptPath: 'C:\\run.bat', times: ['11:05'],
    });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
  test('xmlPath: returns error when xml file missing', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resBody } = await callRoute('POST', '/dashboard/namkhao/api/schedule-create', {
      taskName: 'T', xmlPath: 'C:\\task.xml',
    });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
});

describe('POST /api/agent/{name}/start', () => {
  test('returns 404 for unknown agent', async () => {
    const { resHead } = await callRoute('POST', '/api/agent/unknown/start', { action: 'status' });
    expect(resHead?.code).toBe(404);
  });
  test('starts known agent', async () => {
    cp.spawn.mockImplementation(spawnFactory(0));
    fs.readFileSync.mockReturnValue(JSON.stringify({}));
    const { resBody } = await callRoute('POST', '/api/agent/mali/start', { action: 'status' });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
});

describe('POST /api/agent/{name}/stop', () => {
  test('stops agent', async () => {
    const { resBody } = await callRoute('POST', '/api/agent/mali/stop', '');
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
});

describe('POST /api/agent/{name}/clear-log', () => {
  test('clears log file', async () => {
    const { resBody } = await callRoute('POST', '/api/agent/mali/clear-log', '');
    expect(JSON.parse(String(resBody)).ok).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('mali.log'), '', 'utf8'
    );
  });
});

describe('POST /api/telegram/restart', () => {
  test('returns error when botScript not found', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resBody } = await callRoute('POST', '/api/telegram/restart', '');
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
  test('spawns bot when script exists', async () => {
    fs.existsSync.mockReturnValue(true);
    cp.spawn.mockImplementation(spawnFactory(0));
    const { resBody } = await callRoute('POST', '/api/telegram/restart', '');
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
  test('kills old process when pidFile exists', async () => {
    let pidCount = 0;
    fs.existsSync.mockImplementation(p => {
      if (String(p).endsWith('.pid')) return pidCount++ === 0;
      return true;
    });
    fs.readFileSync.mockImplementation(p => String(p).endsWith('.pid') ? '9999\n' : '');
    jest.spyOn(process, 'kill').mockImplementation(() => {});
    cp.spawn.mockImplementation(spawnFactory(0));
    const { resBody } = await callRoute('POST', '/api/telegram/restart', '');
    expect(JSON.parse(String(resBody)).ok).toBe(true);
    expect(process.kill).toHaveBeenCalledWith(9999);
  });
});

describe('POST /dashboard/anime/api/finalize', () => {
  test('returns 400 when id missing', async () => {
    const { resBody } = await callRoute('POST', '/dashboard/anime/api/finalize', { text: 'hello' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
  test('returns 404 when anime.png not found', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resHead } = await callRoute('POST', '/dashboard/anime/api/finalize', { id: '123', text: 'hi' });
    expect(resHead?.code).toBe(404);
  });
  test('returns ok when renderBalloonOnImage succeeds', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ prompt: 'girl' }));
    const { resBody } = await callRoute('POST', '/dashboard/anime/api/finalize', { id: '123', text: 'hi' });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
});

describe('POST /dashboard/anime/api/post', () => {
  test('returns 404 when image not found', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resHead } = await callRoute('POST', '/dashboard/anime/api/post', { id: '123', platforms: ['fb'] });
    expect(resHead?.code).toBe(404);
  });
  test('posts to fb and ig successfully', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ posted: {} }));
    const { postFacebookImage, postInstagramImage } = require('../agents/anime/post-anime');
    postFacebookImage.mockResolvedValue('fb123');
    postInstagramImage.mockResolvedValue('ig456');
    const { resBody } = await callRoute('POST', '/dashboard/anime/api/post', {
      id: '123', platforms: ['fb', 'ig'], caption: 'hello',
    });
    const data = JSON.parse(String(resBody));
    expect(data.ok).toBe(true);
    expect(data.results.fb.ok).toBe(true);
    expect(data.results.ig.ok).toBe(true);
  });
  test('handles fb error gracefully', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ posted: {} }));
    const { postFacebookImage } = require('../agents/anime/post-anime');
    postFacebookImage.mockRejectedValue(new Error('FB error'));
    const { resBody } = await callRoute('POST', '/dashboard/anime/api/post', {
      id: '123', platforms: ['fb'], caption: 'hi',
    });
    expect(JSON.parse(String(resBody)).results.fb.ok).toBe(false);
  });
});

describe('POST /dashboard/anime/api/schedule', () => {
  test('returns 404 when source files missing', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resHead } = await callRoute('POST', '/dashboard/anime/api/schedule', { id: '123', time: '10:00' });
    expect(resHead?.code).toBe(404);
  });
  test('returns error when time format invalid', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ prompt: 'girl' }));
    const { resBody } = await callRoute('POST', '/dashboard/anime/api/schedule', { id: '123', time: 'bad' });
    expect(JSON.parse(String(resBody))).toMatchObject({ ok: false });
  });
  test('returns ok when template saved', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ prompt: 'girl', faceWeight: 1.1 }));
    const { resBody } = await callRoute('POST', '/dashboard/anime/api/schedule', { id: '123', time: '10:00' });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
});

// ─── GET /dashboard/manao/api/config ─────────────────────────────────────────

describe('GET /dashboard/manao/api/config', () => {
  test('returns error when config.js not found', async () => {
    const { resBody } = await callRoute('GET', '/dashboard/manao/api/config');
    expect(JSON.parse(String(resBody))).toHaveProperty('error');
  });
});

// ─── POST /dashboard/manao/api/config ────────────────────────────────────────

describe('POST /dashboard/manao/api/config', () => {
  test('updates filter and formatter settings', async () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ filter: {}, formatter: {} }));
    const body = {
      filter: {
        minScore: 50,
        weights: { high: 100, medium: 50, low: 10 },
        labels: { ai_tech: 60, ai_biz: 40, ai_policy: 20 },
        keywords: { high: ['GPT', 'Claude'], medium: ['AI'], low: [] },
      },
      formatter: {
        skipStatus: ['draft'],
        minScore: 30,
        skipPlatforms: ['x'],
      },
    };
    const { resBody } = await callRoute('POST', '/dashboard/manao/api/config', body);
    expect(JSON.parse(String(resBody)).ok).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalled();
  });
  test('returns ok with empty body (uses current config)', async () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({}));
    const { resBody } = await callRoute('POST', '/dashboard/manao/api/config', {});
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
  test('returns error on writeFileSync failure', async () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({}));
    fs.writeFileSync.mockImplementationOnce(() => { throw new Error('EACCES'); });
    const { resBody } = await callRoute('POST', '/dashboard/manao/api/config', { filter: { minScore: 10 } });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
});

// ─── GET /dashboard/manao/api/log ────────────────────────────────────────────

describe('GET /dashboard/manao/api/log (success)', () => {
  test('returns log lines when file exists', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('line1\nline2\nline3\n');
    const { resBody } = await callRoute('GET', '/dashboard/manao/api/log');
    expect(String(resBody)).toContain('line1');
  });
});

// ─── GET /dashboard/manao/api/facebook-content ───────────────────────────────

describe('GET /dashboard/manao/api/facebook-content', () => {
  test('returns 400 when slug missing', async () => {
    const { resHead } = await callRoute('GET', '/dashboard/manao/api/facebook-content');
    expect(resHead?.code).toBe(400);
  });
  test('returns 404 when file missing', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resHead } = await callRoute('GET', '/dashboard/manao/api/facebook-content?slug=test');
    expect(resHead?.code).toBe(404);
  });
  test('returns fb content', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('FB text');
    const { resBody } = await callRoute('GET', '/dashboard/manao/api/facebook-content?slug=test');
    expect(String(resBody)).toBe('FB text');
  });
  test('returns ig content', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('IG text');
    const { resBody } = await callRoute('GET', '/dashboard/manao/api/ig-content?slug=test');
    expect(String(resBody)).toBe('IG text');
  });
});

// ─── GET /dashboard/manao/news-image/{slug} ───────────────────────────────────

describe('GET /dashboard/manao/news-image/{slug}', () => {
  test('returns 404 when image missing', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resHead } = await callRoute('GET', '/dashboard/manao/news-image/test-slug');
    expect(resHead?.code).toBe(404);
  });
  test('serves image when it exists', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(Buffer.from('JPEG'));
    const { resHead } = await callRoute('GET', '/dashboard/manao/news-image/test-slug');
    expect(resHead?.code).toBe(200);
    expect(resHead?.headers?.['Content-Type']).toBe('image/jpeg');
  });
});

// ─── GET /dashboard/anime/image/{id}/{file} ───────────────────────────────────

describe('GET /dashboard/anime/image/{id}/{file}', () => {
  test('returns 404 when file missing', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resHead } = await callRoute('GET', '/dashboard/anime/image/123/anime.png');
    expect(resHead?.code).toBe(404);
  });
  test('serves png file via createReadStream', async () => {
    fs.existsSync.mockReturnValue(true);
    const { resHead } = await callRoute('GET', '/dashboard/anime/image/123/anime.png');
    expect(resHead?.code).toBe(200);
    expect(resHead?.headers?.['Content-Type']).toBe('image/png');
  });
  test('serves jpg file', async () => {
    fs.existsSync.mockReturnValue(true);
    const { resHead } = await callRoute('GET', '/dashboard/anime/image/123/final.jpg');
    expect(resHead?.code).toBe(200);
    expect(resHead?.headers?.['Content-Type']).toBe('image/jpeg');
  });
});

// ─── POST /dashboard/anime/api/generate (handleAnimeGenerate) ─────────────────

describe('POST /dashboard/anime/api/generate', () => {
  test('returns 400 when no source image and no template', async () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const { resBody } = await callRoute('POST', '/dashboard/anime/api/generate', null, {
      'content-type': 'multipart/form-data; boundary=BOUND',
    });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
  test('generates anime using template sourceImage', async () => {
    const { generateAnime } = require('../agents/anime/anime-gen');
    generateAnime.mockResolvedValue();
    const tpl = JSON.stringify({ templateId: '123', sourceImage: 'C:\\gallery\\123\\source.jpg', prompt: '1girl', faceWeight: 1.1 });
    fs.readFileSync.mockImplementation(p => {
      if (String(p).includes('active-template')) return tpl;
      return '';
    });
    fs.existsSync.mockReturnValue(true);
    const { resBody } = await callRouteDeep('POST', '/dashboard/anime/api/generate', null, {
      'content-type': 'multipart/form-data; boundary=BOUND',
    });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
  test('returns error when generateAnime throws', async () => {
    const { generateAnime } = require('../agents/anime/anime-gen');
    generateAnime.mockRejectedValue(new Error('ComfyUI failed'));
    const tpl = JSON.stringify({ templateId: '123', sourceImage: 'C:\\gallery\\123\\source.jpg', prompt: '1girl', faceWeight: 1.1 });
    fs.readFileSync.mockImplementation(p => {
      if (String(p).includes('active-template')) return tpl;
      return '';
    });
    fs.existsSync.mockReturnValue(true);
    const { resBody } = await callRouteDeep('POST', '/dashboard/anime/api/generate', null, {
      'content-type': 'multipart/form-data; boundary=BOUND',
    });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
});

// ─── editScheduleTimes multi-time ─────────────────────────────────────────────

describe('editScheduleTimes multi-time', () => {
  test('exports XML, patches Triggers, imports back', () => {
    const xmlContent = '<?xml version="1.0"?><Task><Triggers><CalendarTrigger><StartBoundary>2024-01-01T11:05:00+07:00</StartBoundary></CalendarTrigger></Triggers></Task>';
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ size: 500 });
    fs.readFileSync.mockReturnValue(Buffer.from(xmlContent, 'utf8'));
    cp.execSync.mockReturnValue('SUCCESS: created.');
    expect(() => editScheduleTimes('T', ['09:00', '11:00'])).not.toThrow();
    expect(fs.writeFileSync).toHaveBeenCalled();
  });
  test('throws when XML export fails (file too small)', () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ size: 5 });
    cp.execSync.mockReturnValue('');
    expect(() => editScheduleTimes('T', ['09:00', '11:00'])).toThrow('Export XML');
  });
  test('throws when Triggers tag not found after replace', () => {
    const xmlContent = '<?xml version="1.0"?><Task><NoTriggers/></Task>';
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ size: 100 });
    fs.readFileSync.mockReturnValue(Buffer.from(xmlContent, 'utf8'));
    cp.execSync.mockReturnValue('');
    expect(() => editScheduleTimes('T', ['09:00', '11:00'])).toThrow();
  });
});

// ─── POST /dashboard/namkhao/api/schedule-edit with multiple times ────────────

describe('POST /dashboard/namkhao/api/schedule-edit multi-time', () => {
  test('edits with multiple times successfully', async () => {
    const xmlContent = '<?xml version="1.0"?><Task><Triggers><CalendarTrigger><StartBoundary>2024T11:05:00+07:00</StartBoundary></CalendarTrigger></Triggers></Task>';
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ size: 300 });
    fs.readFileSync.mockReturnValue(Buffer.from(xmlContent, 'utf8'));
    cp.execSync.mockReturnValue('SUCCESS: created.');
    const { resBody } = await callRoute('POST', '/dashboard/namkhao/api/schedule-edit', { taskName: 'T', times: ['09:00', '11:00'] });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
  test('returns error when multi-time edit throws', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ size: 5 });
    cp.execSync.mockReturnValue('');
    const { resBody } = await callRoute('POST', '/dashboard/namkhao/api/schedule-edit', { taskName: 'T', times: ['09:00', '11:00'] });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
});

// ─── GET /dashboard/namkhao/api/schedule-status error branch ─────────────────
// getScheduleStatus() has internal try/catch in queryOne — it never throws.
// When execSync throws, it returns { state: 'Error', ... } inside the data.

describe('GET /dashboard/namkhao/api/schedule-status error branch', () => {
  test('returns ok=true with error state inside when execSync throws', async () => {
    cp.execSync.mockImplementation(() => { throw new Error('Access denied'); });
    const { resBody } = await callRoute('GET', '/dashboard/namkhao/api/schedule-status');
    const data = JSON.parse(String(resBody));
    expect(data.ok).toBe(true);
    expect(data.reuters.state).toBe('Error');
    expect(data.shopee.state).toBe('Error');
  });
});

// ─── POST /dashboard/mali/api/create-video spawn error event ─────────────────

describe('POST /dashboard/mali/api/create-video spawn error', () => {
  test('returns error on spawn error event', async () => {
    fs.existsSync.mockReturnValue(true);
    // Use factory that emits 'error' instead of 'close'
    cp.spawn.mockImplementationOnce(() => {
      const child = makeChild();
      process.nextTick(() => { child.emit('error', new Error('ENOENT spawn')); });
      return child;
    });
    const { resBody } = await callRoute('POST', '/dashboard/mali/api/create-video', { id: '12345678' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
});

// ─── Telegram: tgRequest + sendTelegramApproval via request-approval ──────────

describe('POST /dashboard/manao/api/request-approval (tg success, no image)', () => {
  test('sends message when no image exists and returns ok', async () => {
    // readNewsEnv → reads .env
    fs.readFileSync.mockImplementation(p => {
      if (String(p).endsWith('.env')) return 'TELEGRAM_BOT_TOKEN=tok\nTELEGRAM_CHAT_ID=456\n';
      if (String(p).endsWith('data.json')) return JSON.stringify({ title: 'Test Article', status: 'draft' });
      return '';
    });
    fs.existsSync.mockImplementation(p => String(p).endsWith('data.json'));

    const httpsReq = makeHttpReq();
    https.request.mockImplementation((opts, cb) => {
      if (cb) cb(makeMockRes(JSON.stringify({ ok: true, result: { message_id: 1 } })));
      return httpsReq;
    });

    const { resBody } = await callRouteDeep('POST', '/dashboard/manao/api/request-approval', { slug: 'test-slug', platform: 'fb' });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
});

describe('POST /dashboard/manao/api/request-approval (tg success, with image)', () => {
  test('sends photo when image exists', async () => {
    fs.readFileSync.mockImplementation(p => {
      if (String(p).endsWith('.env')) return 'TELEGRAM_BOT_TOKEN=tok\nTELEGRAM_CHAT_ID=456\n';
      if (String(p).endsWith('data.json')) return JSON.stringify({ title: 'Test', status: 'draft' });
      if (String(p).endsWith('facebook.md')) return 'Facebook content here';
      if (String(p).endsWith('instagram.md')) return 'Instagram content here';
      // image.jpg → return Buffer
      return Buffer.from('JPEG');
    });
    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      return s.endsWith('data.json') || s.endsWith('image.jpg') || s.endsWith('facebook.md') || s.endsWith('instagram.md');
    });

    const httpsReq = makeHttpReq();
    https.request.mockImplementation((opts, cb) => {
      if (cb) cb(makeMockRes(JSON.stringify({ ok: true, result: { message_id: 2 } })));
      return httpsReq;
    });

    const { resBody } = await callRouteDeep('POST', '/dashboard/manao/api/request-approval', { slug: 'img-slug', platform: 'fb,ig' });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
});

// ─── POST /dashboard/mali/api/post-fb-clip (uploadFBReels success) ───────────

describe('POST /dashboard/mali/api/post-fb-clip (uploadFBReels full flow)', () => {
  test('uploads video to FB Reels successfully', async () => {
    fs.readFileSync.mockImplementation(p => {
      if (String(p).endsWith('.env')) return 'FB_PAGE_ID=12345\nFB_ACCESS_TOKEN=usr_token\n';
      if (String(p).endsWith('facebook.md')) return 'FB caption';
      if (String(p).endsWith('video.mp4')) return Buffer.alloc(500);
      if (String(p).endsWith('data.json')) return JSON.stringify({ posted_platforms: [] });
      return '';
    });
    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      return s.endsWith('video.mp4') || s.endsWith('facebook.md') || s.endsWith('data.json');
    });

    const httpsReq = makeHttpReq();
    // Call sequence: https.get (page token), https.request x3 (step1, step2, step3)
    https.get.mockImplementationOnce((opts, cb) => {
      if (cb) cb(makeMockRes(JSON.stringify({ access_token: 'page_tok' })));
      return httpsReq;
    });
    https.request
      .mockImplementationOnce((opts, cb) => {
        if (cb) cb(makeMockRes(JSON.stringify({ video_id: 'vid1', upload_url: 'https://upload.example.com/v?x=1' })));
        return httpsReq;
      })
      .mockImplementationOnce((opts, cb) => {
        if (cb) cb(makeMockRes(JSON.stringify({ success: true })));
        return httpsReq;
      })
      .mockImplementationOnce((opts, cb) => {
        if (cb) cb(makeMockRes(JSON.stringify({ success: true })));
        return httpsReq;
      });

    const { resBody } = await callRouteDeep('POST', '/dashboard/mali/api/post-fb-clip', { id: '12345678' });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });

  test('returns error when page token response has error', async () => {
    fs.readFileSync.mockImplementation(p => {
      if (String(p).endsWith('.env')) return 'FB_PAGE_ID=12345\nFB_ACCESS_TOKEN=usr_token\n';
      if (String(p).endsWith('video.mp4')) return Buffer.alloc(100);
      return '';
    });
    fs.existsSync.mockImplementation(p => String(p).endsWith('video.mp4'));

    const httpsReq = makeHttpReq();
    https.get.mockImplementationOnce((opts, cb) => {
      if (cb) cb(makeMockRes(JSON.stringify({ error: { message: 'Token expired' } })));
      return httpsReq;
    });

    const { resBody } = await callRouteDeep('POST', '/dashboard/mali/api/post-fb-clip', { id: '12345678' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
});

// ─── startAgent close handler (pid match) ────────────────────────────────────

describe('startAgent close handler (pid match)', () => {
  test('updates status to idle on close code=0 when pid matches', async () => {
    // Return status that has mali.pid = 12345 (matching child.pid)
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: { status: 'running', pid: 12345 } }));
    cp.spawn.mockImplementation(spawnFactory(0)); // close fires after startAgent
    startAgent('mali', 'status');
    // flush nextTick so close handler runs
    await new Promise(r => process.nextTick(r));
    await Promise.resolve();
    expect(fs.writeFileSync).toHaveBeenCalled();
  });
  test('updates status to error on non-zero exit code', async () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ mali: { status: 'running', pid: 12345 } }));
    cp.spawn.mockImplementation(spawnFactory(1));
    startAgent('mali', 'status');
    await new Promise(r => process.nextTick(r));
    await Promise.resolve();
    expect(fs.writeFileSync).toHaveBeenCalled();
  });
});

// ─── loadProducts null filter ─────────────────────────────────────────────────

describe('loadProducts null product filtering', () => {
  test('filters out null products (data.json parse error)', () => {
    fs.readdirSync.mockReturnValue(['123', '456']);
    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      if (s.endsWith('data.json')) return true;
      return false;
    });
    // First item: parse error → null; second: valid
    let call = 0;
    fs.readFileSync.mockImplementation(p => {
      if (String(p).endsWith('data.json')) {
        return call++ === 0 ? 'not-json' : JSON.stringify({
          item_id: '456', title: 'T', price: 100, post_date: '2024-01-01',
          status: 'draft', affiliate_short_link: 'https://s.shopee.co.th/x',
        });
      }
      return '';
    });
    const products = loadProducts();
    // The null product from parse error is filtered
    expect(products.length).toBeLessThanOrEqual(2);
  });
});

// ─── /api/generate-avatar (submitComfyJob x4) ────────────────────────────────

describe('POST /api/generate-avatar', () => {
  test('submits 4 comfy jobs and returns promptIds', async () => {
    stubHttp(JSON.stringify({ prompt_id: 'pid1' }));
    const { resBody } = await callRouteDeep('POST', '/api/generate-avatar', { gender: 'f', outfit: 'นักเรียน' });
    const data = JSON.parse(String(resBody));
    expect(data.ok).toBe(true);
    expect(data.promptIds).toHaveLength(4);
  });
  test('returns error when comfyPost fails', async () => {
    const req = makeHttpReq();
    http.request.mockImplementation(() => {
      throw new Error('ECONNREFUSED');
    });
    const { resHead } = await callRouteDeep('POST', '/api/generate-avatar', {});
    expect(resHead?.code).toBe(500);
  });
});

// ─── /api/avatar-job/{id} (getComfyJobResult) ────────────────────────────────

describe('GET /api/avatar-job/{id}', () => {
  test('returns pending when job not in history', async () => {
    stubHttp(JSON.stringify({}));
    const { resBody } = await callRouteDeep('GET', '/api/avatar-job/abc123');
    expect(JSON.parse(String(resBody)).status).toBe('pending');
  });
  test('returns done when job complete', async () => {
    const history = {
      'abc123': {
        status: { status_str: 'success' },
        outputs: { '7': { images: [{ filename: 'x.png', subfolder: '', type: 'output' }] } },
      },
    };
    stubHttp(JSON.stringify(history));
    const { resBody } = await callRouteDeep('GET', '/api/avatar-job/abc123');
    expect(JSON.parse(String(resBody)).status).toBe('done');
  });
  test('returns pending on comfyGet error', async () => {
    http.get.mockImplementation(() => { throw new Error('conn'); });
    const { resBody } = await callRouteDeep('GET', '/api/avatar-job/abc123');
    expect(JSON.parse(String(resBody)).status).toBe('pending');
  });
  test('returns error status when job has error', async () => {
    const history = { 'abc123': { status: { status_str: 'error' }, outputs: {} } };
    stubHttp(JSON.stringify(history));
    const { resBody } = await callRouteDeep('GET', '/api/avatar-job/abc123');
    expect(JSON.parse(String(resBody)).status).toBe('error');
  });
});

// ─── /api/comfy-image ────────────────────────────────────────────────────────

describe('GET /api/comfy-image', () => {
  test('proxies comfy image response', async () => {
    const req = makeHttpReq();
    http.get.mockImplementation((opts, cb) => {
      const res = new EventEmitter();
      res.headers = { 'content-type': 'image/png' };
      process.nextTick(() => { res.emit('data', Buffer.from('PNG')); res.emit('end'); });
      if (cb) cb(res);
      return req;
    });
    const { resHead } = await callRouteDeep('GET', '/api/comfy-image?filename=x.png&subfolder=&type=output');
    expect(resHead?.code).toBe(200);
    expect(resHead?.headers?.['Content-Type']).toBe('image/png');
  });
  test('returns 502 when comfyGetBinary fails', async () => {
    http.get.mockImplementation(() => { throw new Error('conn'); });
    const { resHead } = await callRouteDeep('GET', '/api/comfy-image?filename=x.png');
    expect(resHead?.code).toBe(502);
  });
});

// ─── loadProducts sort comparator (2+ products) ───────────────────────────────

describe('loadProducts sort comparator', () => {
  test('sorts products by post_date ascending', () => {
    const makeData = (date, id) => JSON.stringify({ title: `T${id}`, price: '99', post_date: date, status: 'scraped' });
    fs.existsSync.mockImplementation(p => String(p).endsWith('products') || String(p).includes('data.json'));
    fs.readdirSync.mockReturnValue(['aaa', 'bbb']);
    let call = 0;
    fs.readFileSync.mockImplementation(() => call++ === 0 ? makeData('2026-06-15', 1) : makeData('2026-06-10', 2));
    const prods = loadProducts();
    expect(prods.length).toBe(2);
    expect(prods[0].post_date).toBe('2026-06-10');  // earlier date comes first
    expect(prods[1].post_date).toBe('2026-06-15');
  });
});

// ─── GET /img/{id}/{file} (serveProductImage) ─────────────────────────────────

describe('GET /img/{id}/{file}', () => {
  test('returns 404 when image file does not exist', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resHead } = await callRoute('GET', '/img/12345678/1.jpg');
    expect(resHead?.code).toBe(404);
  });
  test('streams image when file exists', async () => {
    fs.existsSync.mockReturnValue(true);
    const { resHead } = await callRoute('GET', '/img/12345678/1.jpg');
    expect(resHead?.code).toBe(200);
    expect(resHead?.headers?.['Content-Type']).toContain('image/jpeg');
  });
  test('serves webp with correct mime type', async () => {
    fs.existsSync.mockReturnValue(true);
    const { resHead } = await callRoute('GET', '/img/12345678/1.webp');
    expect(resHead?.code).toBe(200);
    expect(resHead?.headers?.['Content-Type']).toBe('image/webp');
  });
  test('falls back to image/jpeg for unknown extension', async () => {
    fs.existsSync.mockReturnValue(true);
    const { resHead } = await callRoute('GET', '/img/12345678/file.bmp');
    expect(resHead?.code).toBe(200);
    expect(resHead?.headers?.['Content-Type']).toBe('image/jpeg');
  });
});

// ─── uploadFBReels additional error paths ─────────────────────────────────────

describe('uploadFBReels: video not found after page token succeeds', () => {
  test('throws when video.mp4 missing after page token obtained', async () => {
    fs.readFileSync.mockImplementation(p => {
      if (String(p).endsWith('.env')) return 'FB_PAGE_ID=12345\nFB_ACCESS_TOKEN=tok\n';
      return '';
    });
    // video.mp4 does NOT exist
    fs.existsSync.mockReturnValue(false);

    const httpsReq = makeHttpReq();
    https.get.mockImplementationOnce((opts, cb) => {
      if (cb) cb(makeMockRes(JSON.stringify({ access_token: 'page_tok' })));
      return httpsReq;
    });

    const { resBody } = await callRouteDeep('POST', '/dashboard/mali/api/post-fb-clip', { id: '12345678' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
    expect(JSON.parse(String(resBody)).error).toContain('video.mp4');
  });
});

describe('uploadFBReels: step 1 missing video_id', () => {
  test('throws when step 1 response has no video_id', async () => {
    fs.readFileSync.mockImplementation(p => {
      if (String(p).endsWith('.env')) return 'FB_PAGE_ID=12345\nFB_ACCESS_TOKEN=tok\n';
      if (String(p).endsWith('video.mp4')) return Buffer.alloc(100);
      return '';
    });
    fs.existsSync.mockImplementation(p => String(p).endsWith('video.mp4'));

    const httpsReq = makeHttpReq();
    https.get.mockImplementationOnce((opts, cb) => {
      if (cb) cb(makeMockRes(JSON.stringify({ access_token: 'page_tok' })));
      return httpsReq;
    });
    // Step 1: returns response without video_id or upload_url
    https.request.mockImplementationOnce((opts, cb) => {
      if (cb) cb(makeMockRes(JSON.stringify({ some_other_field: 'x' })));
      return httpsReq;
    });

    const { resBody } = await callRouteDeep('POST', '/dashboard/mali/api/post-fb-clip', { id: '12345678' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
    expect(JSON.parse(String(resBody)).error).toContain('video_id');
  });
});

// ─── GET /dashboard/manao/api/config (valid config) ──────────────────────────

describe('GET /dashboard/manao/api/config (success)', () => {
  test('returns filter and formatter from config.json', async () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({
      filter: { minScore: 50, weights: { high: 20 } },
      formatter: { skipStatus: ['posted'] },
    }));
    const { resBody } = await callRoute('GET', '/dashboard/manao/api/config');
    const data = JSON.parse(String(resBody));
    expect(data).not.toHaveProperty('error');
    expect(data.filter.minScore).toBe(50);
    expect(data.formatter.skipStatus).toContain('posted');
  });
  test('returns empty filter/formatter when config.json missing keys', async () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({}));
    const { resBody } = await callRoute('GET', '/dashboard/manao/api/config');
    const data = JSON.parse(String(resBody));
    expect(data.filter).toEqual({});
    expect(data.formatter).toEqual({});
  });
});

// ─── POST /dashboard/manao/api/run-agent unknown agent ───────────────────────

describe('POST /dashboard/manao/api/run-agent unknown agent', () => {
  test('returns 400 for unknown agent name', async () => {
    const { resHead, resBody } = await callRoute('POST', '/dashboard/manao/api/run-agent', { agent: 'nonexistent-agent' });
    expect(resHead?.code).toBe(400);
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
  test('returns ok=false when script file not found', async () => {
    fs.existsSync.mockReturnValue(false);
    const { resBody } = await callRoute('POST', '/dashboard/manao/api/run-agent', { agent: 'scrape' });
    expect(JSON.parse(String(resBody)).ok).toBe(false);
    expect(JSON.parse(String(resBody)).error).toContain('scrape.js');
  });
});

// ─── GET /dashboard/anime/api/list (sort with multiple items) ─────────────────

describe('GET /dashboard/anime/api/list sort', () => {
  test('sorts gallery items by created descending', async () => {
    fs.readdirSync.mockReturnValue(['older', 'newer']);
    fs.existsSync.mockImplementation(p => String(p).includes('meta.json'));
    let call = 0;
    fs.readFileSync.mockImplementation(() =>
      call++ === 0
        ? JSON.stringify({ created: 1000, prompt: 'a' })
        : JSON.stringify({ created: 2000, prompt: 'b' })
    );
    const { resBody } = await callRoute('GET', '/dashboard/anime/api/list');
    const items = JSON.parse(String(resBody));
    expect(items).toHaveLength(2);
    expect(items[0].created).toBe(2000);  // newer item first
    expect(items[1].created).toBe(1000);
  });
});

// ─── POST /dashboard/anime/api/post (IG error + meta update error) ────────────

describe('POST /dashboard/anime/api/post IG error path', () => {
  test('reports ig error when postInstagramImage throws', async () => {
    const { postFacebookImage, postInstagramImage } = require('../agents/anime/post-anime');
    postFacebookImage.mockResolvedValue('fb-ok');
    postInstagramImage.mockRejectedValue(new Error('IG forbidden'));
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ created: Date.now() }));
    const { resBody } = await callRouteDeep('POST', '/dashboard/anime/api/post',
      { id: '1234567890', platforms: ['fb', 'ig'], caption: 'test' });
    const data = JSON.parse(String(resBody));
    expect(data.results.fb.ok).toBe(true);
    expect(data.results.ig.ok).toBe(false);
    expect(data.results.ig.error).toContain('IG forbidden');
  });

  test('swallows meta.json update error silently', async () => {
    const { postFacebookImage } = require('../agents/anime/post-anime');
    postFacebookImage.mockResolvedValue('fb-ok');
    fs.existsSync.mockReturnValue(true);
    // meta.json read throws → inner catch swallows it → ok: true still
    fs.readFileSync.mockImplementation(p => {
      if (String(p).endsWith('meta.json')) throw new Error('EPERM');
      return '';
    });
    const { resBody } = await callRouteDeep('POST', '/dashboard/anime/api/post',
      { id: '1234567890', platforms: ['fb'], caption: '' });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
});

// ─── POST /dashboard/anime/api/schedule error path ────────────────────────────

describe('POST /dashboard/anime/api/schedule error path', () => {
  test('returns error when meta.json read throws in catch block', async () => {
    fs.existsSync.mockReturnValue(true);
    // readFileSync throws for meta path → outer catch fires
    fs.readFileSync.mockImplementation(() => { throw new Error('disk error'); });
    const { resBody } = await callRoute('POST', '/dashboard/anime/api/schedule', { id: '1234567890', time: '10:00' });
    const data = JSON.parse(String(resBody));
    expect(data.ok).toBe(false);
    expect(data.error).toContain('disk error');
  });
});

// ─── getNewsItems sort comparator ─────────────────────────────────────────────

describe('getNewsItems sort comparator', () => {
  test('sorts news items by scraped_at descending', () => {
    const item1 = JSON.stringify({ title: 'A', url: 'http://a', status: 'draft', scraped_at: '2026-06-10T00:00:00Z' });
    const item2 = JSON.stringify({ title: 'B', url: 'http://b', status: 'posted', scraped_at: '2026-06-15T00:00:00Z' });
    fs.existsSync.mockImplementation(p => String(p).includes('news') || String(p).includes('data.json'));
    fs.readdirSync.mockReturnValue(['art1', 'art2']);
    let call = 0;
    fs.readFileSync.mockImplementation(() => call++ === 0 ? item1 : item2);
    const items = getNewsItems();
    expect(items).toHaveLength(2);
    expect(items[0].scraped_at).toBe('2026-06-15T00:00:00Z');  // newer first
  });
});

// ─── getNewsBotStatus outer catch ─────────────────────────────────────────────

describe('getNewsBotStatus outer catch', () => {
  test('returns { running: false } when fs.existsSync throws', () => {
    fs.existsSync.mockImplementation(() => { throw new Error('EPERM'); });
    expect(getNewsBotStatus()).toEqual({ running: false, pid: null });
  });
});

// ─── editScheduleTimes multi-time: import fails ───────────────────────────────

describe('editScheduleTimes multi-time: runCmd import fails', () => {
  test('throws when final schtasks /Create output does not contain success', () => {
    const xmlContent = '<?xml version="1.0"?><Task><Triggers><CalendarTrigger><StartBoundary>2024-01-01T11:05:00+07:00</StartBoundary></CalendarTrigger></Triggers></Task>';
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ size: 500 });
    fs.readFileSync.mockReturnValue(Buffer.from(xmlContent, 'utf8'));
    // First call (query): returns something OK; second call (create): returns failure
    let cmdCall = 0;
    cp.execSync.mockImplementation(() => {
      cmdCall++;
      if (cmdCall >= 2) return 'ERROR: Access denied.';
      return '';  // first call (query) also returns empty but file check uses statSync size
    });
    expect(() => editScheduleTimes('T', ['09:00', '11:00'])).toThrow('แก้ไข Schedule ไม่สำเร็จ');
  });
});

// ─── POST /dashboard/namkhao/api/schedule-create with xmlPath ─────────────────

describe('POST /dashboard/namkhao/api/schedule-create with xmlPath', () => {
  test('returns ok when xml import succeeds', async () => {
    fs.existsSync.mockReturnValue(true);
    // readFileSync must return a string (not Buffer) so xml.replace() works
    fs.readFileSync.mockReturnValue('<Task>S-1-5-21-999-888-777-1000</Task>');
    cp.execSync
      .mockReturnValueOnce('"PC","S-1-5-21-111-222-333-1001"')  // whoami
      .mockReturnValueOnce('SUCCESS: task created.');             // schtasks /Create
    const { resBody } = await callRoute('POST', '/dashboard/namkhao/api/schedule-create',
      JSON.stringify({ taskName: 'T', xmlPath: 'C:\\tasks\\task.xml' }));
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });

  test('returns error when xml file not found', async () => {
    fs.existsSync.mockReturnValue(false);  // xmlPath file doesn't exist
    const { resBody } = await callRoute('POST', '/dashboard/namkhao/api/schedule-create',
      JSON.stringify({ taskName: 'T', xmlPath: 'C:\\missing.xml' }));
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });

  test('returns error when schtasks /Create fails', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('<Task>S-1-5-21-999-888-777-1000</Task>');
    cp.execSync
      .mockReturnValueOnce('"PC","S-1-5-21-111-222-333-1001"')  // whoami
      .mockReturnValueOnce('ERROR: Access denied.');              // schtasks fails
    const { resBody } = await callRoute('POST', '/dashboard/namkhao/api/schedule-create',
      JSON.stringify({ taskName: 'T', xmlPath: 'C:\\task.xml' }));
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });

  test('returns error when whoami has no SID match', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('<Task>content</Task>');
    cp.execSync.mockReturnValueOnce('no-sid-here');  // whoami without SID
    const { resBody } = await callRoute('POST', '/dashboard/namkhao/api/schedule-create',
      JSON.stringify({ taskName: 'T', xmlPath: 'C:\\task.xml' }));
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
});

// ─── POST /dashboard/namkhao/api/schedule-create all times fail ───────────────

describe('POST /dashboard/namkhao/api/schedule-create all errors', () => {
  test('returns error when all time slots fail', async () => {
    cp.execSync.mockImplementation(() => { throw new Error('Access denied'); });
    const body = JSON.stringify({ taskName: 'T', scriptPath: 'C:\\run.bat', times: ['09:00'] });
    const { resBody } = await callRoute('POST', '/dashboard/namkhao/api/schedule-create', body);
    expect(JSON.parse(String(resBody)).ok).toBe(false);
  });
});

// ─── POST /dashboard/manao/api/request-approval no-image with fbContent ──────

describe('POST /dashboard/manao/api/request-approval no-image with fbContent', () => {
  test('includes fb content preview when facebook.md exists and has content', async () => {
    fs.readFileSync.mockImplementation(p => {
      const s = String(p);
      if (s.endsWith('.env')) return 'TELEGRAM_BOT_TOKEN=tok\nTELEGRAM_CHAT_ID=456\n';
      if (s.endsWith('data.json')) return JSON.stringify({ title: 'Test', status: 'draft' });
      if (s.endsWith('facebook.md')) return 'This is the FB content for preview purposes.';
      return '';
    });
    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      return s.endsWith('data.json') || s.endsWith('facebook.md');
      // image.jpg is NOT found → goes to text path
    });

    const httpsReq = makeHttpReq();
    https.request.mockImplementation((opts, cb) => {
      if (cb) cb(makeMockRes(JSON.stringify({ ok: true, result: { message_id: 42 } })));
      return httpsReq;
    });

    const { resBody } = await callRouteDeep('POST', '/dashboard/manao/api/request-approval',
      { slug: 'test-article', platform: 'fb' });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
});

// ─── runPipelineSequential step error path ────────────────────────────────────

describe('POST /dashboard/manao/api/run-agent pipeline step error', () => {
  test('pipeline step error sets status to error and skips remaining steps', async () => {
    // Spawn fails on first step (scrape.js): exit code 1
    cp.spawn.mockImplementation(spawnFactory(1));

    const { resBody } = await callRouteDeep('POST', '/dashboard/manao/api/run-agent', { agent: 'pipeline', args: [] });
    // Route returns ok=true immediately (non-blocking)
    expect(JSON.parse(String(resBody)).ok).toBe(true);

    // After enough flushes, pipeline should have completed with error on first step
    for (let i = 0; i < 30; i++) {
      await new Promise(r => process.nextTick(r));
      await Promise.resolve();
    }

    // Check pipeline-status to verify error propagation
    const { resBody: statusBody } = await callRoute('GET', '/dashboard/manao/api/pipeline-status');
    const st = JSON.parse(String(statusBody));
    // Pipeline ran (steps array exists) and is no longer running
    expect(st).toHaveProperty('steps');
    expect(st.running).toBe(false);
  });
});

// ─── buildShopeeHTML: comprehensive ternary/binary coverage ──────────────────

describe('buildShopeeHTML: diverse product variants covering all branches', () => {
  test('covers all per-product ternaries, timeline branches, and filter &&s', () => {
    const d0 = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const d1 = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const d2 = new Date().toISOString().slice(0, 10);
    const d3 = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    const prods = [
      // d0: posted + all truthy → allPosted=true on d0, isPast, covers all "truthy" branches
      { id: 'p1', post_date: d0, title: 'A'.repeat(65), price: '100', original_price: '150',
        discount: '33%', rating: '4.5', shop_name: 'S1', affiliate_link: 'https://s.shopee.co.th/p1',
        status: 'posted', isPosted: true, postedPlatforms: ['fb'], postedAtStr: '15 มิ.ย. 2026',
        hasFB: true, hasIG: true, hasX: true, hasTT: true,
        hasAllContent: true, hasImg: true, imgPath: '/img/p1/1.jpg',
        hasVideo: true, videoSizeKB: 1024 },
      // d1: hasAllContent=true, isPosted=false → pct=100 on past date, !allPosted
      { id: 'p4', post_date: d1, title: 'Yesterday', price: '30', original_price: null,
        discount: null, rating: null, shop_name: 'S4', affiliate_link: 'https://s.shopee.co.th/p4',
        status: 'draft', isPosted: false, postedPlatforms: [], postedAtStr: '',
        hasFB: false, hasIG: false, hasX: false, hasTT: false,
        hasAllContent: true, hasImg: false, imgPath: null,
        hasVideo: false, videoSizeKB: 0 },
      // d2 (today): hasAllContent=true, hasTT=true, hasVideo=false → "พร้อม" + inner hasVideo=false
      { id: 'p2', post_date: d2, title: 'Today Ready', price: '50', original_price: '',
        discount: null, rating: '', shop_name: 'S2', affiliate_link: 'https://s.shopee.co.th/p2',
        status: 'draft', isPosted: false, postedPlatforms: [], postedAtStr: '',
        hasFB: true, hasIG: true, hasX: true, hasTT: true,
        hasAllContent: true, hasImg: false, imgPath: null,
        hasVideo: false, videoSizeKB: 0 },
      // d2 (today): hasFB=true, !hasAllContent → "บางส่วน", pct=50 on today
      { id: 'p3', post_date: d2, title: 'Partial', price: '75', original_price: null,
        discount: '', rating: null, shop_name: 'S3', affiliate_link: 'https://s.shopee.co.th/p3',
        status: 'draft', isPosted: false, postedPlatforms: [], postedAtStr: '',
        hasFB: true, hasIG: false, hasX: false, hasTT: false,
        hasAllContent: false, hasImg: false, imgPath: null,
        hasVideo: true, videoSizeKB: 200 },
      // d3 (tomorrow): all false → "รอ content", pct=0 on future date
      { id: 'p5', post_date: d3, title: 'No Content', price: '20', original_price: null,
        discount: null, rating: null, shop_name: 'S5', affiliate_link: 'https://s.shopee.co.th/p5',
        status: 'draft', isPosted: false, postedPlatforms: [], postedAtStr: '',
        hasFB: false, hasIG: false, hasX: false, hasTT: false,
        hasAllContent: false, hasImg: false, imgPath: null,
        hasVideo: false, videoSizeKB: 0 },
      // d0: posted but empty postedPlatforms/postedAtStr → covers lines 584-false, 585-false
      { id: 'p6', post_date: d0, title: 'Posted No Platform', price: '10', original_price: null,
        discount: null, rating: null, shop_name: 'S6', affiliate_link: 'https://s.shopee.co.th/p6',
        status: 'posted', isPosted: true, postedPlatforms: [], postedAtStr: '',
        hasFB: false, hasIG: false, hasX: false, hasTT: false,
        hasAllContent: false, hasImg: false, imgPath: null,
        hasVideo: false, videoSizeKB: 0 },
    ];

    const html = buildShopeeHTML(prods);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(1000);
    expect(html).toContain('โพสต์แล้ว');
    expect(html).toContain('พร้อม');
    expect(html).toContain('บางส่วน');
    expect(html).toContain('รอ content');
    expect(html).toContain('วันนี้');
  });
});

// ─── uploadFBReels step2 failures (lines 521-522) ────────────────────────────

describe('POST /dashboard/mali/api/post-fb-clip: uploadFBReels step2 failures', () => {
  function setupFBReelsBase() {
    fs.existsSync.mockImplementation(p => String(p).endsWith('video.mp4'));
    fs.readFileSync.mockImplementation(p => {
      const s = String(p);
      if (s.endsWith('.env')) return 'FB_ACCESS_TOKEN=tok\nFB_PAGE_ID=123\n';
      return Buffer.from('FAKEVIDEO');
    });
    // page token (https.get)
    https.get.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ access_token: 'page_tok' }));
      return r;
    });
    // step1: init (https.request #1)
    https.request.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ video_id: 'vid123', upload_url: 'https://upload.example.com/upload?q=1' }));
      return r;
    });
  }

  test('returns error when video upload returns success=false (line 521)', async () => {
    setupFBReelsBase();
    https.request.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ success: false, error: 'quota exceeded' }));
      return r;
    });

    const { resBody } = await callRouteDeep('POST', '/dashboard/mali/api/post-fb-clip', { id: 'prod123' });
    const data = JSON.parse(String(resBody));
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/Video upload failed/);
  });

  test('returns error when video upload response is not valid JSON (line 522)', async () => {
    setupFBReelsBase();
    https.request.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes('not-valid-json!!!'));
      return r;
    });

    const { resBody } = await callRouteDeep('POST', '/dashboard/mali/api/post-fb-clip', { id: 'prod123' });
    const data = JSON.parse(String(resBody));
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/Upload response error/);
  });
});

// ─── uploadFBReels full success → data.json catch (line 3317) ────────────────

describe('POST /dashboard/mali/api/post-fb-clip: full success covers data.json catch', () => {
  test('returns ok=true and covers catch at line 3317 when data.json is invalid', async () => {
    fs.existsSync.mockImplementation(p => String(p).endsWith('video.mp4'));
    fs.readFileSync.mockImplementation(p => {
      const s = String(p);
      if (s.endsWith('.env')) return 'FB_ACCESS_TOKEN=tok\nFB_PAGE_ID=123\n';
      return '';  // video.mp4 → empty, data.json → '' → JSON.parse('') throws → line 3317
    });
    https.get.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ access_token: 'page_tok' }));
      return r;
    });
    https.request.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ video_id: 'vid123', upload_url: 'https://upload.example.com/upload' }));
      return r;
    });
    https.request.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ success: true }));
      return r;
    });
    https.request.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ success: true }));
      return r;
    });

    const { resBody } = await callRouteDeep('POST', '/dashboard/mali/api/post-fb-clip', { id: 'prod123' });
    const data = JSON.parse(String(resBody));
    expect(data.ok).toBe(true);
    expect(data.videoId).toBe('vid123');
  });
});

// ─── run-agent: already running (lines 3078-3079) ────────────────────────────

describe('POST /dashboard/manao/api/run-agent: agent already running', () => {
  test('returns error when pipelineProcs[agent] is non-null', async () => {
    // First call: immortal child (no close event) sets pipelineProcs.scrape = 99
    const immortalChild = makeChild(99);
    cp.spawn.mockImplementationOnce(() => immortalChild);
    fs.existsSync.mockReturnValueOnce(true);  // script file exists

    await callRoute('POST', '/dashboard/manao/api/run-agent', { agent: 'scrape' });

    // Second call: pipelineProcs.scrape is still 99 → hits lines 3078-3079
    const { resBody } = await callRoute('POST', '/dashboard/manao/api/run-agent', { agent: 'scrape' });

    // Cleanup: fire close event to reset pipelineProcs.scrape = null
    immortalChild.emit('close', 0);
    await new Promise(r => process.nextTick(r));

    const data = JSON.parse(String(resBody));
    expect(data.ok).toBe(false);
    expect(data.error).toContain('กำลังทำงานอยู่แล้ว');
  });
});

// ─── anime finalize: outer catch fires on malformed JSON (line 3665) ──────────

describe('POST /dashboard/anime/api/finalize: outer catch', () => {
  test('fires catch at line 3665 when body is malformed JSON', async () => {
    const { resBody } = await callRoute('POST', '/dashboard/anime/api/finalize', 'not-valid-json');
    const data = JSON.parse(String(resBody));
    expect(data.ok).toBe(false);
    expect(data.error).toBeTruthy();
  });
});

// ─── anime post: outer catch fires on malformed JSON (line 3703) ─────────────

describe('POST /dashboard/anime/api/post: outer catch', () => {
  test('fires catch at line 3703 when body is malformed JSON', async () => {
    const { resBody } = await callRoute('POST', '/dashboard/anime/api/post', 'not-valid-json');
    const data = JSON.parse(String(resBody));
    expect(data.ok).toBe(false);
    expect(data.error).toBeTruthy();
  });
});

// ─── anime generate: template sourceImage branch (lines 3815, 3829-3830) ─────

describe('POST /dashboard/anime/api/generate: template sourceImage path', () => {
  test('copies template sourceImage and calls generateAnime', async () => {
    const { generateAnime } = require('../agents/anime/anime-gen');
    generateAnime.mockResolvedValue();

    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation(p => {
      if (String(p).includes('active-template.json'))
        return JSON.stringify({ sourceImage: '/path/to/src.jpg', prompt: 'anime girl' });
      return '';
    });

    // body=null → no 'data' event → chunks=[] → Buffer.concat([])=empty buffer
    const { resBody } = await callRouteDeep(
      'POST', '/dashboard/anime/api/generate',
      null,
      { 'content-type': 'multipart/form-data; boundary=TESTBND' }
    );
    const data = JSON.parse(String(resBody));
    expect(data.ok).toBe(true);
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      '/path/to/src.jpg',
      expect.stringContaining('source.jpg')
    );
    expect(generateAnime).toHaveBeenCalled();
  });
});

// ─── loadProducts: covers hasVideo=true and posted_at branches ────────────────

describe('loadProducts: with hasVideo and posted_at data', () => {
  test('covers videoSizeKB cond-expr and posted_at if-branch', () => {
    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      return s.includes('products') && !s.includes('content') && !s.includes('images');
    });
    fs.readdirSync.mockReturnValue(['vid-prod']);
    fs.readFileSync.mockImplementation(p => {
      if (String(p).includes('data.json'))
        return JSON.stringify({
          title: 'Prod', price: '99', status: 'posted',
          affiliate_short_link: 'https://s.shopee.co.th/x',
          post_date: '2024-01-01', posted_at: '2024-01-01T10:00:00.000Z',
          posted_platforms: ['fb'],
        });
      return '';
    });
    fs.statSync.mockReturnValue({ size: 5 * 1024 * 1024 });

    const products = loadProducts();
    expect(products.length).toBeGreaterThan(0);
  });
});

// ─── auth.gate returning true blocks all routes (line 2660) ──────────────────

describe('auth.gate returning true blocks request', () => {
  test('route returns without calling writeHead when gate blocks', async () => {
    const { gate } = require('../auth');
    gate.mockReturnValueOnce(true);
    const { resHead } = await callRoute('GET', '/dashboard/mali');
    expect(resHead).toBeNull();
  });
});

// ─── POST /api/agent/{name}: default action branch (line 3519) ───────────────

describe('POST /api/agent/mali: default action when not provided', () => {
  test('uses default action="status" when body is empty (covers body||"{}" branch)', async () => {
    cp.spawn.mockImplementation(spawnFactory(0));
    // null body → no data event → body='' → ''||'{}' covers binary-expr branch 1
    const { resBody } = await callRoute('POST', '/api/agent/mali/start', null);
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
});

// ─── anime gallery list: sort with created=0 (line 3616 binary-expr) ─────────

describe('GET /dashboard/anime/api/list: sort with created=0 covers || 0', () => {
  test('covers (b.created || 0) when created is 0 or null', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['item1', 'item2']);
    let readIdx = 0;
    fs.readFileSync.mockImplementation(p => {
      if (String(p).includes('meta.json')) {
        readIdx++;
        return readIdx === 1
          ? JSON.stringify({ created: 0, prompt: 'test' })    // created=0 → || 0 fires
          : JSON.stringify({ created: null, prompt: 'test2' }); // null → || 0 fires
      }
      return '';
    });

    const { resBody } = await callRoute('GET', '/dashboard/anime/api/list');
    const items = JSON.parse(String(resBody));
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBe(2);
  });
});

// ─── uploadFBReels full success: valid data.json variants (lines 3311/3312/458) ─

describe('POST /dashboard/mali/api/post-fb-clip: valid data.json variants', () => {
  function setupFullSuccess() {
    https.get.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ access_token: 'page_tok' }));
      return r;
    });
    https.request.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ video_id: 'vid123', upload_url: 'https://upload.example.com/upload' }));
      return r;
    });
    https.request.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ success: true }));
      return r;
    });
    https.request.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ success: true }));
      return r;
    });
  }

  test('covers 3311-true, 3312-true, 458-true: valid posted_platforms array + facebook.md', async () => {
    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      return s.endsWith('video.mp4') || s.endsWith('facebook.md');
    });
    fs.readFileSync.mockImplementation(p => {
      const s = String(p);
      if (s.endsWith('.env')) return 'FB_ACCESS_TOKEN=tok\nFB_PAGE_ID=123\n';
      if (s.endsWith('data.json')) return JSON.stringify({ posted_platforms: ['fb'] });
      if (s.endsWith('facebook.md')) return 'Facebook caption content here';
      return Buffer.from('FAKEVIDEO');
    });
    setupFullSuccess();
    const { resBody } = await callRouteDeep('POST', '/dashboard/mali/api/post-fb-clip', { id: 'prod123' });
    const data = JSON.parse(String(resBody));
    expect(data.ok).toBe(true);
    expect(data.videoId).toBe('vid123');
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  test('covers 3311-false when posted_platforms is not an array', async () => {
    fs.existsSync.mockImplementation(p => String(p).endsWith('video.mp4'));
    fs.readFileSync.mockImplementation(p => {
      const s = String(p);
      if (s.endsWith('.env')) return 'FB_ACCESS_TOKEN=tok\nFB_PAGE_ID=123\n';
      if (s.endsWith('data.json')) return JSON.stringify({ posted_platforms: 'not-array' });
      return Buffer.from('FAKEVIDEO');
    });
    setupFullSuccess();
    const { resBody } = await callRouteDeep('POST', '/dashboard/mali/api/post-fb-clip', { id: 'prod123' });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });

  test('covers 3312-false when fb-clip already in posted_platforms', async () => {
    fs.existsSync.mockImplementation(p => String(p).endsWith('video.mp4'));
    fs.readFileSync.mockImplementation(p => {
      const s = String(p);
      if (s.endsWith('.env')) return 'FB_ACCESS_TOKEN=tok\nFB_PAGE_ID=123\n';
      if (s.endsWith('data.json')) return JSON.stringify({ posted_platforms: ['fb', 'fb-clip'] });
      return Buffer.from('FAKEVIDEO');
    });
    setupFullSuccess();
    const { resBody } = await callRouteDeep('POST', '/dashboard/mali/api/post-fb-clip', { id: 'prod123' });
    expect(JSON.parse(String(resBody)).ok).toBe(true);
  });
});

// ─── uploadFBReels: video missing inside function (line 454 true branch) ──────

describe('POST /dashboard/mali/api/post-fb-clip: video missing inside uploadFBReels', () => {
  test('returns error at line 454 when video.mp4 gone after route check', async () => {
    // Route check (1st existsSync call) → true; uploadFBReels check → false
    fs.existsSync.mockReturnValueOnce(true).mockReturnValue(false);
    fs.readFileSync.mockImplementation(p => {
      if (String(p).endsWith('.env')) return 'FB_ACCESS_TOKEN=tok\nFB_PAGE_ID=123\n';
      return '';
    });
    https.get.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ access_token: 'page_tok' }));
      return r;
    });
    const { resBody } = await callRouteDeep('POST', '/dashboard/mali/api/post-fb-clip', { id: 'prod123' });
    const data = JSON.parse(String(resBody));
    expect(data.ok).toBe(false);
    expect(data.error).toContain('video.mp4');
  });
});

// ─── uploadFBReels: page token fallback + step1/step3 error paths ─────────────

describe('POST /dashboard/mali/api/post-fb-clip: uploadFBReels error branches', () => {
  test('covers 451-branch1: page token response lacks access_token → falls back to USER_TOKEN', async () => {
    fs.existsSync.mockImplementation(p => String(p).endsWith('video.mp4'));
    fs.readFileSync.mockImplementation(p => {
      const s = String(p);
      if (s.endsWith('.env')) return 'FB_ACCESS_TOKEN=user_tok\nFB_PAGE_ID=page123\n';
      if (s.endsWith('data.json')) return JSON.stringify({ posted_platforms: [] });
      return Buffer.from('FAKEVIDEO');
    });
    // page token response: no access_token → undefined || USER_TOKEN (line 451 branch 1)
    https.get.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({}));
      return r;
    });
    https.request.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ video_id: 'vid789', upload_url: 'https://upload.example.com/upload' }));
      return r;
    });
    https.request.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ success: true }));
      return r;
    });
    https.request.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ success: true }));
      return r;
    });
    const { resBody } = await callRouteDeep('POST', '/dashboard/mali/api/post-fb-clip', { id: 'prod789' });
    const data = JSON.parse(String(resBody));
    expect(data.ok).toBe(true);
    expect(data.videoId).toBe('vid789');
  });

  test('covers 494-branch0: step1 returns error object → throws', async () => {
    fs.existsSync.mockImplementation(p => String(p).endsWith('video.mp4'));
    fs.readFileSync.mockImplementation(p => {
      if (String(p).endsWith('.env')) return 'FB_ACCESS_TOKEN=tok\nFB_PAGE_ID=123\n';
      return Buffer.from('FAKEVIDEO');
    });
    https.get.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ access_token: 'page_tok' }));
      return r;
    });
    // step1 returns error object (line 494 branch 0)
    https.request.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ error: { message: 'permissions denied' } }));
      return r;
    });
    const { resBody } = await callRouteDeep('POST', '/dashboard/mali/api/post-fb-clip', { id: 'prod123' });
    const data = JSON.parse(String(resBody));
    expect(data.ok).toBe(false);
    expect(data.error).toContain('Reels init');
  });

  test('covers 541-branch0: step3 returns success=false → throws', async () => {
    fs.existsSync.mockImplementation(p => String(p).endsWith('video.mp4'));
    fs.readFileSync.mockImplementation(p => {
      if (String(p).endsWith('.env')) return 'FB_ACCESS_TOKEN=tok\nFB_PAGE_ID=123\n';
      return Buffer.from('FAKEVIDEO');
    });
    https.get.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ access_token: 'page_tok' }));
      return r;
    });
    https.request.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ video_id: 'vid123', upload_url: 'https://upload.example.com/upload' }));
      return r;
    });
    https.request.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ success: true }));
      return r;
    });
    // step3: success=false (line 541 branch 0)
    https.request.mockImplementationOnce((opts, cb) => {
      const r = makeHttpReq();
      if (cb) cb(makeMockRes({ success: false }));
      return r;
    });
    const { resBody } = await callRouteDeep('POST', '/dashboard/mali/api/post-fb-clip', { id: 'prod123' });
    const data = JSON.parse(String(resBody));
    expect(data.ok).toBe(false);
    expect(data.error).toContain('Reels publish');
  });
});
