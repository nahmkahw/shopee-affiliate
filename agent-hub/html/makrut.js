'use strict';
/**
 * agent-hub/html/makrut.js — serves sport-news (มะกรูด) dashboard
 * HTML built from manao modules, paths rewritten to /dashboard/makrut/
 */

const { buildMakrutHTML } = require('./makrut/index');

function rewritePaths(html) {
  return html
    .replace(/['"]\/api\/data\?/g,              "'/dashboard/makrut/api/data?")
    .replace(/['"]\/api\/data['"]/g,             "'/dashboard/makrut/api/data'")
    .replace(/['"]\/api\/facebook-content['"]/g, "'/dashboard/makrut/api/facebook-content'")
    .replace(/['"]\/api\/ig-content['"]/g,       "'/dashboard/makrut/api/ig-content'")
    .replace(/['"]\/api\/log-live\?/g,           "'/dashboard/makrut/api/log-live?")
    .replace(/['"]\/api\/log-live['"]/g,         "'/dashboard/makrut/api/log-live'")
    .replace(/['"]\/api\/log\?/g,                "'/dashboard/makrut/api/log?")
    .replace(/['"]\/api\/log['"]/g,              "'/dashboard/makrut/api/log'")
    .replace(/['"]\/api\/post['"]/g,             "'/dashboard/makrut/api/post'")
    .replace(/['"]\/api\/request-approval['"]/g, "'/dashboard/makrut/api/request-approval'")
    .replace(/['"]\/api\/generate-image['"]/g,   "'/dashboard/makrut/api/generate-image'")
    .replace(/['"]\/api\/generate-force['"]/g,   "'/dashboard/makrut/api/generate-force'")
    .replace(/['"]\/news-image\//g,              "'/dashboard/makrut/news-image/")
    .replace(/['"]\/api\/run-agent['"]/g,        "'/dashboard/makrut/api/run-agent'")
    .replace('`/api/agent-log?',                 '`/dashboard/makrut/api/agent-log?')
    .replace('`/api/content?',                   '`/dashboard/makrut/api/content?')
    .replace(/['"]\/api\/pipeline-status['"]/g,  "'/dashboard/makrut/api/pipeline-status'")
    .replace(/['"]\/api\/config['"]/g,           "'/dashboard/makrut/api/config'");
}

function serveSportHTML(res) {
  const html = rewritePaths(buildMakrutHTML());
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

module.exports = { serveSportHTML };
