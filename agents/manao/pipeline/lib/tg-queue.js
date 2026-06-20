const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const TG_QUEUE_FILE = path.join(__dirname, '..', '_tg_queue.json');

function loadQueue() {
  try { return JSON.parse(fs.readFileSync(TG_QUEUE_FILE, 'utf8')); } catch { return {}; }
}

function saveQueue(q) {
  fs.writeFileSync(TG_QUEUE_FILE, JSON.stringify(q, null, 2), 'utf8');
}

function makeShortId(slug) {
  return crypto.createHash('md5').update(slug).digest('hex').substring(0, 12);
}

module.exports = { loadQueue, saveQueue, makeShortId };
