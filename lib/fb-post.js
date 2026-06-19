'use strict';
/**
 * lib/fb-post.js — Facebook posting helpers
 *
 * ใช้งาน:
 *   const { postFbClip, postAllPlatforms } = require('./lib/fb-post');
 */

const http           = require('http');
const fs             = require('fs');
const path           = require('path');
const { execFileSync } = require('child_process');

const HUB_PORT = 3002;

/**
 * โพสต์ FB Clip ผ่าน agent-hub API (ถ้ามี video.mp4)
 */
function postFbClip(itemId) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ id: itemId });
    const req = http.request({
      hostname: 'localhost',
      port: HUB_PORT,
      path: '/dashboard/mali/api/post-fb-clip',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch { resolve({ ok: false, error: buf.substring(0, 100) }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(5 * 60 * 1000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

/**
 * โพสต์ FB schedule (+ FB Clip ถ้ามี video.mp4)
 * @param {string} itemId
 * @param {string} cwd - root directory ของโปรเจกต์
 * @returns {{ fb: string, ig: string, fbClip: string, error?: string }}
 */
async function postAllPlatforms(itemId, cwd = path.resolve(__dirname, '..')) {
  const results = {};

  try {
    const out = execFileSync(process.execPath, ['post.js', itemId, '--platform', 'fb', '--schedule'], {
      cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 10 * 1024 * 1024
    });
    const fbOk = out.includes('Facebook') && (out.includes('post_id') || out.includes('✅'));
    results.fb = fbOk ? '✅ Scheduled' : '⚠️ ไม่แน่ใจ';
    results.ig = '⏭ ข้าม (IG ไม่รองรับ schedule)';
    console.log(out);
  } catch (e) {
    const msg = (e.stdout || e.message || '').substring(0, 200);
    results.fb = '❌ ล้มเหลว';
    results.ig = '⏭ ข้าม';
    results.error = msg;
  }

  const videoPath = path.join(cwd, 'products', itemId, 'video.mp4');
  if (fs.existsSync(videoPath)) {
    const r = await postFbClip(itemId);
    results.fbClip = r.ok ? '✅ สำเร็จ' : `❌ ${(r.error || '').substring(0, 80)}`;
  } else {
    results.fbClip = '⏭ ไม่มี video.mp4';
  }

  return results;
}

module.exports = { postFbClip, postAllPlatforms };
