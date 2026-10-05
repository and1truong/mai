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
| `XUNG_DOT_DINH_DANH` | 409 | Gắn identity đã thuộc khách hàng khác; `chi_tiet.khach_id` là person đang giữ identity đó. |
| `CHUA_DANG_NHAP` | 401 | Chế độ bảo vệ bật mà request không có phiên hợp lệ. |
| `SAI_THONG_TIN_DANG_NHAP` | 401 | Sai tên đăng nhập/mật khẩu, hoặc `mat_khau_cu` không đúng. |
| `KHONG_CO_QUYEN` | 403 | Đã đăng nhập nhưng vai trò không đủ (route chỉ quản trị). |
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
- Provider `fixture` deterministic: cùng input → cùng output, không gọi mạng; mọi task trả `noi_dung` dạng canonical JSON và cắt theo giới hạn trường của schema (`do_dai_toi_da`/`so_muc_toi_da`) — input dài không làm output tự vi phạm.
- Tên loại job, handler: snake_case (vd `sinh_ban_the_hien`).

## Job nền

- Bền trên SQLite (`job` + `job_log`), runner trong cùng process — không worker/broker riêng.
- Trạng thái: `cho → dang_chay → xong | loi | huy`. `chay_som_nhat` = lên lịch; `mui_gio` = timezone ngữ cảnh cho UI.
- `khoa_idem` unique: cùng khóa → đúng một job logic. Job còn 'cho'/'dang_chay' → dedupe (`da_tao=false`). Dedupe trên job 'cho' đã lên lịch mà yêu cầu mới muốn chạy sớm hơn (`chay_som_nhat` rỗng hoặc trước lịch cũ) → kéo lịch về sớm và ghi đè `revision_id`/`payload`/`mui_gio` theo yêu cầu mới (log `keo_lich_som`). Job đã 'xong'/'loi'/'huy' → reset về 'cho' và chạy lại cùng dòng (log `enqueue_lai`) — hủy/kết thúc không khóa enqueue vĩnh viễn. Request state + enqueue trong một transaction.
- Attempt **ít-nhất-một-lần**: crash giữa attempt → job chạy lại khi lease hết hạn. Handler phải tự idempotent — kiểm lại entity/revision đích trước khi commit và gọi `ctx.assertConHan()` trước mỗi ghi side-effect (attempt quá timeout vẫn chạy nền nhưng không commit được). Không khẳng định đúng-một-lần cho hiệu ứng từ xa (gửi mail, publish…) — đó là trách nhiệm của handler/provider.
- Lỗi tạm → retry với backoff có biên tới `so_lan_thu_toi_da`. `LoiVinhVien` hoặc hết lượt → `loi`, inspect/retry thủ công được (`POST /api/job/:id/thu-lai`).
- Hủy: `cho`/`dang_chay` → `huy`; commit attempt có guard (lease_token) nên kết quả trễ của job đã hủy bị bỏ, không thành active.
- Concurrency runner: config `jobs.concurrency` / env `MAI_JOB_CONCURRENCY`.
- Không scale đa instance, không điều phối phân tán trong POC.

## Actor

- POC dùng actor cố định `demo` phía server (`ACTOR_DEMO`).
- Field `tao_boi`/`cap_nhat_boi` ghi actor. Access control instance: #16 (P1).

## Đồ thị khách hàng (#59)

- `khach` = person nội bộ id ổn định; `ten`/`email`/`sdt` là property hiển thị tùy chọn — định danh thật nằm ở `dinh_danh`.
- `dinh_danh` unique `(loai, gia_tri_chuan)`: `email` lowercase, `sdt` chỉ digit + dấu `+` đầu, `visitor` id nặc danh nguyên văn, `external`/`social` khóa `<nguon>:<external_id>` scoped hệ thống nguồn (thiếu `external_id` thì khóa theo `gia_tri`).
- Đụng unique khi gắn identity → 409 `XUNG_DOT_DINH_DANH`. **Không auto-merge** theo heuristic — merge là hành động tường minh (ticket #67). `chi_tiet.khach_id` = person đang giữ identity trúng (một chủ); nhiều identity rải trên nhiều person → `chi_tiet.khach_ids` (mảng). Gắn lại identity đã thuộc chính person → trả row cũ, không lỗi.
- `resolveKhach` = tìm-hoặc-tạo: identity đã có → trả person giữ; chưa có → tạo person + identity trong một transaction. `external`/`social` bắt buộc `nguon` (provenance).
- `lan_dau_thay`/`lan_cuoi_thay` trên `khach`: tạo = lần đầu; mọi lần person được nhìn thấy sau (gắn identity, sự kiện) gọi `chamKhach` kéo `lan_cuoi_thay` về gần nhất, không lùi.

### Sự kiện tương tác (#61)

- `tuong_tac` = event first/second-party gắn một person: `loai` trong registry `DANH_SACH_LOAI_TUONG_TAC`, `nguon` (provenance) + `khoa_idem` bắt buộc. Refs (`ban_the_hien_id`, `campaign_id`, `link_dich_id`, `giao_hang_id`, `don_hang_ngoai_id`) là tham chiếu lỏng tới entity MAI — `POST /api/khach/su-kien` validate tồn tại trước khi ghi.
- Idempotent: `khoa_idem` unique → delivery lặp (retry/webhook đẩy lại) trả event cũ, không nhân. Khoảng trống vẫn tính unique qua index `WHERE khoa_idem <> ''`.
- Timeline: `GET /api/khach/:id/timeline?tu=&den=&loai=` — sắp `xay_ra_luc, id` tăng dần, mỗi event gọi `chamKhach`.
- Bridge visitor: cookie `mai_v` (1 năm, HttpOnly, SameSite=Lax) mint ở `/p/`, `/l/`, `/huy-dang-ky`. Visitor làm thành identity loại `visitor` → event xem/click đi vào đúng person. Khóa dedupe deterministic `vt:<loai>:<ref>:<visitor>:<khung30p>` — event cùng khung 30 phút chỉ ghi một lần, lớp thứ hai sau fingerprint `su_kien_do`. `la_bot` không ghi tuong_tac.

### Consent theo kênh (#62)

- `dong_y` = trạng thái hiện tại, unique `(khach_id, kenh, muc_dich)`: kenh `email|sms|web|zalo`, muc_dich `marketing|giao_dich` (hai ô riêng — rút marketing không đụng transactional), trang_thai `cho|tu_choi`, `nguon` bắt buộc.
- `dong_y_log` = mọi chuyển trạng thái một dòng (`tu`→`sang`, nguon, luc); `tu=''` là lần khẳng định đầu. Khẳng định lại cùng trạng thái = no-op, không log.
- `PUT /api/khach/:id/dong-y` transition + log trong một txn; `GET /api/khach/:id/dong-y` trả `{hien_tai, lich_su}`.
- `consentChoGui(db, khachId, kenh, muc_dich)` là điểm kiểm duy nhất trước khi gửi — consent mới nhất có hiệu lực ngay với campaign tương lai.
- Bridge `nguoi_nhan` (#13): subscribe mới → person (identity email) + consent `email/marketing=cho` + event `dang_ky`; hủy (link hoặc tay) → `tu_choi` + event `huy_dang_ky`. Chỉ khi transition `nguoi_nhan` thật (da_tao/da_huy); khoa_idem `nb:<huong>:<email>`. Suppression `nguoi_nhan` vẫn là chặn cứng ở delivery boundary — consent là lớp audit phía person, không thay nó.

- Identity `external`/`social`: khóa `<nguon>:<id_ngoai>` — `nguon` lowercase, phần id **giữ nguyên case** (opaque của hệ thống nguồn; fold case sẽ merge ngầm). `POST /api/khach` trả shape phẳng giống `GET /api/khach/:id` (`{...khach, dinh_danh, da_tao}`). Resolve gắn identity mới vào person có sẵn cũng `ghi_su_kien 'gan_dinh_danh'`. Ghi chú cho #67: person `trang_thai='da_gop'` chưa tồn tại đường nào set — khi làm merge phải xử lý resolve/liệt kê redirect sang person đích.

### Conversion & attribution (#63)

- `chuyen_doi`: `khach_id` **nullable** — conversion không resolve được person vẫn INSERT, giữ nguyên để backfill; `nguon` + `khoa_idem` bắt buộc (idempotency); `tien_te` (ISO 3 ký tự) bắt buộc khi có `gia_tri`, không trộn tiền tệ (không FX).
- `dau_cham_dau` = first-touch: interaction ĐẦU TIÊN của person mang ref attribution (`campaign_id`/`link_dich_id`/`ban_the_hien_id`/`giao_hang_id` khác rỗng). `INSERT OR IGNORE` một lần — event sau không ghi đè. Giới hạn POC: chỉ tính lại khi sửa tay dữ liệu gốc.
- `quy_ve`: 2 row mỗi conversion, `mo_hinh` `first_touch|last_touch` lưu CÙNG kết quả. Ưu tiên đích: `campaign` → `link_dich` → `ban_the_hien` → `giao_hang`. `first_touch` chỉ tính touch `xay_ra_luc <=` conversion (conversion backdated trước touch đầu → `khong_ro`). `last_touch` ưu tiên ref trên chính conversion, không thì interaction gần nhất CÓ ref trước `xay_ra_luc` (event không ref — vd chính event `mua` — không phải touch), không thì `nguon` của interaction gần nhất (`khong_chac`). Không touch nào → `loai_dich='khong_ro'` + `do_tin='khong_chac'`, không bịa.
- `POST /api/khach/chuyen-doi` (khach_id | dinh_danh | trống → unattributed; dinh_danh malformed → 400, không nuốt thành unattributed; gia_tri non-number → 400). Idempotency kiểm `khoa_idem` TRƯỚC resolve — replay không tạo person/identity mồ côi. `GET /api/khach/:id/quy-ve`; `GET /api/chuyen-doi?chua_gan=1&gioi_han=` (cap 500, mặc định 200).
- Report chỉ nói "quy về theo model X" — không biến correlation thành causation.

### Nạp đơn hàng commerce (#64)

- `POST /api/khach/nap-don-hang`: `{he_thong, khach_ngoai_id, don_hang_ngoai_id, dinh_danh?, email?, ten?, items[], gia_tri, tien_te, mua_luc?, khoa_idem?, chi_tiet?}` — một txn tạo person + event `mua` + conversion `mua`.
- Identity matching có kiểm soát: luôn gắn `external` khóa `<he_thong>:<khach_ngoai_id>`; email/`dinh_danh[]` chỉ khi payload khai báo — không fuzzy. Đụng identity của person khác → 409 `XUNG_DOT_DINH_DANH` kèm `khach_ids`.
- Idempotent: `khoa_idem`, dự phòng `he_thong:don_hang_ngoai_id` (key `nd:<khoa>` trên `chuyen_doi`) — replay trả bản ghi cũ, không nhân person/event/conversion.
- Adapter fixture: `modules/khach/nap_fixture.ts` đọc `server/seed-assets/don-hang-mau.json` → cùng contract; seed `story_khach_hang`.
- Giới hạn POC: không refund/cancel, không sync hai chiều, không adapter Shopify/Woo thật.

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
- Handler `sinh_ban_the_hien` (`jobs/handlers.ts`): ghim head khi enqueue → kiểm lại trước commit (trôi → `LoiVinhVien`, retry mới ghim head mới — sửa tay không bị ghi đè). Vòng sinh → `kiemTraDauRa` → sửa có biên **một lần** kèm `sua_loi` → vẫn lỗi → fail vĩnh viễn (kể cả khi provider trả lỗi `sua_duoc` ở lần gọi cuối — không đốt attempt). `thong_diep_revision_id` ghi từ revision mà `lapContextNoiDung` thực sự dùng. Commit `context_sinh` + `revision` trong cùng transaction.
- Usage (`su_dung_sinh`, migration 0008): một dòng mỗi lần gọi provider — `job_id`, `lan_thu`, provider/model/task+phien_ban, `token_vao/ra` khi provider báo, `ms`, `trang_thai` ok/loi, `loi`. `GET /api/su-dung-sinh?job_id=` đọc. `chi_phi_uoc_tinh` **chỉ** điền khi `ai.gia_moi_1k_token_vao/ra` cấu hình tường minh.
- Giới hạn cấu hình (`config.ts` `CauHinhAi`, file `mai.config.json` + env `MAI_AI_*`): `timeout_ms` (mặc định 60s), `toi_da_ky_tu_nguon` (4000), `toi_da_ky_tu_context` (16000), `toi_da_ky_tu_dau_ra` (12000), `toi_da_fan_out` (8). `payload.fan_out` trong `POST /api/job` tạo thêm bản thể hiện + job cho mỗi biến thể (không lồng); response kèm `ds_job_fan_out`.
- `JobCtx.tinHieu` (AbortSignal) cháy khi attempt quá `timeout_ms` — handler truyền xuống `provider.sinh` để hủy fetch còn treo, không để zombie gọi mạng ngầm.
- Đường lỗi deterministic: timeout → `loi`; JSON hỏng → repair rồi `loi`; rate limit → retry backoff; hủy → `huy` không revision. Coverage của job timeout vẫn là `timeout_ms` của attempt — timeout provider nằm trong đó.

Walkthrough chấp nhận ngắn (#20):

1. `bun run build && bun src/server/index.ts` (mặc định `ai.provider=fixture`) → `GET /api/health` trả `provider.la_fixture=true`, Tổng quan hiển thị badge `fixture`.
2. `POST /api/job {loai:"sinh_ban_the_hien", payload:{thong_diep_id:"seed-td-1", dinh_dang:"bai-viet"}}` → job `xong` → revision head là canonical JSON hợp lệ `kiemTraNoiDung`; `GET /api/su-dung-sinh?job_id=` có đúng một dòng `ok`.
3. `payload.fan_out:[{dinh_dang:"caption"}]` → `ds_job_fan_out` có một job phụ; `> toi_da_fan_out` → 400.
4. Live: đặt `MAI_AI_PROVIDER=openai` + `MAI_AI_API_KEY` (+ tùy chọn `MAI_AI_BASE_URL`/`MAI_AI_MODEL`) → cùng contract; thiếu key → job `loi` vĩnh viễn với thông điệp rõ, không retry.

## Luồng POC: kế hoạch (#5)

- Entity `ke_hoach` (migration 0010): intake lưu bền (`intake`), gắn `thong_diep_id` (mỗi kế hoạch một thông điệp chuẩn), `nguon_id` tùy chọn, `cta`, `de_xuat_dau_ra`/`ds_chon` (JSON), `trang_thai` = `nhap` | `da_chon`. Route: `POST/GET /api/ke-hoach`, `GET/PUT /api/ke-hoach/:id`, `POST /api/ke-hoach/:id/chon`.
- Intake chưa xong lưu bền: `PUT` ghi revision thông điệp mới và `intake` mới — tiếp tục sau không mất. Client gửi `dua_tren_revision_id` (head đang sửa) → trôi head → 409; bỏ trống = head hiện tại. `van_ban` rỗng → 400 (không hủy intake lặng); PUT y hệt nội dung cũ = no-op, không revision mới (bản thể hiện không sang `bth_cu` giả).
- "Làm rõ tối thiểu": `cau_hoi` tính lại mỗi lần đọc từ `thieuChungCu` (#20) trên thông điệp + nguồn đã gắn — fact thiếu là câu hỏi, sửa intake xong câu hỏi tự biến mất; không bịa fact.
- Đề xuất đầu ra **deterministic** (`deXuatDauRa`): luật từ khóa trên hồ sơ đối tượng (`moi_quan_tam`/`nhu_cau_giao_tiep`/`kien_thuc_nen`) → định dạng; nhóm "Chung" luôn `newsletter` + `caption`; lọc theo `kiemTraNgonNgu` của registry. Lưu snapshot lúc tạo/cập nhật trong `de_xuat_dau_ra`.
- `POST /:id/chon {ds_chon:[{doi_tuong_id?, dinh_dang, ngon_ngu?}]}`: validate định dạng/ngôn ngữ/đối tượng, lọc lựa chọn trùng → `timBanTheHien` find-or-create (không trùng) → `enqueueJob sinh_ban_the_hien` ghim `entity_id` + `revision_id` = head lúc enqueue + `khoa_idem` `sinh_ban_the_hien:<bth>` (giống route /job). Sinh lại cùng lựa chọn = reset job chạy lần mới → revision mới trên head, `nhap_soan` của actor không bị đụng (#21); sửa tay trước khi job chạy → job vinh_vien, không ghi đè.
- `GET /api/tong-quan` trả thêm `viec_gan_day` (kế hoạch + bản thể hiện mới), `bth_cho_duyet` (hàng chờ review của #21), `bth_cu` = bản thể hiện mà head revision ghim `thong_diep_revision_id` lệch head thông điệp — nguồn đổi sau khi sinh.
- UI: form intake ở Tổng quan → `#/ke-hoach?id=<id>` (hash query, route so theo gốc path); `#/ban-the-hien?id=<id>` deep-link mở thẳng bản — refresh phục hồi đúng entity.

## Luồng POC: lan truyền một thông điệp (#6)

- `ds_chon`/`fan_out` có thêm `dich_den` (chuỗi ≤120): đích đến thuộc danh tính bản thể hiện — cùng `script-ngan` cho `video-ngan-1/2/3` là ba bản riêng, không dedupe với nhau. `dich_den` đi vào payload job để handler biết kênh.
- `GET /api/thong-diep/:id` trả `ds_dau_ra`: mỗi bản kèm `dinh_dang_nhan` (nhãn registry — script gắn nhãn là script), `head_revision_so`, `la_cu` (head revision ghim thông điệp revision không còn là head → nguồn đổi sau khi sinh, không âm thầm thay nháp), `co_nhap` (có `nhap_soan` của actor), `so_xuat_ban`/`xuat_ban_moi_nhat`, `url_trang` (`/p/<id>` khi đã xuất), `nguon` (dòng nguồn ghim theo revision). `doi_tuong_id` resolve ngược theo tên để action "sinh lại" gửi đúng hồ sơ vào context.
- Trang nội bộ `GET /p/<ban_the_hien_id>` (không dưới `/api/`): HTML trọn `docHtmlDayDu` của revision ghim trong `xuat_ban` mới nhất — chỉ nội dung đã duyệt thành trang; revision mới không đổi trang cho tới khi xuất lại. Chưa xuất → 404 JSON `KHONG_TIM_THAY`.
- Nhãn trạng thái: "đã xuất" (có record `xuat_ban` — file bundle/trang nội bộ) khác "đã đăng" (lên mạng xã hội). POC không tích hợp nền tảng ngoài nên không có "đã đăng".
- UI `#/thong-diep?id=<id>`: mọi đầu ra dưới một thông điệp — nhãn đối tượng/đích/ngôn ngữ, trạng thái review, thao tác duyệt/xuất bản/bundle/copy text/xem trước/sinh lại. Trang kế hoạch có "Thêm đầu ra" (định dạng + đối tượng + đích đến tự do) và link "Lan truyền →".

## Luồng POC: số báo / campaign (#8)

- `campaign` mở rộng thành số báo (migration 0012): `so_thu_tu`, `ngay_phat_hanh` (`YYYY-MM-DD`), `chu_de`, `lap_truong`, `chu_bien`, `thuong_hieu_id`/`doi_tuong_id` (hồ sơ dùng lại), `tham_chieu`/`muc_luc` (JSON). `PUT /api/campaign/:id` giữ field vắng mặt (field có mặt rỗng → xóa) — riêng `ten` vẫn bắt buộc.
- `tham_chieu`: `{id, tham_chieu, ban_dich, nguon_id, ghi_chu}` — tham chiếu khai báo trước khi có văn bản; `nguon_id` null = "thiếu văn bản" (cờ `co_van_ban` trong `tham_chieu_view`, gợi ý `thieu_van_ban_tham_chieu`, và `van_ban_tham_chieu` trong `thieu_chung_cu` của context sinh → provider gắn cờ, không bịa trích dẫn). `POST /api/campaign/:id/tham-chieu/:refId/nguon` liên kết nguồn sau đó và đưa nguồn vào thông điệp chủ đề.
- Thông điệp chủ đề: thông điệp sớm nhất gắn campaign (`damBaoThongDiepChuDe` tạo nếu chưa có, tiêu đề `Số N — chủ đề`). Mọi đầu ra của số treo dưới nó → dòng nguồn/provenance/trích dẫn chạy qua `thong_diep_nguon` như bình thường.
- `muc_luc`: `[{id, tieu_de, dinh_dang, doi_tuong_id, dich_den, ly_do}]` — kế hoạch đầu ra sửa được; khóa đầu ra `dinh_dang|doi_tuong_id|dich_den` không trùng (400 khi PUT, 409 khi thêm mục `POST .../muc-luc/them`). `deXuatMucLuc` trả 8 khay mẫu (bài chính, học tài liệu nền, giải thích cho hồ sơ thiếu niên nếu có, hỏi-đáp, bản website, newsletter, chuỗi social, script thảo luận) — chỉ mẫu, biên tập chọn.
- `POST /api/campaign/:id/chon {ds_muc_id}`: chỉ mục được chọn → find-or-create `ban_the_hien` dưới thông điệp chủ đề + `enqueueJob sinh_ban_the_hien` ghim `revision_id` head + `khoa_idem sinh_ban_the_hien:<bth>` (như #5). Payload mang `campaign_id` + `lap_truong` + `thuong_hieu_id` của số.
- `lap_truong` đi vào `lapContextNoiDung` (payload `campaign_id` ưu tiên, fallback `thong_diep.campaign_id`) → `ContextTask.lap_truong` → provider áp hướng đã cấu hình (fixture ghi dòng meta, live thêm đoạn prompt). Không cấu hình → không áp diễn giải.
- `goi_y` (`goiYKhoangTrong`) tính lại mỗi lần đọc: `thieu_van_ban_tham_chieu` (mỗi tham chiếu chưa có văn bản), `thieu_giai_thich` (có hồ sơ đối tượng thiếu niên + tham chiếu có văn bản + chưa có bản `giai-thich-thieu-nien` phục vụ), `thieu_hoc_tai_lieu`. Mỗi gợi ý kèm `ly_do` + `bang_chung` + `de_xuat_muc` — đề xuất việc, không phải nội dung đã đặt; `tu_choi`/`thay_the` KHÔNG tính là phủ khoảng trống.
- `tien_do`: `tong_muc`, `muc_co_dau_ra`, `tong_dau_ra`, `cho_duyet`, `da_duyet`, `da_xuat`, `muc[]` (mỗi mục → bản thể hiện + `da_xuat_ban`); `hang_cho` = bản `cho_duyet` của số (hàng chờ review cấp số).
- `GET /api/campaign/:id/xuat` → ZIP (`taoBundleSoBao`): `manifest.json` (field số + tham chiếu + cờ thiếu văn bản + đầu ra + assets + hồ sơ dùng lại), `tham-chieu.md` (đánh dấu `THIẾU VĂN BẢN`), `dau-ra/NN-<dinh_dang>/noi-dung.md|html` chỉ cho bản đã xuất, `assets/` bytes đã gắn. Tên file `mai-so-<NNN>.zip`.
- `GET /api/ban-the-hien?campaign_id=<id>` lọc đầu ra theo số (JOIN qua `thong_diep.campaign_id`).
- Định dạng mới phien_ban 1: `hoc-tai-lieu`, `giai-thich-thieu-nien` (bắt buộc `dien_giai` + `bang_chung` — diễn giải/bằng chứng đã duyệt), `hoi-dap-doc-gia`, `chuoi-social`, `script-thao-luan`.
- UI `#/so-bao` (+`?id=` chi tiết): sửa field số, bảng tham chiếu + liên kết nguồn, mục lục sửa được + tick mục → "Nháp N mục đã chọn", khối gợi ý tách riêng, tiến độ + hàng chờ + mọi đầu ra, nút tải ZIP.

## Luồng POC: kênh sở hữu — giao nội dung (#13)

- `modules/kenh`: contract `AdapterKenh` theo năng lực đã hiện thực — `xem_truoc`, `dang`, `cap_nhat` (ghim revision mới cùng đích), `len_lich`, `xuat` (bundle tay), `metric`. Kênh không hiện thực năng lực nào thì không quảng bá năng lực đó — `dong_bo` cho adapter chạy thẳng không qua job.
- 4 adapter: `trang_noi_bo` (ghim revision vào `xuat_ban` → `/p/<id>`, idempotent theo xuất bản mới nhất cùng revision), `email` (tương thích Resend: `POST {base}/emails`, header `Authorization: Bearer`, `Idempotency-Key` per (lần giao, người nhận), metric `GET /emails/{id}` → `last_event`), `dry_run` (đồng bộ, trả `xuat_tay` + preview gắn nhãn "không gửi thật"), `xuat_tay` (đồng bộ, xuất bundle cho đích không có API — social/Google Business/script).
- `giao_hang` (migration 0018): mỗi lần giao một dòng — `khoa_idem`, `job_id`, `ma_bien_nhan` (receipt provider), `url`, `len_lich_luc`+`mui_gio`, `lan_thu`, `revision_thanh_cong`, `la_test`. Trạng thái: `cho_giao|da_giao|chap_nhan|khong_chac|xuat_tay|huy|loi` — `chap_nhan` = provider nhận, khác giao tận tay người nhận; `khong_chac` = kết quả mạng mơ hồ (timeout/5xx), không gửi lại mù — thử lại tay giữ nguyên khóa idempotency.
- `nguoi_nhan`: danh bạ opt-in do chủ sở hữu khai báo (`email` unique, `token_huy` bí mật). `huy_dang_ky` = suppression vĩnh viễn — thêm lại cùng email không tự hồi sinh; link `GET /huy-dang-ky?token=` là trang public một chạm.
- Job `giao_kenh`: kiểm lại lần giao còn hiệu lực trước khi gửi (đúng revision head + trạng thái `da_duyet` + nguồn/đích không đổi). Lỗi 4xx provider → `loi` vĩnh viễn (từ chối rõ, chưa nhận); 429 → retry backoff bình thường; 5xx/timeout/network → `khong_chac` vĩnh viễn; lỗi khác → backoff bình thường.
- Vô hiệu hóa lazy khi đọc (`docGiaoHieuLuc`): `cho_giao` mà lý do hết hiệu lực (chưa duyệt, đổi nội dung/context, revision đổi, bản xóa) → `huy` + hủy job kèm. Không quét định kỳ — đọc list/get là vệ sinh.
- Cấu hình `kenh` (`MAI_KENH_URL_GOC`, `MAI_EMAIL_BASE_URL`/`API_KEY_ENV`/`FROM`/`NGUOI_NHAN_TEST`/`TIMEOUT_MS` hoặc `mai.config.json → kenh.*`): `api_key_env` chỉ lưu TÊN biến môi trường — key đọc từ env phía server, không vào config/response/log. Không cấu hình đủ → `san_sang=false`, `LOI_CAU_HINH` khi giao; xem trước và dry-run vẫn dùng được.
- API: `GET /api/kenh`, `GET /api/ban-the-hien/:id/giao` (ds + `goi_y_kenh`), `GET .../giao/xem-truoc?kenh=`, `POST .../giao` (`{kenh, dich_den?, len_lich_luc?, mui_gio?, la_test?}`), `GET /api/giao-hang` + `/:id` (+`/huy`, `/thu-lai`, `/metric`), `GET|POST /api/nguoi-nhan`, `POST /api/nguoi-nhan/:id/huy-dang-ky`.
- UI: trang `#/kenh` (adapter + danh bạ + lần giao); panel "Giao" trong thẻ đầu ra trang `#/thong-diep` — chọn kênh, xem trước, giao/test/đặt lịch.

## Luồng POC: đo kết quả kênh sở hữu (#15)

- Ba nguồn số liệu tách riêng, không trộn: `su_kien_do` (first-party: `xem_trang` từ `/p/<id>`, `click_link` từ `/l/<token>`), `so_lieu nguon='provider'` (snapshot adapter báo, vd `last_event` email), `so_lieu nguon='nhap_tay'` (kết quả người dùng nhập — `bang_chung` bắt buộc, `nhan_dinh` `tu_bao|da_do`). Số đếm chồng lấn giữa nguồn KHÔNG gộp thành người duy nhất.
- `muc_tieu_ket_qua`: một dòng per chủ (`campaign|thong_diep`); `tieu_chi` JSON `{ten, don_vi?, nguong?}[]` — nhãn tiêu chí ngắn, không phải KPI engine. `PUT /api/muc-tieu` upsert.
- `link_dich`: token ngắn → `GET /l/<token>` ghi `click_link` rồi 302 tới `url_dich`. Dedupe link theo (url, chủ). Chỉ http/https.
- Khử trùng + bot sự kiện first-party: `khoa_dedupe` = `loai:doiTuong:sha256(ua|ip)[:8]:khung30phut` — cùng fingerprint trong 30 phút = một sự kiện. `la_bot` theo heuristic UA (crawler/bot/curl/spider…); bot đếm riêng ở cột `loai_bot`, không gộp số chính; bot giả UA trình duyệt không lọc được — ghi rõ trong giới hạn báo cáo.
- Snapshot provider: `ghiSnapshotProvider` gom `su_kien_cuoi` per người nhận → `theo_su_kien`/`theo_nguoi_nhan`; snapshot giống hệt → refresh `thu_luc` thay vì dòng mới (khử trùng sự kiện provider). `GET /api/giao-hang/:id/metric` đọc adapter + lưu; `POST /api/metric/thu-thap` chạy cho mọi lần giao `chap_nhan|da_giao` có adapter metric.
- `GET /api/bao-cao-ket-qua?thong_diep_id|campaign_id`: `dinh_nghia` (định nghĩa từng metric), `gioi_han` (cạnh trường không đo được), `cua_so`/`mui_gio`, `do_tuoi` (sự kiện + snapshot mới nhất), `mau_nho` (<30 sự kiện), `social.reach=null` khi chưa tích hợp — không hiển thị reach giả; `xuat_tay` chỉ là đã xuất, không phải đã đăng/đã xem.
- `goi_y_ket_qua`: gợi ý deterministic từ quan sát (`khoa` ổn định → đọc không trùng), `bat_dinh` theo tổng sự kiện (<10 cao, <30 vừa, còn lại thấp). Loại: `thi_nghiem` (kênh chưa dùng / thu metric cũ >24h), `nhap_tiep` (nháp tiếp theo theo định dạng nhiều xem nhất), `cau_hoi` (link có xem không click; chủ có mục tiêu chưa có kết quả nhập). Chấp nhận = tạo việc liên kết: `ban_the_hien` → find-or-create đầu ra cùng thông điệp + enqueue `sinh_ban_the_hien`; `thu_metric` → chạy thu thập; `cau_hoi` → ghi câu hỏi mở. Không tự đăng hay sửa nội dung đã duyệt. Tương quan nêu trong quan sát, không mô tả thành tăng trưởng nhân quả.
- API: `PUT|GET /api/muc-tieu`, `POST|GET /api/link-dich`, `POST|GET /api/ket-qua`, `GET /api/bao-cao-ket-qua`, `POST /api/metric/thu-thap`, `GET /api/goi-y-ket-qua`, `POST /api/goi-y-ket-qua/:id/chap-nhan|tu-choi`. UI: trang `#/ket-qua`.
