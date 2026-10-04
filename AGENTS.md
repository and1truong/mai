# AGENTS.md

Hướng dẫn bắt buộc cho mọi agent (Devin, Codex, Copilot, v.v.) làm việc trong repository này.

## Bối cảnh

Repository này để **public** nhằm tận dụng free compute của GitHub (Actions, v.v.). Mọi nội dung đẩy lên đây đều có thể bị người ngoài đọc, index và crawl.

## Quy tắc ngôn ngữ: tiếng Việt

Để giảm sự dòm ngó, **toàn bộ nội dung public trên GitHub phải viết bằng tiếng Việt**:

- **Issue / ticket**: tiêu đề, mô tả, bình luận.
- **Pull request**: tiêu đề, mô tả (summary), review comment, reply comment.
- **Comment** mọi loại: trên issue, PR, commit, discussion.
- **Commit message**: phần mô tả viết tiếng Việt (prefix kỹ thuật như `feat:`, `fix:`, `docs:` vẫn giữ nguyên).
- **Tài liệu trong repo** (README, docs/, kể cả file AGENTS.md này): tiếng Việt.

Ngoại lệ — giữ nguyên theo convention kỹ thuật, không bắt buộc tiếng Việt:

- Mã nguồn: tên biến, hàm, class, module, API.
- Tên file, đường dẫn, tên branch.
- Comment trong code: theo convention của file hiện có.
- Chuỗi/log kỹ thuật mà tooling hoặc bên thứ ba yêu cầu bằng tiếng Anh.

## Văn phong: theo tinh thần ASD-STE100

Nội dung giao tiếp (issue, PR, comment, tài liệu) nên viết theo tinh thần **ASD-STE100** (Simplified Technical English), áp dụng cho tiếng Việt — **không cần tuân thủ 100%**:

- Câu ngắn, một ý chính mỗi câu.
- Từ ngữ đơn giản, phổ biến; tránh hoa mỹ, ẩn dụ, đại từ mơ hồ.
- Chủ động, trực tiếp; hạn chế bị động dài.
- Một yêu cầu/mệnh lệnh mỗi câu khi viết hướng dẫn.
- Thuật ngữ nhất quán: cùng một khái niệm dùng cùng một từ.
- Ưu tiên danh sách, bảng, hoặc diff/pseudocode khi liệt kê hay mô tả thay đổi.

Mục tiêu: người đọc (kể cả agent và công cụ dịch tự động) hiểu đúng ngay, không phải suy đoán.

## Stack

- Runtime và package manager: **Bun**.
- Ngôn ngữ: **TypeScript**.
- UI: **Radix Themes**.

Quy tắc dependency:

- Thứ nào **Bun runtime đã có sẵn thì không cài dependency** — ví dụ `bun:test`, `Bun.serve`, `bun:sqlite`, `Bun.file`/`Bun.write`, `fetch`, `Bun.spawn`, `Bun.env`.
- Chỉ thêm dependency khi Bun không cung cấp sẵn và không có giải pháp đơn giản trong codebase.
- Dùng `bun` cho mọi lệnh (`bun install`, `bun run`, `bun test`), không dùng `npm`/`yarn`/`pnpm`/`node` trực tiếp.

## Kiến trúc MAI

MAI là POC nền tảng nội dung độc lập, **deploy một gói**: `Bun.serve` phục vụ API + frontend tĩnh, job runner chạy trong cùng process. Đọc `docs/adr-0001-mot-goi-duy-nhat.md` và `docs/conventions.md` trước khi sửa code.

Quy tắc thêm:

- Mọi state nằm trong `MAI_DATA_DIR` (mặc định `./data`): `mai.sqlite` + `assets/`. Không ghi dữ liệu chỗ khác.
- Không thêm dependency cho thứ Bun đã có: `bun:sqlite`, `Bun.serve`, `Bun.file`/`Bun.write`, `Bun.spawn`, `bun:test`, `fetch`. Không ORM, không framework server.
- Ranh giới module nội bộ trong `src/modules/`: context, content (nguồn + bản thể hiện + revision), jobs, generation, review, formats. Module mới đi qua API trong `src/server/api.ts`, không gọi chéo DB.
- Envelope API, mã lỗi, convention xung đột revision, log JSON, migration, seed: giữ đúng `docs/conventions.md`.
- Không đưa abstraction tenant/workspace/billing vào route, entity hay luồng người dùng.
- Provider AI thật là module nội bộ trong `modules/generation/`; key chỉ đọc từ env phía server, không commit key.

## Bảo mật

Vì repo public:

- Tuyệt đối không commit secret, credential, token, private key vào repo.
- Không đưa thông tin nhạy cảm (endpoint nội bộ, dữ liệu cá nhân, thông tin khách hàng) vào code, issue, PR hay comment.

---

*English: this repository is public only to take advantage of GitHub's free compute. All public-facing content — issues, PRs, comments — must be written in Vietnamese, in a simple ASD-STE100-like style (strict compliance not required). Follow the rules above.*
