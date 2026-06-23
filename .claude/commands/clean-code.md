---
name: clean-code
description: Audit the codebase for clean code violations — files over 300 lines, duplicate logic, dead code, and shared logic not yet extracted to lib/.
---

ทำ full clean code audit ตาม 4 gates ใน CLAUDE.md โดยใช้ข้อมูลจาก codebase จริง ห้ามเดา

## ขั้นตอน

### 1. Gate 1 — Size violations
รัน:
```bash
find . -name "*.js" \
  -not -path "*/node_modules/*" \
  -not -path "*/.git/*" \
  -not -path "*/html/*.js" \
  | xargs wc -l 2>/dev/null \
  | awk '$1 > 300 {print $1, $2}' \
  | sort -rn
```
และ test files >500 บรรทัด:
```bash
find ./tests -name "*.test.js" | xargs wc -l 2>/dev/null | awk '$1 > 500 {print $1, $2}'
```

รายงาน: ไฟล์ที่เกิน + จำนวนบรรทัด + แนะนำว่าควร split ยังไง

### 2. Gate 2 — Shared logic ที่ยังไม่ได้อยู่ใน lib/
หา logic ที่ซ้ำกันระหว่าง pipeline files:
```bash
# หา function ที่นิยามซ้ำในหลายไฟล์
grep -rn "^function \|^async function \|^const .* = function\|^const .* = async" \
  agents/ --include="*.js" \
  | grep -v node_modules \
  | sed 's/:.*function /: /' \
  | sort
```
เปรียบเทียบกับ `lib/` — ถ้าพบ function ชื่อเดียวกันหรือ logic คล้ายกันในหลายที่ → flag

### 3. Gate 3 — Duplication ใน lib/ เอง
```bash
grep -rn "^function \|^async function " lib/ --include="*.js"
```
ตรวจว่ามี helper ที่ทำงานคล้ายกัน 2 ตัวใน lib/ หรือเปล่า

### 4. Gate 4 — Dead code
หา require ที่ชี้ไปไฟล์ที่ไม่มีอยู่จริง:
```bash
grep -rn "require\('\./\|require('\.\.\/" agents/ lib/ --include="*.js" \
  | grep -v node_modules
```
แล้ว verify แต่ละ path ว่าไฟล์ยังอยู่จริง

หา exports ที่ไม่มีใคร require:
```bash
# สำหรับแต่ละ lib/*.js — ตรวจว่ามีไฟล์ไหน require มันบ้าง
for f in lib/*.js; do
  name=$(basename "$f" .js)
  count=$(grep -rn "require.*$name" . --include="*.js" --exclude-dir=node_modules | wc -l)
  if [ "$count" -eq 0 ]; then echo "DEAD: $f (ไม่มีใคร require)"; fi
done
```

## Output format

สรุปผลในรูป:

```
## Clean Code Audit — $(date)

### Gate 1 — Size violations
- [WARN] path/to/file.js: 423 บรรทัด (+123 เกิน limit)
  แนะนำ: split เป็น file-core.js + file.js wrapper

### Gate 2 — Logic ที่ควรอยู่ใน lib/
- [WARN] agents/manao/pipeline/foo.js:45 มี sendTelegram() ที่ซ้ำกับ lib/tg-approval.js
  แนะนำ: ใช้ lib/tg-approval.js แทน

### Gate 3 — Duplication ใน lib/
- [OK] ไม่พบ duplication

### Gate 4 — Dead code
- [WARN] lib/old-helper.js ไม่มีไฟล์ไหน require
  แนะนำ: ลบทิ้ง

### สรุป
- violations: X
- แนะนำให้แก้ทันที: Y รายการ
- แนะนำให้แก้ตอน touch ไฟล์ (legacy): Z รายการ
```

ถ้าพบ violations ให้ถาม user ว่าต้องการแก้ไขทันทีหรือแค่รายงาน
