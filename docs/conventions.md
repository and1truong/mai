# Convention MAI

## Envelope API

Mọi response JSON dùng một envelope:

- Thành công: `{ "ok": true, "du_lieu": ... }`.
- Lỗi: `{ "ok": false, "loi": { "ma", "thong_diep", "chi_tiet" } }`.

Mã lỗi hiện có:

| Mã | HTTP | Ý nghĩa |
| --- | --- | --- |
| `VALIDATION` | 400 | Input không hợp lệ. `chi_tiet` là mảng lỗi từng trường. |
| `KHONG_TIM_THAY` | 404 | Tài nguyên hoặc route không tồn tại. |
| `XUNG_DOT_REVISION` | 409 | `dua_tren_revision_id` khác `head_revision_id` hiện tại. |
| `XUNG_DOT_TRANG_THAI` | 409 | Xung đột trạng thái: chuyển trạng thái review không hợp lệ, xóa asset đang được tham chiếu. |
| `PAYLOAD_QUA_LON` | 413 | Body request vượt 50 MB. |
| `XUNG_DOT_JOB` | 409 | Chuyển trạng thái job không hợp lệ (hủy/retry sai trạng thái). |
| `LOI_CAU_HINH` | 500 | Config/provider sai. |
| `LOI_NOI_BO` | 500 | Lỗi không lường trước. |

## Validation

- Gom lỗi từng trường vào `dsLoi` rồi trả một response 400 duy nhất (`nemLoiValidation`).
- Không trả lỗi đầu tiên rồi dừng — client thấy hết lỗi một lần.

## Xung đột revision

- Revision là **immutable**: chỉ INSERT, không UPDATE.
- Client gửi `dua_tren_revision_id` = `head_revision_id` mà nó thấy.
- Khác head hiện tại → 409 `XUNG_DOT_REVISION`, kèm `head_revision_id` trong `chi_tiet`.
- Client tải lại dữ liệu rồi thử lại.

## Trạng thái review

`nhap → cho_duyet → da_duyet | tu_choi`. `da_duyet`/`tu_choi` quay được về `nhap`.
Chuyển sai → 409 `XUNG_DOT_TRANG_THAI`.

## Log

- Một dòng = một JSON object: `{ ts, level, event, ...truong }`.
- `level`: `info` | `warn` | `error`. `event`: dạng `module.su_kien` (vd `job.xong`).
- Key ascii snake_case. Không log secret, token, key.

## Migration

- File `NNNN_ten.sql` trong `src/server/migrations/`, tăng dần.
- Mỗi file chạy trong một transaction. Ghi `schema_migrations(so, tep)` nên idempotent.
- Số đã apply mà tên file khác → runner báo lỗi (không skip âm thầm).
- Thêm bảng/cột: tạo file mới, không sửa file cũ đã apply.

## Seed / fixture

- Seed dùng id cố định + kiểm tra tồn tại → chạy lại được.
- Provider `fixture` deterministic: cùng input → cùng output, không gọi mạng.
- Tên loại job, handler: snake_case (vd `sinh_ban_the_hien`).

## Job nền

- Bền trên SQLite (`job` + `job_log`), runner trong cùng process — không worker/broker riêng.
- Trạng thái: `cho → dang_chay → xong | loi | huy`. `chay_som_nhat` = lên lịch; `mui_gio` = timezone ngữ cảnh cho UI.
- `khoa_idem` unique: cùng khóa → đúng một job logic. Job còn 'cho'/'dang_chay' → dedupe (`da_tao=false`). Job đã 'xong'/'loi'/'huy' → reset về 'cho' và chạy lại cùng dòng (log `enqueue_lai`) — hủy/kết thúc không khóa enqueue vĩnh viễn. Request state + enqueue trong một transaction.
- Attempt **ít-nhất-một-lần**: crash giữa attempt → job chạy lại khi lease hết hạn. Handler phải tự idempotent — kiểm lại entity/revision đích trước khi commit và gọi `ctx.assertConHan()` trước mỗi ghi side-effect (attempt quá timeout vẫn chạy nền nhưng không commit được). Không khẳng định đúng-một-lần cho hiệu ứng từ xa (gửi mail, publish…) — đó là trách nhiệm của handler/provider.
- Lỗi tạm → retry với backoff có biên tới `so_lan_thu_toi_da`. `LoiVinhVien` hoặc hết lượt → `loi`, inspect/retry thủ công được (`POST /api/job/:id/thu-lai`).
- Hủy: `cho`/`dang_chay` → `huy`; commit attempt có guard (lease_token) nên kết quả trễ của job đã hủy bị bỏ, không thành active.
- Concurrency runner: config `jobs.concurrency` / env `MAI_JOB_CONCURRENCY`.
- Không scale đa instance, không điều phối phân tán trong POC.

## Actor

- POC dùng actor cố định `demo` phía server (`ACTOR_DEMO`).
- Field `tao_boi`/`cap_nhat_boi` ghi actor. Access control instance: #16 (P1).

## Nạp nguồn & asset (#17)

- Nguồn vào: dán text (`POST /api/nguon/nhap`, `POST /api/nguon/:id/nhap`) hoặc upload file (`POST /api/assets?ten=...`).
- Loại file nhận: `van_ban` = `.txt`, `.md` (UTF-8, tối đa 2 MB); `hinh_anh` = `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` (tối đa 20 MB). Loại khác → 400 `VALIDATION`.
- Upload `van_ban` cũng đi qua pipeline nạp: tạo nguồn mới (hoặc revision mới khi có `?nguon_id=`) rồi gắn asset vào nguồn đó.
- Byte gốc nằm trong `MAI_DATA_DIR/assets/<uuid>.<ext>` — tên file do server đặt, tên gốc chỉ lưu để hiển thị (`asset.ten_file`, đã làm sạch). Byte không bao giờ ghi ngoài thư mục data.
- `asset` lưu metadata: loại, mime, kích thước, checksum sha256, ghi chú, `nguon_id`, `trang_thai` (`hoat_dong | luu_tru`).
- Idempotency: `khoa_idem` unique trên `asset` và `nguon_revision` → retry cùng khóa trả lại bản ghi cũ. Upload trùng byte cũng dedupe theo checksum — cùng byte chỉ một asset (không ghi lại), trừ khi nhắm `nguon_id` khác thì vẫn tạo revision trên đích. `asset.nguon_id` giữ liên kết **đầu tiên**; liên kết mới chỉ gắn khi asset chưa có. Nạp text giống hệt head hiện tại → no-op, không tạo revision.
- `chuanHoaCacMuc` tách nội dung theo heading `#`–`######` thành `cac_muc` có id ổn định (`s-<slug>`); phần trước heading đầu tiên là `mo-dau`, không heading là `noi-dung`. `nguon.noi_dung` giữ bản gốc.
- Đính kèm là **chọn tường minh**: `PUT /api/ban-the-hien/:id/assets` thay toàn bộ tập asset của đầu ra. Asset `luu_tru` không gắn được. `xuat_ban.asset_ids` snapshot danh sách tại thời điểm xuất bản.
- Serve byte: `GET /api/assets/:id/noi-dung` — văn bản trả `text/plain`, thêm `nosniff`, filename trong header đã làm sạch. Nội dung upload không chạy được script.
- Xóa: asset đang được tham chiếu (bản thể hiện đang đính kèm, mục nguồn/revision chứa id asset, hoặc snapshot `xuat_ban.asset_ids`) → 409 `XUNG_DOT_TRANG_THAI`; dùng `POST /api/assets/:id/luu-tru` để archive mà giữ provenance.
- Storage qua interface `KhoByte` hẹp (`ghi/doc/tonTai/xoa`); `khoByteLocal` cho đĩa, `taoKhoByteMem` cho test. Không cloud storage trong POC.
- Giới hạn POC: ingest text + ghi asset không nguyên tử (lỗi giữa chừng có thể để revision không asset — retry cùng `khoa_idem` tự lành); hai upload đồng thời cùng byte không khóa có thể tạo asset trùng (checksum không unique).

## Thuật ngữ & identifier

- Identifier domain tiếng Việt không dấu: `nguon`, `ban_the_hien`, `revision`, `dinh_dang`, `trang_thai`.
- Text hiển thị/log có dấu đầy đủ.
