@echo off
chcp 65001 >nul
title AutoRewardPlus - Smart Human-Cadence Scheduler

echo =======================================================================
echo          AUTOREWARDPLUS - SMART HUMAN-CADENCE SCHEDULER
echo =======================================================================
echo.
echo [1] Kich hoat che do tu dong thong minh (Ngau nhien hoa thoi gian 15-60p)
echo [2] Chay NGAY LAP TUC (Bo qua dem nguoc jitter)
echo [3] Dang ky Task khoi dong cung Windows (Auto Run on Logon)
echo [4] Go bo Task khoi dong cung Windows
echo [5] Thoat
echo.

set /p choice="Nhap lua chon cua ban (1-5): "

if "%choice%"=="1" (
    echo.
    echo Dang khoi dong Smart Scheduler...
    node "%~dp0tools\windows-controller\smartScheduler.js"
    pause
) else if "%choice%"=="2" (
    echo.
    echo Dang kich hoat ngay lap tuc...
    node "%~dp0tools\windows-controller\smartScheduler.js" --now
    pause
) else if "%choice%"=="3" (
    echo.
    node "%~dp0tools\windows-controller\smartScheduler.js" --install-task
    pause
) else if "%choice%"=="4" (
    echo.
    node "%~dp0tools\windows-controller\smartScheduler.js" --remove-task
    pause
) else (
    exit /b 0
)
