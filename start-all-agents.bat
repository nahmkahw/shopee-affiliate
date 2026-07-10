@echo off
title Start All Agents
cd /d "%~dp0"

echo.
echo  ========================================
echo   Start All Agents (idempotent — รันซ้ำได้ปลอดภัย)
echo  ========================================
echo.

:: ── ตรวจ node ────────────────────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] ไม่พบ node.exe — ติดตั้ง Node.js ก่อน
    pause
    exit /b 1
)

:: ── 1. Agent Hub (port 3002) — server, kill+restart ได้ ───────────────────────
echo [1/4] เริ่ม Agent Hub (port 3002)...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr /R " :3002 "') do (
    if not "%%a"=="0" taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul
start "Agent Hub" /min cmd /c "cd /d "%~dp0" && node agent-hub/index.js"
echo   ✓ agent-hub/index.js (http://localhost:3002)

timeout /t 2 /nobreak >nul

:: ── 2-4. Telegram bots — start เฉย ๆ, ตัว bot มี PID-liveness lock เอง ──────────
:: ไม่ taskkill — ถ้า bot รันอยู่แล้ว lock จะปฏิเสธตัวใหม่ (กัน 409) ไม่ kill ตัวที่ทำงานอยู่
:: ถ้า bot ตาย/lock ค้าง → lock เช็ค PID ตาย → ล้าง + start ใหม่อัตโนมัติ
echo [2/4] เริ่ม น้ำข้าว Bot (ศูนย์ข่าว manao+makrut)...
start "Namkhao Bot" /min cmd /c "cd /d "%~dp0" && node agents\namkhao\telegram-bot.js"

echo [3/4] เริ่ม Anime Bot...
start "Anime Bot" /min cmd /c "cd /d "%~dp0" && node agents\anime\anime-bot.js"

echo [4/4] เริ่ม Mammuang Bot...
start "Mammuang Bot" /min cmd /c "cd /d "%~dp0" && node agents\mammuang\mammuang-bot.js"

echo.
echo  ========================================
echo   ✓ เสร็จแล้ว (bot ที่รันอยู่ไม่ถูกแตะ — lock กันซ้ำ)
echo   ✓ Dashboard: http://localhost:3002
echo  ========================================
echo.
timeout /t 3 /nobreak >nul
