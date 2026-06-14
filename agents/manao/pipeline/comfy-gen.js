/**
 * comfy-gen.js — Generate Instagram image via ComfyUI (AnythingXL)
 *
 * ใช้งาน (standalone):
 *   node comfy-gen.js <slug>
 *
 * ใช้เป็น module:
 *   const { generateNewsImage } = require('./comfy-gen');
 *   await generateNewsImage(slug, newsTitle);
 *   // → บันทึกรูปที่ news/{slug}/image.jpg
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const COMFYUI_HOST = '10.3.17.118';
const COMFYUI_PORT = 8188;
const NEWS_DIR     = path.join(__dirname, 'news');

// ─── Style Tags ───────────────────────────────────────────────────────────────

// แนว Reuters / AP photojournalism — นักข่าวฝรั่งจริง ไม่ใช่การ์ตูน
const PHOTO_BASE = [
  'award winning photojournalism',
  'Reuters news photography',
  'professional editorial photograph',
  'shot on Canon EOS R5',
  'sharp focus',
  'natural lighting',
  'documentary style',
  'western journalist',
  'ultra realistic',
  'high resolution',
  'masterpiece',
].join(', ');

const NEG_PROMPT = [
  'cartoon', 'anime', 'manga', 'illustration', '2d', 'flat design',
  'painting', 'drawing', 'sketch', 'clipart', 'vector art',
  'pixar', 'disney', 'render', 'cgi', '3d render',
  'watermark', 'text overlay', 'logo', 'signature',
  'low quality', 'blurry', 'out of focus', 'noise', 'grain',
  'ugly', 'deformed', 'bad anatomy', 'nsfw', 'violence', 'gore',
  'overexposed', 'underexposed',
].join(', ');

// ─── Topic → Visual Scene Mapping ────────────────────────────────────────────

const TOPIC_MAP = [
  // ── Space (ชื่อเฉพาะ — ต้องมาก่อนเสมอ) ──────────────────────────────────
  { rx: /\bNASA\b|SpaceX|rocket launch|satellite|\bmoon landing\b|\bmars\b/i,
    scene: 'SpaceX rocket launch at Kennedy Space Center, western journalists and photographers watching, dramatic smoke and fire, Reuters news photography style' },

  // ── Chip / Semiconductor (ก่อน AI เพราะ nvidia อาจอยู่ในข่าว AI) ──────────
  { rx: /\bnvidia\b|\bintel\b|\bAMD\b|\bchip\b|semiconductor|processor|wafer/i,
    scene: 'western engineer in cleanroom suit holding silicon wafer up to light, semiconductor fabrication plant, high-tech manufacturing environment' },

  // ── AI / LLM (ก่อน big tech เพราะ Google/Microsoft มักอยู่ในข่าว AI) ─────
  { rx: /artificial intelligence|AI assistant|language model|\bLLM\b|\bGPT\b|claude|gemini|openai|deepmind|anthropic|chatgpt|neural network|generative AI/i,
    scene: 'western male journalist interviewing AI researcher in modern tech lab, large screens showing neural network visualizations, professional office environment, San Francisco' },

  // ── Cybersecurity ────────────────────────────────────────────────────────
  { rx: /cybersecurity|cyber attack|cyber threat|data breach|ransomware|malware|phishing|\bhacker\b|\bhacked\b|security breach/i,
    scene: 'cybersecurity analyst at multiple monitors showing code and security alerts, dark server room with blue LED lighting, western male expert in focus, depth of field' },

  // ── Data Center / Cloud (compound phrase เท่านั้น — ป้องกัน "data" เดี่ยวๆ)
  { rx: /data center|data centre|database|cloud computing|cloud storage|\bserver farm\b|\bserver room\b/i,
    scene: 'western engineer in data center corridor with rows of glowing server racks, dramatic lighting, reflections on polished floor, professional tech environment' },

  // ── Robotics / Automation ────────────────────────────────────────────────
  { rx: /\brobot\b|automation|\bdrone\b|autonomous vehicle|self.driving/i,
    scene: 'western engineer supervising robotic arm assembly line in modern factory, industrial robots in motion blur, professional documentary shot' },

  // ── Quantum / Science lab ────────────────────────────────────────────────
  { rx: /quantum computing|quantum physics|particle physics|\blaboratory\b/i,
    scene: 'western scientist in university lab adjusting quantum computing equipment, glowing screens, academic research environment, documentary photography' },

  // ── Finance: Fed / Central Bank (ก่อน broad market) ─────────────────────
  { rx: /federal reserve|central bank|interest rate|rate hike|rate cut|monetary policy|\bthe Fed\b/i,
    scene: 'western financial executive at press conference podium, microphones, suited professionals in background, Federal Reserve or central bank interior' },

  { rx: /\bbank\b|financ|economy|GDP|inflation|recession|fiscal|budget deficit/i,
    scene: 'western financial executive at press conference podium, microphones, suited professionals in background, Federal Reserve or central bank interior' },

  // ── Stock Market (เฉพาะ "stock" หรือ คำศัพท์ตลาดทุน — ไม่ใช้คำ "market" เดี่ยวๆ)
  { rx: /\bstock\b|equity|portfolio|rally|bullish|bearish|\bNASDAQ\b|\bNYSE\b|share price|earnings report/i,
    scene: 'busy NYSE stock exchange trading floor, western traders in suits surrounded by screens with stock charts, financial district New York, candid news photo' },

  // ── EV / Auto (ก่อน energy เพราะ EV มีคำ "electric") ────────────────────
  { rx: /\bEV\b|electric vehicle|\btesla\b|cybertruck|\bcar\b|automobile|automotive|\btruck\b|vehicle recall/i,
    scene: 'western journalist test driving electric vehicle on open highway, sleek EV charging station in background, natural daylight, documentary photo' },

  // ── Social Media (ก่อน big tech เพราะ Meta/Facebook ซ้อนกัน) ────────────
  { rx: /social media|\btwitter\b|\bX\.com\b|\binstagram\b|\bfacebook\b|\btiktok\b|\byoutube\b/i,
    scene: 'western technology reporter at Silicon Valley press event, giant LED screen with social media interface in background, modern conference hall' },

  // ── Big Tech HQ (broad — อยู่หลัง AI และ social media) ──────────────────
  { rx: /\bapple\b|\bgoogle\b|\bmicrosoft\b|\bamazon\b|\bmeta\b|tech giant|big tech/i,
    scene: 'tech company headquarters exterior, western journalists gathered outside modern glass building, press photographers, documentary news shot' },

  // ── Startup / Venture ────────────────────────────────────────────────────
  { rx: /startup|entrepreneur|\bventure capital\b|\bIPO\b|\bfunding round\b/i,
    scene: 'confident western startup founder presenting to investors in modern glass-walled boardroom, business charts on screen, professional editorial photo' },

  // ── Energy / Climate ─────────────────────────────────────────────────────
  { rx: /\benergy\b|solar panel|wind turbine|green energy|climate change|carbon emission|\bEPA\b/i,
    scene: 'western environmental journalist standing in front of vast solar farm or wind turbines, golden hour lighting, wide angle editorial shot' },

  // ── Health / Medical ─────────────────────────────────────────────────────
  { rx: /health|medic|hospital|pharma|\bdrug\b|vaccine|biotech|clinical trial/i,
    scene: 'western medical researcher in white lab coat examining samples in modern laboratory, microscope, sterile environment, professional documentary photo' },

  // ── Trade / Supply Chain ─────────────────────────────────────────────────
  { rx: /\btrade\b|tariff|import|export|supply chain|shipping|cargo/i,
    scene: 'western journalist at busy shipping port, massive cargo containers being loaded by cranes, wide documentary shot, golden hour light' },

  // ── Regulation / Law ─────────────────────────────────────────────────────
  { rx: /regulat|antitrust|lawsuit|court ruling|\bcongress\b|\bsenate\b|\bpolicy\b/i,
    scene: 'US Capitol or congressional hearing room, western lawmaker at podium with American flags, documentary news photo, professional lighting' },

  // ── Geopolitics / War ────────────────────────────────────────────────────
  { rx: /geopolitic|\bwar\b|conflict|military|diplomacy|sanction|treaty/i,
    scene: 'western news journalist with press badge and microphone at diplomatic summit, government officials shaking hands in background, press conference setting' },

  // ── Science / Research (broad — อยู่ท้ายสุด) ────────────────────────────
  { rx: /research|science|\bstudy\b|survey|experiment/i,
    scene: 'western scientist in university lab adjusting quantum computing equipment, glowing screens, academic research environment, documentary photography' },
];

const DEFAULT_SCENE = 'western news anchor journalist at professional broadcast studio desk, world map on screen behind, multiple monitors, Reuters newsroom environment';

// ─── Prompt Builder ───────────────────────────────────────────────────────────

/**
 * ดึง proper noun จาก title (ชื่อบริษัท, ประเทศ, คน)
 * เอาเฉพาะคำที่ขึ้นต้นด้วยตัวพิมพ์ใหญ่และไม่ใช่ stop word ทั่วไป
 */
function extractTitleKeywords(title) {
  const STOP = new Set([
    'The','A','An','In','At','On','By','To','Of','For','And','Or','But',
    'With','From','Into','After','About','Over','Under','Between','Through',
    'New','US','UK','EU','AI','Is','Are','Was','Were','Has','Have','Had',
    'Will','Its','It','He','She','They','We','Be','As','Up','No','Not',
    'How','What','Why','When','Who','Says','Said','Plan','Plans','Set',
    'Get','Got','Could','Would','Should','May','Can','Now','Still','Just',
  ]);

  const words = title.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || [];
  return [...new Set(words)]
    .filter(w => !STOP.has(w))
    .slice(0, 4);   // เอาแค่ 4 คำแรก ป้องกัน prompt ยาวเกิน
}

function buildPrompt(title) {
  let scene = DEFAULT_SCENE;

  for (const { rx, scene: s } of TOPIC_MAP) {
    if (rx.test(title)) {
      scene = s;
      break;
    }
  }

  // เพิ่ม keyword จาก title เข้าไปใน prompt เพื่อให้รูปสื่อถึงข่าวมากขึ้น
  const keywords = extractTitleKeywords(title);
  const kwStr    = keywords.length > 0 ? `, depicting ${keywords.join(', ')}` : '';

  return `${PHOTO_BASE}, ${scene}${kwStr}, square composition, no text in image, no watermark`;
}

// ─── ComfyUI API ──────────────────────────────────────────────────────────────

function comfyPost(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = http.request(
      { hostname: COMFYUI_HOST, port: COMFYUI_PORT, path: urlPath, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      res => {
        let out = '';
        res.on('data', d => out += d);
        res.on('end', () => { try { resolve(JSON.parse(out)); } catch(e) { reject(new Error('ComfyUI parse error: ' + out.substring(0,200))); } });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function comfyGet(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: COMFYUI_HOST, port: COMFYUI_PORT, path: urlPath }, res => {
      let out = '';
      res.on('data', d => out += d);
      res.on('end', () => { try { resolve(JSON.parse(out)); } catch(e) { reject(new Error('ComfyUI parse error')); } });
    }).on('error', reject);
  });
}

function comfyGetBinary(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: COMFYUI_HOST, port: COMFYUI_PORT, path: urlPath }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function buildWorkflow(positivePrompt, seed) {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'AnythingXL_xl.safetensors' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: positivePrompt } },
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: NEG_PROMPT } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0],
        seed, steps: 30, cfg: 6.5,
        sampler_name: 'dpmpp_2m_sde', scheduler: 'karras', denoise: 1,
      },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'newsig' } },
  };
}

// ─── Main Generator ───────────────────────────────────────────────────────────

async function generateNewsImage(slug, title, options = {}) {
  const {
    timeoutMs    = 3 * 60 * 1000,  // 3 นาที max
    pollInterval = 3000,            // poll ทุก 3 วิ
    savePath     = path.join(NEWS_DIR, slug, 'image.jpg'),
  } = options;

  const positivePrompt = buildPrompt(title);
  const seed           = Math.floor(Math.random() * 9999999999);

  console.log(`  🎨 ComfyUI generate: "${title.substring(0, 60)}"`);
  console.log(`  📝 Scene: ${positivePrompt.substring(PHOTO_BASE.length + 2, PHOTO_BASE.length + 80)}...`);

  // Submit job
  const clientId = crypto.randomUUID();
  const result   = await comfyPost('/prompt', {
    client_id: clientId,
    prompt:    buildWorkflow(positivePrompt, seed),
  });

  if (!result.prompt_id) {
    throw new Error('ComfyUI ไม่ตอบกลับ prompt_id: ' + JSON.stringify(result).substring(0, 200));
  }

  const promptId = result.prompt_id;
  console.log(`  ⚙️  Prompt ID: ${promptId}`);

  // Poll until done
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollInterval));

    const history = await comfyGet('/history/' + promptId);
    const job     = history[promptId];

    if (!job) continue;

    if (job.status && job.status.status_str === 'error') {
      const msgs = job.status.messages || [];
      throw new Error('ComfyUI error: ' + JSON.stringify(msgs).substring(0, 200));
    }

    const outputs  = job.outputs || {};
    const saveNode = outputs['7'];
    if (!saveNode || !saveNode.images || saveNode.images.length === 0) continue;

    const img        = saveNode.images[0];
    const comfyPath  = `/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'output')}`;

    console.log(`  ⬇️  ดาวน์โหลดรูป: ${img.filename}`);
    const imgBuffer = await comfyGetBinary(comfyPath);

    // บันทึก (ComfyUI ส่ง PNG — imgBB รับ base64 ได้ทั้ง PNG และ JPG)
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.writeFileSync(savePath, imgBuffer);

    console.log(`  ✅ บันทึกรูปแล้ว: ${savePath} (${(imgBuffer.length / 1024).toFixed(0)} KB)`);
    return savePath;
  }

  throw new Error(`ComfyUI timeout หลัง ${timeoutMs / 1000} วิ`);
}

// ─── Standalone run ───────────────────────────────────────────────────────────

if (require.main === module) {
  const slugArg = process.argv[2];
  if (!slugArg) {
    console.error('Usage: node comfy-gen.js <slug>');
    process.exit(1);
  }

  const dataPath = path.join(NEWS_DIR, slugArg, 'data.json');
  if (!fs.existsSync(dataPath)) {
    console.error(`ไม่พบ news/${slugArg}/data.json`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  generateNewsImage(slugArg, data.title)
    .then(p => { console.log('\n✅ เสร็จสิ้น:', p); })
    .catch(e => { console.error('\n❌ Error:', e.message); process.exit(1); });
}

module.exports = { generateNewsImage, buildPrompt };
