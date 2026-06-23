'use strict';

const path = require('path');
const { runScraper } = require('../../../lib/news-scraper-core');

runScraper({
  rssUrl: 'https://news.google.com/rss/search?q=artificial+intelligence&hl=en-US&gl=US&ceid=US:en',
  label: 'AI News Scraper',
  pipelineDir: __dirname,
});
