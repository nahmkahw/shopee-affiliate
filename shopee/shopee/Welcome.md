# LLM Wiki

Personal knowledge base ที่ LLM เป็นคนเขียนและดูแล — คุณแค่ curate sources และถามคำถาม

## เริ่มต้นใช้งาน

### 1. เพิ่ม Source
วาง markdown/PDF ลงใน `raw/` แล้วบอก Claude:
> "ingest `raw/ชื่อไฟล์.md`"

Claude จะอ่าน สรุป และอัปเดต 5-15 หน้าใน wiki อัตโนมัติ

### 2. ถามคำถาม
> "สรุปสิ่งที่รู้เกี่ยวกับ [หัวข้อ]"
> "เปรียบเทียบ [A] กับ [B]"
> "อะไรคือ pattern ที่เห็นใน sources ทั้งหมด?"

คำตอบที่ดีจะถูก file เป็นหน้าใหม่ใน `wiki/syntheses/`

### 3. ตรวจสุขภาพ Wiki
> "lint the wiki"

Claude จะหา contradictions, orphan pages, และ missing links

---

## โครงสร้าง

| โฟลเดอร์ | ใช้ทำอะไร |
|-----------|-----------|
| `raw/` | Source documents (คุณวาง, LLM อ่าน) |
| `wiki/` | หน้า wiki ทั้งหมด (LLM เขียนและดูแล) |
| `wiki/index.md` | Index ของทุกหน้า |
| `wiki/log.md` | บันทึกกิจกรรมทั้งหมด |
| `wiki/overview.md` | Synthesis ภาพรวม |

## Navigation

- [[wiki/index|Index]] — ทุกหน้าใน wiki
- [[wiki/overview|Overview]] — ภาพรวม synthesis
- [[wiki/log|Log]] — ประวัติกิจกรรม
