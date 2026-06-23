#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const { ollamaChat, checkOllama } = require('./ollama');
const { runEditorAgent } = require('../../../../lib/editor-agent-core');

runEditorAgent({
  newsDir: path.join(__dirname, '..', 'news'),
  ollamaChat,
  checkOllama,
  domainRules: [
    'เขียนภาษาไทยล้วน (ยกเว้นชื่อเฉพาะ เช่น FIFA, Messi, Ronaldo, Mbappe, Haaland)',
    'อธิบายให้แฟนบอลทั่วไปเข้าใจ ใช้ภาษาที่สนุก มีชีวิตชีวา',
    'ชื่อนักเตะ ทีม สนาม: ถ้าไม่แน่ใจการทับศัพท์ให้ใช้ภาษาอังกฤษทั้งคำ ห้ามผสมอักษรไทยกับอังกฤษในคำเดียวกันเด็ดขาด',
  ],
});
