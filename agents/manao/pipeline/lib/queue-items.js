const fs   = require('fs');
const path = require('path');

function getPendingItems(newsDir, { slugArg, dateArg, force, resend, noTelegram } = {}) {
  if (!fs.existsSync(newsDir)) return [];

  const dirs = fs.readdirSync(newsDir);

  return dirs
    .map(slug => {
      const dataPath = path.join(newsDir, slug, 'data.json');
      let data;
      try { data = JSON.parse(fs.readFileSync(dataPath, 'utf8')); } catch { return null; }
      const contentDir = path.join(newsDir, slug, 'content');
      const hasFB = fs.existsSync(path.join(contentDir, 'facebook.md'));
      return { slug, data, hasFB };
    })
    .filter(Boolean)
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
