# X (Twitter) Template — Shopee Affiliate

## Goal
Thread 3-4 ทวีต ทวีตแรกต้อง hook ทันที ทวีตสุดท้ายมี affiliate link
แต่ละทวีต ≤ 280 ตัวอักษร (Thai นับเป็น 2 ใน count บางที — เช็ค char counter)

## Variables
เหมือน FB/IG + `{{tweet_count}}` (จำนวน thread)

## Structure: Thread 3 ทวีต (แนะนำ)

### Tweet 1/3 — Hook + Claim หลัก (max 250 chars)
- ตั้ง hook แบบ tweet-worthy: ตัวเลข / สถานการณ์ / opinion
- บอกว่าเป็น thread: ปิดด้วย 🧵 หรือ "👇"
- **ห้ามใส่ link ในทวีตแรก** (Twitter algorithm ลด reach ทวีตที่มี link)

ตัวอย่าง hook:
- "ลองหูฟังไร้สายตัวนี้มา 3 เดือน บอกเลยว่าคุ้มสุดในรอบปี 🧵"
- "ของถูกใจ Shopee เดือนนี้ ตัวเดียวที่ใช้แล้วชีวิตเปลี่ยนจริงๆ"
- "ใครหา X อยู่ thread นี้สำหรับคุณ"

### Tweet 2/3 — Feature + Proof (max 270 chars)
ขยาย 3-4 จุดเด่นแบบสั้น + social proof
ใช้ • หรือ — เป็น bullet เพราะ emoji กิน character

```
{{product_name}}

— {{feature_1}}
— {{feature_2}}
— {{feature_3}}
— {{feature_4}}

รีวิว {{rating}}/5 จาก {{review_count}}+ คน
```

### Tweet 3/3 — Price + CTA + Link (max 250 chars)
```
ราคา {{price}} (ปกติ {{original_price}}, ลด {{discount_percent}}%)

สั่งซื้อ: {{affiliate_link}}

#Shopeeaffiliate
```

## Optional: Thread 4 ทวีต (เมื่อสินค้าซับซ้อน)

แทรก tweet 2 หรือ 3 เพิ่มเป็น:
- ทวีตเปรียบเทียบกับคู่แข่ง
- ทวีต use case / "ใครเหมาะใช้"
- ทวีต FAQ

## Tone X เฉพาะ
- ดิบกว่า FB/IG ได้ มีความเห็นส่วนตัวชัด
- ใช้ "กู / มึง" ไม่ได้ในงาน affiliate (เสี่ยง flag)
- "เรา / ผม / ครับ-ค่ะ" หรือ neutral tone ปลอดภัยกว่า
- emoji 1-2 ตัวต่อทวีต พอ
- ห้าม #hashtag เกิน 2 ตัวต่อทวีต

## Character Count Tips
- ภาษาไทยใน X นับเป็น 1 char ต่อตัวอักษร (ไม่เหมือนภาษาจีน)
- emoji = 2 chars
- URL ย่ออัตโนมัติเหลือ 23 chars เสมอ (รวม https://)
- ใช้ https://twitter.com/Twitter/status/... หรือเช็คใน X composer

## Engagement Hacks
- ปิดท้าย thread ด้วยคำถามให้คนคอมเมนต์ (เช่น "ใครเคยใช้ตัวอื่นบ้าง?")
- Quote-retweet ตัวเองอีก 1-2 ครั้งใน 1 สัปดาห์ เพิ่ม reach
- โพสต์เวลา 12.00, 19.00-21.00 (เวลาไทย active บน X)

---

## ตัวอย่างเต็ม

**Input data:**
- product_name: หูฟัง Bluetooth XYZ Pro ANC
- price: 590
- original_price: 1290
- discount_percent: 54
- features: ANC / แบต 30 ชม. / IPX5 / multipoint 2 device
- rating: 4.8
- review_count: 12500
- affiliate_link: https://s.shopee.co.th/aBcDeF

**Output:**

### Tweet 1/3
```
หูฟังไร้สาย 590 บาท ที่มี ANC + แบต 30 ชม. + กันน้ำ + multipoint

ลองแล้ว 2 อาทิตย์ บอกตรงๆ ว่าคุ้มกว่าตัวพันต้นๆ ที่ใช้มาทั้งหมด

มาดูว่ามันดีจริงไหม 🧵👇
```
[245 chars]

### Tweet 2/3
```
หูฟัง Bluetooth XYZ Pro ANC

— ANC ตัดเสียงรบกวน รถเมล์-ออฟฟิศเงียบลงเยอะ
— แบต 30 ชม. รวมเคส ชาร์จทีใช้ได้ทั้งสัปดาห์
— กันน้ำ IPX5 ใส่ออกกำลังกายได้
— เชื่อม 2 เครื่องพร้อมกัน สลับมือถือ-โน้ตบุ๊กไม่ต้อง pair ใหม่

รีวิว 4.8/5 จาก 12,500+ คน
```
[250 chars]

### Tweet 3/3
```
ราคาตอนนี้ 590 บาท (ปกติ 1,290 ลด 54%)

ช่วงโปรเท่านั้น ใครสนใจดูตัวจริงที่ Shopee:
https://s.shopee.co.th/aBcDeF

#Shopeeaffiliate
```
[145 chars]

### Optional Tweet 4 (engagement)
```
ปล. ใครใช้หูฟังตัวอื่นที่ราคาใกล้กันบ้าง? อยากรู้ว่าเทียบกันยังไง 👀
```

## เช็คก่อนโพสต์
- [ ] ทวีตแรก ≤ 280 chars และ ไม่มี link
- [ ] ทวีตสุดท้ายมี link + #Shopeeaffiliate
- [ ] รูปติด attach 1-4 รูป ที่ทวีต 1 หรือ 2 (เพิ่ม engagement 2-3 เท่า)
- [ ] post เป็น thread จริง ไม่ใช่ทวีตแยก (กด + ในแอป)
