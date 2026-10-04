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

## Bảo mật

Vì repo public:

- Tuyệt đối không commit secret, credential, token, private key vào repo.
- Không đưa thông tin nhạy cảm (endpoint nội bộ, dữ liệu cá nhân, thông tin khách hàng) vào code, issue, PR hay comment.

---

*English: this repository is public only to take advantage of GitHub's free compute. All public-facing content — issues, PRs, comments — must be written in Vietnamese. Follow the rules above.*
