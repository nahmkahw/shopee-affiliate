# ADR-001: 2-Stage Anime Reference สำหรับ Character Consistency (มะปราง)

**Status:** Accepted — 2026-06-25
**Context job:** `1782396895458` (เท่ง/โหน่ง/หม่ำ)

## Problem

ตัวละครในวิดีโอไม่เหมือน ref + เพศ/อายุหลุด (กำหนดชาย 55–61 → ออกมาเป็นเด็ก/ผู้หญิง)

**Root cause:** ref images เป็น **รูปถ่ายจริง** (photoreal) แต่ output บังคับ `anime style`.
Flux Kontext ถูกขอให้ "แปลง photo→anime" + "คงอัตลักษณ์" ในงานเดียว → domain gap
ทำให้ identity (หน้า/อายุ/เพศ) collapse. ซ้ำด้วย race: job เริ่มก่อนตัวละครมี ref พร้อม
→ `meta.char_refs` หาย → บาง scene fallback T2V (วาดตัวละครใหม่ทั้งหมด)

## Decision

แยกเป็น **2-stage** โดยเพิ่ม **Stage-0** ที่แปลงรูปถ่าย → canonical anime portrait
ครั้งเดียวต่อตัวละคร แล้ว pipeline เดิม (scene still) ใช้ anime portrait นั้นเป็น anchor
(domain เดียวกับ output → identity คงตัว)

| Stage | Input | Process | Output |
|-------|-------|---------|--------|
| **0 (ใหม่)** | รูปถ่ายจริง | auto face-crop (UltralyticsDetector) → IPAdapterFaceID + AnythingXL + gender/age prompt | `anime_ref` (canonical anime portrait) |
| 1 | `anime_ref` หลายตัว | ImageStitch + Flux Kontext (เดิม) | scene still |
| 2 | scene still | Ken Burns / I2V (เดิม) | scene clip |

## Choices (จาก grilling session)

1. **Output style = anime** (ไม่เปลี่ยนเป็น realistic) → ต้องมี Stage-0 bridge
2. **Stage-0 = IPAdapterFaceID + AnythingXL** (ไม่ใช่ Flux img2img / ReActor) — identity transfer ข้าม domain ดีสุด; ยอมรับ "คล้าย ไม่เป๊ะ"
3. **Input cleaning = auto face-crop ก่อน IPAdapter** — รูป ref มี background รก/หลายคน
4. **Data model:** เพิ่ม field `anime_ref` แยกจาก `ref_image`(photo), auto-gen ตอนอัปโหลด; `resolveSceneRefs`/`collectCharRefs` อ่าน `anime_ref` (fallback → `ref_image`)
5. **Gender = structured field** (dropdown) ขับ positive+negative ทั้ง Stage-0 และ Stage-2 (ล็อก 2 ชั้น); age = band หยาบ (`mature/middle-aged/elderly`) กันออกมาเป็นเด็ก
6. **Guard:** ห้ามเริ่ม job ถ้าตัวละครที่เลือกยังไม่มี `anime_ref` (กัน race ที่ทำ char_refs หาย)

## Consequences

- ✅ identity/เพศ/อายุ เสถียรขึ้น (anchor เป็น anime domain เดียวกับ output)
- ✅ เก็บรูปถ่ายต้นฉบับไว้ (re-gen anime_ref ใหม่ได้)
- ⚠️ likeness เป็น "คล้าย" ไม่ใช่ก๊อปหน้าเป๊ะ (ข้อจำกัดของ anime จากคนจริง)
- ⚠️ Stage-0 เพิ่มเวลา setup ตัวละคร (ทำครั้งเดียว) + ต้องมี InsightFace model บน ComfyUI
- 🔁 migrate ตัวละครเก่า: batch re-gen `anime_ref`

## Glossary

- **`ref_image`** — รูปถ่ายต้นฉบับที่ผู้ใช้อัปโหลด (photoreal, ไม่ใช้เป็น anchor โดยตรงอีกต่อไป)
- **`anime_ref`** — canonical anime portrait ที่ Stage-0 สร้าง = identity anchor จริงของ pipeline
- **Stage-0** — photo→anime portrait (IPAdapterFaceID), ใหม่ใน ADR นี้
- **identity anchor** — รูปที่ Flux Kontext ใช้ล็อกหน้า/ผม/ชุด ข้าม scene
