'use strict';
jest.mock('http');
jest.mock('crypto');

const http   = require('http');
const crypto = require('crypto');
const EventEmitter = require('events');

// Helper to simulate http.request / http.get responses
function mockHttpRequest(statusCode, body, isBuffer = false) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.headers    = { 'content-type': 'image/png' };

  const req = new EventEmitter();
  req.write = jest.fn();
  req.end   = jest.fn(() => {
    process.nextTick(() => {
      res.emit('data', isBuffer ? Buffer.from(body) : body);
      res.emit('end');
    });
  });

  http.request.mockImplementation((opts, cb) => { cb(res); return req; });
  return req;
}

function mockHttpGet(statusCode, body, isBuffer = false) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.headers    = { 'content-type': 'image/png' };

  http.get.mockImplementation((opts, cb) => {
    const req = new EventEmitter();
    req.on = jest.fn();
    process.nextTick(() => {
      res.emit('data', isBuffer ? Buffer.from(body) : body);
      res.emit('end');
    });
    cb(res);
    return req;
  });
}

const comfy = require('../agent-hub/comfy');
beforeEach(() => {
  jest.clearAllMocks();
});

// ─── constants ───────────────────────────────────────────────────────────────

describe('constants', () => {
  test('NEG_PROMPT is a non-empty string', () => {
    expect(typeof comfy.NEG_PROMPT).toBe('string');
    expect(comfy.NEG_PROMPT.length).toBeGreaterThan(10);
  });

  test('OUTFIT_PROMPTS has expected keys', () => {
    expect(comfy.OUTFIT_PROMPTS).toHaveProperty('นักเรียน');
    expect(comfy.OUTFIT_PROMPTS).toHaveProperty('ออฟฟิศ');
    const entry = comfy.OUTFIT_PROMPTS['นักเรียน'];
    expect(entry).toHaveProperty('f');
    expect(entry).toHaveProperty('m');
  });

  test('GENDER_BASE has f and m keys', () => {
    expect(comfy.GENDER_BASE).toHaveProperty('f');
    expect(comfy.GENDER_BASE).toHaveProperty('m');
  });
});

// ─── buildComfyWorkflow ───────────────────────────────────────────────────────

describe('buildComfyWorkflow', () => {
  test('returns object with nodes 1-7', () => {
    const w = comfy.buildComfyWorkflow('cute cat', 42, 'localhost', 8188);
    expect(Object.keys(w)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  });

  test('node 5 uses the provided seed', () => {
    const w = comfy.buildComfyWorkflow('cute cat', 99, 'localhost', 8188);
    expect(w['5'].inputs.seed).toBe(99);
  });

  test('node 2 uses positivePrompt', () => {
    const w = comfy.buildComfyWorkflow('test prompt', 1, 'localhost', 8188);
    expect(w['2'].inputs.text).toBe('test prompt');
  });

  test('node 3 uses NEG_PROMPT', () => {
    const w = comfy.buildComfyWorkflow('test', 1, 'localhost', 8188);
    expect(w['3'].inputs.text).toBe(comfy.NEG_PROMPT);
  });
});

// ─── comfyPost ───────────────────────────────────────────────────────────────

describe('comfyPost', () => {
  test('sends POST and resolves parsed JSON', async () => {
    mockHttpRequest(200, JSON.stringify({ ok: true }));
    const result = await comfy.comfyPost('localhost', 8188, '/prompt', { data: 1 });
    expect(result).toEqual({ ok: true });
    expect(http.request).toHaveBeenCalled();
  });

  test('rejects when response is not valid JSON', async () => {
    mockHttpRequest(200, 'not-json');
    await expect(comfy.comfyPost('localhost', 8188, '/prompt', {})).rejects.toThrow();
  });

  test('rejects on network error', async () => {
    const req = new EventEmitter();
    req.write = jest.fn();
    req.end   = jest.fn();
    http.request.mockImplementation((opts, cb) => req);
    const promise = comfy.comfyPost('localhost', 8188, '/prompt', {});
    req.emit('error', new Error('ECONNREFUSED'));
    await expect(promise).rejects.toThrow('ECONNREFUSED');
  });
});

// ─── comfyGet ────────────────────────────────────────────────────────────────

describe('comfyGet', () => {
  test('resolves parsed JSON from GET', async () => {
    mockHttpGet(200, JSON.stringify({ status: 'ok' }));
    const result = await comfy.comfyGet('localhost', 8188, '/history/abc');
    expect(result).toEqual({ status: 'ok' });
  });

  test('rejects on invalid JSON', async () => {
    mockHttpGet(200, 'garbage');
    await expect(comfy.comfyGet('localhost', 8188, '/history/abc')).rejects.toThrow();
  });

  test('rejects on network error', async () => {
    const req = new EventEmitter();
    http.get.mockImplementation((opts, cb) => {
      process.nextTick(() => req.emit('error', new Error('ECONNREFUSED')));
      return req;
    });
    await expect(comfy.comfyGet('localhost', 8188, '/path')).rejects.toThrow('ECONNREFUSED');
  });
});

// ─── comfyGetBinary ──────────────────────────────────────────────────────────

describe('comfyGetBinary', () => {
  test('resolves Buffer and contentType', async () => {
    mockHttpGet(200, 'binary-data', true);
    const result = await comfy.comfyGetBinary('localhost', 8188, '/view?f=img.png');
    expect(Buffer.isBuffer(result.data)).toBe(true);
    expect(result.contentType).toBe('image/png');
  });

  test('falls back to image/png when content-type header is missing', async () => {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers    = {}; // no content-type
    http.get.mockImplementation((opts, cb) => {
      const req = new EventEmitter();
      process.nextTick(() => { res.emit('data', Buffer.from('x')); res.emit('end'); });
      cb(res);
      return req;
    });
    const result = await comfy.comfyGetBinary('localhost', 8188, '/view');
    expect(result.contentType).toBe('image/png');
  });
});

// ─── submitComfyJob ──────────────────────────────────────────────────────────

describe('submitComfyJob', () => {
  test('posts workflow and returns prompt_id', async () => {
    crypto.randomUUID = jest.fn().mockReturnValue('uuid-1234');
    mockHttpRequest(200, JSON.stringify({ prompt_id: 'pid-abc' }));
    const id = await comfy.submitComfyJob('localhost', 8188, 'anime girl');
    expect(id).toBe('pid-abc');
  });
});

// ─── getComfyJobResult ───────────────────────────────────────────────────────

describe('getComfyJobResult', () => {
  test('returns pending when history is empty', async () => {
    mockHttpGet(200, JSON.stringify({}));
    const r = await comfy.getComfyJobResult('localhost', 8188, 'pid-abc');
    expect(r.status).toBe('pending');
  });

  test('returns error when job has error status', async () => {
    const history = { 'pid-abc': { status: { status_str: 'error' }, outputs: {} } };
    mockHttpGet(200, JSON.stringify(history));
    const r = await comfy.getComfyJobResult('localhost', 8188, 'pid-abc');
    expect(r.status).toBe('error');
  });

  test('returns pending when outputs node 7 not ready', async () => {
    const history = { 'pid-abc': { outputs: {} } };
    mockHttpGet(200, JSON.stringify(history));
    const r = await comfy.getComfyJobResult('localhost', 8188, 'pid-abc');
    expect(r.status).toBe('pending');
  });

  test('returns done with image info when node 7 has images', async () => {
    const history = {
      'pid-abc': {
        outputs: {
          '7': { images: [{ filename: 'agentavatar_00001.png', subfolder: '', type: 'output' }] },
        },
      },
    };
    mockHttpGet(200, JSON.stringify(history));
    const r = await comfy.getComfyJobResult('localhost', 8188, 'pid-abc');
    expect(r.status).toBe('done');
    expect(r.filename).toBe('agentavatar_00001.png');
    expect(r.viewUrl).toContain('/api/comfy-image');
  });

  test('uses default empty string for missing subfolder/type', async () => {
    const history = {
      'pid-xyz': {
        outputs: {
          '7': { images: [{ filename: 'img.png' }] }, // no subfolder, no type
        },
      },
    };
    mockHttpGet(200, JSON.stringify(history));
    const r = await comfy.getComfyJobResult('localhost', 8188, 'pid-xyz');
    expect(r.status).toBe('done');
    expect(r.subfolder).toBe('');
    expect(r.type).toBe('output');
  });

  test('handles job with status object that is not error', async () => {
    const history = {
      'pid-ok': {
        status: { status_str: 'success' },
        outputs: {
          '7': { images: [{ filename: 'img.png', subfolder: '', type: 'output' }] },
        },
      },
    };
    mockHttpGet(200, JSON.stringify(history));
    const r = await comfy.getComfyJobResult('localhost', 8188, 'pid-ok');
    expect(r.status).toBe('done');
  });
});
