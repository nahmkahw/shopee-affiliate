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
// ย่อรูปก่อน OCR เฉพาะรูปยักษ์ (กัน timeout/ช้า) — ตั้งสูงพอให้สลิปปกติ (~1080-1290px) ไม่ถูกย่อ
// (ย่อต่ำเกินทำข้อความไทยเล็กๆ เพี้ยน — เช่น 1000px อ่านชื่อผู้รับผิด). latency หลักคือ cold-start ไม่ใช่ขนาดรูป
const OCR_MAXW    = parseInt(process.env.MAYOM_OCR_MAXW || '1600', 10);

const SYSTEM_PROMPT =
  'You extract structured data from Thai bank transfer slips (สลิปโอนเงิน). ' +
  'Reply with ONLY a JSON object, no markdown, no explanation.';

const USER_PROMPT = `ดูรูปนี้ ถ้าเป็นสลิปโอนเงิน/ใบเสร็จการโอนของธนาคารไทย ให้ดึงข้อมูลเป็น JSON:
{
  "is_slip": true/false,
  "amount_text": "จำนวนเงินตามที่พิมพ์บนสลิปเป๊ะๆ รวมจุดทศนิยมและ comma เช่น 86.00 หรือ 10,930.00 — ห้ามตัดจุดทศนิยม ห้ามรวม .00 เป็นหลักหน่วย (เห็น \"86.00\" ตอบ \"86.00\" ไม่ใช่ \"8600\") — ถ้าอ่านไม่ได้ใส่ null",
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

// ── ปี พ.ศ. → ค.ศ. (สลิปไทยมักเป็น พ.ศ.) — ถ้าปี >= 2500 ลบ 543 ──
function normDatetime(v) {
  if (!v) return null;
  return String(v).replace(/\b(2[5-9]\d{2})\b/, y => String(parseInt(y, 10) - 543));
}

/**
 * downscaleForOcr — ย่อรูปให้กว้างไม่เกิน maxW ก่อนส่งเข้า vision model (เร็วขึ้นมาก)
 * ถ้าย่อ/decode ไม่ได้ (เช่นไฟล์แปลก) → คืน buffer เดิม (ไม่ให้ pipeline ล้ม)
 */
async function downscaleForOcr(buffer, maxW = OCR_MAXW) {
  if (maxW <= 0) return buffer;
  try {
    const { loadImage, createCanvas } = require('@napi-rs/canvas');
    const img = await loadImage(buffer);
    if (img.width <= maxW) return buffer;                 // เล็กอยู่แล้ว ไม่ต้องย่อ
    const scale = maxW / img.width;
    const w = maxW, h = Math.round(img.height * scale);
    const canvas = createCanvas(w, h);
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return canvas.toBuffer('image/jpeg', 90);             // napi-rs quality = 0..100
  } catch { return buffer; }
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

  const small = await downscaleForOcr(imageBuffer, opts.maxW);
  const raw = await ollamaVision(small, opts);
  const parsed = extractJson(raw) || {};
  // amount_text = string ตามที่พิมพ์ (คงจุดทศนิยม กัน 86.00 → 8600); fallback parsed.amount เผื่อ prompt เก่า
  const amount = normAmount(parsed.amount_text != null ? parsed.amount_text : parsed.amount);
  const isSlip = parsed.is_slip === true || (parsed.is_slip == null && amount != null);

  return {
    is_slip: isSlip,
    amount,
    slip_datetime: normDatetime(parsed.slip_datetime),
    bank_from: parsed.bank_from || null,
    bank_to: parsed.bank_to || null,
    account_to: parsed.account_to || null,
    ref_no: parsed.ref_no ? String(parsed.ref_no).trim() : null,
    raw: raw.slice(0, 2000),
  };
}

module.exports = { readSlip, extractJson, normAmount, normDatetime, downscaleForOcr };
