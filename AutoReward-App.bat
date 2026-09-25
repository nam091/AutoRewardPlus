@echo off
chcp 65001 >nul
cd /d "%~dp0"

:: 1. Chạy server điều khiển nền
start /b "" node "%~dp0tools\windows-controller\server.js"

:: 2. Khởi chạy cửa sổ phần mềm độc lập (Standalone Desktop App)
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app="http://127.0.0.1:4000" --window-size=1050,850
) else if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --app="http://127.0.0.1:4000" --window-size=1050,850
) else (
    start http://127.0.0.1:4000
)

exit
