# ADR-003: Comic Mode — การ์ตูน 4 ช่อง (4-koma)

**Status:** Accepted — 2026-06-26
**สืบทอดจาก:** [ADR-001](ADR-001-anime-ref-2stage.md) (anime_ref)
**เกี่ยวข้อง:** [ADR-002](ADR-002-dialogue-i2v-mode.md) (dialogue video — เลื่อนไว้)

## Problem

โหมดวิดีโอ (Level B / dialogue I2V) render **~1.5-2 ชม./วิดีโอ** — I2V Wan 14B วัดจริง **466 วินาที (~7.8 นาที)/shot** บน RTX 3060 = คอขวด. ต้องการ output ที่มีตัวละคร+บทพูด แต่ผลิตเร็ว

## Decision

เพิ่ม **mode ที่ 3: `comic`** — การ์ตูน 4 ช่อง (รูปนิ่ง + บอลลูนคำพูด) **ตัด I2V ทิ้งทั้งหมด**:
- เหลือแค่ Flux Kontext still ต่อช่อง (~2.5 นาที) → **~10 นาที/การ์ตูน** (เร็วขึ้น ~10 เท่า)
- ใช้จุดแข็งที่พิสูจน์แล้ว (Flux Kontext char consistency จาก #29) เลี่ยงจุดอ่อน (I2V ช้า)

## 3 โหมดของมะปราง

| mode | output | กลไก | เวลา | เลือกจาก |
|---|---|---|---|---|
| **narration** (เดิม) | วิดีโอ | Flux still → Ken Burns + เสียงพากย์ | ~18 นาที | `MAPRANG_ANIMATE=kenburns` |
| **dialogue** (ADR-002, ยังไม่ทำ) | วิดีโอ | shot-list → Wan I2V motion | ~1.5-2 ชม. | `MAPRANG_ANIMATE=i2v` |
| **comic** (ADR นี้) | รูป .png | 4 panel Flux still + บอลลูน | **~10 นาที** | dashboard mode=comic → `--action comic` |

## Pipeline (comic)

```
comic-gen.js   → Typhoon2 แตก 4 panel (gen ทีละช่อง + validation + dedup)
flux-kontext   → Flux Kontext still/panel (ใช้ anime_ref anchor, resolveSceneRefs)
comic-build.js → @napi-rs/canvas: grid 2×2 + บอลลูนคำพูดไทย (wrap, หาง, ชื่อผู้พูด) → comic.png
```

## ข้อสังเกตสำคัญ (จาก implementation)

- **Typhoon2 (8B) ทำ multi-item JSON ไม่ครบ** — ขอ array 4 ช่องครั้งเดียวได้แค่ 1-2 panel → **แก้: gen ทีละ panel** (4 ครั้ง) + story-beat (ตั้ง/ขยาย/หักมุม/จบ) + recap context
- **โมเดลชอบลอก placeholder ในวงเล็บ** จาก format example → **แก้: ใช้ตัวอย่างจริง** (ไม่ใช่ `[...]`) + validation reject `[ ]`/คำสั่ง/`scene N`/dialogue ว่าง/ซ้ำช่องก่อน + retry 3 ครั้ง + fallback
- **บอลลูน → caption band ใต้ภาพ** (grilling รอบ 2): บอลลูนเดิมวางบนหัว panel บังหน้า → แถบข้อความ "นอกภาพ" ใต้แต่ละช่อง (ภาพจัตุรัสเต็ม หน้าเห็น 100%)
  - decisions: วางนอกภาพ (รับประกัน 100% ไม่ใช่ overlay/face-detect) · band ใต้ภาพ คงภาพเต็ม เพจสูงขึ้น · script style "ชื่อ: บทพูด" ชื่อสีต่อตัวละคร · แถบสูงเท่ากันทุกช่อง (= ช่องยาวสุด) grid เรียงสวย
  - impl: `cell`=ภาพจัตุรัส + `bandH`(วัดจากช่องข้อความมากสุด) ใต้ภาพ · `SPEAKER_COLORS` map ชื่อ→สี · `wrapText2` wrap บรรทัดแรกหลังชื่อ
- **Dashboard ต้องแยก mode** (grilling รอบ 3): comic job รัน `status='producing'` เหมือนวิดีโอ → active-detection จับเข้า `renderProdCard` (UI วิดีโอ scene) ทำผู้ใช้คิดว่าทำวิดีโอ+comic พร้อมกัน. **แก้:** branch `active.mode==='comic'` → `renderComicCard` (header การ์ตูน + timeline), ซ่อน video stage bar, guard video poll (`ACTIVE_MODE!=='comic'`) + comic poll reload เมื่อ `status==='done'`. workflow แยกถูกต้องอยู่แล้วระดับ execution — เป็น UI bug ล้วน
- **Composition template ตายตัว** (grilling รอบ 4): layout ตัวละครต่อช่องไม่ปล่อย LLM มั่ว → `panelCharTemplate` ใน [comic-gen.js](agents/maprang/pipeline/comic-gen.js): P1=`c0`, P2=`c1`(มิเรอร์), P3=`[c0,c1]`, P4=`ทุกตัวที่เลือก`. `forcePanelChars` บังคับ `characters` + remap ผู้พูดให้ตรงตัวที่โชว์ + `stripSpeakerPrefix` ตัด "ชื่อ:" ที่ LLM เผลอใส่ในบทพูด. composition directive ([comic.js](agents/maprang/pipeline/comic.js) `composition()`): P1-2 หันหน้าคุยกัน (มิเรอร์ ซ้าย/ขวา) · P3-4 ทุกตัวหันหน้ากล้องเห็นหน้าครบ — ผนวกเข้า `scene_setting` ไม่แตะ flux-kontext (video ไม่กระทบ)
- **Shared background ทุกช่อง** (grilling รอบ 5): เดิมแต่ละช่อง gen `scene_setting_en` อิสระ → background ต่างกัน. **แก้:** `deriveSharedSetting()` ถาม Typhoon2 ครั้งเดียวได้ location+เวลา+บรรยากาศ ละเอียด (`meta.shared_setting`) → per-panel LLM gen แค่ **action** (สิ่งที่ตัวละครทำ ผูกบทพูด, ห้ามเปลี่ยนที่) → `scene_setting_en = sharedSetting + ". " + action`. ทุกช่อง location เดียว (Flux ขับ background จาก text เดียวกัน → consistent) + โฟร์กราวด์ต่างตามบท. ยอมรับ: รายละเอียดเล็กอาจต่างบ้าง (ไม่ใช้ background-ref anchor — เกินจำเป็น)

## Consequences

- ✅ ~10 นาที/การ์ตูน (เร็วกว่าวิดีโอ ~10 เท่า), โค้ดง่าย (ไม่แตะ I2V/audio/clip)
- ✅ ตัวละครคงเส้นคงวา (anime_ref) + บทพูดไทย (อ่าน ไม่ต้อง TTS)
- ✅ output รูป — เหมาะโพสต์ FB/IG
- ❌ ไม่มี motion/เสียง (เป็นภาพนิ่ง)
- ⚠️ คุณภาพบท ขึ้นกับ Typhoon2 — มี validation/retry กันพัง แต่บางช่องอาจ fallback

## Glossary

- **comic mode** — โหมดการ์ตูน 4 ช่อง (รูปนิ่ง + บอลลูน), mode ที่ 3
- **panel** — 1 ช่องการ์ตูน = 1 Flux still + บทพูด (ต่างจาก scene/shot ของโหมดวิดีโอ)
- **story beat** — โครง 4 ช่อง: ตั้ง → ขยาย → หักมุม → จบ
