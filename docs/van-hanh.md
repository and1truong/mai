# Vận hành MAI

## Backup

```bash
bun run backup
```

- Script checkpoint WAL (`PRAGMA wal_checkpoint(TRUNCATE)`) trước khi copy.
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
- Kiểm tra sau restore: `curl http://localhost:3000/api/health` → `"ok":true`; mở `#/nguon` thấy dữ liệu.

## Reset

```bash
bun run reset
```

Xóa `data/`, chạy lại migration, seed demo. Dùng khi muốn môi trường sạch.
