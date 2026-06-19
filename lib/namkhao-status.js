'use strict';
/**
 * lib/namkhao-status.js — actionStatus + actionSummary for namkhao agent
 */

const fs   = require('fs');
const path = require('path');

function createStatusActions({ ROOT, NEWS_DIR, log, readStatus, todayString, readLog, updateStatus }) {

  function actionStatus() {
    log('👀 น้ำข้าว ตรวจสอบสถานะทุก Agent');
    const s = readStatus();

    ['mali', 'manao'].forEach(name => {
      const a    = s[name] || {};
      const icon = a.status === 'running' ? '🟡' : a.status === 'error' ? '🔴' : '🟢';
      log(`${icon} ${name === 'mali' ? 'มะลิ' : 'มะนาว'}: ${a.status || 'idle'} | ${a.currentAction || '-'} | ${a.lastResult || '-'}`);
      if (a.lastRun) log(`   ล่าสุด: ${new Date(a.lastRun).toLocaleString('th-TH')}`);
    });

    const prodDir = path.join(ROOT, 'products');
    if (fs.existsSync(prodDir)) {
      const today = todayString();
      const dirs  = fs.readdirSync(prodDir).filter(d => fs.existsSync(path.join(prodDir, d, 'data.json')));
      let posted = 0, todayCount = 0;
      dirs.forEach(id => {
        const d = JSON.parse(fs.readFileSync(path.join(prodDir, id, 'data.json'), 'utf8'));
        if (d.status === 'posted') posted++;
        if (d.post_date === today) todayCount++;
      });
      log(`📦 Shopee: สินค้า ${dirs.length} รายการ | โพสต์แล้ว: ${posted} | วันนี้: ${todayCount}`);
    }

    const todayNews = path.join(NEWS_DIR, todayString(), 'articles.json');
    if (fs.existsSync(todayNews)) {
      const articles = JSON.parse(fs.readFileSync(todayNews, 'utf8'));
      log(`📰 Reuters News: ${articles.length} บทความวันนี้`);
    } else {
      log('📰 Reuters News: ยังไม่มีข่าววันนี้');
    }

    updateStatus({ lastResult: 'status check สำเร็จ' });
  }

  function actionSummary() {
    log('📊 น้ำข้าว สรุปผลงานรายวัน');
    const today = todayString();
    const s     = readStatus();

    log('='.repeat(40));
    log(`สรุปวันที่ ${today}`);
    log('='.repeat(40));

    const prodDir = path.join(ROOT, 'products');
    if (fs.existsSync(prodDir)) {
      const dirs = fs.readdirSync(prodDir).filter(d => fs.existsSync(path.join(prodDir, d, 'data.json')));
      let total = 0, posted = 0, ready = 0, todayCount = 0;
      dirs.forEach(id => {
        const d = JSON.parse(fs.readFileSync(path.join(prodDir, id, 'data.json'), 'utf8'));
        if (d.status === 'placeholder') return;
        total++;
        if (d.status === 'posted') posted++;
        if (d.post_date === today) todayCount++;
        if (fs.existsSync(path.join(prodDir, id, 'content', 'facebook.md'))) ready++;
      });
      log(`\n🌸 มะลิ (Shopee Affiliate)`);
      log(`   สินค้าทั้งหมด: ${total} | วันนี้: ${todayCount}`);
      log(`   โพสต์แล้ว: ${posted} | มี content: ${ready}`);
      log(`   สถานะ: ${s.mali?.lastResult || '-'}`);
    }

    log(`\n🍋 มะนาว (Reuters AI News)`);
    const todayNews = path.join(NEWS_DIR, today, 'articles.json');
    if (fs.existsSync(todayNews)) {
      const articles = JSON.parse(fs.readFileSync(todayNews, 'utf8'));
      const notified = articles.filter(a => a.notified).length;
      log(`   ข่าวทั้งหมด: ${articles.length} | แจ้ง Telegram: ${notified}`);
      articles.slice(0, 3).forEach((a, i) => log(`   ${i+1}. ${a.title.substring(0, 55)}`));
    } else {
      log('   ยังไม่ได้ดึงข่าววันนี้');
    }

    log(`\n📜 Log ล่าสุด — มะลิ:`);
    readLog('mali', 5).forEach(l => log(`   ${l}`));

    log(`\n📜 Log ล่าสุด — มะนาว:`);
    readLog('manao', 5).forEach(l => log(`   ${l}`));

    log('='.repeat(40));
    updateStatus({ lastResult: `daily summary ${today}` });
  }

  return { actionStatus, actionSummary };
}

module.exports = { createStatusActions };
