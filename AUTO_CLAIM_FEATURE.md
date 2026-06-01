# Tính năng Auto Claim Points - Hoàn thành

## Tổng quan
Đã thêm chức năng tự động claim điểm khi có điểm "Ready to claim" trên trang /dashboard của Microsoft Rewards (Modern UI).

## Các file đã sửa đổi

### 1. **src/interface/Config.ts**
- Thêm `claimedPoints: number` vào interface `UserData`
- Thêm `doClaimPoints: boolean` vào interface `ConfigWorkers`

### 2. **src/util/Validator.ts**
- Thêm validation cho `doClaimPoints: z.boolean().default(true)` trong workers schema

### 3. **src/config.json & src/config.example.json**
- Thêm `"doClaimPoints": true` vào phần workers config

### 4. **src/index.ts**
- Thêm `claimedPoints: number` vào interface `UserData`
- Khởi tạo `claimedPoints: 0` trong constructor
- Reset `claimedPoints = 0` trước mỗi account (dòng 218)
- Thêm `claimedPoints` vào `AccountStats` interface
- Lưu `claimedPoints` vào stats sau mỗi account

### 5. **src/functions/ModernUIWorkers.ts**
Thêm 3 methods mới:

#### `doClaimPoints(page: Page): Promise<{ claimed: boolean; points: number }>`
- Method chính để claim điểm
- Điều hướng đến /dashboard
- Tìm card "Ready to claim"
- Click card để mở flyout
- Click button "Claim points"
- Trả về `{ claimed: true, points: N }` hoặc `{ claimed: false, points: 0 }`

#### `findClaimCard(page: Page): Promise<{ points: number } | null>`
- Tìm card có text "Ready to claim"
- Extract số điểm từ `<p class="text-pageHeader">`
- Trả về object chứa số điểm hoặc null nếu không tìm thấy

#### `clickClaimCard(page: Page, claimCard: { points: number }): Promise<void>`
- Click vào card có số điểm tương ứng
- Dùng để mở flyout

### 6. **src/functions/SearchManager.ts**
- Thêm call đến `doClaimPoints()` trong `runModernUITasks()`
- Tích lũy `claimedPoints` vào `this.bot.userData.claimedPoints`
- Log thành công với màu xanh

### 7. **src/logging/Discord.ts**
- Thêm `claimedPoints: number` vào interface `AccountSummary`
- Tính tổng `totalClaimed` từ tất cả accounts
- Hiển thị "Total Claimed" trong Discord summary embed
- Thêm "Claimed: N pts" vào per-account notification nếu có claim

### 8. **src/logging/Ntfy.ts**
- Đã có sẵn `claimedPoints` trong code (dòng 58)
- Hiển thị "Claimed: N pts" trong Ntfy notification

## Luồng hoạt động

```
1. User chạy bot với doClaimPoints: true trong config
2. Bot đăng nhập và vào trang /dashboard
3. ModernUIWorkers.doClaimPoints() được gọi sau khi hoàn thành các task khác
4. Tìm card "Ready to claim" trên trang
   - Nếu không tìm thấy → log "No points ready to claim" → return
   - Nếu tìm thấy → extract số điểm (ví dụ: 124)
5. Click card để mở flyout
6. Chờ flyout hiện ra (2 giây)
7. Tìm và click button "Claim points"
8. Đợi 3 giây để claim hoàn tất
9. Log thành công: "✔ Claimed 124 points"
10. Lưu claimedPoints vào userData
11. Reset claimedPoints về 0 trước khi chạy account tiếp theo
12. Gửi Discord/Ntfy notification với thông tin claimed points
```

## Discord Notification Format

### Per-account notification:
```
✅ Account: user@example.com
Old point: 1,000
New point: 1,124
Earned: +124 pts
Claimed: 50 pts
```

### Summary embed (cuối run):
```
📊 Summary
**Total Earned:** +500 pts
**Total Claimed:** 200 pts
**All Points:** 5,000 pts
**Accounts:** 3/3 success
```

### Account line trong summary:
```
✅ `user@example.com` — **+124** pts → Total: **1,124** | Claimed: **50** _(45.2s)_
```

## Testing

Build thành công:
```bash
npx tsc --noEmit  # Không có lỗi
npx tsc           # Build thành công
```

## Cấu hình

Trong `src/config.json`:
```json
{
  "workers": {
    "doClaimPoints": true
  }
}
```

Đặt `false` để tắt tính năng auto claim.

## Lưu ý

- Tính năng chỉ hoạt động với Modern UI (Microsoft Rewards giao diện mới)
- Tự động skip nếu không có điểm nào ready to claim
- `claimedPoints` được reset về 0 trước mỗi account để tránh tích lũy sai
- Tích hợp đầy đủ với Discord và Ntfy notifications
