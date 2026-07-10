# CI/CD ภายในองค์กร — คู่มือ + Setup

ระบบ CI/CD สำหรับ shopee-affiliate: GitHub Actions (เครื่องยนต์) + Discord (dev ops) + Google Sheets/Calendar (worklog + log) + Telegram (content ops, แยกส่วน)

## สถาปัตยกรรม

| ส่วน | ที่รัน | trigger | ไฟล์ |
|------|--------|---------|------|
| **CI gate** | GitHub-hosted (cloud) | ทุก PR → master | `.github/workflows/ci.yml` |
| **Worklog** | GitHub-hosted (cloud) | PR merge → master | `.github/workflows/worklog.yml` |
| **CD deploy** | self-hosted (เครื่อง Windows) | ปุ่มกด (workflow_dispatch) | `.github/workflows/deploy.yml` *(Phase 3)* |

- CI = `test` (jest 441) + `gitleaks` + `pr-title-lint` (เตือน). branch protection: `test`+`gitleaks` ต้องเขียว, admin override ได้
- Discord = ห้องเครื่อง CI/CD (build fail, PR merged, deploy). **Telegram = content ops คงเดิม แยกกัน**
- ทุก lib อยู่ `lib/ci/*` (thin, DI ผ่าน params, no-op ถ้าไม่มี secret)

## Secrets ที่ต้องตั้ง (GitHub → Settings → Secrets and variables → Actions)

| secret | ใช้ที่ | ได้มาจาก |
|--------|--------|----------|
| `DISCORD_WEBHOOK_URL` | ci.yml, worklog.yml | Discord channel webhook |
| `GCP_SA_KEY` | worklog.yml | Google service-account JSON (ทั้งไฟล์) |
| `GOOGLE_SHEET_ID` | worklog.yml | id ใน URL ของ Sheet |
| `GOOGLE_CALENDAR_ID` | Phase 3/4 | Calendar settings |

> ทุก workflow **no-op เงียบๆ** ถ้า secret ยังว่าง — ตั้งเมื่อไรก็เริ่มทำงานเมื่อนั้น ไม่พังก่อน

---

## Setup 1 — Discord (สร้าง server ใหม่ + webhook)

1. Discord → **＋ (Add a Server)** → *Create My Own* (ฟรี) — เช่น `shopee-affiliate-dev`
2. สร้าง text channel เช่น `#ci-cd`
3. สร้าง Webhook:
   - คลิกเฟือง ⚙️ ข้างชื่อ channel `#ci-cd` → **Integrations** → **Webhooks** → **New Webhook**
   - ตั้งชื่อ (เช่น `CI Bot`) → **Copy Webhook URL** (หน้าตา `https://discord.com/api/webhooks/…/…`)
4. เพิ่มเป็น GitHub Secret `DISCORD_WEBHOOK_URL`
5. ทดสอบ: `DISCORD_WEBHOOK_URL=... node lib/ci/discord-notify.js "hello"`

## Setup 2 — Google Service Account + Sheet

1. https://console.cloud.google.com → สร้าง project (เช่น `shopee-affiliate-ci`)
2. **APIs & Services → Enable APIs** → เปิด **Google Sheets API** (+ **Google Calendar API** เผื่อ Phase 4)
3. **IAM & Admin → Service Accounts → Create** → ตั้งชื่อ → **Create key** → *JSON* → ดาวน์โหลด
4. copy เนื้อ JSON ทั้งไฟล์ → GitHub Secret `GCP_SA_KEY`
5. สร้าง Google Sheet ใหม่ (เปล่าๆ) → **Share** ให้ email ของ service account (ลงท้าย `…iam.gserviceaccount.com`) สิทธิ์ **Editor**
6. copy `GOOGLE_SHEET_ID` จาก URL: `docs.google.com/spreadsheets/d/<ID>/edit`
7. tab `PRs` + `Daily` **ไม่ต้องสร้างเอง** — `gsheet-worklog.js` สร้าง + ใส่ header ให้อัตโนมัติครั้งแรก

### โครงสร้าง Sheet ที่ระบบสร้าง
- **tab `PRs`** (1 แถว/PR): `merge_date · pr · title · author · category · agent · commits · files · additions · deletions · ci_status · deploy_status · url`
- **tab `Daily`** (1 แถว/วัน, upsert): `date · prs · commits · additions · deletions · feat · fix · perf · other`

---

## ทดสอบ end-to-end
เปิด PR ทดสอบ → merge → ดู: (1) Discord `#ci-cd` ขึ้นข้อความ merged, (2) Sheet มีแถวใหม่ทั้ง 2 tab
