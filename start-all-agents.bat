@echo off
title Start All Agents
cd /d "%~dp0"

echo.
echo  ========================================
echo   Start All Agents
echo  ========================================
echo.

:: ── ตรวจ node ────────────────────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] ไม่พบ node.exe — ติดตั้ง Node.js ก่อน
    pause
    exit /b 1
)

:: ── 1. Agent Hub (port 3002) ─────────────────────────────────────────────────
echo [1/4] เริ่ม Agent Hub (port 3002)...
:: kill port 3002 ถ้ายังค้างอยู่
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr /R " :3002 "') do (
    if not "%%a"=="0" taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul
start "Agent Hub" /min cmd /c "cd /d "%~dp0" && node agent-hub.js"
echo   ✓ agent-hub.js กำลังรัน (http://localhost:3002)

timeout /t 2 /nobreak >nul

:: ── 2. น้ำข้าว Bot (scheduler + monitor) ─────────────────────────────────────
echo [2/4] เริ่ม น้ำข้าว Bot...
:: kill instance เก่า (ถ้ามี pid file)
set NAMKHAO_PID_FILE=%~dp0agents\namkhao\telegram-bot.pid
if exist "%NAMKHAO_PID_FILE%" (
    set /p OLD_PID=<"%NAMKHAO_PID_FILE%"
    taskkill /F /PID %OLD_PID% >nul 2>&1
    del "%NAMKHAO_PID_FILE%" >nul 2>&1
)
start "Namkhao Bot" /min cmd /c "cd /d "%~dp0" && node agents\namkhao\telegram-bot.js"
echo   ✓ namkhao telegram-bot.js กำลังรัน

timeout /t 2 /nobreak >nul

:: ── 3. มะนาว Bot (approval handler) ──────────────────────────────────────────
echo [3/4] เริ่ม มะนาว Bot...
set MANAO_PID_FILE=%~dp0agents\manao\pipeline\telegram-bot.pid
if exist "%MANAO_PID_FILE%" (
    set /p OLD_PID=<"%MANAO_PID_FILE%"
    taskkill /F /PID %OLD_PID% >nul 2>&1
    del "%MANAO_PID_FILE%" >nul 2>&1
)
start "Manao Bot" /min cmd /c "cd /d "%~dp0agents\manao\pipeline" && node telegram-bot.js"
echo   ✓ manao telegram-bot.js กำลังรัน

timeout /t 2 /nobreak >nul

:: ── 4. Anime Bot (Telegram approval + FB/IG post) ────────────────────────────
echo [4/4] เริ่ม Anime Bot...
set ANIME_LOCK=%~dp0agents\anime\.anime-bot.lock
if exist "%ANIME_LOCK%" (
    set /p OLD_PID=<"%ANIME_LOCK%"
    taskkill /F /PID %OLD_PID% >nul 2>&1
    del "%ANIME_LOCK%" >nul 2>&1
)
start "Anime Bot" /min cmd /c "cd /d "%~dp0" && node agents\anime\anime-bot.js"
echo   ✓ anime-bot.js กำลังรัน

echo.
echo  ========================================
echo   ✓ เสร็จแล้ว! Agents ทั้งหมดเริ่มทำงาน
echo   ✓ Dashboard: http://localhost:3002
echo  ========================================
echo.
timeout /t 3 /nobreak >nul
