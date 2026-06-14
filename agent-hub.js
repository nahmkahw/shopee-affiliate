/**
 * agent-hub.js — Multi-Agent Control Hub  (port 3002)
 * รัน: node agent-hub.js
 * เปิด: http://localhost:3002
 *
 * รวม dashboard ทั้ง 3 ไว้ที่เดียว:
 *   /dashboard/mali   → Shopee Affiliate Dashboard
 *   /dashboard/manao  → Reuters AI News Dashboard
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const auth   = require('./auth');   // ระบบ login (รหัสเดียวร่วม + session cookie)
const { generateAnime } = require('./agents/anime/anime-gen');
const { overlayText }   = require('./agents/anime/text-overlay');
const { renderBalloonOnImage } = require('./agents/anime/balloon-canvas');
const { postFacebookImage, postInstagramImage } = require('./agents/anime/post-anime');

const PORT          = 3002;
const ROOT          = __dirname;                            // shopee-affiliate/
const AI_NEWS_DIR   = path.join(ROOT, 'agents', 'manao', 'pipeline');
const COMFYUI_HOST  = '10.3.17.118';
const COMFYUI_PORT  = 8188;
const STATUS_FILE = path.join(ROOT, 'agent-status.json');
const NODE_BIN    = '"C:\\Program Files\\nodejs\\node.exe"';

// ป้องกัน MaxListenersExceededWarning เมื่อ request หลาย concurrent เข้ามา
require('events').defaultMaxListeners = 50;

// ─── Pipeline Process Tracker (in-memory) ─────────────────────────────────────
// เก็บ PID ของ agent ที่กำลังรันอยู่ — null = ไม่ได้รัน
const pipelineProcs = {
  scrape: null, filter: null, editor: null, formatter: null, pipeline: null,
};

// สถานะ Pipeline แบบ step-by-step (อัปเดตตาม agent-hub sequential runner)
let pipelineStatus = null;

// ─── Pipeline Sequential Runner ──────────────────────────────────────────────

// Spawn 1 script และรอให้เสร็จ — resolve(elapsed) หรือ reject({ code, elapsed })
function spawnStep(scriptPath, stepArgs, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [scriptPath, ...stepArgs], {
      cwd, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const t0 = Date.now();
    const logFile = path.join(cwd, 'pipeline.log');
    const ts = () => new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    const append = chunk => {
      if (pipelineStatus) pipelineStatus.log += chunk;
      try { fs.appendFileSync(logFile, chunk, 'utf8'); } catch {}
    };
    proc.stdout.on('data', d => append(d.toString()));
    proc.stderr.on('data', d => append(d.toString()));
    proc.on('close', code => {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      if (code === 0) resolve(elapsed);
      else reject({ code, elapsed });
    });
    proc.on('error', err => reject({ code: -1, elapsed: '0', message: err.message }));
  });
}

async function runPipelineSequential(args) {
  if (pipelineProcs.pipeline !== null) return;  // กำลังรันอยู่

  const STEP_DEFS = [
    { id: 'scrape',    script: 'scrape.js',                              skipFlag: '--no-scrape',  runFlag: null,   name: 'Agent 1 Scrape',    icon: '📡', extraArgs: [] },
    { id: 'filter',    script: path.join('agents', 'filter-agent.js'),   skipFlag: '--no-filter',  runFlag: null,   name: 'Agent 2 Filter',    icon: '🔍', extraArgs: [] },
    { id: 'editor',    script: path.join('agents', 'editor-agent.js'),   skipFlag: '--no-edit',    runFlag: null,   name: 'Agent 3 Editor',    icon: '✍️', extraArgs: [] },
    { id: 'formatter', script: path.join('agents', 'formatter-agent.js'),skipFlag: '--no-format',  runFlag: null,   name: 'Agent 4 Formatter', icon: '📐', extraArgs: [] },
    { id: 'post',      script: 'post.js',                                skipFlag: null,           runFlag: '--post', name: 'Publisher Post',  icon: '🚀', extraArgs: ['--pending', '--platform', 'fb,ig'] },
  ];

  // สร้าง initial step status
  const steps = STEP_DEFS.map(s => ({
    id: s.id, name: s.name, icon: s.icon,
    status: (s.skipFlag && args.includes(s.skipFlag)) || (s.runFlag && !args.includes(s.runFlag))
      ? 'skipped' : 'pending',
    elapsed: null, error: null,
  }));

  pipelineStatus = { running: true, startedAt: new Date().toISOString(), steps, log: '', finishedAt: null };
  pipelineProcs.pipeline = -1;  // sentinel: pipeline active

  const logFile = path.join(AI_NEWS_DIR, 'pipeline.log');
  const ts = () => new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  try { fs.appendFileSync(logFile, `\n[${ts()}] === เริ่ม Pipeline (agent-hub sequential) ===\n`, 'utf8'); } catch {}

  for (let i = 0; i < STEP_DEFS.length; i++) {
    const step = steps[i];
    const def  = STEP_DEFS[i];
    if (step.status === 'skipped') continue;

    step.status = 'running';
    pipelineProcs[step.id] = -1;

    const scriptPath = path.join(AI_NEWS_DIR, def.script);
    const stepArgs   = [...def.extraArgs];
    if (def.id === 'post' && args.includes('--schedule')) stepArgs.push('--schedule');

    try {
      const elapsed  = await spawnStep(scriptPath, stepArgs, AI_NEWS_DIR);
      step.status    = 'done';
      step.elapsed   = elapsed;
    } catch (e) {
      step.status    = 'error';
      step.elapsed   = e.elapsed || '?';
      step.error     = e.message || `exit code ${e.code}`;
      // mark ที่เหลือ pending → skipped
      for (let j = i + 1; j < steps.length; j++) {
        if (steps[j].status === 'pending') steps[j].status = 'skipped';
      }
    } finally {
      pipelineProcs[step.id] = null;
    }

    if (step.status === 'error') break;
  }

  pipelineStatus.running     = false;
  pipelineStatus.finishedAt  = new Date().toISOString();
  pipelineProcs.pipeline     = null;
  try { fs.appendFileSync(logFile, `[${ts()}] === Pipeline เสร็จแล้ว ===\n`, 'utf8'); } catch {}
}

// ─── Agent Config ─────────────────────────────────────────────────────────────

const AGENTS = {
  mali: {
    label: 'มะลิ',
    role: 'Shopee Affiliate',
    color: '#FF6B35',
    colorLight: '#FFF3EE',
    emoji: '🌸',
    hasDashboard: true,
    actions: [
      { id: 'approve-today', label: '▶ Approve วันนี้',   icon: '✅' },
      { id: 'scrape',        label: '🔍 Scrape สินค้า',  icon: '🔍' },
      { id: 'create-content',label: '✍️ Create Content', icon: '✍️' },
      { id: 'status',        label: '📊 ดูสถานะ',        icon: '📊' },
    ],
  },
  manao: {
    label: 'มะนาว',
    role: 'Reuters AI News',
    color: '#4CAF50',
    colorLight: '#F1F8E9',
    emoji: '🍋',
    hasDashboard: true,
    actions: [
      { id: 'full',     label: '▶ Full Pipeline',    icon: '🚀' },
      { id: 'scrape',   label: '📡 ดึงข่าว Reuters',  icon: '📡' },
      { id: 'generate', label: '✍️ Generate Content', icon: '✍️' },
      { id: 'post',     label: '📤 Post FB+IG',       icon: '📤' },
      { id: 'status',   label: '📊 ดูสถานะ',          icon: '📊' },
    ],
  },
  namkhao: {
    label: 'น้ำข้าว',
    role: 'Supervisor',
    color: '#1565C0',
    colorLight: '#E3F2FD',
    emoji: '🌾',
    hasDashboard: true,
    actions: [
      { id: 'status',      label: '👀 ตรวจสอบ Agents',  icon: '👀' },
      { id: 'summary',     label: '📊 สรุปรายวัน',       icon: '📊' },
      { id: 'start-mali',  label: '▶ เริ่ม มะลิ',       icon: '🌸' },
      { id: 'start-manao', label: '▶ เริ่ม มะนาว',      icon: '🍋' },
    ],
  },
  anime: {
    label: 'อนิเมะ',
    role: 'Anime Image Generator',
    color: '#E91E8C',
    colorLight: '#FCE4EC',
    emoji: '🎌',
    hasDashboard: true,
    actions: [],
  },
};

// ─── Status helpers ───────────────────────────────────────────────────────────

function readStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); }
  catch { return { mali: { status: 'idle' }, manao: { status: 'idle' }, namkhao: { status: 'idle' } }; }
}

function writeStatus(s) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2), 'utf8');
}

function readLog(agentName, lines = 80) {
  const logFile = path.join(ROOT, 'agents', agentName, `${agentName}.log`);
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf8').split('\n').filter(l => l.trim()).slice(-lines);
}

// ─── Process Management ───────────────────────────────────────────────────────

const runningProcs = {};

function startAgent(name, action) {
  if (runningProcs[name] && !runningProcs[name].killed) {
    try { runningProcs[name].kill(); } catch {}
  }

  const scriptPath = path.join(ROOT, 'agents', name, 'run.js');
  const args = [scriptPath, '--action', action];

  let targetAction = 'status';
  if (action === 'start-mali')  targetAction = 'approve-today';
  if (action === 'start-manao') targetAction = 'full';
  if (action.startsWith('start-')) args.push('--target-action', targetAction);

  const child = spawn(process.execPath, args, { cwd: ROOT, shell: false });
  runningProcs[name] = child;

  const s = readStatus();
  s[name] = { ...s[name], status: 'running', currentAction: action, pid: child.pid, lastRun: new Date().toISOString() };
  writeStatus(s);

  child.on('close', code => {
    delete runningProcs[name];
    const st = readStatus();
    if (st[name]?.pid === child.pid) {
      st[name].status = code === 0 ? 'idle' : 'error';
      st[name].pid    = null;
      writeStatus(st);
    }
  });

  return child.pid;
}

function stopAgent(name) {
  const s = readStatus();
  const pid = s[name]?.pid || (runningProcs[name]?.pid);
  if (runningProcs[name] && !runningProcs[name].killed) {
    try { runningProcs[name].kill(); } catch {}
    delete runningProcs[name];
  }
  if (pid) { try { process.kill(Number(pid)); } catch {} }
  s[name] = { ...s[name], status: 'idle', pid: null };
  writeStatus(s);
}

// ─── ComfyUI Avatar Generator ────────────────────────────────────────────────

const NEG_PROMPT = 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, nsfw, nude, naked';

const OUTFIT_PROMPTS = {
  'นักเรียน': {
    f: 'serafuku, school uniform, white shirt, pleated skirt, red neckerchief, student',
    m: 'school uniform, blazer, student, necktie, school boy',
  },
  'ออฟฟิศ': {
    f: 'office lady, white shirt, pencil skirt, blazer, professional, business attire',
    m: 'business suit, white dress shirt, necktie, office worker, formal',
  },
  'มิโค': {
    f: 'miko, shrine maiden, red hakama, white haori, japanese traditional, shinto',
    m: 'shinto priest, white robe, hakama, japanese traditional, shrine priest',
  },
  'บัตเลอร์/เมด': {
    f: 'maid outfit, maid headdress, white apron, maid dress, frills',
    m: 'butler, black tailcoat, white gloves, formal butler uniform, bow tie',
  },
  'แนวต่อสู้': {
    f: 'fantasy armor, warrior girl, battle outfit, pauldrons, heroine, sword',
    m: 'fantasy armor, warrior, battle outfit, pauldrons, knight, sword',
  },
};

const GENDER_BASE = {
  f: '1girl, solo, female, portrait, upper body, looking at viewer, beautiful face, detailed eyes',
  m: '1boy, solo, male, portrait, upper body, looking at viewer, handsome, detailed eyes',
};

const STYLE_BASE = 'masterpiece, best quality, anime style, manga, vibrant colors, sharp details, professional illustration';

function buildComfyWorkflow(positivePrompt, seed) {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'AnythingXL_xl.safetensors' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: positivePrompt } },
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: NEG_PROMPT } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0],
        seed, steps: 25, cfg: 7, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1,
      },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'agentavatar' } },
  };
}

function comfyPost(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { hostname: COMFYUI_HOST, port: COMFYUI_PORT, path: urlPath, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      res => {
        let out = '';
        res.on('data', d => out += d);
        res.on('end', () => { try { resolve(JSON.parse(out)); } catch(e) { reject(e); } });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function comfyGet(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: COMFYUI_HOST, port: COMFYUI_PORT, path: urlPath }, res => {
      let out = '';
      res.on('data', d => out += d);
      res.on('end', () => { try { resolve(JSON.parse(out)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function comfyGetBinary(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: COMFYUI_HOST, port: COMFYUI_PORT, path: urlPath }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ data: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'image/png' }));
    }).on('error', reject);
  });
}

async function submitComfyJob(positivePrompt) {
  const seed      = Math.floor(Math.random() * 99999999999);
  const clientId  = crypto.randomUUID();
  const workflow  = buildComfyWorkflow(positivePrompt, seed);
  const result    = await comfyPost('/prompt', { client_id: clientId, prompt: workflow });
  return result.prompt_id;
}

async function getComfyJobResult(promptId) {
  const history = await comfyGet('/history/' + promptId);
  const job     = history[promptId];
  if (!job) return { status: 'pending' };
  if (job.status && job.status.status_str === 'error') return { status: 'error' };
  const outputs = job.outputs || {};
  const saveNode = outputs['7'];
  if (!saveNode || !saveNode.images || saveNode.images.length === 0) return { status: 'pending' };
  const img = saveNode.images[0];
  return {
    status: 'done',
    filename: img.filename,
    subfolder: img.subfolder || '',
    type: img.type || 'output',
    viewUrl: `/api/comfy-image?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder||'')}&type=${encodeURIComponent(img.type||'output')}`,
  };
}

// ─── Shopee Dashboard (มะลิ) ─────────────────────────────────────────────────

function loadProducts() {
  const baseDir = path.join(ROOT, 'products');
  if (!fs.existsSync(baseDir)) return [];
  return fs.readdirSync(baseDir)
    .filter(id => fs.existsSync(path.join(baseDir, id, 'data.json')))
    .map(id => {
      try {
        const data   = JSON.parse(fs.readFileSync(path.join(baseDir, id, 'data.json'), 'utf8'));
        const cDir   = path.join(baseDir, id, 'content');
        const imgDir = path.join(baseDir, id, 'images');
        const hasFB  = fs.existsSync(path.join(cDir, 'facebook.md'));
        const hasIG  = fs.existsSync(path.join(cDir, 'instagram.md'));
        const hasX   = fs.existsSync(path.join(cDir, 'x.md'));
        const hasTT  = fs.existsSync(path.join(cDir, 'tiktok.md'));
        const imgFile  = ['1.jpg','2.jpg','3.jpg'].map(f => path.join(imgDir, f)).find(f => fs.existsSync(f));
        const videoFile = path.join(baseDir, id, 'video.mp4');
        const hasVideo  = fs.existsSync(videoFile);
        const videoSizeKB = hasVideo ? Math.round(fs.statSync(videoFile).size / 1024) : 0;
        const isPosted = data.status === 'posted';
        const postedPlatforms = Array.isArray(data.posted_platforms) ? data.posted_platforms : [];
        let postedAtStr = '';
        if (data.posted_at) {
          try { postedAtStr = new Date(data.posted_at).toLocaleString('th-TH', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); } catch {}
        }
        return {
          id,
          post_date: data.post_date || '',
          title: data.title || '',
          price: data.price || '',
          original_price: data.original_price || '',
          discount: data.discount || '',
          rating: data.rating || '',
          shop_name: data.shop_name || '',
          affiliate_link: data.affiliate_short_link || '',
          status: data.status || '',
          isPosted, postedPlatforms, postedAtStr,
          hasFB, hasIG, hasX, hasTT,
          hasAllContent: hasFB && hasIG && hasX && hasTT,
          hasImg: !!imgFile,
          imgPath: imgFile ? `/img/${id}/${path.basename(imgFile)}` : null,
          hasVideo, videoSizeKB,
        };
      } catch { return null; }
    })
    .filter(p => p && p.status !== 'placeholder')
    .sort((a, b) => a.post_date.localeCompare(b.post_date));
}

function readShopeeEnv() {
  try {
    const lines = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n');
    const env = {};
    for (const line of lines) {
      const m = line.match(/^\s*([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return env;
  } catch { return {}; }
}

// อัปโหลดวิดีโอ → Facebook Reels (3 ขั้นตอน: start → upload → finish)
async function uploadFBReels(itemId) {
  const https = require('https');
  const env = readShopeeEnv();
  const FB_PAGE_ID      = env.FB_PAGE_ID;
  const USER_TOKEN      = env.FB_ACCESS_TOKEN;
  if (!FB_PAGE_ID || !USER_TOKEN)
    throw new Error('ขาด FB_PAGE_ID หรือ FB_ACCESS_TOKEN ใน .env');

  // Reels API ต้องการ Page Access Token (ไม่ใช่ User Token)
  const pageTokenRes = await new Promise((resolve, reject) => {
    const qs = `fields=access_token&access_token=${encodeURIComponent(USER_TOKEN)}`;
    https.get({ hostname: 'graph.facebook.com', path: `/v19.0/${FB_PAGE_ID}?${qs}` }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error('Page token parse error')); } });
    }).on('error', reject);
  });
  if (pageTokenRes.error) throw new Error(`ดึง Page Token ไม่สำเร็จ: ${pageTokenRes.error.message}`);
  const FB_ACCESS_TOKEN = pageTokenRes.access_token || USER_TOKEN;

  const videoPath = path.join(ROOT, 'products', itemId, 'video.mp4');
  if (!fs.existsSync(videoPath))
    throw new Error(`ไม่พบ products/${itemId}/video.mp4 — สร้างวิดีโอก่อน`);

  const fbContentPath = path.join(ROOT, 'products', itemId, 'content', 'facebook.md');
  const description   = fs.existsSync(fbContentPath)
    ? fs.readFileSync(fbContentPath, 'utf8').trim().substring(0, 2200)
    : '';

  const videoData = fs.readFileSync(videoPath);
  const fileSize  = videoData.length;
  const sizeKB    = Math.round(fileSize / 1024);

  // helper: POST JSON to graph.facebook.com
  function graphPost(apiPath, bodyObj) {
    return new Promise((resolve, reject) => {
      const bodyStr = JSON.stringify(bodyObj);
      const req = https.request({
        hostname: 'graph.facebook.com',
        path: apiPath,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
      }, res => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error('Parse error: ' + buf.substring(0, 200))); } });
      });
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('graph.facebook.com timeout')); });
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });
  }

  // ── Step 1: Initialize Reel upload ─────────────────────────────────────────
  console.log(`[Hub] 🎬 Reels Step 1/3: initialize (${sizeKB}KB)`);
  const step1 = await graphPost(`/v19.0/${FB_PAGE_ID}/video_reels`, {
    upload_phase:    'start',
    video_file_size: fileSize,
    access_token:    FB_ACCESS_TOKEN,
  });
  if (step1.error) throw new Error(`Reels init: ${step1.error.message}`);
  const { video_id, upload_url } = step1;
  if (!video_id || !upload_url)
    throw new Error(`Reels init: ไม่ได้รับ video_id/upload_url — ${JSON.stringify(step1)}`);

  // ── Step 2: Upload video binary ────────────────────────────────────────────
  console.log(`[Hub] 🎬 Reels Step 2/3: uploading video binary...`);
  const uploadUrlObj = new URL(upload_url);
  await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: uploadUrlObj.hostname,
      path:     uploadUrlObj.pathname + uploadUrlObj.search,
      method:   'POST',
      headers: {
        'Authorization': `OAuth ${FB_ACCESS_TOKEN}`,
        'offset':        '0',
        'file_size':     String(fileSize),
        'Content-Type':  'application/octet-stream',
        'Content-Length': fileSize,
      },
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          if (j.success) resolve(j);
          else reject(new Error('Video upload failed: ' + JSON.stringify(j).substring(0, 200)));
        } catch { reject(new Error('Upload response error: ' + buf.substring(0, 200))); }
      });
    });
    req.setTimeout(10 * 60 * 1000, () => { req.destroy(); reject(new Error('Video upload timeout (10 min)')); });
    req.on('error', reject);
    req.write(videoData);
    req.end();
  });

  // ── Step 3: Publish Reel ───────────────────────────────────────────────────
  console.log(`[Hub] 🎬 Reels Step 3/3: publishing...`);
  const step3 = await graphPost(`/v19.0/${FB_PAGE_ID}/video_reels`, {
    upload_phase: 'finish',
    video_id,
    video_state:  'PUBLISHED',
    description,
    access_token: FB_ACCESS_TOKEN,
  });
  if (step3.error) throw new Error(`Reels publish: ${step3.error.message}`);
  if (!step3.success) throw new Error(`Reels publish ไม่สำเร็จ: ${JSON.stringify(step3)}`);

  return { id: video_id, sizeKB };
}

function serveProductImage(res, itemId, filename) {
  const filePath = path.join(ROOT, 'products', itemId, 'images', filename);
  if (!fs.existsSync(filePath)) { res.writeHead(404); res.end(); return; }
  const ext  = path.extname(filename).toLowerCase();
  const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  res.writeHead(200, { 'Content-Type': mime[ext] || 'image/jpeg' });
  fs.createReadStream(filePath).pipe(res);
}

function buildShopeeHTML(products) {
  const today     = new Date().toISOString().slice(0, 10);
  const total     = products.length;
  const posted    = products.filter(p => p.isPosted).length;
  const ready     = products.filter(p => p.hasAllContent && !p.isPosted).length;
  const noContent = products.filter(p => !p.hasFB && !p.isPosted).length;
  const fbCount   = products.filter(p => p.hasFB).length;
  const igCount   = products.filter(p => p.hasIG).length;
  const xCount    = products.filter(p => p.hasX).length;
  const ttCount   = products.filter(p => p.hasTT).length;
  const todayPrd  = products.filter(p => p.post_date === today).length;

  const dates = [...new Set(products.map(p => p.post_date))];

  const rows = products.map(p => {
    const isPast  = p.post_date < today;
    const isToday = p.post_date === today;
    const dateClass = isToday ? 'color:#1D4ED8;font-weight:bold' : isPast ? 'color:#9CA3AF' : 'color:#374151';
    const badge = isToday ? '<span style="margin-left:4px;padding:1px 6px;background:#3B82F6;color:white;font-size:11px;border-radius:999px">วันนี้</span>' : '';
    const icon = v => v
      ? '<span style="color:#10B981;font-size:16px">✅</span>'
      : '<span style="color:#D1D5DB;font-size:16px">○</span>';
    const img = p.imgPath
      ? `<img src="${p.imgPath}" style="width:48px;height:48px;object-fit:cover;border-radius:8px" loading="lazy" onerror="this.style.display='none'">`
      : `<div style="width:48px;height:48px;background:#F3F4F6;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#9CA3AF">ไม่มีรูป</div>`;
    const discBadge = p.discount
      ? `<span style="margin-left:4px;font-size:11px;background:#FEE2E2;color:#DC2626;padding:1px 5px;border-radius:4px">${p.discount}</span>` : '';
    const statusBadge = p.isPosted
      ? `<div><span style="padding:2px 8px;background:#F3E8FF;color:#7C3AED;font-size:11px;border-radius:999px;font-weight:600">✅ โพสต์แล้ว</span>
         ${p.postedPlatforms.length ? `<div style="font-size:11px;color:#A78BFA;margin-top:2px">${p.postedPlatforms.join(', ')}</div>` : ''}
         ${p.postedAtStr ? `<div style="font-size:11px;color:#9CA3AF">${p.postedAtStr}</div>` : ''}</div>`
      : p.hasAllContent ? '<span style="padding:2px 8px;background:#D1FAE5;color:#065F46;font-size:11px;border-radius:999px">พร้อม</span>'
      : p.hasFB ? '<span style="padding:2px 8px;background:#FEF3C7;color:#92400E;font-size:11px;border-radius:999px">บางส่วน</span>'
      : '<span style="padding:2px 8px;background:#FEE2E2;color:#991B1B;font-size:11px;border-radius:999px">รอ content</span>';
    const rowBg = p.isPosted ? 'background:#FAF5FF' : isToday ? 'background:#EFF6FF' : '';
    const canView  = p.hasFB || p.hasIG || p.hasTT;
    const canVideo = p.hasTT; // ต้องมี tiktok.md ก่อน
    const btnStyle = 'background:none;border:1px solid #D1D5DB;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:13px;transition:all 0.15s;margin:0 2px';
    return `<tr style="border-bottom:1px solid #F3F4F6;${rowBg}" data-date="${p.post_date}" data-status="${p.isPosted ? 'posted' : p.hasAllContent ? 'ready' : p.hasFB ? 'partial' : 'none'}">
      <td style="padding:10px 12px;white-space:nowrap;font-size:13px;${dateClass}">${p.post_date}${badge}</td>
      <td style="padding:10px 12px">${img}</td>
      <td style="padding:10px 12px;max-width:240px">
        <a href="${p.affiliate_link}" target="_blank" style="font-size:13px;font-weight:500;color:#1F2937;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(p.title)}">${escHtml(p.title.substring(0,60))}${p.title.length>60?'…':''}</a>
        <div style="font-size:11px;color:#9CA3AF;margin-top:2px">${escHtml(p.shop_name)}</div>
      </td>
      <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#1F2937;white-space:nowrap">
        ${escHtml(p.price)}${discBadge}
        ${p.original_price ? `<div style="font-size:11px;color:#9CA3AF;text-decoration:line-through">${escHtml(p.original_price)}</div>` : ''}
      </td>
      <td style="padding:10px 12px;text-align:center">${p.rating ? `<span style="font-size:13px;font-weight:500;color:#D97706">⭐ ${p.rating}</span>` : '<span style="color:#D1D5DB">—</span>'}</td>
      <td style="padding:10px 12px;text-align:center">${icon(p.hasFB)}</td>
      <td style="padding:10px 12px;text-align:center">${icon(p.hasIG)}</td>
      <td style="padding:10px 12px;text-align:center">${icon(p.hasX)}</td>
      <td style="padding:10px 12px;text-align:center">${icon(p.hasTT)}</td>
      <td style="padding:10px 12px">${statusBadge}</td>
      <td style="padding:10px 12px;text-align:center;white-space:nowrap">
        ${canView ? `<button style="${btnStyle}" data-id="${p.id}" data-title="${escHtml(p.title)}" onclick="openViewFromEl(this)" title="ดู content" onmouseover="this.style.background='#EFF6FF';this.style.borderColor='#3B82F6'" onmouseout="this.style.background='none';this.style.borderColor='#D1D5DB'">👁</button>` : ''}
        <button style="${btnStyle}" data-id="${p.id}" data-title="${escHtml(p.title)}" onclick="openRegenFromEl(this)" title="Generate content ใหม่ (--force)" onmouseover="this.style.background='#FFF7ED';this.style.borderColor='#F97316'" onmouseout="this.style.background='none';this.style.borderColor='#D1D5DB'">🔄</button>
        ${canVideo ? `<button style="${btnStyle}${p.hasVideo ? ';border-color:#10B981' : ''}" data-id="${p.id}" data-title="${escHtml(p.title)}" data-has-video="${p.hasVideo}" data-video-kb="${p.videoSizeKB}" onclick="openVideoFromEl(this)" title="${p.hasVideo ? 'วิดีโอมีแล้ว '+p.videoSizeKB+'KB — คลิกเพื่อสร้างใหม่' : 'สร้างวิดีโอ TikTok (ComfyUI + FFmpeg)'}" onmouseover="this.style.background='#F0FDF4';this.style.borderColor='#10B981'" onmouseout="this.style.background='none';this.style.borderColor='${p.hasVideo ? '#10B981' : '#D1D5DB'}'">🎬${p.hasVideo ? '✅' : ''}</button>` : ''}
        ${(p.hasFB || p.hasIG || p.hasVideo) ? `<button style="${btnStyle};border-color:#7C3AED" data-id="${p.id}" data-title="${escHtml(p.title)}" data-has-fb="${p.hasFB}" data-has-ig="${p.hasIG}" data-has-video="${p.hasVideo}" data-video-kb="${p.videoSizeKB}" onclick="openPostFromEl(this)" title="โพสต์ไปยัง Facebook / FB Clip / Instagram" onmouseover="this.style.background='#F5F3FF';this.style.borderColor='#6D28D9'" onmouseout="this.style.background='none';this.style.borderColor='#7C3AED'">📤</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  const pBar = (count, color) => `<div style="height:8px;background:#F3F4F6;border-radius:999px;margin-top:4px">
    <div style="height:8px;border-radius:999px;background:${color};width:${total ? Math.round(count/total*100) : 0}%;transition:width 0.8s"></div></div>`;

  const timeline = dates.map(date => {
    const dayP      = products.filter(p => p.post_date === date);
    const dayPosted = dayP.filter(p => p.isPosted).length;
    const dayReady  = dayP.filter(p => p.hasAllContent).length;
    const isToday   = date === today;
    const allPosted = dayPosted === dayP.length && dayP.length > 0;
    const pct       = dayP.length ? Math.round(dayReady/dayP.length*100) : 0;
    const dotColor  = allPosted ? '#8B5CF6' : pct===100 ? '#10B981' : pct>0 ? '#FBBF24' : '#E5E7EB';
    const barColor  = allPosted ? '#8B5CF6' : pct===100 ? '#10B981' : '#F97316';
    const textColor = isToday ? '#1D4ED8' : allPosted ? '#7C3AED' : date<today ? '#9CA3AF' : '#374151';
    const label     = allPosted ? ' ✅' : isToday ? ' 📍' : '';
    return `<div style="display:flex;align-items:center;gap:10px;padding:4px 0${isToday ? ';background:#EFF6FF;border-radius:8px;padding:4px 6px;margin:0 -6px' : allPosted ? ';background:#FAF5FF;border-radius:8px;padding:4px 6px;margin:0 -6px' : ''}">
      <div style="width:10px;height:10px;border-radius:50%;background:${dotColor};flex-shrink:0"></div>
      <span style="font-size:12px;color:${textColor};width:100px;flex-shrink:0">${date}${label}</span>
      <div style="flex:1;background:#F3F4F6;border-radius:999px;height:6px">
        <div style="height:6px;border-radius:999px;background:${barColor};width:${pct}%"></div></div>
      <span style="font-size:11px;color:${allPosted?'#7C3AED':'#9CA3AF'};width:68px;text-align:right">${dayPosted>0?dayPosted+'โพสต์/':''}${dayReady}/${dayP.length}</span>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>🌸 Shopee Affiliate Dashboard</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap');
*{font-family:'Sarabun',sans-serif;box-sizing:border-box;margin:0;padding:0}
body{background:#F9FAFB;min-height:100vh}
table{width:100%;border-collapse:collapse}
thead th{padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;background:#F9FAFB}
tbody tr:hover{background:#F9FAFB!important}
::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:#F3F4F6}::-webkit-scrollbar-thumb{background:#D1D5DB;border-radius:3px}
.filter-btn{padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:none;font-family:inherit;transition:all 0.15s}
</style>
</head>
<body>
<div style="background:linear-gradient(135deg,#FF6B35,#FF8C42);color:white;padding:16px 24px;display:flex;align-items:center;justify-content:space-between">
  <div style="display:flex;align-items:center;gap:10px">
    <span style="font-size:22px">🛍️</span>
    <div>
      <div style="font-size:17px;font-weight:700">Shopee Affiliate Dashboard</div>
      <div style="font-size:12px;opacity:0.85">วันนี้: ${today}</div>
    </div>
  </div>
  <button onclick="location.reload()" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);color:white;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-family:inherit">🔄 รีเฟรช</button>
</div>

<div style="max-width:1200px;margin:20px auto;padding:0 20px;display:flex;flex-direction:column;gap:16px">

  <!-- Stats -->
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px">
    <div style="background:white;border-radius:16px;padding:16px;border:1px solid #E5E7EB">
      <div style="font-size:28px;font-weight:700;color:#1F2937">${total}</div>
      <div style="font-size:12px;color:#6B7280;margin-top:2px">สินค้าทั้งหมด</div>
      <div style="font-size:11px;color:#3B82F6;margin-top:2px">วันนี้ ${todayPrd} รายการ</div>
    </div>
    <div style="background:white;border-radius:16px;padding:16px;border:2px solid #E9D5FF">
      <div style="font-size:28px;font-weight:700;color:#7C3AED">${posted}</div>
      <div style="font-size:12px;color:#6B7280;margin-top:2px">โพสต์แล้ว</div>
      <div style="font-size:11px;color:#A78BFA;margin-top:2px">${total ? Math.round(posted/total*100) : 0}% ของทั้งหมด</div>
    </div>
    <div style="background:white;border-radius:16px;padding:16px;border:1px solid #E5E7EB">
      <div style="font-size:28px;font-weight:700;color:#059669">${ready}</div>
      <div style="font-size:12px;color:#6B7280;margin-top:2px">Content พร้อม</div>
      <div style="font-size:11px;color:#10B981;margin-top:2px">รอโพสต์</div>
    </div>
    <div style="background:white;border-radius:16px;padding:16px;border:1px solid #E5E7EB">
      <div style="font-size:28px;font-weight:700;color:#EF4444">${noContent}</div>
      <div style="font-size:12px;color:#6B7280;margin-top:2px">รอสร้าง Content</div>
      <div style="font-size:11px;color:#FCA5A5;margin-top:2px">ยังไม่มี facebook.md</div>
    </div>
    <div style="background:white;border-radius:16px;padding:16px;border:1px solid #E5E7EB">
      <div style="font-size:28px;font-weight:700;color:#F97316">${total-posted-ready-noContent}</div>
      <div style="font-size:12px;color:#6B7280;margin-top:2px">Content บางส่วน</div>
      <div style="font-size:11px;color:#FDBA74;margin-top:2px">มีบาง platform</div>
    </div>
  </div>

  <!-- Platform + Timeline -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    <div style="background:white;border-radius:16px;padding:18px;border:1px solid #E5E7EB">
      <div style="font-size:14px;font-weight:600;color:#374151;margin-bottom:14px">📊 สถิติ Content แต่ละ Platform</div>
      ${[['📘 Facebook',fbCount,'#3B82F6'],['📷 Instagram',igCount,'#EC4899'],['🐦 X',xCount,'#1F2937'],['🎵 TikTok',ttCount,'#EF4444']].map(([name,count,color])=>`
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-size:13px;color:#6B7280">${name}</span>
          <span style="font-size:13px;font-weight:600;color:#1F2937">${count} / ${total}</span>
        </div>${pBar(count,color)}</div>`).join('')}
    </div>
    <div style="background:white;border-radius:16px;padding:18px;border:1px solid #E5E7EB">
      <div style="font-size:14px;font-weight:600;color:#374151;margin-bottom:14px">📅 Timeline โพสต์</div>
      <div style="display:flex;flex-direction:column;gap:2px;max-height:200px;overflow-y:auto">${timeline}</div>
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid #F3F4F6;display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:#9CA3AF">
        <span>🟣 โพสต์แล้ว</span><span>🟢 ครบ</span><span>🟡 บางส่วน</span><span>⚪ รอ</span>
      </div>
    </div>
  </div>

  <!-- Table -->
  <div style="background:white;border-radius:16px;border:1px solid #E5E7EB;overflow:hidden">
    <div style="padding:14px 20px;border-bottom:1px solid #F3F4F6;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px">
      <div style="font-size:14px;font-weight:600;color:#374151">📋 รายการสินค้าทั้งหมด</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        <button class="filter-btn" id="btn-all"    onclick="filterTable('all')"    style="background:#FF6B35;color:white">ทั้งหมด (${total})</button>
        <button class="filter-btn" id="btn-today"  onclick="filterTable('today')"  style="background:#F3F4F6;color:#6B7280">วันนี้ (${todayPrd})</button>
        <button class="filter-btn" id="btn-ready"  onclick="filterTable('ready')"  style="background:#F3F4F6;color:#6B7280">✅ พร้อม (${ready})</button>
        <button class="filter-btn" id="btn-posted" onclick="filterTable('posted')" style="background:#F3F4F6;color:#6B7280">🟣 โพสต์แล้ว (${posted})</button>
        <button class="filter-btn" id="btn-none"   onclick="filterTable('none')"   style="background:#F3F4F6;color:#6B7280">⚠️ รอ Content (${noContent})</button>
      </div>
    </div>
    <div style="overflow-x:auto">
      <table id="product-table">
        <thead><tr>
          <th>วันที่โพสต์</th><th>รูป</th><th>ชื่อสินค้า</th><th>ราคา</th>
          <th style="text-align:center">คะแนน</th><th style="text-align:center">FB</th>
          <th style="text-align:center">IG</th><th style="text-align:center">X</th>
          <th style="text-align:center">TikTok</th><th>สถานะ</th>
          <th style="text-align:center;min-width:76px">Actions</th>
        </tr></thead>
        <tbody id="table-body">${rows}</tbody>
      </table>
    </div>
    <div style="padding:10px 20px;background:#F9FAFB;border-top:1px solid #F3F4F6;font-size:11px;color:#9CA3AF">
      รีเฟรชล่าสุด: ${new Date().toLocaleString('th-TH')} — <span id="visible-count">${total}</span> รายการ
    </div>
  </div>
</div>

<script>
const today = '${today}';
function filterTable(filter) {
  const rows = document.querySelectorAll('#table-body tr');
  let visible = 0;
  rows.forEach(r => {
    const show = filter==='all' ? true : filter==='today' ? r.dataset.date===today
      : filter==='posted' ? r.dataset.status==='posted' : filter==='ready' ? r.dataset.status==='ready'
      : r.dataset.status==='none';
    r.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  document.getElementById('visible-count').textContent = visible;
  document.querySelectorAll('.filter-btn').forEach(b => { b.style.background='#F3F4F6'; b.style.color='#6B7280'; });
  const a = document.getElementById('btn-'+filter);
  if (a) { a.style.background='#FF6B35'; a.style.color='white'; }
}
setTimeout(() => location.reload(), 60000);

// ══════════════════════════════════════════════
//  มะลิ: View Content Modal
// ══════════════════════════════════════════════
let _maliViewId   = '';
let _maliRegenId  = '';
let _maliVideoId  = '';
let _maliRegenBusy  = false;
let _maliVideoBusy  = false;
let _maliPostId     = '';
let _maliPostBusy   = false;

function openViewFromEl(el) { openMaliView(el.dataset.id, el.dataset.title); }
function openRegenFromEl(el) { openMaliRegen(el.dataset.id, el.dataset.title); }
function openPostFromEl(el) {
  openMaliPost(el.dataset.id, el.dataset.title,
    el.dataset.hasFb === 'true', el.dataset.hasIg === 'true',
    el.dataset.hasVideo === 'true', parseInt(el.dataset.videoKb) || 0);
}

function openMaliView(id, title) {
  _maliViewId = id;
  document.getElementById('mali-view-title').textContent = title;
  document.getElementById('mali-view-modal').style.display = 'block';
  document.body.style.overflow = 'hidden';
  switchMaliTab('fb');
}
function closeMaliView() {
  document.getElementById('mali-view-modal').style.display = 'none';
  document.body.style.overflow = '';
}
async function switchMaliTab(tab) {
  ['fb','ig','tiktok'].forEach(t => {
    const el = document.getElementById('mali-vtab-'+t);
    if (!el) return;
    const active = t === tab;
    el.style.borderBottom = active ? '3px solid #FF6B35' : '3px solid transparent';
    el.style.color = active ? '#FF6B35' : '#6B7280';
    el.style.fontWeight = active ? '700' : '500';
    el.style.background = active ? 'white' : 'transparent';
  });
  const pre = document.getElementById('mali-view-pre');
  pre.textContent = 'กำลังโหลด...';
  try {
    const r = await fetch('/dashboard/mali/api/content?id=' + encodeURIComponent(_maliViewId) + '&platform=' + tab);
    if (!r.ok) { pre.textContent = '⚠️ ไม่พบไฟล์ content สำหรับ platform นี้'; return; }
    pre.textContent = await r.text();
  } catch(e) { pre.textContent = '❌ ' + e.message; }
}

// ══════════════════════════════════════════════
//  มะลิ: Generate Force Modal
// ══════════════════════════════════════════════
function openMaliRegen(id, title) {
  if (_maliRegenBusy) return;
  _maliRegenId = id;
  document.getElementById('mali-regen-item-title').textContent = title;
  document.getElementById('mali-regen-modal').style.display = 'block';
  document.body.style.overflow = 'hidden';
  // reset state
  document.getElementById('mali-regen-spinner').style.display = 'none';
  document.getElementById('mali-regen-result').style.display = 'none';
  document.getElementById('mali-regen-start-btn').style.display = 'inline-block';
  document.getElementById('mali-regen-close-btn').disabled = false;
}
function closeMaliRegen() {
  if (_maliRegenBusy) return;
  document.getElementById('mali-regen-modal').style.display = 'none';
  document.body.style.overflow = '';
}
async function startMaliRegen() {
  _maliRegenBusy = true;
  document.getElementById('mali-regen-start-btn').style.display = 'none';
  document.getElementById('mali-regen-spinner').style.display = 'block';
  document.getElementById('mali-regen-result').style.display = 'none';
  document.getElementById('mali-regen-close-btn').disabled = true;

  const steps = [
    'กำลังส่งคำสั่งไปยัง Ollama...',
    '🤖 Ollama กำลัง Generate Facebook content...',
    '📸 Ollama กำลัง Generate Instagram content...',
    '🎵 Ollama กำลัง Generate TikTok script...',
    '⏳ รอ Ollama ทำงาน (อาจใช้เวลา 2-5 นาที)...',
  ];
  let si = 0;
  const stepEl = document.getElementById('mali-regen-step');
  if (stepEl) stepEl.textContent = steps[0];
  const stepTimer = setInterval(() => {
    si = (si + 1) % steps.length;
    if (stepEl) stepEl.textContent = steps[si];
  }, 35000);

  try {
    const r = await fetch('/dashboard/mali/api/generate-force', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: _maliRegenId }),
    });
    const j = await r.json();
    clearInterval(stepTimer);
    document.getElementById('mali-regen-spinner').style.display = 'none';
    document.getElementById('mali-regen-result').style.display = 'block';
    if (j.ok) {
      document.getElementById('mali-regen-result').innerHTML =
        '<div style="color:#10B981;font-weight:700;margin-bottom:8px;font-size:14px">✅ Generate สำเร็จ!</div>' +
        (j.log ? '<pre style="background:#F0FFF4;border:1px solid #A7F3D0;border-radius:8px;padding:10px;font-size:11px;max-height:180px;overflow-y:auto;white-space:pre-wrap;font-family:monospace">' + j.log.replace(/</g,'&lt;') + '</pre>' : '');
      showMaliToast('✅ Generate content (FB+IG+TikTok) สำเร็จ!');
      setTimeout(() => location.reload(), 2000);
    } else {
      document.getElementById('mali-regen-result').innerHTML =
        '<div style="color:#EF4444;font-weight:700;margin-bottom:8px;font-size:14px">❌ เกิดข้อผิดพลาด</div>' +
        '<pre style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:10px;font-size:11px;max-height:180px;overflow-y:auto;white-space:pre-wrap;font-family:monospace">' + (j.error||'').replace(/</g,'&lt;') + '</pre>';
    }
  } catch(e) {
    clearInterval(stepTimer);
    document.getElementById('mali-regen-spinner').style.display = 'none';
    document.getElementById('mali-regen-result').style.display = 'block';
    document.getElementById('mali-regen-result').innerHTML = '<div style="color:#EF4444;font-weight:700">❌ ' + e.message + '</div>';
  }
  _maliRegenBusy = false;
  document.getElementById('mali-regen-start-btn').style.display = 'inline-block';
  document.getElementById('mali-regen-close-btn').disabled = false;
}

// ══════════════════════════════════════════════
//  มะลิ: Create Video Modal (ComfyUI + FFmpeg)
// ══════════════════════════════════════════════
function openVideoFromEl(el) { openMaliVideo(el.dataset.id, el.dataset.title, el.dataset.hasVideo === 'true', parseInt(el.dataset.videoKb)||0); }

function openMaliVideo(id, title, hasVideo, videoKb) {
  if (_maliVideoBusy) return;
  _maliVideoId = id;
  document.getElementById('mali-video-item-title').textContent = title;
  document.getElementById('mali-video-modal').style.display = 'block';
  document.body.style.overflow = 'hidden';
  // reset
  document.getElementById('mali-video-spinner').style.display = 'none';
  document.getElementById('mali-video-result').style.display = 'none';
  const startBtn = document.getElementById('mali-video-start-btn');
  startBtn.style.display = 'inline-block';
  startBtn.textContent = hasVideo ? '🔄 สร้างวิดีโอใหม่ (--force)' : '🎬 สร้างวิดีโอ';
  document.getElementById('mali-video-close-btn').disabled = false;
  // existing video indicator
  const existEl = document.getElementById('mali-video-existing');
  if (hasVideo && videoKb > 0) {
    const kb = videoKb; const mb = (kb/1024).toFixed(1);
    existEl.innerHTML = '✅ มีวิดีโออยู่แล้ว (' + (kb < 1024 ? kb+'KB' : mb+'MB') + ') — กด "สร้างใหม่" เพื่อทับของเดิม';
    existEl.style.display = 'block';
  } else { existEl.style.display = 'none'; }
}
function closeMaliVideo() {
  if (_maliVideoBusy) return;
  document.getElementById('mali-video-modal').style.display = 'none';
  document.body.style.overflow = '';
}
async function startMaliVideo() {
  _maliVideoBusy = true;
  document.getElementById('mali-video-start-btn').style.display = 'none';
  document.getElementById('mali-video-spinner').style.display = 'block';
  document.getElementById('mali-video-result').style.display = 'none';
  document.getElementById('mali-video-close-btn').disabled = true;

  const steps = [
    '🔍 ตรวจสอบ ComfyUI + FFmpeg...',
    '🖼️  อัปโหลดรูปสินค้าไป ComfyUI...',
    '🤖 ComfyUI img2img scene 1...',
    '🤖 ComfyUI img2img scene 2...',
    '🤖 ComfyUI img2img scene 3...',
    '🎞️  FFmpeg สร้าง clip แต่ละ scene...',
    '🔗 Concat clips → video.mp4...',
    '⏳ ใกล้เสร็จแล้ว กรุณารอ...',
  ];
  let si = 0;
  const stepEl = document.getElementById('mali-video-step');
  const progEl = document.getElementById('mali-video-prog');
  if (stepEl) stepEl.textContent = steps[0];
  const stepTimer = setInterval(() => {
    si = Math.min(si + 1, steps.length - 1);
    if (stepEl) stepEl.textContent = steps[si];
    if (progEl) progEl.style.width = Math.min(10 + si * 12, 90) + '%';
  }, 30000);

  try {
    const r = await fetch('/dashboard/mali/api/create-video', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: _maliVideoId }),
    });
    const j = await r.json();
    clearInterval(stepTimer);
    if (progEl) progEl.style.width = '100%';
    document.getElementById('mali-video-spinner').style.display = 'none';
    document.getElementById('mali-video-result').style.display = 'block';

    if (j.ok) {
      const szTxt = j.sizeKB < 1024 ? j.sizeKB+'KB' : (j.sizeKB/1024).toFixed(1)+'MB';
      document.getElementById('mali-video-result').innerHTML =
        '<div style="color:#10B981;font-weight:700;font-size:14px;margin-bottom:8px">✅ สร้างวิดีโอสำเร็จ! (' + szTxt + ')</div>' +
        '<div style="font-size:12px;color:#6B7280;margin-bottom:8px">📁 products/' + _maliVideoId + '/video.mp4</div>' +
        (j.log ? '<pre style="background:#F0FFF4;border:1px solid #A7F3D0;border-radius:8px;padding:10px;font-size:11px;max-height:160px;overflow-y:auto;white-space:pre-wrap;font-family:monospace">' + j.log.replace(/</g,'&lt;') + '</pre>' : '');
      showMaliToast('✅ สร้างวิดีโอ TikTok สำเร็จ! (' + szTxt + ')');
      setTimeout(() => location.reload(), 2000);
    } else {
      document.getElementById('mali-video-result').innerHTML =
        '<div style="color:#EF4444;font-weight:700;font-size:14px;margin-bottom:8px">❌ เกิดข้อผิดพลาด</div>' +
        '<pre style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:10px;font-size:11px;max-height:180px;overflow-y:auto;white-space:pre-wrap;font-family:monospace">' + (j.error||'').replace(/</g,'&lt;') + '</pre>';
    }
  } catch(e) {
    clearInterval(stepTimer);
    document.getElementById('mali-video-spinner').style.display = 'none';
    document.getElementById('mali-video-result').style.display = 'block';
    document.getElementById('mali-video-result').innerHTML = '<div style="color:#EF4444;font-weight:700">❌ ' + e.message + '</div>';
  }
  _maliVideoBusy = false;
  document.getElementById('mali-video-start-btn').style.display = 'inline-block';
  document.getElementById('mali-video-close-btn').disabled = false;
}

// ══════════════════════════════════════════════
//  มะลิ: Post Platform Modal (FB / FB-Clip / IG)
// ══════════════════════════════════════════════
function _postOptStyle(checked) {
  return checked
    ? 'display:flex;align-items:center;gap:10px;padding:10px 14px;border:2px solid #7C3AED;border-radius:10px;cursor:pointer;background:#F5F3FF'
    : 'display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #E5E7EB;border-radius:10px;cursor:pointer;background:white';
}
function togglePostChk(key) {
  const chk = document.getElementById('post-chk-' + key);
  if (!chk || chk.disabled) return;
  chk.checked = !chk.checked;
  document.getElementById('post-opt-' + key).style.cssText = _postOptStyle(chk.checked).replace('style:','');
  document.getElementById('post-opt-' + key).setAttribute('style', _postOptStyle(chk.checked));
}
function openMaliPost(id, title, hasFB, hasIG, hasVideo, videoKb) {
  if (_maliPostBusy) return;
  _maliPostId = id;
  document.getElementById('mali-post-item-title').textContent = title;
  document.getElementById('mali-post-modal').style.display = 'block';
  document.body.style.overflow = 'hidden';
  document.getElementById('mali-post-spinner').style.display = 'none';
  document.getElementById('mali-post-result').style.display = 'none';
  document.getElementById('mali-post-start-btn').style.display = 'inline-block';
  document.getElementById('mali-post-close-btn').disabled = false;

  // FB option
  const chkFB = document.getElementById('post-chk-fb');
  chkFB.disabled = !hasFB;
  chkFB.checked = hasFB;
  const optFB = document.getElementById('post-opt-fb');
  optFB.setAttribute('style', _postOptStyle(hasFB) + (hasFB ? '' : ';opacity:0.4;cursor:not-allowed'));
  document.getElementById('post-lbl-fb').textContent = hasFB ? 'มี facebook.md ✓' : 'ไม่มี facebook.md';

  // FB-Clip option
  const chkClip = document.getElementById('post-chk-fbclip');
  chkClip.disabled = !hasVideo;
  chkClip.checked = hasVideo;
  const optClip = document.getElementById('post-opt-fbclip');
  optClip.setAttribute('style', _postOptStyle(hasVideo) + (hasVideo ? '' : ';opacity:0.4;cursor:not-allowed'));
  const szTxt = videoKb < 1024 ? videoKb + 'KB' : (videoKb / 1024).toFixed(1) + 'MB';
  document.getElementById('post-lbl-fbclip').textContent = hasVideo ? 'video.mp4 (' + szTxt + ') ✓' : 'ไม่มี video.mp4';

  // IG option
  const chkIG = document.getElementById('post-chk-ig');
  chkIG.disabled = !hasIG;
  chkIG.checked = hasIG;
  const optIG = document.getElementById('post-opt-ig');
  optIG.setAttribute('style', _postOptStyle(hasIG) + (hasIG ? '' : ';opacity:0.4;cursor:not-allowed'));
  document.getElementById('post-lbl-ig').textContent = hasIG ? 'มี instagram.md ✓' : 'ไม่มี instagram.md';
}
function closeMaliPost() {
  if (_maliPostBusy) return;
  document.getElementById('mali-post-modal').style.display = 'none';
  document.body.style.overflow = '';
}
async function startMaliPost() {
  const fbChecked     = document.getElementById('post-chk-fb')?.checked;
  const igChecked     = document.getElementById('post-chk-ig')?.checked;
  const clipChecked   = document.getElementById('post-chk-fbclip')?.checked;
  if (!fbChecked && !igChecked && !clipChecked) {
    showMaliToast('⚠️ เลือกอย่างน้อย 1 platform', true); return;
  }
  _maliPostBusy = true;
  document.getElementById('mali-post-start-btn').style.display = 'none';
  document.getElementById('mali-post-spinner').style.display = 'block';
  document.getElementById('mali-post-result').style.display = 'none';
  document.getElementById('mali-post-close-btn').disabled = true;

  const results = {};

  // ── FB + IG via post.js ──────────────────────────────────────────────────
  const regularPlatforms = [];
  if (fbChecked)   regularPlatforms.push('fb');
  if (igChecked)   regularPlatforms.push('ig');
  if (regularPlatforms.length > 0) {
    try {
      const r = await fetch('/dashboard/mali/api/post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: _maliPostId, platforms: regularPlatforms }),
      });
      const j = await r.json();
      regularPlatforms.forEach(p => {
        results[p] = j.ok ? { ok: true } : { ok: false, error: j.error };
      });
    } catch(e) {
      regularPlatforms.forEach(p => { results[p] = { ok: false, error: e.message }; });
    }
  }

  // ── FB Video Clip ────────────────────────────────────────────────────────
  if (clipChecked) {
    try {
      const r = await fetch('/dashboard/mali/api/post-fb-clip', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: _maliPostId }),
      });
      const j = await r.json();
      results['fb-clip'] = j.ok
        ? { ok: true, extra: j.videoId ? 'Video ID: ' + j.videoId : '' }
        : { ok: false, error: j.error };
    } catch(e) {
      results['fb-clip'] = { ok: false, error: e.message };
    }
  }

  // ── Show results ─────────────────────────────────────────────────────────
  document.getElementById('mali-post-spinner').style.display = 'none';
  document.getElementById('mali-post-result').style.display = 'block';
  const allOk = Object.values(results).every(r => r.ok);
  const labels = { fb: '📘 Facebook', ig: '📸 Instagram', 'fb-clip': '🎬 FB Reels' };
  const hColor = allOk ? '#10B981' : '#F59E0B';
  const hMsg   = allOk ? '✅ โพสต์สำเร็จทุก platform!' : '⚠️ เสร็จแล้ว (ตรวจผลด้านล่าง)';
  let html = '<div style="font-weight:700;font-size:14px;margin-bottom:10px;color:' + hColor + '">' + hMsg + '</div>';
  for (const [plat, r] of Object.entries(results)) {
    const lbl = labels[plat] || plat;
    if (r.ok) {
      html += '<div style="color:#10B981;font-size:13px;padding:3px 0">✅ ' + lbl + (r.extra ? ' — ' + r.extra : '') + '</div>';
    } else {
      html += '<div style="color:#EF4444;font-size:13px;padding:3px 0">❌ ' + lbl + '</div>' +
        '<pre style="background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;padding:8px;font-size:11px;max-height:100px;overflow-y:auto;white-space:pre-wrap;margin:2px 0 6px;font-family:monospace">' + (r.error||'').replace(/</g,'&lt;').substring(0,300) + '</pre>';
    }
  }
  document.getElementById('mali-post-result').innerHTML = html;
  if (allOk) { showMaliToast('✅ โพสต์สำเร็จ!'); setTimeout(() => location.reload(), 2500); }
  _maliPostBusy = false;
  document.getElementById('mali-post-start-btn').style.display = 'inline-block';
  document.getElementById('mali-post-close-btn').disabled = false;
}

function showMaliToast(msg, err=false) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;top:20px;right:20px;background:'+(err?'#EF4444':'#10B981')+';color:white;padding:12px 20px;border-radius:10px;font-size:14px;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,0.2)';
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity 0.5s'; setTimeout(() => t.remove(), 500); }, 3000);
}
</script>

<!-- ══ View Content Modal ══ -->
<div id="mali-view-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9990;overflow-y:auto;padding:24px">
  <div style="max-width:720px;margin:0 auto;background:white;border-radius:20px;overflow:hidden;box-shadow:0 25px 60px rgba(0,0,0,0.3)">
    <div style="background:linear-gradient(135deg,#FF6B35,#FF8C42);padding:18px 24px;display:flex;align-items:center;justify-content:space-between">
      <div style="overflow:hidden;flex:1">
        <div style="font-size:16px;font-weight:700;color:white">📄 ดู Content สินค้า</div>
        <div id="mali-view-title" style="font-size:12px;color:rgba(255,255,255,0.85);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
      </div>
      <button onclick="closeMaliView()" style="background:rgba(255,255,255,0.2);border:none;color:white;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px;flex-shrink:0;margin-left:12px">✕</button>
    </div>
    <div style="display:flex;border-bottom:2px solid #F3F4F6;background:#F9FAFB">
      <button id="mali-vtab-fb"     onclick="switchMaliTab('fb')"     style="flex:1;padding:12px;border:none;background:white;cursor:pointer;font-size:13px;font-family:inherit;font-weight:700;color:#FF6B35;border-bottom:3px solid #FF6B35;transition:all 0.15s">📘 Facebook</button>
      <button id="mali-vtab-ig"     onclick="switchMaliTab('ig')"     style="flex:1;padding:12px;border:none;background:transparent;cursor:pointer;font-size:13px;font-family:inherit;font-weight:500;color:#6B7280;border-bottom:3px solid transparent;transition:all 0.15s">📸 Instagram</button>
      <button id="mali-vtab-tiktok" onclick="switchMaliTab('tiktok')" style="flex:1;padding:12px;border:none;background:transparent;cursor:pointer;font-size:13px;font-family:inherit;font-weight:500;color:#6B7280;border-bottom:3px solid transparent;transition:all 0.15s">🎵 TikTok</button>
    </div>
    <div style="padding:20px;max-height:520px;overflow-y:auto">
      <pre id="mali-view-pre" style="white-space:pre-wrap;font-size:13px;line-height:1.8;color:#374151;font-family:'Sarabun',sans-serif;margin:0">กำลังโหลด...</pre>
    </div>
    <div style="padding:14px 20px;border-top:1px solid #F3F4F6;text-align:right">
      <button onclick="closeMaliView()" style="background:#F3F4F6;border:none;padding:8px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;color:#374151">ปิด</button>
    </div>
  </div>
</div>

<!-- ══ Generate Force Modal ══ -->
<div id="mali-regen-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9990;overflow-y:auto;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:20px;overflow:hidden;box-shadow:0 25px 60px rgba(0,0,0,0.3)">
    <div style="background:linear-gradient(135deg,#F97316,#FB923C);padding:18px 24px;display:flex;align-items:center;justify-content:space-between">
      <div style="overflow:hidden;flex:1">
        <div style="font-size:16px;font-weight:700;color:white">🔄 Generate Content (--force)</div>
        <div id="mali-regen-item-title" style="font-size:12px;color:rgba(255,255,255,0.85);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
      </div>
      <button id="mali-regen-close-btn" onclick="closeMaliRegen()" style="background:rgba(255,255,255,0.2);border:none;color:white;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px;flex-shrink:0;margin-left:12px">✕</button>
    </div>
    <div style="padding:20px;display:flex;flex-direction:column;gap:16px">
      <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:10px;padding:12px 14px;font-size:13px;color:#92400E">
        <b>สร้าง content ใหม่ทับของเดิม</b> สำหรับ 📘 Facebook + 📸 Instagram + 🎵 TikTok<br>
        <span style="font-size:12px;color:#B45309">ใช้ Ollama — อาจใช้เวลา 2-5 นาที (ไม่ส่ง Telegram)</span>
      </div>

      <div id="mali-regen-spinner" style="display:none;text-align:center;padding:16px 0">
        <div style="font-size:36px;animation:maliSpin 1.5s linear infinite;display:inline-block">⚙️</div>
        <div id="mali-regen-step" style="font-size:13px;color:#6B7280;margin-top:10px">กำลังส่งคำสั่ง...</div>
        <div style="background:#F3F4F6;border-radius:999px;height:4px;margin-top:12px;overflow:hidden">
          <div style="height:4px;background:#F97316;border-radius:999px;width:100%;animation:maliBar 2s ease-in-out infinite"></div>
        </div>
      </div>

      <div id="mali-regen-result" style="display:none"></div>

      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="mali-regen-start-btn" onclick="startMaliRegen()"
          style="background:linear-gradient(135deg,#F97316,#FB923C);color:white;border:none;padding:10px 24px;border-radius:10px;cursor:pointer;font-size:14px;font-family:inherit;font-weight:700">
          🔄 เริ่ม Generate
        </button>
        <button onclick="closeMaliRegen()" style="background:#F3F4F6;border:none;padding:10px 18px;border-radius:10px;cursor:pointer;font-size:13px;font-family:inherit;color:#374151">ยกเลิก</button>
      </div>
    </div>
  </div>
</div>
<!-- ══ Create Video Modal ══ -->
<div id="mali-video-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9990;overflow-y:auto;padding:24px">
  <div style="max-width:580px;margin:0 auto;background:white;border-radius:20px;overflow:hidden;box-shadow:0 25px 60px rgba(0,0,0,0.35)">
    <div style="background:linear-gradient(135deg,#10B981,#059669);padding:18px 24px;display:flex;align-items:center;justify-content:space-between">
      <div style="overflow:hidden;flex:1">
        <div style="font-size:16px;font-weight:700;color:white">🎬 สร้างวิดีโอ TikTok</div>
        <div id="mali-video-item-title" style="font-size:12px;color:rgba(255,255,255,0.85);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
      </div>
      <button id="mali-video-close-btn" onclick="closeMaliVideo()" style="background:rgba(255,255,255,0.2);border:none;color:white;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px;flex-shrink:0;margin-left:12px">✕</button>
    </div>
    <div style="padding:20px;display:flex;flex-direction:column;gap:14px">

      <!-- info banner -->
      <div style="background:#F0FDF4;border:1px solid #A7F3D0;border-radius:10px;padding:12px 14px;font-size:13px;color:#065F46">
        <b>Pipeline:</b> รูปสินค้า → <b>ComfyUI img2img</b> (AnythingXL, upscale → portrait 768×1344) → FFmpeg 1080×1920 → <b>video.mp4</b><br>
        <span style="font-size:12px;color:#047857">ระยะเวลา: ~2-5 นาที ต่อ scene × จำนวน scene ใน TikTok script</span>
      </div>

      <!-- pipeline steps visual -->
      <div style="display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;color:#6B7280;flex-wrap:wrap">
        <span style="background:#F0FDF4;border:1px solid #A7F3D0;border-radius:20px;padding:3px 10px">🖼️ รูปสินค้า</span>
        <span>→</span>
        <span style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:20px;padding:3px 10px">🤖 ComfyUI img2img</span>
        <span>→</span>
        <span style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:20px;padding:3px 10px">🎞️ FFmpeg 9:16</span>
        <span>→</span>
        <span style="background:#F5F3FF;border:1px solid #DDD6FE;border-radius:20px;padding:3px 10px">🎬 video.mp4</span>
      </div>

      <!-- existing video badge -->
      <div id="mali-video-existing" style="display:none;background:#F0FDF4;border:1px solid #6EE7B7;border-radius:8px;padding:8px 12px;font-size:12px;color:#065F46"></div>

      <!-- spinner -->
      <div id="mali-video-spinner" style="display:none;text-align:center;padding:16px 0">
        <div style="font-size:38px;animation:maliSpin 1.5s linear infinite;display:inline-block">🎬</div>
        <div id="mali-video-step" style="font-size:13px;color:#6B7280;margin-top:10px">กำลังเตรียม...</div>
        <div style="background:#E5E7EB;border-radius:999px;height:5px;margin-top:12px;overflow:hidden">
          <div id="mali-video-prog" style="height:5px;background:linear-gradient(90deg,#10B981,#059669);border-radius:999px;width:5%;transition:width 1s ease"></div>
        </div>
        <div style="font-size:11px;color:#9CA3AF;margin-top:6px">ปิดหน้าต่างนี้ไม่ได้ระหว่างสร้างวิดีโอ</div>
      </div>

      <!-- result -->
      <div id="mali-video-result" style="display:none"></div>

      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="mali-video-start-btn" onclick="startMaliVideo()"
          style="background:linear-gradient(135deg,#10B981,#059669);color:white;border:none;padding:10px 24px;border-radius:10px;cursor:pointer;font-size:14px;font-family:inherit;font-weight:700">
          🎬 สร้างวิดีโอ
        </button>
        <button onclick="closeMaliVideo()" style="background:#F3F4F6;border:none;padding:10px 18px;border-radius:10px;cursor:pointer;font-size:13px;font-family:inherit;color:#374151">ยกเลิก</button>
      </div>
    </div>
  </div>
</div>

<!-- ══ Post Platform Modal (FB / FB-Clip / IG) ══ -->
<div id="mali-post-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9990;overflow-y:auto;padding:24px">
  <div style="max-width:500px;margin:0 auto;background:white;border-radius:20px;overflow:hidden;box-shadow:0 25px 60px rgba(0,0,0,0.35)">
    <div style="background:linear-gradient(135deg,#7C3AED,#A78BFA);padding:18px 24px;display:flex;align-items:center;justify-content:space-between">
      <div style="overflow:hidden;flex:1">
        <div style="font-size:16px;font-weight:700;color:white">📤 โพสต์สินค้า</div>
        <div id="mali-post-item-title" style="font-size:12px;color:rgba(255,255,255,0.85);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
      </div>
      <button id="mali-post-close-btn" onclick="closeMaliPost()" style="background:rgba(255,255,255,0.2);border:none;color:white;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px;flex-shrink:0;margin-left:12px">✕</button>
    </div>
    <div style="padding:20px;display:flex;flex-direction:column;gap:12px">

      <!-- Platform options -->
      <div style="font-size:12px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.05em">เลือก Platform ที่จะโพสต์</div>
      <div id="post-opt-fb" onclick="togglePostChk('fb')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #E5E7EB;border-radius:10px;cursor:pointer">
        <input type="checkbox" id="post-chk-fb" style="width:18px;height:18px;cursor:pointer;accent-color:#1877F2;flex-shrink:0" onclick="event.stopPropagation();togglePostChk('fb')">
        <div style="flex:1">
          <div style="font-size:14px;font-weight:600">📘 Facebook</div>
          <div id="post-lbl-fb" style="font-size:11px;color:#9CA3AF;margin-top:1px"></div>
        </div>
      </div>
      <div id="post-opt-fbclip" onclick="togglePostChk('fbclip')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #E5E7EB;border-radius:10px;cursor:pointer">
        <input type="checkbox" id="post-chk-fbclip" style="width:18px;height:18px;cursor:pointer;accent-color:#1877F2;flex-shrink:0" onclick="event.stopPropagation();togglePostChk('fbclip')">
        <div style="flex:1">
          <div style="font-size:14px;font-weight:600">🎬 FB Reels</div>
          <div id="post-lbl-fbclip" style="font-size:11px;color:#9CA3AF;margin-top:1px"></div>
        </div>
      </div>
      <div id="post-opt-ig" onclick="togglePostChk('ig')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #E5E7EB;border-radius:10px;cursor:pointer">
        <input type="checkbox" id="post-chk-ig" style="width:18px;height:18px;cursor:pointer;accent-color:#EC4899;flex-shrink:0" onclick="event.stopPropagation();togglePostChk('ig')">
        <div style="flex:1">
          <div style="font-size:14px;font-weight:600">📸 Instagram</div>
          <div id="post-lbl-ig" style="font-size:11px;color:#9CA3AF;margin-top:1px"></div>
        </div>
      </div>

      <!-- force warning -->
      <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:9px 12px;font-size:12px;color:#92400E">
        ⚠️ <b>--force</b> — โพสต์ทันทีโดยไม่สนใจว่าเคยโพสต์แล้วหรือไม่
      </div>

      <!-- spinner -->
      <div id="mali-post-spinner" style="display:none;text-align:center;padding:16px 0">
        <div style="font-size:36px;animation:maliSpin 1.5s linear infinite;display:inline-block">📤</div>
        <div id="mali-post-step" style="font-size:13px;color:#6B7280;margin-top:8px">กำลังโพสต์...</div>
      </div>

      <!-- result -->
      <div id="mali-post-result" style="display:none;background:#F9FAFB;border-radius:10px;padding:14px;border:1px solid #E5E7EB"></div>

      <!-- buttons -->
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:2px">
        <button id="mali-post-start-btn" onclick="startMaliPost()"
          style="background:linear-gradient(135deg,#7C3AED,#A78BFA);color:white;border:none;padding:10px 24px;border-radius:10px;cursor:pointer;font-size:14px;font-family:inherit;font-weight:700">
          📤 โพสต์ที่เลือก
        </button>
        <button onclick="closeMaliPost()" style="background:#F3F4F6;border:none;padding:10px 18px;border-radius:10px;cursor:pointer;font-size:13px;font-family:inherit;color:#374151">ยกเลิก</button>
      </div>
    </div>
  </div>
</div>

<style>
@keyframes maliSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
@keyframes maliBar  { 0%{transform:translateX(-100%)} 50%{transform:translateX(0%)} 100%{transform:translateX(100%)} }
</style>

</body>
</html>`;
}

// ─── Telegram Sender (สำหรับส่งขอ Approve จาก Dashboard) ─────────────────────

function readNewsEnv() {
  try {
    const envFile = path.join(AI_NEWS_DIR, '.env');
    const lines   = fs.readFileSync(envFile, 'utf8').split('\n');
    const env     = {};
    for (const line of lines) {
      const m = line.match(/^\s*([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return env;
  } catch { return {}; }
}

function tgRequest(token, method, body) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) },
      rejectUnauthorized: false,
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error('TG parse error')); } });
    });
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Telegram timeout')); });
    req.on('error', reject);
    req.write(json);
    req.end();
  });
}

function tgEscape(t = '') {
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// multipart/form-data upload ภาพไปยัง Telegram sendPhoto
function sendPhotoToTelegram(token, chatId, imagePath, caption, keyboard) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const boundary   = 'TGBound' + crypto.randomBytes(8).toString('hex');
    const imgBuffer  = fs.readFileSync(imagePath);
    const filename   = path.basename(imagePath);

    const addField = (name, value) =>
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);

    const parts = [
      addField('chat_id',    String(chatId)),
      addField('parse_mode', 'HTML'),
    ];
    if (caption)  parts.push(addField('caption', caption));
    if (keyboard) parts.push(addField('reply_markup', JSON.stringify(keyboard)));

    const photoHead = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`
    );
    const body = Buffer.concat([...parts, photoHead, imgBuffer, Buffer.from(`\r\n--${boundary}--\r\n`)]);

    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendPhoto`,
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
      rejectUnauthorized: false,
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error('TG photo parse: ' + buf.substring(0,100))); } });
    });
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Photo upload timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendTelegramApproval(slug, platform) {
  const env    = readNewsEnv();
  const token  = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('ไม่พบ TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID ใน .env');

  const dataPath = path.join(AI_NEWS_DIR, 'news', slug, 'data.json');
  const fbPath   = path.join(AI_NEWS_DIR, 'news', slug, 'content', 'facebook.md');
  const igPath   = path.join(AI_NEWS_DIR, 'news', slug, 'content', 'instagram.md');
  const imgPath  = path.join(AI_NEWS_DIR, 'news', slug, 'image.jpg');

  if (!fs.existsSync(dataPath)) throw new Error(`ไม่พบ news/${slug}/data.json`);

  const data       = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const includesIG = platform === 'ig' || platform === 'fb,ig';
  const includesFB = platform === 'fb' || platform === 'fb,ig';

  // รูปถูก Generate แยกก่อนแล้ว (จากปุ่ม Generate ใน Modal) — ไม่ generate ซ้ำที่นี่

  const hasImage = fs.existsSync(imgPath);

  // ── shortId → queue ───────────────────────────────────────────────────────────
  const shortId   = crypto.createHash('md5').update(slug).digest('hex').substring(0, 12);
  const queueFile = path.join(AI_NEWS_DIR, '_tg_queue.json');
  const queue     = (() => { try { return JSON.parse(fs.readFileSync(queueFile, 'utf8')); } catch { return {}; } })();
  queue[shortId]  = { slug, platform };
  fs.writeFileSync(queueFile, JSON.stringify(queue, null, 2), 'utf8');

  // ── Build message parts ───────────────────────────────────────────────────────
  const title    = tgEscape(data.title || slug);
  const date     = (data.published_at || data.scraped_at || '').substring(0, 10);
  const pfLabels = { fb: '📘 Facebook', ig: '📸 Instagram', 'fb,ig': '📘 Facebook + 📸 Instagram' };
  const pfLabel  = pfLabels[platform] || platform;

  const keyboard = {
    inline_keyboard: [[
      { text: '✅ อนุมัติ & โพสต์', callback_data: `approve:${shortId}` },
      { text: '🔄 สร้างใหม่',       callback_data: `regen:${shortId}`   },
      { text: '❌ ยกเลิก',           callback_data: `cancel:${shortId}`  },
    ]],
  };

  // ── ส่งไปยัง Telegram ─────────────────────────────────────────────────────────
  if (hasImage) {
    // --- ส่งรูป (sendPhoto) พร้อม caption ทุก platform ---
    const fbContent = fs.existsSync(fbPath) ? fs.readFileSync(fbPath, 'utf8') : '';
    const igContent = fs.existsSync(igPath) ? fs.readFileSync(igPath, 'utf8') : '';

    // สร้าง caption: แสดง content preview ตาม platform ที่เลือก (Telegram limit 1024 chars)
    const captionLines = [
      `📰 <b>รอ Approve ก่อนโพสต์</b>`,
      `🗞 ${title}`,
      `📅 ${date} | 🎯 ${pfLabel}`,
      ``,
    ];
    if (includesFB && fbContent) {
      const fbPreview = tgEscape(fbContent.substring(0, 350)) + (fbContent.length > 350 ? '\n...' : '');
      captionLines.push(`📘 <b>Facebook:</b>`, fbPreview);
      if (includesIG) captionLines.push('');  // spacer
    }
    if (includesIG && igContent) {
      const igPreview = tgEscape(igContent.substring(0, 300)) + (igContent.length > 300 ? '\n...' : '');
      captionLines.push(`📸 <b>Instagram:</b>`, igPreview);
    }
    const photoCaption = captionLines.join('\n').substring(0, 1024);

    const photoRes = await sendPhotoToTelegram(token, chatId, imgPath, photoCaption, keyboard);
    if (!photoRes.ok) throw new Error('Telegram sendPhoto: ' + JSON.stringify(photoRes).substring(0, 200));

  } else {
    // --- ส่งข้อความ (ไม่มีรูป — fallback) ---
    const fbContent = fs.existsSync(fbPath) ? fs.readFileSync(fbPath, 'utf8') : '';
    const fbPreview = tgEscape(fbContent.substring(0, 700)) + (fbContent.length > 700 ? '\n...' : '');

    const lines = [
      `📰 <b>รอ Approve ก่อนโพสต์</b>`,
      `─────────────────────────`,
      `🗞 ${title}`,
      `📅 ${date}`,
      `🎯 โพสต์ไปที่: <b>${pfLabel}</b>`,
      `⚠️ <i>ไม่พบรูป Generate — โพสต์โดยไม่มีรูป</i>`,
    ];
    if (fbContent) {
      lines.push('', `📝 <b>Facebook Content Preview:</b>`, fbPreview);
    }
    lines.push(`─────────────────────────`, `กด ✅ เพื่อ Approve และโพสต์ทันที`);

    const res = await tgRequest(token, 'sendMessage', {
      chat_id: chatId, text: lines.join('\n'), parse_mode: 'HTML', reply_markup: keyboard,
    });
    if (!res.ok) throw new Error('Telegram API: ' + JSON.stringify(res).substring(0, 200));
  }

  // ── อัปเดต status ─────────────────────────────────────────────────────────────
  data.status       = 'pending_approval';
  data.pending_since = new Date().toISOString();
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');

  return { shortId, platform, hasImage };
}

// ─── น้ำข้าว: Schedule Manager ───────────────────────────────────────────────

const SCHEDULE_TASKS = {
  reuters: 'AI-News-Pipeline',
  shopee:  'ShopeeAffiliate-DailyFBPost',
};

// TR (Task Run) สำหรับแต่ละ task — ใช้ตอนสร้าง/แก้ไข schedule
// inner quotes ใช้ "" (cmd.exe style) เพราะ runCmd ใช้ shell: cmd.exe
const SCHEDULE_TR = {
  'AI-News-Pipeline':
    'powershell.exe -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ""' +
    ROOT + '\\agents\\manao\\pipeline\\run-pipeline.ps1""',
  'ShopeeAffiliate-DailyFBPost':
    '"' + ROOT + '\\post-daily-fb.bat"',
};

// รัน command ผ่าน cmd.exe shell (หลีกเลี่ยง EPERM ของ powershell.exe)
function runCmd(cmd) {
  const { execSync } = require('child_process');
  return execSync(cmd, { encoding: 'utf8', shell: 'cmd.exe', timeout: 15000 }).trim();
}

// รัน PowerShell script ผ่าน node.js helper (หลีกเลี่ยง EPERM)
function runPSScript(psCode) {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const tmpFile = path.join(os.tmpdir(), `namkhao_${Date.now()}.ps1`);
  const helperScript = path.join(ROOT, 'agents', 'namkhao', 'ps-runner.js');
  try {
    fs.writeFileSync(tmpFile, psCode, 'utf8');
    // ใช้ node เป็นตัวกลางรัน PowerShell — node มีสิทธิ์ spawn ps.exe แตกต่างจาก agent-hub.js server process
    const out = execFileSync(process.execPath, [helperScript, tmpFile], {
      encoding: 'utf8', timeout: 20000, cwd: ROOT,
    }).trim();
    return out;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// Parse schtasks CSV output → { state, lastRun, nextRun, lastResult, times[] }
function parseSchedCSV(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  // หา header row
  const headerLine = lines.find(l => l.startsWith('"HostName"') || l.includes('"Status"'));
  if (!headerLine) return null;
  const headers = headerLine.split('","').map(h => h.replace(/^"|"$/g, '').trim());

  // แปลงวันที่ Thai Buddhist → Gregorian (ปี พ.ศ. → ค.ศ.: ลบ 543)
  function convertThaiDate(str) {
    if (!str || str === 'N/A') return 'N/A';
    // รูปแบบ "31/5/2569 7:05:56" หรือ "31/5/2569 12:00:00"
    const m = str.match(/^(\d+)\/(\d+)\/(\d{4})\s+(.+)$/);
    if (!m) return str;
    const [, dd, mm, bYear, time] = m;
    const ceYear = parseInt(bYear, 10) - 543;
    return `${ceYear}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')} ${time}`;
  }

  // แปลงเวลา → "HH:MM" รูปแบบ 24 ชั่วโมง
  // รองรับทั้ง 12 ชม. ("6:00:00 PM", "12:00:00 AM") และ 24 ชม. ("18:00:00")
  function fmtTime(t) {
    if (!t) return '';
    t = t.trim();
    const ampm = /\b(AM|PM)\b/i.exec(t);
    const parts = t.replace(/\b(AM|PM)\b/i, '').trim().split(':');
    let hh = parseInt(parts[0], 10);
    const mm = (parts[1] || '00').padStart(2, '0');
    if (isNaN(hh)) return '';
    if (ampm) {
      const isPM = ampm[1].toUpperCase() === 'PM';
      if (isPM && hh !== 12) hh += 12;      // 1-11 PM → 13-23
      else if (!isPM && hh === 12) hh = 0;  // 12 AM → 00
    }
    return `${String(hh).padStart(2, '0')}:${mm}`;
  }

  const getCol = (row, col) => row[headers.indexOf(col)] || '';
  const times = [];
  let state = 'Unknown', lastRun = 'N/A', nextRun = 'N/A', lastResult = null;
  let first = true;

  for (const line of lines) {
    if (line === headerLine || !line.startsWith('"')) continue;
    // split CSV (simple: split by "," but inside quotes)
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === ',' && !inQ) { cols.push(cur); cur = ''; continue; }
      cur += c;
    }
    cols.push(cur);

    if (first) {
      first = false;
      const rawState = cols[headers.indexOf('Status')] || cols[headers.indexOf('Scheduled Task State')] || '';
      state = rawState || 'Unknown';
      const rawLast = cols[headers.indexOf('Last Run Time')] || '';
      lastRun = convertThaiDate(rawLast);
      const rawNext = cols[headers.indexOf('Next Run Time')] || '';
      nextRun = convertThaiDate(rawNext);
      const rawResult = cols[headers.indexOf('Last Result')] || '';
      lastResult = lastRun === 'N/A' ? null : (rawResult !== '' ? parseInt(rawResult, 10) : null);
    }

    // ดึง Start Time จากทุก row (แต่ละ row = แต่ละ trigger)
    const startTime = cols[headers.indexOf('Start Time')] || '';
    const t = fmtTime(startTime);
    if (t && !times.includes(t)) times.push(t);
  }

  times.sort();
  return { state, lastRun, nextRun, lastResult, times };
}

function getScheduleStatus() {
  function queryOne(taskName) {
    try {
      const raw = runCmd(`schtasks /query /fo CSV /v /tn "${taskName}"`);
      const parsed = parseSchedCSV(raw);
      if (!parsed) throw new Error('parse CSV ไม่สำเร็จ');
      return parsed;
    } catch (e) {
      return { state: 'Error', lastRun: 'N/A', lastResult: null, nextRun: 'N/A', times: [], error: e.message.substring(0, 100) };
    }
  }
  return {
    reuters: queryOne(SCHEDULE_TASKS.reuters),
    shopee:  queryOne(SCHEDULE_TASKS.shopee),
  };
}

function editScheduleTimes(taskName, times) {
  const os2 = require('os');

  if (times.length === 1) {
    // เวลาเดียว → schtasks /Change /ST
    const out = runCmd(`schtasks /Change /TN "${taskName}" /ST ${times[0]}`);
    if (!out.toLowerCase().includes('success') && !out.includes('สำเร็จ'))
      throw new Error('แก้ไข Schedule ไม่สำเร็จ: ' + out.substring(0, 150));
    return;
  }

  // หลายเวลา → export XML (UTF-8) → แก้ <Triggers> → import พร้อม BOM
  const tmpXml = path.join(os2.tmpdir(), `sched_edit_${Date.now()}.xml`);
  runCmd(`schtasks /Query /TN "${taskName}" /XML ONE > "${tmpXml}"`);
  if (!fs.existsSync(tmpXml) || fs.statSync(tmpXml).size < 10)
    throw new Error('Export XML ไม่สำเร็จ');

  // อ่านด้วย encoding จริง (cmd redirect ให้ UTF-8, ไม่มี BOM)
  const rawBytes = fs.readFileSync(tmpXml);
  let xml = (rawBytes[0] === 0xFF && rawBytes[1] === 0xFE)
    ? rawBytes.toString('utf16le').replace(/^﻿/, '')
    : rawBytes.toString('utf8').replace(/^﻿/, '');

  // คำนวณ timezone offset ของเครื่อง
  const tzOff = -(new Date().getTimezoneOffset());
  const tzStr = (tzOff >= 0 ? '+' : '-') +
    String(Math.floor(Math.abs(tzOff) / 60)).padStart(2, '0') + ':' +
    String(Math.abs(tzOff) % 60).padStart(2, '0');
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  const triggerXml = times.map(t => {
    const [hh, mm] = t.trim().split(':');
    return [
      '    <CalendarTrigger>',
      `      <StartBoundary>${dateStr}T${hh.padStart(2,'0')}:${mm}:00${tzStr}</StartBoundary>`,
      '      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>',
      '    </CalendarTrigger>',
    ].join('\r\n');
  }).join('\r\n');

  xml = xml.replace(/<Triggers>[\s\S]*?<\/Triggers>/, `<Triggers>\r\n${triggerXml}\r\n  </Triggers>`);
  if (!xml.includes('<CalendarTrigger>'))
    throw new Error('แก้ไข Triggers ใน XML ไม่สำเร็จ');

  // เขียนเป็น UTF-16LE + BOM ที่ schtasks /Create /XML ต้องการ
  const bom    = Buffer.from([0xFF, 0xFE]);
  const xmlBuf = Buffer.from(xml, 'utf16le');
  fs.writeFileSync(tmpXml, Buffer.concat([bom, xmlBuf]));

  const out = runCmd(`schtasks /Create /TN "${taskName}" /XML "${tmpXml}" /F`);
  try { fs.unlinkSync(tmpXml); } catch {}
  if (!out.toLowerCase().includes('success') && !out.includes('สำเร็จ'))
    throw new Error('แก้ไข Schedule ไม่สำเร็จ: ' + out.substring(0, 200));
}

function toggleScheduleTask(taskName, enable) {
  const flag = enable ? '/enable' : '/disable';
  const out = runCmd(`schtasks /change /tn "${taskName}" ${flag}`);
  // schtasks คืน "SUCCESS:" ถ้าสำเร็จ
  if (!out.toLowerCase().includes('success') && !out.includes('สำเร็จ')) {
    throw new Error(`Toggle Schedule ไม่สำเร็จ: ${out.substring(0, 150)}`);
  }
}

function runScheduleNow(taskName) {
  const out = runCmd(`schtasks /run /tn "${taskName}"`);
  if (!out.toLowerCase().includes('success') && !out.includes('สำเร็จ')) {
    throw new Error(`Run Schedule ไม่สำเร็จ: ${out.substring(0, 150)}`);
  }
}

function serveNamkhaoHTML(res) {
  const htmlFile = path.join(ROOT, 'agents', 'namkhao', 'dashboard.html');
  if (!fs.existsSync(htmlFile)) {
    res.writeHead(404); return res.end('ไม่พบ dashboard.html ของน้ำข้าว');
  }
  const html = fs.readFileSync(htmlFile, 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// ─── AI News Dashboard (มะนาว) ────────────────────────────────────────────────

function getNewsItems() {
  const newsDir = path.join(AI_NEWS_DIR, 'news');
  if (!fs.existsSync(newsDir)) return [];
  return fs.readdirSync(newsDir)
    .filter(d => fs.existsSync(path.join(newsDir, d, 'data.json')))
    .map(slug => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(newsDir, slug, 'data.json'), 'utf8'));
        const cDir = path.join(newsDir, slug, 'content');
        return {
          slug,
          title: data.title || slug,
          url: data.url || '',
          status: data.status || 'scraped',
          published_at: data.published_at || '',
          scraped_at: data.scraped_at || '',
          posted_at: data.posted_at || '',
          pending_since: data.pending_since || '',
          og_image: data.og_image || '',
          hasFB: fs.existsSync(path.join(cDir, 'facebook.md')),
          hasIG: fs.existsSync(path.join(cDir, 'instagram.md')),
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (b.scraped_at || '').localeCompare(a.scraped_at || ''));
}

function getNewsBotStatus() {
  try {
    const pidFile = path.join(AI_NEWS_DIR, 'telegram-bot.pid');
    if (!fs.existsSync(pidFile)) return { running: false, pid: null };
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
    if (isNaN(pid)) return { running: false, pid: null };
    try { process.kill(pid, 0); return { running: true, pid }; } catch { return { running: false, pid }; }
  } catch { return { running: false, pid: null }; }
}

function getNewsPipelineInfo() {
  try {
    const logFile = path.join(AI_NEWS_DIR, 'pipeline.log');
    if (!fs.existsSync(logFile)) return { last_run: null };
    let content = fs.readFileSync(logFile, 'utf8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    const lines = content.split('\n').filter(Boolean);
    const startLines  = lines.filter(l => l.includes('=== เริ่ม Pipeline ==='));
    const finishLines = lines.filter(l => l.includes('=== Pipeline เสร็จแล้ว'));
    return {
      last_run:    startLines.length  ? startLines[startLines.length-1].replace(/[\r﻿]/g,'').substring(0,19) : null,
      last_finish: finishLines.length ? finishLines[finishLines.length-1].replace(/[\r﻿]/g,'').substring(0,19) : null,
      log_lines: lines.length,
    };
  } catch { return { last_run: null }; }
}

function buildNewsApiData() {
  const items = getNewsItems();
  const counts = { scraped:0, draft:0, pending_approval:0, scheduled:0, posted:0 };
  for (const item of items) { const s = item.status||'scraped'; if (counts[s]!==undefined) counts[s]++; else counts.scraped++; }

  const agentDefs = [
    { id: 'scrape',    name: 'Scraper (Reuters)',  icon: '🌐' },
    { id: 'filter',    name: 'Filter Agent',        icon: '🔍' },
    { id: 'editor',    name: 'Editor Agent',         icon: '✍️' },
    { id: 'formatter', name: 'Formatter Agent',      icon: '📱' },
  ];
  const agentsStatus = agentDefs.map(def => ({
    ...def,
    running: pipelineProcs[def.id] !== null,
    pending: null,
  }));

  return {
    generated_at: new Date().toISOString(),
    stats: { total: items.length, by_status: counts },
    bot: getNewsBotStatus(),
    pipeline: getNewsPipelineInfo(),
    news: items,
    hub: {
      pipeline_running: pipelineProcs.pipeline !== null || agentDefs.some(d => pipelineProcs[d.id] !== null),
      agents: agentsStatus,
    },
  };
}

// serve ai-news dashboard.html with rewritten API paths
function serveNewsHTML(res) {
  const htmlFile = path.join(AI_NEWS_DIR, 'dashboard.html');
  if (!fs.existsSync(htmlFile)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<p style="padding:20px;font-family:sans-serif">ไม่พบ dashboard.html ใน ai-news</p>');
  }
  let html = fs.readFileSync(htmlFile, 'utf8');
  // rewrite API paths so they work from /dashboard/manao context via agent-hub routes
  html = html
    .replace(/['"]\/api\/data\?/g, "'/dashboard/manao/api/data?")
    .replace(/['"]\/api\/data['"]/g, "'/dashboard/manao/api/data'")
    .replace(/['"]\/api\/facebook-content['"]/g, "'/dashboard/manao/api/facebook-content'")
    .replace(/['"]\/api\/ig-content['"]/g, "'/dashboard/manao/api/ig-content'")
    .replace(/['"]\/api\/log\?/g, "'/dashboard/manao/api/log?")
    .replace(/['"]\/api\/log['"]/g, "'/dashboard/manao/api/log'")
    .replace(/['"]\/api\/post['"]/g, "'/dashboard/manao/api/post'")
    .replace(/['"]\/api\/request-approval['"]/g,  "'/dashboard/manao/api/request-approval'")
    .replace(/['"]\/api\/generate-image['"]/g,    "'/dashboard/manao/api/generate-image'")
    .replace(/['"]\/api\/generate-force['"]/g,    "'/dashboard/manao/api/generate-force'")
    .replace(/['"]\/news-image\//g,               "'/dashboard/manao/news-image/")
    .replace(/['"]\/api\/run-agent['"]/g,         "'/dashboard/manao/api/run-agent'")
    .replace('`/api/agent-log?',                  '`/dashboard/manao/api/agent-log?')
    .replace('`/api/content?',                    '`/dashboard/manao/api/content?')
    .replace(/['"]\/api\/pipeline-status['"]/g,   "'/dashboard/manao/api/pipeline-status'")
    .replace(/['"]\/api\/config['"]/g,            "'/dashboard/manao/api/config'");
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// ─── HTML Builder ─────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function statusBadge(status) {
  const map = {
    running: ['🟡', 'กำลังทำงาน', '#F59E0B', '#FFFBEB'],
    error:   ['🔴', 'Error',       '#EF4444', '#FEF2F2'],
    idle:    ['🟢', 'พร้อม',       '#10B981', '#ECFDF5'],
    done:    ['✅', 'เสร็จแล้ว',   '#6366F1', '#EEF2FF'],
  };
  const [dot, label, color, bg] = map[status] || map.idle;
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;background:${bg};color:${color};font-size:12px;font-weight:600">${dot} ${label}</span>`;
}

function buildMainPage(status) {
  const today = new Date().toLocaleDateString('th-TH', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  const cards = Object.entries(AGENTS).map(([name, cfg]) => {
    const st      = status[name] || {};
    const lastRun = st.lastRun ? new Date(st.lastRun).toLocaleTimeString('th-TH') : '—';
    const result  = (st.lastResult || '').substring(0, 42);
    const hasPng  = fs.existsSync(path.join(ROOT, 'agents', name, 'avatar.png'));

    // status chip
    const stMap = {
      running: { dot: '🟡', label: 'กำลังทำงาน', glow: '#F59E0B55' },
      error:   { dot: '🔴', label: 'Error',        glow: '#EF444455' },
      idle:    { dot: '🟢', label: 'พร้อม',        glow: cfg.color + '44' },
    };
    const stInfo = stMap[st.status] || stMap.idle;
    const isRunning = st.status === 'running';

    return `
    <div onclick="window.location='/agent/${name}'"
         class="agent-card"
         style="cursor:pointer;border-radius:24px;overflow:hidden;position:relative;
                aspect-ratio:3/4;
                border:2px solid ${cfg.color};
                box-shadow:0 8px 40px ${stInfo.glow}, 0 2px 12px rgba(0,0,0,0.3);
                transition:all 0.35s ease;
                background:linear-gradient(160deg, ${cfg.color}22 0%, #0f172a 60%)">

      <!-- Avatar image — fills card -->
      <img src="/avatar/${name}?t=${Date.now()}"
           alt="${cfg.label}"
           style="position:absolute;inset:0;width:100%;height:100%;
                  object-fit:${hasPng ? 'cover' : 'contain'};
                  object-position:center top;
                  padding:${hasPng ? '0' : '18px'};
                  transition:transform 0.45s ease;pointer-events:none"
           class="card-avatar">

      <!-- Gradient scrim — bottom fade -->
      <div style="position:absolute;inset:0;
                  background:linear-gradient(to bottom,
                    transparent 30%,
                    rgba(10,14,26,0.55) 58%,
                    rgba(10,14,26,0.92) 80%,
                    rgba(10,14,26,0.98) 100%)">
      </div>

      <!-- Status chip — top right -->
      <div style="position:absolute;top:14px;right:14px;
                  padding:5px 12px;border-radius:999px;
                  background:rgba(0,0,0,0.55);
                  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
                  border:1px solid rgba(255,255,255,0.12);
                  font-size:12px;font-weight:700;color:white;
                  display:flex;align-items:center;gap:5px;
                  ${isRunning ? 'animation:pulse-badge 2s ease-in-out infinite' : ''}">
        ${stInfo.dot} ${stInfo.label}
      </div>

      <!-- Running action chip — top left -->
      ${isRunning ? `
      <div style="position:absolute;top:14px;left:14px;
                  padding:5px 12px;border-radius:999px;
                  background:${cfg.color}CC;
                  font-size:11px;font-weight:700;color:white;
                  display:flex;align-items:center;gap:4px">
        ⚙️ ${st.currentAction || ''}
      </div>` : ''}

      <!-- Name + info overlay — bottom center -->
      <div style="position:absolute;bottom:0;left:0;right:0;
                  padding:24px 20px 22px;text-align:center">

        <!-- Agent name -->
        <div style="font-size:28px;font-weight:900;color:white;
                    text-shadow:0 2px 16px rgba(0,0,0,0.9);
                    letter-spacing:-0.5px;line-height:1.15">
          ${cfg.emoji} ${cfg.label}
        </div>

        <!-- Role badge -->
        <div style="display:inline-flex;align-items:center;margin-top:6px;
                    padding:3px 12px;border-radius:999px;
                    background:${cfg.color}33;border:1px solid ${cfg.color}66;
                    font-size:12px;font-weight:600;color:${cfg.color};
                    backdrop-filter:blur(4px)">
          ${cfg.role}
        </div>

        <!-- Divider -->
        <div style="height:1px;background:rgba(255,255,255,0.12);margin:10px 0 8px"></div>

        <!-- Last run + result -->
        <div style="font-size:11.5px;color:rgba(255,255,255,0.55);
                    display:flex;flex-direction:column;gap:3px">
          <div>⏱ ${lastRun}</div>
          ${result ? `<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
                                  padding:0 4px" title="${escHtml(st.lastResult||'')}">
            📝 ${escHtml(result)}${(st.lastResult||'').length > 42 ? '…' : ''}
          </div>` : ''}
        </div>

        <!-- Enter arrow -->
        <div style="margin-top:12px;display:flex;align-items:center;justify-content:center;gap:6px;
                    font-size:13px;font-weight:700;color:${cfg.color}">
          เปิดหน้าควบคุม
          <span style="font-size:16px">→</span>
        </div>

      </div>
    </div>`;
  }).join('');

  // การ์ดพิเศษ: อนิเมะ Generator (ไม่ใช่ agent process — ลิงก์ตรงไป dashboard)
  const animeCard = `
    <div onclick="window.location='/dashboard/anime'" class="agent-card"
         style="cursor:pointer;border-radius:24px;overflow:hidden;position:relative;aspect-ratio:3/4;
                border:2px solid #a855f7;box-shadow:0 8px 40px #a855f744,0 2px 12px rgba(0,0,0,0.3);
                transition:all 0.35s ease;background:linear-gradient(160deg,#a855f722 0%,#0f172a 60%);
                display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px">
      <div style="font-size:64px;margin-bottom:8px">🎨</div>
      <div style="font-size:28px;font-weight:900;color:white;text-shadow:0 2px 16px rgba(0,0,0,0.9);letter-spacing:-0.5px">อนิเมะ</div>
      <div style="display:inline-flex;margin-top:8px;padding:3px 12px;border-radius:999px;
                  background:#a855f733;border:1px solid #a855f766;font-size:12px;font-weight:600;color:#c084fc">
        Character Generator
      </div>
      <div style="margin-top:14px;font-size:12px;color:rgba(255,255,255,0.55);line-height:1.5">
        สร้างตัวละครอนิเมะจากรูปคน<br>+ ใส่ข้อความไทย
      </div>
      <div style="margin-top:14px;display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#a855f7">
        เปิดหน้าควบคุม <span style="font-size:16px">→</span>
      </div>
    </div>`;
  const allCards = cards + animeCard;

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Hub</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800;900&display=swap');
  *{font-family:'Sarabun',sans-serif;box-sizing:border-box;margin:0;padding:0}

  body {
    background: radial-gradient(ellipse at top, #1a2444 0%, #0d1117 60%);
    min-height: 100vh;
  }

  .agent-card:hover {
    transform: translateY(-8px) scale(1.02);
    box-shadow: 0 20px 60px var(--glow, rgba(0,0,0,0.4)), 0 4px 20px rgba(0,0,0,0.3) !important;
  }
  .agent-card:hover .card-avatar {
    transform: scale(1.06);
  }
  .agent-card:active {
    transform: translateY(-4px) scale(1.01);
  }

  @keyframes pulse-badge {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.65; }
  }
  @keyframes shimmer {
    0%   { background-position: -200% center; }
    100% { background-position:  200% center; }
  }

  /* Particle dots bg */
  .hub-bg {
    position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:0;
  }
  .hub-bg span {
    position:absolute;border-radius:50%;background:white;opacity:0.04;
    animation:float linear infinite;
  }

  @keyframes float {
    0%   { transform: translateY(100vh) rotate(0deg); opacity:0; }
    10%  { opacity:0.04; }
    90%  { opacity:0.04; }
    100% { transform: translateY(-20vh) rotate(720deg); opacity:0; }
  }
</style>
</head>
<body>

<!-- Floating bg particles -->
<div class="hub-bg">
  ${[...Array(12)].map((_,i) => {
    const size = 4 + Math.random()*8 | 0;
    const left = (i * 8.3 + Math.random()*5) | 0;
    const dur  = 12 + Math.random()*20 | 0;
    const del  = (Math.random()*15) | 0;
    return `<span style="width:${size}px;height:${size}px;left:${left}%;animation-duration:${dur}s;animation-delay:-${del}s"></span>`;
  }).join('')}
</div>

<!-- Header -->
<div style="position:relative;z-index:10;
            background:rgba(15,23,42,0.85);
            backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
            border-bottom:1px solid rgba(255,255,255,0.08);
            color:white;padding:18px 32px;
            display:flex;align-items:center;justify-content:space-between">
  <div style="display:flex;align-items:center;gap:14px">
    <div style="width:42px;height:42px;border-radius:12px;
                background:linear-gradient(135deg,#6366F1,#8B5CF6);
                display:flex;align-items:center;justify-content:center;font-size:22px">
      🤖
    </div>
    <div>
      <div style="font-size:20px;font-weight:900;letter-spacing:-0.3px">Agent Hub</div>
      <div style="font-size:11px;color:#64748B;margin-top:1px">${today}</div>
    </div>
  </div>
  <div style="display:flex;gap:10px">
    <button onclick="location.reload()"
      style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);
             color:#94A3B8;padding:8px 18px;border-radius:10px;cursor:pointer;
             font-size:13px;font-family:inherit;transition:all 0.2s"
      onmouseover="this.style.background='rgba(255,255,255,0.12)';this.style.color='white'"
      onmouseout="this.style.background='rgba(255,255,255,0.07)';this.style.color='#94A3B8'">
      🔄 รีเฟรช
    </button>
    <a href="/logout"
      style="background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.25);
             color:#f87171;padding:8px 18px;border-radius:10px;cursor:pointer;text-decoration:none;
             font-size:13px;font-family:inherit;transition:all 0.2s;display:inline-flex;align-items:center"
      onmouseover="this.style.background='rgba(248,113,113,0.2)'"
      onmouseout="this.style.background='rgba(248,113,113,0.1)'">
      🚪 ออกจากระบบ
    </a>
  </div>
</div>

<!-- Cards -->
<div style="position:relative;z-index:10;max-width:1000px;margin:44px auto;padding:0 28px">
  <div style="text-align:center;margin-bottom:36px">
    <h2 style="font-size:15px;font-weight:600;color:#475569;letter-spacing:.08em;text-transform:uppercase">
      เลือก Agent ที่ต้องการควบคุม
    </h2>
    <div style="width:40px;height:2px;background:linear-gradient(90deg,#6366F1,#8B5CF6);
                margin:10px auto 0;border-radius:999px"></div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;max-width:900px;margin:0 auto">
    ${allCards}
  </div>
</div>

<script>setTimeout(() => location.reload(), 30000);</script>
</body>
</html>`;
}

function buildAgentPage(name, status) {
  const cfg = AGENTS[name];
  if (!cfg) return '<h1>ไม่พบ Agent</h1>';
  const st   = status[name] || {};
  const logs = readLog(name, 80);

  const logsHtml = logs.length
    ? logs.map(l => {
        const color = l.includes('✅') ? '#10B981' : l.includes('❌') ? '#EF4444' : l.includes('⚠️') ? '#F59E0B' : '#374151';
        return `<div style="color:${color};font-size:12.5px;line-height:1.6;padding:1px 0">${escHtml(l)}</div>`;
      }).join('')
    : '<div style="color:#9CA3AF;font-size:13px">ยังไม่มี log</div>';

  const actionBtns = cfg.actions.map(a => `
    <button onclick="runAction('${name}','${a.id}')"
            style="background:${cfg.color};color:white;border:none;padding:10px 18px;border-radius:10px;
                   cursor:pointer;font-size:14px;font-family:inherit;font-weight:600;
                   display:flex;align-items:center;gap:6px;transition:opacity 0.2s"
            onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
      ${a.icon} ${a.label}
    </button>`).join('');

  const lastRun = st.lastRun ? new Date(st.lastRun).toLocaleString('th-TH') : '—';

  // Dashboard tab button (only for mali and manao)
  const dashTab = cfg.hasDashboard
    ? `<button id="tab-dashboard" onclick="switchTab('dashboard')"
         style="padding:12px 20px;border:none;background:transparent;cursor:pointer;font-size:14px;
                font-family:inherit;font-weight:600;color:#9CA3AF;border-bottom:3px solid transparent;transition:all 0.2s">
         📊 Dashboard
       </button>` : '';

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${cfg.label} — Agent Hub</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800&display=swap');
  *{font-family:'Sarabun',sans-serif;box-sizing:border-box;margin:0;padding:0}
  body{background:#F8FAFC;min-height:100vh}
  .log-box{background:#0F172A;border-radius:12px;padding:16px;height:380px;overflow-y:auto;font-family:'Courier New',monospace}
  .log-box::-webkit-scrollbar{width:6px}
  .log-box::-webkit-scrollbar-track{background:#1E293B}
  .log-box::-webkit-scrollbar-thumb{background:#475569;border-radius:3px}
</style>
</head>
<body>
<!-- Header -->
<div style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;padding:16px 28px;display:flex;align-items:center;gap:16px;box-shadow:0 4px 20px rgba(0,0,0,0.2)">
  <a href="/" style="color:white;text-decoration:none;font-size:22px;opacity:0.7" title="กลับ">←</a>
  <div style="position:relative;cursor:pointer" onclick="openAvatarModal()" title="เปลี่ยนรูปโปรไฟล์">
    <img id="agent-avatar" src="/avatar/${name}?t=${Date.now()}" style="width:44px;height:44px;border-radius:50%;border:2px solid ${cfg.color};object-fit:cover" onerror="this.style.display='none'">
    <div style="position:absolute;bottom:-2px;right:-2px;width:18px;height:18px;background:${cfg.color};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;border:2px solid #1a1a2e">🎨</div>
  </div>
  <div>
    <div style="font-size:18px;font-weight:800">${cfg.emoji} ${cfg.label}</div>
    <div style="font-size:12px;color:#94A3B8">${cfg.role}</div>
  </div>
  <div style="margin-left:auto;display:flex;align-items:center;gap:10px">
    ${statusBadge(st.status || 'idle')}
    <button onclick="openAvatarModal()"
      style="background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.25);color:white;
             padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-family:inherit;
             display:flex;align-items:center;gap:5px"
      onmouseover="this.style.background='rgba(255,255,255,0.2)'"
      onmouseout="this.style.background='rgba(255,255,255,0.12)'">
      🎨 เปลี่ยนรูป
    </button>
  </div>
</div>

<!-- ════ Avatar Generator Modal ════ -->
<div id="avatar-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;overflow-y:auto;padding:20px">
  <div style="max-width:680px;margin:0 auto;background:#1E293B;border-radius:20px;overflow:hidden;box-shadow:0 25px 60px rgba(0,0,0,0.5)">

    <!-- Modal Header -->
    <div style="background:linear-gradient(135deg,${cfg.color}CC,${cfg.color}88);padding:20px 24px;display:flex;align-items:center;justify-content:space-between">
      <div>
        <div style="font-size:18px;font-weight:800;color:white">🎨 Generate รูปโปรไฟล์ AI</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.75);margin-top:2px">${cfg.emoji} ${cfg.label} — AnythingXL Anime/Manga</div>
      </div>
      <button onclick="closeAvatarModal()" style="background:rgba(255,255,255,0.15);border:none;color:white;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center">✕</button>
    </div>

    <!-- Modal Body -->
    <div style="padding:24px;display:flex;flex-direction:column;gap:20px">

      <!-- Step 1: Options -->
      <div id="gen-options" style="display:flex;flex-direction:column;gap:16px">

        <!-- Gender -->
        <div>
          <div style="font-size:13px;font-weight:600;color:#94A3B8;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">เพศตัวละคร</div>
          <div style="display:flex;gap:10px">
            <button id="btn-gender-f" onclick="setGender('f')"
              style="flex:1;padding:12px;border-radius:12px;border:2px solid ${cfg.color};background:${cfg.color}22;
                     color:white;cursor:pointer;font-size:16px;font-family:inherit;font-weight:700;transition:all 0.2s">
              ♀ หญิง
            </button>
            <button id="btn-gender-m" onclick="setGender('m')"
              style="flex:1;padding:12px;border-radius:12px;border:2px solid #475569;background:transparent;
                     color:#94A3B8;cursor:pointer;font-size:16px;font-family:inherit;font-weight:700;transition:all 0.2s">
              ♂ ชาย
            </button>
          </div>
        </div>

        <!-- Outfit -->
        <div>
          <div style="font-size:13px;font-weight:600;color:#94A3B8;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">การแต่งตัว</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
            ${['นักเรียน','ออฟฟิศ','มิโค','บัตเลอร์/เมด','แนวต่อสู้'].map((outfit, i) => {
              const icons = ['🎒','💼','⛩️','🎩','⚔️'];
              return `<button id="btn-outfit-${i}" data-outfit="${outfit}" onclick="setOutfit('${outfit}',${i})"
                style="padding:10px 8px;border-radius:10px;border:2px solid ${i===0?cfg.color:'#475569'};
                       background:${i===0?cfg.color+'22':'transparent'};color:${i===0?'white':'#94A3B8'};
                       cursor:pointer;font-size:13px;font-family:inherit;font-weight:600;transition:all 0.2s;
                       display:flex;flex-direction:column;align-items:center;gap:4px">
                <span style="font-size:20px">${icons[i]}</span>${outfit}
              </button>`;
            }).join('')}
          </div>
        </div>

        <!-- Generate button -->
        <button id="gen-btn" onclick="startGenerate()"
          style="width:100%;padding:14px;border-radius:12px;border:none;
                 background:linear-gradient(135deg,${cfg.color},${cfg.color}CC);
                 color:white;font-size:16px;font-family:inherit;font-weight:700;
                 cursor:pointer;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:8px"
          onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
          ✨ Generate 4 รูป
        </button>
      </div>

      <!-- Step 2: Loading -->
      <div id="gen-loading" style="display:none;text-align:center;padding:20px 0">
        <div style="font-size:40px;margin-bottom:12px;animation:spin 2s linear infinite;display:inline-block">⚙️</div>
        <div style="font-size:15px;color:#E2E8F0;font-weight:600" id="load-text">กำลัง Generate รูป...</div>
        <div style="margin-top:12px;background:#0F172A;border-radius:999px;height:6px;overflow:hidden">
          <div id="load-bar" style="height:6px;background:${cfg.color};border-radius:999px;width:0%;transition:width 0.5s"></div>
        </div>
        <div style="font-size:12px;color:#64748B;margin-top:6px" id="load-sub">ส่ง job ไป ComfyUI...</div>
      </div>

      <!-- Step 3: Results grid -->
      <div id="gen-results" style="display:none;flex-direction:column;gap:16px">
        <div style="font-size:13px;font-weight:600;color:#94A3B8">คลิกเลือกรูปที่ต้องการ:</div>
        <div id="img-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px"></div>
        <div style="display:flex;gap:10px;margin-top:4px">
          <button id="save-btn" onclick="saveSelectedAvatar()" disabled
            style="flex:2;padding:12px;border-radius:12px;border:none;
                   background:#64748B;color:#94A3B8;
                   font-size:15px;font-family:inherit;font-weight:700;cursor:not-allowed;transition:all 0.2s">
            ✅ ใช้รูปที่เลือก
          </button>
          <button onclick="resetToGen()"
            style="flex:1;padding:12px;border-radius:12px;border:1px solid #475569;
                   background:transparent;color:#94A3B8;font-size:14px;font-family:inherit;cursor:pointer">
            🔄 Generate ใหม่
          </button>
        </div>
        <button onclick="resetSvgAvatar()"
          style="width:100%;padding:8px;border-radius:8px;border:1px solid #334155;
                 background:transparent;color:#64748B;font-size:12px;font-family:inherit;cursor:pointer">
          🗑 รีเซ็ตกลับเป็นรูป SVG เดิม
        </button>
      </div>

    </div>
  </div>
</div>

<style>
@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
@keyframes fadeIn { from{opacity:0;transform:scale(0.95)} to{opacity:1;transform:scale(1)} }
</style>

<!-- Tab bar -->
<div style="background:white;border-bottom:1px solid #E5E7EB;padding:0 28px;display:flex;gap:0">
  <button id="tab-control" onclick="switchTab('control')"
    style="padding:12px 20px;border:none;background:transparent;cursor:pointer;font-size:14px;
           font-family:inherit;font-weight:600;color:${cfg.color};border-bottom:3px solid ${cfg.color};transition:all 0.2s">
    ⚡ Control
  </button>
  ${dashTab}
</div>

<!-- Control Panel -->
<div id="panel-control" style="display:block">
  <div style="max-width:960px;margin:24px auto;padding:0 20px;display:grid;grid-template-columns:1fr 1fr;gap:20px">

    <!-- Left: Actions + Info -->
    <div style="display:flex;flex-direction:column;gap:16px">
      <div style="background:white;border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,0.06)">
        <h3 style="font-size:15px;font-weight:700;color:#374151;margin-bottom:14px">⚡ Actions</h3>
        <div style="display:flex;flex-wrap:wrap;gap:10px">${actionBtns}</div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button onclick="stopAgent('${name}')"
                  style="background:#FEF2F2;color:#EF4444;border:1px solid #FCA5A5;padding:8px 16px;
                         border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;font-weight:600">
            ⏹ หยุด
          </button>
          <button onclick="restartAgent('${name}')"
                  style="background:#FFFBEB;color:#F59E0B;border:1px solid #FCD34D;padding:8px 16px;
                         border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;font-weight:600">
            🔄 Restart
          </button>
          ${(name === 'namkhao') ? `
          <button onclick="restartTelegramBot()" id="tg-restart-btn"
                  style="background:#1565C0;color:white;border:none;padding:8px 16px;
                         border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit;font-weight:600">
            🤖 Restart น้ำข้าว Bot
          </button>` : ''}
        </div>
      </div>
      <div style="background:white;border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,0.06)">
        <h3 style="font-size:15px;font-weight:700;color:#374151;margin-bottom:14px">📋 สถานะ</h3>
        <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;color:#6B7280">
          <div style="display:flex;justify-content:space-between"><span>สถานะ</span><span id="cur-status" style="font-weight:600">${st.status||'idle'}</span></div>
          <div style="display:flex;justify-content:space-between"><span>Action ปัจจุบัน</span><span id="cur-action">${st.currentAction||'—'}</span></div>
          <div style="display:flex;justify-content:space-between"><span>รันล่าสุด</span><span>${lastRun}</span></div>
          <div style="display:flex;justify-content:space-between"><span>ผลล่าสุด</span>
            <span style="max-width:180px;text-align:right;color:#374151" id="cur-result">${escHtml((st.lastResult||'—').substring(0,40))}</span></div>
          <div style="display:flex;justify-content:space-between"><span>PID</span><span id="cur-pid">${st.pid||'—'}</span></div>
        </div>
      </div>
    </div>

    <!-- Right: Live Log -->
    <div style="background:white;border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,0.06)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="font-size:15px;font-weight:700;color:#374151">📜 Live Log</h3>
        <span id="log-count" style="font-size:12px;color:#9CA3AF">${logs.length} บรรทัด</span>
      </div>
      <div class="log-box" id="log-container">${logsHtml}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
        <label style="font-size:12px;color:#9CA3AF;display:flex;align-items:center;gap:4px">
          <input type="checkbox" id="auto-scroll" checked> Auto scroll
        </label>
        <button onclick="clearLog()" style="font-size:12px;color:#9CA3AF;background:none;border:none;cursor:pointer">🗑 ล้าง log</button>
      </div>
    </div>
  </div>
</div>

<!-- Dashboard Panel (iframe) -->
<div id="panel-dashboard" style="display:none">
  <iframe id="dash-frame" src="" style="width:100%;height:calc(100vh - 110px);border:none;display:block"></iframe>
</div>

<script>
const agentName   = '${name}';
const agentColor  = '${cfg.color}';
const hasDash     = ${cfg.hasDashboard};
let lastLogCount  = ${logs.length};
let currentTab    = 'control';

function switchTab(tab) {
  currentTab = tab;
  // panels
  document.getElementById('panel-control').style.display   = tab === 'control' ? 'block' : 'none';
  document.getElementById('panel-dashboard').style.display = tab === 'dashboard' ? 'block' : 'none';
  // tab styles
  const tabs = ['control', 'dashboard'];
  tabs.forEach(t => {
    const el = document.getElementById('tab-' + t);
    if (!el) return;
    if (t === tab) {
      el.style.color = agentColor;
      el.style.borderBottom = '3px solid ' + agentColor;
    } else {
      el.style.color = '#9CA3AF';
      el.style.borderBottom = '3px solid transparent';
    }
  });
  // load iframe on first switch to dashboard
  if (tab === 'dashboard') {
    const iframe = document.getElementById('dash-frame');
    if (!iframe.src || iframe.src === window.location.href) {
      iframe.src = '/dashboard/' + agentName;
    }
  }
}

async function runAction(name, action) {
  const r = await fetch('/api/agent/'+name+'/start', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ action })
  });
  const j = await r.json();
  if (j.ok) showToast('เริ่ม action: '+action);
  else showToast('❌ '+j.error, true);
  setTimeout(refreshStatus, 800);
}

async function stopAgent(name) {
  await fetch('/api/agent/'+name+'/stop', { method:'POST' });
  showToast('⏹ หยุด Agent แล้ว');
  setTimeout(refreshStatus, 500);
}

async function restartAgent(name) {
  await fetch('/api/agent/'+name+'/stop', { method:'POST' });
  await new Promise(r => setTimeout(r, 600));
  await fetch('/api/agent/'+name+'/start', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ action: 'status' })
  });
  showToast('🔄 Restart สำเร็จ');
  setTimeout(refreshStatus, 800);
}

async function restartTelegramBot() {
  const btn = document.getElementById('tg-restart-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลัง restart...'; }
  try {
    const r = await fetch('/api/telegram/restart', { method: 'POST' });
    const j = await r.json();
    if (j.ok) showToast('🤖 Telegram Bot restart สำเร็จ (PID: ' + j.pid + ')');
    else      showToast('❌ ' + (j.error || 'เกิดข้อผิดพลาด'));
  } catch (e) {
    showToast('❌ ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 Restart Telegram Bot'; }
  }
}

async function clearLog() {
  await fetch('/api/agent/'+agentName+'/clear-log', { method:'POST' });
  document.getElementById('log-container').innerHTML = '<div style="color:#9CA3AF;font-size:13px">Log ถูกล้างแล้ว</div>';
}

async function refreshLog() {
  if (currentTab !== 'control') return;
  const r = await fetch('/api/agent/'+agentName+'/logs');
  const j = await r.json();
  if (!j.lines || j.lines.length === lastLogCount) return;
  lastLogCount = j.lines.length;
  const box = document.getElementById('log-container');
  box.innerHTML = j.lines.map(l => {
    const color = l.includes('✅') ? '#10B981' : l.includes('❌') ? '#EF4444' : l.includes('⚠️') ? '#F59E0B' : '#CBD5E1';
    return '<div style="color:'+color+';font-size:12.5px;line-height:1.6;padding:1px 0">'+escHtml(l)+'</div>';
  }).join('');
  document.getElementById('log-count').textContent = j.lines.length + ' บรรทัด';
  if (document.getElementById('auto-scroll')?.checked) box.scrollTop = box.scrollHeight;
}

async function refreshStatus() {
  const r = await fetch('/api/status');
  const j = await r.json();
  const st = j[agentName] || {};
  document.getElementById('cur-status').textContent = st.status || 'idle';
  document.getElementById('cur-action').textContent = st.currentAction || '—';
  document.getElementById('cur-result').textContent = (st.lastResult||'—').substring(0,40);
  document.getElementById('cur-pid').textContent = st.pid || '—';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showToast(msg, err=false) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;top:20px;right:20px;background:'+(err?'#EF4444':'#1a1a2e')
    +';color:white;padding:12px 20px;border-radius:10px;font-size:14px;z-index:9999;transition:opacity 0.5s';
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; setTimeout(() => t.remove(), 500); }, 2500);
}

window.addEventListener('load', () => {
  const box = document.getElementById('log-container');
  if (box) box.scrollTop = box.scrollHeight;
});
setInterval(refreshLog, 2000);
setInterval(refreshStatus, 3000);

// ══════════════════════════════════════════════
//  Avatar Generator Modal
// ══════════════════════════════════════════════

const AGENT_NAME_FOR_AVATAR = '${name}';
const AGENT_COLOR_VAR = '${cfg.color}';

let selectedGender  = 'f';
let selectedOutfit  = 'นักเรียน';
let selectedImgData = null;
let pollTimers      = [];
let _genResults     = [null, null, null, null];

function openAvatarModal() {
  document.getElementById('avatar-modal').style.display = 'block';
  document.body.style.overflow = 'hidden';
  resetToGen();
}
function closeAvatarModal() {
  document.getElementById('avatar-modal').style.display = 'none';
  document.body.style.overflow = '';
  pollTimers.forEach(clearInterval);
  pollTimers = [];
}
function setGender(g) {
  selectedGender = g;
  ['f','m'].forEach(v => {
    const el = document.getElementById('btn-gender-'+v);
    if (!el) return;
    const active = v === g;
    el.style.borderColor = active ? AGENT_COLOR_VAR : '#475569';
    el.style.background  = active ? AGENT_COLOR_VAR + '33' : 'transparent';
    el.style.color       = active ? 'white' : '#94A3B8';
  });
}
function setOutfit(outfit, idx) {
  selectedOutfit = outfit;
  for (let i = 0; i < 5; i++) {
    const b = document.getElementById('btn-outfit-'+i);
    if (!b) continue;
    const active = i === idx;
    b.style.borderColor = active ? AGENT_COLOR_VAR : '#475569';
    b.style.background  = active ? AGENT_COLOR_VAR + '33' : 'transparent';
    b.style.color       = active ? 'white' : '#94A3B8';
  }
}
function resetToGen() {
  pollTimers.forEach(clearInterval);
  pollTimers = [];
  selectedImgData = null;
  _genResults = [null, null, null, null];
  document.getElementById('gen-options').style.display  = 'flex';
  document.getElementById('gen-loading').style.display  = 'none';
  document.getElementById('gen-results').style.display  = 'none';
  document.getElementById('load-bar').style.width = '0%';
  // re-apply active states
  setGender(selectedGender);
}

async function startGenerate() {
  document.getElementById('gen-options').style.display  = 'none';
  document.getElementById('gen-loading').style.display  = 'block';
  document.getElementById('gen-results').style.display  = 'none';
  document.getElementById('load-text').textContent = 'กำลัง Generate รูป...';
  document.getElementById('load-sub').textContent  = 'ส่ง job ไป ComfyUI (AnythingXL)...';
  document.getElementById('load-bar').style.width  = '8%';

  let promptIds;
  try {
    const r = await fetch('/api/generate-avatar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gender: selectedGender, outfit: selectedOutfit }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'ComfyUI error');
    promptIds = j.promptIds;
  } catch(e) {
    document.getElementById('load-text').textContent = '❌ ' + e.message;
    document.getElementById('load-sub').textContent  = 'ตรวจสอบ ComfyUI ที่ 10.3.17.118:8188';
    return;
  }

  document.getElementById('load-sub').textContent = 'รอ ComfyUI render... (ประมาณ 30-90 วิ)';
  document.getElementById('load-bar').style.width = '20%';

  // Show grid with placeholders immediately
  document.getElementById('gen-results').style.display = 'flex';
  document.getElementById('img-grid').innerHTML = [0,1,2,3].map(i => \`
    <div id="img-slot-\${i}"
         style="aspect-ratio:1;border-radius:12px;background:#0F172A;border:2px solid #334155;
                display:flex;align-items:center;justify-content:center;cursor:pointer;
                overflow:hidden;transition:all 0.2s;position:relative">
      <div style="text-align:center;color:#475569">
        <div style="font-size:28px;animation:spin 2s linear infinite;display:inline-block">⚙️</div>
        <div style="font-size:12px;margin-top:6px">รูปที่ \${i+1}</div>
      </div>
    </div>\`).join('');

  let doneCount = 0;
  const startTime = Date.now();

  promptIds.forEach((pid, idx) => {
    const timer = setInterval(async () => {
      try {
        const j = await (await fetch('/api/avatar-job/' + pid)).json();
        if (j.status === 'done') {
          _genResults[idx] = j;
          doneCount++;
          const slot = document.getElementById('img-slot-'+idx);
          if (slot) {
            slot.setAttribute('data-filename',  j.filename  || '');
            slot.setAttribute('data-subfolder', j.subfolder || '');
            slot.setAttribute('data-type',      j.type      || 'output');
            slot.onclick = () => selectImageSlot(idx);
            slot.innerHTML = \`<img src="\${j.viewUrl}?t=\${Date.now()}" style="width:100%;height:100%;object-fit:cover;border-radius:10px">\`;
          }
          const pct = 20 + Math.round(doneCount / 4 * 75);
          document.getElementById('load-bar').style.width = pct + '%';
          document.getElementById('load-sub').textContent = doneCount + '/4 รูปเสร็จแล้ว';
          if (doneCount === 4) document.getElementById('gen-loading').style.display = 'none';
          clearInterval(timer);
        } else if (j.status === 'error') {
          const slot = document.getElementById('img-slot-'+idx);
          if (slot) slot.innerHTML = '<div style="color:#EF4444;font-size:12px;text-align:center">❌ Error</div>';
          clearInterval(timer);
        }
        const sec = Math.round((Date.now()-startTime)/1000);
        document.getElementById('load-text').textContent = 'กำลัง Generate... (' + sec + ' วิ)';
      } catch(e2) {}
    }, 2500);
    pollTimers.push(timer);
  });
}

function selectImageSlot(idx) {
  const slot = document.getElementById('img-slot-'+idx);
  if (!slot) return;
  const img = slot.querySelector('img');
  if (!img) { showToast('รูปยังโหลดไม่เสร็จ', true); return; }

  selectedImgData = {
    filename:  slot.getAttribute('data-filename')  || '',
    subfolder: slot.getAttribute('data-subfolder') || '',
    type:      slot.getAttribute('data-type')      || 'output',
  };

  // highlight selected
  for (let i = 0; i < 4; i++) {
    const s = document.getElementById('img-slot-'+i);
    if (s) { s.style.borderColor = '#334155'; s.style.boxShadow = 'none'; }
  }
  slot.style.borderColor = AGENT_COLOR_VAR;
  slot.style.boxShadow   = '0 0 0 4px ' + AGENT_COLOR_VAR + '55';

  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.style.background = 'linear-gradient(135deg,' + AGENT_COLOR_VAR + ',' + AGENT_COLOR_VAR + 'CC)';
    saveBtn.style.color  = 'white';
    saveBtn.style.cursor = 'pointer';
  }
}

async function saveSelectedAvatar() {
  if (!selectedImgData || !selectedImgData.filename) { showToast('เลือกรูปก่อน', true); return; }
  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) { saveBtn.textContent = '💾 กำลังบันทึก...'; saveBtn.disabled = true; }
  try {
    const r = await fetch('/api/save-avatar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: AGENT_NAME_FOR_AVATAR, ...selectedImgData }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Save error');
    showToast('✅ บันทึกรูปโปรไฟล์เรียบร้อย!');
    const av = document.getElementById('agent-avatar');
    if (av) av.src = '/avatar/' + AGENT_NAME_FOR_AVATAR + '?t=' + Date.now();
    setTimeout(closeAvatarModal, 1200);
  } catch(e) {
    showToast('❌ ' + e.message, true);
    if (saveBtn) { saveBtn.textContent = '✅ ใช้รูปที่เลือก'; saveBtn.disabled = false; }
  }
}

async function resetSvgAvatar() {
  if (!confirm('รีเซ็ตกลับเป็นรูป SVG เดิมใช่ไหม?')) return;
  await fetch('/api/reset-avatar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentName: AGENT_NAME_FOR_AVATAR }),
  });
  const av = document.getElementById('agent-avatar');
  if (av) av.src = '/avatar/' + AGENT_NAME_FOR_AVATAR + '?t=' + Date.now();
  showToast('รีเซ็ตกลับ SVG เรียบร้อย');
  closeAvatarModal();
}

// Close on backdrop click
document.getElementById('avatar-modal').addEventListener('click', function(e) {
  if (e.target === this) closeAvatarModal();
});
</script>
</body>
</html>`;
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const rawUrl = req.url;
  const url    = rawUrl.split('?')[0];
  const method = req.method;

  // ── 🔐 Login gate: ตรวจ session ก่อนทุก route ──────────────────────────────
  // จัดการ /login, /logout และบล็อก request ที่ยังไม่ได้ login
  if (auth.gate(req, res)) return;

  // ── Avatar (PNG → fallback SVG) ─────────────────────────────────────────────
  const avatarMatch = url.match(/^\/avatar\/(\w+)$/);
  if (avatarMatch) {
    const name    = avatarMatch[1];
    const pngPath = path.join(ROOT, 'agents', name, 'avatar.png');
    const svgPath = path.join(ROOT, 'agents', name, 'avatar.svg');
    if (fs.existsSync(pngPath)) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
      fs.createReadStream(pngPath).pipe(res);
    } else if (fs.existsSync(svgPath)) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=3600' });
      fs.createReadStream(svgPath).pipe(res);
    } else { res.writeHead(404); res.end(); }
    return;
  }

  // ── API: ComfyUI proxy image ─────────────────────────────────────────────────
  if (url === '/api/comfy-image' && method === 'GET') {
    const params    = new URLSearchParams(rawUrl.split('?')[1] || '');
    const filename  = params.get('filename') || '';
    const subfolder = params.get('subfolder') || '';
    const type      = params.get('type') || 'output';
    const comfyPath = `/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
    try {
      const { data, contentType } = await comfyGetBinary(comfyPath);
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch(e) { res.writeHead(502); res.end('ComfyUI error: ' + e.message); }
    return;
  }

  // ── API: Generate avatar (submit 4 jobs) ─────────────────────────────────────
  if (url === '/api/generate-avatar' && method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const { gender = 'f', outfit = 'นักเรียน' } = JSON.parse(body || '{}');
        const gKey     = gender === 'm' ? 'm' : 'f';
        const outfitTags = (OUTFIT_PROMPTS[outfit] || OUTFIT_PROMPTS['นักเรียน'])[gKey];
        const positive = `${STYLE_BASE}, ${GENDER_BASE[gKey]}, ${outfitTags}`;

        // submit 4 jobs concurrently
        const promptIds = await Promise.all([
          submitComfyJob(positive),
          submitComfyJob(positive),
          submitComfyJob(positive),
          submitComfyJob(positive),
        ]);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, promptIds, positive }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── API: Poll single avatar job ──────────────────────────────────────────────
  const jobMatch = url.match(/^\/api\/avatar-job\/([a-zA-Z0-9-]+)$/);
  if (jobMatch && method === 'GET') {
    try {
      const result = await getComfyJobResult(jobMatch[1]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'pending' }));
    }
    return;
  }

  // ── API: Save selected avatar ────────────────────────────────────────────────
  if (url === '/api/save-avatar' && method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const { agentName, filename, subfolder, type } = JSON.parse(body || '{}');
        if (!agentName || !filename) throw new Error('Missing agentName or filename');
        const comfyPath = `/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder||'')}&type=${encodeURIComponent(type||'output')}`;
        const { data }  = await comfyGetBinary(comfyPath);
        const savePath  = path.join(ROOT, 'agents', agentName, 'avatar.png');
        fs.writeFileSync(savePath, data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, saved: savePath }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── API: Reset avatar to SVG (ลบ PNG) ───────────────────────────────────────
  if (url === '/api/reset-avatar' && method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { agentName } = JSON.parse(body || '{}');
        const pngPath = path.join(ROOT, 'agents', agentName, 'avatar.png');
        if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── Product images (Shopee dashboard) ──────────────────────────────────────
  const imgMatch = url.match(/^\/img\/(\d+)\/(.+)$/);
  if (imgMatch) { serveProductImage(res, imgMatch[1], imgMatch[2]); return; }

  // ── Dashboard: มะลิ (Shopee) ────────────────────────────────────────────────
  if (url === '/dashboard/mali') {
    const products = loadProducts();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildShopeeHTML(products));
    return;
  }

  // ── Dashboard API: มะลิ products JSON ──────────────────────────────────────
  if (url === '/dashboard/mali/api/products') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(loadProducts(), null, 2));
    return;
  }

  // ── Dashboard: มะนาว (AI News) HTML ────────────────────────────────────────
  if (url === '/dashboard/manao') {
    serveNewsHTML(res);
    return;
  }

  // ── Dashboard API: มะนาว /api/data ──────────────────────────────────────────
  if (url.startsWith('/dashboard/manao/api/data')) {
    const data = JSON.stringify(buildNewsApiData(), null, 2);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    res.end(data);
    return;
  }

  // ── Dashboard API: มะนาว /api/config (GET) ──────────────────────────────────
  if (url === '/dashboard/manao/api/config' && method === 'GET') {
    try {
      const { loadConfig } = require(path.join(AI_NEWS_DIR, 'config.js'));
      const cfg = loadConfig();   // loadConfig อ่าน config.json สดทุกครั้ง
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(JSON.stringify({ filter: cfg.filter, formatter: cfg.formatter }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  // ── Dashboard API: มะนาว /api/config (POST) ─────────────────────────────────
  if (url === '/dashboard/manao/api/config' && method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body || '{}');
        const cfgFile  = path.join(AI_NEWS_DIR, 'config.json');
        const clampInt = (v, min, max) => {
          let n = parseInt(v, 10); if (isNaN(n)) n = min;
          return Math.max(min, Math.min(max, n));
        };

        // อ่าน config.json ปัจจุบัน (เก็บ _comment ไว้)
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
    return;
  }

  // ── Dashboard API: มะนาว /api/log ───────────────────────────────────────────
  if (url.startsWith('/dashboard/manao/api/log')) {
    const logFile = path.join(AI_NEWS_DIR, 'pipeline.log');
    if (!fs.existsSync(logFile)) { res.writeHead(404); return res.end('No log'); }
    const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(lines.slice(-100).join('\n'));
  }

  // ── Dashboard API: มะนาว facebook/ig content ───────────────────────────────
  if (url.startsWith('/dashboard/manao/api/facebook-content') || url.startsWith('/dashboard/manao/api/ig-content')) {
    const params   = new URLSearchParams(rawUrl.split('?')[1] || '');
    const slug     = params.get('slug');
    const platform = url.includes('facebook') ? 'facebook' : 'instagram';
    if (!slug) { res.writeHead(400); return res.end('Missing slug'); }
    const filePath = path.join(AI_NEWS_DIR, 'news', slug, 'content', platform + '.md');
    if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(fs.readFileSync(filePath, 'utf8'));
  }

  // ── Dashboard API: มะนาว GET /news-image/:slug ─────────────────────────────
  const newsImgMatch = url.match(/^\/dashboard\/manao\/news-image\/(.+)$/);
  if (newsImgMatch) {
    const slug    = decodeURIComponent(newsImgMatch[1]);
    const imgPath = path.join(AI_NEWS_DIR, 'news', slug, 'image.jpg');
    if (!fs.existsSync(imgPath)) { res.writeHead(404); return res.end('No image'); }
    const img = fs.readFileSync(imgPath);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': img.length, 'Cache-Control': 'no-cache' });
    return res.end(img);
  }

  // ── Dashboard API: มะนาว POST /api/generate-image ──────────────────────────
  if (url === '/dashboard/manao/api/generate-image' && method === 'POST') {
    let body = '';
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
        const { execSync } = require('child_process');
        console.log(`[Hub] 🎨 Generate image: ${slug}`);
        const out = execSync(
          `"C:\\Program Files\\nodejs\\node.exe" "${path.join(AI_NEWS_DIR, 'comfy-gen.js')}" "${slug}"`,
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
    return;
  }

  // ── Dashboard API: มะนาว POST /api/generate-force ────────────────────────
  // สร้าง content (FB+IG) + รูป ComfyUI ใหม่ทับของเดิม โดยไม่ส่ง Telegram
  if (url === '/dashboard/manao/api/generate-force' && method === 'POST') {
    let body = '';
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
        const { execSync } = require('child_process');
        console.log(`[Hub] 🔄 Generate force: ${slug}`);
        const out = execSync(
          `"C:\\Program Files\\nodejs\\node.exe" "${path.join(AI_NEWS_DIR, 'generate.js')}" "${slug}" --force --no-telegram`,
          { cwd: AI_NEWS_DIR, encoding: 'utf8', timeout: 10 * 60 * 1000 }  // 10 นาที (Ollama + ComfyUI)
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
    return;
  }

  // ── Dashboard API: มะนาว POST /api/request-approval ───────────────────────
  if (url === '/dashboard/manao/api/request-approval' && method === 'POST') {
    let body = '';
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
    return;
  }

  // ── Dashboard API: มะนาว POST /api/post ────────────────────────────────────
  if (url === '/dashboard/manao/api/post' && method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      const json = (() => { try { return JSON.parse(body); } catch { return {}; } })();
      const { slug, platform } = json;
      if (!slug || !platform) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Missing slug or platform' }));
      }
      const dataPath = path.join(AI_NEWS_DIR, 'news', slug, 'data.json');
      if (!fs.existsSync(dataPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: `ไม่พบ news/${slug}/data.json` }));
      }
      try {
        const { execSync } = require('child_process');
        const postScript = path.join(AI_NEWS_DIR, 'post.js');
        const cmd = `"C:\\Program Files\\nodejs\\node.exe" "${postScript}" "${slug}" --platform ${platform}`;
        const out = execSync(cmd, { cwd: AI_NEWS_DIR, encoding: 'utf8', timeout: 5 * 60 * 1000 });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, message: 'โพสต์สำเร็จ', output: out.substring(0, 500) }));
      } catch (e) {
        const errMsg = (e.stdout || e.stderr || e.message || '').substring(0, 300);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: errMsg }));
      }
    });
    return;
  }

  // ── Dashboard API: มะนาว GET /api/content ──────────────────────────────────
  if (url.startsWith('/dashboard/manao/api/content') && method === 'GET') {
    const params   = new URLSearchParams(rawUrl.split('?')[1] || '');
    const slug     = params.get('slug');
    const platform = params.get('platform');
    if (!slug || !platform) { res.writeHead(400); return res.end('Missing slug or platform'); }
    const pfMap = { fb: 'facebook', ig: 'instagram', x: 'x', tiktok: 'tiktok' };
    const fname = pfMap[platform] || platform;
    const filePath = path.join(AI_NEWS_DIR, 'news', slug, 'content', fname + '.md');
    if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(fs.readFileSync(filePath, 'utf8'));
  }

  // ── Dashboard API: มะนาว POST /api/run-agent ────────────────────────────────
  if (url === '/dashboard/manao/api/run-agent' && method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const json = (() => { try { return JSON.parse(body); } catch { return {}; } })();
      const { agent, args = [] } = json;
      if (!agent) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Missing agent' }));
      }
      if (pipelineProcs[agent] !== null) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: `${agent} กำลังทำงานอยู่แล้ว` }));
      }
      // pipeline → ใช้ sequential runner (step-by-step tracking)
      if (agent === 'pipeline') {
        runPipelineSequential(args);  // async, non-blocking
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, pid: 'pipeline' }));
      }

      const scriptMap = {
        scrape:    'scrape.js',
        filter:    path.join('agents', 'filter-agent.js'),
        editor:    path.join('agents', 'editor-agent.js'),
        formatter: path.join('agents', 'formatter-agent.js'),
      };
      const script = scriptMap[agent];
      if (!script) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: `Unknown agent: ${agent}` }));
      }
      const scriptPath = path.join(AI_NEWS_DIR, script);
      if (!fs.existsSync(scriptPath)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: `ไม่พบ script: ${script}` }));
      }
      const proc = spawn(process.execPath, [scriptPath, ...args], {
        cwd: AI_NEWS_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      pipelineProcs[agent] = proc.pid;
      const logFile = path.join(AI_NEWS_DIR, 'pipeline.log');
      const ts = () => new Date().toISOString().replace('T',' ').substring(0,19);
      proc.stdout.on('data', d => { try { fs.appendFileSync(logFile, d.toString(), 'utf8'); } catch {} });
      proc.stderr.on('data', d => { try { fs.appendFileSync(logFile, `[ERR] ${d.toString()}`, 'utf8'); } catch {} });
      proc.on('close', code => {
        pipelineProcs[agent] = null;
        try { fs.appendFileSync(logFile, `[${ts()}] ${agent} เสร็จ (exit ${code})\n`, 'utf8'); } catch {}
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pid: proc.pid }));
    });
    return;
  }

  // ── Dashboard API: มะนาว GET /api/pipeline-status ──────────────────────────
  if (url === '/dashboard/manao/api/pipeline-status' && method === 'GET') {
    const st = pipelineStatus || { running: false, steps: [], log: '', startedAt: null, finishedAt: null };
    // ส่ง log 80 บรรทัดล่าสุด (ไม่ส่งทั้งหมดเพื่อลด payload)
    const logLines = (st.log || '').split('\n').filter(Boolean).slice(-80).join('\n');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({ ...st, log: logLines }));
  }

  // ── Dashboard API: มะนาว GET /api/agent-log ─────────────────────────────────
  if (url.startsWith('/dashboard/manao/api/agent-log') && method === 'GET') {
    const params  = new URLSearchParams(rawUrl.split('?')[1] || '');
    const agentId = params.get('agent');
    const running = pipelineProcs[agentId] !== null;
    const logFile = path.join(AI_NEWS_DIR, 'pipeline.log');
    if (!fs.existsSync(logFile)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ log: '', running }));
    }
    const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).slice(-30);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ log: lines.join('\n'), running }));
  }

  // ── Dashboard API: มะลิ GET /api/content ───────────────────────────────────
  if (url.startsWith('/dashboard/mali/api/content') && method === 'GET') {
    const params   = new URLSearchParams(rawUrl.split('?')[1] || '');
    const itemId   = params.get('id');
    const platform = params.get('platform');
    const pfMap    = { fb: 'facebook', ig: 'instagram', tiktok: 'tiktok' };
    if (!itemId || !pfMap[platform]) { res.writeHead(400); return res.end('Missing id or invalid platform'); }
    const filePath = path.join(ROOT, 'products', itemId, 'content', pfMap[platform] + '.md');
    if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(fs.readFileSync(filePath, 'utf8'));
  }

  // ── Dashboard API: มะลิ POST /api/generate-force ──────────────────────────
  // สร้าง content (FB+IG+TikTok) ใหม่ทับของเดิม ด้วย generate-content.js --force
  if (url === '/dashboard/mali/api/generate-force' && method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      const { id } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Missing id' }));
      }
      const dataPath = path.join(ROOT, 'products', id, 'data.json');
      if (!fs.existsSync(dataPath)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: `ไม่พบ products/${id}/data.json` }));
      }
      try {
        const { execSync } = require('child_process');
        console.log(`[Hub] 🔄 Mali generate-force: ${id}`);
        const out = execSync(
          `"C:\\Program Files\\nodejs\\node.exe" "${path.join(ROOT, 'generate-content.js')}" "${id}" --force`,
          { cwd: ROOT, encoding: 'utf8', timeout: 8 * 60 * 1000 }  // 8 นาที (Ollama × 3)
        );
        console.log(`[Hub] ✅ Mali generate-force complete: ${id}`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, log: out.substring(0, 1500) }));
      } catch (e) {
        const errMsg = (e.stdout || e.stderr || e.message || '').substring(0, 500);
        console.log(`[Hub] ❌ Mali generate-force failed: ${errMsg.substring(0, 80)}`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: errMsg }));
      }
    });
    return;
  }

  // ── Dashboard API: มะลิ POST /api/create-video ────────────────────────────
  // สร้างวิดีโอ TikTok: รูปสินค้า → ComfyUI img2img → FFmpeg → video.mp4
  if (url === '/dashboard/mali/api/create-video' && method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      const { id } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Missing id' }));
      }
      const dataPath = path.join(ROOT, 'products', id, 'data.json');
      const ttPath   = path.join(ROOT, 'products', id, 'content', 'tiktok.md');
      if (!fs.existsSync(dataPath)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: `ไม่พบ products/${id}/data.json` }));
      }
      if (!fs.existsSync(ttPath)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: `ไม่พบ tiktok.md — รัน Generate Content ก่อน` }));
      }
      // ใช้ spawn แทน execSync เพื่อไม่ block event loop ระหว่างสร้างวิดีโอ (อาจใช้เวลา 1-3 นาที)
      console.log(`[Hub] 🎬 Mali create-video: ${id}`);
      const videoProc = spawn(
        process.execPath,
        [path.join(ROOT, 'make-tiktok-video.js'), id, '--force'],
        { cwd: ROOT }
      );
      let stdout = '', stderr = '';
      videoProc.stdout.on('data', d => { stdout += d; });
      videoProc.stderr.on('data', d => { stderr += d; });
      videoProc.on('error', err => {
        console.log(`[Hub] ❌ Mali create-video spawn error: ${err.message}`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      });
      videoProc.on('close', code => {
        const videoPath = path.join(ROOT, 'products', id, 'video.mp4');
        const hasVideo  = fs.existsSync(videoPath);
        const sizeKB    = hasVideo ? Math.round(fs.statSync(videoPath).size / 1024) : 0;
        if (code === 0) {
          console.log(`[Hub] ✅ Mali create-video complete: ${id} size=${sizeKB}KB`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, hasVideo, sizeKB, log: stdout.substring(0, 2000) }));
        } else {
          const errMsg = (stdout + '\n' + stderr).trim().substring(0, 600);
          console.log(`[Hub] ❌ Mali create-video failed (exit ${code}): ${errMsg.substring(0, 80)}`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: errMsg }));
        }
      });
    });
    return;
  }

  // ── Dashboard API: มะลิ POST /api/post ────────────────────────────────────
  // โพสต์ FB / IG / X โดยใช้ post.js --force (โพสต์ได้เสมอ)
  if (url === '/dashboard/mali/api/post' && method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      const { id, platforms } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
      if (!id || !Array.isArray(platforms) || !platforms.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Missing id or platforms' }));
      }
      const valid = platforms.filter(p => ['fb', 'ig', 'x'].includes(p));
      if (!valid.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Platform ต้องเป็น fb, ig หรือ x' }));
      }
      const platStr = valid.join(',');
      try {
        const { execSync } = require('child_process');
        console.log(`[Hub] 📤 Mali post: ${id} --platform ${platStr}`);
        const out = execSync(
          `"C:\\Program Files\\nodejs\\node.exe" "${path.join(ROOT, 'post.js')}" "${id}" --platform ${platStr}`,
          { cwd: ROOT, encoding: 'utf8', timeout: 5 * 60 * 1000 }
        );
        console.log(`[Hub] ✅ Mali post complete: ${id} platform=${platStr}`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, log: out.substring(0, 2000) }));
      } catch (e) {
        const errMsg = (e.stdout || e.stderr || e.message || '').substring(0, 500);
        console.log(`[Hub] ❌ Mali post failed: ${errMsg.substring(0, 80)}`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: errMsg }));
      }
    });
    return;
  }

  // ── Dashboard API: มะลิ POST /api/post-fb-clip ────────────────────────────
  // โพสต์ video.mp4 ไป Facebook Page พร้อม caption จาก facebook.md
  if (url === '/dashboard/mali/api/post-fb-clip' && method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      const { id } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Missing id' }));
      }
      const videoPath = path.join(ROOT, 'products', id, 'video.mp4');
      if (!fs.existsSync(videoPath)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: `ไม่พบ products/${id}/video.mp4 — กด 🎬 สร้างวิดีโอก่อน` }));
      }
      try {
        console.log(`[Hub] 📘▶ Mali post-fb-reels: ${id}`);
        const result = await uploadFBReels(id);
        // อัปเดต data.json: เพิ่ม fb-clip ใน posted_platforms ถ้าสำเร็จ
        try {
          const dataPath = path.join(ROOT, 'products', id, 'data.json');
          const dataJson = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
          const platforms = Array.isArray(dataJson.posted_platforms) ? dataJson.posted_platforms : [];
          if (!platforms.includes('fb-clip')) platforms.push('fb-clip');
          dataJson.posted_platforms = platforms;
          dataJson.fb_clip_video_id  = result.id;
          dataJson.fb_clip_posted_at = new Date().toISOString();
          fs.writeFileSync(dataPath, JSON.stringify(dataJson, null, 2), 'utf8');
        } catch (e) { console.log(`[Hub] ⚠️ data.json update: ${e.message}`); }
        console.log(`[Hub] ✅ Mali post-fb-reels complete: ${id} video_id=${result.id} size=${result.sizeKB}KB`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, videoId: result.id, sizeKB: result.sizeKB }));
      } catch (e) {
        console.log(`[Hub] ❌ Mali post-fb-clip failed: ${e.message}`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── Dashboard: น้ำข้าว HTML ────────────────────────────────────────────────
  if (url === '/dashboard/namkhao') {
    serveNamkhaoHTML(res);
    return;
  }

  // ── Dashboard API: น้ำข้าว /api/schedule-status ────────────────────────────
  if (url === '/dashboard/namkhao/api/schedule-status' && method === 'GET') {
    try {
      const data = getScheduleStatus();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ ok: true, ...data }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // ── Dashboard API: น้ำข้าว /api/schedule-run ───────────────────────────────
  if (url === '/dashboard/namkhao/api/schedule-run' && method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const { taskName } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
      if (!taskName) { res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'Missing taskName' })); }
      try {
        runScheduleNow(taskName);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── Dashboard API: น้ำข้าว /api/schedule-toggle ────────────────────────────
  if (url === '/dashboard/namkhao/api/schedule-toggle' && method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const { taskName, enable } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
      if (!taskName) { res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'Missing taskName' })); }
      try {
        toggleScheduleTask(taskName, !!enable);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── Dashboard API: น้ำข้าว /api/schedule-edit ──────────────────────────────
  if (url === '/dashboard/namkhao/api/schedule-edit' && method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const { taskName, times } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
      if (!taskName || !Array.isArray(times) || times.length === 0) {
        res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'Missing taskName or times' }));
      }
      try {
        editScheduleTimes(taskName, times);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── Dashboard API: น้ำข้าว /api/schedule-create ────────────────────────────
  if (url === '/dashboard/namkhao/api/schedule-create' && method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const { taskName, xmlPath } = (() => { try { return JSON.parse(body); } catch { return {}; } })();

      // ── Reuters: ใช้ XML import (รองรับ multi-trigger + config ครบ) ──────────
      if (xmlPath) {
        try {
          if (!fs.existsSync(xmlPath)) throw new Error(`ไม่พบไฟล์ XML: ${xmlPath}`);

          // ดึง SID ของ user ปัจจุบันผ่าน whoami /user
          const whoami = runCmd('whoami /user /fo csv /nh').trim();
          const sidMatch = whoami.match(/S-\d+-\d+-[\d-]+/);
          if (!sidMatch) throw new Error('ดึง SID ไม่สำเร็จ: ' + whoami.substring(0, 100));
          const currentSid = sidMatch[0];

          // อ่าน XML แก้ SID เก่า + path เก่า + RunLevel
          let xml = fs.readFileSync(xmlPath, { encoding: 'utf16le' });
          xml = xml.replace(/S-1-5-21-[\d-]+-\d+/g, currentSid);
          xml = xml.replace(/C:\\Users\\[^\\]+\\shopee-affiliate/gi,
                            'C:\\Users\\lenovo3\\agent\\shopee-affiliate');
          xml = xml.replace(/HighestAvailable/g, 'LeastPrivilege');

          // บันทึก XML ชั่วคราวแล้ว import
          const os = require('os');
          const tmpXml = path.join(os.tmpdir(), `sched_${Date.now()}.xml`);
          fs.writeFileSync(tmpXml, xml, { encoding: 'utf16le' });

          const name = taskName || 'AI-News-Pipeline';
          const out  = runCmd(`schtasks /Create /TN "${name}" /XML "${tmpXml}" /F`);
          try { fs.unlinkSync(tmpXml); } catch {}

          if (!out.toLowerCase().includes('success') && !out.includes('สำเร็จ'))
            throw new Error(out.substring(0, 200));

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: true, created: 1, taskName: name }));
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: e.message.substring(0, 300) }));
        }
      }

      // ── Shopee / ทั่วไป: สร้างจาก scriptPath + times ────────────────────────
      const { scriptPath, times } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
      if (!taskName || !scriptPath || !Array.isArray(times) || times.length === 0) {
        res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'Missing taskName, scriptPath or times' }));
      }
      try {
        const isPsScript = scriptPath.trim().toLowerCase().endsWith('.ps1');
        const tr = isPsScript
          ? `powershell.exe -ExecutionPolicy Bypass -NonInteractive -File ""${scriptPath.trim()}""`
          : scriptPath.trim();

        const errors = [];
        for (let i = 0; i < times.length; i++) {
          const name = i === 0 ? taskName : `${taskName}_${i + 1}`;
          const t    = times[i].trim();
          try {
            const out = runCmd(`schtasks /Create /TN "${name}" /TR "${tr}" /SC DAILY /ST ${t} /F`);
            if (!out.toLowerCase().includes('success') && !out.includes('สำเร็จ'))
              errors.push(`${name}: ${out.substring(0, 100)}`);
          } catch (e) {
            errors.push(`${name}: ${e.message.substring(0, 100)}`);
          }
        }
        if (errors.length === times.length) throw new Error(errors[0]);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, created: times.length - errors.length, warnings: errors }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message.substring(0, 300) }));
      }
    });
    return;
  }

  // ── Dashboard API: น้ำข้าว /api/log ────────────────────────────────────────
  if (url === '/dashboard/namkhao/api/log' && method === 'GET') {
    const logFile = path.join(ROOT, 'agents', 'namkhao', 'namkhao.log');
    if (!fs.existsSync(logFile)) { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('ยังไม่มี log'); }
    const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).slice(-60);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(lines.join('\n'));
  }

  // ── API: GET status ─────────────────────────────────────────────────────────
  if (url === '/api/status' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(readStatus()));
    return;
  }

  // ── API: GET logs ───────────────────────────────────────────────────────────
  const logsMatch = url.match(/^\/api\/agent\/(\w+)\/logs$/);
  if (logsMatch && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ lines: readLog(logsMatch[1], 100) }));
    return;
  }

  // ── API: POST start ─────────────────────────────────────────────────────────
  const startMatch = url.match(/^\/api\/agent\/(\w+)\/start$/);
  if (startMatch && method === 'POST') {
    const name = startMatch[1];
    if (!AGENTS[name]) { res.writeHead(404); res.end(JSON.stringify({ ok:false, error:'not found' })); return; }
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const { action = 'status' } = JSON.parse(body || '{}');
      const pid = startAgent(name, action);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pid }));
    });
    return;
  }

  // ── API: POST /api/telegram/restart ────────────────────────────────────────
  if (url === '/api/telegram/restart' && method === 'POST') {
    const botScript = path.join(ROOT, 'agents', 'namkhao', 'telegram-bot.js');
    const pidFile   = path.join(ROOT, 'agents', 'namkhao', 'telegram-bot.pid');

    // Kill process เดิม
    if (fs.existsSync(pidFile)) {
      try {
        const oldPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
        if (!isNaN(oldPid)) process.kill(oldPid);
      } catch {}
      try { fs.unlinkSync(pidFile); } catch {}
    }

    // รอให้ process เดิมปิดสนิท
    await new Promise(r => setTimeout(r, 1000));

    // เริ่ม bot ใหม่
    if (!fs.existsSync(botScript)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'ไม่พบ telegram-bot.js' }));
    }

    const bot = spawn(process.execPath, [botScript], {
      cwd: ROOT, detached: true, stdio: 'ignore',
    });
    bot.unref();
    console.log(`🤖 Telegram Bot restart สำเร็จ (PID: ${bot.pid})`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, pid: bot.pid }));
  }

  // ── API: POST stop ──────────────────────────────────────────────────────────
  const stopMatch = url.match(/^\/api\/agent\/(\w+)\/stop$/);
  if (stopMatch && method === 'POST') {
    stopAgent(stopMatch[1]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── API: POST clear-log ─────────────────────────────────────────────────────
  const clearMatch = url.match(/^\/api\/agent\/(\w+)\/clear-log$/);
  if (clearMatch && method === 'POST') {
    const logFile = path.join(ROOT, 'agents', clearMatch[1], `${clearMatch[1]}.log`);
    try { fs.writeFileSync(logFile, '', 'utf8'); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── Page: Agent detail ──────────────────────────────────────────────────────
  const agentMatch = url.match(/^\/agent\/(\w+)$/);
  if (agentMatch) {
    const name = agentMatch[1];
    if (!AGENTS[name]) { res.writeHead(404); res.end('ไม่พบ Agent'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildAgentPage(name, readStatus()));
    return;
  }

  // ── Dashboard: อนิเมะ (Anime Character Generator) ───────────────────────────
  if (url === '/dashboard/anime') {
    const htmlFile = path.join(ROOT, 'agents', 'anime', 'dashboard.html');
    if (!fs.existsSync(htmlFile)) { res.writeHead(404); return res.end('ไม่พบ dashboard.html ของ anime'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(htmlFile, 'utf8'));
  }

  // serve รูปในแกลเลอรี: /dashboard/anime/image/{id}/{file}
  const animeImg = url.match(/^\/dashboard\/anime\/image\/([\w.-]+)\/([\w.-]+)$/);
  if (animeImg) {
    const fp = path.join(ROOT, 'agents', 'anime', 'gallery', animeImg[1], animeImg[2]);
    if (!fs.existsSync(fp)) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { 'Content-Type': ext === '.png' ? 'image/png' : 'image/jpeg', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(fp).pipe(res);
  }

  // list แกลเลอรี
  if (url === '/dashboard/anime/api/list' && method === 'GET') {
    const galDir = path.join(ROOT, 'agents', 'anime', 'gallery');
    let items = [];
    try {
      items = fs.readdirSync(galDir)
        .filter(d => fs.existsSync(path.join(galDir, d, 'meta.json')))
        .map(id => { try { return { id, ...JSON.parse(fs.readFileSync(path.join(galDir, id, 'meta.json'), 'utf8')) }; } catch { return null; } })
        .filter(Boolean)
        .sort((a, b) => (b.created || 0) - (a.created || 0));
    } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(items));
  }

  // ดึง active template (Dashboard ใช้ prefill — template เป็น default)
  if (url === '/dashboard/anime/api/template' && method === 'GET') {
    let tpl = null;
    try { tpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'agents', 'anime', 'active-template.json'), 'utf8').replace(/^﻿/, '')); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify(tpl ? {
      templateId: tpl.templateId, prompt: tpl.prompt, faceWeight: tpl.faceWeight,
      tailFrac: tpl.tailFrac, time: tpl.time,
    } : null));
  }

  // สร้างรูป: รับ multipart (image + prompt + text + faceWeight)
  if (url === '/dashboard/anime/api/generate' && method === 'POST') {
    handleAnimeGenerate(req, res);
    return;
  }

  // บันทึกรูปที่วาด balloon แล้ว (จากเบราว์เซอร์) → final.jpg + อัปเดต meta
  if (url === '/dashboard/anime/api/finalize' && method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 256 * 1024) req.destroy(); });
    req.on('end', async () => {
      const reply = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
      try {
        // วาดลูกโป่งฝั่ง server (balloon-canvas.js) — ชุดเดียวกับ Telegram bot
        const { id, text = '', balloon } = JSON.parse(body || '{}');
        if (!id) return reply(400, { ok: false, error: 'missing id' });
        const dir = path.join(ROOT, 'agents', 'anime', 'gallery', String(id).replace(/[^\d]/g, ''));
        const animePath = path.join(dir, 'anime.png');
        if (!fs.existsSync(animePath)) return reply(404, { ok: false, error: 'ไม่พบรูป id นี้' });

        const tailFrac = (balloon && balloon.tailFrac) || { x: 0.46, y: 0.46 };
        await renderBalloonOnImage(animePath, text, tailFrac, path.join(dir, 'final.jpg'));

        try {
          const metaPath = path.join(dir, 'meta.json');
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8').replace(/^﻿/, ''));
          meta.text = text;
          meta.balloon = { tailFrac };
          fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
        } catch {}

        reply(200, { ok: true });
      } catch (e) { reply(200, { ok: false, error: e.message.substring(0, 200) }); }
    });
    return;
  }

  // โพสต์รูปอนิเมะไป FB/IG: { id, platforms:['fb','ig'], caption }
  if (url === '/dashboard/anime/api/post' && method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 1024 * 1024) req.destroy(); });
    req.on('end', async () => {
      const reply = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
      try {
        const { id, platforms = [], caption = '' } = JSON.parse(body || '{}');
        const cleanId = String(id).replace(/[^\d]/g, '');
        const imgPath = path.join(ROOT, 'agents', 'anime', 'gallery', cleanId, 'final.jpg');
        if (!cleanId || !fs.existsSync(imgPath)) return reply(404, { ok: false, error: 'ไม่พบรูป' });

        const results = {};
        if (platforms.includes('fb')) {
          try { const pid = await postFacebookImage(imgPath, caption); results.fb = { ok: true, id: pid }; console.log(`[Hub] 🎨→FB ${cleanId}: ${pid}`); }
          catch (e) { results.fb = { ok: false, error: e.message }; console.log(`[Hub] ❌ FB: ${e.message}`); }
        }
        if (platforms.includes('ig')) {
          try { const pid = await postInstagramImage(imgPath, caption); results.ig = { ok: true, id: pid }; console.log(`[Hub] 🎨→IG ${cleanId}: ${pid}`); }
          catch (e) { results.ig = { ok: false, error: e.message }; console.log(`[Hub] ❌ IG: ${e.message}`); }
        }

        // อัปเดต meta: posted platforms
        try {
          const mp = path.join(ROOT, 'agents', 'anime', 'gallery', cleanId, 'meta.json');
          const meta = JSON.parse(fs.readFileSync(mp, 'utf8').replace(/^﻿/, ''));
          meta.posted = meta.posted || {};
          for (const p of ['fb', 'ig']) if (results[p] && results[p].ok) meta.posted[p] = Date.now();
          if (caption) meta.caption = caption;
          fs.writeFileSync(mp, JSON.stringify(meta, null, 2), 'utf8');
        } catch {}

        reply(200, { ok: true, results });
      } catch (e) { reply(200, { ok: false, error: e.message.substring(0, 200) }); }
    });
    return;
  }

  // ตั้ง active template สำหรับ Telegram bot: { id, time }
  if (url === '/dashboard/anime/api/schedule' && method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 64 * 1024) req.destroy(); });
    req.on('end', () => {
      const reply = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
      try {
        const { id, time } = JSON.parse(body || '{}');
        const cleanId = String(id).replace(/[^\d]/g, '');
        const dir = path.join(ROOT, 'agents', 'anime', 'gallery', cleanId);
        const metaPath = path.join(dir, 'meta.json');
        const srcPath  = path.join(dir, 'source.jpg');
        if (!cleanId || !fs.existsSync(srcPath) || !fs.existsSync(metaPath))
          return reply(404, { ok: false, error: 'ไม่พบรูป/ต้นแบบ' });
        if (time && !/^\d{1,2}:\d{2}$/.test(time)) return reply(400, { ok: false, error: 'เวลาต้องเป็น HH:MM' });

        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8').replace(/^﻿/, ''));
        const template = {
          templateId: cleanId,
          sourceImage: srcPath,
          prompt: meta.prompt || '1girl, solo, upper body',
          faceWeight: meta.faceWeight || 1.1,
          tailFrac: (meta.balloon && meta.balloon.tailFrac) || { x: 0.46, y: 0.46 },
          time: time || null,
          setAt: Date.now(),
        };
        fs.writeFileSync(path.join(ROOT, 'agents', 'anime', 'active-template.json'),
          JSON.stringify(template, null, 2), 'utf8');
        console.log(`[Hub] 📌 anime active template = ${cleanId}${time ? ' @ ' + time : ''}`);
        reply(200, { ok: true });
      } catch (e) { reply(200, { ok: false, error: e.message.substring(0, 200) }); }
    });
    return;
  }

  // ── Page: Main ──────────────────────────────────────────────────────────────
  if (url === '/' || url === '/hub') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildMainPage(readStatus()));
    return;
  }

  res.writeHead(404); res.end('Not found');
});

// ─── อนิเมะ: multipart parser + generate handler ────────────────────────────────

// parse multipart/form-data แบบง่าย (1 ไฟล์ + text fields) → { fields, file }
function parseMultipart(buffer, contentType) {
  const m = /boundary=(.+)$/.exec(contentType || '');
  if (!m) return null;
  const boundary = '--' + m[1].trim().replace(/^"|"$/g, '');
  const bBuf = Buffer.from(boundary);
  const fields = {};
  let file = null;

  let start = buffer.indexOf(bBuf);
  while (start !== -1) {
    const next = buffer.indexOf(bBuf, start + bBuf.length);
    if (next === -1) break;
    // ส่วนของ part (ข้าม \r\n หลัง boundary)
    let part = buffer.slice(start + bBuf.length + 2, next - 2);  // -2 ตัด \r\n ท้าย
    const headEnd = part.indexOf('\r\n\r\n');
    if (headEnd !== -1) {
      const header = part.slice(0, headEnd).toString('utf8');
      const body   = part.slice(headEnd + 4);
      const nameM  = /name="([^"]*)"/.exec(header);
      const fileM  = /filename="([^"]*)"/.exec(header);
      if (nameM) {
        if (fileM && fileM[1]) {
          file = { field: nameM[1], filename: fileM[1], data: body };
        } else {
          fields[nameM[1]] = body.toString('utf8');
        }
      }
    }
    start = next;
  }
  return { fields, file };
}

function handleAnimeGenerate(req, res) {
  const chunks = [];
  let size = 0;
  req.on('data', d => { chunks.push(d); size += d.length; if (size > 20 * 1024 * 1024) req.destroy(); });
  req.on('end', async () => {
    const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
    try {
      const parsed = parseMultipart(Buffer.concat(chunks), req.headers['content-type']);
      const fields = (parsed && parsed.fields) || {};

      // โหลด active template (ใช้เป็น default — override ได้)
      let tpl = null;
      try { tpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'agents', 'anime', 'active-template.json'), 'utf8').replace(/^﻿/, '')); } catch {}

      const id     = Date.now().toString();
      const dir    = path.join(ROOT, 'agents', 'anime', 'gallery', id);
      fs.mkdirSync(dir, { recursive: true });

      const srcPath   = path.join(dir, 'source.jpg');
      const animePath = path.join(dir, 'anime.png');
      const finalPath = path.join(dir, 'final.jpg');

      // รูปต้นแบบ: ถ้าอัปโหลดมา = override, ถ้าไม่ = ใช้ของ template
      if (parsed && parsed.file) {
        fs.writeFileSync(srcPath, parsed.file.data);
      } else if (tpl && tpl.sourceImage && fs.existsSync(tpl.sourceImage)) {
        fs.copyFileSync(tpl.sourceImage, srcPath);
      } else {
        return reply(400, { ok: false, error: 'ไม่พบรูปต้นแบบ — อัปโหลดรูป หรือ ตั้ง template ก่อน' });
      }

      // prompt / faceWeight: ใช้ค่าที่ส่งมา > template > default
      const prompt = (fields.prompt || (tpl && tpl.prompt) || '1girl, solo, upper body').trim();
      const text   = fields.text || '';
      let faceWeight = parseFloat(fields.faceWeight);
      if (isNaN(faceWeight)) faceWeight = (tpl && tpl.faceWeight) || 1.1;
      faceWeight = Math.max(0.6, Math.min(1.6, faceWeight));
      const loraStrength = Math.max(0.6, Math.min(1.0, faceWeight * 0.75));

      console.log(`[Hub] 🎨 anime generate: ${id} — face=${faceWeight} "${prompt.substring(0, 40)}"`);
      await generateAnime(srcPath, { prompt, outPath: animePath, faceWeight, loraStrength,
        onProgress: msg => console.log(`  [anime ${id}] ${msg}`) });

      // final.jpg เริ่มต้น = สำเนา anime (กรณียังไม่ได้วาด balloon)
      // balloon + ข้อความจะถูกวาดฝั่งเบราว์เซอร์แล้วส่งมาบันทึกผ่าน /api/finalize
      fs.copyFileSync(animePath, finalPath);

      fs.writeFileSync(path.join(dir, 'meta.json'),
        JSON.stringify({ prompt, text, faceWeight, created: Number(id) }, null, 2), 'utf8');

      console.log(`[Hub] ✅ anime generate เสร็จ: ${id}`);
      reply(200, { ok: true, id });
    } catch (e) {
      console.log(`[Hub] ❌ anime generate error: ${e.message}`);
      reply(200, { ok: false, error: e.message.substring(0, 300) });
    }
  });
}

server.listen(PORT, () => {
  console.log('\n🤖 Agent Hub — Single Server');
  console.log(`🌐 http://localhost:${PORT}`);
  console.log('');
  console.log('Agents:');
  Object.entries(AGENTS).forEach(([n, c]) => console.log(`  ${c.emoji} ${c.label} → http://localhost:${PORT}/agent/${n}`));
  console.log('');
  console.log('Dashboards:');
  console.log(`  🌸 Shopee  → http://localhost:${PORT}/dashboard/mali`);
  console.log(`  🍋 AI News → http://localhost:${PORT}/dashboard/manao`);
  console.log('');

  // ── Auto-start น้ำข้าว Telegram Bot ────────────────────────────────────────
  (() => {
    const botScript = path.join(ROOT, 'agents', 'namkhao', 'telegram-bot.js');
    const pidFile   = path.join(ROOT, 'agents', 'namkhao', 'telegram-bot.pid');

    // ตรวจว่า bot กำลังรันอยู่แล้วไหม
    let alreadyRunning = false;
    if (fs.existsSync(pidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
        process.kill(pid, 0); // ถ้าไม่ throw = ยังรันอยู่
        alreadyRunning = true;
        console.log(`🍚 น้ำข้าว Telegram Bot กำลังรันอยู่แล้ว (PID: ${pid})`);
      } catch {
        fs.unlinkSync(pidFile); // process ตายแล้ว ลบ pid เก่า
      }
    }

    if (!alreadyRunning && fs.existsSync(botScript)) {
      const bot = spawn(process.execPath, [botScript], {
        cwd: ROOT, detached: true, stdio: 'ignore'
      });
      bot.unref();
      console.log(`🍚 น้ำข้าว Telegram Bot เริ่มแล้ว (PID: ${bot.pid})`);
    }
  })();

  // ── Auto-start อนิเมะ Telegram Bot (ถ้าตั้ง token แล้ว) ─────────────────────
  (() => {
    if (!process.env.ANIME_TELEGRAM_BOT_TOKEN || !process.env.ANIME_TELEGRAM_CHAT_ID) {
      console.log('🎨 anime-bot: ข้าม (ยังไม่ตั้ง ANIME_TELEGRAM_BOT_TOKEN/CHAT_ID ใน .env)');
      return;
    }
    const botScript = path.join(ROOT, 'agents', 'anime', 'anime-bot.js');
    const lock      = path.join(ROOT, 'agents', 'anime', '.anime-bot.lock');
    let running = false;
    if (fs.existsSync(lock)) {
      try { process.kill(parseInt(fs.readFileSync(lock, 'utf8').trim()), 0); running = true; console.log('🎨 anime-bot กำลังรันอยู่แล้ว'); }
      catch { try { fs.unlinkSync(lock); } catch {} }
    }
    if (!running && fs.existsSync(botScript)) {
      const bot = spawn(process.execPath, [botScript], { cwd: ROOT, detached: true, stdio: 'ignore' });
      bot.unref();
      console.log(`🎨 anime-bot เริ่มแล้ว (PID: ${bot.pid})`);
    }
  })();

  // ── Auto-start AI-News (manao) Telegram Bot — handle approve callback ──────
  // เช็ค MANAO_TELEGRAM_BOT_TOKEN จาก pipeline/.env (bot โหลด .env นั้นเองตอนรัน)
  (() => {
    const envFile = path.join(AI_NEWS_DIR, '.env');
    let hasToken = false;
    try { hasToken = /^\s*MANAO_TELEGRAM_BOT_TOKEN\s*=\s*\S+/m.test(fs.readFileSync(envFile, 'utf8')); } catch {}
    if (!hasToken) {
      console.log('🍋 manao-bot: ข้าม (ยังไม่ตั้ง MANAO_TELEGRAM_BOT_TOKEN ใน agents/manao/pipeline/.env)');
      return;
    }
    const botScript = path.join(AI_NEWS_DIR, 'telegram-bot.js');
    const pidFile   = path.join(AI_NEWS_DIR, 'telegram-bot.pid');
    let running = false;
    if (fs.existsSync(pidFile)) {
      try { process.kill(parseInt(fs.readFileSync(pidFile, 'utf8').trim()), 0); running = true; console.log('🍋 manao-bot กำลังรันอยู่แล้ว'); }
      catch { try { fs.unlinkSync(pidFile); } catch {} }
    }
    if (!running && fs.existsSync(botScript)) {
      // cwd = AI_NEWS_DIR → bot โหลด pipeline/.env (ได้ MANAO token)
      const bot = spawn(process.execPath, [botScript], { cwd: AI_NEWS_DIR, detached: true, stdio: 'ignore' });
      bot.unref();
      console.log(`🍋 manao-bot (AI-News) เริ่มแล้ว (PID: ${bot.pid})`);
    }
  })();
});
