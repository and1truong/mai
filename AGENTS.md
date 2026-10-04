# AGENTS.md

Hướng dẫn bắt buộc cho mọi agent (Devin, Codex, Copilot, v.v.) làm việc trong repository này.

## Bối cảnh

Repository này để **public** nhằm tận dụng free compute của GitHub (Actions, v.v.). Mọi nội dung đẩy lên đây đều có thể bị người ngoài đọc, index và crawl.

## Phạm vi: POC

Dự án này là **POC** (proof of concept). Vì vậy:

- UI **không cần hỗ trợ mobile hay small screens** — chỉ cần hoạt động tốt trên desktop.
- Không làm responsive design cho viewport nhỏ; không viết code, test hay review theo tiêu chí đó.

Ngoài ra, **bỏ qua** các nhóm sau:

Non-functional:

- Performance tuning: bundle size, lazy-load, code-split.
- SEO, meta tags, Open Graph.
- PWA/offline, service worker.

Vận hành:

- Analytics, telemetry, error tracking (Sentry v.v.).
- Security hardening nâng cao: CSP, rate limiting, security headers — quy tắc không commit secret ở mục **Bảo mật** vẫn giữ nguyên.
- Migration, backward-compat, versioning API.

Quy trình:

- Coverage threshold, e2e test bắt buộc — chỉ test cho logic cốt lõi.
- Tài liệu đầy đủ — README/AGENTS.md ở mức tối thiểu là đủ.

Reviewer agent:

- **Không cần quét sâu** — không audit ngoài phạm vi của PR.
- Chỉ cần xác nhận **tính năng có hoạt động đúng trong defined scope hay không**.

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

## Bảo mật

Vì repo public:

- Tuyệt đối không commit secret, credential, token, private key vào repo.
- Không đưa thông tin nhạy cảm (endpoint nội bộ, dữ liệu cá nhân, thông tin khách hàng) vào code, issue, PR hay comment.

---

*English: this repository is public only to take advantage of GitHub's free compute. All public-facing content — issues, PRs, comments — must be written in Vietnamese, in a simple ASD-STE100-like style (strict compliance not required). Follow the rules above.*
