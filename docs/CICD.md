# CI/CD ภายในองค์กร — คู่มือ + Setup

ระบบ CI/CD สำหรับ shopee-affiliate: GitHub Actions (เครื่องยนต์) + Discord (dev ops) + Google Sheets/Calendar (worklog + log) + Telegram (content ops, แยกส่วน)

## สถาปัตยกรรม

| ส่วน | ที่รัน | trigger | ไฟล์ |
|------|--------|---------|------|
| **CI gate** | GitHub-hosted (cloud) | ทุก PR → master | `.github/workflows/ci.yml` |
| **Worklog** | GitHub-hosted (cloud) | PR merge → master | `.github/workflows/worklog.yml` |
| **CD deploy** | self-hosted (เครื่อง Windows) | ปุ่มกด (workflow_dispatch) | `.github/workflows/deploy.yml` *(Phase 3)* |

- CI = `test` (jest) + `gitleaks` + `pr-title-lint` (เตือน) + `notify-failure` (Discord alert). branch protection: `test`+`gitleaks` ต้องเขียว, admin override ได้
- Discord = ห้องเครื่อง CI/CD (build fail, PR merged, deploy). **Telegram = content ops คงเดิม แยกกัน**
- ทุก lib อยู่ `lib/ci/*` (thin, DI ผ่าน params, no-op ถ้าไม่มี secret)

## Secrets ที่ต้องตั้ง

| secret | ใช้ที่ | ได้มาจาก |
|--------|--------|----------|
| `DISCORD_WEBHOOK_URL` | ci.yml, worklog.yml | Discord channel webhook |
| `GCP_SA_KEY` | worklog.yml | Google service-account JSON (ทั้งไฟล์) |
| `GOOGLE_SHEET_ID` | worklog.yml | id ใน URL ของ Sheet |
| `GOOGLE_CALENDAR_ID` | Phase 3/4 | Calendar settings |

> ทุก workflow **no-op เงียบๆ** ถ้า secret ยังว่าง — ตั้งเมื่อไรก็เริ่มทำงานเมื่อนั้น ไม่พังก่อน

### ตั้ง secret ยังไง — 2 วิธี

**วิธี A — `gh` CLI (แนะนำ 🔒 ค่าไม่ผ่าน clipboard/หน้าจอ)**
```powershell
gh secret set DISCORD_WEBHOOK_URL          # prompt ให้วางค่า
gh secret set GOOGLE_SHEET_ID              # prompt ให้วางค่า
gh secret set GCP_SA_KEY < "C:\path\to\service-account.json"   # อ่านจากไฟล์ตรงๆ

gh secret list                             # ตรวจว่าครบ
```

**วิธี B — หน้าเว็บ**
ลิงก์ตรง: `https://github.com/<owner>/<repo>/settings/secrets/actions`

> **หาเมนูไม่เจอ?** มันไม่ได้อยู่ระดับบนสุด — ต้องเข้า **repo → แท็บ Settings** (ไม่ใช่ Settings ของบัญชี) แล้วเลื่อนแถบซ้ายลงไปที่หัวข้อ **Security** → **Secrets and variables** → กางออก → **Actions**

⚠️ **ห้ามวางค่า secret ลงใน chat / commit / issue** — repo นี้เป็น public

---

## Setup 1 — Discord (สร้าง server ใหม่ + webhook)

1. Discord → **＋ (Add a Server)** → *Create My Own* (ฟรี) — เช่น `shopee-affiliate-dev`
2. สร้าง text channel เช่น `#ci-cd`
3. สร้าง Webhook:
   - คลิกเฟือง ⚙️ ข้างชื่อ channel `#ci-cd` → **Integrations** → **Webhooks** → **New Webhook**
   - ตั้งชื่อ (เช่น `CI Bot`) → **Copy Webhook URL** (หน้าตา `https://discord.com/api/webhooks/…/…`)
4. เพิ่มเป็น GitHub Secret `DISCORD_WEBHOOK_URL`
5. ทดสอบ: `DISCORD_WEBHOOK_URL=... node lib/ci/discord-notify.js "hello"`

## Setup 2 — Google Service Account (ได้ไฟล์ JSON)

**ทำไมต้องใช้ service account:** worklog รันบน GitHub runner (ไม่มีคนนั่งกดยินยอม) → ต้องเป็น auth แบบ server-to-server ไม่ใช่ OAuth

### 2.1 สร้าง project + เปิด API
1. https://console.cloud.google.com → สร้าง project (เช่น `shopee-affiliate-ci`)
2. เปิด **Google Sheets API**: https://console.cloud.google.com/apis/library/sheets.googleapis.com → **ENABLE**
   (เผื่อ Phase 4 เปิด **Google Calendar API** ด้วย)

### 2.2 สร้าง service account
ไปที่ https://console.cloud.google.com/iam-admin/serviceaccounts (เช็คว่าเลือก **project ถูกตัว** ที่แถบบน)

1. **+ CREATE SERVICE ACCOUNT** → ใส่ชื่อ → **CREATE AND CONTINUE**
2. ขั้น *"Grant this service account access to project"* → **ข้าม (CONTINUE)**
   — Sheets ไม่ได้ใช้สิทธิ์ระดับ project แต่ใช้การ **share Sheet ให้อีเมล SA** (ขั้น 3.2)
3. ขั้น *"Grant users access"* → **ข้าม** → **DONE**

### 2.3 สร้าง key JSON ⚠️ จุดที่คนหาไม่เจอบ่อยสุด
**ปุ่ม Create key ไม่ได้อยู่ในหน้า wizard ตอนสร้าง** — ต้องสร้าง SA ให้เสร็จก่อน แล้วเข้าไปทีหลัง:

1. กลับมาที่ลิสต์ service accounts → **คลิกที่อีเมลของ SA** (แถวนั้น) เพื่อเข้าหน้ารายละเอียด
2. ไปแท็บ **KEYS** (อยู่บนสุด ข้างๆ DETAILS / PERMISSIONS)
3. **ADD KEY** → **Create new key** → เลือก **JSON** → **CREATE**
4. เบราว์เซอร์ดาวน์โหลดไฟล์ `.json` ทันที (ชื่อประมาณ `myproject-a1b2c3d4.json`)
   — **ดาวน์โหลดได้ครั้งเดียว** เก็บให้ดี (สร้างใหม่ได้ถ้าหาย)
5. `gh secret set GCP_SA_KEY < "C:\path\to\myproject-a1b2c3d4.json"`

> **ADD KEY กดไม่ได้ / ขึ้น "Key creation is not allowed"?**
> เป็น org policy `iam.disableServiceAccountKeyCreation` บล็อก (เจอบ่อยถ้าบัญชีอยู่ใต้ Google Workspace ขององค์กร)
> แก้: ใช้ **บัญชี Gmail ส่วนตัว** สร้าง project ใหม่ (ปกติไม่มี policy นี้) หรือให้ admin ปลดที่ IAM & Admin → Organization Policies

---

## Setup 3 — Google Sheet

### 3.1 สร้าง Sheet เปล่า
https://sheets.new → ได้ไฟล์ใหม่ทันที → ตั้งชื่อ เช่น `Worklog CI/CD`

**ไม่ต้องสร้าง tab หรือหัวตารางเอง** (ดูขั้น 3.4)

### 3.2 Share ให้ service account ← ลืมข้อนี้บ่อยสุด
1. เปิดไฟล์ JSON ที่ดาวน์โหลดมา หาบรรทัด `"client_email"` — จะลงท้ายด้วย `…iam.gserviceaccount.com`
2. ใน Sheet กด **Share** → วางอีเมลนั้น → สิทธิ์ **Editor** → Send

> ลืมข้อนี้ → worklog จะ error `403 The caller does not have permission`

### 3.3 หา `GOOGLE_SHEET_ID`
ID ฝังอยู่ใน URL ตอนเปิด Sheet — เอาส่วนที่อยู่ **ระหว่าง `/d/` กับ `/edit`**

```
https://docs.google.com/spreadsheets/d/1a2B3cD4eF5gH6iJ7kL8mN9oP0qR/edit#gid=0
                                       └──────────────────────────┘
                                            GOOGLE_SHEET_ID
```

| | |
|---|---|
| ✅ ถูก | `1a2B3cD4eF5gH6iJ7kL8mN9oP0qR` |
| ❌ ผิด | URL ทั้งเส้น |
| ❌ ผิด | เอา `gid=0` มาด้วย (นั่นคือ id ของ *tab* ไม่ใช่ของ *ไฟล์*) |

```powershell
gh secret set GOOGLE_SHEET_ID    # วางค่าตอน prompt
```

### 3.4 ทำไมไม่ต้องสร้าง tab เอง
[`lib/ci/gsheet-worklog.js`](../lib/ci/gsheet-worklog.js) มีฟังก์ชัน `ensureTab()` ที่รันทุกครั้งก่อนเขียน:

1. **ไม่เจอ tab** → สร้างให้ (`addSheet`)
2. **แถวแรกว่าง** → เขียนหัวตารางให้

| ครั้งแรกที่ worklog รัน | ระบบทำ |
|---|---|
| ไม่มี tab `PRs` | สร้าง + ใส่หัว 13 คอลัมน์ |
| ไม่มี tab `Daily` | สร้าง + ใส่หัว 9 คอลัมน์ |
| จากนั้น | append 1 แถวลง `PRs` + upsert แถววันนั้นใน `Daily` |

ครั้งต่อๆ ไป `ensureTab` เห็นว่ามีครบแล้ว → ข้าม ไม่เขียนทับ (**idempotent**)

> tab เริ่มต้นชื่อ `Sheet1` / `ชีต1` ที่ Google แถมมา — **ปล่อยทิ้งไว้ได้** ระบบไม่ยุ่ง จะลบทีหลังก็ได้
> **อย่าเปลี่ยนชื่อมันเป็น `PRs` เอง** เพราะหัวตารางจะไม่ตรงกับที่โค้ดคาดหวัง

### โครงสร้าง Sheet ที่ระบบสร้าง
- **tab `PRs`** (1 แถว/PR): `merge_date · pr · title · author · category · agent · commits · files · additions · deletions · ci_status · deploy_status · url`
- **tab `Daily`** (1 แถว/วัน, upsert): `date · prs · commits · additions · deletions · feat · fix · perf · other`

---

## Setup 4 — Self-hosted runner (สำหรับ CD เท่านั้น)

**ทำไมต้อง self-hosted:** GitHub-hosted runner เป็น VM บน cloud เข้าถึง `localhost:3002`, ComfyUI, GPU, `.env` บนเครื่องคุณไม่ได้ → deploy จริงไม่ได้

**ปลอดภัยไหม:** `deploy.yml` trigger ด้วย `workflow_dispatch` (ปุ่มกด) **เท่านั้น** — PR จากภายนอกรันโค้ดบนเครื่องคุณไม่ได้ (นี่คือเหตุผลที่ CI แยกไปอยู่ cloud)

1. ไป `https://github.com/<owner>/<repo>/settings/actions/runners` → **New self-hosted runner** → **Windows**
2. ทำตามคำสั่งที่หน้านั้นให้ (download → `config.cmd` → ใส่ token)
3. **ไม่ต้องเพิ่ม label เอง** — runner ได้ `self-hosted`, `Windows`, `X64` อัตโนมัติ ซึ่งตรงกับ `runs-on: [self-hosted, Windows]` แล้ว
4. รันเป็น service (ค้างไว้): `.\svc.cmd install` แล้ว `.\svc.cmd start`
5. เช็คว่าขึ้น: `gh api repos/<owner>/<repo>/actions/runners --jq '.runners[] | {name,status}'` → ต้องเห็น `"status":"online"`

### ตั้ง `DEPLOY_PATH` (repo **variable** ไม่ใช่ secret)
บอก deploy ว่า repo จริงที่ agent รันอยู่ที่ไหน (คนละที่กับ workspace ของ runner)

```powershell
gh variable set DEPLOY_PATH --body "C:\Users\lenovo3\agent\shopee-affiliate"
gh variable list
```

## Setup 5 — Google Calendar (deploy log, ไม่บังคับ)

1. เปิด **Google Calendar API**: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com → ENABLE
2. Google Calendar → เลือกปฏิทิน → **Settings and sharing** → **Share with specific people** → เพิ่มอีเมล SA (`…iam.gserviceaccount.com`) → สิทธิ์ **Make changes to events**
3. หน้าเดียวกัน เลื่อนลงหา **Calendar ID** (เช่น `abc123@group.calendar.google.com`)
4. `gh secret set GOOGLE_CALENDAR_ID`

> ไม่ตั้งก็ได้ — `gcal-log.js` no-op เงียบๆ, deploy ยังทำงานปกติ (แค่ไม่มี event บันทึก)

---

## วิธี Deploy

**Actions → Deploy → Run workflow** → เลือก branch (default `master`) → **Run**

### 8 สเต็ปที่เกิดขึ้น
| # | สเต็ป | ล้มเหลวแล้วยังไง |
|---|------|------------------|
| 1 | pre-check (branch guard, fetch, หา conflict) | `DEPLOY_PATH` ไม่ได้อยู่ branch เป้าหมาย → หยุด · ไฟล์แก้ค้าง**ชนกับ** upstream → หยุด + แจ้ง Discord |
| 2 | GPU guard — **รอจน ComfyUI ว่าง** | เกิน 15 นาที → ยกเลิก ให้กดใหม่ทีหลัง |
| 3 | backup state (`agent-status.json`, `mayom/index.json`, `users.json`) → `backups/` | — |
| 4 | `git pull --ff-only` | git error → หยุด |
| 5 | `npm ci` (เฉพาะตอน `package-lock.json` เปลี่ยน) | — |
| 6 | restart `start-all-agents.bat` (detached, idempotent) | — |
| 7 | health check `GET /healthz` | พัง → **restart ซ้ำ 1 ครั้ง** → ยังพัง = แจ้ง Discord, **ไม่แตะ git** |
| 8 | report → Discord + Calendar event 🚀 | — |

> **สเต็ป 1 ไม่ได้ abort เพราะ "tree ไม่สะอาด"** — repo จริงแทบไม่เคยสะอาด เพราะ agent เขียนทับไฟล์ tracked ตอน runtime (`_tg_queue.json`, `input.txt`, `telegram-bot.pid`) จึง abort เฉพาะเมื่อไฟล์ที่แก้ค้าง **ชนกับ** ไฟล์ที่ upstream เปลี่ยนจริงๆ

> **ไม่มี auto-rollback โดยตั้งใจ** — `git reset --hard` อัตโนมัติบนเครื่องที่มี state ไฟล์สด (สลิปเงิน ฯลฯ) อันตรายกว่าปล่อย down ชั่วคราว. deploy กดเอง = คุณอยู่หน้าเครื่อง เข้าไปแก้ได้ทันที

---

## Checklist

- [ ] Discord server + channel `#ci-cd` + webhook → `gh secret set DISCORD_WEBHOOK_URL`
- [ ] Google project + **เปิด Sheets API**
- [ ] Service account → แท็บ **KEYS** → ADD KEY → JSON → `gh secret set GCP_SA_KEY < file.json`
- [ ] Sheet เปล่า + **Share ให้ `client_email` สิทธิ์ Editor**
- [ ] `gh secret set GOOGLE_SHEET_ID` (ค่าระหว่าง `/d/` กับ `/edit`)
- [ ] `gh secret list` → เห็นครบ 3 ตัว
- [ ] *(CD)* self-hosted runner ติดตั้ง + label `windows` + สถานะ Idle
- [ ] *(CD)* `gh variable set DEPLOY_PATH --body "C:\...\shopee-affiliate"`
- [ ] *(ไม่บังคับ)* Calendar API + share ให้ SA + `gh secret set GOOGLE_CALENDAR_ID`

## ทดสอบ end-to-end
เปิด PR ทดสอบ → merge → ดู: (1) Discord `#ci-cd` ขึ้นข้อความ merged, (2) Sheet มีแถวใหม่ทั้ง 2 tab

## Troubleshooting

| อาการ | สาเหตุ / แก้ |
|-------|-------------|
| workflow เขียวแต่ Sheet ว่าง + log ว่า `no-op` | secret ยังไม่ได้ตั้ง — `gh secret list` เช็ค |
| `403 The caller does not have permission` | ลืม Share Sheet ให้ `client_email` ของ SA (ขั้น 3.2) |
| `Google Sheets API has not been used in project…` | ยังไม่เปิด Sheets API (ขั้น 2.1) |
| `error:0909006C:PEM routines` / `invalid_grant` | `GCP_SA_KEY` เพี้ยน — ตั้งใหม่ด้วย `gh secret set GCP_SA_KEY < file.json` (อย่า copy-paste ทีละบรรทัด) |
| `Requested entity was not found` | `GOOGLE_SHEET_ID` ผิด (เอา URL ทั้งเส้นมา / เอา `gid` มาด้วย) |
| Discord ไม่เด้ง แต่ workflow เขียว | `DISCORD_WEBHOOK_URL` ว่าง → no-op เงียบ (ตั้งใจ) |
| deploy: `No runner matching the labels` | runner ไม่ได้รัน — เช็ค `gh api repos/<owner>/<repo>/actions/runners` ว่า `status: online` |
| deploy: `pwsh: command not found` | workflow ต้องใช้ `shell: powershell` (Windows PowerShell 5.1 ที่มีมากับ Windows) ไม่ใช่ `pwsh` (PowerShell 7 ที่ไม่ได้ติดตั้ง) |
| deploy: `ยังไม่ได้ตั้ง repo variable DEPLOY_PATH` | `gh variable set DEPLOY_PATH --body "<path>"` |
| deploy: `DEPLOY_PATH อยู่ branch ... ไม่ใช่ master` | repo จริงถูก checkout ค้างที่ feature branch — `git -C "<DEPLOY_PATH>" checkout master` แล้วกดใหม่ |
| deploy: `ไฟล์แก้ค้างชนกับ upstream` | commit หรือ `git stash` ไฟล์นั้นบนเครื่อง prod แล้วกด Deploy ใหม่ |
| deploy: `GPU ไม่ว่างเกิน 15 นาที` | มีงาน ComfyUI ยาวค้างอยู่ — รอให้เสร็จแล้วกดใหม่ (`GPU_LOCK_FILE` ดูสถานะได้) |
| deploy: health ไม่ผ่าน 2 ครั้ง | agent-hub ไม่ขึ้น — git **ไม่ถูก rollback** เข้าไปดู log บนเครื่อง; state backup อยู่ใน `backups/deploy-<ts>/` |
