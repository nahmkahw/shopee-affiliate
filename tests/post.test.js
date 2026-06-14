'use strict';

// Set argv before any require so module-level arg parsing uses this date
process.argv = ['node', 'post.js', '2026-01-01'];

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('twitter-api-v2');
jest.mock('fs');
jest.mock('https');

const fs    = require('fs');
const https = require('https');
const path  = require('path');
const EventEmitter = require('events');
const { TwitterApi } = require('twitter-api-v2');

const {
  readContent,
  parseTweets,
  uploadImgBB,
  uploadPhotoFB,
  buildMultipart,
  httpsPost,
  postFacebook,
  postInstagram,
  postX,
  main,
} = require('../post.js');

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeRes(body) {
  const res = new EventEmitter();
  process.nextTick(() => {
    res.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    res.emit('end');
  });
  return res;
}

function stubHttpsRequest(body) {
  const req = new EventEmitter();
  req.write = jest.fn();
  req.end   = jest.fn();
  https.request.mockImplementation((opts, cb) => {
    if (cb) cb(makeRes(body));
    return req;
  });
  return req;
}

// Build a sequence of https.request responses (for multi-step flows)
function stubHttpsSequence(...bodies) {
  let call = 0;
  https.request.mockImplementation((opts, cb) => {
    const req = new EventEmitter();
    req.write = jest.fn();
    req.end   = jest.fn();
    const body = bodies[call] !== undefined ? bodies[call] : bodies[bodies.length - 1];
    call++;
    if (cb) cb(makeRes(body));
    return req;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.FB_PAGE_ID;
  delete process.env.FB_ACCESS_TOKEN;
  delete process.env.IG_USER_ID;
  delete process.env.IG_ACCESS_TOKEN;
  delete process.env.IMGBB_API_KEY;
  delete process.env.X_API_KEY;
  delete process.env.X_API_SECRET;
  delete process.env.X_ACCESS_TOKEN;
  delete process.env.X_ACCESS_TOKEN_SECRET;
  fs.existsSync.mockReturnValue(false);
  fs.readdirSync.mockReturnValue([]);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
  // Make all sleep() calls resolve immediately so tests don't time out
  jest.spyOn(global, 'setTimeout').mockImplementation((fn) => { fn(); return 0; });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── readContent ──────────────────────────────────────────────────────────────

describe('readContent', () => {
  test('returns null when file does not exist', () => {
    fs.existsSync.mockReturnValue(false);
    expect(readContent('123456789', 'facebook')).toBeNull();
  });

  test('returns trimmed content when file exists', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('  Hello World  ');
    expect(readContent('123456789', 'facebook')).toBe('Hello World');
  });

  test('calls existsSync with the correct path', () => {
    fs.existsSync.mockReturnValue(false);
    readContent('9876543210', 'instagram');
    expect(fs.existsSync).toHaveBeenCalledWith(
      path.join('products', '9876543210', 'content', 'instagram.md')
    );
  });
});

// ─── parseTweets ──────────────────────────────────────────────────────────────

describe('parseTweets', () => {
  test('returns content as single element when no tweet headings present', () => {
    const result = parseTweets('no tweets here');
    expect(result).toEqual(['no tweets here']);
  });

  test('parses single tweet section', () => {
    const result = parseTweets('### Tweet 1/1\nHello world #Shopeeaffiliate');
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Hello world #Shopeeaffiliate');
  });

  test('parses three tweet sections correctly', () => {
    const content = `### Tweet 1/3
First tweet
### Tweet 2/3
Second tweet
### Tweet 3/3
Third tweet https://s.shopee.co.th/abc`;
    const result = parseTweets(content);
    expect(result).toHaveLength(3);
    expect(result[0]).toContain('First tweet');
    expect(result[1]).toContain('Second tweet');
    expect(result[2]).toContain('Third tweet');
  });

  test('removes code blocks', () => {
    const result = parseTweets('### Tweet 1/1\n```\ncode block\n```\nReal text');
    expect(result[0]).not.toContain('code block');
    expect(result[0]).toContain('Real text');
  });

  test('filters out empty sections', () => {
    // Both tweet bodies are blank after trim → parseTweets should return []
    const result = parseTweets('### Tweet 1/2\n\n### Tweet 2/2\n');
    expect(result).toHaveLength(0);
  });
});

// ─── buildMultipart ───────────────────────────────────────────────────────────

describe('buildMultipart', () => {
  test('includes field values in output', () => {
    const body = buildMultipart({ published: 'false' }, [], 'bnd');
    expect(body.toString()).toContain('published');
    expect(body.toString()).toContain('false');
    expect(body.toString()).toContain('--bnd--');
  });

  test('includes file parts in output', () => {
    const body = buildMultipart(
      {},
      [{ name: 'source', filename: 'img.jpg', contentType: 'image/jpeg', data: Buffer.from('data') }],
      'bnd'
    );
    const str = body.toString();
    expect(str).toContain('source');
    expect(str).toContain('img.jpg');
    expect(str).toContain('image/jpeg');
  });

  test('handles multiple files', () => {
    const body = buildMultipart(
      {},
      [
        { name: 'f1', filename: 'a.jpg', contentType: 'image/jpeg', data: Buffer.from('a') },
        { name: 'f2', filename: 'b.jpg', contentType: 'image/jpeg', data: Buffer.from('b') },
      ],
      'bnd'
    );
    expect(body.toString()).toContain('f1');
    expect(body.toString()).toContain('f2');
  });
});

// ─── httpsPost helper ─────────────────────────────────────────────────────────

describe('httpsPost', () => {
  test('resolves with parsed JSON on success', async () => {
    stubHttpsRequest({ success: true });
    const result = await httpsPost('example.com', '/api', { data: 1 });
    expect(result).toEqual({ success: true });
  });

  test('resolves with raw string when response is not JSON', async () => {
    stubHttpsRequest('raw text response');
    const result = await httpsPost('example.com', '/api', '{}');
    expect(result).toBe('raw text response');
  });

  test('accepts string body directly', async () => {
    stubHttpsRequest({ ok: true });
    const result = await httpsPost('example.com', '/api', 'raw body');
    expect(result).toEqual({ ok: true });
  });

  test('rejects on network error', async () => {
    const req = new EventEmitter();
    req.write = jest.fn();
    req.end = jest.fn(() => process.nextTick(() => req.emit('error', new Error('net error'))));
    https.request.mockImplementation((opts, cb) => req);
    await expect(httpsPost('example.com', '/api', {})).rejects.toThrow('net error');
  });
});

// ─── uploadImgBB ─────────────────────────────────────────────────────────────

describe('uploadImgBB', () => {
  test('rejects immediately when IMGBB_API_KEY missing', async () => {
    delete process.env.IMGBB_API_KEY;
    await expect(uploadImgBB('/tmp/img.jpg')).rejects.toThrow('ขาด IMGBB_API_KEY');
  });

  test('resolves with URL on success', async () => {
    process.env.IMGBB_API_KEY = 'testkey';
    fs.readFileSync.mockReturnValue(Buffer.from('imagedata'));
    stubHttpsRequest({ success: true, data: { url: 'https://i.ibb.co/test.jpg' } });
    const url = await uploadImgBB('/tmp/img.jpg');
    expect(url).toBe('https://i.ibb.co/test.jpg');
  });

  test('rejects when API returns success=false', async () => {
    process.env.IMGBB_API_KEY = 'testkey';
    fs.readFileSync.mockReturnValue(Buffer.from('imagedata'));
    stubHttpsRequest({ success: false, error: { message: 'Bad key' } });
    await expect(uploadImgBB('/tmp/img.jpg')).rejects.toThrow('imgBB upload failed');
  });

  test('rejects on network error', async () => {
    process.env.IMGBB_API_KEY = 'testkey';
    fs.readFileSync.mockReturnValue(Buffer.from('imagedata'));
    const req = new EventEmitter();
    req.write = jest.fn();
    req.end = jest.fn(() => process.nextTick(() => req.emit('error', new Error('ECONNREFUSED'))));
    https.request.mockImplementation(() => req);
    await expect(uploadImgBB('/tmp/img.jpg')).rejects.toThrow('ECONNREFUSED');
  });

  test('rejects on unparseable response', async () => {
    process.env.IMGBB_API_KEY = 'testkey';
    fs.readFileSync.mockReturnValue(Buffer.from('imagedata'));
    stubHttpsRequest('not-json{{{');
    await expect(uploadImgBB('/tmp/img.jpg')).rejects.toThrow('imgBB response parse error');
  });
});

// ─── uploadPhotoFB ───────────────────────────────────────────────────────────

describe('uploadPhotoFB', () => {
  test('resolves with photo id on success', async () => {
    fs.readFileSync.mockReturnValue(Buffer.from('imgdata'));
    stubHttpsRequest({ id: 'photo_123' });
    const id = await uploadPhotoFB('/tmp/img.jpg', 'page1', 'token1');
    expect(id).toBe('photo_123');
  });

  test('throws when FB photo upload returns error', async () => {
    fs.readFileSync.mockReturnValue(Buffer.from('imgdata'));
    stubHttpsRequest({ error: { message: 'Upload failed' } });
    await expect(uploadPhotoFB('/tmp/img.jpg', 'page1', 'token1')).rejects.toThrow('FB photo upload: Upload failed');
  });
});

// ─── postFacebook ────────────────────────────────────────────────────────────

describe('postFacebook', () => {
  test('throws when FB_PAGE_ID missing', async () => {
    await expect(postFacebook('123456789')).rejects.toThrow('ขาด FB_PAGE_ID');
  });

  test('throws when FB_ACCESS_TOKEN missing', async () => {
    process.env.FB_PAGE_ID = 'page123';
    await expect(postFacebook('123456789')).rejects.toThrow('ขาด FB_PAGE_ID หรือ FB_ACCESS_TOKEN');
  });

  test('throws when content file not found', async () => {
    process.env.FB_PAGE_ID = 'page123';
    process.env.FB_ACCESS_TOKEN = 'tok123';
    fs.existsSync.mockReturnValue(false);
    await expect(postFacebook('123456789')).rejects.toThrow('ไม่พบ');
  });

  test('posts feed with no images when no large images exist', async () => {
    process.env.FB_PAGE_ID = 'page123';
    process.env.FB_ACCESS_TOKEN = 'tok123';
    fs.existsSync.mockImplementation(p => String(p).endsWith('facebook.md'));
    fs.readFileSync.mockReturnValue('Post content');
    fs.statSync.mockReturnValue({ size: 1024 }); // 1KB < 50KB → no images
    stubHttpsRequest({ id: 'post_abc' });
    const id = await postFacebook('123456789');
    expect(id).toBe('post_abc');
  });

  test('uploads images and posts with attached_media', async () => {
    process.env.FB_PAGE_ID = 'page123';
    process.env.FB_ACCESS_TOKEN = 'tok123';
    // facebook.md and 2.jpg both exist
    fs.existsSync.mockImplementation(p => {
      const ps = String(p);
      return ps.endsWith('facebook.md') || ps.endsWith('2.jpg');
    });
    // binary reads return Buffer, utf8 reads return string
    fs.readFileSync.mockImplementation((p, enc) => {
      if (enc === 'utf8') return 'Post content';
      return Buffer.from('imgdata');
    });
    fs.statSync.mockReturnValue({ size: 100 * 1024 }); // 100KB > 50KB
    // First https.request → photo upload, Second → feed post
    stubHttpsSequence(
      { id: 'photo_001' },  // uploadPhotoFB
      { id: 'post_abc' }    // feed post
    );
    const id = await postFacebook('123456789');
    expect(id).toBe('post_abc');
  });

  test('throws when FB API returns error', async () => {
    process.env.FB_PAGE_ID = 'page123';
    process.env.FB_ACCESS_TOKEN = 'tok123';
    fs.existsSync.mockImplementation(p => String(p).endsWith('facebook.md'));
    fs.readFileSync.mockReturnValue('content');
    fs.statSync.mockReturnValue({ size: 0 });
    stubHttpsRequest({ error: { message: 'Session has expired' } });
    await expect(postFacebook('123456789')).rejects.toThrow('Session has expired');
  });
});

// ─── postInstagram ────────────────────────────────────────────────────────────

describe('postInstagram', () => {
  test('throws when IG_USER_ID missing', async () => {
    await expect(postInstagram('123456789')).rejects.toThrow('ขาด IG_USER_ID');
  });

  test('throws when IG_ACCESS_TOKEN missing', async () => {
    process.env.IG_USER_ID = 'ig123';
    await expect(postInstagram('123456789')).rejects.toThrow('ขาด IG_USER_ID หรือ IG_ACCESS_TOKEN');
  });

  test('throws when instagram.md missing', async () => {
    process.env.IG_USER_ID = 'ig123';
    process.env.IG_ACCESS_TOKEN = 'igtoken';
    fs.existsSync.mockReturnValue(false);
    await expect(postInstagram('123456789')).rejects.toThrow('ไม่พบ products/');
  });

  test('throws when no images > 50KB found', async () => {
    process.env.IG_USER_ID = 'ig123';
    process.env.IG_ACCESS_TOKEN = 'igtoken';
    process.env.IMGBB_API_KEY = 'key';
    fs.existsSync.mockImplementation(p => String(p).endsWith('instagram.md'));
    fs.readFileSync.mockReturnValue('caption text');
    fs.statSync.mockReturnValue({ size: 100 }); // 100 bytes < 50KB
    await expect(postInstagram('123456789')).rejects.toThrow('ไม่พบรูปภาพ > 50 KB');
  });

  test('throws when IG media item creation fails', async () => {
    process.env.IG_USER_ID = 'ig123';
    process.env.IG_ACCESS_TOKEN = 'igtoken';
    process.env.IMGBB_API_KEY = 'key';
    fs.existsSync.mockImplementation(p => {
      const ps = String(p);
      return ps.endsWith('instagram.md') || ps.endsWith('2.jpg');
    });
    fs.readFileSync.mockReturnValue('caption');
    fs.statSync.mockReturnValue({ size: 100 * 1024 });
    // imgBB success, then IG create fails
    stubHttpsSequence(
      { success: true, data: { url: 'https://i.ibb.co/img.jpg' } },
      { error: { message: 'IG create failed' } }
    );
    await expect(postInstagram('123456789')).rejects.toThrow('IG media item error: IG create failed');
  });

  test('publishes carousel and returns published media id', async () => {
    process.env.IG_USER_ID = 'ig123';
    process.env.IG_ACCESS_TOKEN = 'igtoken';
    process.env.IMGBB_API_KEY = 'key';
    fs.existsSync.mockImplementation(p => {
      const ps = String(p);
      return ps.endsWith('instagram.md') || ps.endsWith('2.jpg');
    });
    // readFileSync: returns string for .md (with utf8), Buffer for images
    fs.readFileSync.mockImplementation((p, enc) => {
      if (enc === 'utf8' || (typeof p === 'string' && p.endsWith('.md'))) return 'caption text';
      return Buffer.from('imgdata');
    });
    fs.statSync.mockReturnValue({ size: 100 * 1024 });
    stubHttpsSequence(
      { success: true, data: { url: 'https://i.ibb.co/img.jpg' } }, // imgBB
      { id: 'media_item_1' },   // IG media item
      { id: 'carousel_1' },     // IG carousel
      { id: 'published_1' }     // IG publish
    );
    const id = await postInstagram('123456789');
    expect(id).toBe('published_1');
  });

  test('throws when carousel creation fails', async () => {
    process.env.IG_USER_ID = 'ig123';
    process.env.IG_ACCESS_TOKEN = 'igtoken';
    process.env.IMGBB_API_KEY = 'key';
    fs.existsSync.mockImplementation(p => {
      const ps = String(p);
      return ps.endsWith('instagram.md') || ps.endsWith('2.jpg');
    });
    fs.readFileSync.mockImplementation((p, enc) => {
      if (enc === 'utf8') return 'caption';
      return Buffer.from('imgdata');
    });
    fs.statSync.mockReturnValue({ size: 100 * 1024 });
    stubHttpsSequence(
      { success: true, data: { url: 'https://i.ibb.co/img.jpg' } },
      { id: 'media_item_1' },
      { error: { message: 'carousel error' } }
    );
    await expect(postInstagram('123456789')).rejects.toThrow('IG carousel error');
  });

  test('throws when publish fails', async () => {
    process.env.IG_USER_ID = 'ig123';
    process.env.IG_ACCESS_TOKEN = 'igtoken';
    process.env.IMGBB_API_KEY = 'key';
    fs.existsSync.mockImplementation(p => {
      const ps = String(p);
      return ps.endsWith('instagram.md') || ps.endsWith('2.jpg');
    });
    fs.readFileSync.mockImplementation((p, enc) => {
      if (enc === 'utf8') return 'caption';
      return Buffer.from('imgdata');
    });
    fs.statSync.mockReturnValue({ size: 100 * 1024 });
    stubHttpsSequence(
      { success: true, data: { url: 'https://i.ibb.co/img.jpg' } },
      { id: 'media_item_1' },
      { id: 'carousel_1' },
      { error: { message: 'publish error' } }
    );
    await expect(postInstagram('123456789')).rejects.toThrow('IG publish error');
  });
});

// ─── postX ───────────────────────────────────────────────────────────────────

describe('postX', () => {
  test('throws when X credentials missing', async () => {
    await expect(postX('123456789')).rejects.toThrow('ขาด X credentials');
  });

  test('throws when x.md missing', async () => {
    process.env.X_API_KEY = 'k';
    process.env.X_API_SECRET = 's';
    process.env.X_ACCESS_TOKEN = 'at';
    process.env.X_ACCESS_TOKEN_SECRET = 'ats';
    fs.existsSync.mockReturnValue(false);
    await expect(postX('123456789')).rejects.toThrow('ไม่พบ products/');
  });

  test('throws when content yields no tweets after parsing', async () => {
    process.env.X_API_KEY = 'k';
    process.env.X_API_SECRET = 's';
    process.env.X_ACCESS_TOKEN = 'at';
    process.env.X_ACCESS_TOKEN_SECRET = 'ats';
    fs.existsSync.mockReturnValue(true);
    // tweet headers with empty bodies → parseTweets returns []
    fs.readFileSync.mockReturnValue('### Tweet 1/2\n\n### Tweet 2/2\n');
    await expect(postX('123456789')).rejects.toThrow('parse x.md ไม่พบ tweet ใดเลย');
  });

  test('posts tweet thread and returns last id', async () => {
    process.env.X_API_KEY = 'k';
    process.env.X_API_SECRET = 's';
    process.env.X_ACCESS_TOKEN = 'at';
    process.env.X_ACCESS_TOKEN_SECRET = 'ats';
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('### Tweet 1/2\nFirst\n### Tweet 2/2\nSecond');

    const mockTweet = jest.fn()
      .mockResolvedValueOnce({ data: { id: 'tweet1' } })
      .mockResolvedValueOnce({ data: { id: 'tweet2' } });
    TwitterApi.mockImplementation(() => ({
      readWrite: { v2: { tweet: mockTweet } },
    }));

    const id = await postX('123456789');
    expect(id).toBe('tweet2');
    expect(mockTweet).toHaveBeenCalledTimes(2);
    expect(mockTweet.mock.calls[1][0]).toMatchObject({
      reply: { in_reply_to_tweet_id: 'tweet1' },
    });
  });

  test('posts single tweet and returns its id', async () => {
    process.env.X_API_KEY = 'k';
    process.env.X_API_SECRET = 's';
    process.env.X_ACCESS_TOKEN = 'at';
    process.env.X_ACCESS_TOKEN_SECRET = 'ats';
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('### Tweet 1/1\nOnly tweet #Shopeeaffiliate');

    const mockTweet = jest.fn().mockResolvedValueOnce({ data: { id: 'single1' } });
    TwitterApi.mockImplementation(() => ({
      readWrite: { v2: { tweet: mockTweet } },
    }));

    const id = await postX('123456789');
    expect(id).toBe('single1');
    expect(mockTweet.mock.calls[0][0]).not.toHaveProperty('reply');
  });
});

// ─── main() integration ───────────────────────────────────────────────────────

describe('main()', () => {
  let exitSpy;
  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
      throw Object.assign(new Error(`EXIT_${code}`), { exitCode: code });
    });
  });
  afterEach(() => exitSpy.mockRestore());

  test('exits(1) when products directory does not exist', async () => {
    fs.existsSync.mockReturnValue(false);
    await expect(main()).rejects.toThrow('EXIT_1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('exits(1) when no products match the given date', async () => {
    fs.existsSync.mockImplementation(p => {
      const ps = String(p);
      return ps === 'products' || ps.endsWith('data.json');
    });
    fs.readdirSync.mockReturnValue(['123456789']);
    fs.readFileSync.mockReturnValue(JSON.stringify({ post_date: '2025-01-01', status: 'scraped' }));
    await expect(main()).rejects.toThrow('EXIT_1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('skips items with malformed data.json without crashing', async () => {
    fs.existsSync.mockImplementation(p => {
      const ps = String(p);
      return ps === 'products' || ps.endsWith('data.json');
    });
    fs.readdirSync.mockReturnValue(['123456789']);
    fs.readFileSync.mockReturnValue('INVALID_JSON{{');
    await expect(main()).rejects.toThrow('EXIT_1');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('ไม่พบสินค้า'));
  });

  test('posts to FB and updates status on success', async () => {
    process.env.FB_PAGE_ID   = 'page1';
    process.env.FB_ACCESS_TOKEN = 'tok1';
    // products dir exists, one matching product
    fs.existsSync.mockImplementation(p => {
      const ps = String(p);
      return ps === 'products' || ps.endsWith('data.json') || ps.endsWith('facebook.md');
    });
    fs.readdirSync.mockReturnValue(['123456789']);
    const dataJson = JSON.stringify({ post_date: '2026-01-01', status: 'draft', title: 'Test product', item_id: '123456789' });
    fs.readFileSync.mockReturnValue(dataJson);
    fs.statSync.mockReturnValue({ size: 0 });
    fs.writeFileSync.mockImplementation(() => {});
    stubHttpsRequest({ id: 'fb_post_1' });

    await main();

    expect(fs.writeFileSync).toHaveBeenCalled();
    const writeCall = fs.writeFileSync.mock.calls[0];
    const written = JSON.parse(writeCall[1]);
    expect(written.status).toBe('posted');
    expect(written.posted_platforms).toContain('fb');
  });

  test('handles FB post failure gracefully and continues', async () => {
    process.env.FB_PAGE_ID   = 'page1';
    process.env.FB_ACCESS_TOKEN = 'tok1';
    fs.existsSync.mockImplementation(p => {
      const ps = String(p);
      return ps === 'products' || ps.endsWith('data.json') || ps.endsWith('facebook.md');
    });
    fs.readdirSync.mockReturnValue(['123456789']);
    fs.readFileSync.mockReturnValue(JSON.stringify({ post_date: '2026-01-01', status: 'draft', title: 'Test', item_id: '123456789' }));
    fs.statSync.mockReturnValue({ size: 0 });
    stubHttpsRequest({ error: { message: 'API error' } });

    // Should not throw — errors are caught per-platform
    await main();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('❌ Facebook'));
  });

  test('does not update status when all platforms fail', async () => {
    process.env.FB_PAGE_ID   = 'page1';
    process.env.FB_ACCESS_TOKEN = 'tok1';
    fs.existsSync.mockImplementation(p => {
      const ps = String(p);
      return ps === 'products' || ps.endsWith('data.json') || ps.endsWith('facebook.md');
    });
    fs.readdirSync.mockReturnValue(['123456789']);
    fs.readFileSync.mockReturnValue(JSON.stringify({ post_date: '2026-01-01', status: 'draft', title: 'Test', item_id: '123456789' }));
    fs.statSync.mockReturnValue({ size: 0 });
    stubHttpsRequest({ error: { message: 'API error' } });

    await main();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  test('shows warning when status update write fails', async () => {
    process.env.FB_PAGE_ID   = 'page1';
    process.env.FB_ACCESS_TOKEN = 'tok1';
    fs.existsSync.mockImplementation(p => {
      const ps = String(p);
      return ps === 'products' || ps.endsWith('data.json') || ps.endsWith('facebook.md');
    });
    fs.readdirSync.mockReturnValue(['123456789']);
    const data = JSON.stringify({ post_date: '2026-01-01', status: 'draft', title: 'Test', item_id: '123456789' });
    fs.readFileSync.mockReturnValue(data);
    fs.statSync.mockReturnValue({ size: 0 });
    fs.writeFileSync.mockImplementation(() => { throw new Error('disk full'); });
    stubHttpsRequest({ id: 'post_ok' });

    await main();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('บันทึก status ไม่ได้'));
  });

  test('shows TikTok note when tiktok.md exists for a product', async () => {
    process.env.FB_PAGE_ID   = 'page1';
    process.env.FB_ACCESS_TOKEN = 'tok1';
    fs.existsSync.mockImplementation(p => {
      const ps = String(p);
      // products dir, data.json, facebook.md, AND tiktok.md exist
      return ps === 'products' || ps.endsWith('data.json') || ps.endsWith('facebook.md') || ps.endsWith('tiktok.md');
    });
    fs.readdirSync.mockReturnValue(['123456789']);
    fs.readFileSync.mockReturnValue(JSON.stringify({ post_date: '2026-01-01', status: 'draft', title: 'Test' }));
    fs.statSync.mockReturnValue({ size: 0 });
    fs.writeFileSync.mockImplementation(() => {});
    stubHttpsRequest({ id: 'post_ok' });

    await main();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('TikTok'));
  });

  test('posts to Instagram successfully in main', async () => {
    process.env.IG_USER_ID    = 'ig123';
    process.env.IG_ACCESS_TOKEN = 'igtoken';
    process.env.IMGBB_API_KEY   = 'imgbbkey';
    fs.existsSync.mockImplementation(p => {
      const ps = String(p);
      return ps === 'products' || ps.endsWith('data.json') || ps.endsWith('instagram.md') || ps.endsWith('2.jpg');
    });
    fs.readdirSync.mockReturnValue(['123456789']);
    fs.readFileSync.mockImplementation((p, enc) => {
      const ps = String(p);
      if (ps.endsWith('data.json')) return JSON.stringify({ post_date: '2026-01-01', status: 'draft', title: 'Test' });
      if (enc === 'utf8') return 'IG caption content';
      return Buffer.from('imgdata');
    });
    fs.statSync.mockReturnValue({ size: 100 * 1024 });
    fs.writeFileSync.mockImplementation(() => {});
    stubHttpsSequence(
      { success: true, data: { url: 'https://i.ibb.co/img.jpg' } }, // imgBB
      { id: 'media_item_1' },   // IG media item
      { id: 'carousel_1' },     // IG carousel
      { id: 'published_1' }     // IG publish
    );

    await main();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ Instagram'));
  });

  test('posts to X successfully in main', async () => {
    process.env.X_API_KEY           = 'k';
    process.env.X_API_SECRET        = 's';
    process.env.X_ACCESS_TOKEN      = 'at';
    process.env.X_ACCESS_TOKEN_SECRET = 'ats';
    fs.existsSync.mockImplementation(p => {
      const ps = String(p);
      return ps === 'products' || ps.endsWith('data.json') || ps.endsWith('x.md');
    });
    fs.readdirSync.mockReturnValue(['123456789']);
    fs.readFileSync.mockImplementation((p, enc) => {
      const ps = String(p);
      if (ps.endsWith('data.json')) return JSON.stringify({ post_date: '2026-01-01', status: 'draft', title: 'Test' });
      return '### Tweet 1/1\nHello #Shopeeaffiliate https://s.shopee.co.th/abc';
    });
    fs.writeFileSync.mockImplementation(() => {});

    const mockTweet = jest.fn().mockResolvedValueOnce({ data: { id: 'tweet1' } });
    TwitterApi.mockImplementation(() => ({
      readWrite: { v2: { tweet: mockTweet } },
    }));

    await main();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ X'));
  });
});

// ─── Module-level arg parsing (isolateModules) ────────────────────────────────

describe('module-level arg parsing via isolateModules', () => {
  // Helper: load a fresh copy of post.js with given argv
  function loadWithArgv(argv) {
    let mod;
    process.argv = argv;
    jest.isolateModules(() => {
      mod = require('../post.js');
    });
    process.argv = ['node', 'post.js', '2026-01-01']; // restore
    return mod;
  }

  test('--platform=fb,ig format (branch: includes("="))', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
      throw Object.assign(new Error(`EXIT_${code}`), { exitCode: code });
    });
    fs.existsSync.mockReturnValue(false);
    const mod = loadWithArgv(['node', 'post.js', '2026-01-01', '--platform=fb,ig']);
    // products dir not found → exits with 1, but platforms was parsed
    await expect(mod.main()).rejects.toThrow('EXIT_1');
    exitSpy.mockRestore();
  });

  test('--platform fb,ig format (branch: separate arg)', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
      throw Object.assign(new Error(`EXIT_${code}`), { exitCode: code });
    });
    fs.existsSync.mockReturnValue(false);
    const mod = loadWithArgv(['node', 'post.js', '2026-01-01', '--platform', 'fb,ig']);
    await expect(mod.main()).rejects.toThrow('EXIT_1');
    exitSpy.mockRestore();
  });

  test('no date and no item_id → exits with error message', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
      throw Object.assign(new Error(`EXIT_${code}`), { exitCode: code });
    });
    const mod = loadWithArgv(['node', 'post.js']); // no date, no item_id
    await expect(mod.main()).rejects.toThrow('EXIT_1');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('ระบุวันที่หรือ item_id'));
    exitSpy.mockRestore();
  });

  test('--platform with no value → empty platforms → exits with error', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
      throw Object.assign(new Error(`EXIT_${code}`), { exitCode: code });
    });
    const mod = loadWithArgv(['node', 'post.js', '2026-01-01', '--platform']);
    await expect(mod.main()).rejects.toThrow('EXIT_1');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--platform'));
    exitSpy.mockRestore();
  });

  test('item_id arg (no date) → uses itemIdArg filter path', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
      throw Object.assign(new Error(`EXIT_${code}`), { exitCode: code });
    });
    fs.existsSync.mockImplementation(p => {
      const ps = String(p);
      return ps === 'products' || ps.endsWith('data.json');
    });
    fs.readdirSync.mockReturnValue(['123456789']);
    // data.json with item_id but no post_date match needed (we use itemIdArg)
    fs.readFileSync.mockReturnValue(JSON.stringify({ item_id: '123456789', post_date: '2026-01-01', status: 'draft', title: 'T' }));
    const mod = loadWithArgv(['node', 'post.js', '123456789']); // item_id not date
    // Will try to post but no platform credentials → fails gracefully
    await mod.main();
    exitSpy.mockRestore();
  });
});
