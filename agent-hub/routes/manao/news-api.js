'use strict';

const fs   = require('fs');
const path = require('path');

function handleConfig(req, res, method, AI_NEWS_DIR) {
  if (method === 'GET') {
    try {
      const cfgFile = path.join(AI_NEWS_DIR, 'config.json');
      const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(JSON.stringify({ filter: cfg.filter || {}, formatter: cfg.formatter || {} }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  // POST
  let body = '';
  res._claimed = true;
  req.on('data', d => body += d);
  req.on('end', () => {
    try {
      const incoming = JSON.parse(body || '{}');
      const cfgFile  = path.join(AI_NEWS_DIR, 'config.json');
      const clampInt = (v, min, max) => {
        let n = parseInt(v, 10); if (isNaN(n)) n = min;
        return Math.max(min, Math.min(max, n));
      };
      let cur = {};
      try { cur = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch {}
      cur.filter    = cur.filter    || {};
      cur.formatter = cur.formatter || {};

      const f = incoming.filter || {};
      if (f.minScore !== undefined) cur.filter.minScore = clampInt(f.minScore, 0, 100);
      if (f.weights) {
        cur.filter.weights = cur.filter.weights || {};
        ['high','medium','low'].forEach(k => {
          if (f.weights[k] !== undefined) cur.filter.weights[k] = clampInt(f.weights[k], 0, 1000);
        });
      }
      if (f.labels) {
        cur.filter.labels = cur.filter.labels || {};
        ['ai_tech','ai_biz','ai_policy'].forEach(k => {
          if (f.labels[k] !== undefined) cur.filter.labels[k] = clampInt(f.labels[k], 0, 100);
        });
      }
      if (f.keywords) {
        cur.filter.keywords = cur.filter.keywords || {};
        ['high','medium','low'].forEach(k => {
          if (Array.isArray(f.keywords[k]))
            cur.filter.keywords[k] = f.keywords[k].map(s => String(s).trim().toLowerCase()).filter(Boolean);
        });
      }

      const fm = incoming.formatter || {};
      if (Array.isArray(fm.skipStatus))
        cur.formatter.skipStatus = fm.skipStatus.map(s => String(s).trim()).filter(Boolean);
      if (fm.minScore !== undefined) cur.formatter.minScore = clampInt(fm.minScore, 0, 100);
      if (Array.isArray(fm.skipPlatforms))
        cur.formatter.skipPlatforms = fm.skipPlatforms.map(s => String(s).trim().toLowerCase()).filter(Boolean);

      fs.writeFileSync(cfgFile, JSON.stringify(cur, null, 2), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
}

function handleLogLive(req, res, AI_NEWS_DIR) {
  const logFile = path.join(AI_NEWS_DIR, 'pipeline.log');
  if (!fs.existsSync(logFile)) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({ lines: '', mtime: null, active: false }));
  }
  const stat  = fs.statSync(logFile);
  const mtime = stat.mtime.toISOString();
  const active = (Date.now() - stat.mtime.getTime()) < 5 * 60 * 1000;
  let content = fs.readFileSync(logFile, 'utf8');
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  const lines = content.split('\n').filter(Boolean).slice(-50).join('\n');
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify({ lines, mtime, active }));
}

function handleLog(req, res, AI_NEWS_DIR) {
  const logFile = path.join(AI_NEWS_DIR, 'pipeline.log');
  if (!fs.existsSync(logFile)) { res.writeHead(404); return res.end('No log'); }
  const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(lines.slice(-100).join('\n'));
}

function handleFacebookOrIgContent(req, res, url, rawUrl, AI_NEWS_DIR) {
  const params   = new URLSearchParams(rawUrl.split('?')[1] || '');
  const slug     = params.get('slug');
  const platform = url.includes('facebook') ? 'facebook' : 'instagram';
  if (!slug) { res.writeHead(400); return res.end('Missing slug'); }
  const filePath = path.join(AI_NEWS_DIR, 'news', slug, 'content', platform + '.md');
  if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(fs.readFileSync(filePath, 'utf8'));
}

function handleNewsImage(req, res, slug, AI_NEWS_DIR) {
  const imgPath = path.join(AI_NEWS_DIR, 'news', slug, 'image.jpg');
  if (!fs.existsSync(imgPath)) { res.writeHead(404); return res.end('No image'); }
  const img = fs.readFileSync(imgPath);
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': img.length, 'Cache-Control': 'no-cache' });
  res.end(img);
}

function handleGenerateImage(req, res, AI_NEWS_DIR) {
  let body = '';
  res._claimed = true;
  req.on('data', d => body += d);
  req.on('end', async () => {
    const { slug } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
    if (!slug) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Missing slug' }));
    }
    const dataPath = path.join(AI_NEWS_DIR, 'news', slug, 'data.json');
    if (!fs.existsSync(dataPath)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: `ไม่พบ news/${slug}/data.json` }));
    }
    try {
      const { execFileSync } = require('child_process');
      console.log(`[Hub] 🎨 Generate image: ${slug}`);
      execFileSync(process.execPath,
        [path.join(AI_NEWS_DIR, 'comfy-gen.js'), slug],
        { cwd: AI_NEWS_DIR, encoding: 'utf8', timeout: 4 * 60 * 1000 }
      );
      const imgPath = path.join(AI_NEWS_DIR, 'news', slug, 'image.jpg');
      const sizeKB  = fs.existsSync(imgPath) ? Math.round(fs.statSync(imgPath).size / 1024) : 0;
      console.log(`[Hub] ✅ Image generated: ${sizeKB} KB`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, sizeKB, message: `Generate สำเร็จ (${sizeKB} KB)` }));
    } catch (e) {
      const errMsg = (e.stdout || e.stderr || e.message || '').substring(0, 300);
      console.log(`[Hub] ❌ Generate failed: ${errMsg.substring(0, 80)}`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: errMsg }));
    }
  });
}

function handleGenerateForce(req, res, AI_NEWS_DIR) {
  let body = '';
  res._claimed = true;
  req.on('data', d => body += d);
  req.on('end', async () => {
    const { slug } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
    if (!slug) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Missing slug' }));
    }
    const dataPath = path.join(AI_NEWS_DIR, 'news', slug, 'data.json');
    if (!fs.existsSync(dataPath)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: `ไม่พบ news/${slug}/data.json` }));
    }
    try {
      const { execFileSync } = require('child_process');
      console.log(`[Hub] 🔄 Generate force: ${slug}`);
      // ถ้า AI_NEWS_DIR ไม่มี generate.js (เช่น makrut) → ใช้ของ manao + PIPELINE_ROOT env
      const MANAO_DIR   = path.resolve(__dirname, '..', '..', '..', 'agents', 'manao', 'pipeline');
      const genScript   = fs.existsSync(path.join(AI_NEWS_DIR, 'generate.js'))
        ? path.join(AI_NEWS_DIR, 'generate.js')
        : path.join(MANAO_DIR, 'generate.js');
      const genEnv      = genScript.startsWith(MANAO_DIR) && AI_NEWS_DIR !== MANAO_DIR
        ? { ...process.env, PIPELINE_ROOT: AI_NEWS_DIR }
        : process.env;
      const out = execFileSync(process.execPath,
        [genScript, slug, '--force', '--no-telegram'],
        { cwd: path.dirname(genScript), env: genEnv, encoding: 'utf8', timeout: 10 * 60 * 1000 }
      );
      const imgPath = path.join(AI_NEWS_DIR, 'news', slug, 'image.jpg');
      const hasImg  = fs.existsSync(imgPath);
      const sizeKB  = hasImg ? Math.round(fs.statSync(imgPath).size / 1024) : 0;
      console.log(`[Hub] ✅ Generate force complete: ${slug} img=${hasImg} ${sizeKB}KB`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, hasImage: hasImg, sizeKB, log: out.substring(0, 1000) }));
    } catch (e) {
      const errMsg = (e.stdout || e.stderr || e.message || '').substring(0, 400);
      console.log(`[Hub] ❌ Generate force failed: ${errMsg.substring(0, 80)}`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: errMsg }));
    }
  });
}

function handlePost(req, res, AI_NEWS_DIR) {
  const VALID_PLATFORMS = ['fb', 'ig', 'x', 'fb,ig', 'fb,ig,x', 'fb,x', 'ig,x'];
  let body = '';
  res._claimed = true;
  req.on('data', d => body += d);
  req.on('end', async () => {
    const json = (() => { try { return JSON.parse(body); } catch { return {}; } })();
    const { slug, platform } = json;
    if (!slug || !platform) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Missing slug or platform' }));
    }
    if (!VALID_PLATFORMS.includes(platform)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Invalid platform' }));
    }
    const dataPath = path.join(AI_NEWS_DIR, 'news', slug, 'data.json');
    if (!fs.existsSync(dataPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: `ไม่พบ news/${slug}/data.json` }));
    }
    try {
      const { execFileSync } = require('child_process');
      const out = execFileSync(process.execPath,
        [path.join(AI_NEWS_DIR, 'post.js'), slug, '--platform', platform],
        { cwd: AI_NEWS_DIR, encoding: 'utf8', timeout: 5 * 60 * 1000 });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, message: 'โพสต์สำเร็จ', output: out.substring(0, 500) }));
    } catch (e) {
      const errMsg = (e.stdout || e.stderr || e.message || '').substring(0, 300);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: errMsg }));
    }
  });
}

function handleContent(req, res, rawUrl, AI_NEWS_DIR) {
  const params   = new URLSearchParams(rawUrl.split('?')[1] || '');
  const slug     = params.get('slug');
  const platform = params.get('platform');
  if (!slug || !platform) { res.writeHead(400); return res.end('Missing slug or platform'); }
  const pfMap = { fb: 'facebook', ig: 'instagram', x: 'x', tiktok: 'tiktok' };
  const fname = pfMap[platform] || platform;
  const filePath = path.join(AI_NEWS_DIR, 'news', slug, 'content', fname + '.md');
  if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(fs.readFileSync(filePath, 'utf8'));
}

function handleRequestApproval(req, res, AI_NEWS_DIR, sendTelegramApproval) {
  let body = '';
  res._claimed = true;
  req.on('data', d => body += d);
  req.on('end', async () => {
    const json = (() => { try { return JSON.parse(body); } catch { return {}; } })();
    const { slug, platform } = json;
    if (!slug || !platform) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Missing slug or platform' }));
    }
    try {
      const result = await sendTelegramApproval(slug, platform);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, message: 'ส่งไปยัง Telegram แล้ว รอ Approve', ...result }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
}

module.exports = {
  handleConfig,
  handleLogLive,
  handleLog,
  handleFacebookOrIgContent,
  handleNewsImage,
  handleGenerateImage,
  handleGenerateForce,
  handlePost,
  handleContent,
  handleRequestApproval,
};
