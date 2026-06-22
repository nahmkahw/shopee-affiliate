'use strict';

const fs   = require('fs');
const path = require('path');

const { SCHEDULE_TASKS, editScheduleTimes, toggleScheduleTask, runScheduleNow } = require('./scheduler');
const { getScheduleStatus } = require('./status');

function jsonOk(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(data));
}

function readBody(req, cb) {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => cb(body));
}

function parseBody(raw) {
  try { return JSON.parse(raw); } catch { return {}; }
}

function handleScheduleStatus(req, res, deps) {
  const { AI_NEWS_DIR, ROOT } = deps;
  try {
    const data = getScheduleStatus(AI_NEWS_DIR, ROOT);
    jsonOk(res, { ok: true, ...data });
  } catch (e) {
    jsonOk(res, { ok: false, error: e.message });
  }
}

function handleScheduleRun(req, res, deps) {
  const { ROOT, runPipelineSequential, runSportPipeline } = deps;
  res._claimed = true;
  readBody(req, raw => {
    const { taskName } = parseBody(raw);
    if (!taskName) { res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'Missing taskName' })); }
    try {
      if (taskName === SCHEDULE_TASKS['ai-news']) {
        runPipelineSequential([]);
      } else if (taskName === SCHEDULE_TASKS['sport-news']) {
        runSportPipeline();
      } else if (taskName === SCHEDULE_TASKS.shopee) {
        const { spawn } = require('child_process');
        const botScript = path.join(ROOT, 'approval-bot.js');
        const lockFile  = path.join(ROOT, '.approval-bot.lock');
        if (fs.existsSync(lockFile)) {
          try {
            process.kill(parseInt(fs.readFileSync(lockFile,'utf8').trim()), 0);
            throw new Error('approval-bot กำลังรันอยู่แล้ว');
          } catch (le) {
            if (le.message.includes('กำลังรัน')) throw le;
            try { fs.unlinkSync(lockFile); } catch {}
          }
        }
        const bot = spawn(process.execPath, [botScript], { cwd: ROOT, detached: true, stdio: 'ignore' });
        bot.unref();
      } else {
        throw new Error(`ไม่รู้จัก taskName: ${taskName}`);
      }
      jsonOk(res, { ok: true });
    } catch (e) {
      jsonOk(res, { ok: false, error: e.message });
    }
  });
}

function updateScheduleFile(file, patch, reschedule) {
  const cfg = (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } })();
  Object.assign(cfg, patch);
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8');
  reschedule();
}

function handleScheduleToggle(req, res, deps) {
  const { SHOPEE_SCHEDULE_FILE, rescheduleShopeeBot, AI_NEWS_SCHEDULE_FILE, rescheduleAiNewsPipeline, SPORT_SCHEDULE_FILE, rescheduleSportPipeline } = deps;
  res._claimed = true;
  readBody(req, raw => {
    const { taskName, enable } = parseBody(raw);
    if (!taskName) { res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'Missing taskName' })); }
    try {
      if (taskName === SCHEDULE_TASKS['ai-news']) {
        updateScheduleFile(AI_NEWS_SCHEDULE_FILE, { enabled: !!enable }, rescheduleAiNewsPipeline);
      } else if (taskName === SCHEDULE_TASKS['sport-news']) {
        updateScheduleFile(SPORT_SCHEDULE_FILE, { enabled: !!enable }, rescheduleSportPipeline);
      } else if (taskName === SCHEDULE_TASKS.shopee) {
        updateScheduleFile(SHOPEE_SCHEDULE_FILE, { enabled: !!enable }, rescheduleShopeeBot);
      } else {
        throw new Error(`ไม่รู้จัก taskName: ${taskName}`);
      }
      jsonOk(res, { ok: true });
    } catch (e) { jsonOk(res, { ok: false, error: e.message }); }
  });
}

function handleScheduleEdit(req, res, deps) {
  const { SHOPEE_SCHEDULE_FILE, rescheduleShopeeBot, AI_NEWS_SCHEDULE_FILE, rescheduleAiNewsPipeline, SPORT_SCHEDULE_FILE, rescheduleSportPipeline } = deps;
  res._claimed = true;
  readBody(req, raw => {
    const { taskName, times } = parseBody(raw);
    if (!taskName || !Array.isArray(times) || times.length === 0) {
      res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: 'Missing taskName or times' }));
    }
    try {
      if (taskName === SCHEDULE_TASKS['ai-news']) {
        updateScheduleFile(AI_NEWS_SCHEDULE_FILE, { times }, rescheduleAiNewsPipeline);
      } else if (taskName === SCHEDULE_TASKS['sport-news']) {
        updateScheduleFile(SPORT_SCHEDULE_FILE, { times }, rescheduleSportPipeline);
      } else if (taskName === SCHEDULE_TASKS.shopee) {
        updateScheduleFile(SHOPEE_SCHEDULE_FILE, { time: times[0] }, rescheduleShopeeBot);
      } else {
        throw new Error(`ไม่รู้จัก taskName: ${taskName}`);
      }
      jsonOk(res, { ok: true });
    } catch (e) { jsonOk(res, { ok: false, error: e.message }); }
  });
}

function handleScheduleCreate(req, res, deps) {
  const { ROOT } = deps;
  const { runCmd } = require('./scheduler');
  res._claimed = true;
  readBody(req, raw => {
    const parsed = parseBody(raw);
    const { taskName, xmlPath } = parsed;

    if (xmlPath) {
      try {
        if (!fs.existsSync(xmlPath)) throw new Error(`ไม่พบไฟล์ XML: ${xmlPath}`);

        // ดึง SID ของ user ปัจจุบันผ่าน whoami /user
        const whoami = runCmd('whoami /user /fo csv /nh').trim();
        const sidMatch = whoami.match(/S-\d+-\d+-[\d-]+/);
        if (!sidMatch) throw new Error('ดึง SID ไม่สำเร็จ: ' + whoami.substring(0, 100));
        const currentSid = sidMatch[0];

        let xml = fs.readFileSync(xmlPath, { encoding: 'utf16le' });
        xml = xml.replace(/S-1-5-21-[\d-]+-\d+/g, currentSid);
        xml = xml.replace(/C:\\Users\\[^\\]+\\shopee-affiliate/gi,
                          'C:\\Users\\lenovo3\\agent\\shopee-affiliate');
        xml = xml.replace(/HighestAvailable/g, 'LeastPrivilege');

        const os = require('os');
        const tmpXml = path.join(os.tmpdir(), `sched_${Date.now()}.xml`);
        fs.writeFileSync(tmpXml, xml, { encoding: 'utf16le' });

        const name = taskName || 'AI-News-Pipeline';
        const out  = runCmd(`schtasks /Create /TN "${name}" /XML "${tmpXml}" /F`);
        try { fs.unlinkSync(tmpXml); } catch {}

        if (!out.toLowerCase().includes('success') && !out.includes('สำเร็จ'))
          throw new Error(out.substring(0, 200));

        return jsonOk(res, { ok: true, created: 1, taskName: name });
      } catch (e) {
        return jsonOk(res, { ok: false, error: e.message.substring(0, 300) });
      }
    }

    const { scriptPath, times } = parsed;
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
      jsonOk(res, { ok: true, created: times.length - errors.length, warnings: errors });
    } catch (e) {
      jsonOk(res, { ok: false, error: e.message.substring(0, 300) });
    }
  });
}

function handleLog(req, res, deps) {
  const { ROOT } = deps;
  const logFile = path.join(ROOT, 'agents', 'namkhao', 'namkhao.log');
  if (!fs.existsSync(logFile)) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('ยังไม่มี log');
  }
  const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).slice(-60);
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  return res.end(lines.join('\n'));
}

module.exports = {
  handleScheduleStatus,
  handleScheduleRun,
  handleScheduleToggle,
  handleScheduleEdit,
  handleScheduleCreate,
  handleLog,
};
