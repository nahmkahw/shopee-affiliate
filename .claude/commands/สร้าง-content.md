# /สร้าง-content — Generate Social Media Content

สร้าง content โพสต์สำหรับทุก platform จากข้อมูลใน `products/{item_id}/data.json`
บันทึกลงโฟลเดอร์ `products/{item_id}/content/`

Arguments: $ARGUMENTS
- ว่างเปล่า → สร้าง content ทุกสินค้าที่ยังค้างอยู่ (เรียงตาม post_date)
- `YYYY-MM-DD` → สร้างเฉพาะสินค้าที่มี post_date ตรงกับวันนั้น (ดูจาก input/urls.txt คอลัมน์ 1)
- `{item_id}` → สร้างเฉพาะสินค้านั้น

---

## ขั้นตอนที่ 1 — หาสินค้าที่ต้องสร้าง content

รันคำสั่งนี้เพื่อดูสถานะทั้งหมด:

```
node -e "
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const filter = args[0] || '';

const dirs = fs.readdirSync('products').filter(d => fs.existsSync('products/'+d+'/data.json'));
const pending = [];

dirs.forEach(id => {
  const d = JSON.parse(fs.readFileSync('products/'+id+'/data.json','utf8'));
  const postDate = d.post_date || '';
  
  // filter by YYYY-MM-DD (post_date) or item_id
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(filter);
  if (filter && isDate  && filter !== postDate) return;
  if (filter && !isDate && filter !== id) return;
  
  const contentDir = path.join('products', id, 'content');
  const hasFB = fs.existsSync(path.join(contentDir, 'facebook.md'));
  
  if (!hasFB) {
    pending.push({ id, postDate, title: (d.title||'').substring(0,40), price: d.price });
  }
});

// sort by post_date
pending.sort((a,b) => a.postDate.localeCompare(b.postDate));
pending.forEach(p => console.log(p.postDate + ' | ' + p.id + ' | ' + p.title + ' | ' + p.price));
if (pending.length === 0) console.log('NONE');
" -- "$ARGUMENTS"
```

- ถ้าผลลัพธ์ `NONE` → แจ้ง "content ครบทุกสินค้าแล้ว"
- ถ้ามีรายการ → แสดงตารางให้ผู้ใช้เห็นก่อนดำเนินการ

## ขั้นตอนที่ 2 — อ่านข้อมูลสินค้าและ templates

สำหรับแต่ละสินค้าที่ต้องสร้าง ให้อ่าน:
- `products/{item_id}/data.json` — ข้อมูลสินค้า (รวม `post_date`)
- `templates/fb-template.md`
- `templates/ig-template.md`
- `templates/x-template.md`
- `templates/tiktok-template.md`

## ขั้นตอนที่ 3 — สร้าง content ตาม template

**กฎสำคัญ:**
- ห้ามแต่งข้อมูลที่ไม่มีใน data.json
- ใช้ `affiliate_short_link` จาก data.json เท่านั้น
- ต้องมี `#Shopeeaffiliate` ทุก platform
- ภาษาไทย เป็นกันเอง เน้น benefit

**Per Platform:**
- Facebook: 150-300 คำ + storytelling hook
- Instagram: 100-150 คำ + 15-20 hashtag (4 ชั้น)
- X: 3 ทวีต, ทวีตแรกไม่มี link, ทวีตสุดท้ายมี link + #Shopeeaffiliate
- TikTok: script table (TIME | VOICEOVER | VISUAL | ON-SCREEN) + caption 50-80 คำ

**TikTok VOICEOVER — กฎเฉพาะ (สำคัญมาก ระบบ TTS อ่านตรงๆ):**
- VOICEOVER ต้องเป็น **ประโยคภาษาไทยที่พูดได้ทันที** เท่านั้น
- ห้ามใส่: label ("Hook", "CTA", "Key features"), คำอธิบาย, คำสั่ง, bracket []
- ห้ามเริ่มด้วย "สวัสดีค่ะ/ครับ"
- ความยาวต้องสัมพันธ์กับ TIME (เช่น 0:00–0:03 = ประโยคสั้นๆ ~15 คำ, 0:10–0:25 = ~50 คำ)
- ใช้ภาษาพูดเป็นกันเอง ราวกับเพื่อนบอกเพื่อน

**บันทึกไฟล์:**
```
products/{item_id}/content/facebook.md
products/{item_id}/content/instagram.md
products/{item_id}/content/x.md
products/{item_id}/content/tiktok.md
```

สร้างโฟลเดอร์ก่อนเขียน:
```
node -e "const fs=require('fs'); fs.mkdirSync('products/{item_id}/content', {recursive:true});"
```

## ขั้นตอนที่ 4 — อัปเดต tracking.xlsx

```
node -e "
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const headers = ['post_date','item_id','shop_id','title','price','original_price','discount','rating','affiliate_link','fb','ig','x','tiktok','status'];
const rows = [headers];

const dirs = fs.readdirSync('products').filter(d => fs.existsSync('products/'+d+'/data.json'));
dirs.forEach(id => {
  const d = JSON.parse(fs.readFileSync('products/'+id+'/data.json','utf8'));
  const postDate = d.post_date || '';
  const cDir = path.join('products', id, 'content');
  const hasFB  = fs.existsSync(path.join(cDir, 'facebook.md'))  ? '✓' : '';
  const hasIG  = fs.existsSync(path.join(cDir, 'instagram.md')) ? '✓' : '';
  const hasX   = fs.existsSync(path.join(cDir, 'x.md'))         ? '✓' : '';
  const hasTT  = fs.existsSync(path.join(cDir, 'tiktok.md'))    ? '✓' : '';
  const allDone = hasFB && hasIG && hasX && hasTT;
  rows.push([
    postDate,
    d.item_id, d.shop_id,
    (d.title||'').substring(0,50),
    d.price, d.original_price, d.discount, d.rating,
    d.affiliate_short_link,
    hasFB, hasIG, hasX, hasTT,
    allDone ? 'draft' : (d.status || 'scraped')
  ]);
});

// sort by post_date
rows.splice(1, rows.length-1, ...rows.slice(1).sort((a,b) => String(a[0]).localeCompare(String(b[0]))));

const ws = XLSX.utils.aoa_to_sheet(rows);
ws['!cols'] = [{wch:12},{wch:14},{wch:12},{wch:50},{wch:8},{wch:10},{wch:8},{wch:7},{wch:35},{wch:4},{wch:4},{wch:4},{wch:6},{wch:10}];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Schedule');
XLSX.writeFile(wb, 'tracking.xlsx');
console.log('tracking.xlsx updated — '+dirs.length+' products');
"
```

## ขั้นตอนที่ 5 — แสดงสรุป

แสดงตารางเรียงตามวันโพสต์:

```
📅 Content Schedule:

post_date   | item_id      | title                  | FB | IG | X | TikTok
------------|--------------|------------------------|----|----|---|-------
2026-05-20  | 3991346022   | หนังสือติวสอบท้องถิ่น  | ✅ | ✅ | ✅ | ✅
2026-05-21  | 19283435771  | BLISSTECH ที่จับโทรศัพท์| ✅ | ✅ | ✅ | ✅
...
```

แล้วแจ้ง:
```
✅ สร้าง content เสร็จแล้ว!
📁 ดู draft ได้ที่ products/{item_id}/content/
📊 ตารางโพสต์อัปเดตแล้วที่ tracking.xlsx
⚠️ กรุณาตรวจสอบก่อนโพสต์ตามวันที่กำหนด
```
