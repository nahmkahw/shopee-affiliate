const http = require('http');

const OLLAMA_HOST  = process.env.OLLAMA_HOST  || 'http://10.3.17.118:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:latest';

function ollamaChat(prompt) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/chat', OLLAMA_HOST);
    const body = JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    });

    const options = {
      hostname: url.hostname,
      port: url.port || 11434,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };

    const req = http.request(options, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          if (j.error) return reject(new Error('Ollama error: ' + j.error));
          resolve(j.message?.content || j.response || '');
        } catch {
          reject(new Error('Ollama response parse error: ' + buf.substring(0, 200)));
        }
      });
    });

    req.on('error', e => reject(new Error('Ollama connection error: ' + e.message)));
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Ollama timeout (120s)')); });
    req.write(body);
    req.end();
  });
}

function checkOllamaReady() {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/tags', OLLAMA_HOST);
    http.get({ hostname: url.hostname, port: url.port || 11434, path: url.pathname }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          const models = (j.models || []).map(m => m.name);
          if (!models.some(m => m.startsWith(OLLAMA_MODEL.split(':')[0]))) {
            console.error(`❌ ไม่พบ model "${OLLAMA_MODEL}" ใน Ollama`);
            console.error(`   models ที่มี: ${models.join(', ') || '(ไม่มี)'}`);
            console.error(`   รัน: ollama pull ${OLLAMA_MODEL}`);
            process.exit(1);
          }
          resolve();
        } catch { reject(new Error('parse error')); }
      });
    }).on('error', reject);
  });
}

module.exports = { OLLAMA_HOST, OLLAMA_MODEL, ollamaChat, checkOllamaReady };
