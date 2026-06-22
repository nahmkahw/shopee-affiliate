'use strict';
/**
 * agent-hub/routes/makrut.js — Sport-news (มะกรูด) dashboard routes
 * Reuses manao sub-handlers with MAKRUT_DIR and /dashboard/makrut/ prefix
 */

const { serveSportHTML } = require('../html/makrut');
const { readNewsEnv, getNewsItems, getNewsBotStatus, getNewsPipelineInfo, buildNewsApiData } = require('./manao/news-data');
const { tgRequest, tgEscape, sendPhotoToTelegram, sendTelegramApproval: _sendTelegramApproval } = require('./manao/telegram');
const {
  handleConfig, handleLogLive, handleLog, handleFacebookOrIgContent,
  handleNewsImage, handleGenerateImage, handleGenerateForce,
  handlePost, handleContent, handleRequestApproval,
} = require('./manao/news-api');
const { handleRunAgent, handlePipelineStatus, handleAgentLog } = require('./manao/pipeline');

let MAKRUT_DIR = '';

function sendTelegramApproval(slug, platform) {
  return _sendTelegramApproval(MAKRUT_DIR, slug, platform, () => readNewsEnv(MAKRUT_DIR));
}

function register(req, res, url, rawUrl, method, deps) {
  MAKRUT_DIR = deps.MAKRUT_DIR;
  const pipelineProcs       = deps.makrutPipelineProcs;
  const pipelineStatus      = deps.makrutPipelineStatus;
  const runPipelineSequential = deps.runMakrutPipelineSequential;

  if (url === '/dashboard/makrut') {
    serveSportHTML(res);
    return;
  }

  if (url.startsWith('/dashboard/makrut/api/data')) {
    const data = JSON.stringify(buildNewsApiData(MAKRUT_DIR, pipelineProcs), null, 2);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    res.end(data);
    return;
  }

  if (url === '/dashboard/makrut/api/config') {
    handleConfig(req, res, method, MAKRUT_DIR);
    return;
  }

  if (url.startsWith('/dashboard/makrut/api/log-live')) {
    handleLogLive(req, res, MAKRUT_DIR);
    return;
  }

  if (url.startsWith('/dashboard/makrut/api/log')) {
    handleLog(req, res, MAKRUT_DIR);
    return;
  }

  if (url.startsWith('/dashboard/makrut/api/facebook-content') || url.startsWith('/dashboard/makrut/api/ig-content')) {
    handleFacebookOrIgContent(req, res, url, rawUrl, MAKRUT_DIR);
    return;
  }

  const newsImgMatch = url.match(/^\/dashboard\/makrut\/news-image\/(.+)$/);
  if (newsImgMatch) {
    handleNewsImage(req, res, decodeURIComponent(newsImgMatch[1]), MAKRUT_DIR);
    return;
  }

  if (url === '/dashboard/makrut/api/generate-image' && method === 'POST') {
    handleGenerateImage(req, res, MAKRUT_DIR);
    return;
  }

  if (url === '/dashboard/makrut/api/generate-force' && method === 'POST') {
    handleGenerateForce(req, res, MAKRUT_DIR);
    return;
  }

  if (url === '/dashboard/makrut/api/request-approval' && method === 'POST') {
    handleRequestApproval(req, res, MAKRUT_DIR, sendTelegramApproval);
    return;
  }

  if (url === '/dashboard/makrut/api/post' && method === 'POST') {
    handlePost(req, res, MAKRUT_DIR);
    return;
  }

  if (url.startsWith('/dashboard/makrut/api/content') && method === 'GET') {
    handleContent(req, res, rawUrl, MAKRUT_DIR);
    return;
  }

  if (url === '/dashboard/makrut/api/run-agent' && method === 'POST') {
    handleRunAgent(req, res, rawUrl, MAKRUT_DIR, pipelineProcs, runPipelineSequential);
    return;
  }

  if (url === '/dashboard/makrut/api/pipeline-status' && method === 'GET') {
    handlePipelineStatus(req, res, pipelineStatus);
    return;
  }

  if (url.startsWith('/dashboard/makrut/api/agent-log') && method === 'GET') {
    handleAgentLog(req, res, rawUrl, MAKRUT_DIR, pipelineProcs);
    return;
  }

  return false;
}

module.exports = {
  register,
  readNewsEnv:      (dir) => readNewsEnv(dir || MAKRUT_DIR),
  getNewsItems:     (dir) => getNewsItems(dir || MAKRUT_DIR),
  getNewsBotStatus: (dir) => getNewsBotStatus(dir || MAKRUT_DIR),
  getNewsPipelineInfo: (dir) => getNewsPipelineInfo(dir || MAKRUT_DIR),
  buildNewsApiData: (procs) => buildNewsApiData(MAKRUT_DIR, procs),
};
