'use strict';

jest.mock('playwright');
jest.mock('fs');
jest.mock('https');
jest.mock('http');

const fs    = require('fs');
const https = require('https');
const http  = require('http');
const { EventEmitter } = require('events');

// ─── playwright mock ──────────────────────────────────────────────────────────

const mockPage = {
  url:            jest.fn().mockReturnValue('https://affiliate.shopee.co.th/offer/product_offer'),
  waitForTimeout: jest.fn().mockResolvedValue(undefined),
  evaluate:       jest.fn(),
  keyboard:       { press: jest.fn().mockResolvedValue(undefined) },
};

const mockCtx = {
  pages: jest.fn().mockReturnValue([mockPage]),
};

const mockBrowser = {
  contexts: jest.fn().mockReturnValue([mockCtx]),
  close:    jest.fn().mockResolvedValue(undefined),
};

require('playwright').chromium = {
  connectOverCDP: jest.fn().mockResolvedValue(mockBrowser),
};

// ─── tiny helpers ─────────────────────────────────────────────────────────────

function makeHttpReq() {
  const req = new EventEmitter();
  req.destroy    = jest.fn();
  req.setTimeout = jest.fn((ms, cb) => { req._timeoutCb = cb; return req; });
  return req;
}

// ─── load module once ─────────────────────────────────────────────────────────

const { parseUrlsFile, addDays, resolveRedirect, getProductUrl, extractIds, main } =
  require('../scrape-offers');

// ─── reset mocks between tests ────────────────────────────────────────────────

beforeEach(() => {
  jest.resetAllMocks();

  mockBrowser.contexts.mockReturnValue([mockCtx]);
  mockBrowser.close.mockResolvedValue(undefined);
  mockCtx.pages.mockReturnValue([mockPage]);
  mockPage.url.mockReturnValue('https://affiliate.shopee.co.th/offer/product_offer');
  mockPage.waitForTimeout.mockResolvedValue(undefined);
  mockPage.keyboard.press.mockResolvedValue(undefined);

  // Default page.evaluate: returns allProducts with 1 item, buttonCount=1, productOrder=['111']
  mockPage.evaluate
    .mockResolvedValueOnce([{ item_id: '111' }])  // scan products
    .mockResolvedValueOnce({ buttonCount: 1, productOrder: ['111'] })  // get buttons
    .mockResolvedValueOnce(true)   // click button
    .mockResolvedValueOnce('https://s.shopee.co.th/short')  // get short link
    .mockResolvedValue(undefined); // close modal

  require('playwright').chromium.connectOverCDP.mockResolvedValue(mockBrowser);
});

// ─── parseUrlsFile ────────────────────────────────────────────────────────────

describe('parseUrlsFile', () => {
  test('returns empty set when urls.txt does not exist', () => {
    fs.existsSync.mockReturnValue(false);
    const result = parseUrlsFile();
    expect(result.existingItemIds.size).toBe(0);
    expect(result.lastDate).toBeNull();
  });

  test('extracts item_ids and lastDate from valid file', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      'https://shopee.co.th/product/111/222 | https://s.shopee.co.th/abc | 2026-06-15\n' +
      'https://shopee.co.th/product/333/444 | | 2026-06-20\n'
    );
    const result = parseUrlsFile();
    expect(result.existingItemIds.has('222')).toBe(true);
    expect(result.existingItemIds.has('444')).toBe(true);
    expect(result.lastDate).toBe('2026-06-20');
  });

  test('skips comment lines', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      '# comment\nhttps://shopee.co.th/product/111/222 | | 2026-06-15\n'
    );
    const result = parseUrlsFile();
    expect(result.existingItemIds.has('222')).toBe(true);
  });

  test('ignores lines with invalid date format', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      'https://shopee.co.th/product/111/222 | | not-a-date\n'
    );
    const result = parseUrlsFile();
    expect(result.lastDate).toBeNull();
  });

  test('ignores lines with non-shopee URLs', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('https://example.com/product/111/222 | | 2026-06-15\n');
    const result = parseUrlsFile();
    expect(result.existingItemIds.size).toBe(0);
  });
});

// ─── addDays ──────────────────────────────────────────────────────────────────

describe('addDays', () => {
  test('adds positive days to a date string', () => {
    expect(addDays('2026-06-01', 5)).toBe('2026-06-06');
  });

  test('adds zero days (returns same date)', () => {
    expect(addDays('2026-06-15', 0)).toBe('2026-06-15');
  });

  test('handles month rollover', () => {
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01');
  });
});

// ─── extractIds ───────────────────────────────────────────────────────────────

describe('extractIds', () => {
  test('parses format 1: /product/{shop_id}/{item_id}', () => {
    const r = extractIds('https://shopee.co.th/product/111/222');
    expect(r).toEqual({ shop_id: '111', item_id: '222' });
  });

  test('parses format 2: /{name}/{shop_id}/{item_id}', () => {
    const r = extractIds('https://shopee.co.th/opaanlp/1618596749/54256553392');
    expect(r).toEqual({ shop_id: '1618596749', item_id: '54256553392' });
  });

  test('parses format 3: .i.{item_id}.{shop_id}', () => {
    const r = extractIds('https://shopee.co.th/product-name.i.123456.789012');
    expect(r).toEqual({ shop_id: '789012', item_id: '123456' });
  });

  test('returns null for unrecognized URL format', () => {
    const r = extractIds('https://example.com/not-shopee');
    expect(r).toBeNull();
  });
});

// ─── resolveRedirect ──────────────────────────────────────────────────────────

describe('resolveRedirect', () => {
  test('follows redirect and returns location header', async () => {
    const req = makeHttpReq();
    https.get.mockImplementation((url, opts, cb) => {
      const res = new EventEmitter();
      res.headers = { location: 'https://shopee.co.th/product/111/222' };
      res.resume  = jest.fn();
      cb(res);
      return req;
    });
    const result = await resolveRedirect('https://s.shopee.co.th/short');
    expect(result).toBe('https://shopee.co.th/product/111/222');
  });

  test('returns original url when no location header', async () => {
    const req = makeHttpReq();
    https.get.mockImplementation((url, opts, cb) => {
      const res = new EventEmitter();
      res.headers = {};
      res.resume  = jest.fn();
      cb(res);
      return req;
    });
    const result = await resolveRedirect('https://example.com/no-redirect');
    expect(result).toBe('https://example.com/no-redirect');
  });

  test('returns null on network error', async () => {
    const req = makeHttpReq();
    https.get.mockImplementation(() => {
      process.nextTick(() => req.emit('error', new Error('ECONNREFUSED')));
      return req;
    });
    const result = await resolveRedirect('https://s.shopee.co.th/bad');
    expect(result).toBeNull();
  });

  test('returns null on timeout', async () => {
    const req = makeHttpReq();
    https.get.mockImplementation(() => {
      process.nextTick(() => { if (req._timeoutCb) req._timeoutCb(); });
      return req;
    });
    const result = await resolveRedirect('https://s.shopee.co.th/timeout');
    expect(result).toBeNull();
    expect(req.destroy).toHaveBeenCalled();
  });

  test('uses http module for http:// urls', async () => {
    const req = makeHttpReq();
    http.get.mockImplementation((url, opts, cb) => {
      const res = new EventEmitter();
      res.headers = { location: 'https://shopee.co.th/product/1/2' };
      res.resume  = jest.fn();
      cb(res);
      return req;
    });
    const result = await resolveRedirect('http://s.shopee.co.th/short');
    expect(result).toBe('https://shopee.co.th/product/1/2');
    expect(http.get).toHaveBeenCalled();
  });

  test('returns null when mod.get throws synchronously (catch branch)', async () => {
    https.get.mockImplementation(() => { throw new Error('sync-throw'); });
    const result = await resolveRedirect('https://s.shopee.co.th/bad-sync');
    expect(result).toBeNull();
  });

  test('strips query string from location', async () => {
    const req = makeHttpReq();
    https.get.mockImplementation((url, opts, cb) => {
      const res = new EventEmitter();
      res.headers = { location: 'https://shopee.co.th/product/111/222?utm=abc' };
      res.resume  = jest.fn();
      cb(res);
      return req;
    });
    const result = await resolveRedirect('https://s.shopee.co.th/short');
    expect(result).toBe('https://shopee.co.th/product/111/222');
  });
});

// ─── getProductUrl ────────────────────────────────────────────────────────────

describe('getProductUrl', () => {
  test('resolves short link to product URL (format 1)', async () => {
    const req = makeHttpReq();
    https.get.mockImplementation((url, opts, cb) => {
      const res = new EventEmitter();
      res.headers = { location: 'https://shopee.co.th/product/111/222' };
      res.resume  = jest.fn();
      cb(res);
      return req;
    });
    const result = await getProductUrl('https://s.shopee.co.th/short');
    expect(result).toBe('https://shopee.co.th/product/111/222');
  });

  test('resolves to format 2 URL', async () => {
    const req = makeHttpReq();
    https.get.mockImplementation((url, opts, cb) => {
      const res = new EventEmitter();
      res.headers = { location: 'https://shopee.co.th/shopname/111/222' };
      res.resume  = jest.fn();
      cb(res);
      return req;
    });
    const result = await getProductUrl('https://s.shopee.co.th/format2');
    expect(result).toBe('https://shopee.co.th/shopname/111/222');
  });

  test('resolves to format 3 URL (.i.)', async () => {
    const req = makeHttpReq();
    https.get.mockImplementation((url, opts, cb) => {
      const res = new EventEmitter();
      res.headers = { location: 'https://shopee.co.th/product.i.12345.67890' };
      res.resume  = jest.fn();
      cb(res);
      return req;
    });
    const result = await getProductUrl('https://s.shopee.co.th/format3');
    expect(result).toBe('https://shopee.co.th/product.i.12345.67890');
  });

  test('returns null when redirect loop detected (next === current)', async () => {
    const req = makeHttpReq();
    // Returns same URL each time → loop
    https.get.mockImplementation((url, opts, cb) => {
      const res = new EventEmitter();
      res.headers = { location: 'https://s.shopee.co.th/same-url' };
      res.resume  = jest.fn();
      cb(res);
      return req;
    });
    const result = await getProductUrl('https://s.shopee.co.th/same-url');
    expect(result).toBeNull();
  });

  test('follows intermediate non-shopee redirect before reaching product URL', async () => {
    const req = makeHttpReq();
    let callCount = 0;
    https.get.mockImplementation((url, opts, cb) => {
      const res = new EventEmitter();
      res.resume = jest.fn();
      callCount++;
      if (callCount === 1) {
        // First hop: intermediate URL (no shopee product pattern)
        res.headers = { location: 'https://intermediate.example.com/redirect' };
      } else {
        // Second hop: final shopee product URL
        res.headers = { location: 'https://shopee.co.th/product/111/222' };
      }
      cb(res);
      return req;
    });
    const result = await getProductUrl('https://s.shopee.co.th/two-hop');
    expect(result).toBe('https://shopee.co.th/product/111/222');
  });

  test('returns null when resolve fails (null next)', async () => {
    const req = makeHttpReq();
    https.get.mockImplementation(() => {
      process.nextTick(() => req.emit('error', new Error('fail')));
      return req;
    });
    const result = await getProductUrl('https://s.shopee.co.th/error');
    expect(result).toBeNull();
  });
});

// ─── main(): Chrome connect fails ─────────────────────────────────────────────

describe('main(): Chrome connect failure', () => {
  test('logs error and exits when Chrome is unavailable', async () => {
    require('playwright').chromium.connectOverCDP.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    const errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(main()).rejects.toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});

// ─── main(): no context ───────────────────────────────────────────────────────

describe('main(): browser has no contexts', () => {
  test('exits with error when browser.contexts() is empty', async () => {
    mockBrowser.contexts.mockReturnValue([]);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    const errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(main()).rejects.toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockBrowser.close).toHaveBeenCalled();
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});

// ─── main(): no affiliate tab found ───────────────────────────────────────────

describe('main(): no affiliate tab open', () => {
  test('exits with error when no affiliate portal tab is found', async () => {
    mockPage.url.mockReturnValue('https://google.com');
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    const errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(main()).rejects.toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});

// ─── main(): no products on page ──────────────────────────────────────────────

describe('main(): no products found on affiliate page', () => {
  test('exits with error when evaluate returns empty product list', async () => {
    mockPage.evaluate.mockReset();
    mockPage.evaluate.mockResolvedValueOnce([]);  // empty allProducts
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    const errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(main()).rejects.toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});

// ─── main(): all products already in urls.txt ─────────────────────────────────

describe('main(): all products already tracked', () => {
  test('returns early when all found products already exist in urls.txt', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      'https://shopee.co.th/product/999/111 | | 2026-06-15\n'  // item_id 111 already tracked
    );
    mockPage.evaluate.mockReset();
    mockPage.evaluate.mockResolvedValueOnce([{ item_id: '111' }]);  // scan: found 111

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await main();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ไม่มีสินค้าใหม่'));
    logSpy.mockRestore();
  });
});

// ─── main(): dry-run mode ─────────────────────────────────────────────────────

describe('main(): dry-run mode', () => {
  test('returns early without clicking buttons when dryRun=true', async () => {
    mockPage.evaluate.mockReset();
    mockPage.evaluate.mockResolvedValueOnce([{ item_id: '999' }]);  // scan: 1 new product

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await main({ dryRun: true });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Dry-run'));
    expect(mockPage.evaluate).toHaveBeenCalledTimes(1);  // only the scan call
    logSpy.mockRestore();
  });
});

// ─── main(): no buttons found ─────────────────────────────────────────────────

describe('main(): no "เอาลิงก์" buttons on page', () => {
  test('exits with error when buttonCount is 0', async () => {
    mockPage.evaluate.mockReset();
    mockPage.evaluate
      .mockResolvedValueOnce([{ item_id: '999' }])   // scan
      .mockResolvedValueOnce({ buttonCount: 0, productOrder: ['999'] });  // buttons

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    const errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(main()).rejects.toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});

// ─── main(): product not in DOM ───────────────────────────────────────────────

describe('main(): product not found in productOrder', () => {
  test('skips product when item_id not in productOrder then exits with no results', async () => {
    mockPage.evaluate.mockReset();
    mockPage.evaluate
      .mockResolvedValueOnce([{ item_id: '999' }])  // scan
      .mockResolvedValueOnce({ buttonCount: 1, productOrder: ['111'] });  // 999 NOT in order

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    const errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy  = jest.spyOn(console, 'log').mockImplementation(() => {});
    await expect(main()).rejects.toThrow('EXIT1');
    // writeFileSync must NOT have been called before exit
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
  });
});

// ─── main(): full success path ────────────────────────────────────────────────

describe('main(): full success with short link resolution', () => {
  test('writes to urls.txt after successfully getting affiliate link', async () => {
    // resolveRedirect: return product URL on first hop
    const req = makeHttpReq();
    https.get.mockImplementation((url, opts, cb) => {
      const res = new EventEmitter();
      res.headers = { location: 'https://shopee.co.th/product/111/999' };
      res.resume  = jest.fn();
      cb(res);
      return req;
    });

    fs.existsSync.mockReturnValue(false);  // urls.txt doesn't exist
    fs.readFileSync = jest.fn().mockReturnValue('');
    fs.writeFileSync.mockImplementation(() => {});

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    await main();
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('urls.txt'), expect.stringContaining('shopee.co.th/product/111/999'), 'utf8'
    );
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  test('uses short link as fallback when resolve fails', async () => {
    const req = makeHttpReq();
    // Redirect loop → getProductUrl returns null
    https.get.mockImplementation((url, opts, cb) => {
      const res = new EventEmitter();
      res.headers = { location: 'https://s.shopee.co.th/short' };  // same URL → loop
      res.resume  = jest.fn();
      cb(res);
      return req;
    });

    fs.existsSync.mockReturnValue(false);
    fs.readFileSync = jest.fn().mockReturnValue('');
    fs.writeFileSync.mockImplementation(() => {});

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    await main();
    // Should still write something (fallback short_link used)
    expect(fs.writeFileSync).toHaveBeenCalled();
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  test('reports when some products were missed', async () => {
    // item 111 is in scan result but click returns false → not in results
    mockPage.evaluate.mockReset();
    mockPage.evaluate
      .mockResolvedValueOnce([{ item_id: '111' }, { item_id: '222' }])  // 2 products
      .mockResolvedValueOnce({ buttonCount: 2, productOrder: ['111', '222'] })
      .mockResolvedValueOnce(false)  // click 111: fails (clickOk=false)
      .mockResolvedValueOnce(true)   // click 222: ok
      .mockResolvedValueOnce('https://s.shopee.co.th/s222')  // shortLink for 222
      .mockResolvedValue(undefined);  // close modal

    const req = makeHttpReq();
    https.get.mockImplementation((url, opts, cb) => {
      const res = new EventEmitter();
      res.headers = { location: 'https://shopee.co.th/product/111/222' };
      res.resume  = jest.fn();
      cb(res);
      return req;
    });

    fs.existsSync.mockReturnValue(false);
    fs.readFileSync = jest.fn().mockReturnValue('');
    fs.writeFileSync.mockImplementation(() => {});

    const logSpy  = jest.spyOn(console, 'log').mockImplementation(() => {});
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    await main();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ดึงไม่ได้'));
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
  });
});

// ─── main(): catch in loop ────────────────────────────────────────────────────

describe('main(): page.evaluate throws in loop', () => {
  test('catches error and continues when click evaluate throws', async () => {
    mockPage.evaluate.mockReset();
    mockPage.evaluate
      .mockResolvedValueOnce([{ item_id: '111' }])  // scan
      .mockResolvedValueOnce({ buttonCount: 1, productOrder: ['111'] })  // buttons
      .mockRejectedValueOnce(new Error('evaluate-failed'));  // click throws

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    const errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy  = jest.spyOn(console, 'log').mockImplementation(() => {});
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    // results=[] after catch → exits with error
    await expect(main()).rejects.toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
  });
});

// ─── main(): no results → exit 1 ─────────────────────────────────────────────

describe('main(): no results obtained', () => {
  test('exits with error when no affiliate links were retrieved', async () => {
    mockPage.evaluate.mockReset();
    mockPage.evaluate
      .mockResolvedValueOnce([{ item_id: '111' }])
      .mockResolvedValueOnce({ buttonCount: 1, productOrder: ['111'] })
      .mockResolvedValueOnce(true)    // click ok
      .mockResolvedValueOnce(null)    // shortLink = null → skips
      .mockResolvedValue(undefined);

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    const errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    await expect(main()).rejects.toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
    stdoutSpy.mockRestore();
  });
});
