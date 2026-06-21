'use strict';

const path = require('path');
const { runScraper } = require('../../../lib/news-scraper-core');

runScraper({
  rssUrl: 'https://news.google.com/rss/search?q=FIFA+World+Cup+2026&hl=en-US&gl=US&ceid=US:en',
  label: 'มะกรูด World Cup 2026 News Scraper',
  pipelineDir: __dirname,
});
