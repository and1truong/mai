# MAI

MAI là nền tảng nội dung độc lập (POC). Deploy **một gói duy nhất**: frontend + API + job nền trong một process Bun.

MAI **không phải** SaaS. Một instance sở hữu một thư viện nội dung. Không tenant, không workspace, không billing, không control plane.

## Chạy nhanh

```bash
bun install
bun run build
bun run start
```

Mở http://localhost:3000.

Khởi tạo dữ liệu demo:

```bash
bun run reset   # xóa data, migrate, seed — chạy lại được
```

## Lệnh

| Lệnh | Tác dụng |
| --- | --- |
| `bun install` | Cài dependency. |
| `bun run dev` | Dev: watch build frontend + hot reload server. |
| `bun run build` | Build frontend → `dist/client`. |
| `bun run start` | Chạy server: frontend + API + job runner trong 1 process. |
| `bun run reset` | Xóa `data/`, chạy migration, seed lại (từ chối khi server đang chạy). |
| `bun run seed` | Ghi dữ liệu demo (idempotent). |
| `bun test` | Chạy test (unit + smoke). |
| `bun run typecheck` | Kiểm tra kiểu TypeScript. |
| `bun run backup` | Backup `data/` → `backups/<timestamp>/`. |
| `bun run restore -- <dir> [--thay-the]` | Restore từ một thư mục backup (từ chối khi server đang chạy). |

## Config

Copy `mai.config.example.json` → `mai.config.json`, hoặc dùng biến môi trường.

| Biến môi trường | Mặc định | Tác dụng |
| --- | --- | --- |
| `PORT` | `3000` | Port HTTP. |
| `MAI_DATA_DIR` | `./data` | Thư mục data (volume bền). |
| `MAI_CONFIG` | `./mai.config.json` | Đường dẫn file config. |
| `MAI_AI_PROVIDER` | `fixture` | Provider sinh nội dung. |
| `MAI_JOB_CONCURRENCY` | `2` | Số job chạy song song trong runner. |
| `MAI_JOB_CHU_KY_MS` | `500` | Chu kỳ poll của runner (ms). |

Ưu tiên: biến môi trường > file config > mặc định.

## Volume bền

`MAI_DATA_DIR` là volume bền của một instance:

| Đường dẫn | Nội dung |
| --- | --- |
| `data/mai.sqlite` | Dữ liệu quan hệ (SQLite, WAL). |
| `data/assets/` | File upload. |

Backup/restore: xem `docs/van-hanh.md`.

## Deploy một artifact

- Local: `bun install && bun run build && bun run start`.
- Docker: `docker build -t mai . && docker run -p 3000:3000 -v mai-data:/data mai`.
- Không cần Redis, worker riêng, managed database, object storage hay identity provider.

## Chế độ demo

- Actor cố định: `demo` (ghi trong `tao_boi`). Access control instance là ticket #16 (P1).
- Provider AI: `fixture` — deterministic, chạy offline, không credential.
- Adapter AI thật sẽ là module nội bộ cùng interface (`src/modules/generation/`). Key provider chỉ đọc từ env phía server.

## Ranh giới POC

- Một instance = một thư viện nội dung. Không đưa tenant/workspace vào route, entity hay luồng người dùng.
- Chạy local tin cậy. Không yêu cầu deploy public hay hardening production.

## Cấu trúc

```
src/
  config.ts            # config file + env
  log.ts               # log JSON một dòng
  loi.ts               # lỗi API + validation dùng chung
  modules/             # ranh giới module nội bộ
    context/           #   thương hiệu/đối tượng
    content/           #   nguồn + bản thể hiện + revision
    jobs/              #   job nền trong process
    generation/        #   provider sinh nội dung (fixture + interface)
    review/            #   vòng đời duyệt
    formats/           #   định dạng/kênh đầu ra
  server/
    index.ts           #   Bun.serve: API + static + runner
    api.ts             #   route API
    db.ts              #   mở SQLite + migration runner
    migrations/        #   file NNNN_ten.sql
    seed.ts            #   dữ liệu demo
    static.ts          #   phục vụ dist/client
  client/              #   React + Radix Themes
scripts/               #   dev, reset, backup, restore
tests/                 #   bun:test (unit + smoke)
docs/                  #   ADR, conventions, vận hành
```

## Convention dev

Xem `docs/conventions.md` và `docs/adr-0001-mot-goi-duy-nhat.md`.
