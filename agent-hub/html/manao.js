'use strict';
/**
 * agent-hub/html/manao.js
 * Exports: serveNewsHTML
 */

const fs   = require('fs');
const path = require('path');

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

module.exports = { serveNewsHTML };
