'use strict';
/**
 * gsheet-worklog.js — เขียน worklog ลง Google Sheet ผ่าน service account
 *
 * 2 tab: "PRs" (per-PR, append) + "Daily" (rollup รายวัน, upsert ตาม date)
 * No-op เงียบๆ ถ้าไม่มี GCP_SA_KEY / GOOGLE_SHEET_ID (workflow ไม่พังก่อนตั้งค่า)
 *
 * env: GCP_SA_KEY = service-account JSON (string), GOOGLE_SHEET_ID = spreadsheet id
 */

const { PR_HEADER, DAILY_HEADER, prRow, dailyRow } = require('./worklog-parse');

const PR_TAB = 'PRs';
const DAILY_TAB = 'Daily';

async function getSheets(credsJson) {
  const { google } = require('googleapis');
  const creds = typeof credsJson === 'string' ? JSON.parse(credsJson) : credsJson;
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

/** สร้าง tab ถ้ายังไม่มี + ใส่ header ถ้าแถวแรกว่าง */
async function ensureTab(sheets, sheetId, tab, header) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const exists = meta.data.sheets.some(s => s.properties.title === tab);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
    });
  }
  const first = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: `${tab}!A1:1`,
  });
  if (!first.data.values || first.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId, range: `${tab}!A1`,
      valueInputOption: 'RAW', requestBody: { values: [header] },
    });
  }
}

async function appendRow(sheets, sheetId, tab, row) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId, range: `${tab}!A1`,
    valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

/** อ่านทุกแถว per-PR (ข้าม header) */
async function readPrRows(sheets, sheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: `${PR_TAB}!A2:M`,
  });
  return res.data.values || [];
}

/** upsert แถว daily ตาม date (col A) */
async function upsertDaily(sheets, sheetId, date, rows) {
  const daily = dailyRow(date, rows);
  const cur = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: `${DAILY_TAB}!A2:A`,
  });
  const dates = (cur.data.values || []).map(r => r[0]);
  const idx = dates.indexOf(date);
  if (idx === -1) {
    await appendRow(sheets, sheetId, DAILY_TAB, daily);
  } else {
    const rowNum = idx + 2; // +2: ข้าม header + 0-index
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId, range: `${DAILY_TAB}!A${rowNum}`,
      valueInputOption: 'RAW', requestBody: { values: [daily] },
    });
  }
}

/**
 * บันทึก 1 PR ที่เพิ่ง merge ลง Sheet (append PRs + upsert Daily)
 * @returns {skipped:true} ถ้ายังไม่ตั้งค่า creds/sheetId
 */
async function appendWorklog(pr, {
  credsJson = process.env.GCP_SA_KEY,
  sheetId = process.env.GOOGLE_SHEET_ID,
} = {}) {
  if (!credsJson || !sheetId) {
    console.log('[worklog] GCP_SA_KEY / GOOGLE_SHEET_ID ว่าง — ข้าม (no-op)');
    return { skipped: true };
  }
  const sheets = await getSheets(credsJson);
  await ensureTab(sheets, sheetId, PR_TAB, PR_HEADER);
  await ensureTab(sheets, sheetId, DAILY_TAB, DAILY_HEADER);

  const row = prRow(pr);
  await appendRow(sheets, sheetId, PR_TAB, row);

  const rows = await readPrRows(sheets, sheetId);
  await upsertDaily(sheets, sheetId, pr.mergedDate, rows);
  return { ok: true, category: row[4], agent: row[5] };
}

module.exports = { appendWorklog, PR_TAB, DAILY_TAB };
