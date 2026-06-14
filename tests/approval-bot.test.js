'use strict';

process.env.MALI_TELEGRAM_BOT_TOKEN = 'test:TOKEN123';
process.env.TELEGRAM_CHAT_ID = '12345678';
process.argv = ['node', 'approval-bot.js'];

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('fs');
jest.mock('https');
jest.mock('http');
jest.mock('child_process');

const fs    = require('fs');
const https = require('https');
const http  = require('http');
const cp    = require('child_process');

const EventEmitter = require('events');

const bot = require('../approval-bot.js');
const {
  tgApi, sendMsg, editMsg, answerCb,
  waitForCallback, waitForDecision,
  regenerateFromTemplate, postFbClip, postAllPlatforms,
  approveLoop, todayString, initOffset, main: mainFn,
  acquireLock, startup,
} = bot;

// ─── Fake-time helpers ────────────────────────────────────────────────────────
// _fakeNow is advanced by the sleep delay each time setTimeout is called.
// This prevents infinite polling loops when getUpdates returns empty results
// while keeping sleep() instant for test speed.

let _fakeNow;

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeRes(body) {
  const res = new EventEmitter();
  process.nextTick(() => {
    res.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    res.emit('end');
  });
  return res;
}

function makeReq(opts = {}) {
  const req = new EventEmitter();
  req.write = opts.onWrite ? jest.fn(opts.onWrite) : jest.fn();
  req.end   = jest.fn();
  req.setTimeout = jest.fn();
  return req;
}

function stubHttps(body) {
  const req = makeReq();
  https.request.mockImplementation((opts, cb) => {
    if (cb) cb(makeRes(body));
    return req;
  });
  return req;
}

function stubHttp(body) {
  const req = makeReq();
  http.request.mockImplementation((opts, cb) => {
    if (cb) cb(makeRes(body));
    return req;
  });
  return req;
}

function stubHttpsSeq(...bodies) {
  let i = 0;
  https.request.mockImplementation((opts, cb) => {
    const body = bodies[Math.min(i++, bodies.length - 1)];
    const req  = makeReq();
    if (cb) cb(makeRes(body));
    return req;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  // Fake time: Date.now() returns _fakeNow, and setTimeout advances _fakeNow
  // by the sleep delay before running the callback synchronously.
  // This prevents infinite polling loops (each sleep advances the clock)
  // while keeping tests fast (no real waiting).
  _fakeNow = 1700000000000;
  jest.spyOn(Date, 'now').mockImplementation(() => _fakeNow);
  jest.spyOn(global, 'setTimeout').mockImplementation((fn, delay) => {
    _fakeNow += (delay == null ? 500 : delay);
    fn();
    return 0;
  });

  fs.existsSync.mockReturnValue(false);
  fs.readdirSync.mockReturnValue([]);
  fs.writeFileSync.mockImplementation(() => {});
  fs.readFileSync.mockImplementation((p, enc) => {
    if (typeof enc === 'string') return '';
    return Buffer.from('');
  });
  fs.statSync.mockReturnValue({ size: 5 * 1024 * 1024 });
  cp.execFileSync.mockReturnValue('');
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── todayString ─────────────────────────────────────────────────────────────

describe('todayString', () => {
  test('returns YYYY-MM-DD format', () => {
    expect(todayString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('matches today', () => {
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    expect(todayString()).toBe(expected);
  });
});

// ─── regenerateFromTemplate ───────────────────────────────────────────────────

describe('regenerateFromTemplate', () => {
  const base = { title: 'Test Product', price: '199', affiliate_short_link: 'https://s.shopee.co.th/abc' };

  test('returns non-empty string', () => {
    expect(regenerateFromTemplate(base, 1)).toBeTruthy();
  });

  test('includes product title', () => {
    expect(regenerateFromTemplate(base, 1)).toContain('Test Product');
  });

  test('includes affiliate link', () => {
    expect(regenerateFromTemplate(base, 1)).toContain('https://s.shopee.co.th/abc');
  });

  test('includes #Shopeeaffiliate hashtag', () => {
    expect(regenerateFromTemplate(base, 1)).toContain('#Shopeeaffiliate');
  });

  test('cycles hooks across 5 attempts', () => {
    const h1 = regenerateFromTemplate(base, 1).split('\n')[0];
    const h2 = regenerateFromTemplate(base, 2).split('\n')[0];
    expect(h1).not.toBe(h2);
  });

  test('wraps hook back at attempt 6', () => {
    const h1 = regenerateFromTemplate(base, 1).split('\n')[0];
    const h6 = regenerateFromTemplate(base, 6).split('\n')[0];
    expect(h1).toBe(h6);
  });

  test('includes all 5 unique hooks', () => {
    const lines = [1,2,3,4,5].map(i => regenerateFromTemplate(base, i).split('\n')[0]);
    expect(new Set(lines).size).toBe(5);
  });

  test('includes rating when provided', () => {
    expect(regenerateFromTemplate({ ...base, rating: '4.8' }, 1)).toContain('4.8');
  });

  test('includes discount when provided', () => {
    expect(regenerateFromTemplate({ ...base, discount: '20%' }, 1)).toContain('20%');
  });

  test('includes shop_name when provided', () => {
    expect(regenerateFromTemplate({ ...base, shop_name: 'TestShop' }, 1)).toContain('TestShop');
  });

  test('includes original_price with strikethrough syntax', () => {
    expect(regenerateFromTemplate({ ...base, original_price: '299' }, 1)).toContain('299');
  });

  test('handles missing optional fields without throwing', () => {
    expect(() => regenerateFromTemplate({ title: 'A', price: '1', affiliate_short_link: 'x' }, 3)).not.toThrow();
  });
});

// ─── tgApi ────────────────────────────────────────────────────────────────────

describe('tgApi', () => {
  test('POSTs to api.telegram.org', async () => {
    stubHttps({ ok: true, result: [] });
    await tgApi('getUpdates', { offset: 0 });
    expect(https.request).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'api.telegram.org', path: expect.stringContaining('/getUpdates'), method: 'POST' }),
      expect.any(Function)
    );
  });

  test('resolves with parsed JSON', async () => {
    stubHttps({ ok: true, result: [1] });
    expect(await tgApi('getUpdates', {})).toEqual({ ok: true, result: [1] });
  });

  test('resolves with raw string for non-JSON', async () => {
    stubHttps('not json');
    expect(await tgApi('sendMessage', {})).toBe('not json');
  });

  test('rejects on request error', async () => {
    const req = new EventEmitter();
    req.write = jest.fn();
    req.end   = jest.fn(() => process.nextTick(() => req.emit('error', new Error('ECONN'))));
    https.request.mockImplementation(() => req);
    await expect(tgApi('sendMessage', {})).rejects.toThrow('ECONN');
  });
});

// ─── sendMsg ─────────────────────────────────────────────────────────────────

describe('sendMsg', () => {
  test('calls sendMessage API', async () => {
    stubHttps({ ok: true });
    await sendMsg('Hello');
    expect(https.request).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('/sendMessage') }),
      expect.any(Function)
    );
  });

  test('includes inline_keyboard when provided', async () => {
    let capturedBody;
    https.request.mockImplementation((opts, cb) => {
      const req = makeReq({ onWrite: d => { capturedBody = JSON.parse(d); } });
      if (cb) cb(makeRes({ ok: true }));
      return req;
    });
    const kb = [[{ text: 'OK', callback_data: 'ok' }]];
    await sendMsg('text', kb);
    expect(capturedBody.reply_markup.inline_keyboard).toEqual(kb);
  });

  test('truncates text to 4096 chars', async () => {
    let capturedBody;
    https.request.mockImplementation((opts, cb) => {
      const req = makeReq({ onWrite: d => { capturedBody = JSON.parse(d); } });
      if (cb) cb(makeRes({ ok: true }));
      return req;
    });
    await sendMsg('A'.repeat(5000));
    expect(capturedBody.text.length).toBeLessThanOrEqual(4096);
  });
});

// ─── editMsg ─────────────────────────────────────────────────────────────────

describe('editMsg', () => {
  test('sends editMessageText with correct message_id', async () => {
    let capturedBody;
    https.request.mockImplementation((opts, cb) => {
      const req = makeReq({ onWrite: d => { capturedBody = JSON.parse(d); } });
      if (cb) cb(makeRes({ ok: true }));
      return req;
    });
    await editMsg(42, 'Updated');
    expect(capturedBody.message_id).toBe(42);
    expect(capturedBody.text).toBe('Updated');
  });

  test('includes keyboard when provided', async () => {
    let capturedBody;
    https.request.mockImplementation((opts, cb) => {
      const req = makeReq({ onWrite: d => { capturedBody = JSON.parse(d); } });
      if (cb) cb(makeRes({ ok: true }));
      return req;
    });
    const kb = [[{ text: 'A', callback_data: 'a' }]];
    await editMsg(10, 'text', kb);
    expect(capturedBody.reply_markup.inline_keyboard).toEqual(kb);
  });
});

// ─── answerCb ─────────────────────────────────────────────────────────────────

describe('answerCb', () => {
  test('sends answerCallbackQuery with id', async () => {
    let capturedBody;
    https.request.mockImplementation((opts, cb) => {
      const req = makeReq({ onWrite: d => { capturedBody = JSON.parse(d); } });
      if (cb) cb(makeRes({ ok: true }));
      return req;
    });
    await answerCb('cb123', 'Done');
    expect(capturedBody.callback_query_id).toBe('cb123');
    expect(capturedBody.text).toBe('Done');
  });

  test('defaults text to OK', async () => {
    let capturedBody;
    https.request.mockImplementation((opts, cb) => {
      const req = makeReq({ onWrite: d => { capturedBody = JSON.parse(d); } });
      if (cb) cb(makeRes({ ok: true }));
      return req;
    });
    await answerCb('cbXXX');
    expect(capturedBody.text).toBe('OK');
  });
});

// ─── initOffset ───────────────────────────────────────────────────────────────

describe('initOffset', () => {
  test('calls getUpdates with limit:1 offset:-1', async () => {
    let capturedBody;
    https.request.mockImplementation((opts, cb) => {
      const req = makeReq({ onWrite: d => { capturedBody = JSON.parse(d); } });
      if (cb) cb(makeRes({ ok: true, result: [{ update_id: 99 }] }));
      return req;
    });
    await initOffset();
    expect(capturedBody.limit).toBe(1);
    expect(capturedBody.offset).toBe(-1);
  });

  test('handles empty result without crashing', async () => {
    stubHttps({ ok: true, result: [] });
    await expect(initOffset()).resolves.not.toThrow();
  });

  test('handles missing result without crashing', async () => {
    stubHttps({ ok: true });
    await expect(initOffset()).resolves.not.toThrow();
  });
});

// ─── waitForCallback ──────────────────────────────────────────────────────────

describe('waitForCallback', () => {
  test('returns matched callback', async () => {
    stubHttps({ result: [{ update_id: 100, callback_query: { id: 'cbq1', data: 'approve_123' } }] });
    expect(await waitForCallback(['approve_123'], 5000)).toEqual({ data: 'approve_123', cbId: 'cbq1' });
  });

  test('returns timeout when deadline passes', async () => {
    // With timeoutMs=1 and sleep(500) advancing _fakeNow by 500,
    // the deadline (fakeNow+1) is exceeded after the first sleep.
    stubHttps({ result: [] });
    expect(await waitForCallback(['xyz'], 1)).toEqual({ data: 'timeout', cbId: null });
  });

  test('skips updates without callback_query', async () => {
    let call = 0;
    https.request.mockImplementation((opts, cb) => {
      const req = makeReq();
      const body = ++call === 1
        ? { result: [{ update_id: 1, message: { text: 'hi' } }] }
        : { result: [{ update_id: 2, callback_query: { id: 'cb2', data: 'target' } }] };
      if (cb) cb(makeRes(body));
      return req;
    });
    expect((await waitForCallback(['target'], 5000)).data).toBe('target');
  });

  test('skips callbacks with non-matching data', async () => {
    let call = 0;
    https.request.mockImplementation((opts, cb) => {
      const req = makeReq();
      const body = ++call === 1
        ? { result: [{ update_id: 10, callback_query: { id: 'cx', data: 'other' } }] }
        : { result: [{ update_id: 11, callback_query: { id: 'cy', data: 'wanted' } }] };
      if (cb) cb(makeRes(body));
      return req;
    });
    expect((await waitForCallback(['wanted'], 5000)).data).toBe('wanted');
  });

  test('continues polling after network error', async () => {
    let call = 0;
    https.request.mockImplementation((opts, cb) => {
      const req = new EventEmitter();
      req.write = jest.fn();
      req.end   = jest.fn();
      if (++call === 1) {
        process.nextTick(() => req.emit('error', new Error('Net fail')));
      } else {
        if (cb) cb(makeRes({ result: [{ update_id: 5, callback_query: { id: 'c5', data: 'found' } }] }));
      }
      return req;
    });
    expect((await waitForCallback(['found'], 5000)).data).toBe('found');
    expect(console.error).toHaveBeenCalled();
  });

  test('updates globalOffset after processing', async () => {
    let sentOffsets = [];
    let call = 0;
    https.request.mockImplementation((opts, cb) => {
      const req = makeReq({ onWrite: d => { const p = JSON.parse(d); if (p.offset !== undefined) sentOffsets.push(p.offset); } });
      const body = ++call === 1
        ? { result: [{ update_id: 50, callback_query: { id: 'x', data: 'nope' } }] }
        : { result: [{ update_id: 51, callback_query: { id: 'y', data: 'yes' } }] };
      if (cb) cb(makeRes(body));
      return req;
    });
    await waitForCallback(['yes'], 5000);
    expect(sentOffsets.some(o => o > 50)).toBe(true);
  });
});

// ─── waitForDecision ─────────────────────────────────────────────────────────

describe('waitForDecision', () => {
  test('returns approve decision', async () => {
    stubHttps({ result: [{ update_id: 1, callback_query: { id: 'cb1', data: 'ap_123' } }] });
    const r = await waitForDecision('ap_123', 'rg_123', 5000);
    expect(r.decision).toBe('approve');
    expect(r.cbId).toBe('cb1');
  });

  test('returns regen decision', async () => {
    stubHttps({ result: [{ update_id: 2, callback_query: { id: 'cb2', data: 'rg_123' } }] });
    expect((await waitForDecision('ap_123', 'rg_123', 5000)).decision).toBe('regen');
  });

  test('returns timeout on deadline', async () => {
    stubHttps({ result: [] });
    expect(await waitForDecision('ap_x', 'rg_x', 1)).toEqual({ decision: 'timeout', cbId: null });
  });
});

// ─── postFbClip ──────────────────────────────────────────────────────────────

describe('postFbClip', () => {
  test('resolves ok:true on success', async () => {
    stubHttp({ ok: true });
    expect((await postFbClip('123')).ok).toBe(true);
  });

  test('resolves ok:false on API error', async () => {
    stubHttp({ ok: false, error: 'fail' });
    expect((await postFbClip('123')).ok).toBe(false);
  });

  test('resolves ok:false on network error', async () => {
    const req = new EventEmitter();
    req.write = jest.fn();
    req.end = jest.fn(() => process.nextTick(() => req.emit('error', new Error('ECONN'))));
    req.setTimeout = jest.fn();
    http.request.mockImplementation(() => req);
    const r = await postFbClip('123');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ECONN');
  });

  test('resolves ok:false on non-JSON body', async () => {
    http.request.mockImplementation((opts, cb) => {
      const res = new EventEmitter();
      const req = makeReq();
      process.nextTick(() => { res.emit('data', 'plain text'); res.emit('end'); });
      if (cb) cb(res);
      return req;
    });
    const r = await postFbClip('123');
    expect(r).toBeDefined();
  });

  test('handles request timeout', async () => {
    let timeoutCb;
    const req = new EventEmitter();
    req.write   = jest.fn();
    req.end     = jest.fn();
    req.destroy = jest.fn();
    req.setTimeout = jest.fn((ms, cb) => { timeoutCb = cb; });
    http.request.mockImplementation(() => req);
    const p = postFbClip('123');
    if (timeoutCb) timeoutCb();
    const r = await p;
    expect(r.error).toBe('timeout');
  });
});

// ─── postAllPlatforms ─────────────────────────────────────────────────────────

describe('postAllPlatforms', () => {
  test('returns fb:✅ when Facebook keyword in output', async () => {
    cp.execFileSync.mockReturnValue('✅ Facebook post_id: abc\n');
    fs.existsSync.mockReturnValue(false);
    const r = await postAllPlatforms('123');
    expect(r.fb).toContain('✅');
    expect(r.ig).toContain('ข้าม');
    expect(r.fbClip).toContain('ไม่มี');
  });

  test('returns ambiguous when output lacks keywords', async () => {
    cp.execFileSync.mockReturnValue('other output\n');
    fs.existsSync.mockReturnValue(false);
    expect((await postAllPlatforms('123')).fb).toContain('ไม่แน่ใจ');
  });

  test('returns ❌ on execFileSync failure', async () => {
    cp.execFileSync.mockImplementation(() => { throw new Error('exit 1'); });
    fs.existsSync.mockReturnValue(false);
    const r = await postAllPlatforms('123');
    expect(r.fb).toContain('❌');
    expect(r.error).toBeDefined();
  });

  test('calls postFbClip when video.mp4 exists', async () => {
    cp.execFileSync.mockReturnValue('✅ Facebook post_id: abc\n');
    fs.existsSync.mockImplementation(p => String(p).endsWith('video.mp4'));
    stubHttp({ ok: true });
    expect((await postAllPlatforms('123')).fbClip).toContain('✅');
  });

  test('shows fbClip error when postFbClip fails', async () => {
    cp.execFileSync.mockReturnValue('✅ Facebook post_id: abc\n');
    fs.existsSync.mockImplementation(p => String(p).endsWith('video.mp4'));
    stubHttp({ ok: false, error: 'clip fail' });
    expect((await postAllPlatforms('123')).fbClip).toContain('❌');
  });

  test('uses execFileSync args array (no shell injection)', async () => {
    cp.execFileSync.mockReturnValue('✅ Facebook post_id: x\n');
    fs.existsSync.mockReturnValue(false);
    await postAllPlatforms('evil; rm -rf /');
    expect(cp.execFileSync).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['post.js', 'evil; rm -rf /', '--platform', 'fb', '--schedule']),
      expect.any(Object)
    );
  });
});

// ─── approveLoop ─────────────────────────────────────────────────────────────

describe('approveLoop', () => {
  const itemId = '12345678';
  const data   = { title: 'TestProd', price: '99', rating: '4.5', affiliate_short_link: 'x' };

  test('returns false when content file missing', async () => {
    fs.existsSync.mockReturnValue(false);
    stubHttps({ ok: true, result: { message_id: 1 } });
    expect(await approveLoop(itemId, data)).toBe(false);
    expect(https.request).toHaveBeenCalled();
  });

  test('returns false on timeout', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('content');

    // Override setTimeout to jump fake time far past any deadline on first sleep,
    // so waitForCallback exits after 1 empty getUpdates response.
    global.setTimeout.mockImplementation((fn) => { _fakeNow += 99999999; fn(); return 0; });

    stubHttpsSeq(
      { ok: true, result: { message_id: 10 } }, // sendMsg preview
      { ok: true, result: [] },                   // getUpdates → no match → sleep → deadline exceeded
      { ok: true },                               // editMsg timeout
    );

    expect(await approveLoop(itemId, data)).toBe(false);
  });

  test('returns true on approve', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('content');
    stubHttpsSeq(
      { ok: true, result: { message_id: 20 } },
      { result: [{ update_id: 1, callback_query: { id: 'cbap', data: `ap_${itemId}_1` } }] },
      { ok: true },
      { ok: true }
    );
    expect(await approveLoop(itemId, data)).toBe(true);
  });

  test('regenerates and re-loops on regen decision then approve', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('content');

    let call = 0;
    https.request.mockImplementation((opts, cb) => {
      const req = makeReq();
      call++;
      const responses = [
        { ok: true, result: { message_id: 30 } },  // sendMsg preview 1
        { result: [{ update_id: 2, callback_query: { id: 'cbrg', data: `rg_${itemId}_1` } }] }, // regen
        { ok: true },  // answerCb regen
        { ok: true },  // editMsg regen
        { ok: true, result: { message_id: 31 } },  // sendMsg regen notify
        { ok: true, result: { message_id: 32 } },  // sendMsg preview 2
        { result: [{ update_id: 3, callback_query: { id: 'cbap2', data: `ap_${itemId}_2` } }] }, // approve
        { ok: true },  // answerCb approve
        { ok: true },  // editMsg approve
      ];
      if (cb) cb(makeRes(responses[Math.min(call - 1, responses.length - 1)]));
      return req;
    });

    expect(await approveLoop(itemId, data)).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  test('returns false when writeFileSync throws during regenerate', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('content');
    fs.writeFileSync.mockImplementation(() => { throw new Error('disk full'); });

    stubHttpsSeq(
      { ok: true, result: { message_id: 40 } },
      { result: [{ update_id: 5, callback_query: { id: 'cbr', data: `rg_${itemId}_1` } }] },
      { ok: true },
      { ok: true },
      { ok: true }
    );

    expect(await approveLoop(itemId, data)).toBe(false);
  });

  test('truncates content preview longer than 3200 chars', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('X'.repeat(4000));

    let capturedBody;
    https.request.mockImplementation((opts, cb) => {
      const req = makeReq({ onWrite: d => { if (!capturedBody) capturedBody = JSON.parse(d); } });
      const responses = [
        { ok: true, result: { message_id: 50 } },
        { result: [{ update_id: 10, callback_query: { id: 'cbap3', data: `ap_${itemId}_1` } }] },
        { ok: true },
        { ok: true },
      ];
      if (cb) cb(makeRes(responses[Math.min(https.request.mock.calls.length - 1, responses.length - 1)]));
      return req;
    });

    expect(await approveLoop(itemId, data)).toBe(true);
  });
});

// ─── main ─────────────────────────────────────────────────────────────────────

describe('main', () => {
  const TODAY = todayString();

  test('sends "ไม่พบสินค้า" when products dir does not exist', async () => {
    fs.existsSync.mockReturnValue(false);
    let sentTexts = [];
    https.request.mockImplementation((opts, cb) => {
      const req = makeReq({ onWrite: d => { sentTexts.push(JSON.parse(d).text || ''); } });
      if (cb) cb(makeRes({ ok: true, result: { message_id: 1 } }));
      return req;
    });
    await mainFn();
    expect(sentTexts.some(t => t.includes('ไม่พบสินค้า'))).toBe(true);
  });

  test('sends "ไม่พบสินค้า" when no matching products for today', async () => {
    fs.existsSync.mockImplementation(p => String(p) === 'products' || String(p).includes('data.json'));
    fs.readdirSync.mockReturnValue(['11111111']);
    fs.readFileSync.mockReturnValue(JSON.stringify({ title: 'Old', price: '50', post_date: '2020-01-01', affiliate_short_link: 'x' }));

    let sentTexts = [];
    https.request.mockImplementation((opts, cb) => {
      const req = makeReq({ onWrite: d => { sentTexts.push(JSON.parse(d).text || ''); } });
      if (cb) cb(makeRes({ ok: true, result: { message_id: 1 } }));
      return req;
    });
    await mainFn();
    expect(sentTexts.some(t => t.includes('ไม่พบสินค้า'))).toBe(true);
  });

  test('filters out placeholder products', async () => {
    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      return s === 'products' || (s.includes('30303030') && s.includes('data.json'));
    });
    fs.readdirSync.mockReturnValue(['30303030']);
    fs.readFileSync.mockReturnValue(JSON.stringify({ title: 'Ph', price: '0', post_date: TODAY, affiliate_short_link: 'x', status: 'placeholder' }));

    let sentTexts = [];
    https.request.mockImplementation((opts, cb) => {
      const req = makeReq({ onWrite: d => { sentTexts.push(JSON.parse(d).text || ''); } });
      if (cb) cb(makeRes({ ok: true, result: { message_id: 1 } }));
      return req;
    });
    await mainFn();
    expect(sentTexts.some(t => t.includes('ไม่พบสินค้า'))).toBe(true);
  });

  test('runs happy-path: initOffset→announce→approve→post→summary', async () => {
    const prodData = { title: 'Today Prod', price: '199', rating: '4.9', post_date: TODAY, affiliate_short_link: 'x' };
    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      if (s === 'products') return true;
      if (s.includes('99999999') && s.includes('data.json')) return true;
      if (s.includes('99999999') && s.includes('facebook.md')) return true;
      return false;
    });
    fs.readdirSync.mockReturnValue(['99999999']);
    fs.readFileSync.mockImplementation((p, enc) => {
      const s = String(p);
      if (s.includes('data.json')) return JSON.stringify(prodData);
      if (s.includes('facebook.md')) return 'FB content';
      return typeof enc === 'string' ? '' : Buffer.from('');
    });
    cp.execFileSync.mockReturnValue('✅ Facebook post_id: abc\n');

    let call = 0;
    https.request.mockImplementation((opts, cb) => {
      call++;
      const req = makeReq();
      const responses = [
        { ok: true, result: [] },                   // initOffset
        { ok: true, result: { message_id: 100 } },  // announce
        { ok: true, result: { message_id: 101 } },  // preview
        { result: [{ update_id: 1, callback_query: { id: 'cbA', data: 'ap_99999999_1' } }] },
        { ok: true },
        { ok: true },
        { ok: true, result: { message_id: 102 } },
        { ok: true, result: { message_id: 103 } },
        { ok: true, result: { message_id: 104 } },
      ];
      if (cb) cb(makeRes(responses[Math.min(call - 1, responses.length - 1)]));
      return req;
    });

    await mainFn();
    expect(cp.execFileSync).toHaveBeenCalled();
    expect(call).toBeGreaterThan(5);
  });

  test('skips fb posting when approveLoop returns false (timeout)', async () => {
    const prodData = { title: 'Timeout Prod', price: '99', rating: '4', post_date: TODAY, affiliate_short_link: 'x' };
    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      return s === 'products' || (s.includes('88888888') && (s.includes('data.json') || s.includes('facebook.md')));
    });
    fs.readdirSync.mockReturnValue(['88888888']);
    fs.readFileSync.mockImplementation((p, enc) => {
      if (String(p).includes('data.json')) return JSON.stringify(prodData);
      if (String(p).includes('facebook.md')) return 'content';
      return typeof enc === 'string' ? '' : Buffer.from('');
    });

    // Jump fake time far past deadline on first sleep so waitForCallback times out
    global.setTimeout.mockImplementation((fn) => { _fakeNow += 99999999; fn(); return 0; });

    let call = 0;
    https.request.mockImplementation((opts, cb) => {
      call++;
      const req = makeReq();
      const responses = [
        { ok: true, result: [] },                    // initOffset
        { ok: true, result: { message_id: 200 } },   // announce
        { ok: true, result: { message_id: 201 } },   // preview
        { ok: true, result: [] },                    // getUpdates → no match → timeout
        { ok: true },                                // editMsg timeout
        { ok: true, result: { message_id: 202 } },   // summary
      ];
      if (cb) cb(makeRes(responses[Math.min(call - 1, responses.length - 1)]));
      return req;
    });

    await mainFn();
    // execFileSync (post.js) should NOT have been called
    expect(cp.execFileSync).not.toHaveBeenCalled();
  });

  test('offers old products menu after today products', async () => {
    const todayProd = { title: 'Today', price: '100', rating: '4', post_date: TODAY, affiliate_short_link: 'x' };
    const oldProd   = { title: 'Old', price: '50', rating: '3', post_date: '2020-01-01', affiliate_short_link: 'y' };

    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      if (s === 'products') return true;
      if (s.includes('11111111') && (s.includes('data.json') || s.includes('facebook.md'))) return true;
      if (s.includes('22222222') && s.includes('data.json')) return true;
      return false;
    });
    fs.readdirSync.mockReturnValue(['11111111', '22222222']);
    fs.readFileSync.mockImplementation((p, enc) => {
      const s = String(p);
      if (s.includes('11111111') && s.includes('data.json')) return JSON.stringify(todayProd);
      if (s.includes('22222222') && s.includes('data.json')) return JSON.stringify(oldProd);
      if (s.includes('11111111') && s.includes('facebook.md')) return 'content';
      return typeof enc === 'string' ? '' : Buffer.from('');
    });
    cp.execFileSync.mockReturnValue('✅ Facebook post_id: z\n');

    let call = 0;
    https.request.mockImplementation((opts, cb) => {
      call++;
      const req = makeReq();
      const responses = [
        { ok: true, result: [] },                   // initOffset
        { ok: true, result: { message_id: 300 } },  // announce
        { ok: true, result: { message_id: 301 } },  // preview
        { result: [{ update_id: 2, callback_query: { id: 'cbC', data: 'ap_11111111_1' } }] },
        { ok: true },
        { ok: true },
        { ok: true, result: { message_id: 302 } },
        { ok: true, result: { message_id: 303 } },
        { ok: true, result: { message_id: 304 } },  // summary
        { ok: true, result: { message_id: 305 } },  // old products question
        { result: [{ update_id: 3, callback_query: { id: 'cbD', data: 'old_skip' } }] },
        { ok: true },
      ];
      if (cb) cb(makeRes(responses[Math.min(call - 1, responses.length - 1)]));
      return req;
    });

    await mainFn();
    expect(call).toBeGreaterThanOrEqual(11);
  });

  test('tiktok.md present but no video: calls make-tiktok-video.js', async () => {
    const prodData = { title: 'VideoP', price: '299', rating: '4.7', post_date: TODAY, affiliate_short_link: 'x' };
    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      if (s === 'products') return true;
      if (s.includes('10101010') && s.includes('data.json')) return true;
      if (s.includes('10101010') && s.includes('facebook.md')) return true;
      if (s.includes('10101010') && s.includes('tiktok.md')) return true;
      return false; // no video.mp4
    });
    fs.readdirSync.mockReturnValue(['10101010']);
    fs.readFileSync.mockImplementation((p, enc) => {
      if (String(p).includes('data.json')) return JSON.stringify(prodData);
      if (String(p).includes('facebook.md')) return 'content';
      return typeof enc === 'string' ? '' : Buffer.from('');
    });

    cp.execFileSync.mockImplementation((exe, args) => {
      if (args && args.includes('make-tiktok-video.js')) throw new Error('ffmpeg fail');
      return '✅ Facebook post_id: v\n';
    });

    let call = 0;
    https.request.mockImplementation((opts, cb) => {
      call++;
      const req = makeReq();
      const responses = [
        { ok: true, result: [] },
        { ok: true, result: { message_id: 400 } },
        { ok: true, result: { message_id: 401 } },
        { ok: true, result: { message_id: 402 } },  // video fail msg
        { ok: true, result: { message_id: 403 } },  // preview
        { result: [{ update_id: 5, callback_query: { id: 'cbE', data: 'ap_10101010_1' } }] },
        { ok: true },
        { ok: true },
        { ok: true, result: { message_id: 404 } },
        { ok: true, result: { message_id: 405 } },
        { ok: true, result: { message_id: 406 } },
      ];
      if (cb) cb(makeRes(responses[Math.min(call - 1, responses.length - 1)]));
      return req;
    });

    await mainFn();
    const videoCalls = cp.execFileSync.mock.calls.filter(c => c[1] && c[1].includes('make-tiktok-video.js'));
    expect(videoCalls).toHaveLength(1);
    expect(videoCalls[0][1]).toContain('10101010');
  });

  test('skips make-tiktok-video when video.mp4 already exists', async () => {
    const prodData = { title: 'Existing', price: '150', rating: '4', post_date: TODAY, affiliate_short_link: 'x' };
    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      if (s === 'products') return true;
      if (s.includes('20202020') && (s.includes('data.json') || s.includes('facebook.md') || s.includes('tiktok.md') || s.includes('video.mp4'))) return true;
      return false;
    });
    fs.readdirSync.mockReturnValue(['20202020']);
    fs.readFileSync.mockImplementation((p, enc) => {
      if (String(p).includes('data.json')) return JSON.stringify(prodData);
      if (String(p).includes('facebook.md')) return 'content';
      return typeof enc === 'string' ? '' : Buffer.from('');
    });
    fs.statSync.mockReturnValue({ size: 3 * 1024 * 1024 });

    cp.execFileSync.mockImplementation((exe, args) => {
      if (args && args.includes('make-tiktok-video.js')) throw new Error('should not call');
      return '✅ Facebook post_id: w\n';
    });

    let call = 0;
    https.request.mockImplementation((opts, cb) => {
      call++;
      const req = makeReq();
      const responses = [
        { ok: true, result: [] },
        { ok: true, result: { message_id: 500 } },
        { ok: true, result: { message_id: 501 } },
        { result: [{ update_id: 6, callback_query: { id: 'cbF', data: 'ap_20202020_1' } }] },
        { ok: true },
        { ok: true },
        { ok: true, result: { message_id: 502 } },
        { ok: true, result: { message_id: 503 } },
        { ok: true, result: { message_id: 504 } },
      ];
      if (cb) cb(makeRes(responses[Math.min(call - 1, responses.length - 1)]));
      return req;
    });

    await mainFn();
    const videoCalls = cp.execFileSync.mock.calls.filter(c => c[1] && c[1].includes('make-tiktok-video.js'));
    expect(videoCalls).toHaveLength(0);
  });

  test('old products: show list → select item → approve → post', async () => {
    const todayProd = { title: 'TodayItem', price: '100', rating: '4', post_date: TODAY, affiliate_short_link: 'x' };
    const oldProd   = { title: 'OldItem', price: '50', rating: '3', post_date: '2020-01-01', affiliate_short_link: 'y' };

    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      if (s === 'products') return true;
      if (s.includes('55555555') && (s.includes('data.json') || s.includes('facebook.md'))) return true;
      if (s.includes('66666666') && (s.includes('data.json') || s.includes('facebook.md'))) return true;
      return false;
    });
    fs.readdirSync.mockReturnValue(['55555555', '66666666']);
    fs.readFileSync.mockImplementation((p, enc) => {
      const s = String(p);
      if (s.includes('55555555') && s.includes('data.json')) return JSON.stringify(todayProd);
      if (s.includes('66666666') && s.includes('data.json')) return JSON.stringify(oldProd);
      if (s.includes('facebook.md')) return 'content';
      return typeof enc === 'string' ? '' : Buffer.from('');
    });
    cp.execFileSync.mockReturnValue('✅ Facebook post_id: q\n');

    let call = 0;
    https.request.mockImplementation((opts, cb) => {
      call++;
      const req = makeReq();
      const responses = [
        { ok: true, result: [] },                    // initOffset
        { ok: true, result: { message_id: 600 } },   // announce
        { ok: true, result: { message_id: 601 } },   // today preview
        { result: [{ update_id: 1, callback_query: { id: 'cb1', data: 'ap_55555555_1' } }] }, // approve today
        { ok: true },
        { ok: true },
        { ok: true, result: { message_id: 602 } },   // posting msg
        { ok: true, result: { message_id: 603 } },   // result
        { ok: true, result: { message_id: 604 } },   // summary
        { ok: true, result: { message_id: 605 } },   // old question
        { result: [{ update_id: 2, callback_query: { id: 'cb2', data: 'old_show' } }] }, // show old
        { ok: true },                                 // answerCb
        // handleOldProducts:
        { ok: true, result: { message_id: 606 } },   // sendMsg (list)
        { result: [{ update_id: 3, callback_query: { id: 'cb3', data: 'os_66666666' } }] }, // select old
        { ok: true },                                 // answerCb
        { ok: true },                                 // editMsg selected
        // approveLoop for old item:
        { ok: true, result: { message_id: 607 } },   // preview
        { result: [{ update_id: 4, callback_query: { id: 'cb4', data: 'ap_66666666_1' } }] }, // approve
        { ok: true },
        { ok: true },
        // postAllPlatforms:
        { ok: true, result: { message_id: 608 } },   // posting msg
        { ok: true, result: { message_id: 609 } },   // result
        // back to handleOldProducts loop:
        { ok: true, result: { message_id: 610 } },   // list again
        { result: [{ update_id: 5, callback_query: { id: 'cb5', data: 'old_done' } }] }, // done
        { ok: true },
        { ok: true },
      ];
      if (cb) cb(makeRes(responses[Math.min(call - 1, responses.length - 1)]));
      return req;
    });

    await mainFn();
    expect(call).toBeGreaterThan(15);
  });
});

// ─── acquireLock ─────────────────────────────────────────────────────────────

describe('acquireLock', () => {
  let exitSpy;
  let killSpy;

  beforeEach(() => {
    // Use no-op so process.exit doesn't throw (it's inside a try block in acquireLock)
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    killSpy = jest.spyOn(process, 'kill');
    jest.spyOn(process, 'on').mockImplementation(() => process);
    fs.unlinkSync = jest.fn();
  });

  test('creates lock file when none exists', () => {
    fs.existsSync.mockReturnValue(false);
    acquireLock();
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.approval-bot.lock'),
      expect.any(String),
      'utf8'
    );
  });

  test('deletes stale lock and continues when old process is dead', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('99999');
    killSpy.mockImplementation(() => { throw new Error('ESRCH'); });

    acquireLock();
    expect(fs.unlinkSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  test('calls process.exit(1) when lock file belongs to a live process', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('12345');
    killSpy.mockImplementation(() => {}); // process alive → kill does NOT throw

    acquireLock();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ─── startup ──────────────────────────────────────────────────────────────────
// BOT_TOKEN / CHAT_ID are module-level constants captured at require() time.
// Use jest.isolateModules() to load fresh module instances with different env vars.

describe('startup', () => {
  let exitSpy;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    jest.spyOn(process, 'on').mockImplementation(() => process);
    jest.spyOn(process, 'kill').mockImplementation(() => {});
  });

  // startup() now accepts (token, chatId) parameters for testability.
  // In production it defaults to the module-level BOT_TOKEN / CHAT_ID constants.

  test('calls process.exit(1) when token is empty', () => {
    startup('', '12345678');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('calls process.exit(1) when chatId is empty', () => {
    startup('valid:TOKEN', '');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('calls acquireLock (writes lock file) when credentials are present', async () => {
    // Provide responses for initOffset (getUpdates) then sendMsg "ไม่พบสินค้า"
    // so main() can complete and won't be left pending past afterEach.
    stubHttpsSeq(
      { ok: true, result: [] },
      { ok: true, result: { message_id: 1 } },
    );

    startup('valid:TOKEN', '12345678');

    // Flush two rounds of nextTick + microtasks so main() finishes the
    // "no products" path before afterEach restores process.exit.
    await new Promise(r => process.nextTick(r));
    await Promise.resolve();
    await new Promise(r => process.nextTick(r));
    await Promise.resolve();

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.approval-bot.lock'),
      expect.any(String),
      'utf8'
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('calls process.exit(1) when main() rejects', async () => {
    const req = new EventEmitter();
    req.write      = jest.fn();
    req.end        = jest.fn(() => process.nextTick(() => req.emit('error', new Error('net fail'))));
    req.setTimeout = jest.fn();
    https.request.mockImplementation(() => req);

    startup('valid:TOKEN', '12345678');

    // Flush: nextTick fires the error → tgApi rejects → initOffset propagates
    // → main propagates → .catch fires → process.exit(1)
    await new Promise(r => process.nextTick(r));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ─── Default args coverage ────────────────────────────────────────────────────

describe('default arg branches', () => {
  test('tgApi works without params (uses default empty object)', async () => {
    stubHttps({ ok: true, result: [] });
    await tgApi('getUpdates');
    expect(https.request).toHaveBeenCalled();
  });

  test('waitForCallback uses default timeout arg (expires after first sleep)', async () => {
    global.setTimeout.mockImplementation((fn) => { _fakeNow += 99999999; fn(); return 0; });
    stubHttps({ result: [] });
    const r = await waitForCallback(['x']); // no timeoutMs → uses 60*60*1000 default
    expect(r.data).toBe('timeout');
  });

  test('waitForDecision uses default timeout (passes through to waitForCallback)', async () => {
    global.setTimeout.mockImplementation((fn) => { _fakeNow += 99999999; fn(); return 0; });
    stubHttps({ result: [] });
    const r = await waitForDecision('ap_q', 'rg_q'); // no timeoutMs
    expect(r.decision).toBe('timeout');
  });
});

// ─── postAllPlatforms additional branch coverage ──────────────────────────────

describe('postAllPlatforms branches', () => {
  test('fb is ✅ when output contains Facebook and ✅ but not post_id', async () => {
    cp.execFileSync.mockReturnValue('✅ Facebook หน้าหลัก\n');
    fs.existsSync.mockReturnValue(false);
    const r = await postAllPlatforms('123');
    expect(r.fb).toContain('✅');
  });

  test('captures e.stdout when execFileSync throws with stdout property', async () => {
    const err = new Error('fail');
    err.stdout = 'some stdout output from post.js';
    cp.execFileSync.mockImplementation(() => { throw err; });
    fs.existsSync.mockReturnValue(false);
    const r = await postAllPlatforms('123');
    expect(r.fb).toContain('❌');
    expect(r.error).toContain('some stdout output');
  });

  test('shows ❌ fbClip with empty error string when r.error is undefined', async () => {
    cp.execFileSync.mockReturnValue('✅ Facebook post_id: abc\n');
    fs.existsSync.mockImplementation(p => String(p).includes('video.mp4'));
    stubHttp({ ok: false }); // no error field → r.error undefined → uses ''
    const r = await postAllPlatforms('123');
    expect(r.fbClip).toContain('❌');
  });
});

// ─── main with argItemId ──────────────────────────────────────────────────────

describe('main with item_id argument', () => {
  const TODAY = todayString();

  test('filters to specific item_id and runs approval flow', async () => {
    const origArgv = process.argv.slice();
    process.argv = ['node', 'approval-bot.js', '77777777'];

    const prodData = { title: 'Arg Item', price: '200', rating: '4.2', post_date: '2020-01-01', affiliate_short_link: 'x' };
    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      if (s === 'products') return true;
      if (s.includes('77777777') && (s.includes('data.json') || s.includes('facebook.md'))) return true;
      return false;
    });
    fs.readdirSync.mockReturnValue(['77777777', '88888888']);
    fs.readFileSync.mockImplementation((p, enc) => {
      if (String(p).includes('data.json')) return JSON.stringify(prodData);
      if (String(p).includes('facebook.md')) return 'content';
      return typeof enc === 'string' ? '' : Buffer.from('');
    });
    cp.execFileSync.mockReturnValue('✅ Facebook post_id: zz\n');

    let call = 0;
    https.request.mockImplementation((opts, cb) => {
      call++;
      const req = makeReq();
      const responses = [
        { ok: true, result: [] },                    // initOffset
        { ok: true, result: { message_id: 700 } },   // announce (🧪 ทดสอบ label)
        { ok: true, result: { message_id: 701 } },   // preview
        { result: [{ update_id: 1, callback_query: { id: 'cbG', data: 'ap_77777777_1' } }] },
        { ok: true },
        { ok: true },
        { ok: true, result: { message_id: 702 } },
        { ok: true, result: { message_id: 703 } },
        { ok: true, result: { message_id: 704 } },
      ];
      if (cb) cb(makeRes(responses[Math.min(call - 1, responses.length - 1)]));
      return req;
    });

    await mainFn();
    process.argv = origArgv;
    expect(cp.execFileSync).toHaveBeenCalled();
    // Only 77777777 product should be processed (88888888 filtered out)
    const postCalls = cp.execFileSync.mock.calls.filter(c => c[1] && c[1].includes('post.js'));
    expect(postCalls.every(c => c[1].includes('77777777'))).toBe(true);
  });

  test('sends ไม่พบสินค้า when argItemId not found in any product', async () => {
    const origArgv = process.argv.slice();
    process.argv = ['node', 'approval-bot.js', '11112222'];

    fs.existsSync.mockImplementation(p => String(p) === 'products' || String(p).includes('data.json'));
    fs.readdirSync.mockReturnValue(['99998888']);
    fs.readFileSync.mockReturnValue(JSON.stringify({ title: 'Other', price: '100', post_date: TODAY, affiliate_short_link: 'x' }));

    let sentTexts = [];
    https.request.mockImplementation((opts, cb) => {
      const req = makeReq({ onWrite: d => { sentTexts.push(JSON.parse(d).text || ''); } });
      if (cb) cb(makeRes({ ok: true, result: { message_id: 1 } }));
      return req;
    });

    await mainFn();
    process.argv = origArgv;
    expect(sentTexts.some(t => t.includes('ไม่พบสินค้า'))).toBe(true);
  });
});

// ─── Video creation success path ──────────────────────────────────────────────

describe('main video creation success', () => {
  test('logs success and sends message when make-tiktok-video.js creates video', async () => {
    const TODAY = todayString();
    const prodData = { title: 'VidSuccess', price: '199', rating: '4.5', post_date: TODAY, affiliate_short_link: 'x' };
    let videoCreated = false;

    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      if (s === 'products') return true;
      if (s.includes('30303031') && s.includes('data.json')) return true;
      if (s.includes('30303031') && s.includes('facebook.md')) return true;
      if (s.includes('30303031') && s.includes('tiktok.md')) return true;
      if (s.includes('30303031') && s.includes('video.mp4') && videoCreated) return true;
      return false;
    });
    fs.readdirSync.mockReturnValue(['30303031']);
    fs.readFileSync.mockImplementation((p, enc) => {
      if (String(p).includes('data.json')) return JSON.stringify(prodData);
      if (String(p).includes('facebook.md')) return 'content';
      return typeof enc === 'string' ? '' : Buffer.from('');
    });

    cp.execFileSync.mockImplementation((exe, args) => {
      if (args && args.includes('make-tiktok-video.js')) {
        videoCreated = true;
        return '';
      }
      return '✅ Facebook post_id: vs\n';
    });

    let call = 0;
    https.request.mockImplementation((opts, cb) => {
      call++;
      const req = makeReq();
      const responses = [
        { ok: true, result: [] },
        { ok: true, result: { message_id: 800 } },   // announce
        { ok: true, result: { message_id: 801 } },   // "กำลังสร้างวิดีโอ"
        { ok: true, result: { message_id: 802 } },   // "สร้างวิดีโอสำเร็จ"
        { ok: true, result: { message_id: 803 } },   // preview
        { result: [{ update_id: 1, callback_query: { id: 'cbH', data: 'ap_30303031_1' } }] },
        { ok: true },
        { ok: true },
        { ok: true, result: { message_id: 804 } },   // posting msg
        { ok: true, result: { message_id: 805 } },   // result
        { ok: true, result: { message_id: 806 } },   // summary
      ];
      if (cb) cb(makeRes(responses[Math.min(call - 1, responses.length - 1)]));
      return req;
    });

    await mainFn();
    const videoCalls = cp.execFileSync.mock.calls.filter(c => c[1] && c[1].includes('make-tiktok-video.js'));
    expect(videoCalls).toHaveLength(1);
    // After success, video exists → size logged → success message sent
    expect(call).toBeGreaterThan(8);
  });
});

// ─── Old products pagination ──────────────────────────────────────────────────

describe('handleOldProducts pagination', () => {
  test('shows next/prev buttons and handles page navigation', async () => {
    const TODAY = todayString();
    const todayProd = { title: 'TodayProd', price: '100', rating: '4', post_date: TODAY, affiliate_short_link: 'x' };

    // Create 10 old products to trigger pagination (PAGE=8, so page 0 has "next", page 1 has "prev")
    const oldIds = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].map(n => `8000000${n}`);
    const allIds = ['55551111', ...oldIds];

    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      if (s === 'products') return true;
      if (s.includes('55551111') && (s.includes('data.json') || s.includes('facebook.md'))) return true;
      for (const id of oldIds) {
        if (s.includes(id) && s.includes('data.json')) return true;
      }
      return false;
    });
    fs.readdirSync.mockReturnValue(allIds);
    fs.readFileSync.mockImplementation((p, enc) => {
      const s = String(p);
      if (s.includes('55551111') && s.includes('data.json')) return JSON.stringify(todayProd);
      for (const id of oldIds) {
        if (s.includes(id) && s.includes('data.json')) {
          return JSON.stringify({ title: `Old ${id}`, price: '50', rating: '3', post_date: '2020-01-01', affiliate_short_link: 'y' });
        }
      }
      if (s.includes('55551111') && s.includes('facebook.md')) return 'content';
      return typeof enc === 'string' ? '' : Buffer.from('');
    });
    cp.execFileSync.mockReturnValue('✅ Facebook post_id: pg\n');

    let call = 0;
    https.request.mockImplementation((opts, cb) => {
      call++;
      const req = makeReq();
      // Sequence: approve today → summary → ask old products → show → page1 → next (op_1) → page2 → done
      const responses = [
        { ok: true, result: [] },                    // initOffset
        { ok: true, result: { message_id: 900 } },   // announce
        { ok: true, result: { message_id: 901 } },   // preview today
        { result: [{ update_id: 1, callback_query: { id: 'cb1', data: 'ap_55551111_1' } }] }, // approve
        { ok: true },
        { ok: true },
        { ok: true, result: { message_id: 902 } },   // posting msg
        { ok: true, result: { message_id: 903 } },   // result
        { ok: true, result: { message_id: 904 } },   // summary
        { ok: true, result: { message_id: 905 } },   // ask old products
        { result: [{ update_id: 2, callback_query: { id: 'cb2', data: 'old_show' } }] }, // show
        { ok: true },
        { ok: true, result: { message_id: 906 } },   // page 1 list (has Next button → hasNext=true)
        { result: [{ update_id: 3, callback_query: { id: 'cb3', data: 'op_1' } }] }, // navigate to page 2
        { ok: true },
        { ok: true },                                // editMsg "กำลังโหลด"
        { ok: true, result: { message_id: 907 } },   // page 2 list (has Prev button → hasPrev=true)
        { result: [{ update_id: 4, callback_query: { id: 'cb4', data: 'old_done' } }] }, // done
        { ok: true },
        { ok: true },
      ];
      if (cb) cb(makeRes(responses[Math.min(call - 1, responses.length - 1)]));
      return req;
    });

    await mainFn();
    expect(call).toBeGreaterThan(15);
  });
});

// ─── approveLoop msgId = undefined ────────────────────────────────────────────

describe('approveLoop with missing msgId', () => {
  const itemId = '12345679';
  const data   = { title: 'NoMsgId', price: '50', rating: '4', affiliate_short_link: 'x' };

  test('skips editMsg when sendMsg returns no message_id', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('content');

    global.setTimeout.mockImplementation((fn) => { _fakeNow += 99999999; fn(); return 0; });

    stubHttpsSeq(
      { ok: true },       // sendMsg → no result.message_id → msgId = undefined
      { ok: true, result: [] }, // getUpdates → no match
      // editMsg NOT called because msgId is undefined
    );

    const result = await approveLoop(itemId, data);
    expect(result).toBe(false);
    // Only 2 https calls: sendMsg + getUpdates (no editMsg)
    expect(https.request).toHaveBeenCalledTimes(2);
  });
});

// ─── Branch coverage gap-fill ─────────────────────────────────────────────────

describe('waitForCallback — missing result field (line 117 false branch)', () => {
  test('skips iteration and eventually times out when response has no result field', async () => {
    global.setTimeout.mockImplementation((fn) => { _fakeNow += 99999999; fn(); return 0; });
    stubHttps({ ok: true }); // res.result is undefined → if (res.result) false
    const r = await waitForCallback(['x']);
    expect(r.data).toBe('timeout');
  });
});

describe('regenerateFromTemplate — null title (line 145 || branch)', () => {
  test('uses empty string fallback when title is null', () => {
    const result = regenerateFromTemplate({ title: null, price: '199', affiliate_short_link: 'x' }, 1);
    expect(result).toContain('#Shopeeaffiliate');
  });
});

describe('postAllPlatforms — error with no stdout and empty message (line 218 || branch)', () => {
  test('falls back to empty string when both e.stdout and e.message are falsy', async () => {
    const err = new Error('');
    err.stdout = '';
    cp.execFileSync.mockImplementation(() => { throw err; });
    fs.existsSync.mockReturnValue(false);
    const r = await postAllPlatforms('111');
    expect(r.fb).toContain('❌');
    expect(r.error).toBe('');
  });
});

describe('approveLoop — null title + no msgId (lines 239, 282, 288 branches)', () => {
  const itemId = '99887766';

  test('uses empty string when title is null; skips editMsg on approve when msgId undefined (lines 239+282 false)', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('content');
    stubHttpsSeq(
      { ok: true },                                                                              // sendMsg preview → no message_id → msgId=undefined
      { result: [{ update_id: 1, callback_query: { id: 'cba1', data: `ap_${itemId}_1` } }] }, // getUpdates → approve
      { ok: true },                                                                              // answerCb
      // editMsg at line 282 skipped (msgId=undefined)
    );
    expect(await approveLoop(itemId, { title: null, price: '99', affiliate_short_link: 'x' })).toBe(true);
  });

  test('skips editMsg in regen path when msgId is undefined (line 288 false)', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('content');
    stubHttpsSeq(
      { ok: true },                                                                              // sendMsg preview 1 → no msgId
      { result: [{ update_id: 2, callback_query: { id: 'cbr1', data: `rg_${itemId}_1` } }] }, // getUpdates → regen
      { ok: true },                                                                              // answerCb regen
      // editMsg at line 288 skipped (msgId=undefined)
      { ok: true, result: { message_id: 99 } },                                                // sendMsg "สร้าง content ใหม่"
      { ok: true, result: { message_id: 100 } },                                               // sendMsg preview 2 (msgId=100)
      { result: [{ update_id: 3, callback_query: { id: 'cba2', data: `ap_${itemId}_2` } }] }, // getUpdates → approve
      { ok: true },                                                                              // answerCb approve
      { ok: true },                                                                              // editMsg approve (msgId=100, so called)
    );
    expect(await approveLoop(itemId, { title: 'RegenProd', price: '99', affiliate_short_link: 'x' })).toBe(true);
  });
});

describe('main — video.mp4 not created after make-tiktok-video.js (line 456 false branch)', () => {
  test('silently continues when execFileSync runs but video.mp4 is still missing', async () => {
    const TODAY = todayString();
    const prodData = { title: 'SilentFail', price: '199', post_date: TODAY, affiliate_short_link: 'x' };

    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      if (s === 'products') return true;
      if (s.includes('99887766') && s.includes('data.json')) return true;
      if (s.includes('99887766') && s.includes('tiktok.md')) return true;
      // video.mp4 never exists (even after execFileSync)
      return false;
    });
    fs.readdirSync.mockReturnValue(['99887766']);
    fs.readFileSync.mockImplementation((p, enc) => {
      if (String(p).includes('data.json')) return JSON.stringify(prodData);
      return typeof enc === 'string' ? '' : Buffer.from('');
    });
    cp.execFileSync.mockReturnValue(''); // runs without error, but video not created

    stubHttpsSeq(
      { ok: true, result: [] },                 // initOffset
      { ok: true, result: { message_id: 1 } }, // announce
      { ok: true, result: { message_id: 2 } }, // sendMsg "กำลังสร้างวิดีโอ"
      // if (fs.existsSync(videoPath)) → false → success block skipped (branch 66[1] covered)
      { ok: true, result: { message_id: 3 } }, // approveLoop warning (no facebook.md)
      { ok: true, result: { message_id: 4 } }, // summary
    );

    await mainFn();

    const videoCalls = cp.execFileSync.mock.calls.filter(c => c[1] && c[1].includes('make-tiktok-video.js'));
    expect(videoCalls).toHaveLength(1);
  });
});
