'use strict';
/**
 * comic.js — orchestrator: Story Prompt → 4-panel B&W manga Comic Strip → Telegram approval
 * gen panels (Typhoon2) → Flux Kontext still ต่อ panel (Mascot Ref anchor, B&W manga style)
 *   → ประกอบหน้า + Bubble → เขียน news/{id}/ (data.json + content/facebook.md + image.jpg)
 *   → ส่ง Telegram approval (immediate post mode, reuse namkhao bot infra — ADR-001)
 * output: gallery/{id}/comic.png (master) + pipeline/news/{id}/ (post.js-compatible)
 * dependency injection ผ่าน ctx: { COMFY_CFG, ROOT, GALLERY, NEWS_DIR, saveMeta }
 */

const fs   = require('fs');
const path = require('path');

const { generateComicPanels, generateFbCaption } = require('./comic-gen');
const { generateSceneStill } = require('../../../lib/flux-kontext');
const { uploadImageToComfy }  = require('../../../lib/comfy-client-core');
const { buildComicPage }     = require('./comic-build');
const { sendApprovalNotification } = require('../../../lib/tg-approval');
const { sendNotification }   = require('../../../lib/tg-notify');
const mascot = require('./mascot');

// B&W manga ink style — ผนวกเข้าทุก instruction (prompt-only, ไม่บังคับ grayscale — ADR ปมนี้ยังไม่มี, ดู CONTEXT.md)
const STYLE_SUFFIX = 'Black and white manga ink drawing style, clean simple lineart, minimal shading, ' +
  'no color, monochrome, screentone shading, full body visible, detailed background.';

// copy ไฟล์ PNG ต้นฉบับตรงๆ ไปที่ path image.jpg (post.js/tg-approval คาดหวังชื่อไฟล์นี้)
// — ไม่ re-encode เป็น JPEG จริง เพราะ @napi-rs/canvas ไม่ implement quality param
// (ลอง 0.5-1.0 ได้ byte size เท่ากันทุกค่า) imgBB/FB ตรวจ format จาก magic bytes ไม่ใช่นามสกุล จึงรับ PNG ได้ปกติ
function writeJpgCopy(pngPath, jpgPath) {
  fs.copyFileSync(pngPath, jpgPath);
}

/**
 * @param {object} ctx     { COMFY_CFG, ROOT, GALLERY, PIPELINE_ROOT, NEWS_DIR, saveMeta }
 * @param {object} params  { prompt, id }
 * @returns {Promise<object>} meta
 */
async function runComic(ctx, { prompt, id }) {
  const dir = path.join(ctx.GALLERY, id);
  fs.mkdirSync(dir, { recursive: true });
  const seed = Math.floor(Math.random() * 1e10);

  const mascotRef = mascot.refPath();
  if (!mascotRef) throw new Error('ยังไม่มี Mascot Ref — รัน --action gen-mascot-ref ก่อน');

  const meta = {
    id, prompt, mode: 'comic', created_at: new Date().toISOString(),
    status: 'producing', seed, panels: [], logs: [],
  };
  const log = msg => { meta.logs.push({ t: new Date().toISOString(), msg }); ctx.saveMeta(meta); console.log('  ' + msg); };
  const notify = text => sendNotification(text).catch(() => {});
  ctx.saveMeta(meta);
  console.log(`\n🥥 มะพร้าว — การ์ตูนขาวดำ 4 ช่อง\n📖 ${prompt}\n`);
  notify(`🥥 <b>เริ่มสร้างการ์ตูน</b>\n📖 ${(prompt || '').slice(0, 100)}`);

  log('🤖 สรุป concept + แตกเป็น panel...');
  const { concept, sharedSetting, panels, footerCaption } = await generateComicPanels(prompt);
  meta.concept = concept;
  meta.shared_setting = sharedSetting;
  meta.panels = panels;
  meta.footer_caption = footerCaption;
  log(`💡 Concept: ${concept.title}`);
  notify(`🤖 <b>Concept:</b> ${concept.title}`);
  ctx.saveMeta(meta);

  // upload mascot ref 1 ครั้ง แล้ว reuse filename ทุก panel (กัน 4× upload ของไฟล์เดิม)
  log('⬆️ อัปโหลด Mascot Ref...');
  const mascotFilename = await uploadImageToComfy(ctx.COMFY_CFG, mascotRef);

  const imagePaths = [];
  for (const p of panels) {
    const out = path.join(dir, `panel_${p.panel}.png`);
    log(`🎨 ช่อง ${p.panel}/${panels.length}: "${p.scene_setting_en.slice(0, 40)}..."`);
    notify(`🎨 กำลังสร้างช่อง ${p.panel}/${panels.length}`);
    await generateSceneStill(ctx.COMFY_CFG, [mascotRef], p.scene_setting_en, out,
      { seed: seed + p.panel, styleSuffix: STYLE_SUFFIX, lockLabel: 'maprao-img',
        _cachedFilenames: [mascotFilename] });
    imagePaths.push(out);
  }

  log('🖼️ ประกอบหน้าการ์ตูน...');
  const comicPath = path.join(dir, 'comic.png');
  await buildComicPage(panels, imagePaths, comicPath, { footerCaption });

  meta.status = 'pending_approval';
  meta.comic_image = 'comic.png';
  meta.done_at = new Date().toISOString();
  ctx.saveMeta(meta);
  log('✅ การ์ตูนพร้อม — กำลังส่ง Telegram approval...');

  // เขียน news/{id}/ ให้ตรง shape ที่ post.js + tg-approval คาดหวัง (reuse namkhao bot infra — ADR-001)
  const newsDir = path.join(ctx.NEWS_DIR, id);
  fs.mkdirSync(path.join(newsDir, 'content'), { recursive: true });
  const fbCaption = await generateFbCaption(concept, prompt);
  fs.writeFileSync(path.join(newsDir, 'content', 'facebook.md'), fbCaption);
  await writeJpgCopy(comicPath, path.join(newsDir, 'image.jpg'));
  const data = { title: concept.title, status: 'pending_approval', created_at: meta.created_at };
  fs.writeFileSync(path.join(newsDir, 'data.json'), JSON.stringify(data, null, 2));

  await sendApprovalNotification(id, data, fbCaption, {
    pipelineRoot: ctx.PIPELINE_ROOT,
    newsDir: ctx.NEWS_DIR,
    mode: 'immediate', emoji: '🥥', kind: 'การ์ตูนใหม่',
  });

  console.log(`✅ การ์ตูนพร้อม: ${comicPath}`);
  notify(`✅ <b>การ์ตูนพร้อมแล้ว!</b>\n📖 ${concept.title}\nดูที่ Dashboard แล้ว Approve`);
  return meta;
}

module.exports = { runComic };
