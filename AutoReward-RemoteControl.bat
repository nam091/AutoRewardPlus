@echo off
chcp 65001 >nul
title AutoRewardPlus - Remote Control Center (VPS + Windows Residential)

echo =======================================================================
echo          AUTOREWARDPLUS - REMOTE CONTROL CENTER
echo =======================================================================
echo.

:: 1. Kiểm tra Tailscale trên Windows
echo [1/3] Đang kiểm tra Tailscale Windows...
node "%~dp0tools\windows-controller\cliRunner.js" --status >nul 2>&1
if %errorlevel% neq 0 (
    echo [CANH BAO] Khong the ket noi toi VPS qua Tailscale!
    echo Dieu kien tien quyet: Hay dam bao ung dung Tailscale tren Windows dang BAT.
    echo.
) else (
    echo  -> Tailscale: OK (Da ket noi)
)

:: 2. Khởi động Control Center Server nền
echo [2/3] Khoi dong Control Center tai http://127.0.0.1:4000...
start /b "" node "%~dp0tools\windows-controller\server.js" >nul 2>&1

:: 3. Mở giao diện Web Control Center
echo [3/3] Dang mo trinh duyet...
start http://127.0.0.1:4000

echo.
echo =======================================================================
echo Giao dien da duoc mo tai: http://127.0.0.1:4000
echo Ban co the dieu khien tu xa, dong bo va len lich tu dong tai day.
echo =======================================================================
echo.
pause
