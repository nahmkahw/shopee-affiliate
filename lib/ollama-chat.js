'use strict';
/**
 * ollama-chat.js — generic Ollama /api/chat client (Typhoon2)
 * extracted for มะพร้าว reuse; มะปราง keeps its own copy in pipeline/scene-gen.js (untouched, pre-existing)
 */

const http = require('http');

const OLLAMA_HOST  = process.env.OLLAMA_HOST  || 'http://10.3.17.118:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'scb10x/llama3.1-typhoon2-8b-instruct:latest';

function ollamaChat(prompt, systemPrompt) {
  return new Promise((resolve, reject) => {
    const url  = new URL('/api/chat', OLLAMA_HOST);
    const body = JSON.stringify({
      model:    OLLAMA_MODEL,
      messages: [
        { role: 'system', content: systemPrompt || '' },
        { role: 'user',   content: prompt },
      ],
      stream: false,
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
        } catch { reject(new Error('Ollama parse error: ' + buf.substring(0, 200))); }
      });
    });
    req.on('error', e => reject(new Error('Ollama connection: ' + e.message)));
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Ollama timeout (120s)')); });
    req.write(body); req.end();
  });
}

module.exports = { ollamaChat };
