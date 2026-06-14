/**
 * config.js — โหลดค่าตั้งจาก config.json พร้อม default สำรอง
 *
 * ใช้: const { loadConfig } = require('../config');  // จาก agents/
 *      const cfg = loadConfig();
 *
 * ถ้า config.json หาย/พัง → ใช้ DEFAULTS (ระบบยังทำงานได้)
 * ค่าใน config.json จะ override DEFAULTS แบบ deep-merge
 */

const fs   = require('fs');
const path = require('path');

const DEFAULTS = {
  filter: {
    minScore: 30,
    weights: { high: 20, medium: 5, low: 10 },
    labels:  { ai_tech: 80, ai_biz: 50, ai_policy: 30 },
    keywords: {
      high: [
        'openai', 'anthropic', 'google deepmind', 'meta ai', 'mistral', 'cohere', 'stability ai',
        'chatgpt', 'gemini', 'claude', 'gpt-4', 'gpt-5', 'llama', 'large language model', 'llm',
        'neural network', 'machine learning', 'deep learning', 'generative ai', 'gen ai',
        'ai model', 'ai system', 'ai tool', 'ai chip', 'nvidia gpu', 'amd gpu', 'tpu',
        'data center', 'data centres', 'data centre', 'inference', 'foundation model',
        'transformer', 'diffusion model', 'multimodal', 'autonomous vehicle', 'self-driving',
        'computer vision', 'natural language processing', 'nlp', 'robotics', 'humanoid robot',
        'open source ai', 'benchmark', 'hallucination', 'fine-tuning', 'rlhf',
      ],
      medium: [
        'artificial intelligence', ' ai ', 'ai-powered', 'ai-driven', 'ai-based',
        'ai-related', 'ai-focused', 'ai-generated', 'ai-linked', 'ai-enabled',
        'machine', 'algorithm', 'automation', 'digital', 'tech', 'software', 'startup',
        'cybersecurity', 'data breach', 'surveillance', 'deepfake', 'chatbot',
      ],
      low: [
        'stocks', 'bonds', 'etf', 'inflow', 'outflow', 'fund manager', 'hedge fund',
        'equity fund', 'ipo', 'earnings report', 's&p 500', 'dow jones', 'nasdaq index',
        'regulation bill', 'congress vote', 'senate hearing', 'antitrust lawsuit',
        'gdpr violation', 'compliance fine', 'court ruling', 'papal', 'pope',
      ],
    },
  },
  formatter: {
    skipStatus: ['posted', 'scheduled'],
    minScore: 30,
    skipPlatforms: [],
  },
};

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

// deep-merge: over ทับ base (array ทับทั้งก้อน ไม่รวม)
function deepMerge(base, over) {
  if (!isObject(over)) return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over)) {
    if (k.startsWith('_')) continue;                 // ข้าม _comment
    if (isObject(base[k]) && isObject(over[k])) out[k] = deepMerge(base[k], over[k]);
    else                                         out[k] = over[k];
  }
  return out;
}

function loadConfig() {
  const p = path.join(__dirname, 'config.json');
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    if (fs.existsSync(p)) console.warn(`⚠️  config.json อ่านไม่ได้ (${e.message}) → ใช้ค่า default`);
  }
  return deepMerge(DEFAULTS, user);
}

module.exports = { loadConfig, DEFAULTS };
