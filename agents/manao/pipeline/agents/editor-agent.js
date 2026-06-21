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
    'เขียนภาษาไทยล้วน (ยกเว้นชื่อเฉพาะ เช่น OpenAI, Reuters, ChatGPT)',
    'อธิบายให้คนทั่วไปเข้าใจ ไม่ต้องใช้ศัพท์เทคนิค',
    'ชื่อยา สารเคมี คำศัพท์เทคนิค: ถ้าไม่แน่ใจการทับศัพท์ให้ใช้ภาษาอังกฤษทั้งคำ ห้ามผสมอักษรไทยกับอังกฤษในคำเดียวกันเด็ดขาด เช่น "fentanyl" ไม่ใช่ "ฟentanyl"',
  ],
});
