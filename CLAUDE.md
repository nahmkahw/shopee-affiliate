# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## PR Workflow

ทุกครั้งที่เพิ่มฟีเจอร์ใหม่หรือแก้ไขโค้ดนัยสำคัญ ให้ทำตามขั้นตอนนี้:

1. **สร้าง branch + Draft PR ก่อนเขียนโค้ด** — ระบุ description ว่าจะทำอะไรและทำไม
2. **อัปเดต CLAUDE.md ใน PR เดียวกัน** — เพิ่ม 1 bullet สรุปสิ่งที่เปลี่ยนแปลง (Architecture, Behavior, หรือ Rule ที่เกี่ยวข้อง)
3. เขียนโค้ด → commit → mark PR ready for review

> งานเล็ก (bug fix, แก้ config) ไม่ต้องทำ Draft PR ก่อนได้ แต่ยังต้องอัปเดต CLAUDE.md ถ้ามีผลต่อ architecture หรือ behavior

---

## Code Rules

**Invariants — ห้ามละเมิด:**
- ห้าม `require('../agent-hub.js')` หรือ `require('./agent-hub.js')` โดยตรง — entry point คือ `agent-hub/index.js` เท่านั้น
- เวลาต่ออายุ `FB_ACCESS_TOKEN` ต้องอัปเดต **2 ไฟล์**: `.env` (root) + `agents/manao/pipeline/.env`
- ห้าม commit `.env` ไม่ว่ากรณีใด

**Test gotchas:**
- ห้ามใช้ `jest.resetModules()` ใน `beforeEach` — ทำให้ mock ของ `child_process`/`fs` หลุดออกจาก module ที่โหลดแล้ว, crash แบบ silent ที่ไม่มี stack trace ชัดเจน
- `require` module ที่ต้องการ mock ที่ **top-level** ของ test file ครั้งเดียว, ใช้ `jest.clearAllMocks()` ใน `beforeEach` แทน

**Ripple effects — เวลาแก้ไฟล์เหล่านี้ ต้องอัปเดตที่อื่นด้วย:**
- `agent-hub/agents.js` — export ใหม่ต้องเพิ่มใน `agent-hub/index.js` ด้วย
- `agent-status.json` schema — กระทบ `agents/*/run.js` ทุกตัวที่ `readStatus`/`writeStatus`
- `.env` keys ใหม่ — ต้องเพิ่มใน `CLAUDE.md` section Environment และ `agents/manao/pipeline/.env`
- `agent-hub/routes/manao/` หรือ `namkhao/` — sub-handler ใหม่ต้อง import และ dispatch ใน `manao.js` / `namkhao.js` ด้วย

---

## File Size Constraint

**Hard limit: 300 บรรทัดต่อไฟล์** (test files: 500 บรรทัด)

- ก่อนสร้างไฟล์ใหม่ ให้ประเมินว่าจะเกิน 300 บรรทัดไหม — ถ้าใช่ ให้แจ้งและเสนอแผน split ก่อน
- ถ้าแก้ไขไฟล์ที่มีอยู่แล้วแล้วจะทำให้เกิน 300 บรรทัด ให้แจ้ง user ก่อนดำเนินการ
- **ยกเว้น:** ไฟล์ HTML template ล้วน ๆ (`html/*.js`) ที่ไม่มี business logic สามารถเกินได้
- ไฟล์ที่เกินอยู่แล้ว (legacy) ให้ refactor เมื่อถึงเวลาแก้ไขตามธรรมชาติ ไม่ต้อง refactor ทันที

---

## Role

Content creator assistant for Shopee Affiliate marketing — ตั้งแต่ดึงข้อมูลสินค้า สร้าง content ไปจนถึงโพสต์ขึ้น Social Media อัตโนมัติ

---

## Skills (Slash Commands)

| คำสั่ง | หน้าที่ |
|--------|---------|
| `/ดึงสินค้า-อัตโนมัติ` | เข้า affiliate portal → คลิก "เอาลิงค์" ทุกสินค้า → บันทึก affiliate link ลง `input/urls.txt` |
| `/ดึงสินค้า` | ตรวจ Chrome → dry-run confirm → รัน `scrape.js` → บันทึก `data.json` + `images/` |
| `/สร้าง-content [YYYY-MM-DD หรือ item_id]` | สร้าง content จาก `data.json` → บันทึก `content/*.md` → อัปเดต `tracking.xlsx` |
| `/สร้างวิดีโอ [YYYY-MM-DD หรือ item_id]` | อ่าน `tiktok.md` → สร้างวิดีโอด้วย FFmpeg → บันทึก `video.mp4` (ถ้าไม่มี FFmpeg → สร้าง `capcut.md` แทน) |
| `/โพสต์ [YYYY-MM-DD หรือ item_id] [--platform fb,ig,x]` | โพสต์ content ไปยัง FB/IG/X ผ่าน API — TikTok แสดง caption ให้ copy เอง |

รายละเอียดแต่ละ skill อยู่ใน `.claude/commands/`
คู่มือฉบับเต็ม (วิธีเปิด Chrome, troubleshooting): `GUIDE.md`

---

## Architecture

```
shopee-affiliate/
├── scrape.js / scrape-offers.js  ← Playwright scrapers
├── post.js                ← โพสต์ FB / IG / X ผ่าน API
├── approval-bot.js        ← Telegram Bot: preview → Approve → โพสต์ FB
├── make-tiktok-video.js   ← TikTok video entry point → lib/tiktok-*
├── agent-hub/             ← Multi-agent control hub (port 3002)
│   ├── index.js           ← HTTP server — entry point
│   ├── agents.js          ← startAgent / stopAgent / spawnStep
│   ├── routes/            ← mali.js | manao.js+manao/ | namkhao.js+namkhao/ | anime.js | common.js
│   └── html/              ← dashboard HTML builders
├── lib/                   ← shared helpers ใช้ข้าม agents
│   ├── namkhao-bot-news.js      ← approval callbacks (ใช้ทั้ง manao + makrut)
│   ├── namkhao-bot-scheduler.js ← schedule loop + trigger logic
│   └── tiktok-*.js / telegram.js / fb-post.js / approval-flow.js / …
├── agents/
│   ├── mali/run.js        ← Agent มะลิ (Shopee Affiliate)
│   ├── manao/pipeline/    ← Agent มะนาว — generate.js → lib/ + agents/ + post.js
│   │                        post.js ใช้ PIPELINE_ROOT env รองรับหลาย pipeline
│   ├── makrut/pipeline/   ← Agent มะกรูด (FIFA World Cup) — ใช้ post.js ของ manao ร่วม
│   ├── namkhao/           ← Agent น้ำข้าว (Supervisor + Telegram bot + scheduler)
│   └── anime/             ← Anime image generator
├── input/urls.txt         ← รายการสินค้า (format: URL | affiliate_link | YYYY-MM-DD)
├── products/{item_id}/    ← ข้อมูล + content ต่อสินค้า
└── .env                   ← Credentials (ห้าม commit)
```

### Data Flow

**Shopee Affiliate:**
```
input/urls.txt
    → scrape.js (Playwright + Chrome debug port 9222)
    → products/{item_id}/data.json + images/
    → /สร้าง-content (Claude Code)
    → products/{item_id}/content/*.md
    → approval-bot.js (Telegram preview)
    → post.js (FB Graph API / IG carousel / X thread)
```

**AI News (manao / makrut):**
```
RSS/scrape → generate.js (Ollama Typhoon2) → news/{slug}/content/
    → formatter-agent.js → Telegram approval
    → [Approve] → lib/namkhao-bot-news.js → post.js --schedule --platform fb
```

### Agent Hub (port 3002)

`agent-hub/index.js` เป็น HTTP server ควบคุม sub-agents ผ่าน web UI:
- **Daily PR Scheduler** — ทุกเที่ยงคืน (Bangkok) รัน `daily-pr.js` อัตโนมัติ
- `/dashboard/mali` — Shopee Affiliate status
- `/dashboard/manao` — Reuters AI News pipeline
- `/dashboard/namkhao` — Supervisor + schedule status
- Spawn/kill node processes ผ่าน `child_process.spawn`
- อ่าน/เขียนสถานะกลางที่ `agent-status.json`
- แต่ละ route module export `register(req, res, url, rawUrl, method, deps)` — ไม่ใช้ Express
- route ที่ซับซ้อน (`manao`, `namkhao`) แยก sub-handler ไว้ใน sub-directory ชื่อเดียวกัน

### Agent มะลิ (`agents/mali/run.js`)

รับ `--action` flag: `status` | `scrape` | `create-content` | `approve-today`

**approval-bot.js พฤติกรรม:**
- ใช้ `MALI_TELEGRAM_BOT_TOKEN` (fallback → `TELEGRAM_BOT_TOKEN`)
- กด Approve → โพสต์ **FB เท่านั้น** แบบ `--schedule` (IG ข้าม เพราะ IG ไม่รองรับ schedule)
- FB Reels ใช้ Page Access Token (แลกจาก User Token ใน `agent-hub/index.js` อัตโนมัติ)

### Agent มะนาว (`agents/manao/pipeline/`)

Scheduler ใน namkhao bot ทริกเกอร์ที่ **07:00 และ 13:00 BKK**

**กรณีบทความค้าง (status = `pending_approval`):**
```powershell
cd agents\manao\pipeline
node -e "
const fs = require('fs');
const glob = require('glob');
glob.sync('news/*/data.json').forEach(f => {
  const d = JSON.parse(fs.readFileSync(f,'utf8'));
  if (d.status === 'pending_approval') { d.status = 'approved'; fs.writeFileSync(f, JSON.stringify(d,null,2)); console.log('fixed:', f); }
});
"
node post.js --pending --platform fb --schedule
```

**กรณี Telegram ไม่ส่ง approval (resend):**
```powershell
node agents\manao\pipeline\agents\formatter-agent.js --resend
# หรือผ่าน makrut:
node agents\makrut\pipeline\makrut.js --resend
```

> ⚠️ ห้ามรัน `start-all-agents.bat` ขณะบอทกำลัง Approve — จะ kill mid-execution

### Agent มะกรูด (`agents/makrut/`)

FIFA World Cup 2026 news pipeline — ทำงานเหมือน manao แต่ scrape จากแหล่งข่าว FIFA/กีฬา

Scheduler ใน namkhao bot ทริกเกอร์ที่ **06:00 และ 18:00 BKK**

- ใช้ `post.js` ของ manao pipeline ร่วมกัน (pass `PIPELINE_ROOT` env)
- `EXTRA_SCHEDULE_DIRS` — post.js ตรวจ pipeline ทั้งหมดก่อน schedule เพื่อหลีกเลี่ยงโพสต์ทับเวลา FB

---

## Node.js Scripts (Terminal)

```powershell
# Shopee Affiliate
node scrape.js                    # ดึงสินค้าที่ยังไม่มี data.json
node scrape.js --force            # ดึงใหม่ทั้งหมด
node scrape.js --dry-run          # แสดงรายการโดยไม่ดึงจริง
node approval-bot.js              # รัน Telegram Approval Bot (วันปัจจุบัน)
node approval-bot.js {item_id}    # ทดสอบกับสินค้าที่ระบุ
node post.js {date} --platform fb # โพสต์โดยตรงไม่ผ่าน Approve

# Dashboards
node dashboard.js                 # เปิด Dashboard ที่ http://localhost:3001
node agent-hub/index.js           # เปิด Agent Hub ที่ http://localhost:3002

# AI News
node agents/manao/pipeline/agents/formatter-agent.js --resend   # resend Telegram approval
node agents/makrut/pipeline/makrut.js --resend                  # resend makrut approval
```

---

## Input Format

`input/urls.txt` — หนึ่งสินค้าต่อบรรทัด **3 คอลัมน์คั่นด้วย `|`**:

```
https://shopee.co.th/product/{shop_id}/{item_id} | https://s.shopee.co.th/xxxxx | YYYY-MM-DD
```

- บรรทัดขึ้นต้นด้วย `#` = comment ข้ามได้
- `post_date` ถ้าไม่ใส่ = วันที่ดึงข้อมูล

---

## Chrome Debug Mode (จำเป็นสำหรับ scraping)

`scrape.js` เชื่อมต่อ Chrome ที่ **`localhost:9222`** — ต้องเปิด Chrome debug mode ก่อนรัน scrape ทุกครั้ง
วิธีเปิดและ troubleshoot: ดู `GUIDE.md`

**Error `ECONNREFUSED 127.0.0.1:9222`** = Chrome ยังไม่ได้เปิดในโหมด debug

---

## Environment (.env)

```env
FB_PAGE_ID=          # Facebook Page ID
FB_ACCESS_TOKEN=     # Long-lived token (60 วัน) — ต่ออายุผ่าน Graph API Explorer
IG_USER_ID=          # Instagram Business User ID
IG_ACCESS_TOKEN=     # token เดียวกับ FB ที่มี instagram_content_publish
IMGBB_API_KEY=       # สำหรับอัปโหลดรูป Instagram Carousel
X_API_KEY=
X_API_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_TOKEN_SECRET=
TELEGRAM_BOT_TOKEN=  # ต้องเป็นบอทใหม่ — ห้ามใช้บอทที่มี Webhook อยู่แล้ว
TELEGRAM_CHAT_ID=
# แยก bot token ต่อ agent (แนะนำ — ป้องกัน conflict)
MALI_TELEGRAM_BOT_TOKEN=    # approval-bot.js ใช้ก่อน TELEGRAM_BOT_TOKEN
MANAO_TELEGRAM_BOT_TOKEN=   # manao pipeline bot
NAMKHAO_TELEGRAM_BOT_TOKEN= # namkhao bot
# Ollama (AI News generation)
OLLAMA_HOST=http://10.3.17.118:11434
OLLAMA_MODEL=scb10x/llama3.1-typhoon2-8b-instruct:latest  # default — รองรับภาษาไทย
```

> ⚠️ **`agents/manao/pipeline/.env` เป็นไฟล์แยก** — `post.js` และ `telegram-bot.js` ของ manao โหลด dotenv จาก `__dirname` ด้วย `override: true`
> ทุกครั้งที่ต่ออายุ `FB_ACCESS_TOKEN` ต้องอัปเดต **ทั้ง 2 ไฟล์**:
> - `shopee-affiliate/.env`
> - `shopee-affiliate/agents/manao/pipeline/.env`

### ต่ออายุ FB Token (ทุก 60 วัน)

```powershell
# 1. ดึง short-lived token จาก https://developers.facebook.com/tools/explorer/
# 2. แปลงเป็น long-lived token:
node -e "
const https = require('https');
const APP_ID = 'APP_ID';
const APP_SECRET = 'APP_SECRET';
const SHORT = 'SHORT_LIVED_TOKEN';
const url = 'https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id='+APP_ID+'&client_secret='+APP_SECRET+'&fb_exchange_token='+SHORT;
https.get(url, r => { let b=''; r.on('data',d=>b+=d); r.on('end',()=>console.log(b)); });
"
# 3. อัปเดตทั้ง root .env และ agents/manao/pipeline/.env
```

---

## Output Structure

```
products/{item_id}/
├── data.json           ← ข้อมูลสินค้า + affiliate_short_link + post_date
├── images/1-6.jpg      ← รูปสินค้า (max 6, ต้อง >50KB สำหรับ IG)
└── content/
    ├── facebook.md
    ├── instagram.md
    ├── x.md
    └── tiktok.md       ← มี script table + caption

agents/{pipeline}/pipeline/news/{slug}/
├── data.json           ← ข้อมูลข่าว + status (draft/pending_approval/scheduled/posted)
└── content/
    ├── facebook.md
    └── master.md       ← (manao เท่านั้น)

tracking.xlsx           ← sort ตาม post_date | status: scraped → draft → posted
```

---

## Content Rules

**Tone:** ภาษาไทย เป็นกันเอง เน้น benefit ไม่ใช่ feature

| Platform | ความยาว | รูปแบบพิเศษ |
|----------|---------|------------|
| Facebook | 150–300 คำ | storytelling hook + affiliate link ท้าย |
| Instagram | 100–150 คำ | 15–20 hashtag แบ่ง 4 ชั้น, ไม่ใส่ link ในแคปชั่น |
| X | 3 ทวีต | ทวีตแรกไม่มีลิงก์, ทวีตสุดท้ายมีลิงก์ + `#Shopeeaffiliate` |
| TikTok | caption 50–80 คำ | script table: TIME \| VOICEOVER \| VISUAL \| ON-SCREEN |

**ข้อห้ามเด็ดขาด:**
- ห้ามแต่งข้อมูลที่ไม่อยู่ใน `data.json`
- ห้ามใช้ product URL — ใช้ `affiliate_short_link` เท่านั้น
- ห้าม generate หรือ guess affiliate link เอง
- ต้องมี `#Shopeeaffiliate` ทุก platform

**ต้องทำ:**
- บันทึก content ลง `products/{item_id}/content/` เสมอ
- แสดงสรุปให้ผู้ใช้ confirm ก่อนถือว่าเสร็จ
- อัปเดต `tracking.xlsx` (sort ตาม post_date) หลังสร้าง content ครบ

---

## Troubleshooting

| ปัญหา | แก้ไข |
|-------|-------|
| `ECONNREFUSED 9222` | เปิด Chrome debug mode ก่อน (ดูหัวข้อ Chrome Debug) |
| Shopee CAPTCHA | แก้ CAPTCHA ใน Chrome debug แล้วรัน `--force` ใหม่ |
| FB `Session has expired` | Token หมดอายุ — ต่ออายุผ่าน Graph API Explorer → อัปเดต **ทั้ง** root `.env` + `agents/manao/pipeline/.env` |
| FB `access token could not be decrypted` | Token ตัดค้าง/corrupt ใน `.env` — copy จากไฟล์ที่ถูกต้องใส่ใหม่ |
| FB Reels `(#200) no permission` | Reels ต้องใช้ Page Token (ไม่ใช่ User Token) — `agent-hub/index.js` exchange ให้อัตโนมัติแล้ว |
| Telegram ไม่ตอบสนอง | บอทมี Webhook อยู่ → สร้างบอทใหม่ |
| `.approval-bot.lock` ค้าง | `del .approval-bot.lock` แล้ว `taskkill /F /IM node.exe` |
| X Rate Limit | รอ 15 นาที หรือโพสต์ทีละ item_id |
| IG Carousel ล้มเหลว | ตรวจ IMGBB_API_KEY + รูปต้อง >50KB |
| `Cannot find module` | `npm install` |
| TikTok video TTS error | `make-tiktok-video.js` ใช้ `msedge-tts` npm — รัน `npm install msedge-tts` ถ้าพัง |
| ข่าว makrut/manao ค้างใน Telegram | รัน `--resend` (ดู Node.js Scripts) |
| Ollama output เป็น `??????` | ตรวจว่าใช้ model Typhoon2 (`OLLAMA_MODEL` ใน `.env`) — `llama3.2` ไม่รองรับไทย |

---

## Windows Task Scheduler

รัน Approval Bot อัตโนมัติทุกวัน 11:05 น.:

```powershell
# สร้าง task (ทำครั้งเดียว)
schtasks /Create /TN "ShopeeAffiliate-DailyFBPost" /TR "\"C:\Users\lenovo3\agent\shopee-affiliate\post-daily-fb.bat\"" /SC DAILY /ST 11:05 /F

# รันทดสอบทันที
schtasks /Run /TN "ShopeeAffiliate-DailyFBPost"
```
