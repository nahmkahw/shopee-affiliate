'use strict';

jest.mock('fs');
jest.mock('http');
jest.mock('https');
jest.mock('dotenv', () => ({ config: jest.fn() }));

const fs    = require('fs');
const http  = require('http');
const https = require('https');
const { EventEmitter } = require('events');

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeReq() {
  const req = Object.assign(new EventEmitter(), {
    write:      jest.fn(),
    end:        jest.fn(),
    destroy:    jest.fn(),
    setTimeout: jest.fn((ms, cb) => { req._timeoutCb = cb; return req; }),
  });
  return req;
}

function makeRes(body = '{"message":{"content":"generated"}}') {
  const res = new EventEmitter();
  res.schedule = () => process.nextTick(() => {
    res.emit('data', body);
    res.emit('end');
  });
  return res;
}

// Mock http.request to call callback immediately with a mock response
function mockRequest(body = '{"message":{"content":"generated"}}') {
  const req = makeReq();
  http.request.mockImplementation((opts, cb) => {
    const res = makeRes(body);
    process.nextTick(() => { cb(res); res.emit('data', body); res.emit('end'); });
    return req;
  });
  return req;
}

function mockHttpsRequest(body = '{"message":{"content":"generated"}}') {
  const req = makeReq();
  https.request.mockImplementation((opts, cb) => {
    const res = makeRes(body);
    process.nextTick(() => { cb(res); res.emit('data', body); res.emit('end'); });
    return req;
  });
  return req;
}

// Mock http.get for the Ollama tags check
function mockOllamaTagsOk(model = 'llama3.2:latest') {
  const body = JSON.stringify({ models: [{ name: model }] });
  http.get.mockImplementation((opts, cb) => {
    const res = new EventEmitter();
    process.nextTick(() => { cb(res); res.emit('data', body); res.emit('end'); });
    return makeReq();
  });
}

// ─── load module once ─────────────────────────────────────────────────────────

const { buildContext, cleanText, ollamaChat, generateFacebook, generateInstagram, generateTikTok, main } =
  require('../generate-content');

// ─── reset between tests ──────────────────────────────────────────────────────

beforeEach(() => {
  jest.resetAllMocks();
});

// ─── buildContext ─────────────────────────────────────────────────────────────

describe('buildContext', () => {
  const base = {
    title: 'Test Product',
    price: '฿299',
    original_price: '฿599',
    discount: '-50%',
    rating: '4.8',
    review_count: '1,234',
    shop_name: 'TestShop',
    affiliate_short_link: 'https://s.shopee.co.th/abc',
  };

  test('builds context with all fields present', () => {
    const ctx = buildContext(base);
    expect(ctx).toContain('Test Product');
    expect(ctx).toContain('฿299');
    expect(ctx).toContain('TestShop');
    expect(ctx).toContain('https://s.shopee.co.th/abc');
  });

  test('omits feature section when no description', () => {
    const ctx = buildContext({ ...base, description: undefined });
    expect(ctx).not.toContain('Features');
  });

  test('includes bullet points extracted from description', () => {
    const ctx = buildContext({ ...base, description: 'หัวข้อ\n- คุณสมบัติหนึ่ง\n- คุณสมบัติสอง' });
    expect(ctx).toContain('คุณสมบัติหนึ่ง');
    expect(ctx).toContain('คุณสมบัติสอง');
  });

  test('includes string review (reviews from scrape.js are strings, not objects)', () => {
    const ctx = buildContext({ ...base, reviews: ['รีวิวจากผู้ใช้จริง'] });
    expect(ctx).toContain('รีวิวจากผู้ใช้จริง');
  });

  test('includes review from object with .comment (legacy format)', () => {
    const ctx = buildContext({ ...base, reviews: [{ comment: 'ของดีมาก' }] });
    expect(ctx).toContain('ของดีมาก');
  });

  test('handles empty reviews array', () => {
    const ctx = buildContext({ ...base, reviews: [] });
    expect(ctx).not.toContain('รีวิวจากลูกค้า');
  });

  test('handles missing optional fields gracefully', () => {
    const ctx = buildContext({ title: 'Minimal', affiliate_short_link: 'https://s.shopee.co.th/x' });
    expect(ctx).toContain('Minimal');
    expect(ctx).not.toContain('undefined');
  });

  test('filters out description lines that are too short or too long', () => {
    const short = 'Hi';  // length 2 — filtered
    const good  = 'คุณสมบัตินี้ดีมากควรซื้อ';  // good length
    const long  = 'x'.repeat(151);  // 151 chars — filtered
    const ctx = buildContext({ ...base, description: `${short}\n${good}\n${long}` });
    expect(ctx).toContain(good);
    expect(ctx).not.toContain(long);
    expect(ctx).not.toContain(short.trim());
  });
});

// ─── cleanText ────────────────────────────────────────────────────────────────

describe('cleanText', () => {
  test('removes [label] prefixes', () => {
    expect(cleanText('[Facebook Post] เนื้อหา')).not.toContain('[Facebook Post]');
  });

  test('removes bold label: prefixes', () => {
    expect(cleanText('**Caption:** เนื้อหา')).not.toContain('Caption:');
  });

  test('collapses 4+ consecutive newlines to 3', () => {
    const result = cleanText('A\n\n\n\n\nB');
    expect(result).not.toMatch(/\n{4,}/);
  });

  test('trims leading and trailing whitespace', () => {
    expect(cleanText('   hello   ')).toBe('hello');
  });
});

// ─── ollamaChat ───────────────────────────────────────────────────────────────

describe('ollamaChat', () => {
  test('resolves with message content on success (http)', async () => {
    mockRequest('{"message":{"content":"ผลลัพธ์จาก AI"}}');
    const result = await ollamaChat('prompt');
    expect(result).toBe('ผลลัพธ์จาก AI');
    expect(http.request).toHaveBeenCalled();
  });

  test('falls back to j.response when message.content is absent', async () => {
    mockRequest('{"response":"fallback response"}');
    const result = await ollamaChat('prompt');
    expect(result).toBe('fallback response');
  });

  test('returns empty string when neither message.content nor response', async () => {
    mockRequest('{}');
    const result = await ollamaChat('prompt');
    expect(result).toBe('');
  });

  test('rejects when j.error is set', async () => {
    mockRequest('{"error":"model not loaded"}');
    await expect(ollamaChat('prompt')).rejects.toThrow('Ollama error: model not loaded');
  });

  test('rejects on JSON parse error', async () => {
    mockRequest('NOT JSON');
    await expect(ollamaChat('prompt')).rejects.toThrow('Ollama parse error');
  });

  test('rejects on network error', async () => {
    const req = makeReq();
    http.request.mockImplementation((opts, cb) => {
      process.nextTick(() => req.emit('error', new Error('ECONNREFUSED')));
      return req;
    });
    await expect(ollamaChat('prompt')).rejects.toThrow('Ollama connection: ECONNREFUSED');
  });

  test('rejects on timeout', async () => {
    const req = makeReq();
    http.request.mockImplementation((opts, cb) => {
      process.nextTick(() => { if (req._timeoutCb) req._timeoutCb(); });
      return req;
    });
    await expect(ollamaChat('prompt')).rejects.toThrow('Ollama timeout');
    expect(req.destroy).toHaveBeenCalled();
  });

  test('writes request body and calls end()', async () => {
    const req = mockRequest('{"message":{"content":"ok"}}');
    await ollamaChat('test prompt');
    expect(req.write).toHaveBeenCalled();
    expect(req.end).toHaveBeenCalled();
  });
});

// ─── generateFacebook/Instagram/TikTok ───────────────────────────────────────

describe('generateFacebook', () => {
  test('calls ollamaChat and returns result', async () => {
    mockRequest('{"message":{"content":"FB content"}}');
    const result = await generateFacebook({ title: 'Prod', affiliate_short_link: 'https://s.shopee.co.th/x' });
    expect(result).toBe('FB content');
  });
});

describe('generateInstagram', () => {
  test('calls ollamaChat and returns result', async () => {
    mockRequest('{"message":{"content":"IG content"}}');
    const result = await generateInstagram({ title: 'Prod', price: '฿299', original_price: '฿599' });
    expect(result).toBe('IG content');
  });
});

describe('generateTikTok', () => {
  test('calls ollamaChat and returns result', async () => {
    mockRequest('{"message":{"content":"TT content"}}');
    const result = await generateTikTok({ title: 'Prod' });
    expect(result).toBe('TT content');
  });
});

// ─── main(): guard checks ─────────────────────────────────────────────────────

describe('main(): no itemId', () => {
  test('exits with error when itemId is missing', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    const errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(main({ args: [] })).rejects.toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe('main(): data.json not found', () => {
  test('exits with error when data.json does not exist', async () => {
    fs.existsSync.mockReturnValue(false);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    const errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(main({ itemId: '12345' })).rejects.toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe('main(): data.json parse error', () => {
  test('exits with error when data.json is malformed', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('NOT JSON');
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    const errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(main({ itemId: '12345' })).rejects.toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe('main(): all content exists, no force', () => {
  test('exits 0 when all 3 content files already exist', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ title: 'T', status: 'draft' }));
    fs.mkdirSync.mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT0'); });
    const logSpy  = jest.spyOn(console, 'log').mockImplementation(() => {});
    await expect(main({ itemId: '12345' })).rejects.toThrow('EXIT0');
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
    logSpy.mockRestore();
  });
});

describe('main(): Ollama connection fails', () => {
  test('exits with error when Ollama tags endpoint is unreachable', async () => {
    // data.json exists + reads OK
    fs.existsSync
      .mockReturnValueOnce(true)   // dataPath exists
      .mockReturnValue(false);     // none of the content files exist
    fs.readFileSync.mockReturnValue(JSON.stringify({ title: 'T', status: 'scraped' }));
    fs.mkdirSync.mockImplementation(() => {});

    // Ollama tags: network error
    const req = makeReq();
    http.get.mockImplementation((opts, cb) => {
      process.nextTick(() => req.emit('error', new Error('ECONNREFUSED')));
      return req;
    });

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    const errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy  = jest.spyOn(console, 'log').mockImplementation(() => {});
    await expect(main({ itemId: '12345' })).rejects.toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
  });
});

describe('main(): Ollama model not found', () => {
  test('exits with error when required model is not in Ollama', async () => {
    fs.existsSync
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    fs.readFileSync.mockReturnValue(JSON.stringify({ title: 'T', status: 'scraped' }));
    fs.mkdirSync.mockImplementation(() => {});

    // Ollama tags: model list doesn't include llama3.2
    const body = JSON.stringify({ models: [{ name: 'mistral:latest' }] });
    http.get.mockImplementation((opts, cb) => {
      const res = new EventEmitter();
      process.nextTick(() => { cb(res); res.emit('data', body); res.emit('end'); });
      return makeReq();
    });

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    const errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy  = jest.spyOn(console, 'log').mockImplementation(() => {});
    await expect(main({ itemId: '12345' })).rejects.toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
  });
});

describe('main(): Ollama tags parse error', () => {
  test('exits with error when Ollama returns invalid JSON for tags', async () => {
    fs.existsSync
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    fs.readFileSync.mockReturnValue(JSON.stringify({ title: 'T', status: 'scraped' }));
    fs.mkdirSync.mockImplementation(() => {});

    http.get.mockImplementation((opts, cb) => {
      const res = new EventEmitter();
      process.nextTick(() => { cb(res); res.emit('data', 'NOT JSON'); res.emit('end'); });
      return makeReq();
    });

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    const errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy  = jest.spyOn(console, 'log').mockImplementation(() => {});
    await expect(main({ itemId: '12345' })).rejects.toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
  });
});

// ─── main(): full success paths ───────────────────────────────────────────────

function setupDataAndTags(existingFiles = []) {
  fs.existsSync.mockImplementation(p => {
    if (String(p).endsWith('data.json')) return true;
    if (existingFiles.some(f => String(p).endsWith(f))) return true;
    return false;
  });
  fs.readFileSync.mockReturnValue(JSON.stringify({ title: 'Product', status: 'scraped', affiliate_short_link: 'https://s.shopee.co.th/x' }));
  fs.mkdirSync.mockImplementation(() => {});
  fs.writeFileSync.mockImplementation(() => {});
  mockOllamaTagsOk();
}

describe('main(): generates all 3 content files', () => {
  test('writes facebook.md, instagram.md, tiktok.md and updates status to draft', async () => {
    setupDataAndTags([]);  // none exist

    // ollamaChat: FB, IG, TT calls
    const req = makeReq();
    http.request.mockImplementation((opts, cb) => {
      const res = new EventEmitter();
      process.nextTick(() => {
        cb(res);
        res.emit('data', '{"message":{"content":"content text"}}');
        res.emit('end');
      });
      return req;
    });

    const logSpy    = jest.spyOn(console, 'log').mockImplementation(() => {});
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    await main({ itemId: '12345' });

    expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('facebook.md'), expect.any(String), 'utf8');
    expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('instagram.md'), expect.any(String), 'utf8');
    expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('tiktok.md'), expect.any(String), 'utf8');
    // status updated to 'draft'
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('data.json'),
      expect.stringContaining('"draft"'),
      'utf8'
    );
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
  });
});

describe('main(): --force rewrites existing files', () => {
  test('generates all 3 even when files already exist when force=true', async () => {
    setupDataAndTags(['facebook.md', 'instagram.md', 'tiktok.md']);  // all exist

    const req = makeReq();
    http.request.mockImplementation((opts, cb) => {
      const res = new EventEmitter();
      process.nextTick(() => {
        cb(res);
        res.emit('data', '{"message":{"content":"forced"}}');
        res.emit('end');
      });
      return req;
    });

    const logSpy    = jest.spyOn(console, 'log').mockImplementation(() => {});
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    await main({ itemId: '12345', force: true });

    expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('facebook.md'), expect.any(String), 'utf8');
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
  });
});

describe('main(): status stays unchanged when not scraped', () => {
  test('does not update status when already posted', async () => {
    fs.existsSync.mockImplementation(p => String(p).endsWith('data.json'));
    fs.readFileSync.mockReturnValue(JSON.stringify({ title: 'P', status: 'posted' }));
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    mockOllamaTagsOk();

    const req = makeReq();
    http.request.mockImplementation((opts, cb) => {
      const res = new EventEmitter();
      process.nextTick(() => { cb(res); res.emit('data', '{"message":{"content":"ok"}}'); res.emit('end'); });
      return req;
    });

    const logSpy    = jest.spyOn(console, 'log').mockImplementation(() => {});
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    await main({ itemId: '12345' });

    // writeFileSync should NOT be called with data.json (status update skipped)
    const dataJsonCalls = fs.writeFileSync.mock.calls.filter(c => String(c[0]).endsWith('data.json'));
    expect(dataJsonCalls).toHaveLength(0);
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
  });
});

describe('main(): generates only missing files', () => {
  test('skips facebook.md when it already exists (no force)', async () => {
    setupDataAndTags(['facebook.md']);  // FB exists, IG/TT don't

    const req = makeReq();
    http.request.mockImplementation((opts, cb) => {
      const res = new EventEmitter();
      process.nextTick(() => { cb(res); res.emit('data', '{"message":{"content":"ok"}}'); res.emit('end'); });
      return req;
    });

    const logSpy    = jest.spyOn(console, 'log').mockImplementation(() => {});
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    await main({ itemId: '12345' });

    // facebook.md should NOT be written
    const fbCalls = fs.writeFileSync.mock.calls.filter(c => String(c[0]).endsWith('facebook.md'));
    expect(fbCalls).toHaveLength(0);
    // instagram.md and tiktok.md should be written
    expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('instagram.md'), expect.any(String), 'utf8');
    expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('tiktok.md'), expect.any(String), 'utf8');
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
  });
});
