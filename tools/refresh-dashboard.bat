@echo off
chcp 65001 >nul
title AutoRewardPlus - Làm mới số liệu Dashboard

echo =======================================================================
echo     AUTOREWARDPLUS - LÀM MỚI SỐ LIỆU DASHBOARD TỪ MICROSOFT
echo =======================================================================
echo.
echo Đọc điểm thật (available points, level, streak, tuổi tài khoản) từ
echo rewards.bing.com cho các nick đã có session, ghi đè db.json cache.
echo.

ssh oracle "cd /home/ubuntu/AutoRewardPlus-v7.2.1 && export PATH=/home/ubuntu/.nvm/versions/node/v24.20.0/bin:$PATH && node dist/services/refreshDashboardState.js --concurrency 2"

echo.
echo [Xong] Mở dashboard để xem số liệu mới.
timeout /t 5 >nul
