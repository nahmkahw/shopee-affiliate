'use strict';

jest.mock('playwright');
jest.mock('fs');
jest.mock('https');

const fs    = require('fs');
const https = require('https');
const path  = require('path');
const { EventEmitter } = require('events');

// ─── playwright mock setup ────────────────────────────────────────────────────

const mockPage = {
  goto:            jest.fn().mockResolvedValue(undefined),
  waitForFunction: jest.fn().mockResolvedValue(undefined),
  waitForTimeout:  jest.fn().mockResolvedValue(undefined),
  evaluate:        jest.fn().mockResolvedValue({
    title: 'Test Product', price: '฿100', original_price: null,
    discount: null, rating: '4.5', shop_name: 'TestShop',
    description: 'desc', images: ['https://img.example.com/1.jpg'], reviews: [],
  }),
  keyboard: { press: jest.fn().mockResolvedValue(undefined) },
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

function makeWriteStream() {
  const ws = new EventEmitter();
  ws.close = jest.fn();
  return ws;
}

function makeHttpReq() {
  const req = new EventEmitter();
  req.destroy    = jest.fn();
  req.setTimeout = jest.fn((ms, cb) => { req._timeoutCb = cb; return req; });
  req.end        = jest.fn();
  return req;
}

function makeHttpRes() {
  const res = new EventEmitter();
  res.pipe   = jest.fn();
  res.resume = jest.fn();
  return res;
}

// ─── load the module once (isForce / isDryRun captured from default argv) ────

const { parseUrlsFile, downloadImage, downloadImages, main } = require('../scrape');

// ─── reset mocks between tests ────────────────────────────────────────────────

beforeEach(() => {
  jest.resetAllMocks();

  // Re-establish playwright mock after reset
  mockBrowser.contexts.mockReturnValue([mockCtx]);
  mockBrowser.close.mockResolvedValue(undefined);
  mockCtx.pages.mockReturnValue([mockPage]);
  mockPage.goto.mockResolvedValue(undefined);
  mockPage.waitForFunction.mockResolvedValue(undefined);
  mockPage.waitForTimeout.mockResolvedValue(undefined);
  mockPage.evaluate.mockResolvedValue({
    title: 'Test Product', price: '฿100', original_price: null,
    discount: null, rating: '4.5', shop_name: 'TestShop',
    description: 'desc', images: ['https://img.example.com/1.jpg'], reviews: [],
  });
  require('playwright').chromium.connectOverCDP.mockResolvedValue(mockBrowser);
});

// ─── parseUrlsFile ────────────────────────────────────────────────────────────

describe('parseUrlsFile', () => {
  test('parses valid 3-column line correctly', () => {
    fs.readFileSync.mockReturnValue(
      'https://shopee.co.th/product/111/222 | https://s.shopee.co.th/abc | 2026-06-15\n'
    );
    const result = parseUrlsFile('/fake/urls.txt');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      shop_id: '111', item_id: '222',
      short: 'https://s.shopee.co.th/abc', post_date: '2026-06-15',
      product_url: 'https://shopee.co.th/product/111/222',
    });
  });

  test('skips comment lines and empty lines', () => {
    fs.readFileSync.mockReturnValue(
      '# this is a comment\n\nhttps://shopee.co.th/product/111/222 | | 2026-06-15\n'
    );
    const result = parseUrlsFile('/fake/urls.txt');
    expect(result).toHaveLength(1);
  });

  test('uses today as post_date when date column is missing', () => {
    fs.readFileSync.mockReturnValue(
      'https://shopee.co.th/product/111/222 | https://s.shopee.co.th/abc\n'
    );
    const today = new Date().toISOString().split('T')[0];
    const result = parseUrlsFile('/fake/urls.txt');
    expect(result[0].post_date).toBe(today);
  });

  test('uses today when date column has invalid format', () => {
    fs.readFileSync.mockReturnValue(
      'https://shopee.co.th/product/111/222 | | not-a-date\n'
    );
    const today = new Date().toISOString().split('T')[0];
    const result = parseUrlsFile('/fake/urls.txt');
    expect(result[0].post_date).toBe(today);
  });

  test('sets short to null when short column is empty', () => {
    fs.readFileSync.mockReturnValue(
      'https://shopee.co.th/product/111/222 | | 2026-06-15\n'
    );
    const result = parseUrlsFile('/fake/urls.txt');
    expect(result[0].short).toBeNull();
  });

  test('warns and filters out lines with unparseable URLs', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    fs.readFileSync.mockReturnValue('https://example.com/not-shopee | | 2026-06-15\n');
    const result = parseUrlsFile('/fake/urls.txt');
    expect(result).toHaveLength(0);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('parse URL ไม่ได้'));
    consoleSpy.mockRestore();
  });

  test('returns multiple items from multiple lines', () => {
    fs.readFileSync.mockReturnValue(
      'https://shopee.co.th/product/111/222 | | 2026-06-15\n' +
      'https://shopee.co.th/product/333/444 | | 2026-06-16\n'
    );
    const result = parseUrlsFile('/fake/urls.txt');
    expect(result).toHaveLength(2);
    expect(result[1].item_id).toBe('444');
  });
});

// ─── downloadImage ────────────────────────────────────────────────────────────

describe('downloadImage', () => {
  test('resolves on successful download', async () => {
    const ws  = makeWriteStream();
    const res = makeHttpRes();
    const req = makeHttpReq();

    fs.createWriteStream.mockReturnValue(ws);
    https.get.mockImplementation((url, cb) => {
      cb(res);
      process.nextTick(() => ws.emit('finish'));
      return req;
    });

    await expect(downloadImage('https://img.example.com/1.jpg', '/tmp/1.jpg')).resolves.toBeUndefined();
  });

  test('rejects and unlinks on request error', async () => {
    const ws  = makeWriteStream();
    const req = makeHttpReq();

    fs.createWriteStream.mockReturnValue(ws);
    fs.unlink.mockImplementation((p, cb) => cb && cb());
    https.get.mockImplementation(() => {
      process.nextTick(() => req.emit('error', new Error('ECONNREFUSED')));
      return req;
    });

    await expect(downloadImage('https://img.example.com/1.jpg', '/tmp/1.jpg')).rejects.toThrow('ECONNREFUSED');
    expect(fs.unlink).toHaveBeenCalledWith('/tmp/1.jpg', expect.any(Function));
  });

  test('rejects with timeout error and destroys request', async () => {
    const ws  = makeWriteStream();
    const req = makeHttpReq();

    fs.createWriteStream.mockReturnValue(ws);
    fs.unlink.mockImplementation((p, cb) => cb && cb());
    https.get.mockImplementation(() => {
      process.nextTick(() => { if (req._timeoutCb) req._timeoutCb(); });
      return req;
    });

    await expect(downloadImage('https://img.example.com/1.jpg', '/tmp/1.jpg')).rejects.toThrow('timeout');
    expect(req.destroy).toHaveBeenCalled();
    expect(fs.unlink).toHaveBeenCalled();
  });
});

// ─── downloadImages ───────────────────────────────────────────────────────────

describe('downloadImages', () => {
  test('returns count of successfully downloaded images', async () => {
    const ws  = makeWriteStream();
    const res = makeHttpRes();
    const req = makeHttpReq();

    fs.createWriteStream.mockReturnValue(ws);
    https.get.mockImplementation((url, cb) => {
      cb(res);
      process.nextTick(() => ws.emit('finish'));
      return req;
    });

    const n = await downloadImages(['https://a.com/1.jpg', 'https://a.com/2.jpg'], '/dir');
    expect(n).toBe(2);
  });

  test('skips failed images and counts only successes', async () => {
    const ws  = makeWriteStream();
    const req = makeHttpReq();
    let call  = 0;

    fs.createWriteStream.mockReturnValue(ws);
    fs.unlink.mockImplementation((p, cb) => cb && cb());
    https.get.mockImplementation((url, cb) => {
      call++;
      if (call === 1) {
        const res = makeHttpRes();
        cb(res);
        process.nextTick(() => ws.emit('finish'));
      } else {
        process.nextTick(() => req.emit('error', new Error('fail')));
      }
      return req;
    });

    const n = await downloadImages(['https://ok.com/1.jpg', 'https://fail.com/2.jpg'], '/dir');
    expect(n).toBe(1);
  });

  test('returns 0 for empty image list', async () => {
    const n = await downloadImages([], '/dir');
    expect(n).toBe(0);
  });
});

// ─── main(): urls.txt missing ─────────────────────────────────────────────────

describe('main(): missing urls.txt', () => {
  test('logs error and exits when urls.txt does not exist', async () => {
    fs.existsSync.mockReturnValue(false);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    const errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(main()).rejects.toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});

// ─── main(): no pending (all already scraped) ─────────────────────────────────

describe('main(): all products already scraped', () => {
  test('returns early without Chrome when pending is empty', async () => {
    // Both urls.txt and data.json exist → pending = []
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      'https://shopee.co.th/product/111/222 | https://s.shopee.co.th/abc | 2026-06-15\n'
    );
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await main();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ไม่มีสินค้าที่ต้องดึง'));
    expect(require('playwright').chromium.connectOverCDP).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});

// ─── main(): Chrome connect fails ─────────────────────────────────────────────

describe('main(): Chrome connect failure', () => {
  test('logs error and exits when Chrome debug port is unavailable', async () => {
    fs.existsSync.mockImplementation(p => String(p).endsWith('urls.txt'));
    fs.readFileSync.mockReturnValue(
      'https://shopee.co.th/product/111/222 | | 2026-06-15\n'
    );

    require('playwright').chromium.connectOverCDP.mockRejectedValueOnce(new Error('ECONNREFUSED 9222'));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    const errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(main()).rejects.toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});

// ─── main(): no browser context ───────────────────────────────────────────────

describe('main(): browser has no contexts', () => {
  test('logs error and exits when browser.contexts() is empty', async () => {
    fs.existsSync.mockImplementation(p => String(p).endsWith('urls.txt'));
    fs.readFileSync.mockReturnValue(
      'https://shopee.co.th/product/111/222 | | 2026-06-15\n'
    );
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

// ─── main(): context has no pages ─────────────────────────────────────────────

describe('main(): context has no pages', () => {
  test('logs error and exits when ctx.pages() is empty', async () => {
    fs.existsSync.mockImplementation(p => String(p).endsWith('urls.txt'));
    fs.readFileSync.mockReturnValue(
      'https://shopee.co.th/product/111/222 | | 2026-06-15\n'
    );
    mockCtx.pages.mockReturnValue([]);

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    const errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(main()).rejects.toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});

// ─── main(): successful scrape ────────────────────────────────────────────────

describe('main(): successful product scrape', () => {
  test('writes data.json and counts success', async () => {
    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      if (s.endsWith('urls.txt')) return true;
      return false;
    });
    fs.readFileSync.mockReturnValue(
      'https://shopee.co.th/product/111/222 | https://s.shopee.co.th/abc | 2026-06-15\n'
    );
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});

    const ws  = makeWriteStream();
    const res = makeHttpRes();
    const req = makeHttpReq();
    fs.createWriteStream.mockReturnValue(ws);
    https.get.mockImplementation((url, cb) => {
      cb(res);
      process.nextTick(() => ws.emit('finish'));
      return req;
    });

    mockPage.evaluate.mockResolvedValue({
      title: 'Awesome Product', price: '฿500', original_price: '฿700',
      discount: '28%', rating: '4.8', shop_name: 'TopShop',
      description: 'Great product', images: ['https://img.co/1.jpg'], reviews: [],
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await main();
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('data.json'), expect.stringContaining('"item_id": "222"'), 'utf8'
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('เสร็จสิ้น'));
    logSpy.mockRestore();
  });

  test('counts error when page.goto throws', async () => {
    fs.existsSync.mockImplementation(p => String(p).endsWith('urls.txt'));
    fs.readFileSync.mockReturnValue(
      'https://shopee.co.th/product/111/222 | | 2026-06-15\n'
    );
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});

    mockPage.goto.mockRejectedValueOnce(new Error('navigation timeout'));

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await main();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('navigation timeout'));
    logSpy.mockRestore();
  });

  test('scrapes a product with null title (partial status)', async () => {
    fs.existsSync.mockImplementation(p => String(p).endsWith('urls.txt'));
    fs.readFileSync.mockReturnValue(
      'https://shopee.co.th/product/111/222 | | 2026-06-15\n'
    );
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});

    // empty/null title → status 'partial'
    mockPage.evaluate.mockResolvedValue({
      title: '', price: null, original_price: null,
      discount: null, rating: null, shop_name: null,
      description: null, images: [], reviews: [],
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await main();
    const savedData = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(savedData.status).toBe('partial');
    logSpy.mockRestore();
  });
});

// ─── main(): dry-run via opts param ──────────────────────────────────────────

describe('main(): dry-run mode', () => {
  test('returns early and does not connect Chrome when dryRun=true', async () => {
    fs.existsSync.mockImplementation(p => String(p).endsWith('urls.txt'));
    fs.readFileSync.mockReturnValue(
      'https://shopee.co.th/product/111/222 | | 2026-06-15\n'
    );
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await main({ dryRun: true });
    expect(require('playwright').chromium.connectOverCDP).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Dry-run'));
    logSpy.mockRestore();
  });
});

// ─── main(): --force via opts param ──────────────────────────────────────────

describe('main(): force mode', () => {
  test('scrapes all products even when data.json exists when force=true', async () => {
    // Both urls.txt and data.json exist — without force, would skip
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      'https://shopee.co.th/product/111/222 | | 2026-06-15\n'
    );
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});

    mockPage.evaluate.mockResolvedValue({
      title: 'Forced Product', price: '฿200', original_price: null,
      discount: null, rating: null, shop_name: 'S',
      description: null, images: [], reviews: [],
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await main({ force: true });
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('เสร็จสิ้น'));
    logSpy.mockRestore();
  });
});
