'use strict';
/**
 * agent-hub/routes/namkhao.js
 */

const fs   = require('fs');
const path = require('path');

const SCHEDULE_TASKS = {
  reuters: 'AI-News-Pipeline',
  shopee:  'ShopeeAffiliate-DailyFBPost',
};

// TR (Task Run) สำหรับแต่ละ task — ใช้ตอนสร้าง/แก้ไข schedule
function getScheduleTR(ROOT) {
  return {
  'AI-News-Pipeline':
    'powershell.exe -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ""' +
    ROOT + '\\agents\\manao\\pipeline\\run-pipeline.ps1""',
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
  // หา header row
  const headerLine = lines.find(l => l.startsWith('"HostName"') || l.includes('"Status"'));
  if (!headerLine) return null;
  const headers = headerLine.split('","').map(h => h.replace(/^"|"$/g, '').trim());

  // แปลงวันที่ Thai Buddhist → Gregorian (ปี พ.ศ. → ค.ศ.: ลบ 543)
  function convertThaiDate(str) {
    if (!str || str === 'N/A') return 'N/A';
    // รูปแบบ "31/5/2569 7:05:56" หรือ "31/5/2569 12:00:00"
    const m = str.match(/^(\d+)\/(\d+)\/(\d{4})\s+(.+)$/);
    if (!m) return str;
    const [, dd, mm, bYear, time] = m;
    const ceYear = parseInt(bYear, 10) - 543;
    return `${ceYear}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')} ${time}`;
  }

  // แปลงเวลา → "HH:MM" รูปแบบ 24 ชั่วโมง
  // รองรับทั้ง 12 ชม. ("6:00:00 PM", "12:00:00 AM") และ 24 ชม. ("18:00:00")
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
      if (isPM && hh !== 12) hh += 12;      // 1-11 PM → 13-23
      else if (!isPM && hh === 12) hh = 0;  // 12 AM → 00
    }
    return `${String(hh).padStart(2, '0')}:${mm}`;
  }

  const getCol = (row, col) => row[headers.indexOf(col)] || '';
  const times = [];
  let state = 'Unknown', lastRun = 'N/A', nextRun = 'N/A', lastResult = null;
  let first = true;

  for (const line of lines) {
    if (line === headerLine || !line.startsWith('"')) continue;
    // split CSV (simple: split by "," but inside quotes)
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

    // ดึง Start Time จากทุก row (แต่ละ row = แต่ละ trigger)
    const startTime = cols[headers.indexOf('Start Time')] || '';
    const t = fmtTime(startTime);
    if (t && !times.includes(t)) times.push(t);
  }

  times.sort();
  return { state, lastRun, nextRun, lastResult, times };
}

function getScheduleStatus() {
  function queryOne(taskName) {
    try {
      const raw = runCmd(`schtasks /query /fo CSV /v /tn "${taskName}"`);
      const parsed = parseSchedCSV(raw);
      if (!parsed) throw new Error('parse CSV ไม่สำเร็จ');
      return parsed;
    } catch (e) {
      return { state: 'Error', lastRun: 'N/A', lastResult: null, nextRun: 'N/A', times: [], error: e.message.substring(0, 100) };
    }
  }
  return {
    reuters: queryOne(SCHEDULE_TASKS.reuters),
    shopee:  queryOne(SCHEDULE_TASKS.shopee),
  };
}

function editScheduleTimes(taskName, times) {
  const os2 = require('os');

  if (times.length === 1) {
    // เวลาเดียว → schtasks /Change /ST
    const out = runCmd(`schtasks /Change /TN "${taskName}" /ST ${times[0]}`);
    if (!out.toLowerCase().includes('success') && !out.includes('สำเร็จ'))
      throw new Error('แก้ไข Schedule ไม่สำเร็จ: ' + out.substring(0, 150));
    return;
  }

  // หลายเวลา → export XML (UTF-8) → แก้ <Triggers> → import พร้อม BOM
  const tmpXml = path.join(os2.tmpdir(), `sched_edit_${Date.now()}.xml`);
  runCmd(`schtasks /Query /TN "${taskName}" /XML ONE > "${tmpXml}"`);
  if (!fs.existsSync(tmpXml) || fs.statSync(tmpXml).size < 10)
    throw new Error('Export XML ไม่สำเร็จ');

  // อ่านด้วย encoding จริง (cmd redirect ให้ UTF-8, ไม่มี BOM)
  const rawBytes = fs.readFileSync(tmpXml);
  let xml = (rawBytes[0] === 0xFF && rawBytes[1] === 0xFE)
    ? rawBytes.toString('utf16le').replace(/^﻿/, '')
    : rawBytes.toString('utf8').replace(/^﻿/, '');

  // คำนวณ timezone offset ของเครื่อง
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
  // schtasks คืน "SUCCESS:" ถ้าสำเร็จ
  if (!out.toLowerCase().includes('success') && !out.includes('สำเร็จ')) {
    throw new Error(`Toggle Schedule ไม่สำเร็จ: ${out.substring(0, 150)}`);
  }
}

function runScheduleNow(taskName) {
  const out = runCmd(`schtasks /run /tn "${taskName}"`);
  if (!out.toLowerCase().includes('success') && !out.includes('สำเร็จ')) {
    throw new Error(`Run Schedule ไม่สำเร็จ: ${out.substring(0, 150)}`);
  }
}

function serveNamkhaoHTML(res, ROOT) {
  const htmlFile = path.join(ROOT, 'agents', 'namkhao', 'dashboard.html');
  if (!fs.existsSync(htmlFile)) {
    res.writeHead(404); return res.end('ไม่พบ dashboard.html ของน้ำข้าว');
  }
  const html = fs.readFileSync(htmlFile, 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function register(req, res, url, rawUrl, method, deps) {
  const { ROOT } = deps;

    // ── Dashboard: น้ำข้าว HTML ────────────────────────────────────────────────
    if (url === '/dashboard/namkhao') {
      serveNamkhaoHTML(res, ROOT);
      return;
    }
  
    // ── Dashboard API: น้ำข้าว /api/schedule-status ────────────────────────────
    if (url === '/dashboard/namkhao/api/schedule-status' && method === 'GET') {
      try {
        const data = getScheduleStatus();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ ok: true, ...data }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }
  
    // ── Dashboard API: น้ำข้าว /api/schedule-run ───────────────────────────────
    if (url === '/dashboard/namkhao/api/schedule-run' && method === 'POST') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        const { taskName } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        if (!taskName) { res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'Missing taskName' })); }
        try {
          runScheduleNow(taskName);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
  
    // ── Dashboard API: น้ำข้าว /api/schedule-toggle ────────────────────────────
    if (url === '/dashboard/namkhao/api/schedule-toggle' && method === 'POST') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        const { taskName, enable } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        if (!taskName) { res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'Missing taskName' })); }
        try {
          toggleScheduleTask(taskName, !!enable);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
  
    // ── Dashboard API: น้ำข้าว /api/schedule-edit ──────────────────────────────
    if (url === '/dashboard/namkhao/api/schedule-edit' && method === 'POST') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        const { taskName, times } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        if (!taskName || !Array.isArray(times) || times.length === 0) {
          res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'Missing taskName or times' }));
        }
        try {
          editScheduleTimes(taskName, times);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
  
    // ── Dashboard API: น้ำข้าว /api/schedule-create ────────────────────────────
    if (url === '/dashboard/namkhao/api/schedule-create' && method === 'POST') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        const { taskName, xmlPath } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
  
        // ── Reuters: ใช้ XML import (รองรับ multi-trigger + config ครบ) ──────────
        if (xmlPath) {
          try {
            if (!fs.existsSync(xmlPath)) throw new Error(`ไม่พบไฟล์ XML: ${xmlPath}`);
  
            // ดึง SID ของ user ปัจจุบันผ่าน whoami /user
            const whoami = runCmd('whoami /user /fo csv /nh').trim();
            const sidMatch = whoami.match(/S-\d+-\d+-[\d-]+/);
            if (!sidMatch) throw new Error('ดึง SID ไม่สำเร็จ: ' + whoami.substring(0, 100));
            const currentSid = sidMatch[0];
  
            // อ่าน XML แก้ SID เก่า + path เก่า + RunLevel
            let xml = fs.readFileSync(xmlPath, { encoding: 'utf16le' });
            xml = xml.replace(/S-1-5-21-[\d-]+-\d+/g, currentSid);
            xml = xml.replace(/C:\\Users\\[^\\]+\\shopee-affiliate/gi,
                              'C:\\Users\\lenovo3\\agent\\shopee-affiliate');
            xml = xml.replace(/HighestAvailable/g, 'LeastPrivilege');
  
            // บันทึก XML ชั่วคราวแล้ว import
            const os = require('os');
            const tmpXml = path.join(os.tmpdir(), `sched_${Date.now()}.xml`);
            fs.writeFileSync(tmpXml, xml, { encoding: 'utf16le' });
  
            const name = taskName || 'AI-News-Pipeline';
            const out  = runCmd(`schtasks /Create /TN "${name}" /XML "${tmpXml}" /F`);
            try { fs.unlinkSync(tmpXml); } catch {}
  
            if (!out.toLowerCase().includes('success') && !out.includes('สำเร็จ'))
              throw new Error(out.substring(0, 200));
  
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ ok: true, created: 1, taskName: name }));
          } catch (e) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ ok: false, error: e.message.substring(0, 300) }));
          }
        }
  
        // ── Shopee / ทั่วไป: สร้างจาก scriptPath + times ────────────────────────
        const { scriptPath, times } = (() => { try { return JSON.parse(body); } catch { return {}; } })();
        if (!taskName || !scriptPath || !Array.isArray(times) || times.length === 0) {
          res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'Missing taskName, scriptPath or times' }));
        }
        try {
          const isPsScript = scriptPath.trim().toLowerCase().endsWith('.ps1');
          const tr = isPsScript
            ? `powershell.exe -ExecutionPolicy Bypass -NonInteractive -File ""${scriptPath.trim()}""`
            : scriptPath.trim();
  
          const errors = [];
          for (let i = 0; i < times.length; i++) {
            const name = i === 0 ? taskName : `${taskName}_${i + 1}`;
            const t    = times[i].trim();
            try {
              const out = runCmd(`schtasks /Create /TN "${name}" /TR "${tr}" /SC DAILY /ST ${t} /F`);
              if (!out.toLowerCase().includes('success') && !out.includes('สำเร็จ'))
                errors.push(`${name}: ${out.substring(0, 100)}`);
            } catch (e) {
              errors.push(`${name}: ${e.message.substring(0, 100)}`);
            }
          }
          if (errors.length === times.length) throw new Error(errors[0]);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, created: times.length - errors.length, warnings: errors }));
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: e.message.substring(0, 300) }));
        }
      });
      return;
    }
  
    // ── Dashboard API: น้ำข้าว /api/log ────────────────────────────────────────
    if (url === '/dashboard/namkhao/api/log' && method === 'GET') {
      const logFile = path.join(ROOT, 'agents', 'namkhao', 'namkhao.log');
      if (!fs.existsSync(logFile)) { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('ยังไม่มี log'); }
      const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).slice(-60);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(lines.join('\n'));
    }
  

  return false;
}

module.exports = {
  register,
  runCmd, parseSchedCSV, getScheduleStatus, editScheduleTimes,
  toggleScheduleTask, runScheduleNow, serveNamkhaoHTML,
};
