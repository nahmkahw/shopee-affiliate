# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## PR Workflow

ทุกครั้งที่เพิ่มฟีเจอร์ใหม่หรือแก้ไขโค้ดนัยสำคัญ ให้ทำตามขั้นตอนนี้:

1. **สร้าง branch + Draft PR ก่อนเขียนโค้ด** — ระบุ description ว่าจะทำอะไรและทำไม
2. **อัปเดต CLAUDE.md ใน PR เดียวกัน** — เพิ่ม 1 bullet สรุปสิ่งที่เปลี่ยนแปลง (Architecture, Behavior, หรือ Rule ที่เกี่ยวข้อง)
3. เขียนโค้ด → commit → mark PR ready for review

> **แยก agent ให้ชัดเจน:** ถ้าจะเริ่มงานของ agent ใหม่/คนละตัว ให้ `git checkout master && git pull && git checkout -b feat/<agent>-<งาน>` ก่อนเริ่มเสมอ — อย่าต่อ commit บน branch ของ agent อื่น (เคยเกิด: งาน maprang ไปกองบน `feat/mammuang-flux-kontext` ทำให้ PR ปน 2 agent แยกยาก)

> งานเล็ก (bug fix, แก้ config) ไม่ต้องทำ Draft PR ก่อนได้ แต่ยังต้องอัปเดต CLAUDE.md ถ้ามีผลต่อ architecture หรือ behavior

### Claude ต้องถามก่อนเขียนโค้ดเสมอ (Blocking Requirement)

**ก่อนเริ่มเขียนโค้ดสำหรับ feature ใหม่ Claude ต้องทำขั้นตอนนี้ก่อน — ห้ามข้าม:**

```
1. แจ้งว่างานนี้เป็น "feature ใหม่" หรือ "แก้ไขนัยสำคัญ" หรือ "bug fix เล็ก"
2. ถ้าเป็น feature ใหม่ → ขอ confirm จาก user ว่าจะสร้าง branch + Draft PR ก่อน
3. รอ user ตอบ "ใช่" แล้วค่อยสร้าง branch → เปิด PR → เขียนโค้ด
```

**สัญญาณที่บ่งบอกว่าเป็น feature ใหม่ (ต้อง PR):**
- สร้างไฟล์ใหม่ > 1 ไฟล์
- เพิ่ม agent ใหม่ หรือ route ใหม่
- เปลี่ยน behavior ที่ user-facing (Telegram, dashboard, posting)
- แตะ `agent-hub/index.js`, `agent-hub/agents.js`, หรือ `lib/`

**ห้าม classify เป็น "bug fix" ถ้า:**
- งานสร้าง module ใหม่ทั้งหมด
- งานเพิ่ม capability ที่ไม่เคยมี

---

## Code Rules

**Invariants — ห้ามละเมิด:**
- ห้าม `require('../agent-hub.js')` หรือ `require('./agent-hub.js')` โดยตรง — entry point คือ `agent-hub/index.js` เท่านั้น
- เวลาต่ออายุ `FB_ACCESS_TOKEN` อัปเดตที่ **root `.env` ไฟล์เดียว** — ทุก Agent โหลดจากที่เดียวกัน
- ห้าม commit `.env` ไม่ว่ากรณีใด
- **ComfyUI submit จุดใหม่ทุกจุดต้อง wrap ด้วย `withGpuLock(label, fn)`** ([lib/gpu-lock.js](lib/gpu-lock.js)) — ไม่งั้น bypass mutex แล้ว submit ชนกัน → client timeout ตอนรอคิว (ดู [ADR](docs/ADR-comfyui-gpu-queue.md))

**Test gotchas:**
- ห้ามใช้ `jest.resetModules()` ใน `beforeEach` — ทำให้ mock ของ `child_process`/`fs` หลุดออกจาก module ที่โหลดแล้ว, crash แบบ silent ที่ไม่มี stack trace ชัดเจน
- `require` module ที่ต้องการ mock ที่ **top-level** ของ test file ครั้งเดียว, ใช้ `jest.clearAllMocks()` ใน `beforeEach` แทน

**Ripple effects — เวลาแก้ไฟล์เหล่านี้ ต้องอัปเดตที่อื่นด้วย:**
- `agent-hub/agents.js` — export ใหม่ต้องเพิ่มใน `agent-hub/index.js` ด้วย
- **สร้าง Agent ใหม่** → ต้องทำครบ 3 ขั้นตอนเสมอ:
  1. เพิ่ม entry ใน `agent-hub/agents.js` (AGENTS object) — card จะปรากฏใน Hub อัตโนมัติ
  2. สร้าง `agent-hub/routes/{name}.js` + register ใน `agent-hub/index.js`
  3. สร้าง `agents/{name}/run.js` เป็น entry point รับ `--action` flag
- `agent-status.json` schema — กระทบ `agents/*/run.js` ทุกตัวที่ `readStatus`/`writeStatus`
- `.env` keys ใหม่ — ต้องเพิ่มใน root `.env` และอัปเดต section Environment ใน `CLAUDE.md`
- `agent-hub/routes/manao/` หรือ `namkhao/` — sub-handler ใหม่ต้อง import และ dispatch ใน `manao.js` / `namkhao.js` ด้วย

---

## Clean Code — Auto-Checks (ทำทุกครั้งที่สร้างหรือแก้ไขไฟล์)

ก่อน/หลังทุก Edit หรือ Write ให้ผ่าน 4 gate นี้เสมอ:

### Gate 1 — Size
**Hard limit: 300 บรรทัดต่อไฟล์** (test files: 500 บรรทัด)
- ก่อนแก้ไข: นับบรรทัดปัจจุบันด้วย `wc -l <file>` หรือดูจาก Read tool
- ถ้าหลังแก้แล้วจะเกิน limit → **หยุดทันที แจ้ง user + เสนอ split plan ก่อน ห้ามดำเนินการต่อ**
- ยกเว้น: ไฟล์ HTML template ล้วน (`html/*.js`) ที่ไม่มี business logic

### Gate 2 — Shared Logic → lib/
- Logic ที่ถูกใช้ (หรืออาจถูกใช้) ใน pipeline >1 ที่ → ต้องอยู่ใน `lib/` เสมอ
- Pipeline-specific file ต้องเป็น **thin wrapper** (~10–20 บรรทัด) ที่ `require` จาก `lib/`
- ตัวอย่าง pattern ที่ถูก: `lib/comfy-news.js`, `lib/tg-approval.js`, `lib/news-prompts.js`
- `lib/` module รับ dependency ผ่าน **params** (dependency injection) ไม่ใช่ global closure
- ก่อนเขียน function ใหม่ใน pipeline file → grep `lib/` ว่ามีอยู่แล้วหรือเปล่า

### Gate 3 — Duplication
- ก่อนเขียน logic ใหม่ → `grep -rn "function <name>\|const <name>" lib/` + ไฟล์ใกล้เคียง
- ถ้าพบ logic คล้ายกัน 2+ ที่ → extract ไป `lib/` แทนที่จะ copy-paste
- ห้ามมี implementation เดียวกัน 2 ไฟล์ (เช่น `fixMixedThaiEng` ต้องอยู่ใน `lib/thai-text.js` ที่เดียว)

### Gate 4 — Dead Code
- หลัง refactor: ตรวจว่า require/function เดิมยังมีใครเรียกอยู่ไหม
  ```bash
  grep -rn "require('./comfy-gen')" .      # ตัวอย่าง: ถ้าไม่พบ → ลบได้
  grep -rn "functionName" --include="*.js" .
  ```
- ถ้า module ไม่มี caller → ลบทิ้งทันทีอย่าปล่อยไว้เป็น legacy

> **ไฟล์ที่เกิน 300 บรรทัดอยู่แล้ว (legacy):** refactor เมื่อแตะไฟล์นั้นตามธรรมชาติ ไม่ต้อง refactor ทันที แต่ห้ามเพิ่มบรรทัด

---

## Role

Content creator assistant for Shopee Affiliate marketing — ตั้งแต่ดึงข้อมูลสินค้า สร้าง content ไปจนถึงโพสต์ขึ้น Social Media อัตโนมัติ

---

## Skills (Slash Commands)

| คำสั่ง | หน้าที่ |
|--------|---------|
| `/ดึงสินค้า-อัตโนมัติ` | เข้า affiliate portal → คลิก "เอาลิงค์" ทุกสินค้า → บันทึก affiliate link ลง `input/urls.txt` |
| `/ดึงสินค้า` | ตรวจ Chrome → dry-run confirm → รัน `scrape.js` → บันทึก `data.json` + `images/` |
| `/สร้าง-content [YYYY-MM-DD หรือ item_id]` | สร้าง content จาก `data.json` → บันทึก `content/*.md` → อัปเดต `tracking.xlsx` |
| `/สร้างวิดีโอ [YYYY-MM-DD หรือ item_id]` | อ่าน `tiktok.md` → สร้างวิดีโอด้วย FFmpeg → บันทึก `video.mp4` (ถ้าไม่มี FFmpeg → สร้าง `capcut.md` แทน) |
| `/โพสต์ [YYYY-MM-DD หรือ item_id] [--platform fb,ig,x]` | โพสต์ content ไปยัง FB/IG/X ผ่าน API — TikTok แสดง caption ให้ copy เอง |

รายละเอียดแต่ละ skill อยู่ใน `.claude/commands/`
คู่มือฉบับเต็ม (วิธีเปิด Chrome, troubleshooting): `GUIDE.md`

---

## Architecture

```
shopee-affiliate/
├── scrape.js / scrape-offers.js  ← Playwright scrapers
├── post.js                ← โพสต์ FB / IG / X ผ่าน API
├── approval-bot.js        ← Telegram Bot: preview → Approve → โพสต์ FB
├── make-tiktok-video.js   ← TikTok video entry point → lib/tiktok-*
├── agent-hub/             ← Multi-agent control hub (port 3002)
│   ├── index.js           ← HTTP server — entry point
│   ├── agents.js          ← startAgent / stopAgent / spawnStep
│   ├── routes/            ← mali.js | manao.js+manao/ | namkhao.js+namkhao/ | anime.js | common.js
│   └── html/              ← dashboard HTML builders
├── lib/                   ← shared helpers ใช้ข้าม agents
│   ├── namkhao-bot-news.js      ← approval callbacks (ใช้ทั้ง manao + makrut + maprao — schedulePost/postNow)
│   ├── namkhao-bot-scheduler.js ← schedule loop + trigger logic
│   ├── tg-approval.js           ← ส่ง Telegram preview + inline Approve (ใช้ NAMKHAO bot token เสมอ)
│   ├── gpu-lock.js              ← ComfyUI mutex ข้าม agent (withGpuLock — กัน timeout ตอนรอคิว)
│   ├── comfy-client-core.js     ← generic ComfyUI HTTP client (checkHealth/submitImageWorkflow/uploadImageToComfy)
│   ├── flux-kontext.js          ← Character-consistent scene stills (ใช้ทั้ง maprang + maprao)
│   ├── ollama-chat.js           ← generic Ollama /api/chat client (Typhoon2)
│   ├── bot-lock.js              ← single-instance PID lock (Telegram bots — กัน 409)
│   └── tiktok-*.js / telegram.js / fb-post.js / approval-flow.js / …
├── agents/
│   ├── mali/run.js        ← Agent มะลิ (Shopee Affiliate)
│   ├── manao/pipeline/    ← Agent มะนาว — generate.js → lib/ + agents/ + post.js
│   │                        post.js ใช้ PIPELINE_ROOT env รองรับหลาย pipeline
│   ├── makrut/pipeline/   ← Agent มะกรูด (FIFA World Cup) — ใช้ post.js ของ manao ร่วม
│   ├── namkhao/           ← Agent น้ำข้าว (Supervisor + Telegram bot + scheduler)
│   ├── maprang/pipeline/  ← Agent มะปราง (Anime Story Video/Comic)
│   ├── maprao/pipeline/   ← Agent มะพร้าว (B&W Manga Comic Strip) — reuse post.js ของ manao ร่วม
│   └── anime/             ← Anime image generator
├── input/urls.txt         ← รายการสินค้า (format: URL | affiliate_link | YYYY-MM-DD)
├── products/{item_id}/    ← ข้อมูล + content ต่อสินค้า
└── .env                   ← Credentials (ห้าม commit)
```

### Data Flow

**Shopee Affiliate:**
```
input/urls.txt
    → scrape.js (Playwright + Chrome debug port 9222)
    → products/{item_id}/data.json + images/
    → /สร้าง-content (Claude Code)
    → products/{item_id}/content/*.md
    → approval-bot.js (Telegram preview)
    → post.js (FB Graph API / IG carousel / X thread)
```

**AI News (manao / makrut):**
```
RSS/scrape → generate.js (Ollama Typhoon2) → news/{slug}/content/
    → formatter-agent.js → Telegram approval
    → [Approve] → lib/namkhao-bot-news.js → post.js --schedule --platform fb
```

### Agent Hub (port 3002)

`agent-hub/index.js` เป็น HTTP server ควบคุม sub-agents ผ่าน web UI:
- **Daily PR Scheduler** — ทุกเที่ยงคืน (Bangkok) รัน `daily-pr.js` อัตโนมัติ
- `/dashboard/mali` — Shopee Affiliate status
- `/dashboard/manao` — Reuters AI News pipeline
- `/dashboard/namkhao` — Supervisor + schedule status
- Spawn/kill node processes ผ่าน `child_process.spawn`
- อ่าน/เขียนสถานะกลางที่ `agent-status.json`
- แต่ละ route module export `register(req, res, url, rawUrl, method, deps)` — ไม่ใช้ Express
- route ที่ซับซ้อน (`manao`, `namkhao`) แยก sub-handler ไว้ใน sub-directory ชื่อเดียวกัน

### Agent มะลิ (`agents/mali/run.js`)

รับ `--action` flag: `status` | `scrape` | `create-content` | `approve-today`

**approval-bot.js พฤติกรรม:**
- ใช้ `MALI_TELEGRAM_BOT_TOKEN` (fallback → `TELEGRAM_BOT_TOKEN`)
- กด Approve → โพสต์ **FB เท่านั้น** แบบ `--schedule` (IG ข้าม เพราะ IG ไม่รองรับ schedule)
- FB Reels ใช้ Page Access Token (แลกจาก User Token ใน `agent-hub/index.js` อัตโนมัติ)

### Agent มะนาว (`agents/manao/pipeline/`)

Scheduler ใน namkhao bot ทริกเกอร์ที่ **07:00 และ 13:00 BKK**

**กรณีบทความค้าง (status = `pending_approval`):**
```powershell
cd agents\manao\pipeline
node -e "
const fs = require('fs');
const glob = require('glob');
glob.sync('news/*/data.json').forEach(f => {
  const d = JSON.parse(fs.readFileSync(f,'utf8'));
  if (d.status === 'pending_approval') { d.status = 'approved'; fs.writeFileSync(f, JSON.stringify(d,null,2)); console.log('fixed:', f); }
});
"
node post.js --pending --platform fb --schedule
```

**กรณี Telegram ไม่ส่ง approval (resend):**
```powershell
node agents\manao\pipeline\agents\formatter-agent.js --resend
# หรือผ่าน makrut:
node agents\makrut\pipeline\makrut.js --resend
```

> ✅ `start-all-agents.bat` รันซ้ำได้ปลอดภัย (idempotent) — bot มี **PID-liveness lock** ([lib/bot-lock.js](lib/bot-lock.js)): ถ้ารันอยู่แล้ว lock ปฏิเสธตัวใหม่ (ไม่ kill ตัวที่ทำงาน, กัน 409), ถ้าตาย/lock ค้าง → ล้าง+start ใหม่อัตโนมัติ. ใช้ร่วม namkhao/anime/mammuang bot. (manao/pipeline telegram-bot.js = legacy, retire แล้ว — ไม่ start)

### Agent มะม่วง — Flux Kontext mode (`agents/mammuang/mammuang-gen.js`)

`generateMammuang({ model: 'flux-kontext' })` ใช้ Flux Kontext FP8 local inference สำหรับ character consistency:
- Reference image อยู่ที่ `agents/mammuang/ref-character.jpg` (fixed, วางไว้ล่วงหน้า)
- Workflow: `ReferenceLatent` + `FluxKontextMultiReferenceLatentMethod` lock character จาก ref image
- Models ที่ต้อง install บน ComfyUI ก่อนใช้งาน: `flux1-kontext-dev-fp8.safetensors`, `t5xxl_fp8_e4m3fn.safetensors`, `clip_l.safetensors`, `ae.safetensors`
- SDXL workflows เดิม (`buildWorkflow`, `buildWorkflowWithRef`) ยังคงทำงานได้ปกติ

### Agent มะปราง (`agents/maprang/`) — Anime Story Video

3-stage: pre-production (storyboard + char_ref) → generate-scene → build (TTS + subtitle + concat).

**3 โหมด output:** (เลือกจาก dashboard dropdown `gen-mode` → route แตก action)
| โหมด | output | กลไก | เวลา |
|---|---|---|---|
| **narration** (เดิม) | วิดีโอ | Flux still → Ken Burns + เสียงพากย์ (`MAPRANG_ANIMATE=kenburns`) | ~18 นาที |
| **dialogue** ([ADR-002](agents/maprang/docs/ADR-002-dialogue-i2v-mode.md), ออกแบบไว้ ยังไม่ build) | วิดีโอ | shot-list → Wan I2V motion | ~1.5-2 ชม. |
| **comic** ([ADR-003](agents/maprang/docs/ADR-003-comic-mode.md)) | รูป .png | 4 panel Flux still + บอลลูนคำพูด | **~10 นาที** |

> **Comic mode (`--action comic`):** การ์ตูน 4 ช่อง — ตัด I2V (วัดจริง 7.8 นาที/shot บน 3060 = คอขวด) ออก เหลือ Flux Kontext still ต่อช่อง. modules: [comic-gen.js](agents/maprang/pipeline/comic-gen.js) (Typhoon2 gen **ทีละ panel** + validation/dedup — โมเดล 8B ทำ multi-item JSON ไม่ครบ), [comic-build.js](agents/maprang/pipeline/comic-build.js) (`@napi-rs/canvas` grid 2×2 + บอลลูนไทย), [comic.js](agents/maprang/pipeline/comic.js) (orchestrator). output `gallery/{id}/comic.png`, meta `mode:'comic'`. env: `MAPRANG_COMIC_PANELS`(4)/`MAPRANG_COMIC_SIZE`(1080)/`MAPRANG_COMIC_MAXLINE`(40)

**2-stage anime_ref (สำคัญ — แก้ ref รูปถ่ายจริง → anime แล้ว identity/เพศ/อายุหลุด):** ดู [ADR-001](agents/maprang/docs/ADR-001-anime-ref-2stage.md)
- ปัญหา: ref ที่อัปโหลดเป็น**รูปถ่ายจริง** (photoreal) แต่ output เป็น anime → Flux Kontext แปลง+คงอัตลักษณ์พร้อมกันไม่ไหว (domain gap) → หน้า/เพศ/อายุ collapse
- **Stage-0** ([anime-portrait.js](agents/maprang/pipeline/anime-portrait.js)): รูปถ่าย → canonical anime portrait (`anime_ref`) ครั้งเดียวต่อตัวละคร ด้วย **IPAdapterFaceID (FACEID PLUS V2) + AnythingXL** — InsightFace ครอป+align หน้าให้ในตัว. Stage-1/2 เดิมใช้ `anime_ref` เป็น anchor (domain เดียวกับ output → identity คงตัว)
- char-registry: field ใหม่ `anime_ref` (anchor จริง) แยกจาก `ref_image` (รูปถ่ายต้นฉบับ) + `gender` (structured: male/female). `resolveSceneRefs`/`collectCharRefs` อ่าน `anime_ref` ?? `ref_image`
- เพศ lock 2 ชั้น: Stage-0 portrait prompt + `buildSceneCharNeg` (ปฏิเสธเพศตรงข้ามถ้าทุกตัวเพศเดียวกัน); อายุ = band หยาบ กันออกมาเป็นเด็ก
- auto: อัปโหลดรูป → route spawn `--action gen-anime-ref` อัตโนมัติ; AI-gen (`gen-char-image`) ได้ anime อยู่แล้ว → `anime_ref` = `ref_image`
- **guard:** route `/api/maprang/generate` block ถ้าตัวละครที่เลือกยังไม่มี `anime_ref`/`ref_image` (กัน race ที่ทำ `char_refs` หาย → fallback T2V)
- models บน ComfyUI: `AnythingXL_xl.safetensors`, `ip-adapter-faceid-plusv2_sdxl.bin`, InsightFace (CUDA); env: `MAPRANG_FACEID_WEIGHT` (1.0), `PORTRAIT_TIMEOUT_MS` (300000), `MAPRANG_IPA_PROVIDER` (CUDA)

**Character consistency (สำคัญ):** scene clip **ไม่ใช้ T2V ล้วน** (วาดตัวละครใหม่ทุก scene → หน้าตาเปลี่ยน) แต่ใช้ **Flux Kontext anchor**:
- `char_ref.png` (สร้างครั้งเดียวใน pre-production) = identity anchor
- ทุก scene: `flux-kontext.js` `generateSceneImage()` วางตัวละครเดิมลงฉากใหม่ → `still_N.png` (หน้า/ผม/ชุด คงเดิม)
- animate still → clip: **Ken Burns** (default, pan/zoom, ตัวละครคงเดิม 100%) หรือ I2V ถ้า `MAPRANG_ANIMATE=i2v`
- fallback → Wan2.1 T2V เดิม ถ้าไม่มี `char_ref.png` หรือ Kontext ล้มเหลว
- gender bug guard: `scene-gen.js` `detectGender()`/`enforceGender()` กัน Typhoon2 หลุดเพศ (เคยได้ "1boy" จาก story เด็กหญิง)
- models บน ComfyUI: `flux1-dev-kontext_fp8_scaled.safetensors`, `clip_l.safetensors`, `t5xxl_fp8_e4m3fn.safetensors`, `ae.safetensors`
- env: `KONTEXT_TIMEOUT_MS` (default 420000), `MAPRANG_ANIMATE` (kenburns|i2v)
- `scene_setting_en` ใน meta scene = คำบรรยายฉากล้วน (ป้อนเป็น Kontext instruction)

**Narration sync (กันเสียงเล่าเรื่องขาด):** clip ความยาวคงที่ 3s แต่ narration ยาว 6-12s → `-shortest` เคยตัดเสียง แก้โดย:
- `scene-gen.js` `capNarration()` จำกัด narration ≤ 60 ตัวอักษร (≈ ≤8s TTS) + prompt ขอ 1 ประโยคสั้น
- `post-production.js` สร้าง TTS **ก่อน** → วัดความยาว → สร้าง clip ยาว `clamp(ttsDur, 3, MAX_SCENE_SEC)` (Ken Burns ใหม่จาก still / `extendClipToDuration` ค้างเฟรมท้ายสำหรับ T2V)
- env: `MAPRANG_MAX_SCENE_SEC` (default 8)

**Multi-character dialogue + เสียงแยกตัวละคร (Level A):** ตัวละครพูดคุยได้ เสียงต่างกัน (ปากไม่ขยับ — แบบละครวิทยุ/นิทานมีเสียงพากย์):
- scene เพิ่ม `dialogue: [{speaker, line_th, pitchK}]` — `scene-gen.js` สร้างจาก Typhoon2 + assign `pitchK` ต่อ speaker (`assignPitch`/`mapDialogue`)
- **TTS = gTTS + ffmpeg pitch shift** (`lib/dialogue-audio.js` `VOICE_PROFILES`/`pickVoiceK`) — *ไม่ใช้ edge-tts* เพราะ rate-limit ไม่เสถียร แม้มีเสียงไทย 2 เสียงจริง
- `lib/tiktok-tts.js` `generateVoiceover(text, out, {pitchK})` — `asetrate*K, atempo=1/K` คงความยาว (K<1 ทุ้ม, K>1 แหลม)
- `assembleSceneAudio()` ต่อ narration + บทพูดแต่ละตัว (เว้น gap) → track เดียว → clip ยาวเท่า audio
- voice: narrator=1.0, male=0.85/0.78/0.92, female=1.12/1.20/1.06, child=1.28, elder=0.72 (idx กันเสียงซ้ำ)
- env: `MAPRANG_MAX_DIALOG_SEC` (default 24 — scene บทสนทนายาวกว่า narration ปกติ)
- ⚠️ subtitle ยังเป็น `subtitle_th` รวม (timed per-speaker subtitle + lip-sync = งานต่อยอด Level B)

**กำหนดตัวละครเอง + วิดีโอหลายตัวละคร:** ตัวละครคงหน้าตาข้ามฉาก แม้หลายตัวในเฟรมเดียว:
- define ตัวละครผ่าน dashboard (`/api/maprang/characters`) — เก็บใน `agents/maprang/characters.json` (char-registry)
- ref image ต่อตัว 2 ทาง: **AI สร้าง** (`POST .../characters/:id/generate` → spawn `run.js --action gen-char-image`) หรือ **อัปโหลดเอง** (`POST .../characters/:id/image` raw body) → เก็บใน `agents/maprang/characters/{id}.png`, `ref_image` ใน registry
- multi-char scene: `flux-kontext.js` `generateSceneStill(refs[])` → `ImageStitch` ต่อรูป ref 2-3 ตัว (ซ้าย→ขวา) → Flux Kontext วางทุกตัวลงฉากคงหน้าตา (de-risk แล้ว: identity คงข้ามฉาก)
- `pre-production.js` `collectCharRefs()` → multi-char job เก็บ `meta.char_refs{id:absPath}` + `char_names` (gen รูปให้ถ้ายังไม่มี)
- `run.js` `resolveSceneRefs` ([scene-refs.js](agents/maprang/pipeline/scene-refs.js)) → เลือก refs ตาม `scene.characters` → `actionGenerateScene` ใช้ multi-ref; เสียงแยกตัว auto ตามเพศ (`detectGenderEn`)
- ⚠️ หลายตัว interact กัน (ท่าทาง) ยังไม่เป๊ะ 100% — ปรับด้วย instruction; ~2.5 นาที/ฉาก (Flux Kontext)

### Agent มะพร้าว (`agents/maprao/`) — B&W Manga Comic Strip

สร้างการ์ตูนช่อง 4 ช่อง (2×2 grid) ลายเส้นขาวดำแบบ manga ink จาก Story Prompt ที่ user พิมพ์ — ตัวเอกเป็น **Mascot** กระต่าย chibi ตัวเดียวคงที่ (ไม่มี character registry แบบมะปราง) ดู domain glossary เต็มที่ [agents/maprao/docs/CONTEXT.md](agents/maprao/docs/CONTEXT.md)

- **Architecture:** agent แยกจากมะปรางทั้งหมด แต่ share logic ที่เป็น generic ผ่าน `lib/` — ดึง `lib/comfy-client-core.js`, `lib/flux-kontext.js`, `lib/ollama-chat.js` ออกมาจากของมะปรางเดิม (Gate 2) ให้ทั้งสอง agent require ร่วมกัน
- **Mascot Ref:** สร้างครั้งเดียวผ่าน `--action gen-mascot-ref` (AnythingXL T2I, prompt B&W manga ink) → `agents/maprao/mascot-ref.png` + `mascot.json` — ใช้เป็น anchor ทุก Panel ผ่าน `lib/flux-kontext.js` `generateSceneStill()` (เหมือนมะปราง แต่ ref เดียวไม่ต้อง registry)
- **B&W style:** ควบคุมผ่าน prompt เท่านั้น (`STYLE_SUFFIX` ใน `pipeline/comic.js`) — **ไม่บังคับ grayscale post-process** (deliberate trade-off, ดู [CONTEXT.md](agents/maprao/docs/CONTEXT.md))
- **Bubble:** พูด/คิดในช่อง (ไม่ใช่ caption band แบบมะปราง) — 0-1 Bubble/Panel, fixed-corner position ไม่คำนวณหลบตัวละคร ([ADR-002](agents/maprao/docs/ADR-002-fixed-corner-bubble-placement.md)) + Footer Caption ปิดท้ายเรื่อง
- **Approval + Post:** reuse namkhao bot approval infra ทั้งหมด (**ไม่ใช่บอทของมะปรางเอง** — มะปรางไม่มี callback handler, ดู [ADR-001](agents/maprao/docs/ADR-001-shared-telegram-bot.md)) — เขียน `agents/maprao/pipeline/news/{id}/` (data.json + content/facebook.md + image.jpg) ให้ตรง shape ที่ `post.js` คาดหวัง แล้วเรียก `lib/tg-approval.js` `sendApprovalNotification(..., { mode: 'immediate' })` → namkhao bot callback → `lib/namkhao-bot-news.js` `postNow()` (ฟังก์ชันใหม่ คู่กับ `schedulePost()` เดิม — โพสต์ทันทีไม่มี `--schedule`)
- **Trigger:** on-demand เท่านั้นผ่าน dashboard (`/dashboard/maprao`, `/api/maprao/generate`) — ไม่มี scheduler/cron ประจำวัน
- **News-to-Comic Pipeline:** 2 entry points เข้า pipeline เดียวกัน:
  1. **Dashboard:** section "📰 สร้างจากข่าว" — dropdown ข่าว 7 วันล่าสุดจาก manao+makrut (`GET /api/maprao/news`) → เลือก comic หรือ video → `POST /api/maprao/generate-from-news` → Typhoon2 `summarizeNewsToStory()` → spawn `run.js --action comic|comic-video`
  2. **Telegram:** ทุก approval message ของ manao+makrut มีปุ่มแถวที่ 2 — 🥥 การ์ตูน 4 ช่อง / 🎬 สร้างวิดีโอ (`lib/tg-approval.js` `addMapraoButtons: true`) → callback handler `lib/namkhao-bot-news.js` → spawn `run.js --action comic-from-news --source manao|makrut --slug <slug> [--mode video]` → อ่าน news data.json → `summarizeNewsToStory()` → pipeline ปกติ; maprao approval message ของตัวเองไม่มีปุ่มนี้ (circular)
- **Video (Reels/TikTok):** กด 🎬 ใน Gallery → `--action video` → [`agents/maprao/pipeline/comic-video.js`](agents/maprao/pipeline/comic-video.js):
  - Title card (2s) → Panel 1-4 (Ken Burns still + Typhoon2 narration Hook/Setup/Twist/Punchline + gTTS ภาษาไทยล้วน + bubble subtitle) → concat → `gallery/{id}/story.mp4`
  - `extractThaiText()` กรอง Latin/pipe ก่อนส่ง TTS; `MAPRAO_TTS_SPEED=0.9` ลดความเร็วพูดนิดๆ ให้เป็นธรรมชาติ
  - รองรับ 2 format: `portrait` (9:16 Reels/TikTok, default) | `square` (1:1)
  - env: `MAPRAO_VIDEO_SIZE` (default 1080), `MAPRAO_VIDEO_FORMAT` (default portrait), `MAPRAO_TTS_SPEED` (default 0.9)
  - **Gate 2:** `kenBurnsClip`/`concatClips`/`addSubtitle` + portrait support ย้ายไปที่ [`lib/video-build.js`](lib/video-build.js) — maprang `video-build.js` กลายเป็น thin wrapper (re-export เท่านั้น)
- env: `MAPRAO_COMIC_SIZE` (default 1080), `MAPRAO_COMIC_MAXLINE` (default 40)

### Agent อะนิเมะ (`agents/anime/`)

สร้างรูปตัวละครอนิเมะจากรูปคนต้นแบบ + ลูกโป่งคำพูด ผ่าน Dashboard + Telegram Bot

- **Bubble AI (`agents/anime/bubble-gen.js`):** `summarizeBubble(rawText)` → Typhoon2 สรุป/rephrase ข้อความ → `{text, type, corner, footer}` — text ≤60 ตัว (bubble สั้น), footer ≤200 ตัว (สรุปยาว); corner: top-left/top-right/bottom-left/bottom-right (default `bottom-right` เพื่อไม่บังหน้า bust portrait)
- **Footer Caption:** output JPEG มีแถบขาวต่อท้ายด้านล่างภาพ (8% ของความกว้าง) + italic text ดำ — `renderBalloonOnImage(..., {template, corner, footerCaption})` ขยาย canvas อัตโนมัติถ้ามี `footerCaption`; dashboard preview แสดง placeholder band ก่อน finalize, หลัง finalize แสดง footer จริงใน div ด้านล่าง
- **Face-safe placement:** bubble วางที่ corner ที่ AI เลือก — `balloon-canvas.js` มี `CORNER_GEOM` map corner → `{bx,by,tx,ty}` ตรงกับ dashboard preview JS เสมอ; dashboard มี corner picker 4 ปุ่ม override ได้
- **Gallery per-item actions:** ปุ่ม 📤 โพสต์ FB / ✈️ ส่ง TG approval ซ้ำ / 🗑️ ลบ บน card แต่ละใบ — route: `DELETE /gallery/:id`, `POST /gallery/:id/post`, `POST /gallery/:id/resend`; Telegram resend ใช้ `agents/anime/anime-tg.js` `sendAnimeApproval()`
- **News Dropdown:** `GET /dashboard/anime/api/news` ดึงข่าว 7 วันล่าสุดจาก manao + makrut รวมกัน → dropdown populate textarea → `summarizeBubble` สรุปอัตโนมัติตอน generate
- env: `ANIME_TELEGRAM_BOT_TOKEN`, `ANIME_TELEGRAM_CHAT_ID`, `ANIME_BUBBLE_MAXCHARS` (default 60), `ANIME_FOOTER_MAXCHARS` (default 200)

### Agent มะกรูด (`agents/makrut/`)

FIFA World Cup 2026 news pipeline — ทำงานเหมือน manao แต่ scrape จากแหล่งข่าว FIFA/กีฬา

Scheduler ใน namkhao bot ทริกเกอร์ที่ **06:00 และ 18:00 BKK**

- ใช้ `post.js` ของ manao pipeline ร่วมกัน (pass `PIPELINE_ROOT` env)
- `EXTRA_SCHEDULE_DIRS` — post.js ตรวจ pipeline ทั้งหมดก่อน schedule เพื่อหลีกเลี่ยงโพสต์ทับเวลา FB

---

## Node.js Scripts (Terminal)

```powershell
# Shopee Affiliate
node scrape.js                    # ดึงสินค้าที่ยังไม่มี data.json
node scrape.js --force            # ดึงใหม่ทั้งหมด
node scrape.js --dry-run          # แสดงรายการโดยไม่ดึงจริง
node approval-bot.js              # รัน Telegram Approval Bot (วันปัจจุบัน)
node approval-bot.js {item_id}    # ทดสอบกับสินค้าที่ระบุ
node post.js {date} --platform fb # โพสต์โดยตรงไม่ผ่าน Approve

# Dashboards
node dashboard.js                 # เปิด Dashboard ที่ http://localhost:3001
node agent-hub/index.js           # เปิด Agent Hub ที่ http://localhost:3002

# AI News
node agents/manao/pipeline/agents/formatter-agent.js --resend   # resend Telegram approval
node agents/makrut/pipeline/makrut.js --resend                  # resend makrut approval
```

---

## Input Format

`input/urls.txt` — หนึ่งสินค้าต่อบรรทัด **3 คอลัมน์คั่นด้วย `|`**:

```
https://shopee.co.th/product/{shop_id}/{item_id} | https://s.shopee.co.th/xxxxx | YYYY-MM-DD
```

- บรรทัดขึ้นต้นด้วย `#` = comment ข้ามได้
- `post_date` ถ้าไม่ใส่ = วันที่ดึงข้อมูล

---

## Chrome Debug Mode (จำเป็นสำหรับ scraping)

`scrape.js` เชื่อมต่อ Chrome ที่ **`localhost:9222`** — ต้องเปิด Chrome debug mode ก่อนรัน scrape ทุกครั้ง
วิธีเปิดและ troubleshoot: ดู `GUIDE.md`

**Error `ECONNREFUSED 127.0.0.1:9222`** = Chrome ยังไม่ได้เปิดในโหมด debug

---

## Environment (.env)

```env
FB_PAGE_ID=          # Facebook Page ID
FB_ACCESS_TOKEN=     # Long-lived token (60 วัน) — ต่ออายุผ่าน Graph API Explorer
IG_USER_ID=          # Instagram Business User ID
IG_ACCESS_TOKEN=     # token เดียวกับ FB ที่มี instagram_content_publish
IMGBB_API_KEY=       # สำหรับอัปโหลดรูป Instagram Carousel
X_API_KEY=
X_API_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_TOKEN_SECRET=
TELEGRAM_BOT_TOKEN=  # ต้องเป็นบอทใหม่ — ห้ามใช้บอทที่มี Webhook อยู่แล้ว
TELEGRAM_CHAT_ID=
# แยก bot token ต่อ agent (แนะนำ — ป้องกัน conflict)
MALI_TELEGRAM_BOT_TOKEN=    # approval-bot.js ใช้ก่อน TELEGRAM_BOT_TOKEN
MANAO_TELEGRAM_BOT_TOKEN=   # manao pipeline bot
NAMKHAO_TELEGRAM_BOT_TOKEN= # namkhao bot
# Ollama (AI News generation)
OLLAMA_HOST=http://10.3.17.118:11434
OLLAMA_MODEL=scb10x/llama3.1-typhoon2-8b-instruct:latest  # default — รองรับภาษาไทย
```

> ทุก Agent โหลด config จาก root `shopee-affiliate/.env` ไฟล์เดียว — ต่ออายุ token แก้ที่นี่ที่เดียว

### ต่ออายุ FB Token (ทุก 60 วัน)

```powershell
# 1. ดึง short-lived token จาก https://developers.facebook.com/tools/explorer/
# 2. แปลงเป็น long-lived token:
node -e "
const https = require('https');
const APP_ID = 'APP_ID';
const APP_SECRET = 'APP_SECRET';
const SHORT = 'SHORT_LIVED_TOKEN';
const url = 'https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id='+APP_ID+'&client_secret='+APP_SECRET+'&fb_exchange_token='+SHORT;
https.get(url, r => { let b=''; r.on('data',d=>b+=d); r.on('end',()=>console.log(b)); });
"
# 3. อัปเดต root .env
```

---

## Output Structure

```
products/{item_id}/
├── data.json           ← ข้อมูลสินค้า + affiliate_short_link + post_date
├── images/1-6.jpg      ← รูปสินค้า (max 6, ต้อง >50KB สำหรับ IG)
└── content/
    ├── facebook.md
    ├── instagram.md
    ├── x.md
    └── tiktok.md       ← มี script table + caption

agents/{pipeline}/pipeline/news/{slug}/
├── data.json           ← ข้อมูลข่าว + status (draft/pending_approval/scheduled/posted)
└── content/
    ├── facebook.md
    └── master.md       ← (manao เท่านั้น)

tracking.xlsx           ← sort ตาม post_date | status: scraped → draft → posted
```

---

## Content Rules

**Tone:** ภาษาไทย เป็นกันเอง เน้น benefit ไม่ใช่ feature

| Platform | ความยาว | รูปแบบพิเศษ |
|----------|---------|------------|
| Facebook | 150–300 คำ | storytelling hook + affiliate link ท้าย |
| Instagram | 100–150 คำ | 15–20 hashtag แบ่ง 4 ชั้น, ไม่ใส่ link ในแคปชั่น |
| X | 3 ทวีต | ทวีตแรกไม่มีลิงก์, ทวีตสุดท้ายมีลิงก์ + `#Shopeeaffiliate` |
| TikTok | caption 50–80 คำ | script table: TIME \| VOICEOVER \| VISUAL \| ON-SCREEN |

**ข้อห้ามเด็ดขาด:**
- ห้ามแต่งข้อมูลที่ไม่อยู่ใน `data.json`
- ห้ามใช้ product URL — ใช้ `affiliate_short_link` เท่านั้น
- ห้าม generate หรือ guess affiliate link เอง
- ต้องมี `#Shopeeaffiliate` ทุก platform

**ต้องทำ:**
- บันทึก content ลง `products/{item_id}/content/` เสมอ
- แสดงสรุปให้ผู้ใช้ confirm ก่อนถือว่าเสร็จ
- อัปเดต `tracking.xlsx` (sort ตาม post_date) หลังสร้าง content ครบ

---

## Troubleshooting

| ปัญหา | แก้ไข |
|-------|-------|
| `ECONNREFUSED 9222` | เปิด Chrome debug mode ก่อน (ดูหัวข้อ Chrome Debug) |
| Shopee CAPTCHA | แก้ CAPTCHA ใน Chrome debug แล้วรัน `--force` ใหม่ |
| FB `Session has expired` | Token หมดอายุ — ต่ออายุผ่าน Graph API Explorer → อัปเดต root `.env` |
| FB `access token could not be decrypted` | Token ตัดค้าง/corrupt ใน `.env` — copy จากไฟล์ที่ถูกต้องใส่ใหม่ |
| FB Reels `(#200) no permission` | Reels ต้องใช้ Page Token (ไม่ใช่ User Token) — `agent-hub/index.js` exchange ให้อัตโนมัติแล้ว |
| Telegram ไม่ตอบสนอง | บอทมี Webhook อยู่ → สร้างบอทใหม่ |
| `.approval-bot.lock` ค้าง | `del .approval-bot.lock` แล้ว `taskkill /F /IM node.exe` |
| X Rate Limit | รอ 15 นาที หรือโพสต์ทีละ item_id |
| IG Carousel ล้มเหลว | ตรวจ IMGBB_API_KEY + รูปต้อง >50KB |
| `Cannot find module` | `npm install` |
| TikTok video TTS error | `make-tiktok-video.js` ใช้ `msedge-tts` npm — รัน `npm install msedge-tts` ถ้าพัง |
| ข่าว makrut/manao ค้างใน Telegram | รัน `--resend` (ดู Node.js Scripts) |
| กด Approve ข่าวแล้ว Telegram บอก "✅ สำเร็จ" แต่ FB ไม่มีโพสต์ | เดิม: `post.js` โหลด `.env` จาก cwd แต่ bot spawn ด้วย cwd=`manao/pipeline` (ไม่มี .env) → ไม่มี FB creds → error ถูกกลืน + exit 0 → bot รายงานสำเร็จหลอก. **แก้แล้ว:** post.js โหลด root `.env` ด้วย absolute path + exit non-zero เมื่อโพสต์ fail (bot จะโชว์ error จริง). post.js spawn ใหม่ทุกครั้ง → fix มีผลทันทีไม่ต้อง restart bot |
| มะปราง dashboard โชว์ "Pre-production กำลังทำงาน" ค้าง | job orphaned (process ตายไม่อัปเดต status) — `run.js` เขียน `status='error'` ตอน exit ผิดปกติแล้ว (ทั้ง throw + process.exit) แต่ถ้าถูก `kill -9` ต้องล้าง meta status เอง |
| Ollama output เป็น `??????` | ตรวจว่าใช้ model Typhoon2 (`OLLAMA_MODEL` ใน `.env`) — `llama3.2` ไม่รองรับไทย |
| มะพร้าว รูปใน Telegram/Facebook ฝุ่น ไม่คม แต่ใน Gallery ปกติ | `@napi-rs/canvas` `toBuffer('image/jpeg', quality)` ใช้ scale **0–100** ไม่ใช่ 0–1 — ถ้าใส่ `0.9` = 1% quality → image.jpg ออก 38KB เท่านั้น; **แก้แล้วใน `comic.js`** ใช้ `92` แทน; ถ้าพบ image.jpg < 100KB ให้ regenerate + resend |

---

## Windows Task Scheduler

รัน Approval Bot อัตโนมัติทุกวัน 11:05 น.:

```powershell
# สร้าง task (ทำครั้งเดียว)
schtasks /Create /TN "ShopeeAffiliate-DailyFBPost" /TR "\"C:\Users\lenovo3\agent\shopee-affiliate\post-daily-fb.bat\"" /SC DAILY /ST 11:05 /F

# รันทดสอบทันที
schtasks /Run /TN "ShopeeAffiliate-DailyFBPost"
```
