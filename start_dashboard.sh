#!/usr/bin/env bash
echo "=========================================="
echo "   Khởi chạy AutoRewardPlus Dashboard..."
echo "=========================================="

if [ "$1" == "--cli" ]; then
    npm run dashboard:cli
else
    npm run dashboard
fi
