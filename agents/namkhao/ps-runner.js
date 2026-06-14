/**
 * ps-runner.js — Helper: รัน PowerShell script file แล้ว print output
 * ใช้เป็นตัวกลางเพื่อหลีกเลี่ยง EPERM ของ server process
 * Usage: node ps-runner.js <script.ps1>
 */
const { execFileSync } = require('child_process');
const psFile = process.argv[2];
if (!psFile) { process.stderr.write('Usage: node ps-runner.js <script.ps1>\n'); process.exit(1); }
try {
  const out = execFileSync(
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile],
    { encoding: 'utf8', timeout: 30000 }
  );
  process.stdout.write(out);
} catch (e) {
  process.stderr.write(e.message + '\n');
  process.exit(1);
}
