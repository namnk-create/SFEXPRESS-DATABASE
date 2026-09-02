# SFEXPRESS DATABASE v5.1 — Deploy Cloudflare Worker (Static Assets + D1)

## Vì sao đổi kiến trúc so với bản trước?
Tài khoản Cloudflare hiện tại không còn hỗ trợ luồng **"Pages cổ điển" khi Connect to Git** — mọi project kết nối Git đều tự động tạo dưới dạng **Worker kiểu mới**, với Deploy command mặc định `npx wrangler deploy`. Thay vì cố ép quay lại Pages cổ điển, bản v5.1 này cấu hình đúng theo kiến trúc Worker mới, dùng tính năng **Static Assets** (Worker vừa phục vụ file tĩnh, vừa xử lý API) — đây cũng là hướng Cloudflare khuyến khích cho project mới.

## Cấu trúc thư mục (BẮT BUỘC đúng như sau)
```
your-repo/
├── worker.js          ← code Worker: routing + toàn bộ API (trước đây là functions/api/[[path]].js)
├── wrangler.toml       ← cấu hình: main, assets, D1 binding
├── schema.sql          ← chạy 1 lần trong D1 Console
├── README-DEPLOY.md
└── public/
    └── index.html      ← toàn bộ giao diện (chuyển từ vị trí gốc vào đây)
```

**Khác biệt quan trọng so với bản trước:**
- KHÔNG còn thư mục `functions/api/`.
- `index.html` chuyển vào trong thư mục `public/`.
- File `worker.js` (ở ngoài cùng, ngang hàng `wrangler.toml`) là entry point duy nhất — gộp toàn bộ logic API cũ + thêm phần chuyển tiếp file tĩnh (`env.ASSETS.fetch(request)`).

## Các bước deploy

### Bước 1 — Cập nhật repo GitHub
Xoá cấu trúc cũ (`funtions/`, hoặc `functions/`, và `index.html` ở gốc), thay bằng cấu trúc mới ở trên. Cách nhanh nhất: xoá sạch nội dung repo cũ, rồi tải lại đúng 5 mục trong gói này lên (qua GitHub Desktop: xoá file cũ trong thư mục local → copy đè bằng bộ file mới → Commit → Push).

### Bước 2 — D1 database
Không cần làm lại — `sfexpress-database` (D1) đã tồn tại sẵn, `wrangler.toml` đã điền đúng `database_id`.

### Bước 3 — Tạo lại Worker project trên Cloudflare (Connect to Git)
1. Cloudflare Dashboard → **Workers & Pages** → **Create application**
2. Chọn **Connect to Git** (hoặc tương đương) → chọn repo đã cập nhật
3. Build settings: để mặc định — **không cần sửa Deploy command**, vì giờ `wrangler.toml` đã có đủ `main` + `[assets]`, lệnh mặc định `npx wrangler deploy` sẽ tự chạy đúng.
4. **Save and Deploy**

### Bước 4 — Kiểm tra binding D1 tự động
Vì `wrangler.toml` đã khai báo sẵn `[[d1_databases]]` với `binding = "DB"`, Cloudflare **tự động gán binding này khi deploy** — không cần vào tay Settings → Bindings để thêm nữa (khác với bản Pages cũ). Bạn có thể vào tab **Bindings** để xác nhận `DB` đã xuất hiện.

### Bước 5 — Mở trang web kiểm tra
Vào tab **Overview** của Worker vừa tạo, tìm URL dạng:
```
https://sfexpress-database.<tên-bạn>.workers.dev
```
Mở URL đó — nếu thấy màn hình "🔐 ĐĂNG NHẬP" hiện ra bình thường (không lỗi kết nối) là thành công. Đăng nhập thử `SGNSS` / `67890`.

## Từ nay chỉnh sửa code ở đâu?
- Sửa giao diện/tính năng hiển thị → sửa `public/index.html`
- Sửa logic API / thêm bảng mới → sửa `worker.js`
- Đổi cấu trúc database (thêm cột/bảng) → chạy `ALTER TABLE` trong D1 Console + cập nhật `schema.sql` + cập nhật `worker.js`

Mỗi lần sửa xong, chỉ cần `git push` (hoặc Commit + Push trong GitHub Desktop) — Cloudflare tự động deploy lại.
