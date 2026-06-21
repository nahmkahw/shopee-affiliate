'use strict';
/**
 * agent-hub/html/manao.js
 * Exports: serveNewsHTML
 * HTML ถูกสร้างจาก agent-hub/html/manao/index.js (10 ไฟล์ย่อย แต่ละ < 300 บรรทัด)
 */

const { buildManaoHTML } = require('./manao/index');

// API paths ใน source เขียนเป็น /api/... แต่ผ่าน agent-hub ต้องเป็น /dashboard/manao/api/...
function rewritePaths(html) {
  return html
    .replace(/['"]\/api\/data\?/g,              "'/dashboard/manao/api/data?")
    .replace(/['"]\/api\/data['"]/g,             "'/dashboard/manao/api/data'")
    .replace(/['"]\/api\/facebook-content['"]/g, "'/dashboard/manao/api/facebook-content'")
    .replace(/['"]\/api\/ig-content['"]/g,       "'/dashboard/manao/api/ig-content'")
    .replace(/['"]\/api\/log-live\?/g,           "'/dashboard/manao/api/log-live?")
    .replace(/['"]\/api\/log-live['"]/g,         "'/dashboard/manao/api/log-live'")
    .replace(/['"]\/api\/log\?/g,                "'/dashboard/manao/api/log?")
    .replace(/['"]\/api\/log['"]/g,              "'/dashboard/manao/api/log'")
    .replace(/['"]\/api\/post['"]/g,             "'/dashboard/manao/api/post'")
    .replace(/['"]\/api\/request-approval['"]/g, "'/dashboard/manao/api/request-approval'")
    .replace(/['"]\/api\/generate-image['"]/g,   "'/dashboard/manao/api/generate-image'")
    .replace(/['"]\/api\/generate-force['"]/g,   "'/dashboard/manao/api/generate-force'")
    .replace(/['"]\/news-image\//g,              "'/dashboard/manao/news-image/")
    .replace(/['"]\/api\/run-agent['"]/g,        "'/dashboard/manao/api/run-agent'")
    .replace('`/api/agent-log?',                 '`/dashboard/manao/api/agent-log?')
    .replace('`/api/content?',                   '`/dashboard/manao/api/content?')
    .replace(/['"]\/api\/pipeline-status['"]/g,  "'/dashboard/manao/api/pipeline-status'")
    .replace(/['"]\/api\/config['"]/g,           "'/dashboard/manao/api/config'");
}

function serveNewsHTML(res) {
  const html = rewritePaths(buildManaoHTML());
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

module.exports = { serveNewsHTML };
