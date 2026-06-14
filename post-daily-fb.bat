@echo off
cd /d "C:\Users\lenovo3\agent\shopee-affiliate"

echo ===================================
echo Shopee Affiliate Approval Bot
echo %DATE% %TIME%
echo ===================================

"C:\Program Files\nodejs\node.exe" approval-bot.js

echo.
echo Done %DATE% %TIME%
