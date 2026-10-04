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

`nhap → cho_duyet → da_duyet | tu_choi`, `thay_the → cho_duyet | nhap`, `da_duyet`/`tu_choi`/`cho_duyet` quay được về `nhap`.
Chuyển sai → 409 `XUNG_DOT_TRANG_THAI`.

- Duyệt (`→ da_duyet`) bắt buộc `mong_doi_revision_id` = head người chấm đang nhìn (#21).
  Thiếu → 400 `VALIDATION`; khác head hiện tại → 409 `XUNG_DOT_REVISION` (request duyệt cũ lỗi sạch).
- Revision mới sau `da_duyet` → `thay_the` tự động; sau `tu_choi` → `nhap` tự động
  (sự kiện `trang_thai_tu_dong`, không ghi record `duyet` — không phải hành động chấm).
- Chỉ `da_duyet` mới `POST /xuat-ban` được — khác → 409 `XUNG_DOT_TRANG_THAI`.

## Log

- Một dòng = một JSON object: `{ ts, level, event, ...truong }`.
- `level`: `info` | `warn` | `error`. `event`: dạng `module.su_kien` (vd `job.xong`).
- Key ascii snake_case. Không log secret, token, key.

## Editor & nháp soạn (#21)

- `nhap_soan` (migration 0009): một nháp autosave cho mỗi `(ban_the_hien_id, actor)`,
  upsert qua `PUT /api/ban-the-hien/:id/nhap {noi_dung, dua_tren_revision_id?}`;
  `GET` trả 404 khi chưa có; `DELETE` bỏ nháp. Lưu revision thành công tiêu thụ nháp.
  `dua_tren_revision_id` của nháp giữ head client thấy lúc bắt đầu sửa — rebase chỉ
  xảy ra khi client tường minh gửi base mới (sau khi giải quyết xung đột).
- Xung đột ở UI: 409 `XUNG_DOT_REVISION` → giữ text local + hiện diff với head mới,
  user chọn "lưu lên head mới" hay tiếp tục soạn — không last-write-wins.
- Khôi phục revision cũ = tạo revision mới mang nội dung cũ — không viết lại lịch sử.
- Đề xuất AI (`revision.tao_boi = 'job'` chưa được record `duyet` nào ghim) hiện panel
  riêng: chấp nhận = đi duyệt, từ chối = revision mới bằng nội dung revision trước đó.
- Hàng chờ review: `GET /api/ban-the-hien?trang_thai=`; lịch sử chấm:
  `GET /api/ban-the-hien/:id/duyet`.

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

## Định dạng & export (#19)

- Registry có phiên bản trong `src/modules/formats/index.ts`: `bai-viet`, `newsletter`, `caption`, `thread`, `script-ngan`, `script-dai`, `faq`. Mỗi định dạng khai báo `id`, `phien_ban`, `nhan`, `mo_ta`, `ngon_ngu`, `truong` (ten/nhan/loai `van_ban|markdown|danh_sach`, `bat_buoc`, `do_dai_toi_da`, `so_muc_toi_da`). Định dạng mới thêm một entry vào registry — không sửa model `thong_diep`/`ban_the_hien`.
- Nội dung canonical: `revision.noi_dung` là JSON object `{ <ten_truong>: chuỗi | chuỗi[] }`. Chuỗi không phải JSON (vd output provider) map vào trường markdown `noi_dung` nếu định dạng khai báo, còn không giữ ở `_tho` và render kèm warning field thiếu.
- `kiemTraNoiDung` trả `LoiDinhDang[] {truong, loi}` — thiếu bắt buộc, vượt độ dài/số mục, trường lạ → phản hồi sửa cụ thể. Đây là cảnh báo để sửa/duyệt, không chặn lưu. `POST /api/ban-the-hien/:id/revision` trả kèm `ds_loi_dinh_dang`; `GET /api/ban-the-hien/:id/xem-truoc` trả `ds_loi` cùng loại.
- `kiemTraNgonNgu` chặn ngôn ngữ đầu ra ngoài `def.ngon_ngu` (hiện `["vi","en"]`) khi tạo bản thể hiện và khi enqueue `sinh_ban_the_hien`.
- `ban_the_hien.phien_ban_dinh_dang` ghim `def.phien_ban` lúc tạo — renderer đổi sau vẫn truy về được schema đã dùng. `xem-truoc`, `ds_loi_dinh_dang` và `manifest.dinh_dang.phien_ban` đều báo phiên bản đã ghim; khi registry mới hơn phiên bản ghim, response kèm cảnh báo `_dinh_dang`.
- Renderer (`modules/formats/render.ts`) thuần hàm, deterministic, không LLM: `renderMarkdown`, `renderText`, `renderHtml`. HTML whitelist: escape mọi ký tự đặc biệt, chỉ lại heading/list/quote/hr/p + inline `**`, `*`, `` ` ``, `[t](u)` — `href` chỉ nhận `http(s)://`, `mailto:`, `/`, `#` (scheme khác thành text trơ).
- Xem trước: `GET /api/ban-the-hien/:id/xem-truoc?revision_id=` (mặc định head) → `{html, markdown, text, ds_loi, revision_id, dinh_dang, phien_ban_dinh_dang}`. Không gọi provider, không sửa nội dung.
- Export: `GET /api/ban-the-hien/:id/xuat-ban/:xbId/tai-ve` → ZIP (`modules/formats/xuat.ts` + `zip.ts`) gồm `noi-dung.md`, `noi-dung.html`, `manifest.json` (dòng nguồn: định dạng + phiên bản, revision đã ghim, thông điệp, nguồn revisions, asset metadata) và `assets/<ten_file>` chỉ cho asset trong `xuat_ban.asset_ids` lúc đăng (asset trùng tên được suffix id; asset thiếu byte hoặc đã xóa ghi `thieu: true` trong manifest). Tiêu đề thông điệp trong manifest lấy từ `thong_diep_revision` đã ghim trong revision nội dung. STORE không nén + timestamp cố định + entry sort → cùng record → cùng byte. Ghi chú duyệt/xuất bản và record thư viện khác không vào bundle.
- Định dạng tách khỏi đích đến: `dinh_dang` là schema/render, `dich_den` là chuỗi tự do trên bản thể hiện/bản xuất bản.
- Endpoint: `GET /api/dinh-dang` (đủ def), `GET /api/dinh-dang/:id`.
