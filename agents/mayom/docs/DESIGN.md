# Agent มะยม — LINE Money Slip Logger (Design)

> สถานะ: **implement แล้ว** (PR #43) — เหลือตั้งค่า LINE channel + `MAYOM_*` ใน `.env` + expose webhook
> ที่มา: grilling session 2026-07-07

รับสลิปโอนเงินจากกลุ่ม LINE → OCR ด้วย vision model (local) → บันทึกเป็นรายการธุรกรรม → Dashboard สรุป (รวม / รายวัน / แยกตาม LINE user)

---

## Flow

```
LINE group (คนส่งสลิป)
  → LINE Messaging API webhook (ngrok → localhost:3002 ตอนทดสอบ)
  → agent-hub/routes/mayom.js
      · verify X-Line-Signature (HMAC-SHA256 ด้วย channel secret)  ← ไม่ผ่าน auth.gate ปกติ
      · filter: รับเฉพาะ MAYOM_LINE_GROUP_ID (กลุ่มเดียว) นอกนั้นทิ้ง
      · ตอบ HTTP 200 ทันที (LINE บังคับตอบเร็ว)
      · spawn agents/mayom/run.js --action process-slip
  → agents/mayom/run.js
      · ดึงรูปจาก LINE: GET /v2/bot/message/{messageId}/content
      · lib/slip-ocr.js → Ollama qwen2.5vl → { is_slip, amount, slip_datetime, bank_from, bank_to, ref_no, ... }
      · is_slip=false → เงียบ ไม่บันทึก ไม่ตอบ (กันรูปมีม/รูปทั่วไป)
      · dedup B+C:
          B) sha256 ของ bytes รูป
          C) ref_no ถ้าอ่านได้ ไม่งั้น composite amount+slip_datetime+bank
          เจอซ้ำ → บันทึกแต่ใส่ duplicate:true + duplicate_of:{id}
      · จับข้อความกำกับ: text จาก user เดียวกันภายใน ~60s หลังรูป → คำแรก=category, ที่เหลือ=note
      · เขียน transactions/{id}.json + append index.json
      · push ยอด+หมวดกลับกลุ่ม
          - อ่านได้        → "✅ บันทึกแล้ว: 500 บาท (ค่าอาหาร) โดยคุณสมชาย"
          - เป็นสลิปแต่อ่านเงินไม่ได้ → "อ่านสลิปไม่ออก ลองส่งใหม่ชัดๆ" + status:needs_review
  → Dashboard /dashboard/mayom (หลัง auth)
```

**หมายเหตุ reply vs push:** reply token ของ LINE หมดอายุเร็ว OCR อาจช้ากว่า → fallback เป็น **push message** (กินโควตา push ฟรีของ LINE) — ยอมรับได้

---

## ไฟล์ (ตาม 3-step agent creation ของ CLAUDE.md)

| ไฟล์ | หน้าที่ |
|---|---|
| `agent-hub/agents.js` | เพิ่ม entry `mayom` (card ใน hub) — emoji 🧾, role "Money Slip Logger" |
| `agent-hub/routes/mayom.js` | webhook receiver + dashboard + API (edit/delete/alias/category) — register ใน index.js |
| `agent-hub/html/mayom.js` | dashboard HTML builder |
| `agents/mayom/run.js` | entry point `--action process-slip` |
| `lib/slip-ocr.js` | **pluggable OCR** (qwen2.5vl default, เผื่อ EasySlip adapter) — Gate 2 shared |
| `lib/line-client.js` | LINE reply / push / get-content / get-profile — Gate 2 shared |
| `auth.js` | whitelist path `/webhook/line/mayom` (ยกเว้น auth, ใช้ signature แทน) |

---

## Data (file-based JSON)

```
agents/mayom/
├── transactions/{id}.json   ← 1 ไฟล์/รายการ
├── index.json               ← append-only ledger (สรุปเร็ว)
├── users.json               ← line_user_id → alias (ตั้งชื่อเล่นเองใน dashboard)
├── categories.json          ← [{name, color}] default: อาหาร, เดินทาง, ของใช้, บิล/ค่าบริการ, บันเทิง, อื่นๆ
└── slips/{id}.jpg           ← รูปสลิปต้นฉบับ
```

**transaction schema:**
```
id, created_at, line_user_id, line_display_name, group_id,
amount, slip_datetime, bank_from, bank_to, account_to, ref_no,
category, note, raw_ocr_text, slip_image_path, image_hash,
status (recorded | needs_review), duplicate (bool), duplicate_of (id|null)
```

---

## Dashboard `/dashboard/mayom`

- การ์ดสรุป: ยอดวันนี้ / เดือนนี้ / ทั้งหมด + จำนวนรายการ + needs_review ค้าง
- กราฟรายวัน 30 วัน — **stacked แยกสีตามหมวด**
- ตารางแยกตาม user: alias | #สลิป | ยอดรวม
- ตารางรายการล่าสุด — **แก้ inline** (amount / category / note / alias) + **ลบ** + toggle duplicate
- ฟิลเตอร์: ช่วงวันที่ / user / หมวด
- ❌ ไม่มี export CSV, ❌ ไม่มี scheduler (on-demand ล้วน — webhook driven)

---

## Env (root `.env`)

```
MAYOM_LINE_CHANNEL_SECRET=       # verify X-Line-Signature
MAYOM_LINE_CHANNEL_ACCESS_TOKEN= # reply / push / get message content
MAYOM_LINE_GROUP_ID=             # กลุ่มเดียวที่รับ (นอกนั้นทิ้ง)
MAYOM_OCR_MODEL=qwen2.5vl:latest # สลับ OCR engine ได้ (default qwen2.5vl)
```

---

## Decisions (จาก grilling)

| # | ประเด็น | เลือก |
|---|---|---|
| 1 | expose webhook | ngrok (ทดสอบ) → tunnel ถาวรทีหลัง; webhook path คงที่ `/webhook/line/mayom` |
| 2 | OCR engine | Vision LLM local (B) — pluggable `lib/slip-ocr.js` เผื่อ EasySlip (A) |
| 3 | vision model | `qwen2.5vl:latest` (มีบน host แล้ว) — typhoon-ocr-7b ทีหลัง |
| 4 | storage | JSON ต่อรายการ + index.json (ไม่ใช้ DB) |
| 5 | category/note | A+B — พิมพ์กำกับในกลุ่ม (คำแรก=category) + แก้ใน dashboard |
| 6 | dedup | B+C (image hash + ref_no/composite) |
| 7 | เจอซ้ำ | บันทึก + flag duplicate (ไม่นับยอด) |
| 8 | bot ตอบในกลุ่ม | ตอบทุกใบ (A) |
| 9 | OCR อ่านไม่ได้ | ตอบ "ส่งใหม่ชัดๆ" + status:needs_review |
| 10 | group scope | กลุ่มเดียว fix ใน .env (A) |
| 11 | user identity | line_user_id + snapshot display_name + alias map ใน dashboard |
| 12 | processing | ตอบ 200 ทันที + spawn run.js; ตอบยืนยันด้วย push |
| 13 | dashboard | stacked-by-category graph + inline edit + delete; ไม่มี export |
| 14 | หมวดหมู่ | A+B พร้อม default list 6 หมวด (categories.json มีสี) |
| 15 | รูปไม่ใช่สลิป | is_slip=false → เงียบ |
