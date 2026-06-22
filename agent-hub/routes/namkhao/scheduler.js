'use strict';

const fs   = require('fs');
const path = require('path');

const SCHEDULE_TASKS = {
  'ai-news':   'ai-news',
  'sport-news': 'sport-news',
  shopee:       'ShopeeAffiliate-DailyFBPost',
};

function getScheduleTR(ROOT) {
  return {
    'ai-news':
      'powershell.exe -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ""' +
      ROOT + '\\agents\\manao\\pipeline\\run-pipeline.ps1""',
    'sport-news':
      'powershell.exe -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ""' +
      ROOT + '\\agents\\makrut\\pipeline\\run-pipeline.ps1""',
    'ShopeeAffiliate-DailyFBPost':
      '"' + ROOT + '\\post-daily-fb.bat"',
  };
}

// รัน command ผ่าน cmd.exe shell (หลีกเลี่ยง EPERM ของ powershell.exe)
function runCmd(cmd) {
  const { execSync } = require('child_process');
  return execSync(cmd, { encoding: 'utf8', shell: 'cmd.exe', timeout: 15000 }).trim();
}

// Parse schtasks CSV output → { state, lastRun, nextRun, lastResult, times[] }
function parseSchedCSV(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const headerLine = lines.find(l => l.startsWith('"HostName"') || l.includes('"Status"'));
  if (!headerLine) return null;
  const headers = headerLine.split('","').map(h => h.replace(/^"|"$/g, '').trim());

  function convertThaiDate(str) {
    if (!str || str === 'N/A') return 'N/A';
    const m = str.match(/^(\d+)\/(\d+)\/(\d{4})\s+(.+)$/);
    if (!m) return str;
    let [, a, b, yearStr, time] = m;
    let year = parseInt(yearStr, 10);
    if (year >= 2500) year -= 543;
    // ถ้า a > 12 แน่ว่าเป็น DD/MM, ไม่งั้นเป็น MM/DD (Windows en-US default)
    const [dd, mm] = parseInt(a, 10) > 12 ? [a, b] : [b, a];
    return `${year}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')} ${time}`;
  }

  function fmtTime(t) {
    if (!t) return '';
    t = t.trim();
    const ampm = /\b(AM|PM)\b/i.exec(t);
    const parts = t.replace(/\b(AM|PM)\b/i, '').trim().split(':');
    let hh = parseInt(parts[0], 10);
    const mm = (parts[1] || '00').padStart(2, '0');
    if (isNaN(hh)) return '';
    if (ampm) {
      const isPM = ampm[1].toUpperCase() === 'PM';
      if (isPM && hh !== 12) hh += 12;
      else if (!isPM && hh === 12) hh = 0;
    }
    return `${String(hh).padStart(2, '0')}:${mm}`;
  }

  const times = [];
  let state = 'Unknown', lastRun = 'N/A', nextRun = 'N/A', lastResult = null;
  let first = true;

  for (const line of lines) {
    if (line === headerLine || !line.startsWith('"')) continue;
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === ',' && !inQ) { cols.push(cur); cur = ''; continue; }
      cur += c;
    }
    cols.push(cur);

    if (first) {
      first = false;
      const rawState = cols[headers.indexOf('Status')] || cols[headers.indexOf('Scheduled Task State')] || '';
      state = rawState || 'Unknown';
      const rawLast = cols[headers.indexOf('Last Run Time')] || '';
      lastRun = convertThaiDate(rawLast);
      const rawNext = cols[headers.indexOf('Next Run Time')] || '';
      nextRun = convertThaiDate(rawNext);
      const rawResult = cols[headers.indexOf('Last Result')] || '';
      lastResult = lastRun === 'N/A' ? null : (rawResult !== '' ? parseInt(rawResult, 10) : null);
    }

    const startTime = cols[headers.indexOf('Start Time')] || '';
    const t = fmtTime(startTime);
    if (t && !times.includes(t)) times.push(t);
  }

  times.sort();
  return { state, lastRun, nextRun, lastResult, times };
}

function editScheduleTimes(taskName, times) {
  const os2 = require('os');

  if (times.length === 1) {
    const out = runCmd(`schtasks /Change /TN "${taskName}" /ST ${times[0]}`);
    if (!out.toLowerCase().includes('success') && !out.includes('สำเร็จ'))
      throw new Error('แก้ไข Schedule ไม่สำเร็จ: ' + out.substring(0, 150));
    return;
  }

  // หลายเวลา → export XML → แก้ <Triggers> → import พร้อม BOM
  const tmpXml = path.join(os2.tmpdir(), `sched_edit_${Date.now()}.xml`);
  runCmd(`schtasks /Query /TN "${taskName}" /XML ONE > "${tmpXml}"`);
  if (!fs.existsSync(tmpXml) || fs.statSync(tmpXml).size < 10)
    throw new Error('Export XML ไม่สำเร็จ');

  const rawBytes = fs.readFileSync(tmpXml);
  let xml = (rawBytes[0] === 0xFF && rawBytes[1] === 0xFE)
    ? rawBytes.toString('utf16le').replace(/^﻿/, '')
    : rawBytes.toString('utf8').replace(/^﻿/, '');

  const tzOff = -(new Date().getTimezoneOffset());
  const tzStr = (tzOff >= 0 ? '+' : '-') +
    String(Math.floor(Math.abs(tzOff) / 60)).padStart(2, '0') + ':' +
    String(Math.abs(tzOff) % 60).padStart(2, '0');
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  const triggerXml = times.map(t => {
    const [hh, mm] = t.trim().split(':');
    return [
      '    <CalendarTrigger>',
      `      <StartBoundary>${dateStr}T${hh.padStart(2,'0')}:${mm}:00${tzStr}</StartBoundary>`,
      '      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>',
      '    </CalendarTrigger>',
    ].join('\r\n');
  }).join('\r\n');

  xml = xml.replace(/<Triggers>[\s\S]*?<\/Triggers>/, `<Triggers>\r\n${triggerXml}\r\n  </Triggers>`);
  if (!xml.includes('<CalendarTrigger>'))
    throw new Error('แก้ไข Triggers ใน XML ไม่สำเร็จ');

  // เขียนเป็น UTF-16LE + BOM ที่ schtasks /Create /XML ต้องการ
  const bom    = Buffer.from([0xFF, 0xFE]);
  const xmlBuf = Buffer.from(xml, 'utf16le');
  fs.writeFileSync(tmpXml, Buffer.concat([bom, xmlBuf]));

  const out = runCmd(`schtasks /Create /TN "${taskName}" /XML "${tmpXml}" /F`);
  try { fs.unlinkSync(tmpXml); } catch {}
  if (!out.toLowerCase().includes('success') && !out.includes('สำเร็จ'))
    throw new Error('แก้ไข Schedule ไม่สำเร็จ: ' + out.substring(0, 200));
}

function toggleScheduleTask(taskName, enable) {
  const flag = enable ? '/enable' : '/disable';
  const out = runCmd(`schtasks /change /tn "${taskName}" ${flag}`);
  if (!out.toLowerCase().includes('success') && !out.includes('สำเร็จ'))
    throw new Error(`Toggle Schedule ไม่สำเร็จ: ${out.substring(0, 150)}`);
}

function runScheduleNow(taskName) {
  const out = runCmd(`schtasks /run /tn "${taskName}"`);
  if (!out.toLowerCase().includes('success') && !out.includes('สำเร็จ'))
    throw new Error(`Run Schedule ไม่สำเร็จ: ${out.substring(0, 150)}`);
}

module.exports = {
  SCHEDULE_TASKS,
  getScheduleTR,
  runCmd,
  parseSchedCSV,
  editScheduleTimes,
  toggleScheduleTask,
  runScheduleNow,
};
