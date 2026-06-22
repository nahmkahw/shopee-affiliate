'use strict';
/**
 * agent-hub/index.js  — HTTP server bootstrap & top-level request dispatch
 * Entry point: node agent-hub/index.js
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { spawn } = require('child_process');

require('events').defaultMaxListeners = 50;

const auth   = require('../auth');
const { generateAnime } = require('../agents/anime/anime-gen');
const { renderBalloonOnImage } = require('../agents/anime/balloon-canvas');
const { postFacebookImage, postInstagramImage } = require('../agents/anime/post-anime');

const PORT                = 3002;
const ROOT                = path.join(__dirname, '..');
const AI_NEWS_DIR         = path.join(ROOT, 'agents', 'manao', 'pipeline');
const COMFYUI_HOST        = '10.3.17.118';
const COMFYUI_PORT        = 8188;
const STATUS_FILE         = path.join(ROOT, 'agent-status.json');
const SHOPEE_SCHEDULE_FILE  = path.join(ROOT, 'agents', 'namkhao', 'shopee-schedule.json');
const AI_NEWS_SCHEDULE_FILE = path.join(ROOT, 'agents', 'manao', 'pipeline', 'ai-news-schedule.json');
const MAKRUT_DIR            = path.join(ROOT, 'agents', 'makrut', 'pipeline');
const SPORT_SCHEDULE_FILE   = path.join(MAKRUT_DIR, 'sport-schedule.json');

// ─── Domain modules ───────────────────────────────────────────────────────────

const agentsMod = require('./agents');
const comfyMod  = require('./comfy');

const { AGENTS, pipelineProcs, makrutPipelineProcs, spawnStep, runPipelineSequential: _runPipeline,
        startAgent: _startAgent, stopAgent: _stopAgent,
        readStatus: _readStatus, writeStatus: _writeStatus, readLog: _readLog } = agentsMod;

const { NEG_PROMPT, OUTFIT_PROMPTS, GENDER_BASE, STYLE_BASE,
        comfyGetBinary: _comfyGetBinary,
        submitComfyJob: _submitComfyJob, getComfyJobResult: _getComfyJobResult } = comfyMod;

// Bind dep args for convenience
const readStatus     = () => _readStatus(STATUS_FILE);
const writeStatus    = (s) => _writeStatus(STATUS_FILE, s);
const readLog        = (name, n) => _readLog(ROOT, name, n);
const startAgent     = (name, action) => _startAgent(ROOT, STATUS_FILE, name, action);
const stopAgent      = (name) => _stopAgent(ROOT, STATUS_FILE, name);
const comfyGetBinary = (p) => _comfyGetBinary(COMFYUI_HOST, COMFYUI_PORT, p);
const submitComfyJob = (prompt) => _submitComfyJob(COMFYUI_HOST, COMFYUI_PORT, prompt);
const getComfyJobResult = (id) => _getComfyJobResult(COMFYUI_HOST, COMFYUI_PORT, id);
// State objects isolate pipeline procs + status per pipeline
const manaoState  = {
  get procs()  { return pipelineProcs; },
  get status() { return agentsMod.pipelineStatus; },
  set status(v){ agentsMod.pipelineStatus = v; },
};
const makrutState = {
  get procs()  { return makrutPipelineProcs; },
  get status() { return agentsMod.makrutPipelineStatus; },
  set status(v){ agentsMod.makrutPipelineStatus = v; },
  fallbackDir:   AI_NEWS_DIR,   // scripts ที่ makrut ไม่มี (filter/formatter/post) ให้หาใน manao
  pipelineRoot:  MAKRUT_DIR,   // env PIPELINE_ROOT สำหรับ shared manao scripts
};

const runPipelineSequential       = (args) => _runPipeline(args, AI_NEWS_DIR, manaoState);
const runMakrutPipelineSequential = (args) => _runPipeline(args, MAKRUT_DIR,  makrutState);

// ─── Route modules ────────────────────────────────────────────────────────────

const maliRoute    = require('./routes/mali');
const manaoRoute   = require('./routes/manao');
const makrutRoute  = require('./routes/makrut');
const namkhaoRoute = require('./routes/namkhao');
const animeRoute     = require('./routes/anime');
const mammuangRoute  = require('./routes/mammuang');
const commonRoute  = require('./routes/common');

// ─── Shared deps object passed to all route handlers ─────────────────────────

// ─── Shopee Scheduler ─────────────────────────────────────────────────────────

let shopeeBotTimeout = null;

function scheduleShopeeBot() {
  if (shopeeBotTimeout) { clearTimeout(shopeeBotTimeout); shopeeBotTimeout = null; }
  let cfg = { time: '11:05', enabled: true };
  try { cfg = JSON.parse(fs.readFileSync(SHOPEE_SCHEDULE_FILE, 'utf8')); } catch {}
  if (!cfg.enabled) { console.log('[Shopee Scheduler] 🌸 disabled — ข้าม'); return; }

  const [tHH, tMM] = (cfg.time || '11:05').split(':').map(Number);
  const now  = new Date();
  const bkk  = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const curHH = bkk.getHours(), curMM = bkk.getMinutes(), curSS = bkk.getSeconds();
  let msUntil = ((tHH - curHH) * 3600 + (tMM - curMM) * 60 - curSS) * 1000;
  if (msUntil <= 0) msUntil += 24 * 3600 * 1000;

  const nextTime = new Date(now.getTime() + msUntil);
  console.log(`[Shopee Scheduler] 🌸 approval-bot ถัดไป: ${nextTime.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`);

  shopeeBotTimeout = setTimeout(() => {
    runShopeeApprovalBot();
    scheduleShopeeBot();
  }, msUntil);
}

function runShopeeApprovalBot() {
  const botScript = path.join(ROOT, 'approval-bot.js');
  const lockFile  = path.join(ROOT, '.approval-bot.lock');
  if (fs.existsSync(lockFile)) {
    try { process.kill(parseInt(fs.readFileSync(lockFile, 'utf8').trim()), 0); console.log('[Shopee Scheduler] approval-bot already running'); return; }
    catch { try { fs.unlinkSync(lockFile); } catch {} }
  }
  if (!fs.existsSync(botScript)) { console.log('[Shopee Scheduler] ⚠️ ไม่พบ approval-bot.js'); return; }
  const bot = spawn(process.execPath, [botScript], { cwd: ROOT, detached: true, stdio: 'ignore' });
  bot.unref();
  console.log(`[Shopee Scheduler] 🌸 approval-bot started PID: ${bot.pid}`);
}

// ─── Sport (Makrut) Pipeline Scheduler ───────────────────────────────────────

let sportTimeout = null;

function scheduleNextSportPipeline() {
  if (sportTimeout) { clearTimeout(sportTimeout); sportTimeout = null; }
  let cfg = { times: ['06:00', '18:00'], enabled: true };
  try { Object.assign(cfg, JSON.parse(fs.readFileSync(SPORT_SCHEDULE_FILE, 'utf8'))); } catch {}
  if (!cfg.enabled) { console.log('[Sport Scheduler] 🍈 makrut disabled — ข้าม'); return; }

  const slots = (cfg.times || ['06:00', '18:00'])
    .map(t => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); })
    .filter(v => !isNaN(v)).sort((a, b) => a - b);
  if (!slots.length) return;

  const now    = new Date();
  const bkk    = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const nowMin = bkk.getHours() * 60 + bkk.getMinutes();
  const nowSec = bkk.getSeconds();
  const nextMin = slots.find(m => m > nowMin) ?? (slots[0] + 24 * 60);
  const msUntil = ((nextMin - nowMin) * 60 - nowSec) * 1000;

  const nextTime = new Date(now.getTime() + msUntil);
  console.log(`[Sport Scheduler] 🍈 makrut ถัดไป: ${nextTime.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`);

  sportTimeout = setTimeout(() => {
    runSportPipeline();
    scheduleNextSportPipeline();
  }, msUntil);
}

function runSportPipeline() {
  const pipelineScript = path.join(MAKRUT_DIR, 'run-pipeline.ps1');
  if (!fs.existsSync(pipelineScript)) { console.log('[Sport Scheduler] ⚠️  ไม่พบ run-pipeline.ps1 — ข้าม'); return; }
  console.log(`[Sport Scheduler] 🚀 เริ่ม makrut pipeline ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`);
  const proc = spawn('powershell.exe', [
    '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', pipelineScript,
  ], { cwd: MAKRUT_DIR, detached: true, stdio: 'ignore' });
  proc.unref();
  console.log(`[Sport Scheduler] 🍈 makrut PID: ${proc.pid}`);
}

// ─── AI News (Manao) Pipeline Scheduler ──────────────────────────────────────

let aiNewsTimeout = null;

function scheduleNextPipeline() {
  if (aiNewsTimeout) { clearTimeout(aiNewsTimeout); aiNewsTimeout = null; }
  let cfg = { times: ['00:00', '06:00', '12:00', '18:00'], enabled: true };
  try { cfg = JSON.parse(fs.readFileSync(AI_NEWS_SCHEDULE_FILE, 'utf8')); } catch {}
  if (!cfg.enabled) { console.log('[AI News Scheduler] 🍋 disabled — ข้าม'); return; }

  const slots = (cfg.times || ['00:00', '06:00', '12:00', '18:00'])
    .map(t => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); })
    .filter(v => !isNaN(v)).sort((a, b) => a - b);
  if (!slots.length) return;

  const now    = new Date();
  const bkk    = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const nowMin = bkk.getHours() * 60 + bkk.getMinutes();
  const nowSec = bkk.getSeconds();
  const nextMin = slots.find(m => m > nowMin) ?? (slots[0] + 24 * 60);
  const msUntil = ((nextMin - nowMin) * 60 - nowSec) * 1000;

  const nextTime = new Date(now.getTime() + msUntil);
  console.log(`[Scheduler] 🍋 pipeline ถัดไป: ${nextTime.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`);

  aiNewsTimeout = setTimeout(() => {
    runManaopiPeline();
    scheduleNextPipeline();
  }, msUntil);
}

function runManaopiPeline() {
  const pipelineScript = path.join(AI_NEWS_DIR, 'run-pipeline.ps1');
  if (!fs.existsSync(pipelineScript)) { console.log('[Scheduler] ⚠️  ไม่พบ run-pipeline.ps1 — ข้าม'); return; }
  console.log(`[Scheduler] 🚀 เริ่ม manao pipeline ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`);
  const proc = spawn('powershell.exe', [
    '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', pipelineScript,
  ], { cwd: AI_NEWS_DIR, detached: true, stdio: 'ignore' });
  proc.unref();
  console.log(`[Scheduler] 🍋 pipeline PID: ${proc.pid}`);
}

// ─────────────────────────────────────────────────────────────────────────────

const deps = {
  ROOT, STATUS_FILE, AI_NEWS_DIR, COMFYUI_HOST, COMFYUI_PORT,
  AGENTS, auth,
  readStatus, writeStatus, readLog, startAgent, stopAgent,
  comfyGetBinary, submitComfyJob, getComfyJobResult,
  STYLE_BASE, GENDER_BASE, OUTFIT_PROMPTS,
  generateAnime, renderBalloonOnImage, postFacebookImage, postInstagramImage,
  get pipelineProcs() { return agentsMod.pipelineProcs; },
  get pipelineStatus() { return agentsMod.pipelineStatus; },
  set pipelineStatus(v) { agentsMod.pipelineStatus = v; },
  runPipelineSequential,
  get makrutPipelineProcs() { return agentsMod.makrutPipelineProcs; },
  get makrutPipelineStatus() { return agentsMod.makrutPipelineStatus; },
  set makrutPipelineStatus(v) { agentsMod.makrutPipelineStatus = v; },
  runMakrutPipelineSequential,
  runSportPipeline,
  SHOPEE_SCHEDULE_FILE,
  rescheduleShopeeBot: () => scheduleShopeeBot(),
  AI_NEWS_SCHEDULE_FILE,
  rescheduleAiNewsPipeline: () => scheduleNextPipeline(),
  SPORT_SCHEDULE_FILE,
  rescheduleSportPipeline: () => scheduleNextSportPipeline(),
  MAKRUT_DIR,
};

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const rawUrl = req.url;
  const url    = rawUrl.split('?')[0];
  const method = req.method;

  if (auth.gate(req, res)) return;

  const done = () => res.writableEnded || res.headersSent || res._claimed;

  await maliRoute.register(req, res, url, rawUrl, method, deps);
  if (done()) return;
  await manaoRoute.register(req, res, url, rawUrl, method, deps);
  if (done()) return;
  await makrutRoute.register(req, res, url, rawUrl, method, deps);
  if (done()) return;
  await namkhaoRoute.register(req, res, url, rawUrl, method, deps);
  if (done()) return;
  await animeRoute.register(req, res, url, rawUrl, method, deps);
  if (done()) return;
  await mammuangRoute.register(req, res, url, rawUrl, method, deps);
  if (done()) return;
  await commonRoute.register(req, res, url, rawUrl, method, deps);
  if (done()) return;

  res.writeHead(404); res.end('Not found');
});

if (require.main === module) server.listen(PORT, () => {
  console.log('\n🤖 Agent Hub — Single Server');
  console.log('http://localhost:' + PORT);
  console.log('');
  Object.entries(AGENTS).forEach(([n,c]) => console.log('  ' + c.emoji + ' ' + c.label + ' -> http://localhost:' + PORT + '/agent/' + n));

  // Auto-start namkhao bot
  (() => {
    const botScript = path.join(ROOT, 'agents', 'namkhao', 'telegram-bot.js');
    const pidFile   = path.join(ROOT, 'agents', 'namkhao', 'telegram-bot.pid');
    let running = false;
    if (fs.existsSync(pidFile)) {
      try { process.kill(parseInt(fs.readFileSync(pidFile,'utf8').trim()), 0); running = true; console.log('namkhao bot already running'); }
      catch { try { fs.unlinkSync(pidFile); } catch {} }
    }
    if (!running && fs.existsSync(botScript)) {
      const bot = spawn(process.execPath, [botScript], { cwd: ROOT, detached: true, stdio: 'ignore' });
      bot.unref();
      console.log('namkhao bot started PID:' + bot.pid);
    }
  })();

  // Auto-start anime bot
  (() => {
    if (!process.env.ANIME_TELEGRAM_BOT_TOKEN || !process.env.ANIME_TELEGRAM_CHAT_ID) return;
    const botScript = path.join(ROOT, 'agents', 'anime', 'anime-bot.js');
    const lock      = path.join(ROOT, 'agents', 'anime', '.anime-bot.lock');
    let running = false;
    if (fs.existsSync(lock)) {
      try { process.kill(parseInt(fs.readFileSync(lock,'utf8').trim()), 0); running = true; }
      catch { try { fs.unlinkSync(lock); } catch {} }
    }
    if (!running && fs.existsSync(botScript)) {
      const bot = spawn(process.execPath, [botScript], { cwd: ROOT, detached: true, stdio: 'ignore' });
      bot.unref();
      console.log('anime-bot started PID:' + bot.pid);
    }
  })();

  // Auto-start manao bot
  (() => {
    const envFile = path.join(AI_NEWS_DIR, '.env');
    let hasToken = false;
    try { hasToken = /^\s*MANAO_TELEGRAM_BOT_TOKEN\s*=\s*\S+/m.test(fs.readFileSync(envFile,'utf8')); } catch {}
    if (!hasToken) return;
    const botScript = path.join(AI_NEWS_DIR, 'telegram-bot.js');
    const pidFile   = path.join(AI_NEWS_DIR, 'telegram-bot.pid');
    let running = false;
    if (fs.existsSync(pidFile)) {
      try { process.kill(parseInt(fs.readFileSync(pidFile,'utf8').trim()), 0); running = true; }
      catch { try { fs.unlinkSync(pidFile); } catch {} }
    }
    if (!running && fs.existsSync(botScript)) {
      const bot = spawn(process.execPath, [botScript], { cwd: AI_NEWS_DIR, detached: true, stdio: 'ignore' });
      bot.unref();
      console.log('manao-bot started PID:' + bot.pid);
    }
  })();

  // ── Shopee Approval Bot Scheduler ───────────────────────────────────────────
  scheduleShopeeBot();

  // ── Manao Pipeline Scheduler ─────────────────────────────────────────────────
  scheduleNextPipeline();

  // ── Makrut Sport Pipeline Scheduler ──────────────────────────────────────────
  scheduleNextSportPipeline();

});

module.exports = { server, PORT, ROOT, AGENTS, deps };