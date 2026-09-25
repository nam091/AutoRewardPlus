@echo off
title AutoRewardPlus Dashboard Launcher
cd /d "%~dp0"
echo ==========================================
echo    Khởi chạy AutoRewardPlus Dashboard...
echo ==========================================
if not exist "node_modules\" (
    echo [INFO] Cài đặt dependencies...
    call npm install
)
npm run dashboard
pause
