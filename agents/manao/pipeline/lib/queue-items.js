const fs   = require('fs');
const path = require('path');

function getPendingItems(newsDir, { slugArg, dateArg, force, resend, noTelegram } = {}) {
  if (!fs.existsSync(newsDir)) return [];

  const dirs = fs.readdirSync(newsDir)
    .filter(d => fs.existsSync(path.join(newsDir, d, 'data.json')));

  return dirs
    .map(slug => {
      const data = JSON.parse(fs.readFileSync(path.join(newsDir, slug, 'data.json'), 'utf8'));
      const contentDir = path.join(newsDir, slug, 'content');
      const hasFB = fs.existsSync(path.join(contentDir, 'facebook.md'));
      return { slug, data, hasFB };
    })
    .filter(({ slug, data, hasFB }) => {
      if (resend) {
        if (!hasFB) return false;
        if (data.status !== 'pending_approval' && data.status !== 'draft') return false;
        if (data.pending_since) {
          const ageMin = (Date.now() - new Date(data.pending_since).getTime()) / 60000;
          if (ageMin < 5) return false;
        }
        if (slugArg && slug !== slugArg) return false;
        if (dateArg) {
          const pubDate = (data.published_at || data.scraped_at || '').substring(0, 10);
          if (pubDate !== dateArg) return false;
        }
        return true;
      }
      if (hasFB && !force) return false;
      if (data.status === 'posted') return false;
      if (data.status === 'scheduled' && !noTelegram) return false;
      if (slugArg && slug !== slugArg) return false;
      if (dateArg) {
        const pubDate = (data.published_at || data.scraped_at || '').substring(0, 10);
        if (pubDate !== dateArg) return false;
      }
      return true;
    });
}

module.exports = { getPendingItems };
