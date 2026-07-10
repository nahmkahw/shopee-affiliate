'use strict';
/**
 * jest.config.js
 *
 * modulePathIgnorePatterns: กัน jest-haste-map "naming collision"
 *   จากสำเนา repo ใน .claude/worktrees/** (agent worktrees) และ node_modules
 *   — โดยเฉพาะ package.json ที่ชื่อ "ai-news" ซ้ำกันหลายที่
 *
 * ผลข้างเคียงที่ต้องการ: CI (GitHub-hosted runner) checkout สะอาด ไม่มี worktrees
 *   อยู่แล้ว แต่ config นี้ทำให้ `npm test` บนเครื่อง dev รันได้ตรงกับ CI
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  modulePathIgnorePatterns: [
    '<rootDir>/.claude/',
    '<rootDir>/node_modules/',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.claude/',
  ],
};
