# ADR: จัดระเบียบ Telegram bot — single-instance lock + topology

**Status:** Accepted — 2026-06-27
**เกี่ยวข้อง:** [telegram-tokens.md](telegram-tokens.md) (แผนผัง token), PR #32 (token mismatch)

## Problem

bot ที่ poll `getUpdates` เจอ 2 อาการ:
1. **409 Conflict** — 2 process poll token เดียวกัน (เช่น `start-all-agents.bat` รันซ้ำขณะ bot รัน)
2. **lock ค้าง** — process ตายแต่ไฟล์ lock ยังอยู่ (เข้าใจผิดว่า block restart)

\+ token sprawl: 6 bot token, บางตัวไม่มี poller (MAKRUT), manao/pipeline bot ซ้ำซ้อนกับ namkhao

## Decision (จาก grilling)

| # | คำถาม | เลือก |
|---|---|---|
| 1 | Topology | **3 poller: namkhao (ศูนย์ข่าว) + anime + mammuang**; retire manao/pipeline bot; MAKRUT = send-only |
| 2 | กัน 409 + ค้าง | **PID-liveness lock + shared [lib/bot-lock.js](../lib/bot-lock.js)** |
| 3 | start-all-agents.bat | **idempotent** — start เฉย ๆ พึ่ง lock (ไม่ taskkill ตัวที่รันอยู่) |

## กลไก `acquireBotLock(lockPath, label)`

```
startup → lock มี?
  ├─ PID ยังรัน (process.kill(pid,0) สำเร็จ) → ปฏิเสธ exit 1   ← กัน 409
  └─ PID ตาย (throw)                          → ล้าง lock + ยึดใหม่ ← กันค้าง
→ เขียน PID ตัวเอง + ลบ lock ตอน exit/SIGINT/SIGTERM
```

ใช้ร่วม 3 bot (เดิม anime/mammuang มี logic นี้ซ้ำกัน, **namkhao ไม่มีเลย → คือช่องโหว่ 409 จริง**)

## Consequences

- ✅ namkhao bot กัน double-poll ได้ (เดิมเขียน PID ทับเฉย ๆ ไม่เช็ค)
- ✅ `start-all-agents.bat` รันซ้ำปลอดภัย — bot ที่ทำงานอยู่ไม่ถูก kill กลาง Approve
- ✅ lock ค้าง self-heal (PID ตาย → start ใหม่ได้เลย)
- ✅ lock logic ที่เดียว (Gate 3) แทนซ้ำ 2 ไฟล์
- ⚠️ manao/pipeline/telegram-bot.js = retired (มี deprecation note) — อย่า start (poll MANAO token → ชน)
- 📌 token แยก (MANAO/MAKRUT/MAPRANG) เหลือใช้ **send-only** (notification ไม่มีปุ่ม) — ไม่มีปัญหา routing
