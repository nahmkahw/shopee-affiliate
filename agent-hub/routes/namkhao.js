'use strict';

const fs   = require('fs');
const path = require('path');

const {
  handleScheduleStatus,
  handleScheduleRun,
  handleScheduleToggle,
  handleScheduleEdit,
  handleScheduleCreate,
  handleLog,
} = require('./namkhao/handlers');

const {
  runCmd, parseSchedCSV, getScheduleStatus,
  editScheduleTimes, toggleScheduleTask, runScheduleNow,
} = require('./namkhao/scheduler');

function serveNamkhaoHTML(res, ROOT) {
  const htmlFile = path.join(ROOT, 'agents', 'namkhao', 'dashboard.html');
  if (!fs.existsSync(htmlFile)) {
    res.writeHead(404); return res.end('ไม่พบ dashboard.html ของน้ำข้าว');
  }
  const html = fs.readFileSync(htmlFile, 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function register(req, res, url, rawUrl, method, deps) {
  const { ROOT } = deps;

  if (url === '/dashboard/namkhao') {
    serveNamkhaoHTML(res, ROOT);
    return;
  }

  if (url === '/dashboard/namkhao/api/schedule-status' && method === 'GET') {
    handleScheduleStatus(req, res, deps);
    return;
  }

  if (url === '/dashboard/namkhao/api/schedule-run' && method === 'POST') {
    handleScheduleRun(req, res, deps);
    return;
  }

  if (url === '/dashboard/namkhao/api/schedule-toggle' && method === 'POST') {
    handleScheduleToggle(req, res, deps);
    return;
  }

  if (url === '/dashboard/namkhao/api/schedule-edit' && method === 'POST') {
    handleScheduleEdit(req, res, deps);
    return;
  }

  if (url === '/dashboard/namkhao/api/schedule-create' && method === 'POST') {
    handleScheduleCreate(req, res, deps);
    return;
  }

  if (url === '/dashboard/namkhao/api/log' && method === 'GET') {
    handleLog(req, res, deps);
    return;
  }

  return false;
}

module.exports = {
  register,
  runCmd, parseSchedCSV, getScheduleStatus, editScheduleTimes,
  toggleScheduleTask, runScheduleNow, serveNamkhaoHTML,
};
