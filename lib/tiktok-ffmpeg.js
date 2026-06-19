'use strict';

const fs   = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const FFMPEG    = process.env.FFMPEG_PATH    || 'ffmpeg';
const FFPROBE   = process.env.FFPROBE_PATH   || 'ffprobe';
const TESSERACT = process.env.TESSERACT_PATH || 'C:/Program Files/Tesseract-OCR/tesseract.exe';

const MIN_IMG_SIZE   = 200;
const PROMO_KEYWORDS = ['ส่งฟรี', 'ส่วนลด', 'payday', 'โปรโมชั่น', 'ลดราคา', 'flash sale', 'ลด%'];

const { stripEmoji, wrapText, escapeDrawtext, _NL } = require('./tiktok-parser');

function findThaiFont() {
  const candidates = [
    'C:\\Windows\\Fonts\\THSarabunNew.ttf',
    'C:\\Windows\\Fonts\\Tahoma.ttf',
    'C:\\Windows\\Fonts\\Arial.ttf',
    'C:\\Windows\\Fonts\\calibri.ttf',
  ];
  return candidates.find(f => fs.existsSync(f)) || 'C:\\Windows\\Fonts\\Arial.ttf';
}

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

function findProductImages(productsDir, productId) {
  const imgDir = path.join(productsDir, productId, 'images');
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

function ocrImage(imagePath) {
  try {
    const result = spawnSync(TESSERACT, [
      imagePath,
      'stdout',
      '-l', 'tha+eng',
      '--psm', '11',
    ], { timeout: 15000, encoding: 'utf8' });
    return (result.stdout || '').toLowerCase();
  } catch {
    return '';
  }
}

function isPromoImage(ocrText) {
  const normalized = ocrText.replace(/\s+/g, '');
  return PROMO_KEYWORDS.some(kw => normalized.includes(kw.toLowerCase().replace(/\s+/g, '')));
}

function selectImages(images) {
  const n = images.length;
  const thumbImage = images[0];

  let bgImage   = images[n - 1] || images[0];
  let promoImgs = [];

  if (n >= 2) {
    console.log(`\n🔍 ตรวจ OCR หาคำ promo (ส่งฟรี/ส่วนลด/Payday)...`);
    const ocrResults = images.map((img, i) => {
      if (i === 0) {
        console.log(`   ${img.name}: ข้าม (thumbnail)`);
        return { img, i, isPromo: false, ocrText: '' };
      }
      const ocrText = ocrImage(img.path);
      const isPromo = isPromoImage(ocrText);
      const found = PROMO_KEYWORDS.filter(kw => ocrText.includes(kw.toLowerCase()));
      console.log(`   ${img.name}: ${isPromo ? `✅ promo [${found.join(', ')}]` : '—'}`);
      return { img, i, isPromo, ocrText };
    });

    promoImgs = ocrResults.filter(r => r.isPromo).map(r => r.img);

    if (promoImgs.length > 0) {
      bgImage = promoImgs[0];
      console.log(`   → เลือก bg จาก promo: ${bgImage.name}`);
    } else {
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

  const excludePaths = new Set([bgImage.path, ...promoImgs.map(i => i.path)]);
  let topImages = images.filter((img, i) => !excludePaths.has(img.path) && i !== 0);

  if (topImages.length === 0) {
    topImages = images.filter((img, i) => i !== 0 && img.path !== bgImage.path);
  }
  if (topImages.length === 0) {
    topImages = images.filter((img, i) => i !== 0);
  }
  if (topImages.length === 0) topImages = [...images];

  return { topImages, bgImage, thumbImage };
}

async function generateQRCode(url, outputPath) {
  const QRCode = require('qrcode');
  await QRCode.toFile(outputPath, url, {
    width: 300,
    margin: 1,
    color: { dark: '#000000', light: '#FFFFFF' },
    errorCorrectionLevel: 'M',
  });
}

function createSceneClip(topImgPath, bgImgPath, thumbImgPath, qrCodePath, affiliateUrl, audioPath, audioDuration, voiceoverText, outputPath) {
  const fontFile       = findThaiFont().replace(/\\/g, '/');
  const fontFileFfmpeg = fontFile.replace(/^([A-Za-z]):/, '$1\\:');
  const dur            = audioDuration.toFixed(3);

  const topFilter   = 'scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p';
  const bgFilter    = 'scale=1080:840:force_original_aspect_ratio=increase,crop=1080:840:(iw-ow)/2:ih-oh,format=yuv420p';
  const thumbFilter = 'scale=180:180:force_original_aspect_ratio=decrease,pad=200:200:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p';
  const qrFilter    = 'scale=160:160';

  const cleanedVO = stripEmoji(voiceoverText || '');
  const voDrawtext = (() => {
    if (!cleanedVO) return null;
    const wrapped = wrapText(cleanedVO, 28);
    const escRaw  = escapeDrawtext(wrapped);
    const escaped = escRaw.replace(/\x01/g, '\\n');
    return `drawtext=fontfile='${fontFileFfmpeg}':text='${escaped}':fontcolor=white:fontsize=44:x=(w-text_w)/2:y=(h-text_h)/2-40:box=1:boxcolor=black@0.6:boxborderw=22:line_spacing=12`;
  })();

  const shortUrl    = (affiliateUrl || '').replace(/^https?:\/\//, '');
  const escUrl      = escapeDrawtext(shortUrl);
  const urlDrawtext = `drawtext=fontfile='${fontFileFfmpeg}':text='${escUrl}':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=h-55:box=1:boxcolor=black@0.7:boxborderw=10`;

  const bgSteps  = [];
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
    `[${bgCurrent}][thumb]overlay=x=W-w-20:y=H-h-20[bgth]`,
    `[bgth][qr]overlay=x=20:y=H-h-20[bottom]`,
    `[top][bottom]vstack=inputs=2[out]`,
  ];

  const filterComplex = filterLines.join(';');

  execFileSync(FFMPEG, [
    '-y',
    '-t', dur, '-loop', '1', '-i', topImgPath,
    '-t', dur, '-loop', '1', '-i', bgImgPath,
    '-t', dur, '-loop', '1', '-i', thumbImgPath,
    '-t', dur, '-loop', '1', '-i', qrCodePath,
    '-i', audioPath,
    '-filter_complex', filterComplex,
    '-map', '[out]',
    '-map', '4:a',
    '-r', '30',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-threads', '1',
    '-c:a', 'aac', '-b:a', '128k',
    '-shortest',
    outputPath,
  ], { encoding: 'utf8', timeout: 120000 });
}

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

module.exports = {
  findThaiFont,
  getImageDimensions,
  findProductImages,
  analyzeImageBrightness,
  ocrImage,
  isPromoImage,
  selectImages,
  generateQRCode,
  createSceneClip,
  concatClips,
};
