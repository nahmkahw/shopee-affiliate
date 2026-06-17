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

const PORT         = 3002;
const ROOT         = path.join(__dirname, '..');
const AI_NEWS_DIR  = path.join(ROOT, 'agents', 'manao', 'pipeline');
const COMFYUI_HOST = '10.3.17.118';
const COMFYUI_PORT = 8188;
const STATUS_FILE  = path.join(ROOT, 'agent-status.json');

// ─── Domain modules ───────────────────────────────────────────────────────────

const agentsMod = require('./agents');
const comfyMod  = require('./comfy');

const { AGENTS, pipelineProcs, spawnStep, runPipelineSequential: _runPipeline,
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
const runPipelineSequential = (args) => _runPipeline(args, AI_NEWS_DIR);

// ─── Route modules ────────────────────────────────────────────────────────────

const maliRoute    = require('./routes/mali');
const manaoRoute   = require('./routes/manao');
const namkhaoRoute = require('./routes/namkhao');
const animeRoute   = require('./routes/anime');
const commonRoute  = require('./routes/common');

// ─── Shared deps object passed to all route handlers ─────────────────────────

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
};

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const rawUrl = req.url;
  const url    = rawUrl.split('?')[0];
  const method = req.method;

  if (auth.gate(req, res)) return;

  await maliRoute.register(req, res, url, rawUrl, method, deps);
  if (res.writableEnded) return;
  await manaoRoute.register(req, res, url, rawUrl, method, deps);
  if (res.writableEnded) return;
  await namkhaoRoute.register(req, res, url, rawUrl, method, deps);
  if (res.writableEnded) return;
  await animeRoute.register(req, res, url, rawUrl, method, deps);
  if (res.writableEnded) return;
  await commonRoute.register(req, res, url, rawUrl, method, deps);
  if (res.writableEnded) return;

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
    try { hasToken = /^s*MANAO_TELEGRAM_BOT_TOKENs*=s*S+/m.test(fs.readFileSync(envFile,'utf8')); } catch {}
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
});

module.exports = { server, PORT, ROOT, AGENTS, deps };