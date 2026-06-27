# ADR: ComfyUI GPU mutex (กัน client timeout ตอนรอคิว)

**Status:** Accepted — 2026-06-27

## Problem

agent หลายตัวเรียก ComfyUI ร่วม GPU เดียว (maprang, mammuang, anime, manao/makrut).
ComfyUI serialize งานฝั่ง server อยู่แล้ว (ไม่ OOM พร้อมกัน) **แต่** ถ้า submit พร้อมกัน งานที่มาทีหลัง
รอใน ComfyUI queue → **client timeout ฝั่ง agent fire ก่อนงานได้รัน** (maprang I2V ยาว ~8 นาที → ตัวอื่นรอเก้อ)

เป้าหมาย: **เชิงป้องกัน** — กัน timeout-while-waiting เมื่อ on-demand agent (anime/mammuang/maprang) ชนกันเอง/ชน scheduled news

## Decision (จาก grilling)

| # | คำถาม | เลือก |
|---|---|---|
| 1 | ปัญหา | timeout ขณะรอคิว (A) + เชิงป้องกัน → ทำแบบ **เบา** |
| 2 | คุม backend ไหน | **ComfyUI อย่างเดียว** (Ollama เร็ว วินาที — ไม่คุ้ม) |
| 3 | กลไก | **file-based mutex** [lib/gpu-lock.js](../lib/gpu-lock.js) (ไม่ใช่ central service) |
| 4 | integration | **wrap ทุก ComfyUI submit** (all-or-nothing) ผ่าน `withGpuLock(label, fn)` |
| 5 | กัน holder ค้าง | ยึดได้ถ้า **PID ตาย OR อายุ lock > MAX_HOLD (15 นาที)**; ตัวรอ poll 3s ไม่มี cap |

## กลไก `withGpuLock(label, fn)`

```
acquire (atomic 'wx' lock file)         ← timeout ComfyUI ยังไม่นับขณะรอ
  ├─ lock ว่าง → ยึด ({pid, agent, since})
  └─ lock มี → stale? (PID ตาย / อายุ > 15 นาที) → ล้าง+ยึด ; ไม่งั้น poll ทุก 3s
→ fn()  (submit + poll ComfyUI)         ← timeout เริ่มนับตรงนี้ (ไม่โดนหักเวลารอ) ← แก้ปัญหา
→ release (finally — กัน leak แม้ error/exit)
```

## Chokepoints ที่ wrap (ครบ = mutex มีผล)

| ไฟล์ | จุด | label |
|------|-----|-------|
| [comfy-client.js](../agents/maprang/pipeline/comfy-client.js) | `submitImageWorkflow`, `_runClipWorkflow` | maprang-img / maprang-clip |
| [mammuang-gen.js](../agents/mammuang/mammuang-gen.js) | `generateMammuang` | mammuang |
| [anime-gen.js](../agents/anime/anime-gen.js) | `generateAnime` | anime |
| [comfy-news.js](../lib/comfy-news.js) | `generateNewsImage` | news (manao+makrut) |

> flux-kontext / anime-portrait ผ่าน `submitImageWorkflow` อยู่แล้ว → ครอบอัตโนมัติ

## Consequences

- ✅ ComfyUI submit ถูก serialize ข้าม agent → ไม่มีงานรอใน ComfyUI queue นานจน client timeout
- ✅ เบา — ไม่มี service ใหม่/critical path (reuse pattern file-lock เหมือน bot-lock)
- ✅ กัน deadlock: holder ตาย/ค้าง → ยึดต่อได้ (PID-liveness + MAX_HOLD)
- ⚠️ poll 3s = latency ~3s หลัง holder ปล่อย (เล็กน้อยเทียบงานนาที ๆ)
- ⚠️ Ollama ไม่คุม (ถ้าอนาคต model ใหญ่ขึ้น ค่อยเพิ่ม lock แยก)
- 📌 env: `GPU_LOCK_FILE`, `GPU_LOCK_MAX_HOLD_MS` (900000), `GPU_LOCK_POLL_MS` (3000)
