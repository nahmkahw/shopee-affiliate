'use strict';

const fs   = require('fs');
const path = require('path');

function readNewsEnv(AI_NEWS_DIR) {
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

function getNewsItems(AI_NEWS_DIR) {
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

function getNewsBotStatus(AI_NEWS_DIR) {
  try {
    const pidFile = path.join(AI_NEWS_DIR, 'telegram-bot.pid');
    if (!fs.existsSync(pidFile)) return { running: false, pid: null };
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
    if (isNaN(pid)) return { running: false, pid: null };
    try { process.kill(pid, 0); return { running: true, pid }; } catch { return { running: false, pid }; }
  } catch { return { running: false, pid: null }; }
}

function getNewsPipelineInfo(AI_NEWS_DIR) {
  let last_run = null, last_finish = null, log_lines = 0;
  try {
    const logFile = path.join(AI_NEWS_DIR, 'pipeline.log');
    if (fs.existsSync(logFile)) {
      let content = fs.readFileSync(logFile, 'utf8');
      if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
      const lines = content.split('\n').filter(Boolean);
      const startLines  = lines.filter(l => l.includes('=== เริ่ม Pipeline ==='));
      const finishLines = lines.filter(l => l.includes('=== Pipeline เสร็จแล้ว'));
      last_run    = startLines.length  ? startLines[startLines.length-1].replace(/[\r﻿]/g,'').substring(0,19) : null;
      last_finish = finishLines.length ? finishLines[finishLines.length-1].replace(/[\r﻿]/g,'').substring(0,19) : null;
      log_lines   = lines.length;
    }
  } catch {}

  let next_run_utc = null;
  try {
    const schedFile = path.join(AI_NEWS_DIR, 'ai-news-schedule.json');
    const cfg = JSON.parse(fs.readFileSync(schedFile, 'utf8'));
    if (cfg.enabled !== false && cfg.times && cfg.times.length) {
      const slots = cfg.times
        .map(t => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); })
        .filter(v => !isNaN(v)).sort((a, b) => a - b);
      const now    = new Date();
      const bkk    = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
      const nowMin = bkk.getHours() * 60 + bkk.getMinutes();
      const nowSec = bkk.getSeconds();
      const nextMin = slots.find(m => m > nowMin) ?? (slots[0] + 24 * 60);
      const msUntil = ((nextMin - nowMin) * 60 - nowSec) * 1000;
      next_run_utc = new Date(now.getTime() + msUntil).toISOString();
    }
  } catch {}

  return { last_run, last_finish, log_lines, next_run_utc };
}

function buildNewsApiData(AI_NEWS_DIR, pipelineProcs) {
  const items = getNewsItems(AI_NEWS_DIR);
  const counts = { scraped:0, draft:0, pending_approval:0, scheduled:0, posted:0 };
  for (const item of items) { const s = item.status||'scraped'; if (counts[s]!==undefined) counts[s]++; else counts.scraped++; }

  const agentDefs = [
    { id: 'scrape',    name: 'Scraper (AI News)',  icon: '🌐' },
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
    bot: getNewsBotStatus(AI_NEWS_DIR),
    pipeline: getNewsPipelineInfo(AI_NEWS_DIR),
    news: items,
    hub: {
      pipeline_running: pipelineProcs.pipeline !== null || agentDefs.some(d => pipelineProcs[d.id] !== null),
      agents: agentsStatus,
    },
  };
}

module.exports = { readNewsEnv, getNewsItems, getNewsBotStatus, getNewsPipelineInfo, buildNewsApiData };
