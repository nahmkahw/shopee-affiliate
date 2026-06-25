'use strict';
/**
 * agent-hub/agents.js
 * Exports: AGENTS, pipelineProcs, pipelineStatus (getter/setter), spawnStep,
 *          runPipelineSequential, startAgent, stopAgent, readStatus, writeStatus, readLog
 */

const fs     = require('fs');
const path   = require('path');
const { spawn } = require('child_process');

const AGENTS = {
  mali: {
    label: 'มะลิ', role: 'Shopee Affiliate', color: '#FF6B35', colorLight: '#FFF3EE', emoji: '🌸',
    hasDashboard: true,
    actions: [
      { id: 'approve-today', label: '▶ Approve วันนี้',   icon: '✅' },
      { id: 'scrape',        label: '🔍 Scrape สินค้า',  icon: '🔍' },
      { id: 'create-content',label: '✍️ Create Content', icon: '✍️' },
      { id: 'status',        label: '📊 ดูสถานะ',        icon: '📊' },
    ],
  },
  manao: {
    label: 'มะนาว', role: 'AI News', color: '#4CAF50', colorLight: '#F1F8E9', emoji: '🍋',
    hasDashboard: true,
    actions: [
      { id: 'full',     label: '▶ Full Pipeline',    icon: '🚀' },
      { id: 'scrape',   label: '📡 ดึงข่าว AI News',  icon: '📡' },
      { id: 'generate', label: '✍️ Generate Content', icon: '✍️' },
      { id: 'post',     label: '📤 Post FB+IG',       icon: '📤' },
      { id: 'status',   label: '📊 ดูสถานะ',          icon: '📊' },
    ],
  },
  namkhao: {
    label: 'น้ำข้าว', role: 'Supervisor', color: '#1565C0', colorLight: '#E3F2FD', emoji: '🌾',
    hasDashboard: true,
    actions: [
      { id: 'status',      label: '👀 ตรวจสอบ Agents',  icon: '👀' },
      { id: 'summary',     label: '📊 สรุปรายวัน',       icon: '📊' },
      { id: 'start-mali',  label: '▶ เริ่ม มะลิ',       icon: '🌸' },
      { id: 'start-manao', label: '▶ เริ่ม มะนาว',      icon: '🍋' },
    ],
  },
  anime: {
    label: 'อนิเมะ', role: 'Anime Image Generator', color: '#E91E8C', colorLight: '#FCE4EC', emoji: '🎌',
    hasDashboard: true,
    actions: [],
  },
  makrut: {
    label: 'มะกรูด', role: 'FIFA World Cup 2026', color: '#22C55E', colorLight: '#F0FDF4', emoji: '⚽',
    hasDashboard: true,
    actions: [
      { id: 'status',   label: 'สถานะ',         icon: '📊' },
      { id: 'scrape',   label: 'ดึงข่าว',       icon: '🌐' },
      { id: 'generate', label: 'สร้าง Content', icon: '✍️' },
      { id: 'post',     label: 'โพสต์ FB',       icon: '📤' },
      { id: 'full',     label: 'Full Pipeline',  icon: '🚀' },
    ],
  },
  mammuang: {
    label: 'มะม่วง', role: 'Character Creator', color: '#f59e0b', colorLight: '#fffbeb', emoji: '🥭',
    hasDashboard: true,
    actions: [],
  },
  maprang: {
    label: 'มะปราง', role: 'Anime Story Video', color: '#a855f7', colorLight: '#faf5ff', emoji: '🎌',
    hasDashboard: true,
    actions: [
      { id: 'check',    label: '🔍 ตรวจ ComfyUI',    icon: '🔍' },
      { id: 'status',   label: '📊 ดูสถานะ',          icon: '📊' },
    ],
  },
};

const pipelineProcs = {
  scrape: null, filter: null, editor: null, formatter: null, pipeline: null,
};
let _pipelineStatus = null;

const makrutPipelineProcs = {
  scrape: null, filter: null, editor: null, formatter: null, pipeline: null,
};
let _makrutPipelineStatus = null;

// state = { procs, get status(), set status() } — isolates manao vs makrut
function spawnStep(scriptPath, stepArgs, cwd, state = {}) {
  return new Promise((resolve, reject) => {
    const env  = state.pipelineRoot ? { ...process.env, PIPELINE_ROOT: state.pipelineRoot } : process.env;
    const proc = spawn(process.execPath, [scriptPath, ...stepArgs], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const t0 = Date.now();
    const logFile = path.join(state.pipelineRoot || cwd, 'pipeline.log');
    const append = chunk => {
      if (state.status) state.status.log += chunk;
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

const STEP_DEFS = [
  { id: 'scrape',    script: 'scrape.js',                              skipFlag: '--no-scrape', runFlag: null,     name: 'Agent 1 Scrape',    icon: '📡', extraArgs: [] },
  { id: 'filter',    script: path.join('agents', 'filter-agent.js'),   skipFlag: '--no-filter', runFlag: null,     name: 'Agent 2 Filter',    icon: '🔍', extraArgs: [] },
  { id: 'editor',    script: path.join('agents', 'editor-agent.js'),   skipFlag: '--no-edit',   runFlag: null,     name: 'Agent 3 Editor',    icon: '✍️', extraArgs: [] },
  { id: 'formatter', script: path.join('agents', 'formatter-agent.js'),skipFlag: '--no-format', runFlag: null,     name: 'Agent 4 Formatter', icon: '📐', extraArgs: [] },
  { id: 'post',      script: 'post.js',                                skipFlag: null,          runFlag: '--post', name: 'Publisher Post',    icon: '🚀', extraArgs: ['--pending', '--platform', 'fb,ig'] },
];

async function runPipelineSequential(args, dir, state = { procs: pipelineProcs, get status() { return _pipelineStatus; }, set status(v) { _pipelineStatus = v; } }) {
  if (state.procs.pipeline !== null) return;
  const steps = STEP_DEFS.map(s => ({
    id: s.id, name: s.name, icon: s.icon,
    status: (s.skipFlag && args.includes(s.skipFlag)) || (s.runFlag && !args.includes(s.runFlag)) ? 'skipped' : 'pending',
    elapsed: null, error: null,
  }));
  state.status = { running: true, startedAt: new Date().toISOString(), steps, log: '', finishedAt: null };
  state.procs.pipeline = -1;
  const logFile = path.join(dir, 'pipeline.log');
  const ts = () => new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  try { fs.appendFileSync(logFile, `\n[${ts()}] === เริ่ม Pipeline (agent-hub sequential) ===\n`, 'utf8'); } catch {}
  for (let i = 0; i < STEP_DEFS.length; i++) {
    const step = steps[i];
    const def  = STEP_DEFS[i];
    if (step.status === 'skipped') continue;
    step.status = 'running';
    state.procs[step.id] = -1;
    const scriptInDir  = path.join(dir, def.script);
    const scriptPath   = fs.existsSync(scriptInDir) ? scriptInDir : path.join(state.fallbackDir || dir, def.script);
    const stepCwd      = path.dirname(scriptPath);
    const stepArgs     = [...def.extraArgs];
    if (def.id === 'post' && args.includes('--schedule')) stepArgs.push('--schedule');
    try {
      step.elapsed = await spawnStep(scriptPath, stepArgs, stepCwd, state);
      step.status  = 'done';
    } catch (e) {
      step.status  = 'error';
      step.elapsed = e.elapsed || '?';
      step.error   = e.message || `exit code ${e.code}`;
      for (let j = i + 1; j < steps.length; j++) {
        if (steps[j].status === 'pending') steps[j].status = 'skipped';
      }
    } finally {
      state.procs[step.id] = null;
    }
    if (step.status === 'error') break;
  }
  state.status.running    = false;
  state.status.finishedAt = new Date().toISOString();
  state.procs.pipeline    = null;
  try { fs.appendFileSync(logFile, `[${ts()}] === Pipeline เสร็จแล้ว ===\n`, 'utf8'); } catch {}
}

function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

function readStatus(STATUS_FILE) {
  let s;
  try { s = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); }
  catch { return { mali: { status: 'idle' }, manao: { status: 'idle' }, namkhao: { status: 'idle' } }; }
  // auto-heal: reset 'running' ถ้า pid ตายแล้ว (ป้องกัน status ค้างหลัง server restart)
  let changed = false;
  for (const [name, st] of Object.entries(s)) {
    if (st && st.status === 'running' && !isPidAlive(st.pid)) {
      s[name] = { ...st, status: 'idle', pid: null };
      changed = true;
    }
  }
  if (changed) try { fs.writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2), 'utf8'); } catch {}
  return s;
}

function writeStatus(STATUS_FILE, s) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2), 'utf8');
}

function readLog(ROOT, agentName, lines) {
  lines = lines || 80;
  const logFile = path.join(ROOT, 'agents', agentName, `${agentName}.log`);
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf8').split('\n').filter(l => l.trim()).slice(-lines);
}

const runningProcs = {};

function startAgent(ROOT, STATUS_FILE, name, action) {
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
  const s = readStatus(STATUS_FILE);
  s[name] = { ...s[name], status: 'running', currentAction: action, pid: child.pid, lastRun: new Date().toISOString() };
  writeStatus(STATUS_FILE, s);
  child.on('close', code => {
    delete runningProcs[name];
    // read raw (no auto-heal) to check pid before it gets reset
    let pidMatch = false;
    try { const raw = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); pidMatch = raw[name] && raw[name].pid === child.pid; } catch {}
    if (pidMatch) {
      const st = readStatus(STATUS_FILE);
      st[name] = { ...st[name], status: code === 0 ? 'idle' : 'error', pid: null };
      writeStatus(STATUS_FILE, st);
    }
  });
  return child.pid;
}

function stopAgent(ROOT, STATUS_FILE, name) {
  const s = readStatus(STATUS_FILE);
  const pid = (s[name] && s[name].pid) || (runningProcs[name] && runningProcs[name].pid);
  if (runningProcs[name] && !runningProcs[name].killed) {
    try { runningProcs[name].kill(); } catch {}
    delete runningProcs[name];
  }
  if (pid) { try { process.kill(Number(pid)); } catch {} }
  s[name] = { ...s[name], status: 'idle', pid: null };
  writeStatus(STATUS_FILE, s);
}

module.exports = {
  AGENTS,
  pipelineProcs,
  get pipelineStatus() { return _pipelineStatus; },
  set pipelineStatus(v) { _pipelineStatus = v; },
  makrutPipelineProcs,
  get makrutPipelineStatus() { return _makrutPipelineStatus; },
  set makrutPipelineStatus(v) { _makrutPipelineStatus = v; },
  spawnStep,
  runPipelineSequential,
  startAgent,
  stopAgent,
  readStatus,
  writeStatus,
  readLog,
};
