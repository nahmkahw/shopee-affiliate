# Templates Usage Guide

ไฟล์ template ทั้ง 4 ตัวนี้ใช้กับ Claude Cowork สำหรับสร้างคอนเทนต์ Shopee Affiliate

## ไฟล์ในโฟลเดอร์นี้
- `fb-template.md` — Facebook (storytelling 150-300 คำ)
- `ig-template.md` — Instagram (100-150 คำ + hashtag block)
- `x-template.md` — X / Twitter (thread 3-4 ทวีต)
- `tiktok-template.md` — TikTok (script + caption)

## วิธีให้ Cowork ใช้ Template

ใน `CLAUDE.md` ของโปรเจกต์ เพิ่ม:

```markdown
## Content Generation Rules

For each product, generate 4 content pieces using these templates:
- Facebook: follow `templates/fb-template.md`
- Instagram: follow `templates/ig-template.md`
- X: follow `templates/x-template.md`
- TikTok: follow `templates/tiktok-template.md`

Each template specifies:
- Variables to fill from `data.json`
- Structure to follow
- Tone and constraints
- Example output for reference

Save outputs to `products/{product_id}/content/{platform}.md`

ALWAYS:
- Use the affiliate_link given in input, never generate your own
- Include #Shopeeaffiliate (FTC disclosure)
- Do not fabricate features or reviews not in data.json
- Check the "เช็คก่อนโพสต์" checklist at end of each template
```

## Tone Customization
ถ้าอยาก tone เป็น masculine / feminine / neutral
แก้ที่ section "Tone" ของแต่ละ template ให้ชัด
เช่น:
- "ใช้ ครับ ทุกประโยค หลีกเลี่ยง emoji หัวใจ"
- "ใช้ ค่ะ + emoji ดอกไม้ เน้น tone อบอุ่น"
- "neutral ไม่ระบุเพศ ใช้คำว่า 'เรา'"

## Variable Reference

ทุก template ใช้ variable ชุดเดียวกัน (มาจาก `data.json`):

| Variable | ตัวอย่าง |
|---|---|
| `{{product_name}}` | "หูฟัง Bluetooth XYZ Pro ANC" |
| `{{price}}` | 590 |
| `{{original_price}}` | 1290 |
| `{{discount_percent}}` | 54 |
| `{{key_features}}` | ["ANC", "แบต 30 ชม.", "IPX5", "multipoint"] |
| `{{rating}}` | 4.8 |
| `{{review_count}}` | 12500 |
| `{{top_review_snippet}}` | "เสียงดีมาก คุ้มราคา" |
| `{{shop_name}}` | "ABC Audio Official" |
| `{{affiliate_link}}` | "https://s.shopee.co.th/aBcDeF" |
| `{{category}}` | "หูฟัง" / "electronics" |
| `{{product_id}}` | "12345" |

## Update Cycle
ทุก 2-4 สัปดาห์ review template:
- Hashtag ที่เคยเวิร์ก ยังเวิร์กอยู่ไหม
- Trending sound TikTok เปลี่ยนหรือยัง
- Format ของ FB/IG อัลกอเปลี่ยนหรือไม่
- เพิ่ม example ใหม่ที่ engagement ดี
