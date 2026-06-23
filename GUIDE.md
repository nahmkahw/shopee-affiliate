# คู่มือการใช้งานและติดตั้ง — Shopee Affiliate Content System

> **เวอร์ชัน:** 2.0 | **อัปเดตล่าสุด:** พฤษภาคม 2569

---

## สารบัญ

1. [ภาพรวมระบบ](#1-ภาพรวมระบบ)
2. [ความต้องการของระบบ](#2-ความต้องการของระบบ)
3. [การติดตั้ง](#3-การติดตั้ง)
4. [ตั้งค่า Credentials](#4-ตั้งค่า-credentials)
5. [การใช้งานคำสั่ง Claude Code](#5-การใช้งานคำสั่ง-claude-code)
6. [Telegram Approval Bot](#6-telegram-approval-bot)
7. [Dashboard](#7-dashboard)
8. [Windows Task Scheduler](#8-windows-task-scheduler)
9. [โครงสร้างไฟล์](#9-โครงสร้างไฟล์)
10. [Troubleshooting](#10-troubleshooting)
11. [Quick Reference](#11-quick-reference)

---

## 1. ภาพรวมระบบ

ระบบจัดการ **Shopee Affiliate Marketing** ครบวงจร ตั้งแต่ดึงข้อมูลสินค้า สร้าง content ไปจนถึงโพสต์ขึ้น Social Media โดยอัตโนมัติ พร้อมระบบ Approve ผ่าน Telegram

```
┌─────────────────────────────────────────────────────────────────┐
│                        WORKFLOW ภาพรวม                          │
│                                                                  │
│  Shopee Affiliate Portal                                         │
│         ↓                                                        │
│  /ดึงสินค้า-อัตโนมัติ  ← คลิกดึง affiliate link จาก portal     │
│         ↓                                                        │
│  /ดึงสินค้า            ← scrape ข้อมูล + รูปภาพ ผ่าน Chrome    │
│         ↓                                                        │
│  /สร้าง-content        ← สร้างโพสต์ FB / IG / X / TikTok       │
│         ↓                                                        │
│  Telegram Approval Bot ← preview → Approve → โพสต์ Facebook     │
│         ↓                                                        │
│  Task Scheduler        ← รันอัตโนมัติทุกวัน 11:05 น.            │
└─────────────────────────────────────────────────────────────────┘
```

### Platforms ที่รองรับ

| Platform | โพสต์อัตโนมัติ | รูปภาพ | หมายเหตุ |
|----------|:-----------:|:----:|---------|
| Facebook | ✅ | ✅ รูป 2–6 ใบ (>50KB) | ผ่าน Graph API |
| Instagram | ✅ | ✅ Carousel | ผ่าน imgBB + Graph API |
| X (Twitter) | ✅ | — | Thread 3 ทวีต |
| TikTok | 📱 manual | — | แสดง caption + script ให้ copy |

---

## 2. ความต้องการของระบบ

| รายการ | เวอร์ชัน | ลิงก์ดาวน์โหลด |
|--------|---------|---------------|
| **Windows** | 10 / 11 | — |
| **Node.js** | v18 ขึ้นไป | [nodejs.org](https://nodejs.org) |
| **Google Chrome** | ล่าสุด | [google.com/chrome](https://google.com/chrome) |
| **Claude Code** | ล่าสุด | ใช้งานอยู่แล้ว |

ตรวจสอบ Node.js:
```bash
node --version    # ควรได้ v18.x.x ขึ้นไป
npm --version
```

---

## 3. การติดตั้ง

### 3.1 วางโปรเจกต์

วางโฟลเดอร์โปรเจกต์ที่:
```
C:\Users\MissT\shopee-affiliate\
```

### 3.2 ติดตั้ง Node.js Packages

```bash
cd C:\Users\MissT\shopee-affiliate
npm install
```

packages ที่ติดตั้ง:
- `dotenv` — อ่านค่า .env
- `playwright` — scrape Shopee ผ่าน Chrome
- `twitter-api-v2` — โพสต์ X (Twitter)
- `xlsx` — อัปเดต tracking.xlsx

### 3.3 สร้างไฟล์ .env

```bash
copy .env.example .env
```

เปิดไฟล์ `.env` แล้วใส่ค่า credentials (ดูหัวข้อ 4)

### 3.4 สร้างโฟลเดอร์ input

```bash
mkdir input
```

สร้างไฟล์ `input\urls.txt` (ดูรูปแบบในหัวข้อ 5.1)

---

## 4. ตั้งค่า Credentials

ไฟล์ `.env` ที่ต้องกรอก:

```env
# ===== Facebook =====
FB_PAGE_ID=xxxxxxxxxx
FB_ACCESS_TOKEN=EAAxxxxxxxx

# ===== Instagram =====
IG_USER_ID=xxxxxxxxxx
IG_ACCESS_TOKEN=EAAxxxxxxxx

# ===== imgBB (อัปโหลดรูป Instagram) =====
IMGBB_API_KEY=xxxxxxxxxx

# ===== X (Twitter) =====
X_API_KEY=xxxxxxxxxx
X_API_SECRET=xxxxxxxxxx
X_ACCESS_TOKEN=xxxxxxxxxx
X_ACCESS_TOKEN_SECRET=xxxxxxxxxx

# ===== Telegram Bot =====
TELEGRAM_BOT_TOKEN=xxxxxxxxxx:AAxxxxxxxxx
TELEGRAM_CHAT_ID=xxxxxxxxxx
```

---

### 4.1 ตั้งค่า Facebook

**ต้องมี:** Facebook Page

1. ไปที่ [developers.facebook.com](https://developers.facebook.com) → **My Apps** → **Create App**
   - ประเภท: **Business** → ใส่ชื่อ App → Create
2. App Dashboard → **Add Products** → เพิ่ม **Pages API**
3. **Tools** → **Graph API Explorer** → เลือก App → **Generate Access Token**
   - เลือก permissions: `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`
4. แปลง token เป็น **Long-lived (60 วัน)**:
   ```
   GET /oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id={APP_ID}
     &client_secret={APP_SECRET}
     &fb_exchange_token={SHORT_LIVED_TOKEN}
   ```
5. หา **Page ID**: Facebook Page → About → เลื่อนหา "Page ID"
6. เพิ่มใน `.env`:
   ```env
   FB_PAGE_ID=676666885755129
   FB_ACCESS_TOKEN=EAAxxxxxxxx
   ```

---

### 4.2 ตั้งค่า Instagram

**ต้องมี:** Instagram Business/Creator account เชื่อมกับ Facebook Page แล้ว

1. เชื่อม Instagram กับ Facebook Page:
   - Facebook Page → **Settings** → **Linked Accounts** → **Instagram** → Connect Account
2. เพิ่ม permissions ใน Graph API Explorer (token เดิม):
   `instagram_basic`, `instagram_content_publish`
3. หา Instagram User ID:
   ```
   GET /{page-id}?fields=instagram_business_account
   ```
   คัดลอก `id` ใน `instagram_business_account`
4. สมัคร [imgbb.com](https://imgbb.com) (ฟรี) → **API** → **Get API Key**
5. เพิ่มใน `.env`:
   ```env
   IG_USER_ID=17841400332730509
   IG_ACCESS_TOKEN=EAAxxxxxxxx
   IMGBB_API_KEY=xxxxxxxxxx
   ```

---

### 4.3 ตั้งค่า X (Twitter)

1. ไปที่ [developer.twitter.com](https://developer.twitter.com) → Apply for developer account
   - Use case: *"Personal tool to schedule and post affiliate product reviews on my X account."*
2. **Developer Portal** → Projects & Apps → **New Project** → **New App**
3. **User authentication settings**:
   - เปิด **OAuth 1.0a** → App permissions: **Read and Write**
   - Callback URL: `http://localhost`
4. **Keys and Tokens** → คัดลอก API Key, API Secret, Access Token, Access Token Secret
5. เพิ่มใน `.env`:
   ```env
   X_API_KEY=xxxxxxxxxx
   X_API_SECRET=xxxxxxxxxx
   X_ACCESS_TOKEN=xxxxxxxxxx
   X_ACCESS_TOKEN_SECRET=xxxxxxxxxx
   ```

---

### 4.4 ตั้งค่า Telegram Bot

> ⚠️ **สำคัญ:** ต้องสร้างบอทใหม่เฉพาะสำหรับระบบนี้  
> ห้ามใช้บอทที่มี Webhook ตั้งค่าอยู่แล้ว (เช่น บอท n8n) เพราะจะทำให้รับ callback ไม่ได้

**ขั้นที่ 1 — สร้าง Bot:**
1. เปิด Telegram → ค้นหา **@BotFather**
2. พิมพ์ `/newbot` → ตั้งชื่อ (เช่น `Shopee Affiliate Bot`)
3. ตั้ง username ลงท้ายด้วย `bot` (เช่น `my_shopee_aff_bot`)
4. คัดลอก **Token** → `1234567890:AAxxxxxxxxxxxxx`

**ขั้นที่ 2 — หา Chat ID:**
1. เปิด Bot ที่สร้างไว้ → พิมพ์ `/start`
2. เปิด URL นี้ในเบราว์เซอร์ (แทน `{TOKEN}` ด้วยค่าจริง):
   ```
   https://api.telegram.org/bot{TOKEN}/getUpdates
   ```
3. ดู Chat ID จาก JSON:
   ```json
   {
     "result": [{
       "message": {
         "chat": {
           "id": 123456789    ← Chat ID คือตัวเลขนี้
         }
       }
     }]
   }
   ```
   > ถ้า result ว่าง → กลับไปพิมพ์ `/start` ในบอทก่อน แล้วเปิด URL ใหม่

**ขั้นที่ 3 — เพิ่มใน `.env`:**
```env
TELEGRAM_BOT_TOKEN=1234567890:AAxxxxxxxxxxxxx
TELEGRAM_CHAT_ID=123456789
```

---

## 5. การใช้งานคำสั่ง Claude Code

เปิด **Claude Code** ในโฟลเดอร์ `shopee-affiliate` แล้วพิมพ์คำสั่ง

---

### 5.1 `/ดึงสินค้า-อัตโนมัติ` — ดึง Affiliate Link จาก Portal

เข้า Shopee Affiliate Portal ผ่าน Chrome แล้วคลิก "เอาลิงค์" ทุกสินค้าอัตโนมัติ บันทึกลง `input/urls.txt`

**ขั้นตอนก่อนรัน (ทำทุกครั้ง):**

1. ปิด Chrome ทั้งหมดก่อน (สำคัญมาก)
2. กด `Win + R` พิมพ์:
   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\ChromeDebug"
   ```
3. Login Shopee Affiliate ที่ [affiliate.shopee.co.th](https://affiliate.shopee.co.th)
4. เปิดหน้า **Product Offer** รอให้สินค้าโหลดครบ

```
/ดึงสินค้า-อัตโนมัติ            ← ดึงทั้งหมด ข้ามที่มีแล้ว
/ดึงสินค้า-อัตโนมัติ --dry-run  ← ดูรายการที่จะเพิ่ม ไม่บันทึก
```

**รูปแบบ `input/urls.txt` (3 คอลัมน์คั่นด้วย `|`):**
```
https://shopee.co.th/product/{shop_id}/{item_id} | https://s.shopee.co.th/xxxxx | YYYY-MM-DD
```

ตัวอย่าง:
```
https://shopee.co.th/product/457973807/3991346022  | https://s.shopee.co.th/2LVCeqiBMq | 2026-05-20
https://shopee.co.th/product/1057506471/19283435771 | https://s.shopee.co.th/5q54pIJ2gf | 2026-05-21
```

> บรรทัดที่ขึ้นต้นด้วย `#` จะถูกข้าม (ใช้เป็น comment ได้)

---

### 5.2 `/ดึงสินค้า` — Scrape ข้อมูลสินค้า

ดึงรายละเอียด + รูปภาพจาก Shopee ตาม `input/urls.txt`

> ต้องเปิด Chrome debug mode ก่อน (เหมือนหัวข้อ 5.1)

```
/ดึงสินค้า          ← ดึงเฉพาะสินค้าที่ยังไม่มี data.json
/ดึงสินค้า --force  ← ดึงใหม่ทั้งหมด
/ดึงสินค้า --dry-run ← แสดงรายการโดยไม่ดึงจริง
```

**ผลลัพธ์:**
```
products/{item_id}/data.json
products/{item_id}/images/1.jpg ... 6.jpg
```

---

### 5.3 `/สร้าง-content` — สร้าง Content โพสต์

สร้างโพสต์ครบ 4 platform จาก `data.json` พร้อมอัปเดต `tracking.xlsx`

```
/สร้าง-content                ← สร้างทุกสินค้าที่ยังค้าง
/สร้าง-content 2026-05-20     ← เฉพาะวันที่นั้น
/สร้าง-content 3991346022     ← เฉพาะ item_id นั้น
```

**ผลลัพธ์:**
```
products/{item_id}/content/facebook.md
products/{item_id}/content/instagram.md
products/{item_id}/content/x.md
products/{item_id}/content/tiktok.md
```

**กฎสร้าง content:**

| Platform | ความยาว | รูปแบบ |
|----------|---------|--------|
| Facebook | 150–300 คำ | Storytelling hook + affiliate link |
| Instagram | 100–150 คำ | 15–20 hashtag (4 ชั้น) |
| X | 3 ทวีต | ทวีตแรกไม่มีลิงก์ / ทวีตสุดท้ายมีลิงก์ |
| TikTok | Script table + caption 50–80 คำ | TIME / VOICEOVER / VISUAL / ON-SCREEN |

---

### 5.4 `/โพสต์` — โพสต์ขึ้น Social Media

```
/โพสต์ 2026-05-20                 ← โพสต์ทุก platform วันนั้น
/โพสต์ 2026-05-20 --platform fb   ← เฉพาะ Facebook
/โพสต์ 3991346022 --platform fb   ← เฉพาะ item_id นั้น
/โพสต์ 3991346022 --platform fb,ig ← Facebook + Instagram
```

**Platforms:** `fb` `ig` `x` `tiktok`

> TikTok จะแสดง caption ให้ copy ไปโพสต์เองที่ [tiktok.com/creator-center](https://www.tiktok.com/creator-center)

---

### 5.5 `/สร้างวิดีโอ` — สร้างวิดีโอ TikTok

```
/สร้างวิดีโอ 3991346022   ← เฉพาะสินค้านั้น
/สร้างวิดีโอ 2026-05-17   ← เฉพาะวันที่นั้น
/สร้างวิดีโอ --force      ← สร้างใหม่แม้มีไฟล์แล้ว
```

> ถ้าไม่มี FFmpeg → จะสร้าง `capcut.md` เพื่อตัดต่อใน CapCut แทน

---

## 6. Telegram Approval Bot

ระบบส่ง preview โพสต์ Facebook มาให้ Approve ก่อนโพสต์จริง

### 6.1 Flow การทำงาน

```
Bot ส่ง preview ทาง Telegram
           ↓
   ┌───────────────────────────┐
   │  📝 [ชื่อสินค้า][ราคา]   │
   │  [เนื้อหา Facebook post] │
   │  [✅ โพสต์เลย][🔄 ใหม่]  │
   └───────────────────────────┘
           ↓                   ↓
    โพสต์ Facebook      สร้าง content ใหม่
    ทันที + รูปภาพ       จาก template
                              ↓
                      ส่ง preview รอบใหม่
```

### 6.2 การรัน

```bash
# รันตามวันที่ปัจจุบัน (ใช้งานจริง)
node approval-bot.js

# ทดสอบด้วยสินค้าที่ระบุ (ระบุ item_id)
node approval-bot.js 54256553392
```

### 6.3 ฟีเจอร์หลัก

| ปุ่ม | การทำงาน |
|------|---------|
| ✅ โพสต์เลย | โพสต์ Facebook ทันที พร้อมรูป 2–6 ใบ |
| 🔄 สร้าง Content ใหม่ | สร้าง content ใหม่จาก template → ส่งรอ Approve อีกครั้ง |
| 📋 แสดงรายการ (เมนูสินค้าเก่า) | เลือกสินค้าจากวันก่อนหน้ามาโพสต์ได้ |
| ✅ เสร็จแล้ว | ออกจากเมนูสินค้าเก่า |

### 6.4 หมายเหตุสำคัญ

> ⚠️ **ห้ามรันบอทซ้อนกัน** — ระบบมี Lock file ป้องกันอัตโนมัติ  
> ถ้าบอทค้างให้ลบไฟล์ `.approval-bot.lock` แล้วรันใหม่:
> ```bash
> del C:\Users\MissT\shopee-affiliate\.approval-bot.lock
> ```

---

## 7. Dashboard

หน้าเว็บดูสถานะ agents และ pipeline ทั้งหมด

### 7.1 รัน

```bash
node agent-hub/index.js
```

เปิดเบราว์เซอร์ที่ **http://localhost:3002**

### 7.2 ฟีเจอร์

| ส่วน | คำอธิบาย |
|------|---------|
| `/dashboard/mali` | สถานะ Shopee Affiliate |
| `/dashboard/manao` | AI News pipeline |
| `/dashboard/namkhao` | Supervisor + schedule status |
| 🔘 Filter | ทั้งหมด / วันนี้ / พร้อม / รอ Content |

- **Auto-refresh** ทุก 60 วินาที
- **API endpoint:** `http://localhost:3001/api/products` (JSON)

---

## 8. Windows Task Scheduler

รัน Approval Bot อัตโนมัติทุกวัน **11:05 น.** (ไม่เสีย Claude token)

### 8.1 สร้าง Task (ทำครั้งเดียว)

```powershell
schtasks /Create /TN "ShopeeAffiliate-DailyFBPost" /TR "\"C:\Users\MissT\shopee-affiliate\post-daily-fb.bat\"" /SC DAILY /ST 11:00 /F
```

### 8.2 คำสั่งจัดการ

```powershell
# ดูสถานะ
schtasks /Query /TN "ShopeeAffiliate-DailyFBPost" /FO LIST

# รันทดสอบทันที
schtasks /Run /TN "ShopeeAffiliate-DailyFBPost"

# ปิดใช้งานชั่วคราว
schtasks /Change /TN "ShopeeAffiliate-DailyFBPost" /DISABLE

# เปิดใช้งานอีกครั้ง
schtasks /Change /TN "ShopeeAffiliate-DailyFBPost" /ENABLE

# เปิด Task Scheduler GUI
taskschd.msc
```

### 8.3 ไฟล์ที่เกี่ยวข้อง

```
post-daily-fb.bat   ← script ที่ Task Scheduler เรียก
approval-bot.js     ← บอทหลักที่รันจริง
```

> ⚠️ Task จะรันได้เฉพาะตอนที่ **Windows เปิดอยู่และ login อยู่** เท่านั้น

---

## 9. โครงสร้างไฟล์

```
shopee-affiliate/
│
├── .env                      ← Credentials (ห้าม commit ลง Git)
├── .env.example              ← Template สำหรับสร้าง .env
├── .approval-bot.lock        ← Lock file (สร้าง/ลบอัตโนมัติ)
│
├── GUIDE.md                  ← คู่มือนี้
├── CLAUDE.md                 ← กฎและคำสั่งสำหรับ Claude Code
├── tracking.xlsx             ← ตารางสรุปสถานะสินค้าทั้งหมด
│
├── input/
│   └── urls.txt              ← รายการ affiliate links + วันที่โพสต์
│
├── products/
│   └── {item_id}/
│       ├── data.json             ← ข้อมูลสินค้า
│       ├── images/
│       │   └── 1.jpg ... 6.jpg   ← รูปสินค้า (max 6)
│       └── content/
│           ├── facebook.md
│           ├── instagram.md
│           ├── x.md
│           └── tiktok.md
│
├── templates/                ← Template สำหรับสร้าง content
│   ├── fb-template.md
│   ├── ig-template.md
│   ├── x-template.md
│   └── tiktok-template.md
│
├── scrape.js                 ← Scraper ดึงข้อมูลสินค้า
├── scrape-offers.js          ← Scraper ดึง affiliate links จาก portal
├── post.js                   ← โพสต์ FB / IG / X
├── approval-bot.js           ← Telegram Approval Bot
└── post-daily-fb.bat         ← Script สำหรับ Task Scheduler
```

---

## 10. Troubleshooting

### ❌ Chrome ยังไม่ได้เปิดในโหมด debug

**อาการ:** `Error: connect ECONNREFUSED 127.0.0.1:9222`

```
แก้ไข:
1. ปิด Chrome ทั้งหมดก่อน (ดู Task Manager ว่ายังมี chrome.exe ไหม)
2. กด Win+R แล้วพิมพ์:
   "C:\Program Files\Google\Chrome\Application\chrome.exe"
   --remote-debugging-port=9222
   --user-data-dir="C:\ChromeDebug"
3. Login Shopee ใน Chrome ที่เปิดขึ้นมา
4. ตรวจสอบที่ http://localhost:9222/json/version
```

---

### ❌ Shopee แสดง CAPTCHA / Bot Check

**อาการ:** title ได้ "Verify to Continue" หรือ "Loading Issue"

```
แก้ไข:
1. เปิด Chrome debug แล้วไปที่ URL สินค้าด้วยตัวเอง
2. แก้ CAPTCHA ให้ผ่านก่อน
3. รัน /ดึงสินค้า --force อีกครั้ง
```

---

### ❌ Facebook token หมดอายุ (OAuthException)

**อาการ:** `Error: Session has expired`

```
แก้ไข:
1. developers.facebook.com → Graph API Explorer
2. Generate token ใหม่ (permissions: pages_manage_posts, pages_read_engagement)
3. แปลงเป็น Long-lived token (60 วัน)
4. อัปเดต FB_ACCESS_TOKEN ใน .env
```

---

### ❌ Telegram Bot กดปุ่มแล้วไม่มีการตอบสนอง

**สาเหตุ:** บอทมี Webhook ตั้งค่าอยู่ → ต้องใช้บอทใหม่

```bash
# ตรวจสอบ webhook
node -e "
require('dotenv').config();
const https = require('https');
const req = https.request({
  hostname: 'api.telegram.org',
  path: '/bot' + process.env.TELEGRAM_BOT_TOKEN + '/getWebhookInfo',
  method: 'POST',
  headers: {'Content-Type':'application/json','Content-Length':2}
}, res => { let b=''; res.on('data',d=>b+=d); res.on('end',()=>console.log(b)); });
req.write('{}'); req.end();
"
```

ถ้าเห็น `"url": "https://..."` → บอทมี webhook  
**แก้ไข:** สร้างบอทใหม่ผ่าน @BotFather แล้วอัปเดต `.env`

---

### ❌ approval-bot.js ค้าง / Lock file ไม่ถูกลบ

```powershell
# ลบ lock file
del C:\Users\MissT\shopee-affiliate\.approval-bot.lock

# ปิด node process ทั้งหมด
taskkill /F /IM node.exe
```

---

### ❌ รันบอทซ้อนกัน (หลายตัวพร้อมกัน)

**อาการ:** กดปุ่มใน Telegram แล้วไม่มีผล หรือบอทสลับกันรับ callback

```
แก้ไข:
1. ปิด node.exe ทั้งหมด (taskkill /F /IM node.exe)
2. ลบ .approval-bot.lock (ถ้ามี)
3. รัน approval-bot.js ใหม่ครั้งเดียว
```

---

### ❌ X (Twitter) Rate Limit

**อาการ:** `Error: Too Many Requests`

```
แก้ไข:
1. รอ 15 นาที แล้วลองใหม่
2. หรือโพสต์ทีละ item_id:
   /โพสต์ {item_id} --platform x
```

---

### ❌ Instagram Carousel ไม่สำเร็จ

**อาการ:** `imgBB upload failed` หรือ `IG carousel error`

```
ตรวจสอบ:
1. IMGBB_API_KEY ใน .env ถูกต้องไหม
2. มีรูปใน products/{item_id}/images/ ไหม
3. รูปต้องมีขนาด > 50 KB
4. รันใหม่: /โพสต์ {item_id} --platform ig
```

---

### ❌ Error "Cannot find module"

```bash
npm install
```

---

## 11. Quick Reference

### คำสั่ง Claude Code

| ต้องการ | คำสั่ง |
|---------|--------|
| ดึง affiliate links จาก portal | `/ดึงสินค้า-อัตโนมัติ` |
| Scrape ข้อมูลสินค้าทั้งหมด | `/ดึงสินค้า` |
| สร้าง content ทั้งหมด | `/สร้าง-content` |
| สร้าง content เฉพาะวันที่ | `/สร้าง-content 2026-05-20` |
| สร้าง content เฉพาะสินค้า | `/สร้าง-content 3991346022` |
| โพสต์ทุก platform | `/โพสต์ 2026-05-20` |
| โพสต์เฉพาะ Facebook | `/โพสต์ 2026-05-20 --platform fb` |
| โพสต์สินค้าเดียว | `/โพสต์ 3991346022 --platform fb` |
| สร้างวิดีโอ TikTok | `/สร้างวิดีโอ 3991346022` |

### คำสั่ง Terminal

| ต้องการ | คำสั่ง |
|---------|--------|
| รัน Approval Bot | `node approval-bot.js` |
| ทดสอบ Bot กับสินค้าเดิม | `node approval-bot.js 54256553392` |
| รัน Agent Hub | `node agent-hub/index.js` |
| โพสต์โดยตรง (ไม่ผ่าน Approve) | `node post.js 2026-05-20 --platform fb` |

### Workflow ประจำวัน

```
11:05 น.  Task Scheduler รัน approval-bot.js อัตโนมัติ
          ↓
          Telegram ส่ง preview โพสต์มาให้ดู
          ↓
    กด ✅ → โพสต์ Facebook ทันที
    กด 🔄 → สร้าง content ใหม่ → Approve อีกครั้ง
          ↓
          บอทถาม "ต้องการโพสต์สินค้าเก่าด้วยไหม?"
          ↓
          ตรวจสอบสถานะที่ http://localhost:3001
```
