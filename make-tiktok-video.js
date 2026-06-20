'use strict';

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const { parseTikTokScript }                                      = require('./lib/tiktok-parser');
const { generateVoiceover, getMediaDuration }                    = require('./lib/tiktok-tts');
const { findProductImages, selectImages, generateQRCode,
        createSceneClip, concatClips }                           = require('./lib/tiktok-ffmpeg');

const ROOT         = __dirname;
const PRODUCTS_DIR = path.join(ROOT, 'products');
const FFMPEG       = process.env.FFMPEG_PATH || 'ffmpeg';
const TTS_VOICE    = process.env.TTS_VOICE   || 'th-TH-PremwadeeNeural';

async function run(itemId, force) {
  const productDir = path.join(PRODUCTS_DIR, itemId);
  const dataPath   = path.join(productDir, 'data.json');
  const ttPath     = path.join(productDir, 'content', 'tiktok.md');
  const videoPath  = path.join(productDir, 'video.mp4');
  const tempDir    = path.join(productDir, '_temp_video');

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

  try {
    require('msedge-tts');
    console.log(`✅ msedge-tts พร้อม (voice: ${TTS_VOICE})\n`);
  } catch {
    console.error(`❌ ไม่พบ msedge-tts — รัน: npm install msedge-tts`);
    process.exit(1);
  }

  try {
    execFileSync(FFMPEG, ['-version'], { stdio: 'ignore', timeout: 10000 });
    console.log(`✅ FFmpeg พร้อม\n`);
  } catch {
    console.error(`❌ ไม่พบ FFmpeg — ดาวน์โหลดที่ https://ffmpeg.org/download.html`);
    process.exit(1);
  }

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

  const images = findProductImages(PRODUCTS_DIR, itemId);
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

  if (fs.existsSync(tempDir)) {
    fs.readdirSync(tempDir).forEach(f => { try { fs.unlinkSync(path.join(tempDir, f)); } catch {} });
  }
  fs.mkdirSync(tempDir, { recursive: true });

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

    process.stdout.write('     🔊 Edge TTS...');
    try {
      await generateVoiceover(scene.voiceover, audioPath);
    } catch (e) {
      process.stdout.write(` ❌ ${e.message.substring(0, 80)}\n`);
      throw e;
    }

    const audioDuration = getMediaDuration(audioPath);
    totalAudioSec += audioDuration;
    process.stdout.write(` ✓ (${audioDuration.toFixed(1)}s)\n`);

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

  console.log(`  🔗 Concat ${clipPaths.length} clips → video.mp4 (~${totalAudioSec.toFixed(0)}s)...`);
  concatClips(clipPaths, videoPath);

  try {
    fs.readdirSync(tempDir).forEach(f => { try { fs.unlinkSync(path.join(tempDir, f)); } catch {} });
    fs.rmdirSync(tempDir);
  } catch {}

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
}

module.exports = { run };

if (require.main === module) {
  const args   = process.argv.slice(2);
  const itemId = args.find(a => !a.startsWith('--'));
  const force  = args.includes('--force');

  if (!itemId) {
    console.error('Usage: node make-tiktok-video.js <item_id> [--force]');
    process.exit(1);
  }

  run(itemId, force).catch(e => {
    console.error(e.message || e);
    process.exit(1);
  });
}
