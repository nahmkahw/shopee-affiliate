/**
 * ollama.js — shared Ollama client
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');

function ollamaChat(prompt, opts = {}) {
  const host  = process.env.OLLAMA_HOST  || 'http://10.3.17.118:11434';
  const model = opts.model || process.env.OLLAMA_MODEL || 'scb10x/llama3.1-typhoon2-8b-instruct:latest';

  return new Promise((resolve, reject) => {
    const url  = new URL('/api/chat', host);
    const body = JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: { temperature: opts.temperature ?? 0.3 },
    });

    const req = http.request({
      hostname: url.hostname,
      port:     url.port || 11434,
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          if (j.error) return reject(new Error('Ollama: ' + j.error));
          resolve(j.message?.content || j.response || '');
        } catch {
          reject(new Error('Ollama parse error: ' + buf.substring(0, 200)));
        }
      });
    });

    req.on('error', e => reject(new Error('Ollama connect: ' + e.message)));
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Ollama timeout (120s)')); });
    req.write(body);
    req.end();
  });
}

async function checkOllama() {
  const host  = process.env.OLLAMA_HOST  || 'http://10.3.17.118:11434';
  const model = process.env.OLLAMA_MODEL || 'scb10x/llama3.1-typhoon2-8b-instruct:latest';

  return new Promise((resolve, reject) => {
    const url = new URL('/api/tags', host);
    http.get({ hostname: url.hostname, port: url.port || 11434, path: url.pathname }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try {
          const j      = JSON.parse(buf);
          const models = (j.models || []).map(m => m.name);
          if (!models.some(m => m.startsWith(model.split(':')[0]))) {
            reject(new Error(`ไม่พบ model "${model}" ใน Ollama (มี: ${models.join(', ') || 'ไม่มี'})\nรัน: ollama pull ${model}`));
          } else {
            resolve(true);
          }
        } catch {
          reject(new Error('Ollama /api/tags parse error'));
        }
      });
    }).on('error', e => reject(new Error('เชื่อมต่อ Ollama ไม่ได้: ' + e.message)));
  });
}

module.exports = { ollamaChat, checkOllama };
