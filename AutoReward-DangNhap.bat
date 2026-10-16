@echo off
chcp 65001 >nul
title AutoRewardPlus - Đăng nhập trực quan (Interactive Login)

echo =======================================================================
echo     AUTOREWARDPLUS - ĐĂNG NHẬP TRỰC QUAN (INTERACTIVE LOGIN)
echo =======================================================================
echo.
echo Nhập email tài khoản cần đăng nhập (hoặc nhấn Enter để chọn mặc định):
set /p targetEmail="Email [mặc định: qxk4iitw@studentidcard.me]: "
if "%targetEmail%"=="" set targetEmail=qxk4iitw@studentidcard.me

echo.
echo Đang mở trình duyệt Chromium trực quan trên máy để đăng nhập:
echo  -> Email: %targetEmail%
echo.
echo Vui lòng nhìn lên màn hình, đăng nhập hoặc giải mã xác thực 2FA/Captcha...
echo Sau khi đăng nhập thành công vào Rewards, đóng trình duyệt để lưu session tự động.
echo.

node "%~dp0tools\windows-controller\interactiveLogin.js" "%targetEmail%"

echo.
pause
