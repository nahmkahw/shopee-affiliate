@echo off
title Restart Agent Hub
cd /d "%~dp0"

echo.
echo  ========================================
echo   Restart Agent Hub (port 3002)
echo  ========================================
echo.

:: ── 1. Kill process บน port 3002 ─────────────────────────────────────────────
echo [1/3] หยุด process บน port 3002...
set KILLED=0
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr /R " :3002 "') do (
    if not "%%a"=="0" (
        echo   kill PID %%a
        taskkill /F /PID %%a >nul 2>&1
        set KILLED=1
    )
)
if "%KILLED%"=="0" echo   (ไม่มี process รันอยู่)

:: ── 2. รอให้ port ว่าง ────────────────────────────────────────────────────────
echo [2/3] รอ 2 วินาที...
timeout /t 2 /nobreak >nul

:: ── 3. Start agent-hub.js ใหม่ ───────────────────────────────────────────────
echo [3/3] เริ่ม agent-hub.js ใหม่...
start "Agent Hub" /min cmd /c "node agent-hub.js & pause"

echo.
echo  ✓ เสร็จแล้ว!
echo  ✓ http://localhost:3002
echo.
timeout /t 2 /nobreak >nul
