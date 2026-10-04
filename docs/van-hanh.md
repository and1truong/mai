# Vận hành MAI

## Backup

```bash
bun run backup
```

- Database copy bằng `VACUUM INTO` → bản copy nhất quán, atomic phía SQLite.
- `assets/` copy bằng `cpSync`.
- Output: `backups/<timestamp>/` chứa `mai.sqlite` + `assets/`.
- Chạy được khi server đang chạy; khuyến nghị backup khi server dừng để chắc chắn.

## Restore

```bash
# 1. Dừng server.
# 2. Restore:
bun run restore -- backups/<ten> --thay-the
# 3. Chạy lại server:
bun run start
```

- `--thay-the` ghi đè thư mục `data/` hiện có. Bỏ flag để hỏi trước khi ghi đè.
- Restore an toàn: copy sang `data.restore-tmp` rồi `rename` đổi chỗ — lỗi giữa chừng không mất data hiện có.
- Script từ chối chạy khi server còn sống (tránh mất dữ liệu). Thêm `--chap-nhan` để ép.
- Kiểm tra sau restore: `curl http://localhost:3000/api/health` → `"ok":true`; mở `#/nguon` thấy dữ liệu.

## Reset

```bash
bun run reset
```

Xóa `data/`, chạy lại migration, seed demo. Dùng khi muốn môi trường sạch.
Script từ chối chạy khi server còn sống (xóa data lúc server chạy = mất dữ liệu). Thêm `--chap-nhan` để ép.
