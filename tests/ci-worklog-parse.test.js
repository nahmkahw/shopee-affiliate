'use strict';
const {
  deriveCategory, deriveAgent, prRow, dailyRow, PR_HEADER, DAILY_HEADER,
} = require('../lib/ci/worklog-parse');

describe('deriveCategory', () => {
  test.each([
    ['feat(mayom): เพิ่ม /สรุป', 'feat'],
    ['fix(maprao): แก้ bubble', 'fix'],
    ['perf(mayom): normalize พ.ศ.', 'perf'],
    ['chore(cicd): phase 0', 'chore'],
    ['ci(cicd): CI gate', 'ci'],
    ['feat!: breaking', 'feat'],
    ['random title no prefix', 'other'],
    ['Feat(X): uppercase type', 'feat'],
    ['', 'other'],
  ])('%s → %s', (title, expected) => {
    expect(deriveCategory(title)).toBe(expected);
  });
});

describe('deriveAgent', () => {
  test('scope ใน title ชนะ branch', () => {
    expect(deriveAgent('feat(mayom): x', 'feat/cicd-phase2')).toBe('mayom');
  });
  test('ไม่มี scope → เดาจาก branch', () => {
    expect(deriveAgent('add stuff', 'feat/maprao-bubble-fix')).toBe('maprao');
  });
  test('cicd branch', () => {
    expect(deriveAgent('ci: gate', 'feat/cicd-phase1-ci')).toBe('cicd');
  });
  test('ไม่มีอะไรเลย → ว่าง', () => {
    expect(deriveAgent('', '')).toBe('');
  });
  test('agent ไม่รู้จักคืน raw (ไม่ทิ้ง)', () => {
    expect(deriveAgent('feat(banana): x', '')).toBe('banana');
  });
});

describe('prRow', () => {
  test('เรียงคอลัมน์ตรงกับ PR_HEADER', () => {
    const row = prRow({
      mergedDate: '2026-07-10', number: 45, title: 'feat(mayom): x',
      author: 'nahmkahw', branch: 'feat/mayom-x', commits: 3,
      changedFiles: 5, additions: 100, deletions: 20,
      ciStatus: 'success', url: 'http://pr/45',
    });
    expect(row).toHaveLength(PR_HEADER.length);
    expect(row[0]).toBe('2026-07-10');
    expect(row[4]).toBe('feat');   // category
    expect(row[5]).toBe('mayom');  // agent
    expect(row[11]).toBe('pending'); // deploy_status default
  });
  test('field ขาด → default 0/ว่าง (ไม่ crash)', () => {
    const row = prRow({ mergedDate: '2026-07-10', number: 1, title: 'x', author: 'a' });
    expect(row[6]).toBe(0);
    expect(row[8]).toBe(0);
  });
});

describe('dailyRow', () => {
  const rows = [
    prRow({ mergedDate: '2026-07-10', number: 1, title: 'feat(a): x', commits: 2, additions: 10, deletions: 1 }),
    prRow({ mergedDate: '2026-07-10', number: 2, title: 'fix(b): y', commits: 1, additions: 5, deletions: 3 }),
    prRow({ mergedDate: '2026-07-10', number: 3, title: 'docs: z', commits: 1, additions: 2, deletions: 0 }),
    prRow({ mergedDate: '2026-07-09', number: 4, title: 'perf(c): w', commits: 9, additions: 99, deletions: 9 }),
  ];
  test('รวมเฉพาะวันเดียวกัน + breakdown หมวด', () => {
    const d = dailyRow('2026-07-10', rows);
    expect(d).toHaveLength(DAILY_HEADER.length);
    expect(d[0]).toBe('2026-07-10');
    expect(d[1]).toBe(3);   // prs วันนี้ (ไม่รวม 07-09)
    expect(d[2]).toBe(4);   // commits 2+1+1
    expect(d[3]).toBe(17);  // additions 10+5+2
    expect(d[4]).toBe(4);   // deletions 1+3+0
    expect(d[5]).toBe(1);   // feat
    expect(d[6]).toBe(1);   // fix
    expect(d[7]).toBe(0);   // perf (perf อยู่ 07-09)
    expect(d[8]).toBe(1);   // other (docs)
  });
  test('วันที่ไม่มีข้อมูล → 0 ทุกช่อง', () => {
    const d = dailyRow('2026-01-01', rows);
    expect(d[1]).toBe(0);
    expect(d[8]).toBe(0);
  });
});
