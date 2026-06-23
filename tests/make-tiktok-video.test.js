'use strict';

jest.mock('fs');
jest.mock('child_process');
jest.mock('../lib/tiktok-parser');
jest.mock('../lib/tiktok-tts');
jest.mock('../lib/tiktok-ffmpeg');
jest.mock('msedge-tts', () => ({}), { virtual: true });

const fs               = require('fs');
const { execFileSync } = require('child_process');
const { parseTikTokScript }                           = require('../lib/tiktok-parser');
const { generateVoiceover, getMediaDuration }         = require('../lib/tiktok-tts');
const { findProductImages, selectImages, generateQRCode,
        createSceneClip, concatClips }                = require('../lib/tiktok-ffmpeg');
const { run } = require('../make-tiktok-video');

const ITEM_ID = 'test_item_123';

const DATA_JSON = {
  title: 'สินค้าทดสอบ',
  price: '199',
  discount: '10%',
  affiliate_short_link: 'https://s.shopee.co.th/test',
  status: 'draft',
};

const SCENES = [
  { time: '0:00-0:10', voiceover: 'สวัสดีค่ะ', visual: 'product', onScreen: 'ลดราคา' },
  { time: '0:10-0:20', voiceover: 'สินค้าดีมาก', visual: 'close-up', onScreen: 'ซื้อเลย' },
];

const IMAGES = [
  { name: '1.jpg', path: '/p/images/1.jpg', width: 800, height: 800 },
  { name: '2.jpg', path: '/p/images/2.jpg', width: 800, height: 800 },
];

function setupMocks() {
  fs.existsSync.mockImplementation(p => {
    if (p.includes('data.json')) return true;
    if (p.includes('tiktok.md')) return true;
    if (p.includes('video.mp4')) return false;
    return false;
  });
  fs.readFileSync.mockImplementation(p => {
    if (p.includes('data.json')) return JSON.stringify(DATA_JSON);
    return '## Script\n| Time | Voiceover |\n|------|-----------|';
  });
  fs.readdirSync.mockReturnValue([]);
  fs.mkdirSync.mockReturnValue(undefined);
  fs.writeFileSync.mockReturnValue(undefined);
  fs.statSync.mockReturnValue({ size: 2048000 });
  fs.unlinkSync.mockReturnValue(undefined);
  fs.rmdirSync.mockReturnValue(undefined);

  execFileSync.mockReturnValue(Buffer.from('ffmpeg version 6'));

  parseTikTokScript.mockReturnValue(SCENES);
  generateVoiceover.mockResolvedValue(undefined);
  getMediaDuration.mockReturnValue(5.0);
  findProductImages.mockReturnValue(IMAGES);
  selectImages.mockReturnValue({ topImages: IMAGES, bgImage: IMAGES[0], thumbImage: IMAGES[1] });
  generateQRCode.mockResolvedValue(undefined);
  createSceneClip.mockReturnValue(undefined);
  concatClips.mockReturnValue(undefined);
}

beforeEach(() => {
  jest.clearAllMocks();
  setupMocks();
  jest.spyOn(process, 'exit').mockImplementation(code => { throw new Error(`exit:${code}`); });
});

afterEach(() => {
  process.exit.mockRestore();
});

// ─── Guards ───────────────────────────────────────────────────────────────────

test('exits 1 when data.json not found', async () => {
  fs.existsSync.mockImplementation(p => !p.includes('data.json'));
  await expect(run(ITEM_ID, false)).rejects.toThrow('exit:1');
});

test('exits 1 when tiktok.md not found', async () => {
  fs.existsSync.mockImplementation(p => p.includes('data.json'));
  await expect(run(ITEM_ID, false)).rejects.toThrow('exit:1');
});

test('exits 0 when video.mp4 exists without --force', async () => {
  fs.existsSync.mockImplementation(p =>
    p.includes('data.json') || p.includes('tiktok.md') || p.includes('video.mp4')
  );
  await expect(run(ITEM_ID, false)).rejects.toThrow('exit:0');
});

test('proceeds when video.mp4 exists with --force', async () => {
  fs.existsSync.mockImplementation(p =>
    p.includes('data.json') || p.includes('tiktok.md') || p.includes('video.mp4')
  );
  await run(ITEM_ID, true);
  expect(concatClips).toHaveBeenCalled();
});

test('exits 1 when FFmpeg not found', async () => {
  execFileSync.mockImplementation(() => { throw new Error('not found'); });
  await expect(run(ITEM_ID, false)).rejects.toThrow('exit:1');
});

test('exits 1 when no scenes parsed from tiktok.md', async () => {
  parseTikTokScript.mockReturnValue([]);
  await expect(run(ITEM_ID, false)).rejects.toThrow('exit:1');
});

test('exits 1 when no product images found', async () => {
  findProductImages.mockReturnValue([]);
  await expect(run(ITEM_ID, false)).rejects.toThrow('exit:1');
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test('full success: parses scenes, generates VO per scene, concats clips', async () => {
  await run(ITEM_ID, false);

  expect(parseTikTokScript).toHaveBeenCalledTimes(1);
  expect(generateVoiceover).toHaveBeenCalledTimes(SCENES.length);
  expect(createSceneClip).toHaveBeenCalledTimes(SCENES.length);
  expect(concatClips).toHaveBeenCalledTimes(1);
});

test('generates QR code when affiliate_short_link present', async () => {
  await run(ITEM_ID, false);
  expect(generateQRCode).toHaveBeenCalledWith(
    DATA_JSON.affiliate_short_link,
    expect.stringContaining('qrcode.png')
  );
});

test('skips QR code when affiliate_short_link is empty', async () => {
  fs.readFileSync.mockImplementation(p => {
    if (p.includes('data.json')) return JSON.stringify({ ...DATA_JSON, affiliate_short_link: '' });
    return '';
  });
  await run(ITEM_ID, false);
  expect(generateQRCode).not.toHaveBeenCalled();
});

test('writes data.json with status=draft after success', async () => {
  await run(ITEM_ID, false);
  const call = fs.writeFileSync.mock.calls.find(c => c[0].includes('data.json'));
  expect(call).toBeDefined();
  expect(JSON.parse(call[1]).status).toBe('draft');
});

test('does not write data.json when status is already posted', async () => {
  fs.readFileSync.mockImplementation(p => {
    if (p.includes('data.json')) return JSON.stringify({ ...DATA_JSON, status: 'posted' });
    return '';
  });
  await run(ITEM_ID, false);
  const call = fs.writeFileSync.mock.calls.find(c => c[0].includes('data.json'));
  expect(call).toBeUndefined();
});

test('rotates topImages across scenes by index', async () => {
  await run(ITEM_ID, false);
  const calls = createSceneClip.mock.calls;
  expect(calls[0][0]).toBe(IMAGES[0].path);
  expect(calls[1][0]).toBe(IMAGES[1].path);
});

test('cleans up tempDir after success', async () => {
  await run(ITEM_ID, false);
  expect(fs.rmdirSync).toHaveBeenCalled();
});
