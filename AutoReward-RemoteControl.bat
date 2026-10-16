@echo off
chcp 65001 >nul
title AutoRewardPlus - Windows Control Center

echo =======================================================================
echo          AUTOREWARDPLUS - WINDOWS CONTROL CENTER
echo =======================================================================
echo.

:: 1. Kiểm tra Tailscale trên Windows
echo [1/3] Đang kiểm tra kết nối Tailscale...
node "%~dp0tools\windows-controller\cliRunner.js" --status >nul 2>&1
if %errorlevel% neq 0 (
    echo [CẢNH BÁO] Không thể kết nối tới VPS qua Tailscale!
    echo Điều kiện tiên quyết: Hãy bật ứng dụng Tailscale trên Windows trước khi chạy.
    echo.
) else (
    echo  -> Tailscale: OK (Đã kết nối)
)

:: 2. Khởi chạy Ứng dụng Desktop AutoRewardPlus
echo [2/3] Đang khởi chạy ứng dụng AutoRewardPlus...
if exist "%~dp0AutoRewardPlus.exe" (
    start "" "%~dp0AutoRewardPlus.exe"
    echo  -> Đã mở ứng dụng Desktop & khay hệ thống (System Tray).
) else (
    echo [2/3] Khởi động Control Center Server nền tại http://127.0.0.1:4000...
    start /b "" node "%~dp0tools\windows-controller\server.js" >nul 2>&1
    echo [3/3] Đang mở giao diện điều khiển...
    start http://127.0.0.1:4000
)

echo.
echo =======================================================================
echo  Ứng dụng đã được khởi động!
echo  - Giao diện Control Center: http://127.0.0.1:4000
echo  - Biểu tượng System Tray: Dưới góc phải màn hình taskbar
echo =======================================================================
echo.
timeout /t 3 >nul
