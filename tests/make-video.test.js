'use strict';

jest.mock('fs');
jest.mock('child_process');

const fs = require('fs');
const cp = require('child_process');

const {
  findFFmpeg, findFont, parseTiktok, getJpegSize, mapImages,
  escapeText, makeClip, checkFFmpeg, main,
} = require('../make-video');

beforeEach(() => {
  jest.resetAllMocks();
});

// ─── parseTiktok ──────────────────────────────────────────────────────────────

describe('parseTiktok', () => {
  const TIKTOK_MD = `
| TIME | VOICEOVER | VISUAL | ON-SCREEN |
|------|-----------|--------|-----------|
| 0:00 | hook text | product shot | **Title / Subtitle** |
| 0:03 | body text | close-up     | Feature: item |
## Caption
#Shopeeaffiliate #buy
`;

  test('parses scenes from table rows', () => {
    const { scenes } = parseTiktok(TIKTOK_MD);
    expect(scenes).toHaveLength(2);
    expect(scenes[0].time).toBe('0:00');
    expect(scenes[0].visual).toBe('product shot');
  });

  test('uses secPerScene parameter for duration', () => {
    const { scenes } = parseTiktok(TIKTOK_MD, 3);
    expect(scenes[0].duration).toBe(3);
    expect(scenes[1].duration).toBe(3);
  });

  test('default secPerScene is 2', () => {
    const { scenes } = parseTiktok(TIKTOK_MD);
    expect(scenes[0].duration).toBe(2);
  });

  test('converts "/" separator to newline in onScreen text', () => {
    const { scenes } = parseTiktok(TIKTOK_MD);
    expect(scenes[0].onScreen).toContain('\n');
  });

  test('strips ** markdown from onScreen', () => {
    const { scenes } = parseTiktok(TIKTOK_MD);
    expect(scenes[0].onScreen).not.toContain('**');
  });

  test('collects caption lines after ## Caption', () => {
    const { caption } = parseTiktok(TIKTOK_MD);
    expect(caption).toContain('#Shopeeaffiliate');
  });

  test('returns empty scenes for content without table rows', () => {
    const { scenes } = parseTiktok('## Caption\nNo table here');
    expect(scenes).toHaveLength(0);
  });

  test('skips header row (no time pattern)', () => {
    const md = `| TIME | VO | VIS | SCR |\n|------|----|----|-----|\n| 0:00 | v | i | txt |`;
    const { scenes } = parseTiktok(md);
    expect(scenes).toHaveLength(1);
  });
});

// ─── escapeText ───────────────────────────────────────────────────────────────

describe('escapeText', () => {
  test('replaces ✅ with [OK] (brackets then get escaped)', () => {
    // escapeText maps ✅ → [OK] then escapes [ → \[ and ] → \]
    expect(escapeText('✅ สินค้าดี')).toContain('OK');
  });

  test('replaces 🔥 with !', () => {
    expect(escapeText('🔥 Hot!')).toContain('!');
  });

  test('replaces ❤️ with <3', () => {
    expect(escapeText('❤️ love')).toContain('<3');
  });

  test('removes curly double quotes', () => {
    const r = escapeText('"hello"');
    expect(r).not.toMatch(/[""]/);
  });

  test('escapes colon with backslash', () => {
    expect(escapeText('time:00')).toContain('\\:');
  });

  test('escapes comma', () => {
    expect(escapeText('a,b')).toContain('\\,');
  });

  test('escapes square brackets', () => {
    expect(escapeText('[OK]')).toContain('\\[');
    expect(escapeText('[OK]')).toContain('\\]');
  });

  test('trims leading/trailing whitespace', () => {
    expect(escapeText('  text  ')).toBe('text');
  });

  test('removes non-ASCII non-Thai characters', () => {
    const r = escapeText('hello🎯world');
    expect(r).not.toContain('🎯');
  });
});

// ─── findFont ─────────────────────────────────────────────────────────────────

describe('findFont', () => {
  test('returns null when no font files exist', () => {
    fs.existsSync.mockReturnValue(false);
    expect(findFont()).toBeNull();
  });

  test('returns the first existing font path', () => {
    fs.existsSync.mockImplementation(p => p.includes('Tahoma'));
    expect(findFont()).toContain('Tahoma');
  });

  test('returns THSarabunNew when it exists (highest priority)', () => {
    fs.existsSync.mockReturnValue(true);
    expect(findFont()).toContain('THSarabunNew');
  });
});

// ─── findFFmpeg ───────────────────────────────────────────────────────────────

describe('findFFmpeg', () => {
  test('returns "ffmpeg" when available on PATH', () => {
    cp.execSync.mockReturnValue(undefined);
    expect(findFFmpeg()).toBe('ffmpeg');
  });

  test('falls back to installed path when not on PATH', () => {
    cp.execSync.mockImplementation(() => { throw new Error('not found'); });
    fs.existsSync.mockImplementation(p => p.includes('C:/ffmpeg/bin'));
    expect(findFFmpeg()).toBe('C:/ffmpeg/bin/ffmpeg.exe');
  });

  test('returns null when ffmpeg not found anywhere', () => {
    cp.execSync.mockImplementation(() => { throw new Error('not found'); });
    fs.existsSync.mockReturnValue(false);
    expect(findFFmpeg()).toBeNull();
  });
});

// ─── checkFFmpeg ──────────────────────────────────────────────────────────────

describe('checkFFmpeg', () => {
  test('returns true when ffmpeg is found', () => {
    cp.execSync.mockReturnValue(undefined);
    expect(checkFFmpeg()).toBe(true);
  });

  test('returns false when ffmpeg is not found', () => {
    cp.execSync.mockImplementation(() => { throw new Error('not found'); });
    fs.existsSync.mockReturnValue(false);
    expect(checkFFmpeg()).toBe(false);
  });
});

// ─── getJpegSize ─────────────────────────────────────────────────────────────

function makeJpegBuf(w, h) {
  const buf = Buffer.alloc(65536, 0);
  buf[0] = 0xFF; buf[1] = 0xD8;  // JPEG magic
  buf[2] = 0xFF; buf[3] = 0xC0;  // SOF0 marker
  // height at i+5 = offset 7, width at i+7 = offset 9 (i=2)
  buf.writeUInt16BE(h, 7);
  buf.writeUInt16BE(w, 9);
  return buf;
}

describe('getJpegSize', () => {
  test('returns { w, h } for valid JPEG', () => {
    const jpegBuf = makeJpegBuf(1200, 900);
    fs.openSync.mockReturnValue(3);
    fs.readSync.mockImplementation((fd, buf) => {
      jpegBuf.copy(buf, 0, 0, jpegBuf.length);
      return jpegBuf.length;
    });
    fs.closeSync.mockReturnValue(undefined);
    const result = getJpegSize('/tmp/test.jpg');
    expect(result).toEqual({ w: 1200, h: 900 });
  });

  test('returns null for non-JPEG files', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47]);  // PNG signature
    fs.openSync.mockReturnValue(3);
    fs.readSync.mockImplementation((fd, b) => { buf.copy(b, 0, 0, buf.length); return buf.length; });
    fs.closeSync.mockReturnValue(undefined);
    const result = getJpegSize('/tmp/test.png');
    expect(result).toBeNull();
  });

  test('returns null when JPEG has no SOF marker in buffer', () => {
    const buf = Buffer.alloc(65536, 0);
    buf[0] = 0xFF; buf[1] = 0xD8;  // JPEG magic but no SOF
    // buf[2] = 0x00 — will break the while loop (data[i] !== 0xFF)
    fs.openSync.mockReturnValue(3);
    fs.readSync.mockImplementation((fd, b) => { buf.copy(b); return buf.length; });
    fs.closeSync.mockReturnValue(undefined);
    expect(getJpegSize('/tmp/nosof.jpg')).toBeNull();
  });

  test('returns null when fs.openSync throws', () => {
    fs.openSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(getJpegSize('/tmp/missing.jpg')).toBeNull();
  });

  test('handles SOF with segment length skip (non-SOF markers first)', () => {
    const buf = Buffer.alloc(65536, 0);
    buf[0] = 0xFF; buf[1] = 0xD8;  // magic
    // i=2: marker FF E0 (APP0), length 0x00 0x10 = 16 → skip to i=2+2+16=20
    buf[2] = 0xFF; buf[3] = 0xE0;
    buf[4] = 0x00; buf[5] = 0x10;  // segment length = 16
    // i=20: SOF0 marker
    buf[20] = 0xFF; buf[21] = 0xC0;
    buf.writeUInt16BE(800, 25);   // height at i+5 = 25
    buf.writeUInt16BE(600, 27);   // width at i+7 = 27
    fs.openSync.mockReturnValue(3);
    fs.readSync.mockImplementation((fd, b) => { buf.copy(b); return buf.length; });
    fs.closeSync.mockReturnValue(undefined);
    const result = getJpegSize('/tmp/with-app0.jpg');
    expect(result).toEqual({ w: 600, h: 800 });
  });
});

// ─── mapImages ────────────────────────────────────────────────────────────────

describe('mapImages', () => {
  beforeEach(() => {
    // Default: 3 jpg files, all large enough
    fs.readdirSync.mockReturnValue(['1.jpg', '2.jpg', '3.jpg', '4.jpg']);
    fs.openSync.mockReturnValue(3);
    fs.readSync.mockImplementation((fd, buf) => {
      makeJpegBuf(1000, 1000).copy(buf);
      return 65536;
    });
    fs.closeSync.mockReturnValue(undefined);
    fs.existsSync.mockReturnValue(true);
  });

  test('skips thumbnail 1.jpg and returns remaining images', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const imgs = mapImages('12345', 3);
    expect(imgs).toHaveLength(3);
    expect(imgs.every(p => !p.includes('1.jpg'))).toBe(true);  // 1.jpg excluded
    logSpy.mockRestore();
  });

  test('cycles images when count > available images', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    // readdirSync has 4 files but 1.jpg is skipped → 3 usable images
    const imgs = mapImages('12345', 5);
    expect(imgs).toHaveLength(5);
    logSpy.mockRestore();
  });

  test('throws when no large-enough images found', () => {
    // All images too small
    fs.readSync.mockImplementation((fd, buf) => {
      makeJpegBuf(500, 500).copy(buf);  // smaller than MIN_SIZE=800
      return 65536;
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => mapImages('12345', 1)).toThrow('ไม่พบรูปขนาด');
    logSpy.mockRestore();
  });

  test('logs skipped small images', () => {
    // Mix: 2.jpg large, 3.jpg small, 4.jpg large
    fs.readSync.mockImplementation((fd, buf) => {
      // We need to know which file we're reading — not possible without path context.
      // Instead: make all images small except the first call
      const callCount = fs.readSync.mock.calls.length;
      const size = callCount === 1 ? 500 : 1000;  // first call small, rest large
      makeJpegBuf(size, size).copy(buf);
      return 65536;
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mapImages('12345', 2);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ข้ามรูปขนาดเล็ก'));
    logSpy.mockRestore();
  });
});

// ─── makeClip ────────────────────────────────────────────────────────────────

describe('makeClip', () => {
  test('calls spawnSync with FFmpeg args and succeeds', () => {
    cp.spawnSync.mockReturnValue({ status: 0 });
    expect(() => makeClip('/img.jpg', 2, 'Hello World', null, '/out.mp4')).not.toThrow();
    expect(cp.spawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['-i', '/img.jpg', '-t', '2']),
      expect.any(Object)
    );
  });

  test('throws when spawnSync returns non-zero status', () => {
    cp.spawnSync.mockReturnValue({ status: 1, stderr: Buffer.from('ffmpeg error\ndetail') });
    expect(() => makeClip('/img.jpg', 2, 'text', null, '/out.mp4')).toThrow('FFmpeg scene error');
  });

  test('includes font in filter when fontPath is provided', () => {
    cp.spawnSync.mockReturnValue({ status: 0 });
    makeClip('/img.jpg', 2, 'text', 'C:/Windows/Fonts/Tahoma.ttf', '/out.mp4');
    const vfArg = cp.spawnSync.mock.calls[0][1].find((a, i, arr) => arr[i-1] === '-vf');
    expect(vfArg).toContain('fontfile=');
  });

  test('uses multiline drawtext filter when text contains newline', () => {
    cp.spawnSync.mockReturnValue({ status: 0 });
    makeClip('/img.jpg', 2, 'line1\nline2', null, '/out.mp4');
    const vfArg = cp.spawnSync.mock.calls[0][1].find((a, i, arr) => arr[i-1] === '-vf');
    expect(vfArg).toContain('line_spacing');
  });
});

// ─── main(): guard checks ─────────────────────────────────────────────────────

describe('main(): no filter', () => {
  test('exits when no filter/item_id is given', () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    const errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => main({ args: [] })).toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe('main(): FFmpeg not found', () => {
  test('exits when FFmpeg is not installed', () => {
    cp.execSync.mockImplementation(() => { throw new Error('not found'); });
    fs.existsSync.mockReturnValue(false);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT1'); });
    const errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => main({ filter: '12345678' })).toThrow('EXIT1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});

// ─── main(): no items to process ──────────────────────────────────────────────

describe('main(): no matching items', () => {
  test('returns early with message when no products match filter', () => {
    cp.execSync.mockReturnValue(undefined);  // FFmpeg found
    fs.existsSync.mockReturnValue(false);    // no font
    fs.readdirSync.mockReturnValue([]);      // empty products dir

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    main({ filter: '12345678' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ไม่มีสินค้า'));
    logSpy.mockRestore();
  });
});

// ─── main(): skips item with video.mp4 (no force) ────────────────────────────

describe('main(): skips existing video.mp4 without force', () => {
  test('logs skip message when video.mp4 exists and force=false', () => {
    cp.execSync.mockReturnValue(undefined);
    fs.existsSync.mockImplementation(p => {
      if (String(p).endsWith('.ttf')) return false;
      return true;  // data.json, tiktok.md, video.mp4 all "exist"
    });
    fs.readdirSync.mockReturnValue(['12345678']);
    fs.readFileSync.mockReturnValue(JSON.stringify({ title: 'T', status: 'draft', post_date: '2026-06-15' }));

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    main({ filter: '12345678', force: false });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ข้าม'));
    logSpy.mockRestore();
  });
});

// ─── main(): skips placeholder items ─────────────────────────────────────────

describe('main(): skips placeholder products', () => {
  test('skips product with status=placeholder', () => {
    cp.execSync.mockReturnValue(undefined);
    fs.existsSync.mockImplementation(p => !String(p).endsWith('.ttf'));
    fs.readdirSync.mockReturnValue(['99999999']);
    fs.readFileSync.mockReturnValue(JSON.stringify({ title: 'P', status: 'placeholder' }));

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    main({ filter: '99999999' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ไม่มีสินค้า'));
    logSpy.mockRestore();
  });
});

// ─── main(): item with no tiktok.md ──────────────────────────────────────────

describe('main(): skips item without tiktok.md', () => {
  test('filters out items that have no tiktok.md', () => {
    cp.execSync.mockReturnValue(undefined);
    fs.existsSync.mockImplementation(p => {
      if (String(p).endsWith('data.json')) return true;
      return false;  // no tiktok.md, no video.mp4, no fonts
    });
    fs.readdirSync.mockReturnValue(['12345678']);
    fs.readFileSync.mockReturnValue(JSON.stringify({ title: 'T', status: 'draft' }));

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    main({ filter: '12345678' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ไม่มีสินค้า'));
    logSpy.mockRestore();
  });
});

// ─── main(): filters by date ──────────────────────────────────────────────────

describe('main(): date filter', () => {
  test('only processes items matching the given post_date', () => {
    cp.execSync.mockReturnValue(undefined);
    fs.existsSync.mockImplementation(p => {
      if (String(p).endsWith('data.json') || String(p).endsWith('tiktok.md')) return true;
      return false;
    });
    fs.readdirSync.mockReturnValue(['11111111', '22222222']);
    fs.readFileSync.mockImplementation(p => {
      if (String(p).includes('11111111')) return JSON.stringify({ title: 'A', status: 'draft', post_date: '2026-06-15' });
      return JSON.stringify({ title: 'B', status: 'draft', post_date: '2026-06-16' });
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    // filter by date with no items matching → ไม่มีสินค้า
    main({ filter: '2026-06-17' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ไม่มีสินค้า'));
    logSpy.mockRestore();
  });
});

// ─── main(): full success path ────────────────────────────────────────────────

describe('main(): full video creation success', () => {
  test('creates video.mp4 from tiktok scenes', () => {
    cp.execSync.mockReturnValue(undefined);  // FFmpeg on PATH

    const tiktokMd = `| 0:00 | hook | shot | Scene One |\n| 0:03 | body | cu | Scene Two |`;

    // existsSync: data.json + tiktok.md exist; no video.mp4; no font
    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      if (s.endsWith('data.json') || s.endsWith('tiktok.md')) return true;
      return false;
    });
    fs.readdirSync.mockImplementation(p => {
      if (String(p).includes('images')) return ['2.jpg', '3.jpg'];
      return ['12345678'];
    });
    fs.readFileSync.mockImplementation(p => {
      if (String(p).endsWith('tiktok.md')) return tiktokMd;
      return JSON.stringify({ title: 'Test', status: 'draft' });
    });
    // JPEG size mock: 1000x1000
    fs.openSync.mockReturnValue(3);
    fs.readSync.mockImplementation((fd, buf) => { makeJpegBuf(1000, 1000).copy(buf); return 65536; });
    fs.closeSync.mockReturnValue(undefined);
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    fs.rmSync.mockImplementation(() => {});
    fs.statSync.mockReturnValue({ size: 2 * 1024 * 1024 });  // 2MB

    cp.spawnSync.mockReturnValue({ status: 0 });

    const logSpy    = jest.spyOn(console, 'log').mockImplementation(() => {});
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    main({ filter: '12345678' });
    expect(cp.spawnSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('list.txt'), expect.any(String), 'utf8');
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
  });
});

// ─── main(): no scenes in tiktok.md ──────────────────────────────────────────

describe('main(): tiktok.md has no parseable scenes', () => {
  test('logs skip message when no scenes found', () => {
    cp.execSync.mockReturnValue(undefined);
    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      if (s.endsWith('data.json') || s.endsWith('tiktok.md')) return true;
      return false;
    });
    fs.readdirSync.mockReturnValue(['12345678']);
    fs.readFileSync.mockImplementation(p => {
      if (String(p).endsWith('tiktok.md')) return '## Caption\nNo table here.';
      return JSON.stringify({ title: 'T', status: 'draft' });
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    main({ filter: '12345678' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ไม่พบ scene'));
    logSpy.mockRestore();
  });
});

// ─── main(): makeClip fails ───────────────────────────────────────────────────

describe('main(): FFmpeg scene creation fails', () => {
  test('cleanup tmpDir even when makeClip throws', () => {
    cp.execSync.mockReturnValue(undefined);
    const tiktokMd = `| 0:00 | hook | shot | Scene |\n`;

    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      if (s.endsWith('data.json') || s.endsWith('tiktok.md')) return true;
      return false;
    });
    fs.readdirSync.mockImplementation(p => {
      if (String(p).includes('images')) return ['2.jpg'];
      return ['12345678'];
    });
    fs.readFileSync.mockImplementation(p => {
      if (String(p).endsWith('tiktok.md')) return tiktokMd;
      return JSON.stringify({ title: 'T', status: 'draft' });
    });
    fs.openSync.mockReturnValue(3);
    fs.readSync.mockImplementation((fd, buf) => { makeJpegBuf(1000, 1000).copy(buf); return 65536; });
    fs.closeSync.mockReturnValue(undefined);
    fs.mkdirSync.mockImplementation(() => {});
    fs.rmSync.mockImplementation(() => {});

    // FFmpeg fails
    cp.spawnSync.mockReturnValue({ status: 1, stderr: Buffer.from('codec error') });

    const logSpy    = jest.spyOn(console, 'log').mockImplementation(() => {});
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    expect(() => main({ filter: '12345678' })).toThrow('FFmpeg scene error');
    // tmpDir cleanup must still happen (rmSync called)
    expect(fs.rmSync).toHaveBeenCalled();
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
  });
});

// ─── main(): --sec option ─────────────────────────────────────────────────────

describe('main(): --sec option', () => {
  test('parses --sec N from args', () => {
    // Just verify secPerScene is computed correctly from args
    // We test indirectly via parseTiktok call — use opts.secPerScene
    cp.execSync.mockReturnValue(undefined);
    const tiktokMd = `| 0:00 | hook | shot | Scene |\n`;

    fs.existsSync.mockImplementation(p => {
      const s = String(p);
      if (s.endsWith('data.json') || s.endsWith('tiktok.md')) return true;
      return false;
    });
    fs.readdirSync.mockImplementation(p => {
      if (String(p).includes('images')) return ['2.jpg'];
      return ['12345678'];
    });
    fs.readFileSync.mockImplementation(p => {
      if (String(p).endsWith('tiktok.md')) return tiktokMd;
      return JSON.stringify({ title: 'T', status: 'draft' });
    });
    fs.openSync.mockReturnValue(3);
    fs.readSync.mockImplementation((fd, buf) => { makeJpegBuf(1000, 1000).copy(buf); return 65536; });
    fs.closeSync.mockReturnValue(undefined);
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    fs.rmSync.mockImplementation(() => {});
    fs.statSync.mockReturnValue({ size: 1024 * 1024 });

    cp.spawnSync.mockReturnValue({ status: 0 });

    const logSpy    = jest.spyOn(console, 'log').mockImplementation(() => {});
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    // Use opts.secPerScene = 4 → scenes will have duration=4
    main({ filter: '12345678', secPerScene: 4 });
    // Verify -t arg passed to spawnSync is '4'
    const firstCall = cp.spawnSync.mock.calls[0];
    const tIdx = firstCall[1].indexOf('-t');
    expect(firstCall[1][tIdx + 1]).toBe('4');
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
  });
});
