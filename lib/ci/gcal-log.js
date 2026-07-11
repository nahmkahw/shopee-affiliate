'use strict';
/**
 * gcal-log.js — บันทึก deploy ลง Google Calendar เป็น timeline ย้อนดูได้ (สเต็ป 8)
 *
 * ใช้ service account ตัวเดียวกับ Sheets (GCP_SA_KEY)
 * ⚠️ ต้อง share Calendar ให้อีเมล SA สิทธิ์ "Make changes to events" ก่อน
 * No-op เงียบๆ ถ้าไม่มี GCP_SA_KEY / GOOGLE_CALENDAR_ID
 */

async function getCalendar(credsJson) {
  const { google } = require('googleapis');
  const creds = typeof credsJson === 'string' ? JSON.parse(credsJson) : credsJson;
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar.events'],
  });
  await auth.authorize();
  return google.calendar({ version: 'v3', auth });
}

/**
 * สร้าง event "🚀 Deploy <sha>" (ช่วงเวลาสั้นๆ ณ ตอน deploy)
 * @param {{sha:string, ok:boolean, summary?:string, details?:string, durationMin?:number}} deploy
 */
async function logDeploy(deploy, {
  credsJson = process.env.GCP_SA_KEY,
  calendarId = process.env.GOOGLE_CALENDAR_ID,
} = {}) {
  if (!credsJson || !calendarId) {
    console.log('[gcal] GCP_SA_KEY / GOOGLE_CALENDAR_ID ว่าง — ข้าม (no-op)');
    return { skipped: true };
  }
  const cal = await getCalendar(credsJson);
  const start = new Date();
  const end = new Date(start.getTime() + (deploy.durationMin || 5) * 60000);
  const icon = deploy.ok ? '🚀' : '❌';
  const short = String(deploy.sha || '').slice(0, 7);

  const res = await cal.events.insert({
    calendarId,
    requestBody: {
      summary: `${icon} Deploy ${short}${deploy.ok ? '' : ' (ล้มเหลว)'}`,
      description: [deploy.summary, deploy.details].filter(Boolean).join('\n\n'),
      start: { dateTime: start.toISOString(), timeZone: 'Asia/Bangkok' },
      end: { dateTime: end.toISOString(), timeZone: 'Asia/Bangkok' },
    },
  });
  return { ok: true, eventId: res.data.id, htmlLink: res.data.htmlLink };
}

/**
 * สร้าง all-day event บนวันที่กำหนด (ใช้เตือน maintenance เช่น token หมดอายุ — Phase 4)
 * @param {{summary:string, description?:string, date:string}} ev  date = 'YYYY-MM-DD'
 */
async function createAllDayEvent(ev, {
  credsJson = process.env.GCP_SA_KEY,
  calendarId = process.env.GOOGLE_CALENDAR_ID,
} = {}) {
  if (!credsJson || !calendarId) {
    console.log('[gcal] GCP_SA_KEY / GOOGLE_CALENDAR_ID ว่าง — ข้าม (no-op)');
    return { skipped: true };
  }
  const cal = await getCalendar(credsJson);
  // all-day event: end.date = วันถัดไป (exclusive ตาม Google Calendar API)
  const next = new Date(`${ev.date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const endDate = next.toISOString().slice(0, 10);

  const res = await cal.events.insert({
    calendarId,
    requestBody: {
      summary: ev.summary,
      description: ev.description || '',
      start: { date: ev.date },
      end: { date: endDate },
    },
  });
  return { ok: true, eventId: res.data.id, htmlLink: res.data.htmlLink };
}

module.exports = { logDeploy, createAllDayEvent };
