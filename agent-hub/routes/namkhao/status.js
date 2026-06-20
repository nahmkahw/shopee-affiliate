'use strict';

const fs   = require('fs');
const path = require('path');

// Reuters ใช้ in-process scheduler — อ่าน config จาก reuters-schedule.json
function getReutersInfo(AI_NEWS_DIR) {
  let cfg = { times: ['00:00', '06:00', '12:00', '18:00'], enabled: true };
  try { cfg = JSON.parse(fs.readFileSync(path.join(AI_NEWS_DIR, 'reuters-schedule.json'), 'utf8')); } catch {}

  const slots = (cfg.times || ['00:00']).map(t => {
    const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0);
  }).filter(v => !isNaN(v)).sort((a, b) => a - b);

  let nextRun = 'N/A';
  if (cfg.enabled && slots.length) {
    const now    = new Date();
    const bkk    = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    const nowMin = bkk.getHours() * 60 + bkk.getMinutes();
    const nowSec = bkk.getSeconds();
    const nextMin = slots.find(m => m > nowMin) ?? (slots[0] + 24 * 60);
    const msUntil = ((nextMin - nowMin) * 60 - nowSec) * 1000;
    const nt  = new Date(now.getTime() + msUntil);
    const nb  = new Date(nt.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    const pad = n => String(n).padStart(2, '0');
    nextRun = `${nb.getFullYear()}-${pad(nb.getMonth()+1)}-${pad(nb.getDate())} ${pad(nb.getHours())}:${pad(nb.getMinutes())}:00`;
  }

  let lastRun = 'N/A';
  try {
    const log   = fs.readFileSync(path.join(AI_NEWS_DIR, 'pipeline.log'), 'utf8');
    const lines = log.split('\n').filter(l => l.includes('=== เริ่ม Pipeline ==='));
    if (lines.length) lastRun = lines[lines.length - 1].replace(/[\r﻿]/g, '').substring(0, 19);
  } catch {}

  return {
    state:      cfg.enabled ? 'Scheduled' : 'Disabled',
    lastRun,
    lastResult: null,
    nextRun,
    times:      cfg.times || [],
    enabled:    cfg.enabled,
  };
}

// Shopee ใช้ in-process scheduler เช่นกัน — อ่าน config จาก shopee-schedule.json
function getShopeeInfo(ROOT) {
  let cfg = { time: '11:05', enabled: true };
  try { cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'agents', 'namkhao', 'shopee-schedule.json'), 'utf8')); } catch {}

  const [tHH, tMM] = (cfg.time || '11:05').split(':').map(Number);
  const now    = new Date();
  const bkk    = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const curHH  = bkk.getHours(), curMM = bkk.getMinutes(), curSS = bkk.getSeconds();
  let msUntil  = ((tHH - curHH) * 3600 + (tMM - curMM) * 60 - curSS) * 1000;
  if (msUntil <= 0) msUntil += 24 * 3600 * 1000;
  const nt     = new Date(now.getTime() + msUntil);
  const nb     = new Date(nt.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const pad    = n => String(n).padStart(2, '0');
  const nextRun = `${nb.getFullYear()}-${pad(nb.getMonth()+1)}-${pad(nb.getDate())} ${pad(nb.getHours())}:${pad(nb.getMinutes())}:00`;

  let lastRun = 'N/A';
  try {
    const log   = fs.readFileSync(path.join(ROOT, 'approval-bot.log'), 'utf8');
    const lines = log.split('\n').filter(Boolean);
    if (lines.length) lastRun = lines[lines.length - 1].replace(/[\r﻿]/g, '').substring(0, 19);
  } catch {}

  return {
    state:      cfg.enabled ? 'Scheduled' : 'Disabled',
    lastRun,
    lastResult: null,
    nextRun:    cfg.enabled ? nextRun : 'N/A',
    times:      [cfg.time || '11:05'],
    enabled:    cfg.enabled,
  };
}

function getScheduleStatus(AI_NEWS_DIR, ROOT) {
  return {
    reuters: getReutersInfo(AI_NEWS_DIR),
    shopee:  getShopeeInfo(ROOT),
  };
}

module.exports = { getReutersInfo, getShopeeInfo, getScheduleStatus };
