'use strict';
/**
 * lib/slip-ocr.js — อ่านสลิปโอนเงินไทย (Gate 2 pluggable OCR)
 *
 * Default engine: Ollama vision model (qwen2.5vl) — local, ฟรี
 * ออกแบบให้สลับ engine ได้ผ่าน param `engine` (เผื่อ EasySlip/SlipOK API ทีหลัง)
 *
 * readSlip(imageBuffer, opts) → {
 *   is_slip, amount, slip_datetime, bank_from, bank_to, account_to, ref_no, raw
 * }
 */

const http = require('http');

const OLLAMA_HOST = process.env.OLLAMA_HOST     || 'http://10.3.17.118:11434';
const OCR_MODEL   = process.env.MAYOM_OCR_MODEL || 'qwen2.5vl:latest';

const SYSTEM_PROMPT =
  'You extract structured data from Thai bank transfer slips (สลิปโอนเงิน). ' +
  'Reply with ONLY a JSON object, no markdown, no explanation.';

const USER_PROMPT = `ดูรูปนี้ ถ้าเป็นสลิปโอนเงิน/ใบเสร็จการโอนของธนาคารไทย ให้ดึงข้อมูลเป็น JSON:
{
  "is_slip": true/false,
  "amount": ตัวเลขจำนวนเงินบาท (number, ไม่มี comma) หรือ null ถ้าอ่านไม่ได้,
  "slip_datetime": "วันเวลาบนสลิป เช่น 2024-06-01 14:30" หรือ null,
  "bank_from": "ธนาคาร/บัญชีผู้โอน" หรือ null,
  "bank_to": "ธนาคาร/บัญชีผู้รับ" หรือ null,
  "account_to": "เลขบัญชี/ชื่อผู้รับ" หรือ null,
  "ref_no": "เลขที่รายการ/รหัสอ้างอิง" หรือ null
}
ถ้ารูปไม่ใช่สลิปโอนเงิน (เช่น รูปทั่วไป มีม สกรีนช็อตอื่น) ให้ตอบ {"is_slip": false}
ตอบเป็น JSON อย่างเดียว`;

// ── ดึง JSON ก้อนแรกจาก text ที่โมเดลตอบ (กัน markdown fence / ข้อความห่อ) ──
function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

function normAmount(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function ollamaVision(imageBuffer, { model = OCR_MODEL, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/chat', OLLAMA_HOST);
    const payload = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: USER_PROMPT, images: [imageBuffer.toString('base64')] },
      ],
      stream: false,
      options: { temperature: 0 },
    });
    const req = http.request({
      hostname: url.hostname, port: url.port || 11434, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          if (j.error) return reject(new Error('Ollama: ' + j.error));
          resolve(j.message?.content || j.response || '');
        } catch { reject(new Error('Ollama parse error: ' + buf.slice(0, 200))); }
      });
    });
    req.on('error', e => reject(new Error('Ollama connection: ' + e.message)));
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error(`Ollama OCR timeout (${timeoutMs}ms)`)); });
    req.write(payload); req.end();
  });
}

/**
 * readSlip — engine-agnostic entry
 * @param {Buffer} imageBuffer
 * @param {{engine?:string, model?:string}} opts
 */
async function readSlip(imageBuffer, opts = {}) {
  const engine = opts.engine || 'ollama';
  if (engine !== 'ollama') throw new Error(`slip-ocr: engine '${engine}' ยังไม่รองรับ (มีแต่ ollama)`);

  const raw = await ollamaVision(imageBuffer, opts);
  const parsed = extractJson(raw) || {};
  const isSlip = parsed.is_slip === true || (parsed.is_slip == null && normAmount(parsed.amount) != null);

  return {
    is_slip: isSlip,
    amount: normAmount(parsed.amount),
    slip_datetime: parsed.slip_datetime || null,
    bank_from: parsed.bank_from || null,
    bank_to: parsed.bank_to || null,
    account_to: parsed.account_to || null,
    ref_no: parsed.ref_no ? String(parsed.ref_no).trim() : null,
    raw: raw.slice(0, 2000),
  };
}

module.exports = { readSlip, extractJson, normAmount };
