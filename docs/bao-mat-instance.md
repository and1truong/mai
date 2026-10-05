# Bảo mật instance (#16)

MAI self-hosted có hai chế độ, chọn bằng config `bao_mat.che_do` (file
`mai.config.json` hoặc env `MAI_BAO_MAT_CHE_DO`).

## `tin_cay` (mặc định)

- Dùng khi chạy trên máy local chỉ chủ sở hữu thao tác.
- Mọi API mở, không đăng nhập; actor audit là `demo`.
- Đăng nhập/đăng xuất trả 400 — báo rõ không cần thiết thay vì tạo phiên vô dụng.
- Chủ instance vẫn tạo sẵn tài khoản ở chế độ này (qua API hoặc script),
  rồi mới bật `bao_ve`.

## `bao_ve`

- Dùng khi expose instance ra ngoài máy tin cậy (LAN, tunnel, server).
- Mọi `/api/*` đòi phiên đăng nhập, trừ hai route công khai:
  `POST /api/dang-nhap` và `GET /api/tai-khoan/me`.
- Thiếu/sai/hết phiên → 401 `CHUA_DANG_NHAP`. Bypass actor demo tắt hoàn
  toàn — actor audit là id tài khoản đang đăng nhập.
- Bật bảo vệ không đổi dữ liệu: thư viện nội dung POC cũ đọc lại bình thường.

### Tài khoản

- Hai vai trò: `quan_tri` (đủ quyền, kể cả quản lý tài khoản) và
  `bien_tap` (toàn bộ thao tác nội dung; route quản lý tài khoản → 403
  `KHONG_CO_QUYEN`). Tất cả chia sẻ một thư viện — không tenant/workspace.
- Setup tạo admin đầu tiên bằng script:

  ```
  MAI_MAT_KHAU='<mk>' bun run tao-tai-khoan -- \
      --ten-dang-nhap admin --ten-hien-thi 'Quản trị' --vai-tro quan_tri
  ```

  Không đặt `MAI_MAT_KHAU` thì script hỏi tương tác không echo. Cố ý
  không nhận flag `--mat-khau`: argv lọt vào shell history và `ps`.
- Quản lý tiếp ở UI `#/tai-khoan` hoặc API `/api/tai-khoan` (chỉ quản trị).
  Biên tập tự đổi mật khẩu của mình tại cùng trang (cần mật khẩu cũ).
- Vô hiệu tài khoản hoặc đổi mật khẩu thu hồi ngay toàn bộ phiên của tài
  khoản đó. Quản trị không tự giáng vai trò/tự vô hiệu chính mình.

### Phiên và mật khẩu

- Mật khẩu hash bằng `Bun.password` (argon2id, thư viện runtime duy trì).
  Đăng nhập verify cả khi tài khoản không tồn tại (dummy hash) để thời gian
  phản hồi không lộ tài khoản nào tồn tại.
- Token phiên 32 byte ngẫu nhiên; DB chỉ lưu sha256(token) — lộ DB không
  lộ token. Cookie `mai_phien` `HttpOnly; SameSite=Lax`; `phien_ttl_phut`
  (mặc định 10080 = 7 ngày); `cookie_secure` thêm cờ `Secure` khi chạy HTTPS.
- Không rate-limit trong POC — xem phần giới hạn của AGENTS.md.

### Config

```json
"bao_mat": {
  "che_do": "bao_ve",
  "phien_ttl_phut": 10080,
  "cookie_secure": true
}
```

Env: `MAI_BAO_MAT_CHE_DO`, `MAI_BAO_MAT_PHIEN_TTL_PHUT`,
`MAI_BAO_MAT_COOKIE_SECURE`. Giá trị `che_do` lạ → server từ chối chạy
(không âm thầm fallback về mở).

## Route cố ý public

Các route ngoài `/api/` vẫn mở kể cả ở `bao_ve` — đây là thiết kế:

- `GET /p/<ban_the_hien_id>` — trang đã xuất bản, ghim đúng revision đã
  duyệt; không bao giờ trả nội dung nguồn hay revision chưa duyệt.
- `GET /huy-dang-ky?token=...` — hủy đăng ký email bằng link một lần.
- `GET /l/<token>` — link dịch vụ kênh (xem trước/đồng ý giao) có token riêng.

## Mở rộng reviewer local

`cong_quyen.che_do_bao_ve` và `thuong_hieu.bat_buoc_duyet` yêu cầu
`nguoi_duyet_id`. Ở `bao_ve`, id này phải map tài khoản hoạt động của
instance (id hoặc `ten_dang_nhap`), ngoài điều kiện có trong
`ds_nguoi_duyet` của campaign/thị trường như cũ. Tạo tài khoản với
`ten_dang_nhap` trùng id reviewer trong policy là đủ.
