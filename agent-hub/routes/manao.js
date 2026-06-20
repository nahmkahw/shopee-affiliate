'use strict';

const { serveNewsHTML } = require('../html/manao');
const { readNewsEnv, getNewsItems, getNewsBotStatus, getNewsPipelineInfo, buildNewsApiData } = require('./manao/news-data');
const { tgRequest, tgEscape, sendPhotoToTelegram, sendTelegramApproval: _sendTelegramApproval } = require('./manao/telegram');
const {
  handleConfig, handleLogLive, handleLog, handleFacebookOrIgContent,
  handleNewsImage, handleGenerateImage, handleGenerateForce,
  handlePost, handleContent, handleRequestApproval,
} = require('./manao/news-api');
const { handleRunAgent, handlePipelineStatus, handleAgentLog } = require('./manao/pipeline');

let AI_NEWS_DIR = '';

function sendTelegramApproval(slug, platform) {
  return _sendTelegramApproval(AI_NEWS_DIR, slug, platform, () => readNewsEnv(AI_NEWS_DIR));
}

function register(req, res, url, rawUrl, method, deps) {
  AI_NEWS_DIR = deps.AI_NEWS_DIR;
  const { pipelineProcs, pipelineStatus, runPipelineSequential } = deps;

  if (url === '/dashboard/manao') {
    serveNewsHTML(res, AI_NEWS_DIR);
    return;
  }

  if (url.startsWith('/dashboard/manao/api/data')) {
    const data = JSON.stringify(buildNewsApiData(AI_NEWS_DIR, pipelineProcs), null, 2);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    res.end(data);
    return;
  }

  if (url === '/dashboard/manao/api/config') {
    handleConfig(req, res, method, AI_NEWS_DIR);
    return;
  }

  if (url.startsWith('/dashboard/manao/api/log-live')) {
    handleLogLive(req, res, AI_NEWS_DIR);
    return;
  }

  if (url.startsWith('/dashboard/manao/api/log')) {
    handleLog(req, res, AI_NEWS_DIR);
    return;
  }

  if (url.startsWith('/dashboard/manao/api/facebook-content') || url.startsWith('/dashboard/manao/api/ig-content')) {
    handleFacebookOrIgContent(req, res, url, rawUrl, AI_NEWS_DIR);
    return;
  }

  const newsImgMatch = url.match(/^\/dashboard\/manao\/news-image\/(.+)$/);
  if (newsImgMatch) {
    handleNewsImage(req, res, decodeURIComponent(newsImgMatch[1]), AI_NEWS_DIR);
    return;
  }

  if (url === '/dashboard/manao/api/generate-image' && method === 'POST') {
    handleGenerateImage(req, res, AI_NEWS_DIR);
    return;
  }

  if (url === '/dashboard/manao/api/generate-force' && method === 'POST') {
    handleGenerateForce(req, res, AI_NEWS_DIR);
    return;
  }

  if (url === '/dashboard/manao/api/request-approval' && method === 'POST') {
    handleRequestApproval(req, res, AI_NEWS_DIR, sendTelegramApproval);
    return;
  }

  if (url === '/dashboard/manao/api/post' && method === 'POST') {
    handlePost(req, res, AI_NEWS_DIR);
    return;
  }

  if (url.startsWith('/dashboard/manao/api/content') && method === 'GET') {
    handleContent(req, res, rawUrl, AI_NEWS_DIR);
    return;
  }

  if (url === '/dashboard/manao/api/run-agent' && method === 'POST') {
    handleRunAgent(req, res, rawUrl, AI_NEWS_DIR, pipelineProcs, runPipelineSequential);
    return;
  }

  if (url === '/dashboard/manao/api/pipeline-status' && method === 'GET') {
    handlePipelineStatus(req, res, pipelineStatus);
    return;
  }

  if (url.startsWith('/dashboard/manao/api/agent-log') && method === 'GET') {
    handleAgentLog(req, res, rawUrl, AI_NEWS_DIR, pipelineProcs);
    return;
  }

  return false;
}

module.exports = {
  register,
  readNewsEnv: (dir) => readNewsEnv(dir || AI_NEWS_DIR),
  tgRequest, tgEscape, sendPhotoToTelegram,
  getNewsItems: (dir) => getNewsItems(dir || AI_NEWS_DIR),
  getNewsBotStatus: (dir) => getNewsBotStatus(dir || AI_NEWS_DIR),
  getNewsPipelineInfo: (dir) => getNewsPipelineInfo(dir || AI_NEWS_DIR),
  buildNewsApiData: (procs) => buildNewsApiData(AI_NEWS_DIR, procs),
};
