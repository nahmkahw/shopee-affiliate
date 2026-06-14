/**
 * gen-password-hash.js — สร้าง scrypt hash ของรหัสผ่านสำหรับ Agent Hub login
 *
 * ใช้งาน:
 *   node gen-password-hash.js "รหัสผ่านของคุณ"
 *
 * แล้วคัดลอกบรรทัด DASHBOARD_PASSWORD_HASH=... ไปวางใน .env
 */

const { hashPassword } = require('./auth');

const pw = process.argv[2];
if (!pw) {
  console.error('❌ ใส่รหัสผ่านด้วย:  node gen-password-hash.js "your-password"');
  process.exit(1);
}

const hash = hashPassword(pw);
console.log('\n✅ คัดลอกบรรทัดนี้ไปวางใน .env :\n');
console.log(`DASHBOARD_PASSWORD_HASH=${hash}\n`);
