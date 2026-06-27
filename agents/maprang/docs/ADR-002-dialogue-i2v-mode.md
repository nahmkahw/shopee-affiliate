# ADR-002: Dialogue Mode — Shot-list + I2V Motion (มะปราง Level B)

**Status:** Accepted — 2026-06-26
**สืบทอดจาก:** [ADR-001](ADR-001-anime-ref-2stage.md) (ใช้ anime_ref ของตัวละคร)

## Problem

โหมดปัจจุบัน = "นิทานเล่าเรื่อง": Flux Kontext still → **Ken Burns (ภาพนิ่ง pan/zoom, ปากไม่ขยับ)** + เสียงพากย์แยก pitch (radio-drama). ต้องการ → **ตัวละครพูดคุยตามบท + เคลื่อนไหวตามสถานการณ์** (Level B)

## Decision

เพิ่ม **mode ใหม่ `dialogue`** (`MAPRANG_ANIMATE=dialogue`) แยกจากโหมดนิทานเดิม (kenburns/i2v ยังใช้ได้):
- scene-gen ผลิต **shot-list** (8-10 shot สั้น) แทน 5 scene ยาว — แต่ละ shot = ตัวละคร 1 คนพูด 1 บรรทัดสั้น
- แต่ละ shot: Flux Kontext still → **Wan I2V** (ตัวละครขยับจริงตาม `action_en`)
- **motion-only** (ยังไม่ lip-sync จริง — เลื่อนไป Level C); ปากขยับลอย ๆ จาก I2V

## Choices (จาก grilling — ADR นี้บันทึก decision tree)

| # | คำถาม | เลือก | เหตุผล |
|---|---|---|---|
| 1 | lip-sync vs multi-char wide | **C** motion-only ก่อน | lip-sync จริงเลื่อนไป Level C |
| 2 | clip สั้น vs เสียงยาว | **D** แตก shot ให้บทสั้น | motion ครอบเต็ม |
| 3 | render budget | **A** ~8-10 shot, ~15-20s | เหมาะ Reels, 3060 ไหว ~1 ชม. |
| 4 | frame/fps | **A** 25fr@16fps (~1.5s/shot) | เบาสุดบน 14B I2V |
| 5 | data model | **C** reuse `scenes[]` นิยามใหม่=shot | กระทบ ripple น้อยสุด |
| 6 | audio sync | **B** hard-cap บรรทัด ≤~12 ตัวอักษร | motion ครอบเป๊ะ ไม่ freeze (safety freeze ≤0.5s) |
| 7 | narrator | **A** ตัดทิ้ง, dialogue ล้วน | ตรงเจตนา "ตัวละครพูดคุย" |
| 8 | composition | **C** ผสม wide 1-2 + close-up คนพูด | shot-reverse-shot, variety, เบากว่า |
| 9 | activation | **A** mode flag `dialogue` + fallback kenburns | ของเดิมไม่พัง |
| 10 | branch | ต่อจาก #29 (anime_ref) | dialogue พึ่ง anime_ref |

## Scene schema (mode `dialogue`) — reuse `scenes[]`

```jsonc
{
  "scene_number": 1,
  "shot_type": "wide" | "closeup",      // wide=ปูฉาก (1-2 แรก), closeup=คนพูด
  "characters": ["Teng"],                // closeup=[speaker], wide=ทุกตัว
  "speaker": "Teng",
  "line_th": "ไปกันเถอะ!",                // ≤~12 ตัวอักษร (hard-cap)
  "pitchK": 0.85,
  "action_en": "Teng waves hand, smiling",  // ป้อน I2V เป็น motion prompt
  "scene_setting_en": "park with animals",  // ป้อน Flux Kontext (ฉาก)
  "subtitle_th": "ไปกันเถอะ!"
}
```

## Consequences

- ✅ ตัวละครขยับจริงตามบท (I2V) + พูดสลับกัน (dialogue script)
- ✅ shot-reverse-shot ดูเป็นหนัง, variety สูงกว่า Ken Burns นิ่ง
- ✅ โหมดนิทานเดิมไม่พัง (แยก flag)
- ⚠️ render ~1 ชม./วิดีโอ (vs ~18 นาที) — 3060 หนักขึ้น
- ⚠️ ปากยังไม่ sync เสียงจริง (lip-sync = Level C ต่อยอด)
- ⚠️ บทพูดห้วน (≤12 ตัวอักษร) — punchy แบบการ์ตูนสั้น
- 🔁 fallback: I2V ไม่พร้อม/ล้มเหลว → Ken Burns ของ still เดิม

## Glossary update

- **scene (mode dialogue)** — ความหมายเปลี่ยน: 1 scene = **1 shot สั้น** (1 บทพูด) ไม่ใช่ฉากยาว
- **shot_type** — `wide` (ปูฉากหลายตัว) | `closeup` (โฟกัสคนพูดตัวเดียว)
- **action_en** — คำบรรยาย motion ของ shot (ป้อน Wan I2V)
- **dialogue mode** — โหมด shot-list + I2V (Level B); ตรงข้าม **narration mode** (Ken Burns เดิม)
- **Level C** — lip-sync จริง (ปากขยับตามเสียง) — ยังไม่ทำใน ADR นี้
