'use strict';

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SCRIPT_MAP = {
  scrape:    'scrape.js',
  filter:    path.join('agents', 'filter-agent.js'),
  editor:    path.join('agents', 'editor-agent.js'),
  formatter: path.join('agents', 'formatter-agent.js'),
};

function handleRunAgent(req, res, rawUrl, AI_NEWS_DIR, pipelineProcs, runPipelineSequential) {
  let body = '';
  res._claimed = true;
  req.on('data', d => body += d);
  req.on('end', () => {
    const json = (() => { try { return JSON.parse(body); } catch { return {}; } })();
    const { agent, args = [] } = json;
    if (!agent) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Missing agent' }));
    }
    if (pipelineProcs.hasOwnProperty(agent) && pipelineProcs[agent] !== null) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: `${agent} กำลังทำงานอยู่แล้ว` }));
    }
    if (agent === 'pipeline') {
      runPipelineSequential(args);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, pid: 'pipeline' }));
    }
    const script = SCRIPT_MAP[agent];
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
}

function handlePipelineStatus(req, res, pipelineStatus) {
  const st = pipelineStatus || { running: false, steps: [], log: '', startedAt: null, finishedAt: null };
  const logLines = (st.log || '').split('\n').filter(Boolean).slice(-80).join('\n');
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify({ ...st, log: logLines }));
}

function handleAgentLog(req, res, rawUrl, AI_NEWS_DIR, pipelineProcs) {
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
  res.end(JSON.stringify({ log: lines.join('\n'), running }));
}

module.exports = { handleRunAgent, handlePipelineStatus, handleAgentLog };
