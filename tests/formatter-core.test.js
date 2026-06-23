'use strict';

const {
  hasGarbledChars,
  contentLength,
  extractAnchors,
  validateContent,
  fixMixedThaiEng,
  cleanOutput,
} = require('../lib/formatter-core');

// ─── hasGarbledChars ──────────────────────────────────────────────────────────

describe('hasGarbledChars', () => {
  test('ข้อความปกติ → false', () => {
    expect(hasGarbledChars('ข่าว AI วันนี้น่าสนใจมากค่ะ')).toBe(false);
  });

  test('ชื่อเฉพาะภาษาอังกฤษ → false', () => {
    expect(hasGarbledChars('OpenAI ประกาศ GPT-5 แล้วค่ะ')).toBe(false);
  });

  test('สระนำ (เ) ตามด้วย mai-taikhu (็) → true', () => {
    // "เ็" = sara-e + mai-taikhu ติดกัน = encoding เสีย
    expect(hasGarbledChars('ฝรั่งเ็ส')).toBe(true);
  });

  test('tone marks ซ้ำกัน → true', () => {
    expect(hasGarbledChars('ไทย็็')).toBe(true);
  });

  test('อักษร CJK → true', () => {
    expect(hasGarbledChars('ข่าว人工智能')).toBe(true);
  });

  test('ญี่ปุ่น → true', () => {
    expect(hasGarbledChars('ข่าวテスト')).toBe(true);
  });
});

// ─── contentLength ────────────────────────────────────────────────────────────

describe('contentLength', () => {
  test('นับตัวอักษรไทยไม่รวม space', () => {
    // "สวัสดี" = 6 ตัว, "ค่ะ" = 3 ตัว → 9 (ไม่นับ space)
    expect(contentLength('สวัสดี ค่ะ')).toBe(9);
  });

  test('ตัด hashtag ออกก่อนนับ', () => {
    const text = 'ข่าวดี #AIข่าว #เทคโนโลยี';
    // "ข่าวดี" = 6 ตัว (ไม่นับ space, ไม่นับ hashtag)
    expect(contentLength(text)).toBe(6);
  });

  test('ตัด URL ออกก่อนนับ', () => {
    const text = 'อ่านเพิ่ม https://example.com/news ได้เลยค่ะ';
    // "อ่านเพิ่ม" (9) + "ได้เลยค่ะ" (9) = 18
    expect(contentLength(text)).toBe(18);
  });

  test('text ว่าง → 0', () => {
    expect(contentLength('')).toBe(0);
  });

  test('มีแค่ hashtag → 0', () => {
    expect(contentLength('#AIข่าว #เทคโนโลยี')).toBe(0);
  });
});

// ─── extractAnchors ───────────────────────────────────────────────────────────

describe('extractAnchors', () => {
  test('ดึง Latin tokens ออกมาได้', () => {
    const anchors = extractAnchors('OpenAI ประกาศ ChatGPT ใหม่');
    expect(anchors.has('openai')).toBe(true);
    expect(anchors.has('chatgpt')).toBe(true);
  });

  test('ดึงตัวเลขออกมาได้', () => {
    const anchors = extractAnchors('ปี 2026 งบ 500 ล้าน');
    expect(anchors.has('2026')).toBe(true);
    expect(anchors.has('500')).toBe(true);
  });

  test('ไม่ดึงตัวเลขเดี่ยว', () => {
    const anchors = extractAnchors('อันดับ 1 ในโลก');
    expect(anchors.has('1')).toBe(false);
  });

  test('text ว่าง → Set ว่าง', () => {
    expect(extractAnchors('').size).toBe(0);
  });
});

// ─── validateContent ──────────────────────────────────────────────────────────

describe('validateContent', () => {
  const data = { title: 'OpenAI releases GPT-5 model', url: 'https://example.com' };
  const master = 'OpenAI ประกาศเปิดตัว GPT-5 ในปี 2026 ซึ่งมีความสามารถสูงกว่าเดิมมากค่ะ';

  test('FB content ดี → ไม่มี error', () => {
    const content = 'OpenAI เพิ่งประกาศเปิดตัว GPT-5 แล้วค่ะ! '.repeat(20) + '\n#AIข่าว';
    const errs = validateContent(content, 'fb', data, master);
    expect(errs).toHaveLength(0);
  });

  test('FB content สั้นเกิน → error', () => {
    const content = 'OpenAI เปิดตัว GPT-5 ค่ะ';
    const errs = validateContent(content, 'fb', data, master);
    expect(errs.some(e => e.includes('สั้นเกิน') || e.includes('Facebook'))).toBe(true);
  });

  test('content ว่าง → error', () => {
    const errs = validateContent('', 'fb', data, master);
    expect(errs.length).toBeGreaterThan(0);
  });

  test('content มีตัวอักษรเสีย → error', () => {
    const content = 'ฝรั่งเ็สเปิดตัว OpenAI '.repeat(20);
    const errs = validateContent(content, 'fb', data, master);
    expect(errs.some(e => e.includes('ตัวอักษรเสีย'))).toBe(true);
  });

  test('content เริ่มด้วย --- → error', () => {
    const content = '--- เริ่มผิดปกติ ' + 'OpenAI '.repeat(20);
    const errs = validateContent(content, 'fb', data, master);
    expect(errs.some(e => e.includes('เริ่มต้นผิดปกติ'))).toBe(true);
  });

  test('IG ที่มี hashtag น้อยกว่า 10 → error', () => {
    const content = 'OpenAI ประกาศ GPT-5 '.repeat(15) + '\n#AIข่าว #เทคโนโลยี';
    const errs = validateContent(content, 'ig', data, master);
    expect(errs.some(e => e.includes('hashtag'))).toBe(true);
  });

  test('IG ที่มี hashtag ครบ → ไม่มี hashtag error', () => {
    const ht = '#AIข่าว #เทคโนโลยี #AI #GenAI #ML #Tech #News #ข่าว #IT #Digital #Innovation';
    const content = 'OpenAI ประกาศ GPT-5 ทำให้โลกเปลี่ยนแปลง '.repeat(10) + '\n' + ht;
    const errs = validateContent(content, 'ig', data, master);
    expect(errs.some(e => e.includes('hashtag'))).toBe(false);
  });

  test('X thread ที่ไม่มี --- → error', () => {
    const content = 'OpenAI ประกาศ GPT-5 แล้วค่ะ '.repeat(10);
    const errs = validateContent(content, 'x', data, master);
    expect(errs.some(e => e.includes('---'))).toBe(true);
  });

  test('X thread ที่มี --- → ไม่มี separator error', () => {
    const content = 'ทวีต 1\n\n---\n\nทวีต 2\n\n---\n\nOpenAI GPT-5 https://example.com';
    const errs = validateContent(content, 'x', data, master);
    expect(errs.some(e => e.includes('---'))).toBe(false);
  });

  test('ไม่มี anchor จากต้นฉบับ → error', () => {
    // content ที่ไม่มีคำอังกฤษจาก title/master เลย
    const content = 'ข่าวดีมากนะคะ มีสิ่งน่าสนใจเกิดขึ้นมากมาย '.repeat(20);
    const errs = validateContent(content, 'fb', data, master);
    expect(errs.some(e => e.includes('entity'))).toBe(true);
  });

  test('master ว่าง + anchors ว่าง → ไม่ทำ fact-check', () => {
    const dataNoTitle = { title: '', url: 'https://example.com' };
    const content = 'ข่าวดีมากค่ะ '.repeat(30);
    const errs = validateContent(content, 'fb', dataNoTitle, '');
    expect(errs.some(e => e.includes('entity'))).toBe(false);
  });
});

// ─── fixMixedThaiEng ──────────────────────────────────────────────────────────

describe('fixMixedThaiEng', () => {
  test('ฟentanyl → fentanyl', () => {
    expect(fixMixedThaiEng('ฟentanyl')).toBe('fentanyl');
  });

  test('ประเทศSingapore → ประเทศ Singapore', () => {
    expect(fixMixedThaiEng('ประเทศSingapore')).toBe('ประเทศ Singapore');
  });

  test('#hashtag ไม่ถูกแตะ', () => {
    expect(fixMixedThaiEng('#AIข่าว')).toBe('#AIข่าว');
  });

  test('URL ไม่ถูกแตะ', () => {
    expect(fixMixedThaiEng('https://example.com')).toBe('https://example.com');
  });

  test('ข้อความปกติ → ไม่เปลี่ยน', () => {
    expect(fixMixedThaiEng('OpenAI ประกาศ GPT-5')).toBe('OpenAI ประกาศ GPT-5');
  });
});

// ─── cleanOutput ─────────────────────────────────────────────────────────────

describe('cleanOutput', () => {
  test('ลบ [label] นำหน้า', () => {
    const result = cleanOutput('[CONTENT] สวัสดีค่ะ');
    expect(result).not.toMatch(/^\[CONTENT\]/);
    expect(result).toContain('สวัสดีค่ะ');
  });

  test('ลบบรรทัด ---', () => {
    const result = cleanOutput('บรรทัดแรก\n---\nบรรทัดสอง');
    expect(result).not.toContain('---');
    expect(result).toContain('บรรทัดแรก');
    expect(result).toContain('บรรทัดสอง');
  });

  test('ลบ CJK บรรทัด', () => {
    const result = cleanOutput('ข่าวดี\n人工智能とAI\nข่าวดีอีกบรรทัด');
    expect(result).not.toContain('人工');
    expect(result).toContain('ข่าวดี');
  });

  test('ลด newline ซ้ำ', () => {
    const result = cleanOutput('บรรทัด 1\n\n\n\nบรรทัด 2');
    expect(result).toBe('บรรทัด 1\n\nบรรทัด 2');
  });
});
