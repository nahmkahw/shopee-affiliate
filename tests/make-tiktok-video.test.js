'use strict';

jest.mock('fs');
jest.mock('child_process');
jest.mock('msedge-tts');
jest.mock('qrcode');

const fs = require('fs');
const cp = require('child_process');

const {
  parseTikTokScript,
  stripEmoji,
  wrapText,
  escapeDrawtext,
} = require('../lib/tiktok-parser');

const { getMediaDuration } = require('../lib/tiktok-tts');

const {
  findThaiFont,
  isPromoImage,
  concatClips,
  createSceneClip,
  findProductImages,
  selectImages,
} = require('../lib/tiktok-ffmpeg');

beforeEach(() => {
  jest.clearAllMocks();
});

// ── parseTikTokScript ─────────────────────────────────────────────────────────

describe('parseTikTokScript', () => {
  const MD = `
| TIME | VOICEOVER | VISUAL | ON-SCREEN |
|------|-----------|--------|-----------|
| 0:00–0:05 | สวัสดี | product | **Title** |
| 0:05–0:10 | ราคาดี | close-up | ราคา 299 |
`;

  test('parses two scenes from table', () => {
    const scenes = parseTikTokScript(MD);
    expect(scenes).toHaveLength(2);
  });

  test('scene has correct fields', () => {
    const scenes = parseTikTokScript(MD);
    expect(scenes[0].time).toBe('0:00–0:05');
    expect(scenes[0].voiceover).toBe('สวัสดี');
    expect(scenes[0].visual).toBe('product');
  });

  test('scriptDuration is endSec - startSec', () => {
    const scenes = parseTikTokScript(MD);
    expect(scenes[0].scriptDuration).toBe(5);
  });

  test('minimum scriptDuration is 2', () => {
    const md = `| 0:00–0:01 | v | i | s |`;
    const scenes = parseTikTokScript(md);
    expect(scenes[0].scriptDuration).toBe(2);
  });

  test('strips ** from onScreen', () => {
    const scenes = parseTikTokScript(MD);
    expect(scenes[0].onScreen).not.toContain('**');
    expect(scenes[0].onScreen).toBe('Title');
  });

  test('skips separator rows', () => {
    const md = `|------|-----------|--------|-----------|`;
    expect(parseTikTokScript(md)).toHaveLength(0);
  });

  test('skips header row containing TIME keyword', () => {
    const md = `| TIME | VOICEOVER | VISUAL | ON-SCREEN |`;
    expect(parseTikTokScript(md)).toHaveLength(0);
  });

  test('returns empty array for empty string', () => {
    expect(parseTikTokScript('')).toHaveLength(0);
  });

  test('supports en-dash time separator', () => {
    const md = `| 0:00–0:08 | hello | img | text |`;
    const scenes = parseTikTokScript(md);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].scriptDuration).toBe(8);
  });

  test('supports tilde time separator', () => {
    const md = `| 0:00~0:06 | hello | img | text |`;
    const scenes = parseTikTokScript(md);
    expect(scenes).toHaveLength(1);
  });

  test('strips double-quotes from onScreen', () => {
    const md = `| 0:00–0:05 | v | i | "quoted" |`;
    const scenes = parseTikTokScript(md);
    expect(scenes[0].onScreen).not.toContain('"');
  });
});

// ── stripEmoji ────────────────────────────────────────────────────────────────

describe('stripEmoji', () => {
  test('removes fire emoji', () => {
    expect(stripEmoji('🔥hot')).toBe('hot');
  });

  test('removes checkmark symbol', () => {
    expect(stripEmoji('✅ ok')).toBe('ok');
  });

  test('preserves Thai text', () => {
    expect(stripEmoji('สินค้าดี')).toBe('สินค้าดี');
  });

  test('preserves ASCII', () => {
    expect(stripEmoji('hello world')).toBe('hello world');
  });

  test('collapses multiple spaces', () => {
    expect(stripEmoji('a  b')).toBe('a b');
  });

  test('trims leading/trailing whitespace', () => {
    expect(stripEmoji('  text  ')).toBe('text');
  });

  test('handles empty string', () => {
    expect(stripEmoji('')).toBe('');
  });
});

// ── wrapText ──────────────────────────────────────────────────────────────────

describe('wrapText', () => {
  test('returns unchanged text if within maxCharsPerLine', () => {
    expect(wrapText('short', 18)).toBe('short');
  });

  test('splits on " / " if within threshold', () => {
    const result = wrapText('ภาค ก ปี 69 / ลด 70%', 18);
    expect(result).toContain('\x01');
    expect(result).toContain('ภาค ก ปี 69');
  });

  test('splits near middle space when no slash', () => {
    const text = 'สินค้าราคาดี มากๆ เลย';
    const result = wrapText(text, 10);
    expect(result).toContain('\x01');
  });

  test('returns unchanged when no space to split', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz';
    expect(wrapText(text, 10)).toBe(text);
  });
});

// ── escapeDrawtext ────────────────────────────────────────────────────────────

describe('escapeDrawtext', () => {
  test('escapes backslash first', () => {
    expect(escapeDrawtext('a\\b')).toBe('a\\\\b');
  });

  test('escapes single quote', () => {
    expect(escapeDrawtext("it's")).toContain("\\'");
  });

  test('escapes colon', () => {
    expect(escapeDrawtext('time:00')).toContain('\\:');
  });

  test('escapes square brackets', () => {
    expect(escapeDrawtext('[OK]')).toContain('\\[');
    expect(escapeDrawtext('[OK]')).toContain('\\]');
  });

  test('escapes comma', () => {
    expect(escapeDrawtext('a,b')).toContain('\\,');
  });

  test('escapes percent', () => {
    expect(escapeDrawtext('50%')).toContain('\\%');
  });

  test('preserves _NL placeholder (\\x01)', () => {
    expect(escapeDrawtext('a\x01b')).toBe('a\x01b');
  });
});

// ── getMediaDuration ──────────────────────────────────────────────────────────

describe('getMediaDuration', () => {
  test('returns parsed duration from ffprobe JSON', () => {
    cp.execFileSync.mockReturnValue(JSON.stringify({ format: { duration: '3.5' } }));
    expect(getMediaDuration('/tmp/audio.mp3')).toBe(3.5);
  });

  test('returns minimum 1.0 when duration is 0', () => {
    cp.execFileSync.mockReturnValue(JSON.stringify({ format: { duration: '0' } }));
    expect(getMediaDuration('/tmp/audio.mp3')).toBe(1.0);
  });

  test('returns 2.0 when ffprobe throws', () => {
    cp.execFileSync.mockImplementation(() => { throw new Error('not found'); });
    expect(getMediaDuration('/tmp/audio.mp3')).toBe(2.0);
  });
});

// ── findThaiFont ──────────────────────────────────────────────────────────────

describe('findThaiFont', () => {
  test('returns first font that exists', () => {
    fs.existsSync.mockImplementation(p => String(p).includes('THSarabunNew'));
    expect(findThaiFont()).toContain('THSarabunNew');
  });

  test('returns Arial fallback when no font found', () => {
    fs.existsSync.mockReturnValue(false);
    expect(findThaiFont()).toContain('Arial');
  });
});

// ── isPromoImage ──────────────────────────────────────────────────────────────

describe('isPromoImage', () => {
  test('detects ส่งฟรี keyword', () => {
    expect(isPromoImage('สินค้า ส่งฟรี ทั่วประเทศ')).toBe(true);
  });

  test('detects payday keyword in lowercase ocr output', () => {
    expect(isPromoImage('payday sale')).toBe(true);
  });

  test('detects keyword with spaces (Tesseract artifacts)', () => {
    expect(isPromoImage('ส ่ ง ฟ รี')).toBe(true);
  });

  test('returns false for normal product image text', () => {
    expect(isPromoImage('สินค้าคุณภาพดี')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(isPromoImage('')).toBe(false);
  });
});

// ── findProductImages ─────────────────────────────────────────────────────────

describe('findProductImages', () => {
  test('returns empty array when images dir does not exist', () => {
    fs.existsSync.mockReturnValue(false);
    expect(findProductImages('/products', '12345')).toEqual([]);
  });

  test('filters out non-image files', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['1.jpg', 'readme.txt', '2.png']);
    cp.execFileSync.mockReturnValue(JSON.stringify({
      streams: [{ codec_type: 'video', width: 500, height: 500 }],
    }));
    const imgs = findProductImages('/products', '12345');
    expect(imgs.every(i => /\.(jpg|png)$/i.test(i.name))).toBe(true);
  });

  test('sorts images numerically', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['10.jpg', '2.jpg', '1.jpg']);
    cp.execFileSync.mockReturnValue(JSON.stringify({
      streams: [{ codec_type: 'video', width: 500, height: 500 }],
    }));
    const imgs = findProductImages('/products', '12345');
    expect(imgs[0].name).toBe('1.jpg');
    expect(imgs[1].name).toBe('2.jpg');
    expect(imgs[2].name).toBe('10.jpg');
  });
});

// ── selectImages ──────────────────────────────────────────────────────────────

describe('selectImages', () => {
  const makeImages = (names) => names.map(name => ({
    name,
    path: `/img/${name}`,
    width: 500,
    height: 500,
  }));

  beforeEach(() => {
    cp.spawnSync.mockReturnValue({ stdout: Buffer.from([128]), status: 0 });
  });

  test('thumbImage is always index 0', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const imgs = makeImages(['1.jpg', '2.jpg', '3.jpg']);
    const { thumbImage } = selectImages(imgs);
    expect(thumbImage.name).toBe('1.jpg');
    logSpy.mockRestore();
  });

  test('topImages excludes thumbImage and bgImage', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const imgs = makeImages(['1.jpg', '2.jpg', '3.jpg', '4.jpg']);
    const { topImages, thumbImage, bgImage } = selectImages(imgs);
    const topNames = topImages.map(i => i.name);
    expect(topNames).not.toContain(thumbImage.name);
    expect(topNames).not.toContain(bgImage.name);
    logSpy.mockRestore();
  });

  test('returns all images as topImages fallback when only 1 image', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const imgs = makeImages(['1.jpg']);
    const { topImages } = selectImages(imgs);
    expect(topImages.length).toBeGreaterThan(0);
    logSpy.mockRestore();
  });
});

// ── concatClips ───────────────────────────────────────────────────────────────

describe('concatClips', () => {
  test('writes concat list file and calls execFileSync', () => {
    fs.writeFileSync.mockImplementation(() => {});
    fs.unlinkSync.mockImplementation(() => {});
    cp.execFileSync.mockReturnValue('');

    concatClips(['/tmp/clip_0.mp4', '/tmp/clip_1.mp4'], '/tmp/video.mp4');

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('_concat_list.txt'),
      expect.stringContaining('clip_0.mp4'),
      'utf8'
    );
    expect(cp.execFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['-f', 'concat']),
      expect.any(Object)
    );
  });

  test('cleans up list file even when ffmpeg throws', () => {
    fs.writeFileSync.mockImplementation(() => {});
    fs.unlinkSync.mockImplementation(() => {});
    cp.execFileSync.mockImplementation(() => { throw new Error('ffmpeg error'); });

    expect(() => concatClips(['/a.mp4'], '/out.mp4')).toThrow('ffmpeg error');
    expect(fs.unlinkSync).toHaveBeenCalled();
  });
});

// ── createSceneClip ───────────────────────────────────────────────────────────

describe('createSceneClip', () => {
  test('calls execFileSync with expected FFmpeg args', () => {
    fs.existsSync.mockReturnValue(false);
    cp.execFileSync.mockReturnValue('');

    createSceneClip(
      '/top.jpg', '/bg.jpg', '/thumb.jpg', '/qr.png',
      'https://s.shopee.co.th/xxx',
      '/audio.mp3', 3.5, 'สินค้าดี', '/out.mp4'
    );

    expect(cp.execFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['-filter_complex', expect.any(String)]),
      expect.any(Object)
    );
  });

  test('filter_complex includes vstack', () => {
    fs.existsSync.mockReturnValue(false);
    cp.execFileSync.mockReturnValue('');

    createSceneClip('/top.jpg', '/bg.jpg', '/thumb.jpg', '/qr.png', '', '/audio.mp3', 2, '', '/out.mp4');

    const args = cp.execFileSync.mock.calls[0][1];
    const filterIdx = args.indexOf('-filter_complex');
    expect(args[filterIdx + 1]).toContain('vstack');
  });

  test('filter_complex includes drawtext for non-empty voiceover', () => {
    fs.existsSync.mockReturnValue(false);
    cp.execFileSync.mockReturnValue('');

    createSceneClip('/top.jpg', '/bg.jpg', '/thumb.jpg', '/qr.png', '', '/audio.mp3', 2, 'สวัสดี', '/out.mp4');

    const args = cp.execFileSync.mock.calls[0][1];
    const filterIdx = args.indexOf('-filter_complex');
    expect(args[filterIdx + 1]).toContain('drawtext');
  });
});
