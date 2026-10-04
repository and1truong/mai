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
| `XUNG_DOT_TRANG_THAI` | 409 | Chuyển trạng thái review không hợp lệ. |
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
- `khoa_idem` unique: enqueue lặp cùng khóa trả về đúng một job logic. Request state + enqueue trong một transaction.
- Attempt **ít-nhất-một-lần**: crash giữa attempt → job chạy lại khi lease hết hạn. Handler phải tự idempotent — kiểm lại entity/revision đích trước khi commit. Không khẳng định đúng-một-lần cho hiệu ứng từ xa (gửi mail, publish…) — đó là trách nhiệm của handler/provider.
- Lỗi tạm → retry với backoff có biên tới `so_lan_thu_toi_da`. `LoiVinhVien` hoặc hết lượt → `loi`, inspect/retry thủ công được (`POST /api/job/:id/thu-lai`).
- Hủy: `cho`/`dang_chay` → `huy`; commit attempt có guard (lease_token) nên kết quả trễ của job đã hủy bị bỏ, không thành active.
- Concurrency runner: config `jobs.concurrency` / env `MAI_JOB_CONCURRENCY`.
- Không scale đa instance, không điều phối phân tán trong POC.

## Actor

- POC dùng actor cố định `demo` phía server (`ACTOR_DEMO`).
- Field `tao_boi`/`cap_nhat_boi` ghi actor. Access control instance: #16 (P1).

## Thuật ngữ & identifier

- Identifier domain tiếng Việt không dấu: `nguon`, `ban_the_hien`, `revision`, `dinh_dang`, `trang_thai`.
- Text hiển thị/log có dấu đầy đủ.
