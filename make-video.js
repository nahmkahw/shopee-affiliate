/**
 * make-video.js — สร้างวิดีโอ TikTok จาก tiktok.md ด้วย FFmpeg
 *
 * ใช้งาน:
 *   node make-video.js {item_id}             สร้างวิดีโอสินค้านั้น
 *   node make-video.js {YYYY-MM-DD}          สร้างทุกสินค้าของวันที่นั้น
 *   node make-video.js {item_id} --force     สร้างใหม่แม้มี video.mp4 แล้ว
 *   node make-video.js {item_id} --sec 3     กำหนดเวลาต่อ scene (default: 2)
 *
 * Output: products/{item_id}/video.mp4 (9:16, 1080x1920, 30fps)
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawnSync, execSync } = require('child_process');

// ─── FFmpeg path (resolved by checkFFmpeg, writable for tests) ────────────────

let FFMPEG_BIN = 'ffmpeg';

// ─── หา FFmpeg (PATH หรือ common locations) ───────────────────────────────────

function findFFmpeg() {
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return 'ffmpeg'; }
  catch {}
  const candidates = [
    'C:/ffmpeg/bin/ffmpeg.exe',
    'C:/Program Files/ffmpeg/bin/ffmpeg.exe',
    'C:/Program Files (x86)/ffmpeg/bin/ffmpeg.exe',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function checkFFmpeg() {
  const found = findFFmpeg();
  if (found) { FFMPEG_BIN = found; return true; }
  return false;
}

// ─── หา Font ที่รองรับภาษาไทย ─────────────────────────────────────────────────

function findFont() {
  const candidates = [
    'C:/Windows/Fonts/THSarabunNew.ttf',
    'C:/Windows/Fonts/NotoSansThai-Regular.ttf',
    'C:/Windows/Fonts/Tahoma.ttf',
    'C:/Windows/Fonts/Arial.ttf',
    'C:/Windows/Fonts/arial.ttf',
  ];
  return candidates.find(f => fs.existsSync(f)) || null;
}

// ─── Parse tiktok.md ──────────────────────────────────────────────────────────

function parseTiktok(content, secPerScene = 2) {
  const scenes = [];
  let inCaption = false;
  const captionLines = [];

  for (const line of content.split('\n')) {
    if (line.includes('## Caption')) { inCaption = true; continue; }

    if (!inCaption && line.startsWith('|')) {
      const cols = line.split('|').slice(1, -1).map(s => s.trim());
      if (cols.length >= 4 && cols[0].match(/\d+:\d+/)) {
        const onScreen = cols[3]
          .replace(/\*\*/g, '')
          .replace(/`/g, '')
          .replace(/\s*\/\s*/g, '\n');
        scenes.push({
          time:     cols[0],
          visual:   cols[2],
          onScreen,
          duration: secPerScene,
        });
      }
    }

    if (inCaption && line.trim()) captionLines.push(line.trim());
  }

  return { scenes, caption: captionLines.join('\n') };
}

// ─── อ่านขนาดรูป JPEG จาก header (pure Node.js) ──────────────────────────────

function getJpegSize(filePath) {
  try {
    const CHUNK = 65536;
    const buf = Buffer.alloc(CHUNK);
    const fd  = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buf, 0, CHUNK, 0);
    fs.closeSync(fd);
    const data = buf.slice(0, bytesRead);
    if (data[0] !== 0xFF || data[1] !== 0xD8) return null;
    let i = 2;
    while (i + 4 < data.length) {
      if (data[i] !== 0xFF) break;
      const marker = data[i + 1];
      if ((marker >= 0xC0 && marker <= 0xC3) ||
          (marker >= 0xC5 && marker <= 0xC7) ||
          (marker >= 0xC9 && marker <= 0xCB) ||
          (marker >= 0xCD && marker <= 0xCF)) {
        if (i + 9 >= data.length) break;
        const h = data.readUInt16BE(i + 5);
        const w = data.readUInt16BE(i + 7);
        return { w, h };
      }
      if (i + 3 >= data.length) break;
      const len = data.readUInt16BE(i + 2);
      if (len < 2) break;
      i += 2 + len;
    }
  } catch {}
  return null;
}

// ─── Map images → scenes ──────────────────────────────────────────────────────

const MIN_SIZE = 800;

function mapImages(itemId, count) {
  const imgDir = path.join('products', itemId, 'images');

  const all = fs.readdirSync(imgDir)
    .filter(f => /^\d+\.jpg$/.test(f))
    .sort((a, b) => parseInt(a) - parseInt(b))
    .filter(f => f !== '1.jpg');

  const imgs = [];
  const skipped = [];
  for (const f of all) {
    const fullPath = path.join(imgDir, f);
    const size = getJpegSize(fullPath);
    if (size && size.w > MIN_SIZE && size.h > MIN_SIZE) {
      imgs.push(fullPath.replace(/\\/g, '/'));
    } else {
      skipped.push(`${f}(${size ? size.w + 'x' + size.h : '?'})`);
    }
  }

  if (skipped.length) {
    console.log(`  ⚠️  ข้ามรูปขนาดเล็ก ≤${MIN_SIZE}px: ${skipped.join(', ')}`);
  }
  if (!imgs.length) {
    throw new Error(`ไม่พบรูปขนาด > ${MIN_SIZE}×${MIN_SIZE} px ใน ${imgDir}`);
  }

  console.log(`  🖼  ใช้รูป ${imgs.length} ใบ (จากทั้งหมด ${all.length} ใบ)`);
  return Array.from({ length: count }, (_, i) => imgs[i % imgs.length]);
}

// ─── Escape text สำหรับ FFmpeg drawtext ──────────────────────────────────────

function escapeText(text) {
  return text
    .replace(/[""]/g, '')
    .replace(/✅/g, '[OK]')
    .replace(/🔥/g, '!')
    .replace(/📚/g, '')
    .replace(/🎥/g, '')
    .replace(/🔗/g, '')
    .replace(/❤️/g, '<3')
    .replace(/[^\x00-\x7F฀-๿\n]/g, '')
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '’')
    .replace(/"/g, '')
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

// ─── สร้าง scene clip หนึ่ง ──────────────────────────────────────────────────

function makeClip(imgPath, duration, onScreen, fontPath, outPath) {
  const escaped = escapeText(onScreen);

  const fontEsc = fontPath
    ? `fontfile='${fontPath.replace(/\\/g, '/').replace(/^([A-Za-z]):\//,'$1\\:/')}':`
    : '';

  const escapedFinal = escaped.replace(/\n/g, '\\n');
  const dtFilter = escaped.includes('\n')
    ? `drawtext=${fontEsc}text='${escapedFinal}':fontsize=55:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.10:line_spacing=8`
    : `drawtext=${fontEsc}text='${escapedFinal}':fontsize=65:fontcolor=white:borderw=4:bordercolor=black:x=(w-text_w)/2:y=h*0.12`;

  const vf = [
    'scale=1080:1920:force_original_aspect_ratio=decrease',
    'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
    dtFilter,
  ].join(',');

  const r = spawnSync(FFMPEG_BIN, [
    '-y',
    '-loop', '1', '-i', imgPath,
    '-vf', vf,
    '-t', String(duration),
    '-c:v', 'libx264', '-preset', 'fast',
    '-pix_fmt', 'yuv420p', '-r', '30',
    outPath,
  ], { stdio: 'pipe' });

  if (r.status !== 0) {
    const msg = r.stderr?.toString().split('\n').slice(-5).join('\n');
    throw new Error(`FFmpeg scene error:\n${msg}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(opts = {}) {
  const args   = opts.args !== undefined ? opts.args : process.argv.slice(2);
  const filter = opts.filter !== undefined ? opts.filter : (args.find(a => !a.startsWith('-')) || '');
  const force  = opts.force  !== undefined ? opts.force  : args.includes('--force');
  const secIdx = args.indexOf('--sec');
  const secPerScene = opts.secPerScene !== undefined ? opts.secPerScene :
    (secIdx !== -1 ? Math.max(1, parseInt(args[secIdx + 1]) || 2) : 2);

  if (!filter) {
    console.error('❌ ระบุ item_id หรือ YYYY-MM-DD');
    process.exit(1);
    return;
  }

  if (!checkFFmpeg()) {
    console.error('\n❌ ไม่พบ FFmpeg — กรุณาติดตั้งก่อน:');
    process.exit(1);
    return;
  }

  const fontPath = findFont();
  console.log(fontPath ? `🔤 Font: ${fontPath}` : '⚠️  ไม่พบ font — ข้อความอาจแสดงผลไม่ถูกต้อง');

  const isDate   = /^\d{4}-\d{2}-\d{2}$/.test(filter);
  const isItemId = /^\d{8,}$/.test(filter);

  const items = fs.readdirSync('products')
    .filter(d => fs.existsSync(path.join('products', d, 'data.json')))
    .map(id => ({ id, data: JSON.parse(fs.readFileSync(path.join('products', id, 'data.json'), 'utf8')) }))
    .filter(({ id, data: d }) => {
      if (d.status === 'placeholder') return false;
      if (isDate   && d.post_date !== filter) return false;
      if (isItemId && id !== filter) return false;
      if (!fs.existsSync(path.join('products', id, 'content', 'tiktok.md'))) return false;
      if (fs.existsSync(path.join('products', id, 'video.mp4')) && !force) {
        console.log(`⏭  ข้าม ${id} — video.mp4 มีอยู่แล้ว (ใช้ --force เพื่อสร้างใหม่)`);
        return false;
      }
      return true;
    });

  if (!items.length) { console.log('\n✓ ไม่มีสินค้าที่ต้องสร้างวิดีโอ'); return; }

  console.log(`\n🎬 สร้างวิดีโอ ${items.length} รายการ\n`);

  for (const { id, data: d } of items) {
    const title = (d.title || '').substring(0, 45);
    console.log(`[${id}] ${title}`);

    const tiktokContent = fs.readFileSync(path.join('products', id, 'content', 'tiktok.md'), 'utf8');
    const { scenes } = parseTiktok(tiktokContent, secPerScene);

    if (!scenes.length) {
      console.log('  ⚠️  parse tiktok.md ไม่พบ scene — ข้าม\n'); continue;
    }

    const totalSec = scenes.reduce((s, x) => s + x.duration, 0);
    console.log(`  📋 ${scenes.length} scenes | รวม ${totalSec} วินาที`);

    const images = mapImages(id, scenes.length);
    const tmpDir = path.join(os.tmpdir(), `shopee_${id}_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      const clipPaths = [];
      for (let i = 0; i < scenes.length; i++) {
        const sc = scenes[i];
        const clipPath = path.join(tmpDir, `scene_${String(i).padStart(2,'0')}.mp4`);
        process.stdout.write(`  🎞  Scene ${i+1}/${scenes.length} (${sc.duration}s) ...`);
        makeClip(images[i], sc.duration, sc.onScreen, fontPath, clipPath);
        clipPaths.push(clipPath);
        process.stdout.write(' ✓\n');
      }

      const listPath = path.join(tmpDir, 'list.txt');
      fs.writeFileSync(listPath,
        clipPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'),
        'utf8'
      );

      const outPath = path.join('products', id, 'video.mp4').replace(/\\/g, '/');
      process.stdout.write(`  🔗 Concat ${scenes.length} scenes ...`);
      const r = spawnSync(FFMPEG_BIN, [
        '-y', '-f', 'concat', '-safe', '0',
        '-i', listPath,
        '-c', 'copy',
        outPath,
      ], { stdio: 'pipe' });

      if (r.status !== 0) throw new Error(r.stderr?.toString().split('\n').slice(-4).join('\n'));
      process.stdout.write(' ✓\n');

      const mb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
      console.log(`  ✅ ${outPath} (${mb} MB) — พร้อมอัปโหลด TikTok!\n`);

    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }

  console.log('🎉 เสร็จสิ้น!');
  console.log('📱 อัปโหลดที่ https://www.tiktok.com/creator-center');
}

/* istanbul ignore next */
if (require.main === module) { main(); }

module.exports = { findFFmpeg, findFont, parseTiktok, getJpegSize, mapImages, escapeText, makeClip, checkFFmpeg, main };
