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

## Sinh nội dung (#20)

- Contract provider (`src/modules/generation/index.ts`): `NhaCungCap.sinh(ctx: ContextTask, tinHieu?) → KetQuaTask {noi_dung (canonical JSON theo schema), trich_dan[], canh_bao[], model?, token_vao?, token_ra?}`. `KetQuaTask` giống nhau cho fixture và live — mọi kiểm chứng đi qua `hop_le.ts`, không qua adapter.
- Task có phiên bản (`generation/task.ts`): `nhap_ban_the_hien`, `lap_ke_hoach`, `localize`, `de_xuat_revision` — mỗi cái `id` + `phien_ban` + `mo_ta` contract. Provenance job ghi `task.id/phien_ban` vào `ket_qua` và bảng `su_dung_sinh`.
- Provider: `layNhaCungCap(cauHinh.ai)` → `fixture` (deterministic, offline, mặc định cho local/CI) hoặc `openai` (`generation/live.ts`, endpoint OpenAI-compatible). `GET /api/health` trả `{provider: {ten, la_fixture, model}}`; Tổng quan hiển thị badge `fixture`/`live`.
- Adapter live đọc key từ env `MAI_AI_API_KEY` (tên env cấu hình qua `ai.api_key_env`) **lúc gọi**, phía server — không serialize, không log, không vào `ket_qua`/`context_sinh`/bundle. Prompt ghi rõ dữ liệu nguồn là DỮ LIỆU, không phải chỉ dẫn; provider không có năng lực xuất bản/thanh toán. Thiếu key, 4xx → `LoiProvider(vinh_vien)`; 429/5xx/mạng hỏng/timeout → lỗi tạm thời retry được; output không phải JSON hoặc sai hình dạng → `LoiProvider(sua_duoc)` đi vào vòng sửa.
- Bộ dựng context (`generation/context.ts` `lapContextNoiDung`): resolve revision thông điệp head → revision nguồn đã ghim qua `nguon_revision_ids` (giữ thứ tự), cắt gọn theo `toi_da_ky_tu_nguon`/`toi_da_ky_tu_context` (đánh dấu `da_cat_gon`), báo `thieu_chung_cu` (`so_lieu`/`moc_thoi_gian`/`gia_ca` — heuristic deterministic) để provider để `[CÂU HỎI: ...]` thay vì bịa.
- Kiểm chứng (`generation/hop_le.ts` `kiemTraDauRa`): lỗi cứng = `kiemTraNoiDung` vi phạm schema hoặc chứa `claim_cam`; cảnh báo review = `trich_dan` không resolve tới revision nguồn đã đưa vào, hoặc thuật ngữ `giu_nguyen` có trong nguồn mà đầu ra bỏ. Schema hợp lệ một mình không chứng minh đúng sự thật.
- Handler `sinh_ban_the_hien` (`jobs/handlers.ts`): ghim head khi enqueue → kiểm lại trước commit (trôi → `LoiVinhVien`, retry mới ghim head mới — sửa tay không bị ghi đè). Vòng sinh → `kiemTraDauRa` → sửa có biên **một lần** kèm `sua_loi` → vẫn lỗi → fail vĩnh viễn. Commit `context_sinh` + `revision` trong cùng transaction.
- Usage (`su_dung_sinh`, migration 0008): một dòng mỗi lần gọi provider — `job_id`, `lan_thu`, provider/model/task+phien_ban, `token_vao/ra` khi provider báo, `ms`, `trang_thai` ok/loi, `loi`. `GET /api/su-dung-sinh?job_id=` đọc. `chi_phi_uoc_tinh` **chỉ** điền khi `ai.gia_moi_1k_token_vao/ra` cấu hình tường minh.
- Giới hạn cấu hình (`config.ts` `CauHinhAi`, file `mai.config.json` + env `MAI_AI_*`): `timeout_ms` (mặc định 60s), `toi_da_ky_tu_nguon` (4000), `toi_da_ky_tu_context` (16000), `toi_da_ky_tu_dau_ra` (12000), `toi_da_fan_out` (8). `payload.fan_out` trong `POST /api/job` tạo thêm bản thể hiện + job cho mỗi biến thể (không lồng); response kèm `ds_job_fan_out`.
- `JobCtx.tinHieu` (AbortSignal) cháy khi attempt quá `timeout_ms` — handler truyền xuống `provider.sinh` để hủy fetch còn treo, không để zombie gọi mạng ngầm.
- Đường lỗi deterministic: timeout → `loi`; JSON hỏng → repair rồi `loi`; rate limit → retry backoff; hủy → `huy` không revision. Coverage của job timeout vẫn là `timeout_ms` của attempt — timeout provider nằm trong đó.

Walkthrough chấp nhận ngắn (#20):

1. `bun run build && bun src/server/index.ts` (mặc định `ai.provider=fixture`) → `GET /api/health` trả `provider.la_fixture=true`, Tổng quan hiển thị badge `fixture`.
2. `POST /api/job {loai:"sinh_ban_the_hien", payload:{thong_diep_id:"seed-td-1", dinh_dang:"bai-viet"}}` → job `xong` → revision head là canonical JSON hợp lệ `kiemTraNoiDung`; `GET /api/su-dung-sinh?job_id=` có đúng một dòng `ok`.
3. `payload.fan_out:[{dinh_dang:"caption"}]` → `ds_job_fan_out` có một job phụ; `> toi_da_fan_out` → 400.
4. Live: đặt `MAI_AI_PROVIDER=openai` + `MAI_AI_API_KEY` (+ tùy chọn `MAI_AI_BASE_URL`/`MAI_AI_MODEL`) → cùng contract; thiếu key → job `loi` vĩnh viễn với thông điệp rõ, không retry.
