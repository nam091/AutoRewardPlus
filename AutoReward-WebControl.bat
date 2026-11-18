@echo off
chcp 65001 >nul
title AutoRewardPlus - Unified Web & Local Proxy

set "ROOT=%~dp0"
cd /d "%ROOT%"

if "%VPS_DASHBOARD_URL%"=="" set "VPS_DASHBOARD_URL=http://100.126.196.30:3030"

set "SILENT=0"
if /I "%~1"=="--silent" set "SILENT=1"

if "%SILENT%"=="0" (
    echo =======================================================================
    echo         AUTOREWARDPLUS - LOCAL PROXY (:10808) ^& UNIFIED WEB (:3030)
    echo =======================================================================
    echo.
    echo [1/2] Kiem tra Tailscale...
    node "%ROOT%tools\windows-controller\cliRunner.js" --status >nul 2>&1
    if errorlevel 1 (
        echo [CANH BAO] Chua ket noi duoc VPS qua Tailscale.
    ) else (
        echo  -^> Tailscale: OK
    )

    echo [2/2] Khoi dong Residential Proxy :10808 neu chua chay...
)
if "%SILENT%"=="1" (
    node "%ROOT%tools\windows-controller\cliRunner.js" --status >nul 2>&1
)
powershell -NoProfile -Command "$root=$env:ROOT; if (-not (Get-NetTCPConnection -LocalPort 10808 -State Listen -ErrorAction SilentlyContinue)) { Start-Process -FilePath node -ArgumentList ('\"' + $root + 'tools\windows-controller\proxyServer.js\"') -WorkingDirectory $root -WindowStyle Hidden }"

if "%SILENT%"=="1" (
    timeout /t 2 >nul
    exit /b 0
)

start "" "%VPS_DASHBOARD_URL%"
echo.
echo Da mo giao dien web chung (Windows ^& Linux): %VPS_DASHBOARD_URL%
echo.
timeout /t 3 >nul
