@echo off
chcp 65001 >nul
title AutoRewardPlus - Dang nhap truc quan qxk4iitw@studentidcard.me

echo =======================================================================
echo     AUTOREWARDPLUS - DANG NHAP TRUC QUAN (INTERACTIVE LOGIN)
echo =======================================================================
echo.
echo Dang mo trinh duyet Chromium noi de anh dang nhap tai khoan:
echo  -> Email: qxk4iitw@studentidcard.me
echo.
echo Vui long nhin len man hinh Desktop, trinh duyet se xuat hien sau vai giay...
echo.

node "%~dp0tools\windows-controller\interactiveLogin.js" qxk4iitw@studentidcard.me

echo.
pause
