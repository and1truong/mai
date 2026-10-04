# ADR-0001: Deploy một gói duy nhất

## Bối cảnh

MAI là POC nền tảng nội dung độc lập. Ràng buộc:

- Một instance sở hữu một thư viện nội dung. Không tenant, không workspace.
- Chạy được local, không credential, với fixture AI deterministic.
- Không phụ thuộc managed service để chạy.

## Quyết định

- **Một process Bun** chạy tất cả: `Bun.serve` phục vụ API + static frontend; job runner poll bảng `job` trong SQLite trong cùng process.
- **Frontend**: React + Radix Themes, build bằng `bun build` (HTML entrypoint) ra `dist/client` tĩnh. Không framework thêm (Next.js, Vite).
- **Dữ liệu**: SQLite qua `bun:sqlite` lưu quan hệ; file asset trong `MAI_DATA_DIR/assets/`. Không ORM.
- **Module nội bộ** (không phải service): `context`, `content` (nguồn + bản thể hiện + revision), `jobs`, `generation`, `review`, `formats`.
- **Provider AI**: interface `NhaCungCap` trong `modules/generation`; mặc định `fixture` deterministic. Adapter thật thêm sau, key chỉ từ env phía server.

## Hệ quả

- Deploy = `bun install && bun run build && bun run start`, hoặc một Docker image.
- Không cần Redis, worker riêng, managed DB, object storage hay IdP.
- Backup/restore = checkpoint WAL + copy thư mục data (`bun run backup` / `bun run restore`).
- Job chung process đơn giản nhưng giới hạn throughput — đủ cho POC. Tách runner sau nếu cần scale.
- Restart giữ nguyên thư viện nội dung vì mọi state nằm trong `MAI_DATA_DIR`.
