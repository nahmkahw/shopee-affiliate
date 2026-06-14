/**
 * make-tiktok-video.js — สร้างวิดีโอ TikTok จากรูปสินค้า + Edge TTS voiceover + FFmpeg
 *
 * Pipeline ต่อ scene:
 *   1. อ่าน tiktok.md → parse scenes (TIME | VOICEOVER | VISUAL | ON-SCREEN)
 *   2. หารูปสินค้าจาก products/{id}/images/
 *        บน   → รูป 2,3,5,6 (index 1,2,4,5) วนตาม scene (fit+pad พื้นขาว)
 *        bg   → รูป 4 (index 3) เป็น background ส่วนล่าง (scale to fill)
 *        thumb → รูป 1 (index 0) แสดงมุมขวาล่างขนาด 200×200
 *   3. Edge TTS (th-TH-PremwadeeNeural) → สร้างเสียงพูดจาก VOICEOVER text (ใช้ msedge-tts npm)
 *   4. FFmpeg split layout — ความยาว clip = ความยาว audio จริง:
 *        บน  (1080×1080): รูป 2,3,5,6 สลับทุก scene (fit+pad, white bg)
 *        ล่าง (1080×840):  รูป 4 เป็น bg + ON-SCREEN text (ขาว/กล่องดำ) + รูป 1 มุมขวาล่าง
 *        เสียง: voiceover mp3
 *   5. Concat ทุก clip → products/{id}/video.mp4 (มีเสียง)
 *
 * ใช้งาน:
 *   node make-tiktok-video.js {item_id}
 *   node make-tiktok-video.js {item_id} --force
 *
 * ต้องการ:
 *   npm install msedge-tts
 */

const fs   = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const ROOT         = __dirname;
const PRODUCTS_DIR = path.join(ROOT, 'products');
const FFMPEG       = process.env.FFMPEG_PATH     || 'ffmpeg';
const FFPROBE      = process.env.FFPROBE_PATH    || 'ffprobe';
const TESSERACT    = process.env.TESSERACT_PATH  || 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const TTS_VOICE    = process.env.TTS_VOICE       || 'th-TH-PremwadeeNeural';
const MIN_IMG_SIZE = 200;

// คำที่บ่งบอกว่าภาพเป็น promo/banner (ใช้เป็น bg ได้ดี, ห้ามใช้ใน review top)
const PROMO_KEYWORDS = ['ส่งฟรี', 'ส่วนลด', 'payday', 'โปรโมชั่น', 'ลดราคา', 'flash sale', 'ลด%'];

// ── args ──────────────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const itemId = args.find(a => !a.startsWith('--'));
const force  = args.includes('--force');

if (!itemId) {
  console.error('Usage: node make-tiktok-video.js <item_id> [--force]');
  process.exit(1);
}

// ── Edge TTS (Node.js) ────────────────────────────────────────────────────────

const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
let _tts = null;
async function getTTS() {
  if (!_tts) {
    _tts = new MsEdgeTTS();
    await _tts.setMetadata(TTS_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  }
  return _tts;
}

/**
 * สร้างไฟล์เสียง .mp3 จาก text ด้วย msedge-tts (Node.js — ไม่ต้องพึ่ง Python)
 */
async function generateVoiceover(text, outputPath) {
  const cleanText = text
    .replace(/^["']+|["']+$/g, '')
    .trim();

  if (!cleanText) {
    execFileSync(FFMPEG, [
      '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
      '-t', '1', '-c:a', 'aac', '-b:a', '128k', outputPath,
    ], { encoding: 'utf8', timeout: 15000 });
    return;
  }

  const tts    = await getTTS();
  const tmpDir = outputPath + '_ttsdir';
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    const result = await tts.toFile(tmpDir, cleanText);
    fs.renameSync(result.audioFilePath, outputPath);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * ดึง duration ของ audio/video file ด้วย ffprobe (หน่วย: วินาที)
 */
function getMediaDuration(filePath) {
  try {
    const out = execFileSync(FFPROBE, [
      '-v', 'quiet', '-print_format', 'json', '-show_format', filePath,
    ], { encoding: 'utf8', timeout: 10000 });
    const dur = parseFloat(JSON.parse(out).format?.duration || '0');
    return Math.max(dur, 1.0);
  } catch {
    return 2.0;
  }
}

// ── Image helpers ─────────────────────────────────────────────────────────────

function getImageDimensions(imagePath) {
  try {
    const out = execFileSync(FFPROBE, [
      '-v', 'quiet', '-print_format', 'json', '-show_streams', imagePath,
    ], { encoding: 'utf8', timeout: 10000 });
    const data   = JSON.parse(out);
    const stream = (data.streams || []).find(s => s.codec_type === 'video') || data.streams?.[0];
    return { width: stream?.width || 0, height: stream?.height || 0 };
  } catch {
    return { width: 0, height: 0 };
  }
}

function findProductImages(productId) {
  const imgDir = path.join(PRODUCTS_DIR, productId, 'images');
  if (!fs.existsSync(imgDir)) return [];

  const all = fs.readdirSync(imgDir)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .map(f => {
      const fullPath = path.join(imgDir, f);
      const dims = getImageDimensions(fullPath);
      return { path: fullPath, name: f, ...dims };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const big = all.filter(img => img.width >= MIN_IMG_SIZE && img.height >= MIN_IMG_SIZE);
  return big.length > 0 ? big : all;
}

/**
 * วิเคราะห์ความสว่างเฉลี่ยของภาพ (0–255)
 * Scale รูปเป็น 1×1 pixel → อ่านค่า grayscale → สูง = ขาว/สว่าง = พื้นว่างเยอะ
 */
function analyzeImageBrightness(imagePath) {
  try {
    const result = spawnSync(FFMPEG, [
      '-i', imagePath,
      '-vf', 'scale=1:1',
      '-frames:v', '1',
      '-f', 'rawvideo',
      '-pix_fmt', 'gray',
      'pipe:1',
    ], { timeout: 10000 });
    return (result.stdout && result.stdout.length > 0) ? result.stdout[0] : 0;
  } catch {
    return 0;
  }
}

/**
 * OCR ภาพด้วย Tesseract → คืน text ที่อ่านได้ (lowercase)
 * ใช้ภาษา tha+eng รองรับทั้งไทยและอังกฤษ
 * ถ้า Tesseract ไม่พบ/error → คืน '' (ไม่หยุดโปรแกรม)
 */
function ocrImage(imagePath) {
  try {
    // Tesseract รับ output เป็นไฟล์ ใช้ stdout ผ่าน '-' (output base = stdout)
    const result = spawnSync(TESSERACT, [
      imagePath,
      'stdout',            // output ไปที่ stdout
      '-l', 'tha+eng',    // ภาษาไทย + อังกฤษ
      '--psm', '11',       // sparse text — เหมาะกับ banner มีข้อความกระจาย
    ], { timeout: 15000, encoding: 'utf8' });
    return (result.stdout || '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * ตรวจว่า OCR text มีคำ promo อยู่ไหม
 * normalize: ลบช่องว่างทั้งหมดออกก่อนเปรียบเทียบ
 * เพราะ Tesseract มักใส่ space ระหว่างตัวอักษรไทย เช่น "ส ่ ง ฟรี" → "ส่งฟรี"
 */
function isPromoImage(ocrText) {
  const normalized = ocrText.replace(/\s+/g, ''); // ลบ whitespace ทั้งหมด
  return PROMO_KEYWORDS.some(kw => normalized.includes(kw.toLowerCase().replace(/\s+/g, '')));
}

/**
 * เลือกรูปตามบทบาท:
 *   thumbImage → รูป 1 (index 0) เสมอ — thumbnail มุมขวาล่าง
 *   bgImage    → (1) รูปที่มีคำ promo (ส่งฟรี/ส่วนลด/Payday) ตรวจด้วย OCR
 *                (2) fallback: รูปที่สว่างสุด (พื้นว่างเยอะ) ถ้าไม่พบ promo image
 *               ข้ามรูป index 0 (thumbnail) เสมอ
 *   topImages  → รูปที่เหลือทั้งหมด ยกเว้น bgImage และ promo images (ไม่ใช้ใน review)
 */
function selectImages(images) {
  const n = images.length;

  // thumbImage = รูปที่ 1 (index 0) เสมอ
  const thumbImage = images[0];

  let bgImage   = images[n - 1] || images[0]; // fallback
  let promoImgs = []; // รูปที่มีคำ promo ทั้งหมด (ห้ามใช้ใน top review)

  if (n >= 2) {
    // ── ขั้น 1: OCR ตรวจหา promo image ────────────────────────────────────────
    console.log(`\n🔍 ตรวจ OCR หาคำ promo (ส่งฟรี/ส่วนลด/Payday)...`);
    const ocrResults = images.map((img, i) => {
      if (i === 0) {
        console.log(`   ${img.name}: ข้าม (thumbnail)`);
        return { img, i, isPromo: false, ocrText: '' };
      }
      const ocrText = ocrImage(img.path);
      const isPromo = isPromoImage(ocrText);
      // แสดงเฉพาะ keyword ที่พบ (ถ้ามี) เพื่อ debug
      const found = PROMO_KEYWORDS.filter(kw => ocrText.includes(kw.toLowerCase()));
      console.log(`   ${img.name}: ${isPromo ? `✅ promo [${found.join(', ')}]` : '—'}`);
      return { img, i, isPromo, ocrText };
    });

    promoImgs = ocrResults.filter(r => r.isPromo).map(r => r.img);

    if (promoImgs.length > 0) {
      // ใช้รูป promo แรก (index น้อยสุด ไม่ใช่ thumbnail) เป็น bg
      bgImage = promoImgs[0];
      console.log(`   → เลือก bg จาก promo: ${bgImage.name}`);
    } else {
      // ── ขั้น 2: fallback — ใช้ความสว่าง ─────────────────────────────────────
      console.log(`   ไม่พบคำ promo → fallback: เลือก bg จากความสว่าง`);
      const ranked = images.map((img, i) => {
        const yavg = analyzeImageBrightness(img.path);
        console.log(`   ${img.name}: YAVG=${yavg.toFixed(1)}${i === 0 ? ' (thumbnail — ข้าม)' : ''}`);
        return { img, yavg, i };
      }).sort((a, b) => b.yavg - a.yavg);
      const bgCandidate = ranked.find(r => r.i !== 0) || ranked[1] || ranked[0];
      bgImage = bgCandidate.img;
      console.log(`   → เลือก bg จากความสว่าง: ${bgImage.name}`);
    }
  }

  // topImages = ทุกรูปยกเว้น bgImage + promo images ทั้งหมด + thumbnail (index 0)
  // promo images ไม่ควรปรากฏใน review top เพราะมีข้อความโปรโมชั่น
  const excludePaths = new Set([bgImage.path, ...promoImgs.map(i => i.path)]);
  let topImages = images.filter((img, i) => !excludePaths.has(img.path) && i !== 0);

  if (topImages.length === 0) {
    // fallback: ถ้ากรองออกหมด → ใช้ทุกรูปยกเว้น thumbnail
    topImages = images.filter((img, i) => i !== 0 && img.path !== bgImage.path);
  }
  if (topImages.length === 0) {
    topImages = images.filter((img, i) => i !== 0);
  }
  if (topImages.length === 0) topImages = [...images]; // ultimate fallback

  return { topImages, bgImage, thumbImage };
}

// ── TikTok script parser ──────────────────────────────────────────────────────

/**
 * Parse table จาก tiktok.md:
 * | TIME | VOICEOVER | VISUAL | ON-SCREEN |
 * รองรับ hyphen (-), en dash (–), em dash (—) ใน TIME
 */
function parseTikTokScript(mdText) {
  const scenes = [];

  for (const line of mdText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    if (/^\|[-|: ]+\|$/.test(trimmed)) continue; // separator row

    const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 2) continue; // ต้องมีอย่างน้อย TIME + อีก 1 column

    const [time, voiceover = '', visual = '', onScreen = ''] = cells;
    if (/time/i.test(time) || !time) continue;

    const m = time.match(/(\d+):(\d+)\s*[-–—~to]+\s*(\d+):(\d+)/);
    if (!m) continue;

    const startSec       = parseInt(m[1]) * 60 + parseInt(m[2]);
    const endSec         = parseInt(m[3]) * 60 + parseInt(m[4]);
    const scriptDuration = Math.max(endSec - startSec, 2);

    // clean ON-SCREEN text (drawtext)
    const cleanOnScreen = onScreen
      .replace(/\*+/g, '')
      .replace(/"/g, '')
      .replace(/^[']+|[']+$/g, '')
      .replace(/\\n/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    scenes.push({
      time,
      scriptDuration,        // duration จาก tiktok.md (reference เท่านั้น)
      voiceover: voiceover.trim(),
      visual: visual.trim(),
      onScreen: cleanOnScreen,
    });
  }

  return scenes;
}

// ── FFmpeg helpers ────────────────────────────────────────────────────────────

/**
 * ลบ emoji และสัญลักษณ์ที่ฟอนต์ภาษาไทย (Tahoma/THSarabunNew) ไม่รองรับ
 * ถ้าไม่ลบ → FFmpeg drawtext แสดงเป็น □ หรือ fail ทั้ง scene (ข้อความหาย)
 * คงไว้: ASCII + ภาษาไทย + ฿
 */
function stripEmoji(text) {
  return String(text)
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')  // emoji หลัก: faces, objects, flags (🔥🎓🔗📱)
    .replace(/[\u{2600}-\u{27BF}]/gu,    '')  // misc symbols + dingbats (✅ ❤ ★ ✓)
    .replace(/[\u{2B00}-\u{2BFF}]/gu,    '')  // misc symbols & arrows (⭐)
    .replace(/[\u{FE00}-\u{FE0F}]/gu,    '')  // variation selectors (❤️ modifier)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function findThaiFont() {
  const candidates = [
    'C:\\Windows\\Fonts\\THSarabunNew.ttf',
    'C:\\Windows\\Fonts\\Tahoma.ttf',
    'C:\\Windows\\Fonts\\Arial.ttf',
    'C:\\Windows\\Fonts\\calibri.ttf',
  ];
  return candidates.find(f => fs.existsSync(f)) || 'C:\\Windows\\Fonts\\Arial.ttf';
}

// Placeholder ใช้แทน newline ระหว่าง wrapText → escapeDrawtext
// (ป้องกัน escapeDrawtext double-escape backslash ใน \n)
const _NL = '\x01';

/**
 * ตัดข้อความยาวๆ เป็น 2 บรรทัด — ใช้ _NL placeholder แทน \n
 * placeholder จะถูกแทนด้วย \n จริงๆ หลัง escapeDrawtext เสมอ
 */
function wrapText(text, maxCharsPerLine = 18) {
  if (text.length <= maxCharsPerLine) return text;

  // แบ่งที่ ' / ' ก่อน (เช่น "ภาค ก ปี 69 / ลด 70%")
  const slashIdx = text.indexOf(' / ');
  if (slashIdx > 0 && slashIdx <= maxCharsPerLine + 4) {
    return text.substring(0, slashIdx) + _NL + text.substring(slashIdx + 3);
  }

  // แบ่งที่ space ใกล้กลาง
  const mid = Math.floor(text.length / 2);
  let splitAt = text.lastIndexOf(' ', mid);
  if (splitAt < 5) splitAt = text.indexOf(' ', mid);
  if (splitAt < 0) return text;

  return text.substring(0, splitAt) + _NL + text.substring(splitAt + 1);
}

/**
 * Escape ตัวอักษรพิเศษสำหรับ FFmpeg drawtext text option
 *
 * FFmpeg filter_complex ใช้ single-quote (`text='...'`) → เนื้อหาส่งตรงให้ drawtext
 * drawtext จึงต้อง escape เฉพาะ drawtext-level เท่านั้น (ไม่ double-escape):
 *   '  → \'   (single quote)
 *   :  → \:   (key-value separator)
 *   [  → \[   (filter label)
 *   ]  → \]
 *   ,  → \,   (filter chain separator)
 *   %  → \%   (drawtext expression prefix)
 *   \  → \\   (literal backslash — ต้องทำก่อน เพื่อไม่ escape ตัวเองซ้ำ)
 *
 * หมายเหตุ: _NL placeholder (\x01) ไม่ถูกแตะ จะถูกแทนด้วย \n หลังฟังก์ชันนี้
 */
function escapeDrawtext(text) {
  return String(text)
    .replace(/\\/g, '\\\\')   // backslash ก่อน (ก่อน replace อื่นๆ เพิ่ม backslash)
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/%/g, '\\%');
    // _NL (\x01) ไม่ match pattern ใดๆ ข้างบน → ผ่านมาโดยไม่เปลี่ยน ✓
}

/**
 * สร้าง QR Code PNG จาก URL → บันทึกที่ outputPath
 * ใช้ npm package 'qrcode'
 */
async function generateQRCode(url, outputPath) {
  const QRCode = require('qrcode');
  await QRCode.toFile(outputPath, url, {
    width: 300,
    margin: 1,
    color: { dark: '#000000', light: '#FFFFFF' },
    errorCorrectionLevel: 'M',
  });
}

/**
 * สร้าง video clip 1 scene — split layout (1080×1920) + voiceover audio
 *
 * Inputs:
 *   [0:v] topImgPath   — รูปสินค้าสลับ → บน 1080×1080 fit+pad ขาว
 *   [1:v] bgImgPath    — bg → ล่าง 1080×840 scale to fill
 *   [2:v] thumbImgPath — thumbnail รูป 1 → 200×200 มุมขวาล่าง
 *   [3:v] qrCodePath   — QR Code affiliate link → 180×180 มุมซ้ายล่าง
 *   [4:a] audioPath    — TTS voiceover
 *
 * overlay ส่วนล่าง:
 *   กลาง: VOICEOVER text (ขาว + กล่องดำ)
 *   ล่าง: URL text (ขาวเล็ก + กล่องดำ)
 *   มุมซ้ายล่าง: QR Code
 *   มุมขวาล่าง: Thumbnail
 */
function createSceneClip(topImgPath, bgImgPath, thumbImgPath, qrCodePath, affiliateUrl, audioPath, audioDuration, voiceoverText, outputPath) {
  const fontFile       = findThaiFont().replace(/\\/g, '/');
  const fontFileFfmpeg = fontFile.replace(/^([A-Za-z]):/, '$1\\:');
  const dur            = audioDuration.toFixed(3);

  // ── filters ───────────────────────────────────────────────────────────────
  const topFilter   = 'scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p';
  const bgFilter    = 'scale=1080:840:force_original_aspect_ratio=increase,crop=1080:840:(iw-ow)/2:ih-oh,format=yuv420p';
  const thumbFilter = 'scale=180:180:force_original_aspect_ratio=decrease,pad=200:200:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p';
  const qrFilter    = 'scale=160:160';  // QR Code 160×160

  // ── VOICEOVER text (กลางส่วนล่าง) ─────────────────────────────────────────
  const cleanedVO = stripEmoji(voiceoverText || '');
  const voDrawtext = (() => {
    if (!cleanedVO) return null;
    const wrapped = wrapText(cleanedVO, 28);
    const escRaw  = escapeDrawtext(wrapped);
    const escaped = escRaw.replace(/\x01/g, '\\n');
    return `drawtext=fontfile='${fontFileFfmpeg}':text='${escaped}':fontcolor=white:fontsize=44:x=(w-text_w)/2:y=(h-text_h)/2-40:box=1:boxcolor=black@0.6:boxborderw=22:line_spacing=12`;
  })();

  // ── URL text (ล่างส่วนล่าง) ───────────────────────────────────────────────
  // แสดงเฉพาะ path ของ URL (ตัด https:// ออก) เพื่อให้สั้นกว่า
  const shortUrl  = (affiliateUrl || '').replace(/^https?:\/\//, '');
  const escUrl    = escapeDrawtext(shortUrl);
  const urlDrawtext = `drawtext=fontfile='${fontFileFfmpeg}':text='${escUrl}':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=h-55:box=1:boxcolor=black@0.7:boxborderw=10`;

  // ── สร้าง filter_complex ──────────────────────────────────────────────────
  const bgSteps = [];
  bgSteps.push(`[1:v]${bgFilter}[bgraw]`);

  let bgCurrent = 'bgraw';

  if (voDrawtext) {
    bgSteps.push(`[${bgCurrent}]${voDrawtext}[bgvo]`);
    bgCurrent = 'bgvo';
  }

  bgSteps.push(`[${bgCurrent}]${urlDrawtext}[bgurl]`);
  bgCurrent = 'bgurl';

  const filterLines = [
    `[0:v]${topFilter}[top]`,
    ...bgSteps,
    `[2:v]${thumbFilter}[thumb]`,
    `[3:v]${qrFilter}[qr]`,
    // overlay thumbnail มุมขวาล่าง
    `[${bgCurrent}][thumb]overlay=x=W-w-20:y=H-h-20[bgth]`,
    // overlay QR Code มุมซ้ายล่าง
    `[bgth][qr]overlay=x=20:y=H-h-20[bottom]`,
    `[top][bottom]vstack=inputs=2[out]`,
  ];

  const filterComplex = filterLines.join(';');

  execFileSync(FFMPEG, [
    '-y',
    '-t', dur, '-loop', '1', '-i', topImgPath,    // [0] top image
    '-t', dur, '-loop', '1', '-i', bgImgPath,     // [1] bg image
    '-t', dur, '-loop', '1', '-i', thumbImgPath,  // [2] thumbnail
    '-t', dur, '-loop', '1', '-i', qrCodePath,    // [3] QR Code
    '-i', audioPath,                               // [4] audio
    '-filter_complex', filterComplex,
    '-map', '[out]',
    '-map', '4:a',     // audio = input index 4
    '-r', '30',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-threads', '1',
    '-c:a', 'aac', '-b:a', '128k',
    '-shortest',
    outputPath,
  ], { encoding: 'utf8', timeout: 120000 });
}

/**
 * Concat clip หลายอัน (video + audio) เป็น mp4 เดียว
 */
function concatClips(clipPaths, outputPath) {
  const listFile = path.join(path.dirname(outputPath), '_concat_list.txt');
  const content  = clipPaths.map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "\\'")}'`).join('\n');
  fs.writeFileSync(listFile, content, 'utf8');

  try {
    execFileSync(FFMPEG, [
      '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-threads', '1',
      '-c:a', 'aac', '-b:a', '128k',
      outputPath,
    ], { encoding: 'utf8', timeout: 300000 });
  } finally {
    try { fs.unlinkSync(listFile); } catch {}
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const productDir = path.join(PRODUCTS_DIR, itemId);
  const dataPath   = path.join(productDir, 'data.json');
  const ttPath     = path.join(productDir, 'content', 'tiktok.md');
  const videoPath  = path.join(productDir, 'video.mp4');
  const tempDir    = path.join(productDir, '_temp_video');

  // ── ตรวจ prerequisites ─────────────────────────────────────────────────────
  if (!fs.existsSync(dataPath)) {
    console.error(`❌ ไม่พบ products/${itemId}/data.json`);
    process.exit(1);
  }
  if (!fs.existsSync(ttPath)) {
    console.error(`❌ ไม่พบ products/${itemId}/content/tiktok.md\n   รัน /สร้าง-content ${itemId} ก่อน`);
    process.exit(1);
  }
  if (fs.existsSync(videoPath) && !force) {
    console.log(`✅ video.mp4 มีแล้ว (ใช้ --force เพื่อสร้างใหม่)`);
    process.exit(0);
  }

  const data  = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const title = (data.title || '').substring(0, 60);

  console.log(`\n🎬 สร้างวิดีโอ TikTok: ${itemId}`);
  console.log(`📦 ${title}`);
  console.log(`💰 ${data.price || '?'}  (${data.discount || 'ไม่มีส่วนลด'})\n`);

  // ── ตรวจ msedge-tts ───────────────────────────────────────────────────────
  try {
    require('msedge-tts');
    console.log(`✅ msedge-tts พร้อม (voice: ${TTS_VOICE})\n`);
  } catch {
    console.error(`❌ ไม่พบ msedge-tts — รัน: npm install msedge-tts`);
    process.exit(1);
  }

  // ── ตรวจ FFmpeg ───────────────────────────────────────────────────────────
  try {
    execFileSync(FFMPEG, ['-version'], { stdio: 'ignore', timeout: 10000 });
    console.log(`✅ FFmpeg พร้อม\n`);
  } catch {
    console.error(`❌ ไม่พบ FFmpeg — ดาวน์โหลดที่ https://ffmpeg.org/download.html`);
    process.exit(1);
  }

  // ── Parse TikTok script ────────────────────────────────────────────────────
  const ttContent = fs.readFileSync(ttPath, 'utf8');
  const scenes    = parseTikTokScript(ttContent);

  if (scenes.length === 0) {
    console.error('❌ parse tiktok.md ไม่พบ scene — ตรวจสอบ format ตาราง TIME|VOICEOVER|VISUAL|ON-SCREEN');
    console.error('   ลอง: node generate-content.js ' + itemId + ' --force');
    process.exit(1);
  }

  console.log(`📋 พบ ${scenes.length} scenes:`);
  scenes.forEach((s, i) =>
    console.log(`   Scene ${i+1} [${s.time}] — VO: "${s.voiceover.substring(0, 40)}…"`)
  );
  console.log('');

  // ── หารูปสินค้าและแบ่งบทบาท ───────────────────────────────────────────────
  const images = findProductImages(itemId);
  if (images.length === 0) {
    console.error(`❌ ไม่พบรูปสินค้าใน products/${itemId}/images/`);
    console.error(`   รัน: node scrape.js --force`);
    process.exit(1);
  }

  console.log(`🖼️  รูปสินค้าทั้งหมด ${images.length} รูป:`);
  images.forEach(img => console.log(`   ${img.name}  (${img.width}×${img.height})`));
  const { topImages, bgImage, thumbImage } = selectImages(images);
  console.log(`\n📐 Layout:`);
  console.log(`   บน (สลับทุก scene): ${topImages.map(i => i.name).join(', ')}`);
  console.log(`   ล่าง bg:             ${bgImage.name}`);
  console.log(`   Thumbnail มุมขวาล่าง: ${thumbImage.name}`);
  console.log('');

  // ── สร้าง temp dir ────────────────────────────────────────────────────────
  if (fs.existsSync(tempDir)) {
    fs.readdirSync(tempDir).forEach(f => { try { fs.unlinkSync(path.join(tempDir, f)); } catch {} });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  // ── สร้าง QR Code (ครั้งเดียว ใช้ทุก scene) ──────────────────────────────
  const affiliateUrl = data.affiliate_short_link || '';
  const qrCodePath   = path.join(tempDir, 'qrcode.png');
  if (affiliateUrl) {
    process.stdout.write('🔗 สร้าง QR Code...');
    await generateQRCode(affiliateUrl, qrCodePath);
    console.log(` ✓ (${affiliateUrl})`);
  } else {
    console.warn('⚠️  ไม่พบ affiliate_short_link ใน data.json — ไม่มี QR Code');
  }
  console.log('');

  // ── Loop สร้าง clip ต่อ scene ─────────────────────────────────────────────
  const clipPaths     = [];
  let   totalAudioSec = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene     = scenes[i];
    const topImg    = topImages[i % topImages.length];
    const audioPath = path.join(tempDir, `vo_${i}.mp3`);
    const clipPath  = path.join(tempDir, `clip_${i}.mp4`);

    console.log(`  🎬 Scene ${i + 1}/${scenes.length}  [${scene.time}]`);
    console.log(`     🖼️  บน: ${topImg.name}  |  bg: ${bgImage.name}  |  thumb: ${thumbImage.name}`);
    if (scene.onScreen) console.log(`     📝 Text: "${scene.onScreen.substring(0, 55)}"`);
    console.log(`     🎙️  VO: "${scene.voiceover.substring(0, 55)}${scene.voiceover.length > 55 ? '…' : ''}"`);

    // Step 1: Generate voiceover
    process.stdout.write('     🔊 Edge TTS...');
    try {
      await generateVoiceover(scene.voiceover, audioPath);
    } catch (e) {
      process.stdout.write(` ❌ ${e.message.substring(0, 80)}\n`);
      throw e;
    }

    // Step 2: Get actual audio duration → clip duration
    const audioDuration = getMediaDuration(audioPath);
    totalAudioSec += audioDuration;
    process.stdout.write(` ✓ (${audioDuration.toFixed(1)}s)\n`);

    // Step 3: FFmpeg → clip
    process.stdout.write(`     🎞️  FFmpeg clip (${audioDuration.toFixed(1)}s)...`);
    try {
      createSceneClip(topImg.path, bgImage.path, thumbImage.path, qrCodePath, affiliateUrl, audioPath, audioDuration, scene.voiceover, clipPath);
    } catch (e) {
      process.stdout.write(` ❌ ${e.message.substring(0, 100)}\n`);
      if (e.stderr) console.error('   FFmpeg stderr:\n' + e.stderr.substring(0, 500));
      throw e;
    }
    clipPaths.push(clipPath);
    process.stdout.write(' ✓\n\n');
  }

  // ── Concat ────────────────────────────────────────────────────────────────
  console.log(`  🔗 Concat ${clipPaths.length} clips → video.mp4 (~${totalAudioSec.toFixed(0)}s)...`);
  concatClips(clipPaths, videoPath);

  // ── Cleanup temp ──────────────────────────────────────────────────────────
  try {
    fs.readdirSync(tempDir).forEach(f => { try { fs.unlinkSync(path.join(tempDir, f)); } catch {} });
    fs.rmdirSync(tempDir);
  } catch {}

  // ── Update status ─────────────────────────────────────────────────────────
  if (data.status !== 'posted') {
    data.status = 'draft';
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
  }

  const sizeKB = Math.round(fs.statSync(videoPath).size / 1024);
  const sizeMB = (sizeKB / 1024).toFixed(1);
  console.log(`\n✅ เสร็จแล้ว! → products/${itemId}/video.mp4`);
  console.log(`   ขนาด: ${sizeKB < 1024 ? sizeKB + ' KB' : sizeMB + ' MB'}  |  ความยาว: ~${totalAudioSec.toFixed(0)}s`);
  console.log(`   🎙️  เสียง: ${TTS_VOICE}`);
  console.log(`\n📱 อัปโหลด TikTok ที่ https://www.tiktok.com/creator-center`);
  console.log(`   วาง caption จาก products/${itemId}/content/tiktok.md`);
})();
