# QLVB Mobile (PWA)

Tra cứu và tải văn bản từ **egov1.laocai.gov.vn** và **csdlvb.laocai.gov.vn** trên điện thoại.
Không cần thư viện ngoài (Node ≥ 18.17).

```
server.js        máy chủ tĩnh + 3 endpoint đăng nhập (/api/auth/start|captcha|finish)
lib/sso.js       auth broker: đăng nhập SSO login.yenbai.gov.vn trong cookie jar riêng từng lượt
public/          PWA: giao diện, service worker, adapter egov1.js / csdlvb.js (gọi thẳng API, CORS *)
```

## Bật / tắt

```bash
cd ~/QLVB_mobile/claude/app
./start.sh              # chạy server + mở public qua ngrok, in ra địa chỉ
./stop.sh               # dừng tất cả
./qlvb.sh status        # xem đang chạy hay không, địa chỉ public
./qlvb.sh restart       # khởi động lại (sau khi sửa code)
./qlvb.sh logs          # xem log server (Ctrl+C để thoát)
```

Cấu hình trong `qlvb.conf`: `PORT`, `PUBLIC=ngrok|none` (none = chỉ chạy trong máy), `NGROK_URL`.
Log và PID nằm ở `run/`.

## Public ra Internet (đang dùng: ngrok)

- Địa chỉ cố định của tài khoản ngrok: **https://nape-likewise-swampland.ngrok-free.dev** (không đổi giữa các lần chạy,
  nên PWA đã cài và phiên đăng nhập trên điện thoại được giữ nguyên).
- Gói free có trang cảnh báo "You are about to visit…": **lần đầu** mở trên điện thoại bấm **Visit Site**.
  Từ lần sau service worker tự gắn header `ngrok-skip-browser-warning` nên vào thẳng app.
- Lưu lượng qua ngrok rất nhỏ (giao diện + đăng nhập); văn bản tải thẳng từ máy chủ Lào Cai về điện thoại.
- Máy tính phải bật và WSL phải đang chạy thì mới truy cập được. WSL có thể tự tắt khi đóng hết cửa sổ terminal
  → để chạy lâu dài, để mở 1 cửa sổ Ubuntu, hoặc tạo tác vụ Task Scheduler lúc đăng nhập Windows:
  `wsl.exe -d Ubuntu -- bash -lc "~/QLVB_mobile/claude/app/start.sh; sleep infinity"`.

Cài lên điện thoại: iPhone → Safari → Chia sẻ → **Thêm vào MH chính**; Android → Chrome → **Cài đặt ứng dụng**.

### Phương án khác (khi cần)

| Cách | Ưu | Nhược |
|---|---|---|
| **ngrok** (đang dùng) | Đã cài sẵn, 1 lệnh, tên miền cố định, HTTPS | Trang cảnh báo lần đầu; phụ thuộc máy tính bật |
| Tailscale Serve | Riêng tư tuyệt đối (chỉ thiết bị của bạn), không cảnh báo | Phải cài Tailscale trên WSL **và** điện thoại |
| Cloudflare Tunnel | Không cảnh báo, ổn định | Cần tên miền riêng trỏ về Cloudflare (bản quick tunnel đổi URL mỗi lần → mất PWA/đăng nhập) |
| Docker trên máy chủ/VPS | Chạy 24/7 | Cần máy chủ; nếu đặt ở nước ngoài có thể bị hệ thống tỉnh chặn IP |


## Triển khai lên server khác (khuyến nghị: Docker)

Chỉ cần mang thư mục `app/` (không cần `research/`, `tools/`). App **không có thư viện npm nào**.

**1. Cài Docker** (Ubuntu/Debian):

```bash
curl -fsSL https://get.docker.com | sh
```

**2. Chép code:**

```bash
rsync -av --exclude run --exclude qlvb.conf ~/QLVB_mobile/claude/app/ user@server:~/qlvb-mobile/
```

**3. Kiểm tra server kết nối được tới hệ thống tỉnh** (quan trọng nhất – VPS nước ngoài có thể bị chặn):

```bash
cd ~/qlvb-mobile && ./check-network.sh
```

Tất cả phải `OK` (mã 200/302/404 đều được – 404 chỉ là trang gốc trống).

**4. Chạy app** (không cần `.env`; tự khởi động lại khi server reboot), mở `http://<IP-server>:8787`:

```bash
docker compose up -d --build
```

Khi cần public qua ngrok: tạo `.env` từ `.env.example` rồi chạy:

```bash
docker compose --profile ngrok up -d --build
```

Xem log / dừng / cập nhật code:

```bash
docker compose logs -f
```

```bash
docker compose down
```

```bash
docker compose up -d --build
```

(Nếu đang dùng ngrok thì thêm `--profile ngrok` vào các lệnh trên.)

Lưu ý: ngrok gói free chỉ cho **1 tunnel online cùng lúc** với cùng tên miền → trước khi chạy trên server mới
hãy `./stop.sh` ở máy WSL.

Không dùng Docker: cài Node.js ≥ 18.17 (khuyên dùng 20 LTS) + ngrok, rồi dùng `./start.sh` / `./stop.sh` như trên máy WSL.

## Bảo mật

- Mật khẩu chỉ đi qua broker trong một request, không ghi đĩa/log. Phiên đăng nhập dang dở tự huỷ sau 5 phút.
- Token lưu `localStorage` trên điện thoại, tách riêng `qlvb.auth.egov1` / `qlvb.auth.csdlvb`.
- Văn bản tải thẳng từ máy chủ gốc về điện thoại, không đi qua broker. Service worker chỉ cache giao diện.
- Khi public, ai có địa chỉ cũng mở được trang, nhưng không xem được gì nếu không có tài khoản QLVB (đăng nhập + captcha).
  Server giới hạn 20 lượt đăng nhập / 10 phút / IP.
- Chỉ dùng API đọc; không gọi các API đánh dấu "đã xem" / xử lý văn bản.
