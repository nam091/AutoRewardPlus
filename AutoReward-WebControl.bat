@echo off
chcp 65001 >nul
title AutoRewardPlus - Web Control Center

set "ROOT=%~dp0"
cd /d "%ROOT%"

set "SILENT=0"
if /I "%~1"=="--silent" set "SILENT=1"

if "%SILENT%"=="0" (
    echo =======================================================================
    echo          AUTOREWARDPLUS - WEB CONTROL CENTER
    echo =======================================================================
    echo.
)

where node >nul 2>&1
if errorlevel 1 (
    echo [LOI] Khong tim thay node.js. Cai Node.js 20+ truoc.
    pause
    exit /b 1
)

if "%SILENT%"=="0" (
    echo [1/3] Kiem tra Tailscale...
    node "%ROOT%tools\windows-controller\cliRunner.js" --status >nul 2>&1
    if errorlevel 1 (
        echo [CANH BAO] Chua ket noi duoc VPS qua Tailscale.
    ) else (
        echo  -^> Tailscale: OK
    )

    echo [2/3] Khoi dong Residential Proxy :10808 neu chua chay...
)
if "%SILENT%"=="1" (
    node "%ROOT%tools\windows-controller\cliRunner.js" --status >nul 2>&1
)
powershell -NoProfile -Command "$root=$env:ROOT; if (-not (Get-NetTCPConnection -LocalPort 10808 -State Listen -ErrorAction SilentlyContinue)) { Start-Process -FilePath node -ArgumentList ('\"' + $root + 'tools\windows-controller\proxyServer.js\"') -WorkingDirectory $root -WindowStyle Hidden }"

if "%SILENT%"=="0" echo [3/3] Khoi dong Web Control Center :4000 neu chua chay...
powershell -NoProfile -Command "$root=$env:ROOT; if (-not (Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue)) { Start-Process -FilePath node -ArgumentList ('\"' + $root + 'tools\windows-controller\server.js\"') -WorkingDirectory $root -WindowStyle Hidden }"

if "%SILENT%"=="1" (
    timeout /t 3 >nul
    exit /b 0
)

start "" http://127.0.0.1:4000
echo.
echo Da mo giao dien web: http://127.0.0.1:4000
echo.
timeout /t 3 >nul
