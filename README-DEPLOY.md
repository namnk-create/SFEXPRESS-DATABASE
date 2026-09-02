# SFEXPRESS DATABASE v5 — Deploy lên Cloudflare (Pages + Functions + D1)

Kiến trúc mới thay thế Firebase Firestore:
- **Cloudflare Pages** — host tĩnh `index.html` (giống cách bạn đang deploy GitHub Pages).
- **Cloudflare Pages Functions** (`functions/api/[[path]].js`) — đóng vai trò "Worker API", chứa toàn bộ logic backend trước đây nằm trong Firestore Rules + Firebase SDK.
- **Cloudflare D1** — database SQL (SQLite) thay thế Firestore, lưu warehouses/employees/reportCategories/config/sgnss/records/staff_log.

> **Lưu ý quan trọng về realtime**: D1 không có cơ chế "onSnapshot" như Firestore. Bản v5 dùng **polling** (client tự động gọi lại API mỗi 5–6 giây) để mô phỏng cập nhật gần-thời-gian-thực. Độ trễ tối đa ~5-6 giây thay vì tức thời như Firebase.

## Các file trong gói này
```
index.html                     ← file chính, deploy làm trang tĩnh
functions/api/[[path]].js      ← API backend (Cloudflare Pages Function)
schema.sql                     ← schema D1 (chạy 1 lần khi setup)
wrangler.toml                  ← cấu hình project + binding D1 (dùng nếu deploy bằng CLI)
```

## Bước 1 — Cài Wrangler CLI (nếu chưa có)
```bash
npm install -g wrangler
wrangler login
```

## Bước 2 — Tạo D1 database
```bash
wrangler d1 create sfexpress-db
```
Lệnh trên trả về một `database_id` — copy giá trị này dán vào file `wrangler.toml`, dòng `database_id = "..."`.

## Bước 3 — Khởi tạo schema
```bash
wrangler d1 execute sfexpress-db --remote --file=./schema.sql
```
(Function `functions/api/[[path]].js` cũng tự chạy `CREATE TABLE IF NOT EXISTS` + seed dữ liệu mặc định ở lần gọi API đầu tiên, nên bước này không bắt buộc 100% nhưng nên làm trước để chắc chắn schema đúng ngay từ đầu.)

## Bước 4 — Deploy lên Cloudflare Pages

### Cách A — Deploy trực tiếp bằng CLI (nhanh nhất để test)
```bash
cd /path/to/thu-muc-nay
wrangler pages deploy . --project-name=sfexpress-database
```
Sau khi deploy, vào **Cloudflare Dashboard → Workers & Pages → sfexpress-database → Settings → Functions → D1 database bindings**, thêm binding:
- Variable name: `DB`
- D1 database: `sfexpress-db`

Deploy lại (hoặc chỉ cần chờ vài giây) để binding có hiệu lực, sau đó vào lại URL Pages để dùng.

### Cách B — Kết nối Git (khuyến khích cho lâu dài)
1. Đẩy toàn bộ thư mục này lên một repo GitHub (giữ nguyên cấu trúc `index.html` ở root + thư mục `functions/`).
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git → chọn repo.
3. Build settings: **Framework preset: None**, **Build command: (để trống)**, **Build output directory: `/`**.
4. Sau khi deploy lần đầu, vào Settings → Functions → D1 database bindings → thêm binding `DB` → chọn database `sfexpress-db`.
5. Từ lần push tiếp theo, Cloudflare tự động build & deploy lại (giống GitHub Pages, nhưng có thêm API).

## Bước 5 — Kiểm tra
Mở URL Cloudflare Pages (dạng `https://sfexpress-database.pages.dev` hoặc domain riêng nếu đã gắn):
- Màn hình đăng nhập sẽ hiện "🔄 Đang kết nối máy chủ Cloudflare..." rồi chuyển sang form đăng nhập nếu API hoạt động.
- Nếu báo lỗi kết nối, mở DevTools Console (F12) để xem chi tiết — nguyên nhân thường gặp:
  1. Chưa gán D1 binding tên `DB` trong Settings → Functions.
  2. Chưa chạy `schema.sql` hoặc chưa deploy lại sau khi thêm binding.
  3. Thư mục `functions/api/[[path]].js` không nằm đúng vị trí (phải là `functions/api/[[path]].js`, không phải `api/[[path]].js` ở root).

Tài khoản demo giống hệt bản Firebase trước: `SGNSS`/`67890`, `WA001`/`12345`, `SSM001`/`12345`.

## So sánh nhanh với bản v4 (Firebase)

| | v4 — Firebase | v5 — Cloudflare |
|---|---|---|
| Lưu trữ | Firestore (NoSQL, tài liệu) | D1 (SQL, SQLite) |
| Backend logic | Chạy hoàn toàn ở client + Security Rules | Chạy trong Pages Function (`functions/api/`) |
| Cập nhật thời gian thực | `onSnapshot` (tức thời) | Polling 5–6 giây (gần thời gian thực) |
| Deploy | Firebase Console (thủ công) + host tĩnh riêng | 1 project Cloudflare Pages (host + API + DB cùng chỗ) |
| Chi phí | Free tier Firestore | Free tier Cloudflare D1 (5GB, 25 triệu read/ngày) |

## Rủi ro bảo mật (giữ nguyên như bản v4, CẦN LƯU Ý)
- Mật khẩu nhân viên/SGNSS vẫn lưu **plain-text** trong D1 (cột `password`). API hiện không có tầng xác thực request nào ngoài chính app kiểm tra mật khẩu ở phía client sau khi tải toàn bộ danh sách nhân viên — **bất kỳ ai gọi `GET /api/meta` cũng đọc được toàn bộ mật khẩu**. Mức bảo mật này tương đương bản Firebase trước (chỉ chặn truy cập nặc danh hoàn toàn, không che được mật khẩu).
- Đây vẫn là mức bảo mật "nội bộ/demo". Nếu cần dùng thật với dữ liệu nhạy cảm, nên nâng cấp:
  - Hash mật khẩu (bcrypt/scrypt) thay vì lưu plain-text.
  - Thêm xác thực request thật (Cloudflare Access, JWT, hoặc session cookie ký bởi Worker) thay vì để client tự kiểm tra mật khẩu sau khi đã tải toàn bộ dữ liệu nhân viên.
  - Giới hạn `GET /api/meta` không trả về cột `password` ra client (hiện tại trả về để client tự so sánh, giống hệt cách bản Firebase cũ hoạt động).

## Ghi chú thay đổi hành vi so với bản Firebase
- "Tải thêm" ở tab Download giờ dùng cursor theo `submittedAt` (thay vì `startAfter(doc)` của Firestore) — hoạt động tương đương, chỉ khác cơ chế nội bộ.
- Khi nộp báo cáo, giờ gửi (`submittedAt`) được server sinh ra (ISO đầy đủ) thay vì client cắt tới phút — chính xác hơn khi so deadline.
- Dữ liệu "tự làm mới" thay vì "tự động đồng bộ tức thời" — nếu 2 người dùng thao tác cùng lúc, người kia sẽ thấy thay đổi trong tối đa ~5-6 giây thay vì ngay lập tức.
